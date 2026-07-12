import {
    sendChunkedMessage,
    DEFAULT_CHUNK_SIZE
} from 'ext-send-chunked-message';

// Six default chunks (~134 MB) — twice Chrome's 64 MiB message limit, so a
// plain chrome.runtime.sendMessage would fail here.
const largeMessage = 'x'.repeat(DEFAULT_CHUNK_SIZE * 6);

console.log('sending large message. Length: ', largeMessage.length);
sendChunkedMessage(largeMessage)
    .then(response => {
        console.log('large response received. Length: ', response.length);
    })
    .catch(error => {
        console.error('sending large message failed: ', error);
    });
