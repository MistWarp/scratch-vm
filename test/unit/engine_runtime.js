const {test} = require('node:test');
const assert = require('node:assert');
const path = require('path');
const readFileToBuffer = require('../fixtures/readProjectFile').readFileToBuffer;
const VirtualMachine = require('../../src/virtual-machine');
const Runtime = require('../../src/engine/runtime');
const MonitorRecord = require('../../src/engine/monitor-record');

test('spec', () => {
    const r = new Runtime();

    assert.strictEqual(typeof Runtime, 'function');
    assert.strictEqual(typeof r, 'object');

    // Test types of cloud data managing functions
    assert.strictEqual(typeof r.hasCloudData, 'function');
    assert.strictEqual(typeof r.canAddCloudVariable, 'function');
    assert.strictEqual(typeof r.addCloudVariable, 'function');
    assert.strictEqual(typeof r.removeCloudVariable, 'function');

    assert.ok(r instanceof Runtime);
});

test('monitorStateEquals', () => {
    const r = new Runtime();
    const id = 'xklj4#!';
    const prevMonitorState = new MonitorRecord({
        id,
        opcode: 'turtle whereabouts',
        value: '25'
    });
    const newMonitorDelta = {
        id,
        value: String(25)
    };
    r.requestAddMonitor(prevMonitorState);
    r.requestUpdateMonitor(newMonitorDelta);

    assert.strictEqual(true, prevMonitorState === r._monitorState.get(id));
    assert.strictEqual(String(25), r._monitorState.get(id).get('value'));
});

test('monitorStateDoesNotEqual', () => {
    const r = new Runtime();
    const id = 'xklj4#!';
    const params = {seven: 7};
    const prevMonitorState = new MonitorRecord({
        id,
        opcode: 'turtle whereabouts',
        value: '25'
    });

    // Value change
    let newMonitorDelta = {
        id,
        value: String(24)
    };
    r.requestAddMonitor(prevMonitorState);
    r.requestUpdateMonitor(newMonitorDelta);

    assert.strictEqual(true, r._monitorState.dirty);
    assert.strictEqual(String(24), r._monitorState.get(id).get('value'));

    // Prop change
    r._monitorState.dirty = false;
    newMonitorDelta = {
        id: 'xklj4#!',
        params: params
    };
    r.requestUpdateMonitor(newMonitorDelta);

    assert.strictEqual(true, r._monitorState.dirty);
    assert.strictEqual(String(24), r._monitorState.get(id).value);
    assert.strictEqual(params, r._monitorState.get(id).params);
});

test('getLabelForOpcode', () => {
    const r = new Runtime();

    const fakeExtension = {
        id: 'fakeExtension',
        name: 'Fake Extension',
        blocks: [
            {
                info: {
                    opcode: 'foo',
                    json: {},
                    text: 'Foo',
                    xml: ''
                }
            },
            {
                info: {
                    opcode: 'foo_2',
                    json: {},
                    text: 'Foo 2',
                    xml: ''
                }
            }
        ]
    };

    r._blockInfo.push(fakeExtension);

    const result1 = r.getLabelForOpcode('fakeExtension_foo');
    assert.strictEqual(typeof result1.category, 'string');
    assert.strictEqual(typeof result1.label, 'string');
    assert.strictEqual(result1.label, 'Fake Extension: Foo');

    const result2 = r.getLabelForOpcode('fakeExtension_foo_2');
    assert.strictEqual(typeof result2.category, 'string');
    assert.strictEqual(typeof result2.label, 'string');
    assert.strictEqual(result2.label, 'Fake Extension: Foo 2');
});

test('Project loaded emits runtime event', async () => {
    const vm = new VirtualMachine();
    const projectUri = path.resolve(__dirname, '../fixtures/default.sb2');
    const project = readFileToBuffer(projectUri);
    let projectLoaded = false;

    vm.runtime.addListener('PROJECT_LOADED', () => {
        projectLoaded = true;
    });

    await vm.loadProject(project);
    assert.strictEqual(projectLoaded, true, 'Project load event emitted');
});

test('Cloud variable limit allows only 10 cloud variables', () => {
    // This is a test of just the cloud variable limit mechanism
    // The functions being tested below need to be used when
    // creating and deleting cloud variables in the runtime.

    const rt = new Runtime();

    assert.strictEqual(rt.hasCloudData(), false);

    for (let i = 0; i < 10; i++) {
        assert.strictEqual(rt.canAddCloudVariable(), true);
        rt.addCloudVariable();
        // Adding a cloud variable should change the
        // result of the hasCloudData check
        assert.strictEqual(rt.hasCloudData(), true);
    }


    // We should be at the cloud variable limit now
    assert.strictEqual(rt.canAddCloudVariable(), false);

    // Removing a cloud variable should allow the addition of exactly one more
    // when we are at the cloud variable limit
    rt.removeCloudVariable();

    assert.strictEqual(rt.canAddCloudVariable(), true);
    rt.addCloudVariable();
    assert.strictEqual(rt.canAddCloudVariable(), false);

    // Disposing of the runtime should reset the cloud variable limitations
    rt.dispose();
    assert.strictEqual(rt.hasCloudData(), false);

    for (let i = 0; i < 10; i++) {
        assert.strictEqual(rt.canAddCloudVariable(), true);
        rt.addCloudVariable();
        assert.strictEqual(rt.hasCloudData(), true);
    }

    // We should be at the cloud variable limit now
    assert.strictEqual(rt.canAddCloudVariable(), false);

});

