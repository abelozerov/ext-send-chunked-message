import { addOnChunkedMessageListener, sendChunkedResponse, MAX_CHUNK_SIZE } from 'ext-send-chunked-message'

chrome.action.onClicked.addListener(tab => {
    const tabId = tab.id;
    chrome.scripting.executeScript(
        { target: { tabId }, files: ['content.js'] }
    );
});

addOnChunkedMessageListener((message, sender, sendResponse) => {
    console.log('large message received. Lenght: ', message.length);

    const largeResponse = 'y'.repeat(MAX_CHUNK_SIZE * 2.5);

    sendChunkedResponse({
        sendMessageFn: message =>
            chrome.tabs.sendMessage(sender.tab.id, message)
    })(largeResponse, sendResponse);

    return true; // async listener
})