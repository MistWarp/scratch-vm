const {test} = require('node:test');
const assert = require('node:assert');
const VirtualMachine = require('../../src/virtual-machine');
const jsexecute = require('../../src/compiler/jsexecute');
const Cast = require('../../src/util/cast');
const MathUtil = require('../../src/util/math-util');
const Scratch3OperatorsBlocks = require('../../src/blocks/scratch3_operators');

const show = value => (Object.is(value, -0) ? '-0' : JSON.stringify(value));

const TWO_32 = 2 ** 32;
const LIST_INDEXES = [
    1, 2, 4, 5, 5.5, 5.999, 6, 6.5, 7, 0, 0.5, 0.999, -0, -0.5, -1, NaN, Infinity, -Infinity,
    2 ** 31, (2 ** 31) + 1, TWO_32, TWO_32 + 1, TWO_32 + 2, TWO_32 + 2.5, TWO_32 + 5, TWO_32 + 6,
    2 - TWO_32, 1 - TWO_32, 6 - TWO_32, -TWO_32, 2 ** 53, 1e21, -1e21,
    '4294967298', '-4294967294', '4294967301.5', '2.9', '5.5', ' 3 ', '1e1', '0x2', '', 'abc', 'last',
    true, false
];

const scratchIndex = (index, length) => {
    const result = Cast.toListIndex(index, length, false);
    return result === Cast.LIST_INVALID ? -1 : result - 1;
};

test('compiled list helpers use the same index as Cast.toListIndex', () => {
    const {listIndex, listIndexSlow, listGet, listReplace, listInsert, listDelete} = jsexecute.scopedEval(
        '({listIndex, listIndexSlow, listGet, listReplace, listInsert, listDelete})'
    );
    const items = ['a', 'b', 'c', 4, 5];
    for (const index of LIST_INDEXES) {
        const label = `index ${show(index)} (${typeof index})`;
        const expected = scratchIndex(index, items.length);
        const expectedInsert = scratchIndex(index, items.length + 1);

        assert.strictEqual(listIndex(index, items.length), expected, `listIndex ${label}`);
        assert.strictEqual(listIndexSlow(index, items.length), expected, `listIndexSlow ${label}`);
        assert.strictEqual(listGet(items, index), expected === -1 ? '' : items[expected], `listGet ${label}`);

        const replaced = {value: items.slice(), _monitorUpToDate: true};
        const replacedExpected = items.slice();
        if (expected !== -1) replacedExpected[expected] = 'new';
        listReplace(replaced, index, 'new');
        assert.deepStrictEqual(replaced.value, replacedExpected, `listReplace ${label}`);

        const inserted = {value: items.slice(), _monitorUpToDate: true};
        const insertedExpected = items.slice();
        if (expectedInsert !== -1) insertedExpected.splice(expectedInsert, 0, 'new');
        listInsert(inserted, index, 'new');
        assert.deepStrictEqual(inserted.value, insertedExpected, `listInsert ${label}`);

        const deleted = {value: items.slice(), _monitorUpToDate: true};
        const deletedExpected = items.slice();
        if (expected !== -1) deletedExpected.splice(expected, 1);
        listDelete(deleted, index);
        assert.deepStrictEqual(deleted.value, deletedExpected, `listDelete ${label}`);
    }
});

const scratchSin = n => parseFloat(Math.sin((Math.PI * n) / 180).toFixed(10));
const scratchTan = n => {
    const angle = n % 360;
    switch (angle) {
    case -270:
    case 90:
        return Infinity;
    case -90:
    case 270:
        return -Infinity;
    default:
        return parseFloat(Math.tan((Math.PI * angle) / 180).toFixed(10));
    }
};

const ANGLES = [
    0, -0, 180, -180, 360, -360, 720, -720, 1e-9, -1e-9, 1e-12, -1e-12, 30, -30, 45, -45, 90, -90,
    270, -270, 450, 89.5, -89.5, 1e21, -1e21, NaN
];

test('sin and tan give the sign of zero that Scratch gives', () => {
    const operators = new Scratch3OperatorsBlocks({});
    const compiledTan = jsexecute.scopedEval('tan');
    for (const angle of ANGLES) {
        const sin = scratchSin(Cast.toNumber(angle));
        const tan = scratchTan(angle);
        const blockSin = operators.mathop({OPERATOR: 'sin', NUM: angle});
        const blockTan = operators.mathop({OPERATOR: 'tan', NUM: angle});
        assert.ok(Object.is(blockSin, sin), `sin block of ${show(angle)} is ${show(sin)}, got ${show(blockSin)}`);
        const castTan = scratchTan(Cast.toNumber(angle));
        assert.ok(Object.is(blockTan, castTan), `tan block of ${show(angle)} is ${show(castTan)}, got ${show(blockTan)}`);
        assert.ok(
            Object.is(MathUtil.tan(angle), tan),
            `MathUtil.tan of ${show(angle)} is ${show(tan)}, got ${show(MathUtil.tan(angle))}`
        );
        assert.ok(
            Object.is(compiledTan(angle), tan),
            `compiled tan of ${show(angle)} is ${show(tan)}, got ${show(compiledTan(angle))}`
        );
    }
    assert.ok(Object.is(scratchSin(-0), 0));
    assert.ok(Object.is(scratchSin(-1e-12), -0));
    assert.ok(Object.is(scratchTan(-360), 0));
});

