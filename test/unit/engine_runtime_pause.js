const {test} = require('node:test');
const assert = require('node:assert');
const Runtime = require('../../src/engine/runtime');
const Thread = require('../../src/engine/thread');
const VirtualMachine = require('../../src/virtual-machine');

const addThread = (rt, status, extra = {}) => {
    const thread = new Thread('block');
    thread.status = status;
    Object.assign(thread, extra);
    thread.pushStack('block');
    rt.threads.push(thread);
    return thread;
};

test('setPaused holds threads and restores their status', () => {
    const rt = new Runtime();
    const events = [];
    rt.on('RUNTIME_PAUSED', () => events.push('paused'));
    rt.on('RUNTIME_UNPAUSED', () => events.push('unpaused'));
    const running = addThread(rt, Thread.STATUS_RUNNING);
    const yielded = addThread(rt, Thread.STATUS_YIELD_TICK);
    const monitor = addThread(rt, Thread.STATUS_RUNNING, {updateMonitor: true});

    rt.setPaused(true);
    rt.setPaused(true);
    assert.strictEqual(rt.isPaused(), true);
    assert.strictEqual(running.status, Thread.STATUS_PROMISE_WAIT);
    assert.strictEqual(yielded.status, Thread.STATUS_PROMISE_WAIT);
    assert.strictEqual(monitor.status, Thread.STATUS_RUNNING);
    assert.deepStrictEqual(rt.getPausedThreadState(running).status, Thread.STATUS_RUNNING);
    assert.strictEqual(rt.getPausedThreadState(monitor), null);
    assert.strictEqual(rt.ioDevices.clock._paused, true);

    rt.setPaused(false);
    assert.strictEqual(rt.isPaused(), false);
    assert.strictEqual(running.status, Thread.STATUS_RUNNING);
    assert.strictEqual(yielded.status, Thread.STATUS_YIELD_TICK);
    assert.strictEqual(rt.getPausedThreadState(running), null);
    assert.strictEqual(rt.ioDevices.clock._paused, false);
    assert.deepStrictEqual(events, ['paused', 'unpaused']);
});

test('a held thread whose promise settles stays held until unpaused', () => {
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
    assert.strictEqual(stepped, Thread.STATUS_PROMISE_WAIT);
    rt.setPaused(false);
    assert.strictEqual(waiting.status, Thread.STATUS_RUNNING);
});

test('a held thread whose promise settles just before unpausing keeps running', () => {
    const rt = new Runtime();
    const waiting = addThread(rt, Thread.STATUS_PROMISE_WAIT);
    rt.setPaused(true);
    waiting.status = Thread.STATUS_RUNNING;
    rt.setPaused(false);
    assert.strictEqual(waiting.status, Thread.STATUS_RUNNING);
});

test('unpausing moves thread timers forward by the paused time', () => {
    const rt = new Runtime();
    const thread = addThread(rt, Thread.STATUS_RUNNING);
    thread.timer = {startTime: 100};
    thread.peekStackFrame().executionContext = {timer: {startTime: 50}};
    rt.currentMSecs = 1000;
    rt.setPaused(true);
    rt.currentMSecs = 1600;
    rt.setPaused(false);
    assert.strictEqual(thread.timer.startTime, 700);
    assert.strictEqual(thread.peekStackFrame().executionContext.timer.startTime, 650);
});

test('held threads do not count as running', () => {
    const rt = new Runtime();
    const thread = addThread(rt, Thread.STATUS_RUNNING);
    addThread(rt, Thread.STATUS_RUNNING, {updateMonitor: true});
    assert.strictEqual(rt._getMonitorThreadCount(rt.threads), 1);
    rt.setPaused(true);
    assert.strictEqual(rt._getMonitorThreadCount(rt.threads), 2);
    const later = addThread(rt, Thread.STATUS_RUNNING);
    assert.strictEqual(rt._getMonitorThreadCount(rt.threads), 2);
    rt.pauseThread(later);
    assert.strictEqual(rt._getMonitorThreadCount(rt.threads), 3);
    assert.strictEqual(rt.getPausedThreadState(thread).status, Thread.STATUS_RUNNING);
});

test('while paused only broadcasts, clones and edge-activated hats start', () => {
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
        assert.deepStrictEqual(rt.startHats(opcode), [], opcode);
    }
    assert.deepStrictEqual(started, ['event_whenbroadcastreceived', 'control_start_as_clone', 'test_whenEdge']);
    rt.setPaused(false);
    rt.startHats('event_whenkeypressed');
    assert.strictEqual(started[started.length - 1], 'event_whenkeypressed');
});

