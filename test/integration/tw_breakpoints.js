const {test} = require('node:test');
const assert = require('node:assert');
const VirtualMachine = require('../../src/virtual-machine');
const Thread = require('../../src/engine/thread');

const changeBy = (id, next, parent, amount) => ({
    opcode: 'data_changevariableby',
    next,
    parent,
    inputs: {VALUE: [1, [4, String(amount)]]},
    fields: {VARIABLE: ['x', 'xid']},
    shadow: false,
    topLevel: false
});

const project = () => ({
    targets: [
        {
            isStage: true,
            name: 'Stage',
            variables: {xid: ['x', 0], yid: ['y', 0]},
            lists: {},
            broadcasts: {},
            blocks: {},
            comments: {},
            currentCostume: 0,
            costumes: [],
            sounds: [],
            volume: 100,
            layerOrder: 0
        },
        {
            isStage: false,
            name: 'Sprite1',
            variables: {},
            lists: {},
            broadcasts: {},
            blocks: {
                hat: {
                    opcode: 'event_whenflagclicked',
                    next: 'set',
                    parent: null,
                    inputs: {},
                    fields: {},
                    shadow: false,
                    topLevel: true,
                    x: 0,
                    y: 0
                },
                set: {
                    opcode: 'data_setvariableto',
                    next: 'first',
                    parent: 'hat',
                    inputs: {VALUE: [1, [10, '1']]},
                    fields: {VARIABLE: ['x', 'xid']},
                    shadow: false,
                    topLevel: false
                },
                first: changeBy('first', 'second', 'set', 1),
                second: changeBy('second', null, 'first', 1),
                loopHat: {
                    opcode: 'event_whenbroadcastreceived',
                    next: 'forever',
                    parent: null,
                    inputs: {},
                    fields: {BROADCAST_OPTION: ['go', 'goid']},
                    shadow: false,
                    topLevel: true,
                    x: 0,
                    y: 200
                },
                forever: {
                    opcode: 'control_forever',
                    next: null,
                    parent: 'loopHat',
                    inputs: {SUBSTACK: [2, 'tick']},
                    fields: {},
                    shadow: false,
                    topLevel: false
                },
                tick: {
                    opcode: 'data_changevariableby',
                    next: null,
                    parent: 'forever',
                    inputs: {VALUE: [1, [4, '1']]},
                    fields: {VARIABLE: ['y', 'yid']},
                    shadow: false,
                    topLevel: false
                }
            },
            comments: {},
            currentCostume: 0,
            costumes: [],
            sounds: [],
            volume: 100,
            layerOrder: 1,
            visible: true,
            x: 0,
            y: 0,
            size: 100,
            direction: 90,
            draggable: false,
            rotationStyle: 'all around'
        }
    ],
    monitors: [],
    extensions: [],
    meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
});

const setup = async () => {
    const vm = new VirtualMachine();
    await vm.loadProject(project());
    vm.runtime.currentStepTime = 1000 / 30;
    const stage = vm.runtime.getTargetForStage();
    const value = name => Number(stage.lookupVariableByNameAndType(name, '').value);
    return {vm, value};
};

const pauseOnHit = vm => {
    const hits = [];
    vm.runtime.on('BREAKPOINT_HIT', (thread, blockId) => {
        hits.push({thread, blockId});
        thread.status = Thread.STATUS_PROMISE_WAIT;
    });
    return hits;
};

const resume = thread => {
    thread.breakpointBlock = thread.isCompiled ? thread.topBlock : thread.peekStack();
    thread.status = Thread.STATUS_RUNNING;
};

for (const compilerEnabled of [false, true]) {
    test(`interpreted stop before the breakpointed block (compiler ${compilerEnabled ? 'on' : 'off'})`, async () => {
        const {vm, value} = await setup();
        vm.setCompilerOptions({enabled: compilerEnabled});
        const hits = pauseOnHit(vm);
        vm.runtime.setBreakpoints(['first']);
        vm.greenFlag();
        const thread = vm.runtime.threads[0];
        assert.strictEqual(thread.isCompiled, false, 'a script with a breakpoint runs interpreted');
        vm.runtime._step();
        assert.strictEqual(hits.length, 1);
        assert.strictEqual(hits[0].blockId, 'first');
        assert.strictEqual(value('x'), 1, 'blocks before the breakpoint ran, the breakpointed block did not');
        vm.runtime._step();
        assert.strictEqual(value('x'), 1, 'stays paused');
        resume(thread);
        vm.runtime._step();
        assert.strictEqual(value('x'), 3, 'resuming runs the breakpointed block once and continues');
        assert.strictEqual(hits.length, 1);
    });
}