const makeProject = (build, variables, lists) => {
    const blocks = {
        flag: {
            opcode: 'event_whenflagclicked',
            next: null,
            parent: null,
            inputs: {},
            fields: {},
            topLevel: true,
            x: 0,
            y: 0
        }
    };
    let count = 0;
    let previous = 'flag';
    const encode = (parent, inputs) => {
        const encoded = {};
        for (const name of Object.keys(inputs)) {
            const value = inputs[name];
            if (value && typeof value === 'object') {
                const id = `r${count++}`;
                blocks[id] = {
                    opcode: value.opcode,
                    next: null,
                    parent,
                    inputs: {},
                    fields: value.fields || {},
                    topLevel: false
                };
                blocks[id].inputs = encode(id, value.inputs || {});
                encoded[name] = [3, id, [10, '']];
            } else {
                encoded[name] = [1, [10, String(value)]];
            }
        }
        return encoded;
    };
    const stack = (opcode, inputs, fields) => {
        const id = `s${count++}`;
        blocks[id] = {opcode, next: null, parent: previous, inputs: {}, fields: fields || {}, topLevel: false};
        blocks[id].inputs = encode(id, inputs || {});
        blocks[previous].next = id;
        previous = id;
    };
    build(stack);
    return {
        targets: [{
            isStage: true,
            name: 'Stage',
            variables,
            lists,
            broadcasts: {},
            blocks,
            currentCostume: 0,
            costumes: [{
                name: 'backdrop1',
                dataFormat: 'svg',
                assetId: 'cd21514d0531fdffb22204e0ec5ed84a',
                md5ext: 'cd21514d0531fdffb22204e0ec5ed84a.svg'
            }],
            sounds: [],
            volume: 100
        }],
        monitors: [],
        extensions: [],
        meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
    };
};

const runProject = async (project, compile) => {
    const vm = new VirtualMachine();
    vm.setCompilerOptions({enabled: compile});
    vm.on('COMPILE_ERROR', (target, error) => {
        throw new Error(`Compile error: ${error}`);
    });
    await vm.loadProject(project);
    vm.greenFlag();
    for (let step = 0; step < 100 && vm.runtime.threads.length !== 0; step++) {
        vm.runtime._step();
    }
    assert.strictEqual(vm.runtime.threads.length, 0, 'script finished');
    return vm;
};

const variableField = id => ({VARIABLE: [id, id]});
const listField = id => ({LIST: [id, id]});
const variable = id => ({opcode: 'data_variable', fields: variableField(id)});
const itemOf = index => ({opcode: 'data_itemoflist', inputs: {INDEX: index}, fields: listField('l')});
const letterOf = index => ({opcode: 'operator_letter_of', inputs: {LETTER: index, STRING: 'apple'}});
const mathop = (operator, value) => ({
    opcode: 'operator_mathop',
    inputs: {NUM: value},
    fields: {OPERATOR: [operator, null]}
});

const buildIndexScript = stack => {
    const out = value => stack('data_addtolist', {ITEM: value}, listField('out'));
    const setV = value => stack('data_setvariableto', {VALUE: value}, variableField('v'));
    const both = (value, use) => {
        use(value);
        setV(value);
        use(variable('v'));
    };

    for (const index of ['4294967298', '-4294967294', '4294967297.5', '4.5', '0.5', '4', '5', 'Infinity']) {
        both(index, value => out(itemOf(value)));
    }
    for (const index of ['4294967297', '-4294967295', '1.5', '5.9', '6']) {
        both(index, value => out(letterOf(value)));
    }
    for (const index of ['4294967298', '-4294967294', '4294967300']) {
        both(index, value => stack('data_replaceitemoflist', {INDEX: value, ITEM: 'z'}, listField('l')));
        both(index, value => stack('data_insertatlist', {INDEX: value, ITEM: 'z'}, listField('l')));
        both(index, value => stack('data_deleteoflist', {INDEX: value}, listField('l')));
    }
    out({opcode: 'data_listcontents', fields: listField('l')});
    both('4.5', value => stack('data_replaceitemoflist', {INDEX: value, ITEM: 'D'}, listField('l')));
    both('5.5', value => stack('data_insertatlist', {INDEX: value, ITEM: 'e'}, listField('l')));
    out({opcode: 'data_listcontents', fields: listField('l')});
    both('6.9', value => stack('data_deleteoflist', {INDEX: value}, listField('l')));
    both('5.9', value => stack('data_deleteoflist', {INDEX: value}, listField('l')));
    out({opcode: 'data_listcontents', fields: listField('l')});
};

