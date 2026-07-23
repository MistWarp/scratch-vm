const test = require('tap').test;
const VirtualMachine = require('../../src/virtual-machine');
const Cast = require('../../src/util/cast');

const reference = {
    bitwiseAnd: (a, b) => a & b,
    bitwiseOr: (a, b) => a | b,
    bitwiseXor: (a, b) => a ^ b,
    bitwiseRightShift: (a, b) => a >> b,
    bitwiseLeftShift: (a, b) => a << b,
    bitwiseLogicalRightShift: (a, b) => a >>> b,
    bitwiseCircularRightShift: (a, b) => (a >>> b) | (a << (32 - b)),
    bitwiseCircularLeftShift: (a, b) => (a << b) | (a >>> (32 - b)),
    bitwiseNot: a => ~a,
    isNumberBits: a => /^-?[01]+$/.test(a),
    toNumberBits: a => Cast.toNumber(a).toString(2),
    ofNumberBits: a => (/^-?[01]+$/.test(a) ? parseInt(a, 2) || 0 : 0)
};

const BINARY = [
    'bitwiseAnd', 'bitwiseOr', 'bitwiseXor',
    'bitwiseRightShift', 'bitwiseLeftShift', 'bitwiseLogicalRightShift',
    'bitwiseCircularRightShift', 'bitwiseCircularLeftShift'
];
const UNARY = ['bitwiseNot', 'isNumberBits', 'toNumberBits', 'ofNumberBits'];

const VALUES = [
    0, 1, -1, 255, 74565, 3.5, -3.5,
    2147483647, -2147483648, 4294967296, 1e10, -1e10,
    '12', '-7', '101', '0110', '-101', '0x10', ' 8 ', '',
    'abc', 'Infinity', 'NaN', '1e3', true, false
];

const makeProject = () => {
    const variables = {va: ['a', 0], vb: ['b', 0]};
    const blocks = {
        hat: {opcode: 'event_whenflagclicked', next: 'set_bitwiseAnd', parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true, x: 0, y: 0}
    };
    const all = [...BINARY, ...UNARY];
    for (let index = 0; index < all.length; index++) {
        const op = all[index];
        const setId = `set_${op}`;
        const opId = `op_${op}`;
        const nextSet = index + 1 < all.length ? `set_${all[index + 1]}` : null;
        variables[`vr_${op}`] = [`r_${op}`, 0];
        blocks[setId] = {
            opcode: 'data_setvariableto', next: nextSet, parent: null,
            inputs: {VALUE: [3, opId, [10, '']]},
            fields: {VARIABLE: [`r_${op}`, `vr_${op}`]}, shadow: false, topLevel: false
        };
        const inputs = BINARY.includes(op) ?
            {LEFT: [3, [12, 'a', 'va'], [4, 0]], RIGHT: [3, [12, 'b', 'vb'], [4, 0]]} :
            {CENTRAL: [3, [12, 'a', 'va'], [4, 0]]};
        blocks[opId] = {
            opcode: `Bitwise_${op}`, next: null, parent: setId,
            inputs, fields: {}, shadow: false, topLevel: false
        };
    }
    return {
        targets: [{
            isStage: true, name: 'Stage', variables, lists: {}, broadcasts: {},
            blocks, comments: {}, currentCostume: 0, costumes: [], sounds: [],
            volume: 100, layerOrder: 0, tempo: 60, videoTransparency: 50, videoState: 'off', textToSpeechLanguage: null
        }],
        monitors: [], extensions: [], meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
    };
};

test('gallery Bitwise compiler matches extension semantics', async t => {
    const vm = new VirtualMachine();
    vm.setCompilerOptions({enabled: true, warpTimer: false});
    vm.extensionManager.isExtensionLoaded = () => true;
    for (const op of [...BINARY, ...UNARY]) {
        vm.runtime._primitives[`Bitwise_${op}`] = () => {
            throw new Error(`compat path used for ${op}`);
        };
    }
    vm.on('COMPILE_ERROR', (target, error) => t.fail(`compile error: ${error}`));

    await vm.loadProject(JSON.stringify(makeProject()));
    vm.runtime.precompile();
    vm.runtime.start = () => {};

    const stage = vm.runtime.getTargetForStage();
    const byName = {};
    for (const id of Object.keys(stage.variables)) {
        byName[stage.variables[id].name] = stage.variables[id];
    }

    const runOnce = (a, b) => {
        byName.a.value = a;
        byName.b.value = b;
        vm.greenFlag();
        for (let i = 0; i < 100 && vm.runtime.threads.some(thread => !thread.isKilled); i++) {
            vm.runtime._step();
        }
    };

    let checks = 0;
    for (const a of VALUES) {
        for (const b of VALUES) {
            runOnce(a, b);
            for (const op of BINARY) {
                const expected = reference[op](a, b);
                const actual = byName[`r_${op}`].value;
                if (!Object.is(actual, expected)) {
                    t.fail(`${op}(${JSON.stringify(a)}, ${JSON.stringify(b)}): expected ${expected}, got ${actual}`);
                }
                checks++;
            }
        }
        runOnce(a, 0);
        for (const op of UNARY) {
            const expected = reference[op](a);
            const actual = byName[`r_${op}`].value;
            if (!Object.is(actual, expected)) {
                t.fail(`${op}(${JSON.stringify(a)}): expected ${expected}, got ${actual}`);
            }
            checks++;
        }
    }
    t.ok(checks > 5000, `ran ${checks} checks`);
    t.end();
});
