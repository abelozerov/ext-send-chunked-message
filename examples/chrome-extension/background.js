import { addOnChunkedMessageListener, sendChunkedResponse, MAX_CHUNK_SIZE } from 'ext-send-chunked-message'

chrome.action.onClicked.addListener(tab => {
    const tabId = tab.id;
    chrome.scripting.executeScript(
        { target: { tabId }, files: ['content.js'] }
    );
});

addOnChunkedMessageListener((message, sender, sendResponse) => {
    console.log('large message received. Length: ', message.length);

    const largeResponse = 'y'.repeat(MAX_CHUNK_SIZE * 3);

    console.log('sending large response. Length: ', largeResponse.length);
    sendChunkedResponse({
        sendMessageFn: message =>
            chrome.tabs.sendMessage(sender.tab.id, message)
    })(largeResponse, sendResponse);

    return true; // async listener
})