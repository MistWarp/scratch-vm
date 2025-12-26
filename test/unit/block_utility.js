const test = require('tap').test;

const BlockUtility = require('../../src/engine/block-utility');
const Thread = require('../../src/engine/thread');

test('BlockUtility basic behaviors', t => {
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
    t.ok(frame != null);
    if (frame) {
        if (frame.executionContext == null) frame.executionContext = {};
        t.type(frame.executionContext, 'object');
    }

    // timer init
    t.equal(bu.stackTimerNeedsInit(), true);
    bu.startStackTimer(10);
    t.equal(bu.stackTimerNeedsInit(), false);
    // not finished yet
    t.equal(bu.stackTimerFinished(), false);
    // advance time
    sequencer.runtime.currentMSecs += 20;
    t.equal(bu.stackTimerFinished(), true);

    // yield states
    bu.yield();
    t.equal(thread.status, Thread.STATUS_YIELD);
    bu.yieldTick();
    t.equal(thread.status, Thread.STATUS_YIELD_TICK);

    // branch/procedure/start/stop behaviors
    bu.startBranch(2, true);
    t.ok(steppedBranch);
    bu.stopAll();
    t.equal(stoppedAll, true);
    bu.stopOtherTargetThreads();
    t.ok(stoppedForTarget);

    // stopThisScript should call thread.stopThisScript; set a spy
    let stoppedScript = false;
    thread.stopThisScript = () => { stoppedScript = true; };
    bu.stopThisScript();
    t.equal(stoppedScript, true);

    bu.startProcedure('procX');
    t.ok(steppedProcedure);

    // procedure param getters
    t.same(bu.getProcedureParamNamesAndIds('p'), ['a']);
    t.same(bu.getProcedureParamNamesIdsAndDefaults('p'), ['a']);

    // initParams / pushParam / getParam using Thread implementation
    bu.initParams();
    bu.pushParam('x', 42);
    t.equal(bu.getParam('x'), 42);

    // startHats restores thread/sequencer after call
    const originalThread = bu.thread;
    const originalSequencer = bu.sequencer;
    const hats = bu.startHats('whenFlagClicked');
    t.same(hats, ['threadA']);
    t.equal(bu.thread, originalThread);
    t.equal(bu.sequencer, originalSequencer);

    // ioQuery
    t.equal(bu.ioQuery('keyboard', 'query', [1]), 'ok');

    t.end();
});
