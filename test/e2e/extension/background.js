import {
    addOnChunkedMessageListener,
    sendChunkedResponse,
    CHUNKED_MESSAGE_FLAG
} from '../../../dist/ext-send-chunked-message';

const MAX_CHUNK_SIZE = 1024;

// Count incoming chunks per requestId
const chunkCounts = {};

chrome.runtime.onMessage.addListener((request, sender) => {
    if (
        request &&
        request[CHUNKED_MESSAGE_FLAG] &&
        request.requestId &&
        request.chunk !== undefined
    ) {
        if (!chunkCounts[request.requestId]) {
            chunkCounts[request.requestId] = 0;
        }
        chunkCounts[request.requestId]++;
    }
});

addOnChunkedMessageListener((message, sender, sendResponse) => {
    // Find the chunk count for this completed request
    // The requestId was cleaned up from storage, but we tracked it in chunkCounts
    const count = Object.values(chunkCounts).reduce((a, b) => a + b, 0);

    const largeResponse = 'y'.repeat(MAX_CHUNK_SIZE * 3);

    sendChunkedResponse({
        sendMessageFn: msg => chrome.tabs.sendMessage(sender.tab.id, msg),
        maxChunkSize: MAX_CHUNK_SIZE
    })(largeResponse, sendResponse);

    // Send chunk count to content script after a short delay
    setTimeout(() => {
        chrome.tabs.sendMessage(sender.tab.id, {
            type: 'CHUNK_COUNT',
            count
        });
    }, 500);

    return true;
});

chrome.action.onClicked.addListener(tab => {
    chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
    });
});