test('the step does not start edge-activated hats while paused', () => {
    const rt = new Runtime();
    const started = [];
    rt._hats = {test_whenEdge: {edgeActivated: true}};
    rt.startHats = opcode => started.push(opcode);
    rt._step();
    rt.setPaused(true);
    rt._step();
    assert.deepStrictEqual(started, ['test_whenEdge']);
});

test('stopping everything and the green flag unpause', () => {
    const rt = new Runtime();
    rt.setPaused(true);
    rt.stopAll();
    assert.strictEqual(rt.isPaused(), false);
    rt.setPaused(true);
    rt.greenFlag();
    assert.strictEqual(rt.isPaused(), false);
});

test('the VM exposes and forwards pausing', () => {
    const vm = new VirtualMachine();
    const events = [];
    vm.on('RUNTIME_PAUSED', () => events.push('paused'));
    vm.on('RUNTIME_UNPAUSED', () => events.push('unpaused'));
    vm.setPaused(true);
    assert.strictEqual(vm.isPaused(), true);
    assert.strictEqual(vm.runtime.isPaused(), true);
    vm.setPaused(false);
    assert.strictEqual(vm.isPaused(), false);
    assert.deepStrictEqual(events, ['paused', 'unpaused']);
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
    test(`broadcasts while paused start held threads, compiled ${compiled}`, async () => {
        const vm = new VirtualMachine();
        vm.setCompilerOptions({enabled: compiled});
        await vm.loadProject(broadcastProject());
        const rt = vm.runtime;
        const value = name => Number(rt.getTargetForStage().variables[name].value);
        const broadcast = message => rt.startHats('event_whenbroadcastreceived', {BROADCAST_OPTION: message});

        broadcast('go');
        rt._step();
        rt._step();
        assert.ok(value('a') > 0);

        rt.setPaused(true);
        const before = value('a');
        const [restarted] = broadcast('go');
        const [started] = broadcast('other');
        assert.ok(restarted, 'the go receiver restarts');
        assert.ok(started, 'the other receiver starts');
        assert.notStrictEqual(rt.getPausedThreadState(restarted), null, 'a restarted held thread stays held');
        assert.notStrictEqual(rt.getPausedThreadState(started), null, 'a newly started thread is held');
        for (let i = 0; i < 3; i++) rt._step();
        assert.strictEqual(value('a'), before);
        assert.strictEqual(value('b'), 0);
        assert.strictEqual(rt.isPaused(), true);

        rt.setPaused(false);
        rt._step();
        rt._step();
        assert.ok(value('a') > 0);
        assert.ok(value('b') > 0, 'unpausing runs the threads started while paused');
        vm.quit();
    });
}

test('stack clicks still run while paused', () => {
    const rt = new Runtime();
    rt.setPaused(true);
    const thread = new Thread('block');
    thread.stackClick = true;
    rt.threads.push(thread);
    assert.strictEqual(rt.getPausedThreadState(thread), null);
});

test('startHats reports the hats it started', async () => {
    const vm = new VirtualMachine();
    await vm.loadProject(broadcastProject());
    const reports = [];
    vm.runtime.on('HATS_STARTED', (opcode, fields, threads) => reports.push([opcode, fields, threads.length]));
    vm.runtime.startHats('event_whenbroadcastreceived', {BROADCAST_OPTION: 'go'});
    vm.runtime.startHats('event_whenbroadcastreceived', {BROADCAST_OPTION: 'nobody'});
    assert.deepStrictEqual(reports, [
        ['event_whenbroadcastreceived', {BROADCAST_OPTION: 'go'}, 1],
        ['event_whenbroadcastreceived', {BROADCAST_OPTION: 'nobody'}, 0]
    ]);
    vm.quit();
});

test('making a clone past the limit reports it', async () => {
    const vm = new VirtualMachine();
    await vm.loadProject(broadcastProject());
    const sprite = vm.runtime.targets.find(target => !target.isStage);
    const refused = [];
    vm.runtime.on('CLONE_LIMIT_REACHED', target => refused.push(target));
    vm.runtime.clonesAvailable = () => false;
    assert.strictEqual(sprite.makeClone(), null);
    assert.strictEqual(vm.runtime.getTargetForStage().makeClone(), null);
    assert.deepStrictEqual(refused, [sprite]);
    vm.quit();
});
