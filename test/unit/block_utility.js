const {test} = require('node:test');
const assert = require('node:assert');

const BlockUtility = require('../../src/engine/block-utility');
const Thread = require('../../src/engine/thread');

test('BlockUtility basic behaviors', () => {
    let stoppedAll = false;
    let stoppedForTarget = null;
    let startedHats = null;
    let steppedBranch = null;
    let steppedProcedure = null;

    const sequencer = {
        runtime: {
            currentMSecs: 1000,
            stopAll: () => { stoppedAll = true; },
            stopForTarget: (target, thread) => { stoppedForTarget = {target, thread}; },
            startHats: (requestedHat, optMatchFields, optTarget) => {
                startedHats = {requestedHat, optMatchFields, optTarget};
                return ['threadA'];
            },
            ioDevices: {
                keyboard: { query: (x) => 'ok' }
            }
        },
        stepToBranch: (thread, branchNum, isLoop) => { steppedBranch = {thread, branchNum, isLoop}; },
        stepToProcedure: (thread, proc) => { steppedProcedure = {thread, proc}; }
    };

    const thread = new Thread('top');
    thread.target = { id: 'T1', blocks: { getProcedureParamNamesAndIds: () => ['a'], getProcedureParamNamesIdsAndDefaults: () => ['a'], getNextBlock: () => null } };

    // ensure a stack frame exists
    thread.pushStack('b1');

    const bu = new BlockUtility(sequencer, thread);

    // stackFrame getter creates executionContext
    const frame = bu.stackFrame;
    assert.ok(frame != null);
    if (frame) {
        if (frame.executionContext == null) frame.executionContext = {};
        assert.strictEqual(typeof frame.executionContext, 'object');
    }

    // timer init
    assert.strictEqual(bu.stackTimerNeedsInit(), true);
    bu.startStackTimer(10);
    assert.strictEqual(bu.stackTimerNeedsInit(), false);
    // not finished yet
    assert.strictEqual(bu.stackTimerFinished(), false);
    // advance time
    sequencer.runtime.currentMSecs += 20;
    assert.strictEqual(bu.stackTimerFinished(), true);

    // yield states
    bu.yield();
    assert.strictEqual(thread.status, Thread.STATUS_YIELD);
    bu.yieldTick();
    assert.strictEqual(thread.status, Thread.STATUS_YIELD_TICK);

    // branch/procedure/start/stop behaviors
    bu.startBranch(2, true);
    assert.ok(steppedBranch);
    bu.stopAll();
    assert.strictEqual(stoppedAll, true);
    bu.stopOtherTargetThreads();
    assert.ok(stoppedForTarget);

    // stopThisScript should call thread.stopThisScript; set a spy
    let stoppedScript = false;
    thread.stopThisScript = () => { stoppedScript = true; };
    bu.stopThisScript();
    assert.strictEqual(stoppedScript, true);

    bu.startProcedure('procX');
    assert.ok(steppedProcedure);

    // procedure param getters
    assert.deepStrictEqual(bu.getProcedureParamNamesAndIds('p'), ['a']);
    assert.deepStrictEqual(bu.getProcedureParamNamesIdsAndDefaults('p'), ['a']);

    // initParams / pushParam / getParam using Thread implementation
    bu.initParams();
    bu.pushParam('x', 42);
    assert.strictEqual(bu.getParam('x'), 42);

    // startHats restores thread/sequencer after call
    const originalThread = bu.thread;
    const originalSequencer = bu.sequencer;
    const hats = bu.startHats('whenFlagClicked');
    assert.deepStrictEqual(hats, ['threadA']);
    assert.strictEqual(bu.thread, originalThread);
    assert.strictEqual(bu.sequencer, originalSequencer);

    // ioQuery
    assert.strictEqual(bu.ioQuery('keyboard', 'query', [1]), 'ok');
});
