import { expectType, expectError } from 'tsd';
import {
    CHUNKED_MESSAGE_FLAG,
    MAX_CHUNK_SIZE,
    sendChunkedMessage,
    sendChunkedResponse,
    addOnChunkedMessageListener,
    removeOnChunkedMessageListener,
    ChunkedMessage,
    SendMessageFn,
    SendChunkedMessageOptions,
    SendChunkedResponseOptions,
    AddOnChunkedMessageListenerOptions,
    OnChunkedMessageHandler,
    ChunkedMessageListener,
} from '../dist/ext-send-chunked-message';

// --- Constants ---

expectType<'CHUNKED_MESSAGE_FLAG'>(CHUNKED_MESSAGE_FLAG);
expectType<number>(MAX_CHUNK_SIZE);

// --- sendChunkedMessage ---

// Basic call with just a message
expectType<Promise<unknown>>(sendChunkedMessage({ data: 'test' }));

// With all options
expectType<Promise<unknown>>(sendChunkedMessage({ data: 'test' }, {
    sendMessageFn: (msg) => Promise.resolve(null),
    requestId: 'custom-id',
}));

// With only sendMessageFn
expectType<Promise<unknown>>(sendChunkedMessage('string message', {
    sendMessageFn: (msg) => Promise.resolve(null),
}));

// With only requestId
expectType<Promise<unknown>>(sendChunkedMessage([1, 2, 3], {
    requestId: 'my-id',
}));

// Empty options is fine
expectType<Promise<unknown>>(sendChunkedMessage({ data: 'test' }, {}));

// Missing required message argument
expectError(sendChunkedMessage());

// Wrong option types
expectError(sendChunkedMessage({ data: 'test' }, { requestId: 123 }));
expectError(sendChunkedMessage({ data: 'test' }, { sendMessageFn: 'not a function' }));

// --- sendChunkedResponse ---

// No options
const responderNoOpts = sendChunkedResponse();
expectType<(response: unknown, sendResponse: (response?: unknown) => void) => void>(responderNoOpts);

// With sendMessageFn
const responderWithFn = sendChunkedResponse({
    sendMessageFn: (msg) => Promise.resolve(null),
});
expectType<(response: unknown, sendResponse: (response?: unknown) => void) => void>(responderWithFn);

// Empty options
sendChunkedResponse({});

// Wrong option type
expectError(sendChunkedResponse({ sendMessageFn: 42 }));

// --- addOnChunkedMessageListener ---

// Basic handler
const handler: OnChunkedMessageHandler = (message, sender, sendResponse) => {
    sendResponse({ ok: true });
    return true;
};

const listener = addOnChunkedMessageListener(handler);
expectType<ChunkedMessageListener>(listener);

// With requestIdToMonitor
const filteredListener = addOnChunkedMessageListener(handler, {
    requestIdToMonitor: 'some-id',
});
expectType<ChunkedMessageListener>(filteredListener);

// Handler returning void is valid
addOnChunkedMessageListener((message, sender, sendResponse) => {
    sendResponse();
});

// Missing required handler argument
expectError(addOnChunkedMessageListener());

// Wrong option type
expectError(addOnChunkedMessageListener(handler, { requestIdToMonitor: 123 }));

// --- removeOnChunkedMessageListener ---

expectType<void>(removeOnChunkedMessageListener(listener));

// Missing required argument
expectError(removeOnChunkedMessageListener());

// --- ChunkedMessage interface ---

const chunkedMsg: ChunkedMessage = {
    CHUNKED_MESSAGE_FLAG: true,
    requestId: 'abc',
};

const chunkedMsgWithChunk: ChunkedMessage = {
    CHUNKED_MESSAGE_FLAG: true,
    requestId: 'abc',
    chunk: '{"data":"test"}',
};

const chunkedMsgDone: ChunkedMessage = {
    CHUNKED_MESSAGE_FLAG: true,
    requestId: 'abc',
    done: true,
};

// --- SendMessageFn type ---

const sendFn: SendMessageFn = (msg) => Promise.resolve(null);
expectType<Promise<ChunkedMessage | null>>(sendFn({ CHUNKED_MESSAGE_FLAG: true, requestId: 'x' }));

// --- Options interfaces ---

const opts: SendChunkedMessageOptions = {
    sendMessageFn: (msg) => Promise.resolve(null),
    requestId: 'id',
};

const respOpts: SendChunkedResponseOptions = {
    sendMessageFn: (msg) => Promise.resolve(null),
};

const listenerOpts: AddOnChunkedMessageListenerOptions = {
    requestIdToMonitor: 'req-123',
};
