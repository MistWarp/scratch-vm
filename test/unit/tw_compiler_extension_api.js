const test = require('tap').test;
const VirtualMachine = require('../../src/virtual-machine');
const JSGenerator = require('../../src/compiler/jsgen');
const {ReturnType} = require('../../src/compiler/enums');

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

const buildProject = (extensions, blocks) => ({
    targets: [{
        isStage: true,
        name: 'Stage',
        variables: {},
        lists: {},
        broadcasts: {},
        blocks,
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
    extensions,
    meta: {semver: '3.0.0', vm: '3.0.0', agent: ''}
});

const compileSource = vm => {
    let source = '';
    JSGenerator.testingApparatus = {report: (generator, generated) => {
        source += generated;
    }};
    vm.runtime.precompile();
    JSGenerator.testingApparatus = null;
    return source;
};

test('compFunc extension API emits native code from getInfo', async t => {
    const vm = new VirtualMachine();
    class CompFuncTest {
        getInfo () {
            return {
                id: 'compFuncTest',
                name: 'CompFunc test',
                blocks: [
                    {
                        opcode: 'square',
                        blockType: 'reporter',
                        text: 'square of [NUMBER]',
                        arguments: {NUMBER: {type: 'number'}},
                        returnType: 'number',
                        compFunc: 'comp_square'
                    },
                    {
                        opcode: 'announce',
                        blockType: 'command',
                        text: 'announce [TEXT]',
                        arguments: {TEXT: {type: 'string'}},
                        compFunc: 'comp_announce'
                    }
                ]
            };
        }
        comp_square (args, {cast}) {
            return `(${cast.toNumber(args.NUMBER)} ** 2)`;
        }
        comp_announce (args, {cast}) {
            return `target._customAnnounce(${cast.toString(args.TEXT)})`;
        }
        square (args) {
            return Number(args.NUMBER) ** 2;
        }
        announce () {}
    }
    vm.extensionManager.addBuiltinExtension('compFuncTest', CompFuncTest);
    await vm.loadProject(buildProject(['compFuncTest'], {
        hat: {
            opcode: 'event_whenflagclicked',
            next: 'announce',
            parent: null,
            inputs: {},
            fields: {},
            topLevel: true,
            x: 0,
            y: 0
        },
        announce: {
            opcode: 'compFuncTest_announce',
            next: 'say',
            parent: 'hat',
            inputs: {TEXT: [1, [10, 'hi']]},
            fields: {},
            topLevel: false
        },
        say: {
            opcode: 'looks_say',
            next: null,
            parent: 'announce',
            inputs: {MESSAGE: [2, 'square']},
            fields: {},
            topLevel: false
        },
        square: {
            opcode: 'compFuncTest_square',
            next: null,
            parent: 'say',
            inputs: {NUMBER: [1, [4, '3']]},
            fields: {},
            topLevel: false
        }
    }));

    const source = compileSource(vm);
    t.match(source, /3 \*\* 2/, 'compFunc reporter was compiled directly');
    t.match(source, /target\._customAnnounce\("hi"\);/, 'compFunc command was emitted as a statement');
    t.notMatch(source, /compFuncTest_square/, 'reporter did not use the compatibility bridge');
});

test('compFunc token interpolation compiles as the any value', async t => {
    const vm = new VirtualMachine();
    class InterpTest {
        getInfo () {
            return {
                id: 'interpTest',
                name: 'Interp test',
                blocks: [{
                    opcode: 'negate',
                    blockType: 'reporter',
                    text: 'negate [NUMBER]',
                    arguments: {NUMBER: {type: 'number'}},
                    returnType: 'number',
                    compFunc: 'compNegate'
                }]
            };
        }
        compNegate (args) {
            return `(-${args.NUMBER})`;
        }
        negate (args) {
            return -Number(args.NUMBER);
        }
    }
    vm.extensionManager.addBuiltinExtension('interpTest', InterpTest);
    await vm.loadProject(buildProject(['interpTest'], {
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
            inputs: {MESSAGE: [2, 'negate']},
            fields: {},
            topLevel: false
        },
        negate: {
            opcode: 'interpTest_negate',
            next: null,
            parent: 'say',
            inputs: {NUMBER: [1, [4, '7']]},
            fields: {},
            topLevel: false
        }
    }));

    const source = compileSource(vm);
    t.match(source, /-7/, 'a token interpolated into a template string compiled to the any value');
});

test('compFunc types come from the block type unless declared', async t => {
    const vm = new VirtualMachine();
    class TypesTest {
        getInfo () {
            return {
                id: 'typesTest',
                name: 'Types test',
                blocks: [
                    {opcode: 'anyRep', blockType: 'reporter', text: 'any', arguments: {}, compFunc: 'compAny'},
                    {opcode: 'boolRep', blockType: 'Boolean', text: 'bool', arguments: {}, compFunc: 'compBool'},
                    {opcode: 'cmd', blockType: 'command', text: 'cmd', arguments: {}, compFunc: 'compCmd'},
                    {
                        opcode: 'strRep',
                        blockType: 'reporter',
                        text: 'str',
                        arguments: {},
                        returnType: 'string',
                        compFunc: 'compStr'
                    },
                    {
                        opcode: 'numRep',
                        blockType: 'reporter',
                        text: 'num',
                        arguments: {},
                        returnType: ReturnType.NUMBER,
                        compFunc: 'compStr'
                    },
                    {
                        opcode: 'alwaysRep',
                        blockType: 'reporter',
                        text: 'always',
                        arguments: {},
                        returnType: ReturnType.NUMBER_NEVER_NAN,
                        compFunc: 'compStr'
                    }
                ]
            };
        }
        compAny () { return '1'; }
        compBool () { return 'true'; }
        compCmd () { return 'void 0'; }
        compStr () { return '"x"'; }
    }
    vm.extensionManager.addBuiltinExtension('typesTest', TypesTest);
    await vm.loadProject(buildProject(['typesTest'], {
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
            inputs: {MESSAGE: [2, 'anyRep']},
            fields: {},
            topLevel: false
        },
        anyRep: {
            opcode: 'typesTest_anyRep',
            next: null,
            parent: 'say',
            inputs: {},
            fields: {},
            topLevel: false
        }
    }));

    const types = vm.runtime.compilerExtensions;
    t.equal(types.get('typesTest_anyRep').type, 'any', 'reporter defaults to any');
    t.equal(types.get('typesTest_boolRep').type, 'boolean', 'Boolean block maps to boolean');
    t.equal(types.get('typesTest_cmd').type, 'command', 'command block maps to command');
    t.equal(types.get('typesTest_strRep').type, 'string', 'declared returnType overrides the default');
    t.equal(types.get('typesTest_numRep').type, 'numberOrNaN', 'ReturnType.NUMBER is the safe number');
    t.equal(types.get('typesTest_alwaysRep').type, 'number', 'ReturnType.NUMBER_NEVER_NAN is strict');
});

