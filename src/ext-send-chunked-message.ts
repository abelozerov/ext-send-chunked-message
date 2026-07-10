export const CHUNKED_MESSAGE_FLAG = 'CHUNKED_MESSAGE_FLAG' as const;
// Chrome enforces mojom::kMaxMessageBytes (64 MiB) on the UTF-8 byte length of
// the JSON-serialized message (see extensions/renderer/api/messaging/messaging_util.cc)
const CHROME_MESSAGE_SIZE_LIMIT = 64 * 1024 * 1024;
// Headroom for the envelope: flag, requestId, isResponse and JSON punctuation
const ENVELOPE_OVERHEAD = 1024;
// A chunk is measured in UTF-16 code units, but the limit applies to UTF-8
// bytes of the chunk re-serialized inside the envelope. A chunk is a slice of
// JSON.stringify output, so it contains no raw control characters or lone
// surrogates (except at most two produced by slicing, covered by the envelope
// headroom); the worst remaining inflation is 3x — 2x for escaping '"' and
// '\', 3x for UTF-8 encoding of non-ASCII. A third of the limit is therefore
// always safe to send, with no need to measure the actual encoded size.
// Payloads known to inflate less can pass a bigger maxChunkSize (see README)
export const DEFAULT_CHUNK_SIZE: number = Math.floor(
    (CHROME_MESSAGE_SIZE_LIMIT - ENVELOPE_OVERHEAD) / 3
);
/**
 * @deprecated Use DEFAULT_CHUNK_SIZE. This is the default chunk size, not a
 * maximum — maxChunkSize may be set higher for payloads that inflate less
 * than the worst case (e.g. base64).
 */
export const MAX_CHUNK_SIZE: number = DEFAULT_CHUNK_SIZE;
const RESPONSE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const STALE_REQUEST_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface ChunkedMessage {
    [CHUNKED_MESSAGE_FLAG]: boolean;
    requestId: string;
    chunk?: string;
    done?: boolean;
    isResponse?: boolean;
    error?: string;
}

export type SendMessageFn = (
    message: ChunkedMessage
) => Promise<ChunkedMessage | null>;

export interface SendChunkedMessageOptions {
    sendMessageFn?: SendMessageFn;
    requestId?: string;
    generateRequestId?: () => string;
    maxChunkSize?: number;
    isResponse?: boolean;
}

export interface SendChunkedResponseOptions {
    sendMessageFn?: SendMessageFn;
    generateRequestId?: () => string;
    maxChunkSize?: number;
}

export interface AddOnChunkedMessageListenerOptions {
    requestIdToMonitor?: string;
    onError?: (error: Error) => void;
}

export type OnChunkedMessageHandler = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
) => boolean | void;

export type ChunkedMessageListener = (
    request: ChunkedMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
) => boolean;

const requestsStorage: Record<string, { chunks: string[]; createdAt: number }> =
    {};

const cleanupStaleRequests = (): void => {
    const now = Date.now();
    for (const id of Object.keys(requestsStorage)) {
        if (now - requestsStorage[id].createdAt > STALE_REQUEST_TTL_MS) {
            delete requestsStorage[id];
        }
    }
};

const defaultGenerateRequestId = (): string => self.crypto.randomUUID();

const assertChromeContext = (): void => {
    if (typeof chrome === 'undefined' || !chrome.runtime) {
        throw new Error(
            'ext-send-chunked-message package can be used in Chrome Extension context only'
        );
    }
};

const sendMessageDefaultFn: SendMessageFn = function (message) {
    assertChromeContext();
    return new Promise((resolve, reject) =>
        chrome.runtime.sendMessage(message, response => {
            const lastError = chrome.runtime.lastError;
            if (lastError) {
                reject(new Error(lastError.message));
            } else {
                resolve(response);
            }
        })
    );
};

/**
 * Use inside listener added with addOnChunkedMessageListener, to send back chunked response.
 */
export const sendChunkedResponse =
    ({
        sendMessageFn,
        generateRequestId,
        maxChunkSize
    }: SendChunkedResponseOptions = {}) =>
    (response: unknown, sendResponse: (response?: unknown) => void): void => {
        const requestId = (generateRequestId || defaultGenerateRequestId)();
        // Sending an indication that file will be sent as chunked messages
        sendResponse({
            [CHUNKED_MESSAGE_FLAG]: true,
            requestId
        });
        // At this point content script has added a listener with addOnMessageWithChunksListener
        // Sending file contents as chunked messages
        const sendMessage = sendMessageFn || sendMessageDefaultFn;
        sendChunkedMessage(response, {
            sendMessageFn: sendMessage,
            requestId,
            maxChunkSize,
            isResponse: true
        }).catch((err: unknown) => {
            // Let the receiver reject right away instead of waiting for its timeout
            sendMessage({
                [CHUNKED_MESSAGE_FLAG]: true,
                requestId,
                isResponse: true,
                error: `Failed to send chunked response: ${
                    err instanceof Error ? err.message : String(err)
                }`
            }).catch(() => {
                // Error message did not go through either — receiver will time out
            });
        });
    };

/**
 * Use to send chunked message.
 * Receiver should register listener with addOnChunkedMessageListener
 */
