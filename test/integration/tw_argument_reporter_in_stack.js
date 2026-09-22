const {test} = require('tap');
const VM = require('../../src/virtual-machine');

const mutation = {
    tagName: 'mutation',
    children: [],
    proccode: 'test %s %b',
    argumentids: '["argX","argB"]',
    warp: 'false'
};

const project = {
    targets: [
        {
            isStage: true,
            name: 'Stage',
            variables: {
                outX: ['outX', ''],
                outB: ['outB', ''],
                done: ['done', '']
            },
            lists: {},
            broadcasts: {},
            blocks: {},
            comments: {},
            currentCostume: 0,
            costumes: [],
            sounds: [],
            volume: 100
        },
        {
            isStage: false,
            name: 'Sprite1',
            variables: {},
            lists: {},
            broadcasts: {},
            blocks: {
                flag1: {
                    opcode: 'event_whenflagclicked',
                    next: 'call',
                    parent: null,
                    inputs: {},
                    fields: {},
                    shadow: false,
                    topLevel: true,
                    x: 0,
                    y: 0
                },
                call: {
                    opcode: 'procedures_call',
                    next: null,
                    parent: 'flag1',
                    inputs: {
                        argX: [1, [10, 'hello']],
                        argB: [2, 'equals']
                    },
                    fields: {},
                    shadow: false,
                    topLevel: false,
                    mutation
                },
                equals: {
                    opcode: 'operator_equals',
                    next: null,
                    parent: 'call',
                    inputs: {
                        OPERAND1: [1, [10, '1']],
                        OPERAND2: [1, [10, '1']]
                    },
                    fields: {},
                    shadow: false,
                    topLevel: false
                },
                def: {
                    opcode: 'procedures_definition',
                    next: 'stackX',
                    parent: null,
                    inputs: {
                        custom_block: [1, 'proto']
                    },
                    fields: {},
                    shadow: false,
                    topLevel: true,
                    x: 0,
                    y: 200
                },
                proto: {
                    opcode: 'procedures_prototype',
                    next: null,
                    parent: 'def',
                    inputs: {
                        argX: [1, 'protoX'],
                        argB: [1, 'protoB']
                    },
                    fields: {},
                    shadow: true,
                    topLevel: false,
                    mutation: Object.assign({}, mutation, {
                        argumentnames: '["x","b"]',
                        argumentdefaults: '["","false"]'
                    })
                },
                protoX: {
                    opcode: 'argument_reporter_string_number',
                    next: null,
                    parent: 'proto',
                    inputs: {},
                    fields: {VALUE: ['x', null]},
                    shadow: true,
                    topLevel: false
                },
                protoB: {
                    opcode: 'argument_reporter_boolean',
                    next: null,
                    parent: 'proto',
                    inputs: {},
                    fields: {VALUE: ['b', null]},
                    shadow: true,
                    topLevel: false
                },
                stackX: {
                    opcode: 'argument_reporter_string_number',
                    next: 'stackB',
                    parent: 'def',
                    inputs: {},
                    fields: {VALUE: ['x', null]},
                    shadow: false,
                    topLevel: false
                },
                stackB: {
                    opcode: 'argument_reporter_boolean',
                    next: 'setX',
                    parent: 'stackX',
                    inputs: {},
                    fields: {VALUE: ['b', null]},
                    shadow: false,
                    topLevel: false
                },
                setX: {
                    opcode: 'data_setvariableto',
                    next: 'setB',
                    parent: 'stackB',
                    inputs: {VALUE: [3, 'readX', [10, '']]},
                    fields: {VARIABLE: ['outX', 'outX']},
                    shadow: false,
                    topLevel: false
                },
                readX: {
                    opcode: 'argument_reporter_string_number',
                    next: null,
                    parent: 'setX',
                    inputs: {},
                    fields: {VALUE: ['x', null]},
                    shadow: false,
                    topLevel: false
                },
                setB: {
                    opcode: 'data_setvariableto',
                    next: null,
                    parent: 'setX',
                    inputs: {VALUE: [3, 'readB', [10, '']]},
                    fields: {VARIABLE: ['outB', 'outB']},
                    shadow: false,
                    topLevel: false
                },
                readB: {
                    opcode: 'argument_reporter_boolean',
                    next: null,
                    parent: 'setB',
                    inputs: {},
                    fields: {VALUE: ['b', null]},
                    shadow: false,
                    topLevel: false
                },
                flag2: {
                    opcode: 'event_whenflagclicked',
                    next: 'looseX',
                    parent: null,
                    inputs: {},
                    fields: {},
                    shadow: false,
                    topLevel: true,
                    x: 400,
                    y: 0
                },
                looseX: {
                    opcode: 'argument_reporter_string_number',
                    next: 'looseB',
                    parent: 'flag2',
                    inputs: {},
                    fields: {VALUE: ['missing', null]},
                    shadow: false,
                    topLevel: false
                },
                looseB: {
                    opcode: 'argument_reporter_boolean',
                    next: 'setDone',
                    parent: 'looseX',
                    inputs: {},
                    fields: {VALUE: ['missing', null]},
                    shadow: false,
                    topLevel: false
                },
                setDone: {
                    opcode: 'data_setvariableto',
                    next: null,
                    parent: 'looseB',
                    inputs: {VALUE: [1, [10, 'yes']]},
                    fields: {VARIABLE: ['done', 'done']},
                    shadow: false,
                    topLevel: false
                }
            },
            comments: {},
            currentCostume: 0,
            costumes: [],
            sounds: [],
            volume: 100,
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
    meta: {
        semver: '3.0.0',
        vm: '0.2.0',
        agent: ''
    }
};

test('argument reporters used as stacked blocks run in compiled scripts', async t => {
    const vm = new VM();
    await vm.loadProject(project);

    vm.greenFlag();
    t.equal(vm.runtime.threads.length, 2);
    for (const thread of vm.runtime.threads) {
        t.ok(thread.isCompiled, 'script is compiled');
    }

    t.doesNotThrow(() => {
        for (let i = 0; i < 5 && vm.runtime.threads.length; i++) {
            vm.runtime._step();
        }
    });

    const variables = vm.runtime.getTargetForStage().variables;
    t.equal(variables.outX.value, 'hello');
    t.equal(variables.outB.value, true);
    t.equal(variables.done.value, 'yes');
    t.end();
});
