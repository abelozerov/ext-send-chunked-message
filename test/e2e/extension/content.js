import {
    sendChunkedMessage,
    MAX_CHUNK_SIZE
} from '../../../dist/ext-send-chunked-message';

const CUSTOM_CHUNK_SIZE = 1024;
const largeMessage = 'x'.repeat(CUSTOM_CHUNK_SIZE * 10);

let chunkCount = -1;

// Listen for chunk count from background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request && request.type === 'CHUNK_COUNT') {
        chunkCount = request.count;
        sendResponse();
        return false;
    }
});

sendChunkedMessage(largeMessage, { maxChunkSize: CUSTOM_CHUNK_SIZE })
    .then(response => {
        // Wait a bit for the CHUNK_COUNT message to arrive
        const waitForCount = () => {
            if (chunkCount >= 0) {
                document.title = 'E2E_OK:' + response.length + ':' + chunkCount;
            } else {
                setTimeout(waitForCount, 100);
            }
        };
        waitForCount();
    })
    .catch(err => {
        document.title = 'E2E_FAIL:' + err.message;
    });