export const sendChunkedMessage = async <TResponse = unknown>(
    message: unknown,
    {
        sendMessageFn,
        requestId: requestIdOverridden,
        generateRequestId,
        maxChunkSize,
        isResponse
    }: SendChunkedMessageOptions = {}
): Promise<TResponse> => {
    const sendMessage = sendMessageFn || sendMessageDefaultFn;
    // Generating requestId for the message
    const requestId =
        requestIdOverridden ||
        (generateRequestId || defaultGenerateRequestId)();
    const messageSerialized = JSON.stringify(message);
    if (messageSerialized === undefined) {
        throw new Error(
            'Message is not JSON-serializable (JSON.stringify returned undefined)'
        );
    }
    const chunkSize = Math.max(1, maxChunkSize || DEFAULT_CHUNK_SIZE);
    // Build chunks first, then send sequentially (order matters for reassembly)
    const chunks: string[] = [];
    for (let ii = 0; ii < messageSerialized.length; ii += chunkSize) {
        chunks.push(messageSerialized.substring(ii, ii + chunkSize));
    }
    await chunks.reduce<Promise<unknown>>(
        (chain, chunk) =>
            chain.then(() =>
                sendMessage({
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId,
                    chunk,
                    ...(isResponse ? { isResponse: true } : {})
                })
            ),
        Promise.resolve(null)
    );
    // At least 2 messages will be sent. Last one - with done: true
    const response = await sendMessage({
        [CHUNKED_MESSAGE_FLAG]: true,
        requestId,
        done: true,
        ...(isResponse ? { isResponse: true } : {})
    });

    if (response && response[CHUNKED_MESSAGE_FLAG]) {
        // Receiver failed to reassemble the message
        if (response.error) {
            throw new Error(response.error);
        }
        // Response indicates there will be a chunked message sent, adding a listener to retrieve full response
        let listener: ChunkedMessageListener | undefined;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        try {
            const fullResponse = await new Promise((resolve, reject) => {
                timeoutId = setTimeout(() => {
                    reject(
                        new Error(
                            `Chunked response timed out for requestId: ${response.requestId}`
                        )
                    );
                }, RESPONSE_TIMEOUT_MS);
                listener = addOnChunkedMessageListener(
                    (fullResponseFromListener, _, sendResp) => {
                        sendResp();
                        resolve(fullResponseFromListener);
                    },
                    {
                        requestIdToMonitor: response.requestId,
                        onError: reject
                    }
                );
            });
            return fullResponse as TResponse;
        } finally {
            if (timeoutId !== undefined) {
                clearTimeout(timeoutId);
            }
            if (listener) {
                removeOnChunkedMessageListener(listener);
            }
            // Drop chunks accumulated for a response that timed out or failed
            delete requestsStorage[response.requestId];
        }
    } else {
        return response as TResponse;
    }
};

/**
 * Add listener to handle chunked messages sent with sendChunkedResponse.
 * Listener object is returned.
 */
export const addOnChunkedMessageListener = (
    handler: OnChunkedMessageHandler,
    options?: AddOnChunkedMessageListenerOptions
): ChunkedMessageListener => {
    assertChromeContext();
    const newListener = onChunkedMessageHandlerInternal(handler, options);
    chrome.runtime.onMessage.addListener(newListener);
    return newListener;
};

/**
 * Remove listener that handles chunked message. Pass the object returned by addOnChunkedMessageListener.
 */
export const removeOnChunkedMessageListener = (
    listener: ChunkedMessageListener
): void => {
    assertChromeContext();
    chrome.runtime.onMessage.removeListener(listener);
};

const onChunkedMessageHandlerInternal =
    (
        handler: OnChunkedMessageHandler,
        { requestIdToMonitor, onError }: AddOnChunkedMessageListenerOptions = {}
    ): ChunkedMessageListener =>
    (request, sender, sendResponse) => {
        if (request && request[CHUNKED_MESSAGE_FLAG] && request.requestId) {
            const requestId = request.requestId;

            // Optional param to monitor only certain requestId
            if (requestIdToMonitor && requestId !== requestIdToMonitor) {
                return false;
            }

            // Response traffic belongs to the listener that monitors its requestId;
            // a general listener must not consume it as an incoming request
            if (!requestIdToMonitor && request.isResponse) {
                return false;
            }

            // Sender aborted the transfer
            if (request.error !== undefined) {
                delete requestsStorage[requestId];
                if (onError) {
                    onError(new Error(request.error));
                }
                sendResponse();
                return false;
            }

            if (request.done) {
                const entry = requestsStorage[requestId];
                delete requestsStorage[requestId];
                if (!entry) {
                    // Chunks never arrived or were dropped (e.g. the service
                    // worker restarted mid-transfer, or the request went stale)
                    sendResponse({
                        [CHUNKED_MESSAGE_FLAG]: true,
                        requestId,
                        error: `No chunks stored for requestId: ${requestId} — receiver may have restarted mid-transfer`
                    });
                    return false;
                }
                let fullMessage: unknown;
                try {
                    fullMessage = JSON.parse(entry.chunks.join(''));
                } catch {
                    sendResponse({
                        [CHUNKED_MESSAGE_FLAG]: true,
                        requestId,
                        error: `Failed to reassemble chunked message for requestId: ${requestId}`
                    });
                    return false;
                }
                // async sendResponse can be enabled inside handler
                return handler(fullMessage, sender, sendResponse) ?? false;
            } else {
                if (!requestsStorage[requestId]) {
                    cleanupStaleRequests();
                    requestsStorage[requestId] = {
                        chunks: [],
                        createdAt: Date.now()
                    };
                }
                if (request.chunk !== undefined) {
                    requestsStorage[requestId].chunks.push(request.chunk);
                }
                sendResponse({
                    status: 'PENDING'
                });
                return true;
            }
        }

        return false;
    };
