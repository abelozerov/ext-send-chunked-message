if (typeof chrome === 'undefined') {
    throw new Error(
        'ext-send-chunked-message package can be used in Chrome Extension context only'
    );
}

export const CHUNKED_MESSAGE_FLAG = 'CHUNKED_MESSAGE_FLAG' as const;
export const MAX_CHUNK_SIZE: number = 32 * 1024 * 1024; // 32 MB

export interface ChunkedMessage {
    [CHUNKED_MESSAGE_FLAG]: boolean;
    requestId: string;
    chunk?: string;
    done?: boolean;
}

export type SendMessageFn = (
    message: ChunkedMessage
) => Promise<ChunkedMessage | null>;

export interface SendChunkedMessageOptions {
    sendMessageFn?: SendMessageFn;
    requestId?: string;
    generateRequestId?: () => string;
}

export interface SendChunkedResponseOptions {
    sendMessageFn?: SendMessageFn;
    generateRequestId?: () => string;
}

export interface AddOnChunkedMessageListenerOptions {
    requestIdToMonitor?: string;
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

const requestsStorage: Record<string, string[]> = {};

const defaultGenerateRequestId = (): string => self.crypto.randomUUID();

const sendMessageDefaultFn: SendMessageFn = function (message) {
    return new Promise(resolve =>
        chrome.runtime.sendMessage(message, response => {
            resolve(response);
        })
    );
};

/**
 * Use inside listener added with addOnChunkedMessageListener, to send back chunked response.
 */
export const sendChunkedResponse =
    ({ sendMessageFn, generateRequestId }: SendChunkedResponseOptions = {}) =>
    (response: unknown, sendResponse: (response?: unknown) => void): void => {
        const requestId = (generateRequestId || defaultGenerateRequestId)();
        // Sending an indication that file will be sent as chunked messages
        sendResponse({
            [CHUNKED_MESSAGE_FLAG]: true,
            requestId
        });
        // At this point content script has added a listener with addOnMessageWithChunksListener
        // Sending file contents as chunked messages
        sendChunkedMessage(response, {
            sendMessageFn: sendMessageFn || sendMessageDefaultFn,
            requestId
        });
    };

/**
 * Use to send chunked message.
 * Receiver should register listener with addOnChunkedMessageListener
 */
export const sendChunkedMessage = async (
    message: unknown,
    {
        sendMessageFn,
        requestId: requestIdOverridden,
        generateRequestId
    }: SendChunkedMessageOptions = {}
): Promise<unknown> => {
    const sendMessage = sendMessageFn || sendMessageDefaultFn;
    // Generating requestId for the message
    const requestId =
        requestIdOverridden ||
        (generateRequestId || defaultGenerateRequestId)();
    const messageSerialized = JSON.stringify(message);
    // Build chunks first, then send sequentially (order matters for reassembly)
    const chunks: string[] = [];
    for (let ii = 0; ii < messageSerialized.length; ii += MAX_CHUNK_SIZE) {
        chunks.push(messageSerialized.substring(ii, ii + MAX_CHUNK_SIZE));
    }
    await chunks.reduce<Promise<unknown>>(
        (chain, chunk) =>
            chain.then(() =>
                sendMessage({
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId,
                    chunk
                })
            ),
        Promise.resolve(null)
    );
    // At least 2 messages will be sent. Last one - with done: true
    const response = await sendMessage({
        [CHUNKED_MESSAGE_FLAG]: true,
        requestId,
        done: true
    });

    // If response indicates there will be a chunk message sent, adding a listener to retrieve full response
    if (response && response[CHUNKED_MESSAGE_FLAG]) {
        let listener: ChunkedMessageListener | undefined;
        try {
            const fullResponse = await new Promise(resolve => {
                listener = addOnChunkedMessageListener(
                    (fullResponseFromListener, _, sendResp) => {
                        sendResp();
                        resolve(fullResponseFromListener);
                    },
                    {
                        requestIdToMonitor: response.requestId
                    }
                );
            });
            return fullResponse;
        } finally {
            if (listener) {
                removeOnChunkedMessageListener(listener);
            }
        }
    } else {
        return response;
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
    chrome.runtime.onMessage.removeListener(listener);
};

const onChunkedMessageHandlerInternal =
    (
        handler: OnChunkedMessageHandler,
        { requestIdToMonitor }: AddOnChunkedMessageListenerOptions = {}
    ): ChunkedMessageListener =>
    (request, sender, sendResponse) => {
        if (request && request[CHUNKED_MESSAGE_FLAG] && request.requestId) {
            const requestId = request.requestId;

            // Optional param to monitor only certain requestId
            if (requestIdToMonitor && requestId !== requestIdToMonitor) {
                return false;
            }

            if (request.done) {
                const fullMessageSerialized = ''.concat(
                    ...requestsStorage[requestId]
                );
                delete requestsStorage[requestId];
                const fullMessage = JSON.parse(fullMessageSerialized);
                // async sendResponse can be enabled inside handler
                return handler(fullMessage, sender, sendResponse) ?? false;
            } else {
                if (!requestsStorage[requestId]) {
                    requestsStorage[requestId] = [];
                }
                requestsStorage[requestId].push(request.chunk!);
                sendResponse({
                    status: 'PENDING'
                });
                return true;
            }
        }

        return false;
    };
