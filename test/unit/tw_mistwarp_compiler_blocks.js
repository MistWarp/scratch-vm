const test = require('tap').test;
const VirtualMachine = require('../../src/virtual-machine');
const JSGenerator = require('../../src/compiler/jsgen');
const {runtimeFunctions} = require('../../src/compiler/jsexecute');

test('MistWarp text and coordinate blocks compile directly', async t => {
    const vm = new VirtualMachine();
    await vm.loadProject({
        targets: [{
            isStage: true,
            name: 'Stage',
            variables: {},
            lists: {list: ['items', []]},
            broadcasts: {},
            blocks: {
                hat: {
                    opcode: 'event_whenflagclicked',
                    next: 'point',
                    parent: null,
                    inputs: {},
                    fields: {},
                    topLevel: true,
                    x: 0,
                    y: 0
                },
                point: {
                    opcode: 'motion_pointtowards_xyfrom',
                    next: 'print',
                    parent: 'hat',
                    inputs: {
                        X: [1, [4, '10']], Y: [1, [4, '10']], FROMX: [1, [4, '0']], FROMY: [1, [4, '0']]
                    },
                    fields: {},
                    topLevel: false
                },
                print: {
                    opcode: 'pen_printText',
                    next: 'say',
                    parent: 'point',
                    inputs: {TEXT: [2, 'trim'], X: [1, [4, '0']], Y: [1, [4, '0']]},
                    fields: {},
                    topLevel: false
                },
                trim: {
                    opcode: 'operator_trim',
                    next: null,
                    parent: 'print',
                    inputs: {STRING: [1, [10, ' text ']]},
                    fields: {},
                    topLevel: false
                },
                say: {
                    opcode: 'looks_say',
                    next: 'setList',
                    parent: 'print',
                    inputs: {MESSAGE: [2, 'costumes']},
                    fields: {},
                    topLevel: false
                },
                costumes: {
                    opcode: 'looks_costumes', next: null, parent: 'say', inputs: {}, fields: {}, topLevel: false
                },
                setList: {
                    opcode: 'data_set_list_to_array',
                    next: 'sayList',
                    parent: 'say',
                    inputs: {ARRAY: [1, [10, '["a","b"]']]},
                    fields: {LIST: ['items', 'list']},
                    topLevel: false
                },
                sayList: {
                    opcode: 'looks_say',
                    next: null,
                    parent: 'setList',
                    inputs: {MESSAGE: [2, 'listAs']},
                    fields: {},
                    topLevel: false
                },
                listAs: {
                    opcode: 'data_get_list_as',
                    next: null,
                    parent: 'sayList',
                    inputs: {},
                    fields: {LIST: ['items', 'list'], FORMAT: ['JSON', null]},
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
        extensions: ['pen'],
        meta: {semver: '3.0.0', vm: '3.0.0', agent: ''}
    });

    let source = '';
    JSGenerator.testingApparatus = {report: (_generator, generated) => {
        source += generated;
    }};
    vm.runtime.precompile();
    JSGenerator.testingApparatus = null;

    t.match(source, /Math\.atan2/, 'coordinate block is native');
    t.match(source, /_printText/, 'pen text block is native');
    t.match(source, /\.trim\(\)/, 'text operator is native');
    t.match(source, /getCostumes\(\)\.map/, 'costume list reporter is native');
    t.match(source, /JSON\.parse/, 'list import is native');
    t.match(source, /JSON\.stringify\(.*\.value\)/, 'list export is native');
    t.notMatch(source, /executeInCompatibilityLayer/, 'local blocks avoid compatibility fallback');
});

test('compiled list helpers preserve case-sensitive mode', t => {
    const globalState = {thread: {target: {runtime: {runtimeOptions: {caseSensitiveLists: true}}}}};
    const makeHelper = source => new Function(
        'globalState', `${source}; return ${source.match(/const (\w+)/)[1]};`
    )(globalState);
    const contains = makeHelper(runtimeFunctions.listContains);
    const indexOf = makeHelper(runtimeFunctions.listIndexOf);
    const list = {value: ['jump', 'Jump']};

    t.equal(contains(list, 'JUMP'), false);
    t.equal(indexOf(list, 'Jump'), 2);
    t.end();
});

test("legacy Mist's Utils patch blocks splice raw JavaScript", async t => {
    const vm = new VirtualMachine();
    vm.extensionManager.addBuiltinExtension('mistsutils', class {
        getInfo () {
            return {
                id: 'mistsutils',
                name: "Mist's Utils",
                blocks: [{
                    opcode: 'patchcommand3',
                    blockType: 'command',
                    text: '[A] [B] [C]',
                    arguments: {A: {type: 'string'}, B: {type: 'string'}, C: {type: 'string'}}
                }]
            };
        }
        patchcommand3 () {}
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
                    next: 'patch',
                    parent: null,
                    inputs: {},
                    fields: {},
                    topLevel: true,
                    x: 0,
                    y: 0
                },
                patch: {
                    opcode: 'mistsutils_patchcommand3',
                    next: 'nativePatch',
                    parent: 'hat',
                    inputs: {
                        A: [1, [10, 'globalThis.__originPatch = ']],
                        B: [2, 'sum'],
                        C: [1, [10, ';']]
                    },
                    fields: {},
                    topLevel: false
                },
                nativePatch: {
                    opcode: 'patching_jscommand',
                    next: null,
                    parent: 'patch',
                    inputs: {
                        ARG1: [1, [10, 'globalThis.__nativePatch = ']],
                        ARG2: [1, [10, '4']],
                        ARG3: [1, [10, ';']]
                    },
                    fields: {},
                    mutation: {tagName: 'mutation', children: [], itemcount: '3'},
                    topLevel: false
                },
                sum: {
                    opcode: 'operator_add',
                    next: null,
                    parent: 'patch',
                    inputs: {NUM1: [1, [4, '1']], NUM2: [1, [4, '2']], NUM3: [1, [4, '3']]},
                    fields: {},
                    mutation: {tagName: 'mutation', children: [], itemcount: '3'},
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
        extensions: ['patching'],
        meta: {semver: '3.0.0', vm: '3.0.0', agent: ''}
    });

    let source = '';
    JSGenerator.testingApparatus = {report: (_generator, generated) => {
        source += generated;
    }};
    vm.runtime.precompile();
    JSGenerator.testingApparatus = null;

    t.match(
        source,
        /globalThis\.__originPatch = \(toNotNaN\(\(1 \+ 2\)\) \+ 3\);/,
        'literal source and variadic reporters are joined'
    );
    t.match(source, /globalThis\.__nativePatch = 4;/, 'native Patching blocks splice JavaScript');
    t.notMatch(source, /"globalThis\.__originPatch/, 'raw source is not emitted as a quoted statement');
    t.notMatch(source, /executeInCompatibilityLayer/, 'patching does not use the runtime compatibility bridge');
});

test("Mist's Utils compiler API cannot alter raw patch syntax", async t => {
    const vm = new VirtualMachine();
    vm.extensionManager.addBuiltinExtension('mistsutils', class {
        getInfo () {
            return {
                id: 'mistsutils',
                name: "Mist's Utils",
                blocks: [{
                    opcode: 'patchcommand',
                    blockType: 'command',
                    text: '[A]',
                    arguments: {A: {type: 'string'}}
                }]
            };
        }
        patchcommand () {}
    });
    const command = vm.exports.compiler.types.COMMAND;
    vm.exports.compiler.register('mistsutils', {
        patchcommand: {
            type: command,
            compile: ({input}) => input.raw('A')
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
                    next: 'if',
                    parent: null,
                    inputs: {},
                    fields: {},
                    topLevel: true,
                    x: 0,
                    y: 0
                },
                if: {
                    opcode: 'mistsutils_patchcommand',
                    next: 'else',
                    parent: 'hat',
                    inputs: {A: [1, [10, 'if (true) globalThis.__originIcon = 1;']]},
                    fields: {},
                    topLevel: false
                },
                else: {
                    opcode: 'mistsutils_patchcommand',
                    next: null,
                    parent: 'if',
                    inputs: {A: [1, [10, 'else globalThis.__originIcon = 2;']]},
                    fields: {},
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
        extensions: [],
        meta: {semver: '3.0.0', vm: '3.0.0', agent: ''}
    });

    let source = '';
    JSGenerator.testingApparatus = {report: (_generator, generated) => {
        source += generated;
    }};
    vm.runtime.precompile();
    JSGenerator.testingApparatus = null;

    t.match(source, /if \(true\) globalThis\.__originIcon = 1;\s*else globalThis\.__originIcon = 2;/);
    t.notMatch(source, /;;\s*else/, 'raw commands are not terminated twice');
});

test("Mist's Utils 5.9 blocks use native compiler cases", async t => {
    const vm = new VirtualMachine();
    vm.extensionManager.addBuiltinExtension('mistsutils', class {
        getInfo () {
            return {
                id: 'mistsutils',
                name: "Mist's Utils",
                blocks: [{
                    opcode: 'starts',
                    blockType: 'Boolean',
                    text: '[A] starts with [B]',
                    arguments: {A: {type: 'string'}, B: {type: 'string'}}
                }]
            };
        }
        starts () {}
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
                    next: 'if',
                    parent: null,
                    inputs: {},
                    fields: {},
                    topLevel: true,
                    x: 0,
                    y: 0
                },
                if: {
                    opcode: 'control_if',
                    next: null,
                    parent: 'hat',
                    inputs: {CONDITION: [2, 'report'], SUBSTACK: [2, null]},
                    fields: {},
                    topLevel: false
                },
                report: {
                    opcode: 'mistsutils_starts',
                    next: null,
                    parent: 'if',
                    inputs: {A: [1, [10, 'origin']], B: [1, [10, 'ori']]},
                    fields: {},
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
        extensions: [],
        meta: {semver: '3.0.0', vm: '3.0.0', agent: ''}
    });

    let source = '';
    JSGenerator.testingApparatus = {report: (_generator, generated) => {
        source += generated;
    }};
    vm.runtime.precompile();
    JSGenerator.testingApparatus = null;

    t.match(source, /"origin"\.startsWith\("ori"\)/);
    t.notMatch(source, /oldCompiler|executeInCompatibilityLayer/);
});