test('Starting the runtime emits an event', () => {
    let started = false;
    const rt = new Runtime();
    rt.addListener('RUNTIME_STARTED', () => {
        started = true;
    });
    rt.start();
    assert.strictEqual(started, true);
    rt.quit();
});

test('Runtime cannot be started while already running', () => {
    const rt = new Runtime();
    rt.start(); // Start the first time

    // Set up a flag/listener to check if it can be started again
    let started = false;
    rt.addListener('RUNTIME_STARTED', () => {
        started = true;
    });

    // Starting again should not emit another event
    rt.start();
    assert.strictEqual(started, false);
    rt.quit();
});

test('setCompatibilityMode restarts if it was already running', () => {
    const rt = new Runtime();
    rt.start(); // Start the first time

    // Set up a flag/listener to check if it gets started again
    let started = false;
    rt.addListener('RUNTIME_STARTED', () => {
        started = true;
    });

    rt.setCompatibilityMode(true);
    // TW: We make an intentional API change here. Changing compatibility mode won't emit a RUNTIME_STARTED
    // if the runtime is already running.
    assert.strictEqual(started, false);
    rt.quit();
});

test('setCompatibilityMode does not restart if it was not running', () => {
    const rt = new Runtime();

    let started = false;
    rt.addListener('RUNTIME_STARTED', () => {
        started = true;
    });

    rt.setCompatibilityMode(true);
    assert.strictEqual(started, false);
});

test('Disposing the runtime emits an event', () => {
    let disposed = false;
    const rt = new Runtime();
    rt.addListener('RUNTIME_DISPOSED', () => {
        disposed = true;
    });
    rt.dispose();
    assert.strictEqual(disposed, true);
});

test('Clock is reset on runtime dispose', () => {
    const rt = new Runtime();
    const c = rt.ioDevices.clock;
    let simulatedTime = 0;

    c._projectTimer = {
        timeElapsed: () => simulatedTime,
        start: () => {
            simulatedTime = 0;
        }
    };

    assert.ok(c.projectTimer() === 0);
    simulatedTime += 1000;
    assert.ok(c.projectTimer() === 1);
    rt.dispose();
    // When the runtime is disposed, the clock should be reset
    assert.ok(c.projectTimer() === 0);
});

test('handleExtensionButtonPress ignores unknown buttons', () => {
    const rt = new Runtime();
    assert.doesNotThrow(() => rt.handleExtensionButtonPress('test_missing'));
    let pressed = 0;
    rt.extensionButtons.set('test_button', () => {
        pressed++;
    });
    rt.handleExtensionButtonPress('test_button');
    assert.strictEqual(pressed, 1);
});

const makeHatRuntime = fieldValue => {
    const rt = new Runtime();
    rt._hats.test_whenNamed = {restartExistingThreads: false};
    const target = {id: 'target'};
    rt.allScriptsByOpcodeDo = (opcode, f) => {
        f({blockId: 'hat', fieldsOfInputs: {NAME: {value: fieldValue}}}, target);
    };
    rt._pushThread = () => ({isCompiled: true, executableHat: false});
    return rt;
};

test('startHats matches without changing the caller match fields', () => {
    const rt = makeHatRuntime('HELLO');
    const fields = {NAME: 'hello'};
    assert.strictEqual(rt.startHats('test_whenNamed', fields).length, 1);
    assert.deepStrictEqual(fields, {NAME: 'hello'});
});

test('startHats accepts match values that are not strings', () => {
    const rt = makeHatRuntime('12');
    assert.strictEqual(rt.startHats('test_whenNamed', {NAME: 12}).length, 1);
    assert.strictEqual(rt.startHats('test_whenNamed', {NAME: 13}).length, 0);
});

test('setStageSize keeps auto-positioned monitors auto-positioned', () => {
    const rt = new Runtime();
    rt.requestAddMonitor(new MonitorRecord({id: 'auto'}));
    rt.requestAddMonitor(new MonitorRecord({id: 'placed', x: 10, y: 20}));
    rt.setStageSize(560, 420);
    assert.strictEqual(rt._monitorState.get('auto').get('x'), null);
    assert.strictEqual(rt._monitorState.get('auto').get('y'), null);
    assert.strictEqual(rt._monitorState.get('placed').get('x'), 50);
    assert.strictEqual(rt._monitorState.get('placed').get('y'), 50);
});

test('getBlocksJSON leaves out entries without JSON', () => {
    const rt = new Runtime();
    rt._blockInfo = [{
        blocks: [
            {json: {type: 'test_a'}},
            {xml: '<sep gap="36"/>'},
            {json: null, xml: '<label text="x"></label>'},
            {json: {type: 'test_b'}}
        ]
    }];
    assert.deepStrictEqual(rt.getBlocksJSON(), [{type: 'test_a'}, {type: 'test_b'}]);
});
