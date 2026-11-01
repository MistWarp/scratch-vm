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

test('a held thread whose promise settles just before unpausing keeps running', t => {
    const rt = new Runtime();
    const waiting = addThread(rt, Thread.STATUS_PROMISE_WAIT);
    rt.setPaused(true);
    waiting.status = Thread.STATUS_RUNNING;
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

const broadcastProject = () => {
    const costume = {name: 'c',
        assetId: 'cd21514d0531fdffb22204e0ec5ed84a',
        md5ext: 'cd21514d0531fdffb22204e0ec5ed84a.svg',
        dataFormat: 'svg',
        rotationCenterX: 0,
        rotationCenterY: 0};
    const block = (opcode, extra) => Object.assign({opcode,
        next: null,
        parent: null,
        inputs: {},
        fields: {},
        shadow: false,
        topLevel: false}, extra);
    const receiver = (id, message, variable) => ({
        [`${id}hat`]: block('event_whenbroadcastreceived', {next: `${id}loop`,
            topLevel: true,
            x: 0,
            y: 0,
            fields: {BROADCAST_OPTION: [message, `${message}-id`]}}),
        [`${id}loop`]: block('control_forever', {parent: `${id}hat`, inputs: {SUBSTACK: [2, `${id}inc`]}}),
        [`${id}inc`]: block('data_changevariableby', {parent: `${id}loop`,
            inputs: {VALUE: [1, [4, '1']]},
            fields: {VARIABLE: [variable, variable]}})
    });
    return {
        targets: [
            {isStage: true,
                name: 'Stage',
                variables: {a: ['a', 0], b: ['b', 0]},
                lists: {},
                broadcasts: {'go-id': 'go', 'other-id': 'other'},
                blocks: {},
                comments: {},
                currentCostume: 0,
                costumes: [costume],
                sounds: [],
                volume: 100,
                layerOrder: 0},
            {isStage: false,
                name: 'Sprite1',
                variables: {},
                lists: {},
                broadcasts: {},
                blocks: Object.assign(receiver('go', 'go', 'a'), receiver('other', 'other', 'b')),
                comments: {},
                currentCostume: 0,
                costumes: [costume],
                sounds: [],
                volume: 100,
                layerOrder: 1,
                visible: true,
                x: 0,
                y: 0,
                size: 100,
                direction: 90,
                draggable: false,
                rotationStyle: 'all around'}
        ],
        monitors: [],
        extensions: [],
        meta: {semver: '3.0.0'}
    };
};

for (const compiled of [false, true]) {
    test(`broadcasts while paused start held threads, compiled ${compiled}`, async t => {
        const vm = new VirtualMachine();
        vm.setCompilerOptions({enabled: compiled});
        await vm.loadProject(broadcastProject());
        const rt = vm.runtime;
        const value = name => Number(rt.getTargetForStage().variables[name].value);
        const broadcast = message => rt.startHats('event_whenbroadcastreceived', {BROADCAST_OPTION: message});

        broadcast('go');
        rt._step();
        rt._step();
        t.ok(value('a') > 0);

        rt.setPaused(true);
        const before = value('a');
        const [restarted] = broadcast('go');
        const [started] = broadcast('other');
        t.ok(restarted, 'the go receiver restarts');
        t.ok(started, 'the other receiver starts');
        t.not(rt.getPausedThreadState(restarted), null, 'a restarted held thread stays held');
        t.not(rt.getPausedThreadState(started), null, 'a newly started thread is held');
        for (let i = 0; i < 3; i++) rt._step();
        t.equal(value('a'), before);
        t.equal(value('b'), 0);
        t.equal(rt.isPaused(), true);

        rt.setPaused(false);
        rt._step();
        rt._step();
        t.ok(value('a') > 0);
        t.ok(value('b') > 0, 'unpausing runs the threads started while paused');
        vm.quit();
        t.end();
    });
}

test('stack clicks still run while paused', t => {
    const rt = new Runtime();
    rt.setPaused(true);
    const thread = new Thread('block');
    thread.stackClick = true;
    rt.threads.push(thread);
    t.equal(rt.getPausedThreadState(thread), null);
    t.end();
});

test('startHats reports the hats it started', async t => {
    const vm = new VirtualMachine();
    await vm.loadProject(broadcastProject());
    const reports = [];
    vm.runtime.on('HATS_STARTED', (opcode, fields, threads) => reports.push([opcode, fields, threads.length]));
    vm.runtime.startHats('event_whenbroadcastreceived', {BROADCAST_OPTION: 'go'});
    vm.runtime.startHats('event_whenbroadcastreceived', {BROADCAST_OPTION: 'nobody'});
    t.same(reports, [
        ['event_whenbroadcastreceived', {BROADCAST_OPTION: 'go'}, 1],
        ['event_whenbroadcastreceived', {BROADCAST_OPTION: 'nobody'}, 0]
    ]);
    vm.quit();
    t.end();
});

test('making a clone past the limit reports it', async t => {
    const vm = new VirtualMachine();
    await vm.loadProject(broadcastProject());
    const sprite = vm.runtime.targets.find(target => !target.isStage);
    const refused = [];
    vm.runtime.on('CLONE_LIMIT_REACHED', target => refused.push(target));
    vm.runtime.clonesAvailable = () => false;
    t.equal(sprite.makeClone(), null);
    t.equal(vm.runtime.getTargetForStage().makeClone(), null);
    t.same(refused, [sprite]);
    vm.quit();
    t.end();
});
