const tap = require('tap');
const Runtime = require('../../src/engine/runtime');
const Thread = require('../../src/engine/thread');
const VirtualMachine = require('../../src/virtual-machine');

const test = tap.test;

const addThread = (rt, status, extra = {}) => {
    const thread = new Thread('block');
    thread.status = status;
    Object.assign(thread, extra);
    thread.pushStack('block');
    rt.threads.push(thread);
    return thread;
};

test('setPaused holds threads and restores their status', t => {
    const rt = new Runtime();
    const events = [];
    rt.on('RUNTIME_PAUSED', () => events.push('paused'));
    rt.on('RUNTIME_UNPAUSED', () => events.push('unpaused'));
    const running = addThread(rt, Thread.STATUS_RUNNING);
    const yielded = addThread(rt, Thread.STATUS_YIELD_TICK);
    const monitor = addThread(rt, Thread.STATUS_RUNNING, {updateMonitor: true});

    rt.setPaused(true);
    rt.setPaused(true);
    t.equal(rt.isPaused(), true);
    t.equal(running.status, Thread.STATUS_PROMISE_WAIT);
    t.equal(yielded.status, Thread.STATUS_PROMISE_WAIT);
    t.equal(monitor.status, Thread.STATUS_RUNNING);
    t.same(rt.getPausedThreadState(running).status, Thread.STATUS_RUNNING);
    t.equal(rt.getPausedThreadState(monitor), null);
    t.equal(rt.ioDevices.clock._paused, true);

    rt.setPaused(false);
    t.equal(rt.isPaused(), false);
    t.equal(running.status, Thread.STATUS_RUNNING);
    t.equal(yielded.status, Thread.STATUS_YIELD_TICK);
    t.equal(rt.getPausedThreadState(running), null);
    t.equal(rt.ioDevices.clock._paused, false);
    t.same(events, ['paused', 'unpaused']);
    t.end();
});

test('a held thread whose promise settles stays held until unpaused', t => {
    const rt = new Runtime();
    const waiting = addThread(rt, Thread.STATUS_PROMISE_WAIT);
    rt.setPaused(true);
    waiting.status = Thread.STATUS_RUNNING;
    let stepped = null;
    rt.sequencer.stepThreads = () => {
        stepped = waiting.status;
        return [];
    };
    rt._step();
    t.equal(stepped, Thread.STATUS_PROMISE_WAIT);
    rt.setPaused(false);
    t.equal(waiting.status, Thread.STATUS_RUNNING);
    t.end();
});

test('unpausing moves thread timers forward by the paused time', t => {
    const rt = new Runtime();
    const thread = addThread(rt, Thread.STATUS_RUNNING);
    thread.timer = {startTime: 100};
    thread.peekStackFrame().executionContext = {timer: {startTime: 50}};
    rt.currentMSecs = 1000;
    rt.setPaused(true);
    rt.currentMSecs = 1600;
    rt.setPaused(false);
    t.equal(thread.timer.startTime, 700);
    t.equal(thread.peekStackFrame().executionContext.timer.startTime, 650);
    t.end();
});

test('held threads do not count as running', t => {
    const rt = new Runtime();
    const thread = addThread(rt, Thread.STATUS_RUNNING);
    addThread(rt, Thread.STATUS_RUNNING, {updateMonitor: true});
    t.equal(rt._getMonitorThreadCount(rt.threads), 1);
    rt.setPaused(true);
    t.equal(rt._getMonitorThreadCount(rt.threads), 2);
    const later = addThread(rt, Thread.STATUS_RUNNING);
    t.equal(rt._getMonitorThreadCount(rt.threads), 2);
    rt.pauseThread(later);
    t.equal(rt._getMonitorThreadCount(rt.threads), 3);
    t.equal(rt.getPausedThreadState(thread).status, Thread.STATUS_RUNNING);
    t.end();
});

test('while paused only broadcasts, clones and edge-activated hats start', t => {
    const rt = new Runtime();
    const started = [];
    rt._hats = {
        event_whenkeypressed: {},
        event_whenbroadcastreceived: {},
        control_start_as_clone: {},
        test_whenEdge: {edgeActivated: true}
    };
    rt.allScriptsByOpcodeDo = opcode => started.push(opcode);
    rt.setPaused(true);
    for (const opcode of Object.keys(rt._hats)) {
        t.same(rt.startHats(opcode), [], opcode);
    }
    t.same(started, ['event_whenbroadcastreceived', 'control_start_as_clone', 'test_whenEdge']);
    rt.setPaused(false);
    rt.startHats('event_whenkeypressed');
    t.equal(started[started.length - 1], 'event_whenkeypressed');
    t.end();
});

test('the step does not start edge-activated hats while paused', t => {
    const rt = new Runtime();
    const started = [];
    rt._hats = {test_whenEdge: {edgeActivated: true}};
    rt.startHats = opcode => started.push(opcode);
    rt._step();
    rt.setPaused(true);
    rt._step();
    t.same(started, ['test_whenEdge']);
    t.end();
});

test('stopping everything and the green flag unpause', t => {
    const rt = new Runtime();
    rt.setPaused(true);
    rt.stopAll();
    t.equal(rt.isPaused(), false);
    rt.setPaused(true);
    rt.greenFlag();
    t.equal(rt.isPaused(), false);
    t.end();
});

test('the VM exposes and forwards pausing', t => {
    const vm = new VirtualMachine();
    const events = [];
    vm.on('RUNTIME_PAUSED', () => events.push('paused'));
    vm.on('RUNTIME_UNPAUSED', () => events.push('unpaused'));
    vm.setPaused(true);
    t.equal(vm.isPaused(), true);
    t.equal(vm.runtime.isPaused(), true);
    vm.setPaused(false);
    t.equal(vm.isPaused(), false);
    t.same(events, ['paused', 'unpaused']);
    t.end();
});
