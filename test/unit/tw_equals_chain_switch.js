const test = require('tap').test;
const VirtualMachine = require('../../src/virtual-machine');
const JSGenerator = require('../../src/compiler/jsgen');

const makeProject = () => ({
    targets: [
        {
            isStage: true,
            name: 'Stage',
            variables: {},
            lists: {},
            broadcasts: {},
            blocks: {},
            comments: {},
            currentCostume: 0,
            costumes: [{name: 'c', dataFormat: 'svg', assetId: 'cd21514d0531fdffb22204e0ec5ed84a', md5ext: 'cd21514d0531fdffb22204e0ec5ed84a.svg', rotationCenterX: 0, rotationCenterY: 0}],
            sounds: [],
            volume: 100,
            layerOrder: 0
        },
        {
            isStage: false,
            name: 'Sprite',
            variables: {
                cond: ['cond', 0],
                result: ['result', 'none']
            },
            lists: {},
            broadcasts: {},
            blocks: {
                hat: {opcode: 'event_whenflagclicked', next: 'setCond', parent: null, inputs: {}, fields: {}, topLevel: true, x: 0, y: 0},
                setCond: {opcode: 'data_setvariableto', next: 'setNone', parent: 'hat', inputs: {VALUE: [3, 'xpos', [10, '']]}, fields: {VARIABLE: ['cond', 'cond']}, topLevel: false},
                xpos: {opcode: 'motion_xposition', next: null, parent: 'setCond', inputs: {}, fields: {}, topLevel: false},
                setNone: {opcode: 'data_setvariableto', next: 'if1', parent: 'setCond', inputs: {VALUE: [1, [10, 'none']]}, fields: {VARIABLE: ['result', 'result']}, topLevel: false},

                if1: {opcode: 'control_if', next: 'if2', parent: 'setNone', inputs: {CONDITION: [2, 'eq1'], SUBSTACK: [2, 'setA']}, fields: {}, topLevel: false},
                eq1: {opcode: 'operator_equals', next: null, parent: 'if1', inputs: {OPERAND1: [3, [12, 'cond', 'cond'], [10, '']], OPERAND2: [1, [10, '1']]}, fields: {}, topLevel: false},
                setA: {opcode: 'data_setvariableto', next: 'stop1', parent: 'if1', inputs: {VALUE: [1, [10, 'a']]}, fields: {VARIABLE: ['result', 'result']}, topLevel: false},
                stop1: {opcode: 'control_stop', next: null, parent: 'setA', inputs: {}, fields: {STOP_OPTION: ['this script', null]}, topLevel: false, mutation: {tagName: 'mutation', children: [], hasnext: 'false'}},

                if2: {opcode: 'control_if', next: 'if3', parent: 'if1', inputs: {CONDITION: [2, 'eq2'], SUBSTACK: [2, 'setB']}, fields: {}, topLevel: false},
                eq2: {opcode: 'operator_equals', next: null, parent: 'if2', inputs: {OPERAND1: [3, [12, 'cond', 'cond'], [10, '']], OPERAND2: [1, [10, '2']]}, fields: {}, topLevel: false},
                setB: {opcode: 'data_setvariableto', next: 'stop2', parent: 'if2', inputs: {VALUE: [1, [10, 'b']]}, fields: {VARIABLE: ['result', 'result']}, topLevel: false},
                stop2: {opcode: 'control_stop', next: null, parent: 'setB', inputs: {}, fields: {STOP_OPTION: ['this script', null]}, topLevel: false, mutation: {tagName: 'mutation', children: [], hasnext: 'false'}},

                if3: {opcode: 'control_if', next: 'setFallback', parent: 'if2', inputs: {CONDITION: [2, 'eq3'], SUBSTACK: [2, 'setC']}, fields: {}, topLevel: false},
                eq3: {opcode: 'operator_equals', next: null, parent: 'if3', inputs: {OPERAND1: [3, [12, 'cond', 'cond'], [10, '']], OPERAND2: [1, [10, '3']]}, fields: {}, topLevel: false},
                setC: {opcode: 'data_setvariableto', next: 'stop3', parent: 'if3', inputs: {VALUE: [1, [10, 'c']]}, fields: {VARIABLE: ['result', 'result']}, topLevel: false},
                stop3: {opcode: 'control_stop', next: null, parent: 'setC', inputs: {}, fields: {STOP_OPTION: ['this script', null]}, topLevel: false, mutation: {tagName: 'mutation', children: [], hasnext: 'false'}},

                setFallback: {opcode: 'data_setvariableto', next: null, parent: 'if3', inputs: {VALUE: [1, [10, 'fallback']]}, fields: {VARIABLE: ['result', 'result']}, topLevel: false}
            },
            comments: {},
            currentCostume: 0,
            costumes: [{name: 'c', dataFormat: 'svg', assetId: 'cd21514d0531fdffb22204e0ec5ed84a', md5ext: 'cd21514d0531fdffb22204e0ec5ed84a.svg', rotationCenterX: 0, rotationCenterY: 0}],
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

test('terminating equals chains lower to a native switch with identical behavior', async t => {
    const sources = [];
    JSGenerator.testingApparatus = {
        report (jsgen, factorySource) {
            sources.push(factorySource);
        }
    };

    const vm = new VirtualMachine();
    vm.setCompilerOptions({enabled: true});
    vm.runtime.start = () => {};
    await vm.loadProject(makeProject());

    const sprite = vm.runtime.targets.find(target => target.getName() === 'Sprite');
    const resultVar = Object.values(sprite.variables).find(variable => variable.name === 'result');

    const runWithX = x => {
        sprite.setXY(x, 0);
        vm.greenFlag();
        for (let i = 0; i < 5; i++) vm.runtime._step();
        return resultVar.value;
    };

    t.equal(runWithX(1), 'a', 'first case');
    t.equal(runWithX(2), 'b', 'middle case');
    t.equal(runWithX(3), 'c', 'last case');
    t.equal(runWithX(99), 'fallback', 'no case matches falls through');
    t.equal(runWithX(2.5), 'fallback', 'fractional subject matches nothing');

    t.ok(sources.some(source => source.includes('switch (')), 'chain compiled to a native switch');

    JSGenerator.testingApparatus = null;
    t.end();
});