test('compiler.register overrides an automatic compFunc entry', async t => {
    const vm = new VirtualMachine();
    vm.exports.compiler.register('overrideTest', {
        square: {
            type: vm.exports.compiler.types.STRING,
            compile: () => '"registered"'
        }
    });
    class OverrideTest {
        getInfo () {
            return {
                id: 'overrideTest',
                name: 'Override test',
                blocks: [{
                    opcode: 'square',
                    blockType: 'reporter',
                    text: 'square',
                    arguments: {},
                    returnType: 'number',
                    compFunc: 'compSquare'
                }]
            };
        }
        compSquare () { return '0'; }
    }
    vm.extensionManager.addBuiltinExtension('overrideTest', OverrideTest);
    await vm.loadProject(buildProject(['overrideTest'], {
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
            inputs: {MESSAGE: [2, 'square']},
            fields: {},
            topLevel: false
        },
        square: {
            opcode: 'overrideTest_square',
            next: null,
            parent: 'say',
            inputs: {},
            fields: {},
            topLevel: false
        }
    }));

    const entry = vm.runtime.compilerExtensions.get('overrideTest_square');
    t.equal(entry.type, 'string', 'explicit register entry is kept');
    t.equal(typeof entry.compile, 'function', 'explicit compile is kept');
    t.equal(entry.compFunc, undefined, 'compFunc did not clobber the explicit entry');
});

test('compFunc args and cast coerce inputs and fields', t => {
    const {buildCompFuncHelpers} = require('../../src/compiler/extension-compiler');
    const input = name => `any(${name})`;
    input.raw = name => `raw(${name})`;
    input.number = name => `num(${name})`;
    input.numberOrNaN = name => `nan(${name})`;
    input.string = name => `str(${name})`;
    input.boolean = name => `bool(${name})`;
    const field = name => JSON.stringify({CHOICE: 'red'}[name]);

    const {args, cast} = buildCompFuncHelpers(['A', 'B'], {CHOICE: 'red'}, input, field);

    t.equal(`${args.A}`, 'any(A)', 'interpolating a token coerces to any');
    t.equal(cast.toNumber(args.A), 'num(A)', 'a cast helper coerces to a specific type');
    t.equal(cast.toNumber(args.A), `${args.A}`.replace('any', 'num'), 'cast matches the token name');
    t.equal(cast.toRaw(args.B), 'raw(B)', 'raw cast uses the raw helper');
    t.equal(cast.toString('B'), 'str(B)', 'cast accepts a bare argument name');
    t.equal(`${args.CHOICE}`, '"red"', 'a field token serializes as a JSON literal');
    t.equal(cast.toAny(args.CHOICE), '"red"', 'field casts agree with interpolation');
    t.equal(args.CHOICE.kind, 'field', 'fields are marked on the token');
    t.end();
});
