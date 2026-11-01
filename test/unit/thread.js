const {test} = require('node:test');
const assert = require('node:assert');

const Thread = require('../../src/engine/thread');

test('Thread basic stack and params behavior', () => {
    const thread = new Thread('topBlock');
    const target = {
        id: 'T1',
        blocks: {
            getNextBlock: () => 'nextBlock',
            getBlock: () => ({ opcode: 'not_procedure' })
        },
        runtime: { currentMSecs: 0 }
    };
    thread.target = target;

    // getId
    assert.strictEqual(Thread.getIdFromTargetAndBlock(target, 'b1'), 'T1&b1');
    thread.topBlock = 'topBlock';
    thread.target = target;
    assert.strictEqual(thread.getId(), 'T1&topBlock');

    // pushStack creates a new stack frame
    thread.pushStack('b1');
    assert.strictEqual(thread.peekStack(), 'b1');
    assert.ok(thread.peekStackFrame());

    // reuseStackForNextBlock changes top and resets frame
    thread.reuseStackForNextBlock('b2');
    assert.strictEqual(thread.peekStack(), 'b2');

    // push/pop
    thread.pushStack('b3');
    assert.strictEqual(thread.popStack(), 'b3');

    // reported value
    thread.pushReportedValue('x');
    assert.strictEqual(thread.justReported, 'x');

    // initParams / pushParam / getParam
    thread.pushStack('call');
    thread.initParams();
    thread.pushParam('p', 7);
    assert.strictEqual(thread.getParam('p'), 7);

    // atStackTop
    thread.topBlock = 'call';
    assert.strictEqual(thread.atStackTop(), true);

    // goToNextBlock uses target.blocks.getNextBlock
    thread.goToNextBlock();
    assert.strictEqual(thread.peekStack(), 'nextBlock');

    // stopThisScript should set status to done when stack emptied
    // set blocks to non-procedure and pop until empty
    while (thread.peekStack()) thread.popStack();
    thread.stopThisScript();
    assert.strictEqual(thread.status, Thread.STATUS_DONE);
});
