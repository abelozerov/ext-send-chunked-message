const { sendChunkedMessage, MAX_CHUNK_SIZE } = require("ext-send-chunked-message");

const largeMessage = 'x'.repeat(MAX_CHUNK_SIZE * 2.5);

sendChunkedMessage(largeMessage)
    .then(response => {
        console.log('large response received. Lenght: ', response.length);
    })