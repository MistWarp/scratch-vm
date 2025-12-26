const test = require('tap').test;
const execute = require('../../src/engine/execute');
const BlocksExecuteCache = require('../../src/engine/blocks-execute-cache');
const Thread = require('../../src/engine/thread');
const Runtime = require('../../src/engine/runtime');

test('execute retires thread when block not found', t => {
    const runtime = new Runtime();
    const sequencer = runtime.sequencer;

    let retired = false;
    const origRetire = sequencer.retireThread.bind(sequencer);
    sequencer.retireThread = (th) => { retired = true; origRetire(th); };

    const thread = new Thread('top');
    thread.pushStack('missing');

    // Stub cache to return null for both containers
    BlocksExecuteCache.getCached = () => null;

    execute(sequencer, thread);
    t.ok(retired, 'thread retired when block missing');
    t.end();
});

test('execute retires hat thread when predicate false', t => {
    const runtime = new Runtime();
    const sequencer = runtime.sequencer;

    let retired = false;
    const origRetire = sequencer.retireThread.bind(sequencer);
    sequencer.retireThread = (th) => { retired = true; origRetire(th); };

    // Ensure hat detection uses our predictable predicate
    runtime.getIsHat = () => true;
    runtime.getOpcodeFunction = () => (args, util) => false;
    runtime._flowing = {};
    runtime.getIsEdgeActivatedHat = () => false;
    runtime.profiler = null;

    const thread = new Thread('b0');
    thread.target = { id: 't0', blocks: { getNextBlock: () => null }, hasEdgeActivatedValue: () => false, updateEdgeActivatedValue: () => false };
    thread.blockContainer = { forceNoGlow: false };
    thread.pushStack('b0');

    // minimal op cached representing a hat block
    const op = {
        id: 'b0', opcode: 'op_hat', _isHat: true, _blockFunction: runtime.getOpcodeFunction(), _definedBlockFunction: true,
        _argValues: {}, _inputs: {}, _fields: {}, _ops: []
    };
    op._ops = [op];

    BlocksExecuteCache.getCached = () => ({ _ops: [op], _isHat: true, _blockFunction: op._blockFunction });

    execute(sequencer, thread);
    t.ok(retired, 'hat thread retired when predicate false');
    t.end();
});

test('execute visualReport and requestUpdateMonitor on top-level reporter', t => {
    let reported = null;
    let monitorRequested = null;
    const runtime = new Runtime();
    const sequencer = runtime.sequencer;

    runtime.getIsHat = () => false;
    runtime.getOpcodeFunction = () => (args, util) => 123;
    runtime._flowing = {};
    runtime.getIsEdgeActivatedHat = () => false;
    runtime.profiler = null;
    // Override monitorBlocks.getBlock to a simple stub for this test
    runtime.monitorBlocks.getBlock = () => ({ targetId: null });
    runtime.requestUpdateMonitor = (m) => { monitorRequested = m; };
    runtime.visualReport = (id, val) => { reported = {id, val}; };

    const thread = new Thread('b1');
    thread.target = { id: 't1', blocks: { getNextBlock: () => null }, getName: () => 'T' };
    thread.blockContainer = { forceNoGlow: false };
    thread.pushStack('b1');
    thread.topBlock = 'b1';
    thread.updateMonitor = true;
    thread.stackClick = true;

    const op = {
        id: 'b1', opcode: 'op_rep', _isHat: false, _blockFunction: runtime.getOpcodeFunction(), _definedBlockFunction: true,
        _argValues: {}, _inputs: {}, _fields: {}, _ops: []
    };
    op._ops = [op];

    BlocksExecuteCache.getCached = () => ({ _ops: [op], _isHat: false, _blockFunction: op._blockFunction });

    execute(sequencer, thread);

    t.same(reported, { id: 'b1', val: 123 }, 'visualReport called for stackClick');
    t.ok(monitorRequested && monitorRequested.get('value') === 123, 'monitor update requested');
    t.end();
});

test('execute handles promise-returning primitive and resumes', t => {
    t.plan(2);
    const runtime = new Runtime();
    const sequencer = runtime.sequencer;

    runtime.getIsHat = () => false;
    runtime.getOpcodeFunction = () => (args, util) => Promise.resolve(7);
    runtime._flowing = {};
    runtime.getIsEdgeActivatedHat = () => false;
    runtime.profiler = null;
    runtime.monitorBlocks.getBlock = () => ({ targetId: null });
    runtime.requestUpdateMonitor = () => {};

    const thread = new Thread('bp');
    thread.target = { id: 'tp', blocks: { getNextBlock: () => null }, getName: () => 'TP' };
    thread.blockContainer = { forceNoGlow: false };
    thread.pushStack('bp');

    const op = {
        id: 'bp', opcode: 'op_p', _isHat: false, _blockFunction: runtime.getOpcodeFunction(), _definedBlockFunction: true,
        _argValues: {}, _inputs: {}, _fields: {}, _ops: []
    };
    op._ops = [op];

    BlocksExecuteCache.getCached = () => ({ _ops: [op], _isHat: false, _blockFunction: op._blockFunction });

    execute(sequencer, thread);
    t.equal(thread.status, Thread.STATUS_PROMISE_WAIT, 'thread yielded for promise');

    // Wait for promise microtask to resolve and then check status
    setImmediate(() => {
        t.equal(thread.status, Thread.STATUS_RUNNING, 'thread resumed after promise resolved');
        t.end();
    });
});
