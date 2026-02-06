import { sendChunkedMessage } from '../../../dist/ext-send-chunked-message';

const CUSTOM_CHUNK_SIZE = 1024;
const largeMessage = 'x'.repeat(CUSTOM_CHUNK_SIZE * 10);

sendChunkedMessage(largeMessage, { maxChunkSize: CUSTOM_CHUNK_SIZE })
    .then(response => {
        document.title =
            'E2E_OK:' +
            response.data.length +
            ':' +
            response.requestChunkCount +
            ':' +
            response.requestMessageLength;
    })
    .catch(err => {
        document.title = 'E2E_FAIL:' + err.message;
    });
