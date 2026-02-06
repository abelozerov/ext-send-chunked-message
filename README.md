# ext-send-chunked-message

A library enabling the transmission of large messages via chrome.runtime in Chrome Extensions with Manifest V3.

Standard `chrome.runtime.sendMessage` has a message size limit ~32Mb. When you exceed the limit you will receive an error "Uncaught Error: Message length exceeded maximum allowed length". This library resolves the problem and allows you to send messages without a limit.

## Installation

`npm i ext-send-chunked-message`

## Usage - send large message from content script to backround:

content.js:

```
import { sendChunkedMessage } from 'ext-send-chunked-message'

sendChunkedMessage(largeMessage)
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

    const normalResponse = ...;

    sendResponse(normalResponse);

    // return true for async listener
})
```

## Usage - receive large message on background and send large response

background.js:
```
import { addOnChunkedMessageListener, sendChunkedResponse } from 'ext-send-chunked-message'

addOnChunkedMessageListener((message, sender, sendResponse) => {
    // "message" is a large message, received in chunks and restored

    const largeResponse = ...;

    sendChunkedResponse({
        sendMessageFn: message =>
            chrome.tabs.sendMessage(sender.tab.id, message)
    })(largeResponse, sendResponse);

    return true; // async listener
})
```

## Custom request ID generation

By default, `self.crypto.randomUUID()` is used to generate request IDs. You can provide your own function via the `generateRequestId` option:

```
import { sendChunkedMessage } from 'ext-send-chunked-message'
import { v4 as uuid } from 'uuid'

sendChunkedMessage(largeMessage, {
    generateRequestId: uuid
})
```

The same option is available on `sendChunkedResponse`:

```
sendChunkedResponse({
    generateRequestId: uuid,
    sendMessageFn: message =>
        chrome.tabs.sendMessage(sender.tab.id, message)
})(largeResponse, sendResponse)
```

## Examples

See [Example README](./examples/chrome-extension/README.md)

## Author

Alexey Belozerov <alex@welldonecode.com>