const INDEX_SCRIPT_OUTPUT = [
    '', '', '', '', '', '', 'd', 'd', '', '', 'd', 'd', '', '', '', '',
    '', '', '', '', 'a', 'a', 'e', 'e', '', '',
    'abcd',
    'abcDee',
    'abcD'
];

test('scripts treat list and letter indices past 32 bits as out of range', async () => {
    const project = () => makeProject(buildIndexScript, {v: ['v', 0]}, {
        l: ['l', ['a', 'b', 'c', 'd']],
        out: ['out', []]
    });
    for (const compile of [true, false]) {
        const vm = await runProject(project(), compile);
        const stage = vm.runtime.getTargetForStage();
        assert.deepStrictEqual(
            stage.variables.out.value,
            INDEX_SCRIPT_OUTPUT,
            compile ? 'compiled' : 'interpreted'
        );
        assert.deepStrictEqual(stage.variables.l.value, ['a', 'b', 'c', 'D']);
    }
});

const buildTrigScript = stack => {
    const out = value => stack('data_addtolist', {ITEM: value}, listField('out'));
    for (const angle of ['-0', '-360', '-180', '-0.000000000001', '0', '180']) {
        for (const operator of ['sin', 'tan']) {
            out(mathop(operator, angle));
            stack('data_setvariableto', {VALUE: angle}, variableField('v'));
            out(mathop(operator, variable('v')));
        }
    }
};

test('scripts get a positive zero from sin and tan of negative zero', async () => {
    const expected = [];
    for (const angle of [-0, -360, -180, -1e-12, 0, 180]) {
        expected.push(scratchSin(angle), scratchSin(angle), scratchTan(angle), scratchTan(angle));
    }
    assert.ok(Object.is(expected[0], 0));
    assert.ok(Object.is(expected[12], -0));
    for (const compile of [true, false]) {
        const vm = await runProject(makeProject(buildTrigScript, {v: ['v', 0]}, {out: ['out', []]}), compile);
        const actual = vm.runtime.getTargetForStage().variables.out.value;
        assert.strictEqual(actual.length, expected.length);
        actual.forEach((value, i) => {
            assert.ok(
                Object.is(value, expected[i]),
                `${compile ? 'compiled' : 'interpreted'} result ${i} is ${show(expected[i])}, got ${show(value)}`
            );
        });
    }
});

const PROTOTYPE_NAMES = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__', 'isPrototypeOf'];

test('variables named after Object.prototype members load, run and save', async () => {
    const variables = {};
    PROTOTYPE_NAMES.forEach((name, i) => {
        variables[`id${i}`] = [name, `value ${i}`];
    });
    const build = stack => {
        PROTOTYPE_NAMES.forEach((name, i) => {
            stack('data_addtolist', {
                ITEM: {opcode: 'data_variable', fields: {VARIABLE: [name, `id${i}`]}}
            }, listField('out'));
        });
    };
    const expected = PROTOTYPE_NAMES.map((name, i) => `value ${i}`);
    for (const compile of [true, false]) {
        const vm = await runProject(makeProject(build, variables, {out: ['out', []]}), compile);
        const stage = vm.runtime.getTargetForStage();
        PROTOTYPE_NAMES.forEach((name, i) => {
            const loaded = stage.lookupVariableByNameAndType(name, '');
            assert.ok(loaded, `${name} was loaded`);
            assert.strictEqual(loaded.id, `id${i}`);
        });
        for (const id of Object.keys(stage.blocks._blocks)) {
            assert.strictEqual(typeof stage.blocks._blocks[id].opcode, 'string');
        }
        assert.deepStrictEqual(stage.variables.out.value, expected);

        const saved = JSON.parse(vm.toJSON());
        const savedNames = Object.values(saved.targets[0].variables).map(entry => entry[0]);
        for (const name of PROTOTYPE_NAMES) {
            assert.ok(savedNames.includes(name), `${name} was saved`);
        }
    }
});

test('blocks with an opcode named after an Object.prototype member load', async () => {
    const build = stack => {
        for (const name of PROTOTYPE_NAMES) stack(name);
    };
    const vm = new VirtualMachine();
    await vm.loadProject(makeProject(build, {}, {}));
    const blocks = vm.runtime.getTargetForStage().blocks._blocks;
    const opcodes = Object.keys(blocks).map(id => blocks[id].opcode);
    assert.deepStrictEqual(opcodes, ['event_whenflagclicked', ...PROTOTYPE_NAMES]);
});
