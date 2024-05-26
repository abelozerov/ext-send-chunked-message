# ext-send-chunked-message

A library enabling the transmission of large messages via chrome.runtime in Chrome Extensions with Manifest V3.

Standard `chrome.runtime.sendMessage` has a message size limit ~32Mb. When you exceed the limit you will receive an error "Uncaught Error: Message length exceeded maximum allowed length". This library resolves the problem and allows you to send messages without a limit.

## Usage - send large message from content script to backround:

content.js:

```
import { sendChunkedMessage } from 'ext-send-chunked-message'

sendChunkedMessage({
    // your large message, will be sent in chunks
})
    .then(response => {
        // response received, can be either normal or large in size
        ...
    })
```

## Usage - receive large message on background and send normal (unchunked) response

background.js:
```
import { addOnChunkedMessageListener } from 'ext-send-chunked-message'

addOnChunkedMessageListener((message, sender, sendResponse) => {
    // "message" is a large message, received in chunks and restored
    sendResponse({
        // response of normal size
    });
})
```

## Usage - receive large message on background and send large response

background.js:
```
import { sendChunkedMessage, sendChunkedResponse } from 'ext-send-chunked-message'

addOnChunkedMessageListener((message, sender, sendResponse) => {
    // "message" is a large message, received in chunks and restored

    const largeResponse = {
        // large response, will be sent in chunks
    };
    sendChunkedResponse({
        sendMessageFn: message =>
            chrome.tabs.sendMessage(sender.tab.id, message)
    })(sendResponse, largeResponse, sender);

    return true; // async listener
})
```

## Suported environment variables:

`EXT_SEND_CHUNKED_MESSAGE_MAX_CHUNK_SIZE` - max chunk size in bytes. Default is 32 * 1024 * 1024 (32Mb)