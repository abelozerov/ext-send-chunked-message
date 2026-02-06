/* eslint-disable no-undef */

// Set up mocks before requiring the module
const mockAddListener = jest.fn();
const mockRemoveListener = jest.fn();
const mockSendMessage = jest.fn();

global.chrome = {
    runtime: {
        sendMessage: mockSendMessage,
        onMessage: {
            addListener: mockAddListener,
            removeListener: mockRemoveListener
        }
    }
};

global.self = {
    crypto: {
        randomUUID: jest.fn(() => 'test-uuid-1234')
    }
};

const {
    CHUNKED_MESSAGE_FLAG,
    MAX_CHUNK_SIZE,
    sendChunkedMessage,
    sendChunkedResponse,
    addOnChunkedMessageListener,
    removeOnChunkedMessageListener
} = require('../dist/ext-send-chunked-message');

describe('ext-send-chunked-message', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        self.crypto.randomUUID.mockReturnValue('test-uuid-1234');
    });

    describe('constants', () => {
        test('CHUNKED_MESSAGE_FLAG has expected value', () => {
            expect(CHUNKED_MESSAGE_FLAG).toBe('CHUNKED_MESSAGE_FLAG');
        });

        test('MAX_CHUNK_SIZE defaults to 32MB', () => {
            expect(MAX_CHUNK_SIZE).toBe(32 * 1024 * 1024);
        });
    });

    describe('sendChunkedMessage', () => {
        test('sends small message as single chunk + done', async () => {
            const sendMessageFn = jest.fn().mockResolvedValue(undefined);
            const message = { hello: 'world' };

            await sendChunkedMessage(message, { sendMessageFn });

            expect(sendMessageFn).toHaveBeenCalledTimes(2);
            expect(sendMessageFn).toHaveBeenNthCalledWith(1, {
                [CHUNKED_MESSAGE_FLAG]: true,
                requestId: 'test-uuid-1234',
                chunk: JSON.stringify(message)
            });
            expect(sendMessageFn).toHaveBeenNthCalledWith(2, {
                [CHUNKED_MESSAGE_FLAG]: true,
                requestId: 'test-uuid-1234',
                done: true
            });
        });

        test('splits large message into multiple chunks', async () => {
            const sendMessageFn = jest.fn().mockResolvedValue(undefined);
            const largeString = 'x'.repeat(MAX_CHUNK_SIZE + 100);
            const message = { data: largeString };

            await sendChunkedMessage(message, { sendMessageFn });

            // Serialized JSON is larger than MAX_CHUNK_SIZE, so at least 2 chunks + 1 done
            expect(sendMessageFn.mock.calls.length).toBeGreaterThanOrEqual(3);

            // All calls except last should have chunk property
            for (let i = 0; i < sendMessageFn.mock.calls.length - 1; i++) {
                const call = sendMessageFn.mock.calls[i][0];
                expect(call[CHUNKED_MESSAGE_FLAG]).toBe(true);
                expect(call.requestId).toBe('test-uuid-1234');
                expect(call.chunk).toBeDefined();
            }

            // Last call is done
            expect(sendMessageFn).toHaveBeenLastCalledWith({
                [CHUNKED_MESSAGE_FLAG]: true,
                requestId: 'test-uuid-1234',
                done: true
            });
        });

        test('chunks reconstruct to the original serialized message', async () => {
            const sendMessageFn = jest.fn().mockResolvedValue(undefined);
            const largeString = 'abcdefghij'.repeat(MAX_CHUNK_SIZE / 5);
            const message = { data: largeString };
            const serialized = JSON.stringify(message);

            await sendChunkedMessage(message, { sendMessageFn });

            // Collect all chunks (all calls except the last "done" call)
            const chunks = [];
            for (let i = 0; i < sendMessageFn.mock.calls.length - 1; i++) {
                chunks.push(sendMessageFn.mock.calls[i][0].chunk);
            }

            expect(chunks.join('')).toBe(serialized);
        });

        test('uses provided requestId override', async () => {
            const sendMessageFn = jest.fn().mockResolvedValue(undefined);

            await sendChunkedMessage(
                { test: true },
                {
                    sendMessageFn,
                    requestId: 'custom-id'
                }
            );

            expect(sendMessageFn.mock.calls[0][0].requestId).toBe('custom-id');
            expect(sendMessageFn.mock.calls[1][0].requestId).toBe('custom-id');
        });

        test('uses custom generateRequestId function', async () => {
            const sendMessageFn = jest.fn().mockResolvedValue(undefined);
            const generateRequestId = jest.fn().mockReturnValue('generated-id');

            await sendChunkedMessage(
                { test: true },
                {
                    sendMessageFn,
                    generateRequestId
                }
            );

            expect(generateRequestId).toHaveBeenCalledTimes(1);
            expect(sendMessageFn.mock.calls[0][0].requestId).toBe(
                'generated-id'
            );
        });

        test('requestId override takes precedence over generateRequestId', async () => {
            const sendMessageFn = jest.fn().mockResolvedValue(undefined);
            const generateRequestId = jest.fn().mockReturnValue('generated-id');

            await sendChunkedMessage(
                { test: true },
                {
                    sendMessageFn,
                    requestId: 'explicit-id',
                    generateRequestId
                }
            );

            expect(generateRequestId).not.toHaveBeenCalled();
            expect(sendMessageFn.mock.calls[0][0].requestId).toBe(
                'explicit-id'
            );
        });

        test('returns non-chunked response directly', async () => {
            const sendMessageFn = jest
                .fn()
                .mockResolvedValueOnce(undefined) // chunk
                .mockResolvedValueOnce({ result: 'ok' }); // done

            const result = await sendChunkedMessage(
                { data: 'test' },
                { sendMessageFn }
            );

            expect(result).toEqual({ result: 'ok' });
        });

        test('returns undefined when response is empty', async () => {
            const sendMessageFn = jest.fn().mockResolvedValue(undefined);

            const result = await sendChunkedMessage(
                { data: 'test' },
                { sendMessageFn }
            );

            expect(result).toBeUndefined();
        });

        test('uses default chrome.runtime.sendMessage when no sendMessageFn provided', async () => {
            mockSendMessage.mockImplementation((msg, cb) => cb(undefined));

            await sendChunkedMessage({ test: true });

            expect(mockSendMessage).toHaveBeenCalled();
        });

        test('handles chunked response from receiver', async () => {
            const sendMessageFn = jest
                .fn()
                .mockResolvedValueOnce(undefined) // chunk
                .mockResolvedValueOnce({
                    // done - indicates chunked response coming
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'response-req-id'
                });

            const resultPromise = sendChunkedMessage(
                { data: 'test' },
                { sendMessageFn }
            );

            // Wait for async operations to set up the listener
            await new Promise(resolve => setTimeout(resolve, 10));

            // Get the listener that was registered for the chunked response
            const registeredListener =
                mockAddListener.mock.calls[
                    mockAddListener.mock.calls.length - 1
                ][0];

            // Simulate receiving chunked response
            registeredListener(
                {
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'response-req-id',
                    chunk: JSON.stringify({ response: 'big data' })
                },
                {},
                jest.fn()
            );

            registeredListener(
                {
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'response-req-id',
                    done: true
                },
                {},
                jest.fn()
            );

            const result = await resultPromise;
            expect(result).toEqual({ response: 'big data' });
        });

        test('cleans up listener and timeout after receiving chunked response', async () => {
            const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

            const sendMessageFn = jest
                .fn()
                .mockResolvedValueOnce(undefined)
                .mockResolvedValueOnce({
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'response-cleanup'
                });

            const resultPromise = sendChunkedMessage(
                { data: 'test' },
                { sendMessageFn }
            );

            await new Promise(resolve => setTimeout(resolve, 10));

            const registeredListener =
                mockAddListener.mock.calls[
                    mockAddListener.mock.calls.length - 1
                ][0];

            registeredListener(
                {
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'response-cleanup',
                    chunk: JSON.stringify('done')
                },
                {},
                jest.fn()
            );

            registeredListener(
                {
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'response-cleanup',
                    done: true
                },
                {},
                jest.fn()
            );

            await resultPromise;

            expect(mockRemoveListener).toHaveBeenCalled();
            expect(clearTimeoutSpy).toHaveBeenCalled();
            clearTimeoutSpy.mockRestore();
        });

        test('times out when chunked response never completes', async () => {
            jest.useFakeTimers();

            const sendMessageFn = jest
                .fn()
                .mockResolvedValueOnce(undefined) // chunk
                .mockResolvedValueOnce({
                    // done - indicates chunked response coming
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'timeout-req'
                });

            let caughtError;
            const resultPromise = sendChunkedMessage(
                { data: 'test' },
                { sendMessageFn }
            ).catch(err => {
                caughtError = err;
            });

            // Flush pending promises and advance past the 5-minute timeout
            await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
            await resultPromise;

            expect(caughtError).toBeDefined();
            expect(caughtError.message).toBe(
                'Chunked response timed out for requestId: timeout-req'
            );

            // Listener should be cleaned up even on timeout
            expect(mockRemoveListener).toHaveBeenCalled();

            jest.useRealTimers();
        });
    });

    describe('sendChunkedResponse', () => {
        test('calls sendResponse with chunked flag and requestId', () => {
            const sendMessageFn = jest.fn().mockResolvedValue(undefined);
            const sendResponse = jest.fn();

            const chunkedResponder = sendChunkedResponse({ sendMessageFn });
            chunkedResponder({ data: 'test' }, sendResponse);

            expect(sendResponse).toHaveBeenCalledWith({
                [CHUNKED_MESSAGE_FLAG]: true,
                requestId: 'test-uuid-1234'
            });
        });

        test('sends the response via sendChunkedMessage with correct requestId', async () => {
            const sendMessageFn = jest.fn().mockResolvedValue(undefined);
            const sendResponse = jest.fn();
            const response = { data: 'hello' };

            const chunkedResponder = sendChunkedResponse({ sendMessageFn });
            chunkedResponder(response, sendResponse);

            // Wait for the async sendChunkedMessage to complete
            await new Promise(resolve => setTimeout(resolve, 10));

            // sendMessageFn should have been called for chunk(s) + done
            expect(sendMessageFn).toHaveBeenCalled();
            const calls = sendMessageFn.mock.calls;

            // First chunk should contain the serialized response
            expect(calls[0][0].chunk).toBe(JSON.stringify(response));
            expect(calls[0][0].requestId).toBe('test-uuid-1234');

            // Last call should be done
            expect(calls[calls.length - 1][0].done).toBe(true);
        });

        test('uses default sendMessageFn when none provided', async () => {
            mockSendMessage.mockImplementation((msg, cb) => cb(undefined));
            const sendResponse = jest.fn();

            const chunkedResponder = sendChunkedResponse();
            chunkedResponder({ data: 'test' }, sendResponse);

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(mockSendMessage).toHaveBeenCalled();
        });

        test('uses custom generateRequestId function', () => {
            const sendMessageFn = jest.fn().mockResolvedValue(undefined);
            const generateRequestId = jest.fn().mockReturnValue('custom-uuid');
            const sendResponse = jest.fn();

            const chunkedResponder = sendChunkedResponse({
                sendMessageFn,
                generateRequestId
            });
            chunkedResponder({ data: 'test' }, sendResponse);

            expect(generateRequestId).toHaveBeenCalledTimes(1);
            expect(sendResponse).toHaveBeenCalledWith({
                [CHUNKED_MESSAGE_FLAG]: true,
                requestId: 'custom-uuid'
            });
        });

        test('does not throw on sendChunkedMessage failure', async () => {
            const sendMessageFn = jest
                .fn()
                .mockRejectedValue(new Error('send failed'));
            const sendResponse = jest.fn();

            // Should not throw — .catch() swallows the error
            expect(() => {
                sendChunkedResponse({ sendMessageFn })(
                    { data: 'test' },
                    sendResponse
                );
            }).not.toThrow();

            // Wait for the rejected promise to be caught
            await new Promise(resolve => setTimeout(resolve, 10));

            // sendResponse was still called with the chunked flag
            expect(sendResponse).toHaveBeenCalledWith(
                expect.objectContaining({
                    [CHUNKED_MESSAGE_FLAG]: true
                })
            );
        });
    });

    describe('addOnChunkedMessageListener', () => {
        test('registers listener with chrome.runtime.onMessage', () => {
            const handler = jest.fn();

            addOnChunkedMessageListener(handler);

            expect(mockAddListener).toHaveBeenCalledTimes(1);
            expect(typeof mockAddListener.mock.calls[0][0]).toBe('function');
        });

        test('returns the listener function', () => {
            const handler = jest.fn();

            const listener = addOnChunkedMessageListener(handler);

            expect(typeof listener).toBe('function');
            expect(listener).toBe(mockAddListener.mock.calls[0][0]);
        });
    });

    describe('removeOnChunkedMessageListener', () => {
        test('removes listener from chrome.runtime.onMessage', () => {
            const listener = jest.fn();

            removeOnChunkedMessageListener(listener);

            expect(mockRemoveListener).toHaveBeenCalledWith(listener);
        });
    });

    describe('chunked message handler (internal)', () => {
        let handler;
        let internalListener;
        let sendResponse;

        beforeEach(() => {
            handler = jest.fn();
            sendResponse = jest.fn();
            addOnChunkedMessageListener(handler);
            internalListener =
                mockAddListener.mock.calls[
                    mockAddListener.mock.calls.length - 1
                ][0];
        });

        test('returns false for non-chunked messages', () => {
            const result = internalListener(
                { type: 'NORMAL_MSG' },
                {},
                sendResponse
            );

            expect(result).toBe(false);
            expect(handler).not.toHaveBeenCalled();
        });

        test('returns false for messages without requestId', () => {
            const result = internalListener(
                { [CHUNKED_MESSAGE_FLAG]: true },
                {},
                sendResponse
            );

            expect(result).toBe(false);
        });

        test('returns false for null or undefined request', () => {
            expect(internalListener(null, {}, sendResponse)).toBe(false);
            expect(internalListener(undefined, {}, sendResponse)).toBe(false);
        });

        test('accumulates chunks and responds with PENDING', () => {
            internalListener(
                {
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'req-1',
                    chunk: '{"hello":'
                },
                {},
                sendResponse
            );

            expect(sendResponse).toHaveBeenCalledWith({ status: 'PENDING' });
            expect(handler).not.toHaveBeenCalled();
        });

        test('calls handler with full reconstructed message when done', () => {
            const sender = { tab: { id: 1 } };

            // Send chunk
            internalListener(
                {
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'req-2',
                    chunk: JSON.stringify({ hello: 'world' })
                },
                sender,
                jest.fn()
            );

            // Send done
            internalListener(
                {
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'req-2',
                    done: true
                },
                sender,
                sendResponse
            );

            expect(handler).toHaveBeenCalledWith(
                { hello: 'world' },
                sender,
                sendResponse
            );
        });

        test('reassembles multiple chunks correctly', () => {
            const sender = {};
            const fullMessage = { data: 'chunk1chunk2chunk3' };
            const serialized = JSON.stringify(fullMessage);
            const part1 = serialized.substring(0, 10);
            const part2 = serialized.substring(10, 20);
            const part3 = serialized.substring(20);

            internalListener(
                {
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'req-3',
                    chunk: part1
                },
                sender,
                jest.fn()
            );
            internalListener(
                {
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'req-3',
                    chunk: part2
                },
                sender,
                jest.fn()
            );
            internalListener(
                {
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'req-3',
                    chunk: part3
                },
                sender,
                jest.fn()
            );
            internalListener(
                {
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'req-3',
                    done: true
                },
                sender,
                sendResponse
            );

            expect(handler).toHaveBeenCalledWith(
                fullMessage,
                sender,
                sendResponse
            );
        });

        test('handles multiple concurrent requestIds independently', () => {
            const sender = {};

            // Interleave chunks from two different requests
            internalListener(
                {
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'req-a',
                    chunk: JSON.stringify({ a: 1 })
                },
                sender,
                jest.fn()
            );
            internalListener(
                {
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'req-b',
                    chunk: JSON.stringify({ b: 2 })
                },
                sender,
                jest.fn()
            );

            // Complete req-b first
            internalListener(
                {
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'req-b',
                    done: true
                },
                sender,
                sendResponse
            );
            expect(handler).toHaveBeenCalledWith(
                { b: 2 },
                sender,
                sendResponse
            );

            // Complete req-a
            const sendResponse2 = jest.fn();
            internalListener(
                {
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'req-a',
                    done: true
                },
                sender,
                sendResponse2
            );
            expect(handler).toHaveBeenCalledWith(
                { a: 1 },
                sender,
                sendResponse2
            );
        });

        test('filters by requestIdToMonitor when provided', () => {
            const filteredHandler = jest.fn();
            addOnChunkedMessageListener(filteredHandler, {
                requestIdToMonitor: 'target-req'
            });
            const filteredListener =
                mockAddListener.mock.calls[
                    mockAddListener.mock.calls.length - 1
                ][0];

            // Message with wrong requestId is ignored
            const result = filteredListener(
                {
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'other-req',
                    chunk: '{"test":true}'
                },
                {},
                jest.fn()
            );
            expect(result).toBe(false);
            expect(filteredHandler).not.toHaveBeenCalled();

            // Message with correct requestId is processed
            filteredListener(
                {
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'target-req',
                    chunk: JSON.stringify({ test: true })
                },
                {},
                jest.fn()
            );

            filteredListener(
                {
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'target-req',
                    done: true
                },
                {},
                sendResponse
            );

            expect(filteredHandler).toHaveBeenCalledWith(
                { test: true },
                {},
                sendResponse
            );
        });

        test('cleans up requestsStorage after completing a request', () => {
            const sender = {};

            internalListener(
                {
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'req-cleanup',
                    chunk: JSON.stringify('data')
                },
                sender,
                jest.fn()
            );

            internalListener(
                {
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'req-cleanup',
                    done: true
                },
                sender,
                sendResponse
            );

            // Sending done again with same requestId should throw
            // because requestsStorage['req-cleanup'] was deleted
            expect(() => {
                internalListener(
                    {
                        [CHUNKED_MESSAGE_FLAG]: true,
                        requestId: 'req-cleanup',
                        done: true
                    },
                    sender,
                    jest.fn()
                );
            }).toThrow();
        });

        test('forwards handler return value', () => {
            handler.mockReturnValue(true);

            internalListener(
                {
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'req-ret',
                    chunk: JSON.stringify('data')
                },
                {},
                jest.fn()
            );

            const result = internalListener(
                {
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'req-ret',
                    done: true
                },
                {},
                sendResponse
            );

            // handler returned true (for async sendResponse), so listener should return true
            expect(result).toBe(true);
        });

        test('ignores chunks with undefined chunk property', () => {
            // Send a message without chunk property (just the flag and requestId)
            internalListener(
                {
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'req-no-chunk'
                },
                {},
                sendResponse
            );

            expect(sendResponse).toHaveBeenCalledWith({ status: 'PENDING' });

            // Now send an actual chunk and complete
            internalListener(
                {
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'req-no-chunk',
                    chunk: JSON.stringify({ ok: true })
                },
                {},
                jest.fn()
            );

            internalListener(
                {
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'req-no-chunk',
                    done: true
                },
                {},
                sendResponse
            );

            // Handler should receive only the actual chunk data
            expect(handler).toHaveBeenCalledWith(
                { ok: true },
                {},
                sendResponse
            );
        });

        test('cleans up stale requests when new request starts', () => {
            jest.useFakeTimers();

            // Create a request that will become stale
            internalListener(
                {
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'stale-req',
                    chunk: JSON.stringify('old')
                },
                {},
                jest.fn()
            );

            // Advance time past the stale TTL (10 minutes)
            jest.advanceTimersByTime(10 * 60 * 1000 + 1);

            // Start a new request — this triggers cleanup
            internalListener(
                {
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'fresh-req',
                    chunk: JSON.stringify('new')
                },
                {},
                jest.fn()
            );

            // Complete the stale request — should throw because it was cleaned up
            expect(() => {
                internalListener(
                    {
                        [CHUNKED_MESSAGE_FLAG]: true,
                        requestId: 'stale-req',
                        done: true
                    },
                    {},
                    jest.fn()
                );
            }).toThrow();

            // Complete the fresh request — should work fine
            internalListener(
                {
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'fresh-req',
                    done: true
                },
                {},
                sendResponse
            );

            expect(handler).toHaveBeenCalledWith('new', {}, sendResponse);

            jest.useRealTimers();
        });

        test('does not clean up requests within TTL', () => {
            jest.useFakeTimers();

            // Create a request
            internalListener(
                {
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'not-stale-req',
                    chunk: JSON.stringify('data')
                },
                {},
                jest.fn()
            );

            // Advance time but stay within TTL
            jest.advanceTimersByTime(5 * 60 * 1000);

            // Start another request — triggers cleanup but should not remove the first
            internalListener(
                {
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'another-req',
                    chunk: JSON.stringify('other')
                },
                {},
                jest.fn()
            );

            // Complete the first request — should still work
            internalListener(
                {
                    [CHUNKED_MESSAGE_FLAG]: true,
                    requestId: 'not-stale-req',
                    done: true
                },
                {},
                sendResponse
            );

            expect(handler).toHaveBeenCalledWith('data', {}, sendResponse);

            jest.useRealTimers();
        });
    });
});
