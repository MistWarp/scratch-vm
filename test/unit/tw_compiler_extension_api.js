const test = require('tap').test;
const VirtualMachine = require('../../src/virtual-machine');
const JSGenerator = require('../../src/compiler/jsgen');

test('compiler extension API emits native code', async t => {
    const vm = new VirtualMachine();
    const {compiler} = vm.exports;
    compiler.register('compilerTest', {
        double: {
            type: compiler.types.NUMBER,
            compile: ({input, mutation}) => `(${input.number('VALUE')} * ${mutation.factor})`
        }
    });
    vm.extensionManager.addBuiltinExtension('compilerTest', class {
        getInfo () {
            return {
                id: 'compilerTest',
                name: 'Compiler test',
                blocks: [{
                    opcode: 'double',
                    blockType: 'reporter',
                    text: 'double [VALUE]',
                    arguments: {VALUE: {type: 'number'}}
                }]
            };
        }
        double () {
            return 'interpreted';
        }
    });

    await vm.loadProject({
        targets: [{
            isStage: true,
            name: 'Stage',
            variables: {},
            lists: {},
            broadcasts: {},
            blocks: {
                hat: {
                    opcode: 'event_whenflagclicked',
                    next: 'say',
                    parent: null,
                    inputs: {},
                    fields: {},
                    topLevel: true,
                    x: 0,
                    y: 0
                },
                say: {
                    opcode: 'looks_say',
                    next: null,
                    parent: 'hat',
                    inputs: {MESSAGE: [2, 'double']},
                    fields: {},
                    topLevel: false
                },
                double: {
                    opcode: 'compilerTest_double',
                    next: null,
                    parent: 'say',
                    inputs: {VALUE: [1, [4, '3']]},
                    fields: {},
                    mutation: {factor: '2'},
                    topLevel: false
                }
            },
            comments: {},
            currentCostume: 0,
            costumes: [],
            sounds: [],
            volume: 100,
            layerOrder: 0,
            tempo: 60,
            videoTransparency: 50,
            videoState: 'on',
            textToSpeechLanguage: null
        }],
        monitors: [],
        extensions: ['compilerTest'],
        meta: {semver: '3.0.0', vm: '3.0.0', agent: ''}
    });

    let source = '';
    JSGenerator.testingApparatus = {report: (generator, generated) => {
        source += generated;
    }};
    vm.runtime.precompile();
    JSGenerator.testingApparatus = null;

    t.match(source, /3 \* 2/, 'custom reporter was compiled directly');
    t.notMatch(source, /compilerTest_double/, 'compatibility bridge was not used');

    const input = name => name;
    input.number = name => name;
    t.equal(
        vm.runtime.compilerExtensions.get('operator_min').compile({input, mutation: {itemcount: '3'}}),
        'Math.min(NUM1,NUM2,NUM3)',
        'extendable compiler inputs follow their mutation'
    );
});
