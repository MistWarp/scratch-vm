const test = require('tap').test;
const VirtualMachine = require('../../src/virtual-machine');
const JSGenerator = require('../../src/compiler/jsgen');

// Any extension block means extension code can read, write or call anything, so the compiler must assume nothing.

const compile = async (blocks, setup) => {
    const vm = new VirtualMachine();
    if (setup) setup(vm);
    await vm.loadProject({
        targets: [{isStage: true, name: 'Stage', variables: {v: ['v', 0]}, lists: {}, broadcasts: {}, blocks,
            comments: {}, currentCostume: 0, costumes: [], sounds: [], volume: 100, layerOrder: 0}],
        monitors: [],
        extensions: setup ? ['deopt'] : [],
        meta: {semver: '3.0.0', vm: '3.0.0', agent: ''}
    });
    let source = '';
    JSGenerator.testingApparatus = {report: (generator, generated) => {
        source += generated;
    }};
    vm.runtime.precompile();
    JSGenerator.testingApparatus = null;
    const said = [];
    vm.runtime.on('SAY', (target, type, text) => said.push(text));
    vm.greenFlag();
    vm.runtime._step();
    return {source, said};
};

test('an extension loop branch assumes nothing about variables', async t => {
    const blocks = {
        hat: {opcode: 'event_whenflagclicked', next: 'set', parent: null, inputs: {}, fields: {}, topLevel: true,
            x: 0, y: 0},
        set: {opcode: 'data_setvariableto', next: 'twice', parent: 'hat', inputs: {VALUE: [1, [4, '3']]},
            fields: {VARIABLE: ['v', 'v']}, topLevel: false},
        twice: {opcode: 'deopt_twice', next: null, parent: 'set', inputs: {SUBSTACK: [2, 'say']}, fields: {},
            topLevel: false},
        say: {opcode: 'looks_say', next: 'reset', parent: 'twice', inputs: {MESSAGE: [3, 'add', [10, '']]},
            fields: {}, topLevel: false},
        add: {opcode: 'operator_add', next: null, parent: 'say',
            inputs: {NUM1: [3, [12, 'v', 'v'], [4, '']], NUM2: [1, [4, '1']]}, fields: {}, topLevel: false},
        reset: {opcode: 'data_setvariableto', next: null, parent: 'twice', inputs: {VALUE: [1, [10, 'a']]},
            fields: {VARIABLE: ['v', 'v']}, topLevel: false}
    };
    const {source, said} = await compile(blocks, vm => vm.extensionManager.addBuiltinExtension('deopt', class {
        getInfo () {
            return {id: 'deopt', name: 'Deopt', blocks: [{
                opcode: 'twice', blockType: 'loop', text: 'twice', compFunc: 'compTwice'
            }]};
        }
        compTwice (args, {branch}) {
            return `for (let i = 0; i < 2; i++) { ${branch(1)} }`;
        }
        twice () {}
    }));
    t.match(source, /for \(let i = 0; i < 2; i\+\+\)/, 'the extension was compiled');
    t.same(said, [4, 1], 'the second time round v is "a", and "a" + 1 is 1');
});
