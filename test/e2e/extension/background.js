import {
    addOnChunkedMessageListener,
    sendChunkedResponse,
    CHUNKED_MESSAGE_FLAG
} from '../../../dist/ext-send-chunked-message';

const CUSTOM_CHUNK_SIZE = 1024;

// Count incoming chunks per requestId
const chunkCounts = {};
let lastCompletedRequestId = null;

chrome.runtime.onMessage.addListener(request => {
    if (request && request[CHUNKED_MESSAGE_FLAG] && request.requestId) {
        if (request.chunk !== undefined) {
            if (!chunkCounts[request.requestId]) {
                chunkCounts[request.requestId] = 0;
            }
            chunkCounts[request.requestId]++;
        }
        if (request.done) {
            lastCompletedRequestId = request.requestId;
        }
    }
});

addOnChunkedMessageListener((message, sender, sendResponse) => {
    const requestChunkCount = chunkCounts[lastCompletedRequestId] || 0;

    const responsePayload = {
        data: 'y'.repeat(CUSTOM_CHUNK_SIZE * 3),
        requestChunkCount,
        requestMessageLength: typeof message === 'string' ? message.length : JSON.stringify(message).length
    };

    sendChunkedResponse({
        sendMessageFn: msg => chrome.tabs.sendMessage(sender.tab.id, msg),
        maxChunkSize: CUSTOM_CHUNK_SIZE
    })(responsePayload, sendResponse);

    return true;
});

chrome.action.onClicked.addListener(tab => {
    chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
    });
});
