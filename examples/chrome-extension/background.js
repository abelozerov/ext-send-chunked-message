import {
    addOnChunkedMessageListener,
    sendChunkedResponse
} from 'ext-send-chunked-message';

// The default chunk size is a third of Chrome's 64 MiB limit; this example
// lowers it to keep the demo payloads small.
const CHUNK_SIZE = 1024 * 1024;

chrome.action.onClicked.addListener(tab => {
    const tabId = tab.id;
    chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
    });
});

addOnChunkedMessageListener((message, sender, sendResponse) => {
    console.log('large message received. Length: ', message.length);

    const largeResponse = 'y'.repeat(CHUNK_SIZE * 3);

    console.log('sending large response. Length: ', largeResponse.length);
    sendChunkedResponse({
        sendMessageFn: message =>
            chrome.tabs.sendMessage(sender.tab.id, message),
        maxChunkSize: CHUNK_SIZE
    })(largeResponse, sendResponse);

    return true; // async listener
});
