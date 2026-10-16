const {test} = require('tap');
const VirtualMachine = require('../../src/virtual-machine');

const project = (blocks, extensions, extensionURLs = {}) => ({
    targets: [{
        isStage: true,
        name: 'Stage',
        variables: {resultId: ['result', 0]},
        lists: {},
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
    extensionURLs,
    meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
});

const rawCommand = {
    hat: {opcode: 'event_whenflagclicked', next: 'js', parent: null, inputs: {}, fields: {}, topLevel: true, x: 0, y: 0},
    js: {
        opcode: 'patching_jscommand',
        next: null,
        parent: 'hat',
        inputs: {ARG1: [1, [10, 'globalThis.__rawSourceRan = (globalThis.__rawSourceRan || 0) + 1;']]},
        fields: {},
        topLevel: false
    }
};

const run = vm => {
    vm.greenFlag();
    for (let i = 0; i < 5; i++) vm.runtime._step();
};

for (const extensions of [['patching'], []]) {
    test(`raw JavaScript does not run when patching was not allowed (${JSON.stringify(extensions)})`, async t => {
        delete globalThis.__rawSourceRan;
        const vm = new VirtualMachine();
        vm.securityManager.canLoadExtensionFromProject = () => Promise.resolve(false);
        vm.setCompilerOptions({enabled: true});
        await vm.loadProject(project(rawCommand, extensions));
        t.equal(vm.extensionManager.isExtensionLoaded('patching'), false);
        run(vm);
        t.notOk(globalThis.__rawSourceRan);
        vm.quit();
    });
}

test('raw JavaScript runs when patching was allowed', async t => {
    delete globalThis.__rawSourceRan;
    const vm = new VirtualMachine();
    vm.securityManager.canLoadExtensionFromProject = () => Promise.resolve(true);
    vm.setCompilerOptions({enabled: true});
    await vm.loadProject(project(rawCommand, ['patching']));
    t.equal(vm.extensionManager.isExtensionLoaded('patching'), true);
    run(vm);
    t.equal(globalThis.__rawSourceRan, 1);
    vm.quit();
});

test('the built-in compare compiler only accepts comparison operators', async t => {
    const blocks = {
        hat: {opcode: 'event_whenflagclicked', next: 'set', parent: null, inputs: {}, fields: {}, topLevel: true, x: 0, y: 0},
        set: {
            opcode: 'data_setvariableto',
            next: null,
            parent: 'hat',
            inputs: {VALUE: [3, 'cmp', [10, '']]},
            fields: {VARIABLE: ['result', 'resultId']},
            topLevel: false
        },
        cmp: {
            opcode: 'mistsutils_compare',
            next: null,
            parent: 'set',
            inputs: {
                A: [1, [4, '1']],
                B: [1, [4, '2']],
                C: [1, [10, '< 2 || (globalThis.__rawSourceRan = 1) ||']]
            },
            fields: {},
            topLevel: false
        }
    };
    delete globalThis.__rawSourceRan;
    const vm = new VirtualMachine();
    vm.securityManager.canLoadExtensionFromProject = () => Promise.resolve(false);
    vm.setCompilerOptions({enabled: true});
    await vm.loadProject(project(blocks, ['mistsutils'], {mistsutils: 'https://example.com/utils.js'}));
    run(vm);
    t.notOk(globalThis.__rawSourceRan);
    vm.quit();
});
