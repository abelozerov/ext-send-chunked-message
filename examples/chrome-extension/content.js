import { sendChunkedMessage } from 'ext-send-chunked-message';

// The default chunk size is a third of Chrome's 64 MiB limit; this example
// lowers it to keep the demo payloads small.
const CHUNK_SIZE = 1024 * 1024;

const largeMessage = 'x'.repeat(CHUNK_SIZE * 4);

console.log('sending large message. Length: ', largeMessage.length);
sendChunkedMessage(largeMessage, { maxChunkSize: CHUNK_SIZE })
    .then(response => {
        console.log('large response received. Length: ', response.length);
    })
    .catch(error => {
        console.error('sending large message failed: ', error);
    });
