# ext-send-chunked-message

A library enabling the transmission of large messages via chrome.runtime in Chrome Extensions with Manifest V3.

Standard `chrome.runtime.sendMessage` has a message size limit of 64 MiB, applied to the UTF-8 byte length of the JSON-serialized message. When you exceed the limit you will receive an error "Message exceeded maximum allowed size of 64MiB." (older Chrome versions: "Message length exceeded maximum allowed length"). This library resolves the problem and allows you to send messages without a limit.

## Installation

`npm i ext-send-chunked-message`

## Usage - send large message from content script to background:

content.js:

```js
import { sendChunkedMessage } from 'ext-send-chunked-message'

sendChunkedMessage(largeMessage)
    .then(response => {
        // response received, can be either normal or large in size
        ...
    })
```

In TypeScript, pass the expected response type as a generic to skip the cast:

```ts
import { sendChunkedMessage } from 'ext-send-chunked-message';

interface MyResponse {
    status: 'OK' | 'FAIL';
}

const response = await sendChunkedMessage<MyResponse>(largeMessage);
// response is typed as MyResponse
```

## Usage - receive large message on background and send normal (unchunked) response

background.js:

```js
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

```js
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

```js
import { sendChunkedMessage } from 'ext-send-chunked-message';
import { v4 as uuid } from 'uuid';

sendChunkedMessage(largeMessage, {
    generateRequestId: uuid
});
```

The same option is available on `sendChunkedResponse`:

```js
sendChunkedResponse({
    generateRequestId: uuid,
    sendMessageFn: message => chrome.tabs.sendMessage(sender.tab.id, message)
})(largeResponse, sendResponse);
```

## Custom chunk size

By default, messages are split into ~21 MB chunks — a third of Chrome's 64 MiB limit. The limit applies to the UTF-8 byte length of the message as it is re-serialized on send, and a chunk can inflate at most 3x in that process (2x from JSON escaping of `"` and `\`, 3x from UTF-8 encoding of non-ASCII characters), so a third of the limit is always safe to send without measuring the actual content.

You can change the chunk size via the `maxChunkSize` option (measured in characters of the serialized message). In particular, if you know your payload is ASCII without quotes and backslashes — e.g. base64-encoded files or images — chunks close to the full limit are safe:

```js
sendChunkedMessage(base64FileContent, {
    maxChunkSize: 60 * 1024 * 1024 // safe for base64 payloads
});
```

Or lower it to keep individual messages small:

```js
import { sendChunkedMessage } from 'ext-send-chunked-message';

sendChunkedMessage(largeMessage, {
    maxChunkSize: 1024 * 1024 // 1 MB chunks
});
```

The same option is available on `sendChunkedResponse`:

```js
sendChunkedResponse({
    maxChunkSize: 1024 * 1024, // 1 MB chunks
    sendMessageFn: message => chrome.tabs.sendMessage(sender.tab.id, message)
})(largeResponse, sendResponse);
```

## Error handling

`sendChunkedMessage` rejects when:

- a chunk fails to send (e.g. no receiver — `chrome.runtime.lastError` is propagated);
- the receiver could not reassemble the message (e.g. its service worker restarted mid-transfer);
- the receiver started a chunked response but failed to deliver it;
- a chunked response does not complete within 5 minutes.

```js
try {
    const response = await sendChunkedMessage(largeMessage);
} catch (err) {
    // transport or reassembly failure
}
```

## Examples

See [Example README](./examples/chrome-extension/README.md)

## Author

Alexey Belozerov <alex@welldonecode.com>
