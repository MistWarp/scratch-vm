const {test} = require('node:test');
const assert = require('node:assert');
const VirtualMachine = require('../../src/virtual-machine');

const project = (blocks, extensions = []) => ({
    targets: [{
        isStage: true,
        name: 'Stage',
        variables: {logId: ['log', '']},
        lists: {listId: ['L', []]},
        broadcasts: {},
        comments: {},
        currentCostume: 0,
        costumes: [],
        sounds: [],
        volume: 100,
        layerOrder: 0,
        blocks
    }],
    monitors: [],
    extensions,
    meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
});

const flag = next => ({
    opcode: 'event_whenflagclicked', next, parent: null, inputs: {}, fields: {}, topLevel: true, x: 0, y: 0
});

const setLog = (parent, value) => ({
    opcode: 'data_setvariableto',
    next: null,
    parent,
    inputs: {VALUE: [1, [10, value]]},
    fields: {VARIABLE: ['log', 'logId']},
    topLevel: false
});

const procedureMutation = {
    tagName: 'mutation',
    children: [],
    proccode: 'stopper',
    argumentids: '[]',
    argumentnames: '[]',
    argumentdefaults: '[]',
    warp: 'false'
};

const stopAllProcedure = {
    definition: {
        opcode: 'procedures_definition',
        next: 'stop',
        parent: null,
        inputs: {custom_block: [1, 'prototype']},
        fields: {},
        topLevel: true,
        x: 0,
        y: 300
    },
    prototype: {
        opcode: 'procedures_prototype',
        next: null,
        parent: 'definition',
        inputs: {},
        fields: {},
        topLevel: false,
        shadow: true,
        mutation: procedureMutation
    },
    stop: {
        opcode: 'control_stop',
        next: null,
        parent: 'definition',
        inputs: {},
        fields: {STOP_OPTION: ['all', null]},
        topLevel: false,
        mutation: {tagName: 'mutation', children: [], hasnext: 'false'}
    }
};

const callStopper = parent => ({
    opcode: 'procedures_call',
    next: null,
    parent,
    inputs: {},
    fields: {},
    topLevel: false,
    mutation: procedureMutation
});

const run = async (blocks, {extensions, setup} = {}) => {
    const vm = new VirtualMachine();
    vm.securityManager.canLoadExtensionFromProject = () => Promise.resolve(true);
    vm.setCompilerOptions({enabled: true});
    const errors = [];
    vm.runtime.on('COMPILE_ERROR', (target, error) => errors.push(error));
    if (setup) setup(vm);
    await vm.loadProject(project(blocks, extensions));
    vm.greenFlag();
    for (let i = 0; i < 5; i++) vm.runtime._step();
    const log = vm.runtime.getTargetForStage().variables.logId.value;
    vm.quit();
    return {log, errors};
};

test('stop all inside the array input of set list to array stops the script', async () => {
    const {log, errors} = await run({
        flag: flag('setList'),
        setList: {
            opcode: 'data_set_list_to_array',
            next: 'after',
            parent: 'flag',
            inputs: {ARRAY: [3, 'call', [10, '[]']]},
            fields: {LIST: ['L', 'listId']},
            topLevel: false
        },
        call: callStopper('setList'),
        after: setLog('setList', 'ran after stop all'),
        ...stopAllProcedure
    });
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(log, '');
});

test('raw JavaScript that yields makes its script a generator', async () => {
    const {log, errors} = await run({
        flag: flag('js'),
        js: {
            opcode: 'patching_jscommand',
            next: 'after',
            parent: 'flag',
            inputs: {ARG1: [1, [10, 'yield;']]},
            fields: {},
            topLevel: false
        },
        after: setLog('js', 'resumed')
    }, {extensions: ['patching']});
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(log, 'resumed');
});

const TryExtension = class {
    getInfo () {
        return {
            id: 'tryTest',
            name: 'Try test',
            blocks: [{
                opcode: 'attempt',
                blockType: 'conditional',
                text: 'try',
                compFunc: 'compAttempt'
            }]
        };
    }
    compAttempt (args, {branch, rethrowRetire}) {
        return `try { ${branch(1)} } catch (e) { ${rethrowRetire('e')} }`;
    }
    attempt () {}
};

test('a compiled C block can let stop all through its own catch', async () => {
    const {log, errors} = await run({
        flag: flag('attempt'),
        attempt: {
            opcode: 'tryTest_attempt',
            next: 'after',
            parent: 'flag',
            inputs: {SUBSTACK: [2, 'call']},
            fields: {},
            topLevel: false
        },
        call: callStopper('attempt'),
        after: setLog('attempt', 'ran after stop all'),
        ...stopAllProcedure
    }, {setup: vm => vm.extensionManager.addBuiltinExtension('tryTest', TryExtension)});
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(log, '');
});
