/* global chrome */

if (!chrome) {
    throw new Error("ext-send-chunked-message package can be used in Chrome Extension context only");
}

const CHUNKED_MESSAGE_FLAG = 'CHUNKED_MESSAGE_FLAG'
const MAX_CHUNK_SIZE = 32 * 1024 * 1024  || process.env.EXT_SEND_CHUNKED_MESSAGE_MAX_CHUNK_SIZE; // 32 MB

const requestsStorage = {};

const sendMessageDefaultFn = function(message) {
    return new Promise(resolve =>
        chrome.runtime.sendMessage(message, response => {
            resolve(response);
        })
    );
};

/**
 * Use inside listener added with addOnChunkedMessageListener, to send back chunked response.
 */
const sendChunkedResponse = ({ sendMessageFn } = {}) => (
    response,
    sendResponse,
) => {
    const requestId = self.crypto.randomUUID();
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
const sendChunkedMessage = async (
    message,
    { sendMessageFn, requestId: requestIdOverriden } = {}
) => {
    const sendMessage = sendMessageFn || sendMessageDefaultFn;
    // Generating requestId for the message
    const requestId = requestIdOverriden || self.crypto.randomUUID();
    const messageSerialized = JSON.stringify(message);
    const len = messageSerialized.length;
    const step = MAX_CHUNK_SIZE;
    let ii = 0;
    while (ii < len) {
        const nextIndex = Math.min(ii + step, len);
        const substr = messageSerialized.substring(ii, nextIndex);
        // eslint-disable-next-line no-await-in-loop
        await sendMessage({
            [CHUNKED_MESSAGE_FLAG]: true,
            requestId,
            chunk: substr
        });
        ii = nextIndex;
    }
    // At least 2 messages will be sent. Last one - with done: true
    const response = await sendMessage({
        [CHUNKED_MESSAGE_FLAG]: true,
        requestId,
        done: true
    });

    // If response indicates there will be a chunk message sent, adding a listener to retrieve full response
    if (response && response[CHUNKED_MESSAGE_FLAG]) {
        let listener;
        try {
            const fullResponse = await new Promise(resolve => {
                listener = addOnChunkedMessageListener(
                    (fullResponseFromListener, _, sendResponse) => {
                        sendResponse();
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
 * Add listener to handle chunked messages sent with sendChunkedResponse
 * Listerer object is returned
 */
const addOnChunkedMessageListener = (handler, options) => {
    const newListener = onChunkedMessageHandlerInternal(handler, options);
    chrome.runtime.onMessage.addListener(newListener);
    return newListener;
};

/**
 * Remove listerer handles chunked message. As argument object returned by addOnChunkedMessageListener
 */
const removeOnChunkedMessageListener = listener => {
    chrome.runtime.onMessage.removeListener(listener);
};

const onChunkedMessageHandlerInternal = (
    handler,
    { requestIdToMonitor } = {}
) => (
    request,
    sender,
    sendResponse
    // eslint-disable-next-line consistent-return
) => {
    if (request && request[CHUNKED_MESSAGE_FLAG] && request.requestId) {
        const requestId = request.requestId;

        // Optional param to monitor only certain requestId
        if (requestIdToMonitor && requestId !== requestIdToMonitor) {
            return false;
        }

        if (request.done) {
            // eslint-disable-next-line prefer-spread
            const fullMessageSearialized = ''.concat.apply(
                '',
                requestsStorage[requestId]
            );
            delete requestsStorage[requestId];
            const fullMessage = JSON.parse(fullMessageSearialized);
            // async sendResponse can be enabled inside handler
            return handler(fullMessage, sender, sendResponse);
        } else {
            if (!requestsStorage[requestId]) {
                requestsStorage[requestId] = [];
            }
            requestsStorage[requestId].push(request.chunk);
            sendResponse({
                status: 'PENDING'
            });
        }
    }

    return false;
};

module.exports = {
    CHUNKED_MESSAGE_FLAG,
    MAX_CHUNK_SIZE,
    sendChunkedMessage,
    sendChunkedResponse,
    addOnChunkedMessageListener,
    removeOnChunkedMessageListener
}