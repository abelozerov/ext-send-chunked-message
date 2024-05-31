import { sendChunkedMessage, MAX_CHUNK_SIZE } from "ext-send-chunked-message";

const largeMessage = 'x'.repeat(MAX_CHUNK_SIZE * 4);

console.log('sending large message. Length: ', largeMessage.length);
sendChunkedMessage(largeMessage)
    .then(response => {
        console.log('large response received. Length: ', response.length);
    })