test('without a listener a breakpoint does not stop the thread', async () => {
    const {vm, value} = await setup();
    vm.runtime.setBreakpoints(['first']);
    vm.greenFlag();
    vm.runtime._step();
    assert.strictEqual(value('x'), 3);
});

test('scripts without breakpoints still compile', async () => {
    const {vm} = await setup();
    vm.runtime.setBreakpoints(['tick']);
    vm.greenFlag();
    assert.strictEqual(vm.runtime.threads[0].isCompiled, true);
    vm.runtime.setBreakpoints(null);
    assert.strictEqual(vm.runtime.breakpoints, null);
});

test('breakpoints in a called procedure keep the caller interpreted', () => {
    const vm = new VirtualMachine();
    const blocks = {
        getBlock: id => ({
            top: {opcode: 'procedures_call', next: null, inputs: {}, mutation: {proccode: 'p'}},
            def: {opcode: 'procedures_definition', next: 'inner', inputs: {}},
            inner: {opcode: 'looks_say', next: null, inputs: {}}
        })[id],
        getProcedureDefinition: () => 'def'
    };
    vm.runtime.setBreakpoints(['inner']);
    assert.strictEqual(vm.runtime.scriptHasBreakpoint(blocks, 'top'), true);
    vm.runtime.setBreakpoints(['elsewhere']);
    assert.strictEqual(vm.runtime.scriptHasBreakpoint(blocks, 'top'), false);
});

test('a running compiled thread stops at its next yield point', async () => {
    const {vm, value} = await setup();
    const hits = pauseOnHit(vm);
    vm.runtime.startHats('event_whenbroadcastreceived', {BROADCAST_OPTION: 'go'});
    const thread = vm.runtime.threads[0];
    assert.strictEqual(thread.isCompiled, true);
    vm.runtime._step();
    const before = value('y');
    assert.ok(before >= 1);
    vm.runtime.setBreakpoints(['tick']);
    vm.runtime._step();
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(hits[0].blockId, 'loopHat', 'compiled threads report their top block');
    assert.strictEqual(value('y'), before, 'no iteration ran after the stop');
    resume(thread);
    vm.runtime._step();
    assert.ok(value('y') > before, 'resuming runs at least one more iteration');
    assert.ok(hits.length >= 2, 'and stops again at the next yield');
});

test('a script with compiler-only blocks keeps compiling and stops at yield points', async () => {
    const data = project();
    data.targets[0].lists = {lid: ['L', []]};
    Object.assign(data.targets[1].blocks, {
        jsonHat: {
            opcode: 'event_whenbroadcastreceived',
            next: 'toArray',
            parent: null,
            inputs: {},
            fields: {BROADCAST_OPTION: ['json', 'jsonid']},
            shadow: false,
            topLevel: true,
            x: 0,
            y: 400
        },
        toArray: {
            opcode: 'data_set_list_to_array',
            next: 'afterArray',
            parent: 'jsonHat',
            inputs: {ARRAY: [1, [10, '[1,2,3]']]},
            fields: {LIST: ['L', 'lid']},
            shadow: false,
            topLevel: false
        },
        afterArray: changeBy('afterArray', null, 'toArray', 1)
    });
    const vm = new VirtualMachine();
    await vm.loadProject(data);
    vm.runtime.currentStepTime = 1000 / 30;
    const stage = vm.runtime.getTargetForStage();
    const sprite = vm.runtime.targets[1];
    assert.strictEqual(vm.runtime.scriptNeedsCompiler(sprite.blocks, 'jsonHat'), true);
    assert.strictEqual(vm.runtime.scriptNeedsCompiler(sprite.blocks, 'hat'), false);
    const hits = pauseOnHit(vm);
    vm.runtime.setBreakpoints(['afterArray']);
    vm.runtime.startHats('event_whenbroadcastreceived', {BROADCAST_OPTION: 'json'});
    const thread = vm.runtime.threads[0];
    assert.strictEqual(thread.isCompiled, true, 'compiler-only blocks keep the script compiled');
    vm.runtime._step();
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(hits[0].blockId, 'jsonHat');
    assert.deepStrictEqual(stage.lookupVariableById('lid').value, [], 'stopped before the script ran');
    resume(thread);
    vm.runtime._step();
    assert.strictEqual(stage.lookupVariableById('lid').value.length, 3, 'the compiler-only block ran after resuming');
});
