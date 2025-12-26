const test = require('tap').test;

const Thread = require('../../src/engine/thread');

test('Thread basic stack and params behavior', t => {
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
    t.equal(Thread.getIdFromTargetAndBlock(target, 'b1'), 'T1&b1');
    thread.topBlock = 'topBlock';
    thread.target = target;
    t.equal(thread.getId(), 'T1&topBlock');

    // pushStack creates a new stack frame
    thread.pushStack('b1');
    t.equal(thread.peekStack(), 'b1');
    t.ok(thread.peekStackFrame());

    // reuseStackForNextBlock changes top and resets frame
    thread.reuseStackForNextBlock('b2');
    t.equal(thread.peekStack(), 'b2');

    // push/pop
    thread.pushStack('b3');
    t.equal(thread.popStack(), 'b3');

    // reported value
    thread.pushReportedValue('x');
    t.equal(thread.justReported, 'x');

    // initParams / pushParam / getParam
    thread.pushStack('call');
    thread.initParams();
    thread.pushParam('p', 7);
    t.equal(thread.getParam('p'), 7);

    // atStackTop
    thread.topBlock = 'call';
    t.equal(thread.atStackTop(), true);

    // goToNextBlock uses target.blocks.getNextBlock
    thread.goToNextBlock();
    t.equal(thread.peekStack(), 'nextBlock');

    // stopThisScript should set status to done when stack emptied
    // set blocks to non-procedure and pop until empty
    while (thread.peekStack()) thread.popStack();
    thread.stopThisScript();
    t.equal(thread.status, Thread.STATUS_DONE);

    t.end();
});
