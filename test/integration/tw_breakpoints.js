const {test} = require('tap');
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
    test(`interpreted stop before the breakpointed block (compiler ${compilerEnabled ? 'on' : 'off'})`, async t => {
        const {vm, value} = await setup();
        vm.setCompilerOptions({enabled: compilerEnabled});
        const hits = pauseOnHit(vm);
        vm.runtime.setBreakpoints(['first']);
        vm.greenFlag();
        const thread = vm.runtime.threads[0];
        t.equal(thread.isCompiled, false, 'a script with a breakpoint runs interpreted');
        vm.runtime._step();
        t.equal(hits.length, 1);
        t.equal(hits[0].blockId, 'first');
        t.equal(value('x'), 1, 'blocks before the breakpoint ran, the breakpointed block did not');
        vm.runtime._step();
        t.equal(value('x'), 1, 'stays paused');
        resume(thread);
        vm.runtime._step();
        t.equal(value('x'), 3, 'resuming runs the breakpointed block once and continues');
        t.equal(hits.length, 1);
        t.end();
    });
}

test('without a listener a breakpoint does not stop the thread', async t => {
    const {vm, value} = await setup();
    vm.runtime.setBreakpoints(['first']);
    vm.greenFlag();
    vm.runtime._step();
    t.equal(value('x'), 3);
    t.end();
});

test('scripts without breakpoints still compile', async t => {
    const {vm} = await setup();
    vm.runtime.setBreakpoints(['tick']);
    vm.greenFlag();
    t.equal(vm.runtime.threads[0].isCompiled, true);
    vm.runtime.setBreakpoints(null);
    t.equal(vm.runtime.breakpoints, null);
    t.end();
});

test('breakpoints in a called procedure keep the caller interpreted', t => {
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
    t.equal(vm.runtime.scriptHasBreakpoint(blocks, 'top'), true);
    vm.runtime.setBreakpoints(['elsewhere']);
    t.equal(vm.runtime.scriptHasBreakpoint(blocks, 'top'), false);
    t.end();
});

test('a running compiled thread stops at its next yield point', async t => {
    const {vm, value} = await setup();
    const hits = pauseOnHit(vm);
    vm.runtime.startHats('event_whenbroadcastreceived', {BROADCAST_OPTION: 'go'});
    const thread = vm.runtime.threads[0];
    t.equal(thread.isCompiled, true);
    vm.runtime._step();
    const before = value('y');
    t.ok(before >= 1);
    vm.runtime.setBreakpoints(['tick']);
    vm.runtime._step();
    t.equal(hits.length, 1);
    t.equal(hits[0].blockId, 'loopHat', 'compiled threads report their top block');
    t.equal(value('y'), before, 'no iteration ran after the stop');
    resume(thread);
    vm.runtime._step();
    t.ok(value('y') > before, 'resuming runs at least one more iteration');
    t.ok(hits.length >= 2, 'and stops again at the next yield');
    t.end();
});

test('a script with compiler-only blocks keeps compiling and stops at yield points', async t => {
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
    t.equal(vm.runtime.scriptNeedsCompiler(sprite.blocks, 'jsonHat'), true);
    t.equal(vm.runtime.scriptNeedsCompiler(sprite.blocks, 'hat'), false);
    const hits = pauseOnHit(vm);
    vm.runtime.setBreakpoints(['afterArray']);
    vm.runtime.startHats('event_whenbroadcastreceived', {BROADCAST_OPTION: 'json'});
    const thread = vm.runtime.threads[0];
    t.equal(thread.isCompiled, true, 'compiler-only blocks keep the script compiled');
    vm.runtime._step();
    t.equal(hits.length, 1);
    t.equal(hits[0].blockId, 'jsonHat');
    t.same(stage.lookupVariableById('lid').value, [], 'stopped before the script ran');
    resume(thread);
    vm.runtime._step();
    t.equal(stage.lookupVariableById('lid').value.length, 3, 'the compiler-only block ran after resuming');
    t.end();
});
