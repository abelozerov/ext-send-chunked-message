import {
    addOnChunkedMessageListener,
    sendChunkedResponse,
    DEFAULT_CHUNK_SIZE
} from 'ext-send-chunked-message';

chrome.action.onClicked.addListener(tab => {
    const tabId = tab.id;
    chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
    });
});

addOnChunkedMessageListener((message, sender, sendResponse) => {
    console.log('large message received. Length: ', message.length);

    // Six default chunks (~134 MB) — twice Chrome's 64 MiB message limit, so a
    // plain sendResponse would fail here.
    const largeResponse = 'y'.repeat(DEFAULT_CHUNK_SIZE * 6);

    console.log('sending large response. Length: ', largeResponse.length);
    sendChunkedResponse({
        sendMessageFn: message =>
            chrome.tabs.sendMessage(sender.tab.id, message)
    })(largeResponse, sendResponse);

    return true; // async listener
});
