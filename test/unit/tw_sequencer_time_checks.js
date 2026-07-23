const test = require('tap').test;
const Runtime = require('../../src/engine/runtime');
const Sequencer = require('../../src/engine/sequencer');
const Thread = require('../../src/engine/thread');

const makeSequencer = stepCost => {
    const runtime = new Runtime();
    runtime.currentStepTime = 1000 / 30;
    const sequencer = new Sequencer(runtime);
    let now = 0;
    sequencer.timer.nowObj = {now: () => now};
    let steps = 0;
    sequencer.stepThread = () => {
        steps++;
        now += stepCost;
    };
    const thread = new Thread('fake');
    thread.status = Thread.STATUS_RUNNING;
    thread.stack = ['fake'];
    thread.pushStack = () => {};
    runtime.threads = [thread];
    return {
        runtime,
        sequencer,
        getSteps: () => steps,
        getNow: () => now,
        setNow: value => {
            now = value;
        }
    };
};

const WORK_TIME = 0.75 * (1000 / 30);

test('cheap thread steps still stop at the work time budget', t => {
    const {sequencer, getSteps, getNow} = makeSequencer(0.001);
    sequencer.stepThreads();
    t.ok(getNow() >= WORK_TIME, 'ran until the budget was spent');
    t.ok(getNow() < WORK_TIME + 1, `did not overrun the budget (took ${getNow().toFixed(3)}ms)`);
    t.ok(getSteps() > 1000, `amortized clock reads let many steps run (${getSteps()})`);
    t.end();
});

test('expensive thread steps do not overrun the budget', t => {
    const stepCost = 7;
    const {sequencer, getSteps, getNow} = makeSequencer(stepCost);
    sequencer.stepThreads();
    t.ok(getNow() >= WORK_TIME, 'ran until the budget was spent');
    t.ok(getNow() <= WORK_TIME + stepCost, `overran by at most one step (took ${getNow()}ms)`);
    t.equal(getSteps(), Math.ceil(WORK_TIME / stepCost), 'checked the clock after every expensive step');
    t.end();
});

test('a redraw request still ends the tick immediately in non-turbo mode', t => {
    const {runtime, sequencer, getSteps} = makeSequencer(0.001);
    runtime.turboMode = false;
    const originalStepThread = sequencer.stepThread;
    sequencer.stepThread = thread => {
        originalStepThread(thread);
        runtime.redrawRequested = true;
    };
    sequencer.stepThreads();
    t.equal(getSteps(), 1, 'stopped after the iteration that requested a redraw');
    t.end();
});
