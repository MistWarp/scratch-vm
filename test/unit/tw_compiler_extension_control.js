const {test} = require('tap');
const VirtualMachine = require('../../src/virtual-machine');
const JSGenerator = require('../../src/compiler/jsgen');

/**
 * @fileoverview
 * Compiled C-shaped extension blocks. The extension compiler owns the control
 * flow and splices each branch with branch(n).
 */

const buildProject = (blocks, variables = {}) => ({
    targets: [{
        isStage: true,
        name: 'Stage',
        variables,
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
    extensions: [],
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

const flag = next => ({
    opcode: 'event_whenflagclicked',
    next,
    parent: null,
    inputs: {},
    fields: {},
    topLevel: true,
    x: 0,
    y: 0
});

const RepeatExtension = class {
    getInfo () {
        return {
            id: 'loopTest',
            name: 'Loop test',
            blocks: [{
                opcode: 'repeatTimes',
                blockType: 'loop',
                text: 'repeat [TIMES] times',
                arguments: {TIMES: {type: 'number'}},
                compFunc: 'compRepeatTimes'
            }]
        };
    }
    compRepeatTimes (args, {cast, branch, yieldLoop}) {
        return `for (let i = 0, n = ${cast.toNumber(args.TIMES)}; i < n; i++) {
            ${branch(1)}
            ${yieldLoop()}
        }`;
    }
    repeatTimes () {}
};

test('compFunc on a loop block compiles its branches inline', async t => {
    const vm = new VirtualMachine();
    vm.extensionManager.addBuiltinExtension('loopTest', RepeatExtension);
    await vm.loadProject(buildProject({
        flag: flag('loop'),
        loop: {
            opcode: 'loopTest_repeatTimes',
            next: null,
            parent: 'flag',
            inputs: {
                TIMES: [1, [4, '3']],
                SUBSTACK: [2, 'say']
            },
            fields: {},
            topLevel: false
        },
        say: {
            opcode: 'looks_say',
            next: null,
            parent: 'loop',
            inputs: {MESSAGE: [1, [10, 'hi']]},
            fields: {},
            topLevel: false
        }
    }));

    const entry = vm.runtime.compilerExtensions.get('loopTest_repeatTimes');
    t.equal(entry.type, 'command', 'a loop compiles as a command descriptor');

    const source = compileSource(vm);
    t.match(source, /for \(let i = 0, n = 3; i < n; i\+\+\)/, 'the extension owns the loop header');
    t.match(source, /yield;/, 'the loop yields once per iteration outside warp mode');
    t.match(source, /_say\("hi", target\)/, 'the branch body is compiled natively');
    t.notMatch(source, /getOpcodeFunction\("loopTest_repeatTimes"\)/, 'the compatibility layer is not used');
    t.notMatch(source, /createBranchInfo/, 'no branch dispatch is generated');
});

test('compiler.register can compile a conditional with two branches', async t => {
    const vm = new VirtualMachine();
    const {compiler} = vm.exports;
    compiler.register('ifTest', {
        ifElse: {
            type: compiler.types.COMMAND,
            compile: ({input, branch}) => `if (${input.boolean('CONDITION')}) {
                ${branch(1)}
            } else {
                ${branch(2)}
            }`
        }
    });
    vm.extensionManager.addBuiltinExtension('ifTest', class {
        getInfo () {
            return {
                id: 'ifTest',
                name: 'If test',
                blocks: [{
                    opcode: 'ifElse',
                    blockType: 'conditional',
                    branchCount: 2,
                    text: 'if [CONDITION] then',
                    arguments: {CONDITION: {type: 'Boolean'}}
                }]
            };
        }
        ifElse () {}
    });
    await vm.loadProject(buildProject({
        flag: flag('iff'),
        iff: {
            opcode: 'ifTest_ifElse',
            next: null,
            parent: 'flag',
            inputs: {
                CONDITION: [1, [10, '1']],
                SUBSTACK: [2, 'yes'],
                SUBSTACK2: [2, 'no']
            },
            fields: {},
            topLevel: false
        },
        yes: {
            opcode: 'looks_say',
            next: null,
            parent: 'iff',
            inputs: {MESSAGE: [1, [10, 'yes']]},
            fields: {},
            topLevel: false
        },
        no: {
            opcode: 'looks_say',
            next: null,
            parent: 'iff',
            inputs: {MESSAGE: [1, [10, 'no']]},
            fields: {},
            topLevel: false
        }
    }));

    const source = compileSource(vm);
    t.match(source, /if \(true\) \{/, 'the condition is compiled into the if header');
    t.match(source, /_say\("yes", target\)/, 'the first branch is compiled');
    t.match(source, /_say\("no", target\)/, 'the second branch is compiled');
    t.notMatch(source, /createBranchInfo/, 'no branch dispatch is generated');
});

test('an inline loop runs the same number of iterations as the interpreter', async t => {
    const vm = new VirtualMachine();
    vm.extensionManager.addBuiltinExtension('loopTest', RepeatExtension);
    await vm.loadProject(buildProject({
        flag: flag('loop'),
        loop: {
            opcode: 'loopTest_repeatTimes',
            next: null,
            parent: 'flag',
            inputs: {
                TIMES: [1, [4, '3']],
                SUBSTACK: [2, 'change']
            },
            fields: {},
            topLevel: false
        },
        change: {
            opcode: 'data_changevariableby',
            next: null,
            parent: 'loop',
            inputs: {VALUE: [1, [4, '1']]},
            fields: {VARIABLE: ['count', 'count']},
            topLevel: false
        }
    }, {count: ['count', 0]}));

    const stage = vm.runtime.getTargetForStage();
    vm.greenFlag();
    while (vm.runtime.threads.length !== 0) {
        vm.runtime._step();
    }
    t.equal(stage.variables.count.value, 3, 'the branch ran three times');
});

test('a loop inside a custom procedure marks the procedure as yielding', async t => {
    const vm = new VirtualMachine();
    const errors = [];
    vm.runtime.on('COMPILE_ERROR', (target, error) => {
        errors.push(error);
    });
    vm.extensionManager.addBuiltinExtension('loopTest', RepeatExtension);
    await vm.loadProject(buildProject({
        flag: flag('call'),
        call: {
            opcode: 'procedures_call',
            next: null,
            parent: 'flag',
            inputs: {},
            fields: {},
            topLevel: false,
            mutation: {
                tagName: 'mutation',
                children: [],
                proccode: 'myLoop',
                argumentids: '[]',
                argumentnames: '[]',
                argumentdefaults: '[]',
                warp: 'false'
            }
        },
        definition: {
            opcode: 'procedures_definition',
            next: 'loop',
            parent: null,
            inputs: {custom_block: [1, 'prototype']},
            fields: {},
            topLevel: true,
            x: 0,
            y: 0
        },
        prototype: {
            opcode: 'procedures_prototype',
            next: null,
            parent: 'definition',
            inputs: {},
            fields: {},
            topLevel: false,
            shadow: true,
            mutation: {
                tagName: 'mutation',
                children: [],
                proccode: 'myLoop',
                argumentids: '[]',
                argumentnames: '[]',
                argumentdefaults: '[]',
                warp: 'false'
            }
        },
        loop: {
            opcode: 'loopTest_repeatTimes',
            next: null,
            parent: 'definition',
            inputs: {
                TIMES: [1, [4, '2']],
                SUBSTACK: [2, 'say']
            },
            fields: {},
            topLevel: false
        },
        say: {
            opcode: 'looks_say',
            next: null,
            parent: 'loop',
            inputs: {MESSAGE: [1, [10, 'in procedure']]},
            fields: {},
            topLevel: false
        }
    }));

    const source = compileSource(vm);
    t.equal(errors.length, 0, 'the procedure compiled without a yield error');
    t.match(source, /function\* gen\d+ \(\)/, 'the procedure is compiled as a generator');
    t.match(source, /_say\("in procedure", target\)/, 'the procedure branch is compiled');
});

test('nested compiled C blocks splice their own branches', async t => {
    const vm = new VirtualMachine();
    vm.extensionManager.addBuiltinExtension('loopTest', RepeatExtension);
    await vm.loadProject(buildProject({
        flag: flag('outer'),
        outer: {
            opcode: 'loopTest_repeatTimes',
            next: null,
            parent: 'flag',
            inputs: {
                TIMES: [1, [4, '2']],
                SUBSTACK: [2, 'inner']
            },
            fields: {},
            topLevel: false
        },
        inner: {
            opcode: 'loopTest_repeatTimes',
            next: null,
            parent: 'outer',
            inputs: {
                TIMES: [1, [4, '2']],
                SUBSTACK: [2, 'change']
            },
            fields: {},
            topLevel: false
        },
        change: {
            opcode: 'data_changevariableby',
            next: null,
            parent: 'inner',
            inputs: {VALUE: [1, [4, '1']]},
            fields: {VARIABLE: ['count', 'count']},
            topLevel: false
        }
    }, {count: ['count', 0]}));

    const source = compileSource(vm);
    t.equal((source.match(/for \(let i = 0/g) || []).length, 2, 'both loops are emitted');

    const stage = vm.runtime.getTargetForStage();
    vm.greenFlag();
    while (vm.runtime.threads.length !== 0) {
        vm.runtime._step();
    }
    t.equal(stage.variables.count.value, 4, 'the inner branch ran inside the outer branch');
});

test('a loop inside a warp procedure emits no yield', async t => {
    const vm = new VirtualMachine();
    const errors = [];
    vm.runtime.on('COMPILE_ERROR', (target, error) => {
        errors.push(error);
    });
    vm.extensionManager.addBuiltinExtension('loopTest', RepeatExtension);
    await vm.loadProject(buildProject({
        flag: flag('call'),
        call: {
            opcode: 'procedures_call',
            next: null,
            parent: 'flag',
            inputs: {},
            fields: {},
            topLevel: false,
            mutation: {
                tagName: 'mutation',
                children: [],
                proccode: 'myLoop',
                argumentids: '[]',
                argumentnames: '[]',
                argumentdefaults: '[]',
                warp: 'true'
            }
        },
        definition: {
            opcode: 'procedures_definition',
            next: 'loop',
            parent: null,
            inputs: {custom_block: [1, 'prototype']},
            fields: {},
            topLevel: true,
            x: 0,
            y: 0
        },
        prototype: {
            opcode: 'procedures_prototype',
            next: null,
            parent: 'definition',
            inputs: {},
            fields: {},
            topLevel: false,
            shadow: true,
            mutation: {
                tagName: 'mutation',
                children: [],
                proccode: 'myLoop',
                argumentids: '[]',
                argumentnames: '[]',
                argumentdefaults: '[]',
                warp: 'true'
            }
        },
        loop: {
            opcode: 'loopTest_repeatTimes',
            next: null,
            parent: 'definition',
            inputs: {
                TIMES: [1, [4, '2']],
                SUBSTACK: [2, 'say']
            },
            fields: {},
            topLevel: false
        },
        say: {
            opcode: 'looks_say',
            next: null,
            parent: 'loop',
            inputs: {MESSAGE: [1, [10, 'in warp']]},
            fields: {},
            topLevel: false
        }
    }));

    const source = compileSource(vm);
    t.equal(errors.length, 0, 'the warp procedure compiled');
    t.match(source, /function fun\d+_myLoop \(\)/, 'the procedure is a normal function');
    t.notMatch(source, /yield;/, 'warp loops emit no yield');
});

test('a compiler that drops a non-empty branch reports a compile error', async t => {
    const vm = new VirtualMachine();
    const errors = [];
    vm.runtime.on('COMPILE_ERROR', (target, error) => {
        errors.push(error);
    });
    vm.extensionManager.addBuiltinExtension('dropTest', class {
        getInfo () {
            return {
                id: 'dropTest',
                name: 'Drop test',
                blocks: [{
                    opcode: 'forever',
                    blockType: 'loop',
                    text: 'forever',
                    compFunc: 'compForever'
                }]
            };
        }
        compForever () {
            return 'while (true) {}';
        }
        forever () {}
    });
    await vm.loadProject(buildProject({
        flag: flag('loop'),
        loop: {
            opcode: 'dropTest_forever',
            next: null,
            parent: 'flag',
            inputs: {SUBSTACK: [2, 'say']},
            fields: {},
            topLevel: false
        },
        say: {
            opcode: 'looks_say',
            next: null,
            parent: 'loop',
            inputs: {MESSAGE: [1, [10, 'hi']]},
            fields: {},
            topLevel: false
        }
    }));

    compileSource(vm);
    t.equal(errors.length, 1, 'one compile error was reported');
    t.match(errors[0].message, /did not include branch 1/, 'the missing branch is named');
});
