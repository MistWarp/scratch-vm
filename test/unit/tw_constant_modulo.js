const test = require('tap').test;
const VirtualMachine = require('../../src/virtual-machine');
const JSGenerator = require('../../src/compiler/jsgen');

const CASES = [
    {name: 'pow2', modulus: '4', variable: 'byPow2'},
    {name: 'nonPow2', modulus: '3', variable: 'byNonPow2'},
    {name: 'negative', modulus: '-3', variable: 'byNegative'},
    {name: 'fractional', modulus: '0.5', variable: 'byFractional'}
];

const makeProject = () => {
    const blocks = {
        hat: {opcode: 'event_whenflagclicked', next: null, parent: null, inputs: {}, fields: {}, topLevel: true, x: 0, y: 0},
        xpos: {opcode: 'motion_xposition', next: null, parent: null, inputs: {}, fields: {}, topLevel: false}
    };
    let previous = 'hat';
    for (const testCase of CASES) {
        const setId = `set_${testCase.name}`;
        const modId = `mod_${testCase.name}`;
        blocks[setId] = {
            opcode: 'data_setvariableto',
            next: null,
            parent: previous,
            inputs: {VALUE: [3, modId, [10, '']]},
            fields: {VARIABLE: [testCase.variable, testCase.variable]},
            topLevel: false
        };
        blocks[modId] = {
            opcode: 'operator_mod',
            next: null,
            parent: setId,
            inputs: {NUM1: [3, 'xpos', [4, '0']], NUM2: [1, [4, testCase.modulus]]},
            fields: {},
            topLevel: false
        };
        blocks[previous].next = setId;
        previous = setId;
    }

    const variables = {};
    for (const testCase of CASES) variables[testCase.variable] = [testCase.variable, 0];

    return {
        targets: [
            {
                isStage: true, name: 'Stage', variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {},
                currentCostume: 0, costumes: [], sounds: [], volume: 100, layerOrder: 0
            },
            {
                isStage: false, name: 'Sprite', variables, lists: {}, broadcasts: {}, blocks, comments: {},
                currentCostume: 0, costumes: [], sounds: [], volume: 100, layerOrder: 1,
                visible: true, x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around'
            }
        ],
        monitors: [],
        extensions: [],
        meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
    };
};

const scratchMod = (n, modulus) => {
    let result = n % modulus;
    if (result / modulus < 0) result += modulus;
    return result;
};

test('modulo by a constant keeps floored-division semantics', async t => {
    let generated = '';
    JSGenerator.testingApparatus = {
        report (jsgen, factorySource) {
            generated += factorySource;
        }
    };

    const vm = new VirtualMachine();
    vm.setCompilerOptions({enabled: true});
    vm.runtime.start = () => {};
    await vm.loadProject(makeProject());

    const sprite = vm.runtime.targets.find(target => target.getName() === 'Sprite');
    const readVariable = name => Object.values(sprite.variables).find(variable => variable.name === name).value;

    for (const dividend of [7, -7, 0, 6, -6, 5.5, -5.5, 1, -1]) {
        sprite.setXY(dividend, 0);
        vm.greenFlag();
        for (let i = 0; i < 3; i++) vm.runtime._step();
        for (const testCase of CASES) {
            const expected = scratchMod(dividend, Number(testCase.modulus));
            t.equal(readVariable(testCase.variable), expected, `${dividend} mod ${testCase.modulus} === ${expected}`);
        }
    }

    t.ok(generated.includes('modP2('), 'power-of-two modulus uses the multiply-free helper');
    t.notOk(/mod\(toNotNaN/.test(generated), 'constant moduli avoid the generic runtime helper');

    JSGenerator.testingApparatus = null;
    t.end();
});
