const test = require('tap').test;
const VirtualMachine = require('../../src/virtual-machine');
const Cast = require('../../src/util/cast');

const bases = [];
for (let i = 2; i <= 36; i++) bases.push(String(i));
const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const reference = {
    is_base_block: v => {
        if (bases.includes(Cast.toString(v.b))) {
            return new RegExp(`^[${chars.substring(0, Cast.toNumber(v.b))}]+$`).test(Cast.toString(v.a));
        }
        return false;
    },
    base_block: v => {
        if (bases.includes(Cast.toString(v.b)) && bases.includes(Cast.toString(v.c))) {
            if (new RegExp(`^[${chars.substring(0, Cast.toNumber(v.b))}]+$`).test(Cast.toString(v.a))) {
                return parseInt(Cast.toString(v.a), Cast.toNumber(v.b))
                    .toString(Cast.toNumber(v.c))
                    .toUpperCase() || '0';
            }
        }
        return '0';
    }
};

const makeProject = () => {
    const variables = {v_a: ['a', 0], v_b: ['b', 0], v_c: ['c', 0], vr_is: ['r_is', 0], vr_conv: ['r_conv', 0]};
    const blocks = {
        hat: {opcode: 'event_whenflagclicked', next: 'set1', parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true, x: 0, y: 0},
        set1: {
            opcode: 'data_setvariableto', next: 'set2', parent: null,
            inputs: {VALUE: [3, 'op1', [10, '']]},
            fields: {VARIABLE: ['r_is', 'vr_is']}, shadow: false, topLevel: false
        },
        op1: {
            opcode: 'truefantombase_is_base_block', next: null, parent: 'set1',
            inputs: {A: [3, [12, 'a', 'v_a'], [10, '']], B: [3, [12, 'b', 'v_b'], [10, '']]},
            fields: {}, shadow: false, topLevel: false
        },
        set2: {
            opcode: 'data_setvariableto', next: null, parent: 'set1',
            inputs: {VALUE: [3, 'op2', [10, '']]},
            fields: {VARIABLE: ['r_conv', 'vr_conv']}, shadow: false, topLevel: false
        },
        op2: {
            opcode: 'truefantombase_base_block', next: null, parent: 'set2',
            inputs: {
                A: [3, [12, 'a', 'v_a'], [10, '']],
                B: [3, [12, 'b', 'v_b'], [10, '']],
                C: [3, [12, 'c', 'v_c'], [10, '']]
            },
            fields: {}, shadow: false, topLevel: false
        }
    };
    return {
        targets: [{
            isStage: true, name: 'Stage', variables, lists: {}, broadcasts: {},
            blocks, comments: {}, currentCostume: 0, costumes: [], sounds: [],
            volume: 100, layerOrder: 0, tempo: 60, videoTransparency: 50, videoState: 'off', textToSpeechLanguage: null
        }],
        monitors: [], extensions: [], meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
    };
};

const AS = ['0', '1', '101', 'FF', 'ff', 'Z9', '777', '', 'abc', '-101', '10.5', '0001', 'DEADBEEF', '1010101010101010'];
const BS = ['2', '8', '10', '16', '36', 2, 16, '1', '37', '10.0', ' 10', '010', 'abc', ''];
const CS = ['2', '10', '16', '36', '5', '37', ''];

test('gallery true-fantom base compiler matches extension semantics', async t => {
    const vm = new VirtualMachine();
    vm.setCompilerOptions({enabled: true, warpTimer: false});
    vm.extensionManager.isExtensionLoaded = () => true;
    for (const op of ['is_base_block', 'base_block']) {
        vm.runtime._primitives[`truefantombase_${op}`] = () => {
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

    let checks = 0;
    let failures = 0;
    for (const a of AS) {
        for (const b of BS) {
            for (const c of CS) {
                byName.a.value = a;
                byName.b.value = b;
                byName.c.value = c;
                vm.greenFlag();
                for (let i = 0; i < 100 && vm.runtime.threads.some(thread => !thread.isKilled); i++) {
                    vm.runtime._step();
                }
                const v = {a, b, c};
                for (const [op, resultVar] of [['is_base_block', 'r_is'], ['base_block', 'r_conv']]) {
                    const expected = reference[op](v);
                    const actual = byName[resultVar].value;
                    if (!Object.is(actual, expected)) {
                        failures++;
                        if (failures < 20) {
                            t.fail(`${op} with ${JSON.stringify(v)}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
                        }
                    }
                    checks++;
                }
            }
        }
    }
    t.equal(failures, 0, `no mismatches out of ${checks} checks`);
    t.end();
});
