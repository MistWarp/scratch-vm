const {test} = require('node:test');
const assert = require('node:assert');
const Thread = require('../../src/engine/thread');
const ThreadStatus = require('../../src/engine/thread-status');

test('Thread status getters match thread-status', () => {
    assert.deepStrictEqual(ThreadStatus, {
        STATUS_RUNNING: 0,
        STATUS_PROMISE_WAIT: 1,
        STATUS_YIELD: 2,
        STATUS_YIELD_TICK: 3,
        STATUS_DONE: 4
    });
    for (const name of Object.keys(ThreadStatus)) {
        assert.strictEqual(Thread[name], ThreadStatus[name], name);
    }
});
