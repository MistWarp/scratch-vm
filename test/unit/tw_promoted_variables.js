const {test} = require('node:test');
const assert = require('node:assert');
const VirtualMachine = require('../../src/virtual-machine');
const JSGenerator = require('../../src/compiler/jsgen');

// Loops in warp mode keep their variables in JS locals (JSGenerator#findPromotableVariables). Each program below runs
// as a warp custom block, compiled and interpreted, and must leave every variable and list the same either way.

const VARIABLES = ['s', 't', 'i', 'k', 'x'];

/** Builds the blocks of one warp custom block whose body is `body(b)`, called once from the green flag. */
const project = body => {
    const blocks = {};
    let n = 0;
    const add = block => {
        const id = `b${n++}`;
        blocks[id] = {next: null, parent: null, inputs: {}, fields: {}, shadow: false, topLevel: false, ...block};
        return id;
    };
    // An input: a number, a variable name ('$s'), or a reporter block id.
    const input = value => {
        if (typeof value === 'number') return [1, [4, String(value)]];
        if (value.startsWith('$')) return [3, [12, value.slice(1), value.slice(1)], [4, '0']];
        return [3, value, [4, '0']];
    };
    const reporter = (opcode, inputs) => add({opcode, inputs: Object.fromEntries(
        Object.entries(inputs).map(([k, v]) => [k, input(v)]))});
    const stack = ids => {
        ids.forEach((id, i) => {
            blocks[id].next = ids[i + 1] || null;
        });
        return ids[0] || null;
    };
    const b = {
        set: (v, value) => add({opcode: 'data_setvariableto', inputs: {VALUE: input(value)}, fields: {VARIABLE: [v, v]}}),
        change: (v, value) => add({opcode: 'data_changevariableby', inputs: {VALUE: input(value)},
            fields: {VARIABLE: [v, v]}}),
        repeat: (times, body2) => add({opcode: 'control_repeat', inputs: {TIMES: input(times),
            SUBSTACK: [2, stack(body2)]}}),
        until: (condition, body2) => add({opcode: 'control_repeat_until', inputs: {CONDITION: [2, condition],
            SUBSTACK: [2, stack(body2)]}}),
        forEach: (v, times, body2) => add({opcode: 'control_for_each', inputs: {VALUE: input(times),
            SUBSTACK: [2, stack(body2)]}, fields: {VARIABLE: [v, v]}}),
        addToList: value => add({opcode: 'data_addtolist', inputs: {ITEM: input(value)}, fields: {LIST: ['L', 'L']}}),
        resetTimer: () => add({opcode: 'sensing_resettimer'}),
        op: (opcode, a, c) => reporter(opcode, {NUM1: a, NUM2: c}),
        gt: (a, c) => reporter('operator_gt', {OPERAND1: a, OPERAND2: c})
    };
    const proto = add({opcode: 'procedures_prototype', shadow: true, mutation: {tagName: 'mutation', children: [],
        proccode: 'p', argumentids: '[]', argumentnames: '[]', argumentdefaults: '[]', warp: 'true'}});
    const def = add({opcode: 'procedures_definition', topLevel: true, x: 0, y: 0,
        inputs: {custom_block: [1, proto]}});
    blocks[proto].parent = def;
    blocks[def].next = stack(body(b));
    const hat = add({opcode: 'event_whenflagclicked', topLevel: true, x: 0, y: 300});
    blocks[hat].next = add({opcode: 'procedures_call', parent: hat, mutation: {tagName: 'mutation', children: [],
        proccode: 'p', argumentids: '[]', warp: 'true'}});
    return blocks;
};

const run = async (blocks, compiler) => {
    const vm = new VirtualMachine();
    vm.setCompilerOptions({enabled: compiler});
    await vm.loadProject({
        targets: [{isStage: true, name: 'Stage', broadcasts: {}, blocks, comments: {}, currentCostume: 0,
            costumes: [], sounds: [], volume: 100, layerOrder: 0,
            variables: Object.fromEntries(VARIABLES.map(v => [v, [v, 0]])), lists: {L: ['L', []]}}],
        monitors: [],
        extensions: [],
        meta: {semver: '3.0.0', vm: '3.0.0', agent: ''}
    });
    let source = '';
    JSGenerator.testingApparatus = {report: (generator, generated) => {
        source += generated;
    }};
    vm.greenFlag();
    for (let i = 0; i < 100 && vm.runtime.threads.length; i++) vm.runtime._step();
    JSGenerator.testingApparatus = null;
    const stage = vm.runtime.getTargetForStage();
    // As text: the compiler stores a number constant as a number where the interpreter keeps the string.
    const state = Object.fromEntries(VARIABLES.map(v => [v, String(stage.variables[v].value)]));
    state.L = stage.variables.L.value.map(String);
    return {state, source};
};

// `let a0 = b1.value;` before a loop: that loop's variables are in locals.
const PROMOTED = /let a\d+ = \w+\.value;/;

const check = async (name, body, promoted) => {
    const blocks = project(body);
    const compiled = await run(blocks, true);
    const interpreted = await run(blocks, false);
    assert.deepStrictEqual(compiled.state, interpreted.state, `${name}: compiled and interpreted results differ`);
    assert.strictEqual(PROMOTED.test(compiled.source), promoted, `${name}: promoted is not ${promoted}`);
    return compiled.state;
};

test('loops keep their variables in locals and leave the same results', async () => {
    const sum = await check('sum', b => [b.set('s', 0), b.set('i', 0),
        b.repeat(100, [b.change('s', '$i'), b.change('i', 1)])], true);
    assert.strictEqual(sum.s, '4950');

    // The inner loop's writes must be visible to the outer loop's next block.
    const nested = await check('nested', b => [b.repeat(10, [b.repeat(10, [b.change('s', 1)]), b.change('t', '$s')])],
        true);
    assert.deepStrictEqual([nested.s, nested.t], ['100', '550']);

    await check('repeat until', b => [b.set('i', 0),
        b.until(b.gt('$i', 20), [b.change('i', 3), b.change('s', '$i')])], true);
    await check('for each', b => [b.forEach('k', 10, [b.change('s', '$k')])], true);
    // t is 0, so the loop runs no times; a constant 0 would be optimized away instead.
    const none = await check('no iterations', b => [b.set('s', 5), b.repeat('$t', [b.set('s', 99)])], true);
    assert.strictEqual(none.s, '5');
});

test('loops that could see a variable some other way are left alone', async () => {
    // A value that may be NaN going into a list stays in its object (see findPromotableVariables).
    await check('NaN into a list', b => [b.repeat(5, [b.set('x', b.op('operator_divide', '$s', 0)),
        b.addToList('$x'), b.change('s', 1)])], true);
    // reset timer is not in the allowlist, so this loop is not promoted.
    const reset = await check('reset timer', b => [b.repeat(5, [b.change('s', 1), b.resetTimer()])], false);
    assert.strictEqual(reset.s, '5');
});
