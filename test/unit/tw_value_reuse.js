const {test} = require('node:test');
const assert = require('node:assert');
const VirtualMachine = require('../../src/virtual-machine');
const JSGenerator = require('../../src/compiler/jsgen');

const GLOBALS = ['s', 't', 'i', 'k', 'x', 'c0', 'c1', 'c2'];
const LOCALS = ['loc'];
const VARIABLES = [...GLOBALS, ...LOCALS];

const builder = () => {
    const blocks = {};
    let n = 0;
    const add = block => {
        const id = `b${n++}`;
        blocks[id] = {next: null, parent: null, inputs: {}, fields: {}, shadow: false, topLevel: false, ...block};
        return id;
    };
    const input = value => {
        if (typeof value === 'number') return [1, [4, String(value)]];
        if (value.startsWith('$')) return [3, [12, value.slice(1), value.slice(1)], [4, '0']];
        if (value.startsWith('"')) return [1, [10, value.slice(1)]];
        return [3, value, [4, '0']];
    };
    const inputs = record => Object.fromEntries(Object.entries(record).map(([key, value]) => [key, input(value)]));
    const stack = ids => {
        ids.forEach((id, index) => {
            blocks[id].next = ids[index + 1] || null;
        });
        return ids[0] || null;
    };
    const substack = ids => [2, stack(ids)];
    const variable = name => ({VARIABLE: [name, name]});
    const list = {LIST: ['L', 'L']};
    const mutation = (name, argumentNames, warp) => ({
        tagName: 'mutation',
        children: [],
        proccode: `${name}${argumentNames.map(() => ' %s').join('')}`,
        argumentids: JSON.stringify(argumentNames.map(argument => `${name}-${argument}`)),
        argumentnames: JSON.stringify(argumentNames),
        argumentdefaults: JSON.stringify(argumentNames.map(() => '')),
        warp: String(warp)
    });
    const b = {
        set: (name, value) => add({opcode: 'data_setvariableto', inputs: inputs({VALUE: value}),
            fields: variable(name)}),
        change: (name, value) => add({opcode: 'data_changevariableby', inputs: inputs({VALUE: value}),
            fields: variable(name)}),
        repeat: (times, body) => add({opcode: 'control_repeat', inputs: {TIMES: input(times),
            SUBSTACK: substack(body)}}),
        until: (condition, body) => add({opcode: 'control_repeat_until', inputs: {CONDITION: [2, condition],
            SUBSTACK: substack(body)}}),
        forEach: (name, times, body) => add({opcode: 'control_for_each', inputs: {VALUE: input(times),
            SUBSTACK: substack(body)}, fields: variable(name)}),
        when: (condition, body) => add({opcode: 'control_if', inputs: {CONDITION: [2, condition],
            SUBSTACK: substack(body)}}),
        either: (condition, whenTrue, whenFalse) => add({opcode: 'control_if_else', inputs: {
            CONDITION: [2, condition], SUBSTACK: substack(whenTrue), SUBSTACK2: substack(whenFalse)}}),
        stop: () => add({opcode: 'control_stop', fields: {STOP_OPTION: ['this script', null]},
            mutation: {tagName: 'mutation', children: [], hasnext: 'false'}}),
        addToList: value => add({opcode: 'data_addtolist', inputs: inputs({ITEM: value}), fields: list}),
        addTo: (name, value) => add({opcode: 'data_addtolist', inputs: inputs({ITEM: value}),
            fields: {LIST: [name, name]}}),
        replaceItem: (index, value) => add({opcode: 'data_replaceitemoflist',
            inputs: inputs({INDEX: index, ITEM: value}), fields: list}),
        deleteItem: index => add({opcode: 'data_deleteoflist', inputs: inputs({INDEX: index}), fields: list}),
        deleteAll: () => add({opcode: 'data_deletealloflist', fields: list}),
        resetTimer: () => add({opcode: 'sensing_resettimer'}),
        goTo: (x, y) => add({opcode: 'motion_gotoxy', inputs: inputs({X: x, Y: y})}),
        changeX: value => add({opcode: 'motion_changexby', inputs: inputs({DX: value})}),
        setY: value => add({opcode: 'motion_sety', inputs: inputs({Y: value})}),
        point: value => add({opcode: 'motion_pointindirection', inputs: inputs({DIRECTION: value})}),
        call: (procedure, values) => add({opcode: 'procedures_call',
            inputs: Object.fromEntries(procedure.arguments.map((argument, index) =>
                [`${procedure.name}-${argument}`, input(values[index])])),
            mutation: mutation(procedure.name, procedure.arguments, procedure.warp)}),
        op: (opcode, left, right) => add({opcode, inputs: inputs({NUM1: left, NUM2: right})}),
        mathop: (operator, value) => add({opcode: 'operator_mathop', inputs: inputs({NUM: value}),
            fields: {OPERATOR: [operator, null]}}),
        compare: (opcode, left, right) => add({opcode, inputs: inputs({OPERAND1: left, OPERAND2: right})}),
        gt: (left, right) => b.compare('operator_gt', left, right),
        lt: (left, right) => b.compare('operator_lt', left, right),
        equals: (left, right) => b.compare('operator_equals', left, right),
        both: (left, right) => add({opcode: 'operator_and', inputs: {OPERAND1: [2, left], OPERAND2: [2, right]}}),
        any: (left, right) => add({opcode: 'operator_or', inputs: {OPERAND1: [2, left], OPERAND2: [2, right]}}),
        not: operand => add({opcode: 'operator_not', inputs: {OPERAND: [2, operand]}}),
        join: (left, right) => add({opcode: 'operator_join', inputs: inputs({STRING1: left, STRING2: right})}),
        item: index => add({opcode: 'data_itemoflist', inputs: inputs({INDEX: index}), fields: list}),
        length: () => add({opcode: 'data_lengthoflist', fields: list}),
        x: () => add({opcode: 'motion_xposition'}),
        argument: name => add({opcode: 'argument_reporter_string_number', fields: {VALUE: [name, null]}})
    };
    const define = (procedure, body) => {
        const prototype = add({opcode: 'procedures_prototype', shadow: true,
            mutation: mutation(procedure.name, procedure.arguments, procedure.warp)});
        const definition = add({opcode: 'procedures_definition', topLevel: true, x: 0, y: 0,
            inputs: {custom_block: [1, prototype]}});
        blocks[prototype].parent = definition;
        blocks[definition].next = stack(body);
    };
    const whenFlagClicked = body => {
        const hat = add({opcode: 'event_whenflagclicked', topLevel: true, x: 0, y: 0});
        blocks[hat].next = stack(body);
    };
    return {blocks, b, define, whenFlagClicked};
};

const run = async (blocks, compiler, initial = {}) => {
    const vm = new VirtualMachine();
    vm.setCompilerOptions({enabled: compiler});
    await vm.loadProject({
        targets: [
            {isStage: true, name: 'Stage', broadcasts: {}, blocks: {}, comments: {}, currentCostume: 0,
                costumes: [], sounds: [], volume: 100, layerOrder: 0,
                variables: Object.fromEntries(GLOBALS.map(name => [name, [name, 0]])), lists: {L: ['L', []]}},
            {isStage: false, name: 'Sprite', broadcasts: {}, blocks, comments: {}, currentCostume: 0,
                costumes: [], sounds: [], volume: 100, layerOrder: 1, visible: true, x: 0, y: 0, size: 100,
                direction: 90, draggable: false, rotationStyle: 'all around',
                variables: Object.fromEntries(LOCALS.map(name => [name, [name, 0]])), lists: {}}
        ],
        monitors: [],
        extensions: [],
        meta: {semver: '3.0.0', vm: '3.0.0', agent: ''}
    });
    let source = '';
    JSGenerator.testingApparatus = {report: (generator, generated) => {
        source += generated;
    }};
    const stage = vm.runtime.getTargetForStage();
    for (const [name, value] of Object.entries(initial)) stage.variables[name].value = structuredClone(value);
    vm.setTurboMode(true);
    vm.greenFlag();
    for (let step = 0; step < 2000 && vm.runtime.threads.length; step++) vm.runtime._step();
    JSGenerator.testingApparatus = null;
    assert.strictEqual(vm.runtime.threads.length, 0, 'the project did not finish');
    const sprite = vm.runtime.targets.find(target => !target.isStage);
    const state = {};
    for (const name of GLOBALS) state[name] = String(stage.variables[name].value);
    for (const name of LOCALS) state[name] = String(sprite.variables[name].value);
    state.L = stage.variables.L.value.map(String);
    state.position = [sprite.x, sprite.y, sprite.direction].map(String);
    vm.quit();
    return {state, source};
};

const check = async (name, build, initial) => {
    const project = builder();
    build(project);
    const compiled = await run(project.blocks, true, initial);
    const interpreted = await run(project.blocks, false, initial);
    assert.deepStrictEqual(compiled.state, interpreted.state, `${name}: compiled and interpreted results differ`);
    return compiled;
};

const warp = (name, argumentNames = []) => ({name, arguments: argumentNames, warp: true});
const noWarp = (name, argumentNames = []) => ({name, arguments: argumentNames, warp: false});

const inProcedure = (procedure, values, body) => ({b, define, whenFlagClicked}) => {
    define(procedure, body(b));
    whenFlagClicked([b.call(procedure, values)]);
};

const FORWARDED_STORE = /\.value = a\d+ = /;
const LOADED_VARIABLE = /^a\d+ = b\d+\.value;$/m;
const CAST_ARGUMENT = /^a\d+ = \(a\d+ = \+p\d+\) === a\d+ \? a\d+ : 0;$/m;
const count = (source, pattern) => (source.match(pattern) || []).length;

test('a stored value is reused until the variable is written again', async () => {
    const {state, source} = await check('store', inProcedure(warp('p'), [], b => [
        b.set('s', b.op('operator_add', '$t', 3)),
        b.set('i', b.op('operator_multiply', '$s', '$s')),
        b.set('s', b.op('operator_add', '$s', 1)),
        b.set('k', b.op('operator_add', '$s', '$i'))
    ]));
    assert.deepStrictEqual([state.s, state.i, state.k], ['4', '9', '13']);
    assert.match(source, FORWARDED_STORE);
});

test('a variable is loaded once for several reads', async () => {
    const {state, source} = await check('load', inProcedure(warp('p'), [], b => [
        b.set('s', 7),
        b.resetTimer(),
        b.set('t', b.op('operator_add', b.op('operator_multiply', '$s', '$s'), '$s')),
        b.set('i', b.join('$s', '$s'))
    ]));
    assert.deepStrictEqual([state.t, state.i], ['56', '77']);
    assert.match(source, LOADED_VARIABLE);
});

test('an argument is cast once and the cast is hoisted out of loops', async () => {
    const procedure = warp('p', ['a', 'n']);
    const {state, source} = await check('arguments', inProcedure(procedure, [2.5, '"4'], b => [
        b.set('s', b.op('operator_add', b.argument('a'), b.argument('a'))),
        b.repeat(b.argument('n'), [
            b.change('t', b.op('operator_multiply', b.argument('a'), b.argument('n'))),
            b.addToList(b.op('operator_subtract', b.argument('n'), '$t'))
        ]),
        b.set('i', b.join(b.argument('a'), b.argument('n')))
    ]));
    assert.deepStrictEqual([state.s, state.t, state.i], ['5', '40', '2.54']);
    assert.deepStrictEqual(state.L, ['-6', '-16', '-26', '-36']);
    assert.strictEqual(count(source, /\+p0/g), 1);
    assert.strictEqual(count(source, /\+p1/g), 1);
    assert.match(source, CAST_ARGUMENT);
});

test('a variable a loop does not write is loaded before the loop', async () => {
    const {state, source} = await check('invariant', inProcedure(warp('p'), [], b => [
        b.set('s', 3),
        b.set('t', 0),
        b.resetTimer(),
        b.repeat(5, [
            b.goTo(b.op('operator_multiply', '$s', 2), '$s'),
            b.addToList(b.op('operator_add', '$s', b.length()))
        ])
    ]));
    assert.deepStrictEqual(state.L, ['3', '4', '5', '6', '7']);
    assert.deepStrictEqual(state.position, ['6', '3', '90']);
    const loop = source.indexOf('for (var');
    const load = source.search(LOADED_VARIABLE);
    assert.ok(load !== -1 && load < loop, 'the load is not before the loop');
});

test('writes end the reuse of a value', async () => {
    const helper = warp('bump');
    const procedure = warp('p', ['a']);
    const {state} = await check('writes', ({b, define, whenFlagClicked}) => {
        define(helper, [b.change('s', 10), b.addToList('$s')]);
        define(procedure, [
            b.set('s', 1),
            b.set('t', b.op('operator_add', '$s', '$s')),
            b.call(helper, []),
            b.set('i', b.op('operator_add', '$s', '$s')),
            b.forEach('s', 3, [b.change('k', b.op('operator_multiply', '$s', '$s'))]),
            b.set('x', b.op('operator_add', '$s', '$s')),
            b.repeat(3, [b.change('loc', '$s'), b.change('s', b.op('operator_add', '$s', '$loc'))]),
            b.either(b.gt('$s', 100), [b.set('s', 5)], [b.change('s', 1)]),
            b.set('c0', b.op('operator_add', '$s', '$s'))
        ]);
        whenFlagClicked([b.call(procedure, [1])]);
    });
    assert.deepStrictEqual([state.t, state.i, state.k, state.x], ['2', '22', '14', '6']);
    assert.deepStrictEqual([state.loc, state.s, state.c0], ['42', '5', '10']);
});

test('branches that stop the script do not leak their values', async () => {
    const procedure = warp('p', ['a']);
    const body = b => [
        b.set('s', b.argument('a')),
        b.when(b.gt('$s', 5), [b.set('s', b.op('operator_subtract', '$s', 5)), b.set('t', '$s'), b.stop()]),
        b.when(b.lt('$s', 2), [b.set('s', 100)]),
        b.set('i', b.op('operator_add', '$s', '$s'))
    ];
    const high = await check('stops', inProcedure(procedure, [9], body));
    assert.deepStrictEqual([high.state.s, high.state.t, high.state.i], ['4', '4', '0']);
    const low = await check('continues', inProcedure(procedure, [1], body));
    assert.deepStrictEqual([low.state.s, low.state.i], ['100', '200']);
    const middle = await check('unchanged', inProcedure(procedure, [3], body));
    assert.deepStrictEqual([middle.state.s, middle.state.i], ['3', '6']);
});

test('a loop that yields reloads variables another script changes', async () => {
    const procedure = noWarp('p', ['a']);
    const {state} = await check('yields', ({b, define, whenFlagClicked}) => {
        define(procedure, [
            b.set('s', 0),
            b.repeat(6, [
                b.change('t', b.op('operator_add', '$s', '$s')),
                b.addToList(b.join('$s', b.argument('a')))
            ]),
            b.set('i', b.op('operator_add', '$s', '$s'))
        ]);
        whenFlagClicked([b.call(procedure, ['"z'])]);
        whenFlagClicked([b.repeat(8, [b.change('s', 1)])]);
    });
    assert.deepStrictEqual(state.L, ['0z', '1z', '2z', '3z', '4z', '5z']);
    assert.deepStrictEqual([state.t, state.i], ['30', '12']);
});

test('a script that calls itself without warp sees what other scripts wrote', async () => {
    const procedure = noWarp('p', ['a']);
    const {state} = await check('recursion', ({b, define, whenFlagClicked}) => {
        define(procedure, [
            b.when(b.gt(b.argument('a'), 0), [
                b.set('t', '$s'),
                b.call(procedure, [b.op('operator_subtract', b.argument('a'), 1)]),
                b.addToList(b.op('operator_subtract', '$s', '$t'))
            ])
        ]);
        whenFlagClicked([b.call(procedure, [3])]);
        whenFlagClicked([b.repeat(8, [b.change('s', 1)])]);
    });
    assert.strictEqual(state.L.length, 3);
});

test('a script that calls itself reads its inputs after it yields', async () => {
    const procedure = noWarp('p', ['a', 'v']);
    const project = builder();
    const {b, define, whenFlagClicked} = project;
    define(procedure, [
        b.addToList(b.argument('v')),
        b.when(b.gt(b.argument('a'), 0), [
            b.set('t', b.op('operator_add', '$s', '$s')),
            b.call(procedure, [b.op('operator_subtract', b.argument('a'), 1), b.op('operator_add', '$s', 0)])
        ])
    ]);
    whenFlagClicked([b.call(procedure, [3, '"start'])]);
    whenFlagClicked([b.repeat(8, [b.change('s', 1)])]);
    const {state} = await run(project.blocks, true);
    assert.deepStrictEqual(state.L, ['start', '1', '2', '3']);
});

test('a list block that names a variable ends reuse of that variable', async () => {
    const {state} = await check('shared', inProcedure(warp('p'), [], b => [
        b.set('t', b.join('$k', '$k')),
        b.addTo('k', 5),
        b.set('i', b.join('$k', '$k'))
    ]), {k: [1, 2]});
    assert.deepStrictEqual([state.t, state.i, state.k], ['1,21,2', '1,2,51,2,5', '1,2,5']);
});

test('a list and a variable with the same id do not share a value', async () => {
    const {state} = await check('list', inProcedure(warp('p'), [], b => [
        b.set('s', 2),
        b.addToList('$s'),
        b.addToList(b.op('operator_add', '$s', '$s')),
        b.replaceItem(1, b.op('operator_multiply', '$s', b.item(2))),
        b.set('t', b.join(b.item(1), b.item(2)))
    ]));
    assert.deepStrictEqual(state.L, ['8', '4']);
    assert.strictEqual(state.t, '84');
});

test('chains of equality checks still compile to a switch', async () => {
    const procedure = warp('p', ['a']);
    const body = b => [
        b.goTo(b.argument('a'), 0),
        b.set('s', b.x()),
        b.set('i', b.op('operator_add', '$s', '$s')),
        b.when(b.equals('$s', 1), [b.set('t', 10), b.stop()]),
        b.when(b.equals('$s', 2), [b.set('t', 20), b.stop()]),
        b.when(b.equals('$s', 3), [b.set('t', 30), b.stop()]),
        b.set('t', b.op('operator_add', '$s', '$i'))
    ];
    const second = await check('switch', inProcedure(procedure, [2], body));
    assert.deepStrictEqual([second.state.i, second.state.t], ['4', '20']);
    assert.match(second.source, /switch \(a\d+\) \{/);
    const none = await check('switch default', inProcedure(procedure, [7], body));
    assert.deepStrictEqual([none.state.i, none.state.t], ['14', '21']);
});

const random = seed => () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let mixed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
};

const CONSTANTS = [0, 1, 2, 3, 5, -1, -4, 0.5, 2.25, 10, '"', '"abc', '"3', '"-2', '"true', '"Infinity', '"NaN'];
const WRITABLE = ['s', 't', 'i', 'k', 'x', 'loc'];
const COUNTERS = ['c0', 'c1', 'c2'];
const ARITHMETIC = ['operator_add', 'operator_subtract', 'operator_multiply', 'operator_divide', 'operator_mod'];
const MATH = ['abs', 'floor', 'sqrt', 'ceiling'];

const generate = (seed, {b, define, whenFlagClicked}) => {
    const next = random(seed);
    const pick = options => options[Math.floor(next() * options.length)];
    const procedures = [0, 1, 2].map(index => ({name: `p${index}`, arguments: ['a', 'n'], warp: next() < 0.6}));

    const value = (scope, depth) => {
        const roll = next();
        if (depth <= 0 || roll < 0.2) return pick(CONSTANTS);
        if (roll < 0.5) return `$${pick([...WRITABLE, ...COUNTERS])}`;
        if (roll < 0.62 && scope.procedure) return b.argument(pick(scope.procedure.arguments));
        if (roll < 0.82) return b.op(pick(ARITHMETIC), value(scope, depth - 1), value(scope, depth - 1));
        if (roll < 0.87) return b.join(value(scope, depth - 1), value(scope, depth - 1));
        if (roll < 0.91) return b.mathop(pick(MATH), value(scope, depth - 1));
        if (roll < 0.95) return b.item(value(scope, depth - 1));
        if (roll < 0.97) return b.length();
        return b.x();
    };

    const condition = (scope, depth) => {
        const roll = next();
        if (depth > 0 && roll < 0.1) return b.both(condition(scope, depth - 1), condition(scope, depth - 1));
        if (depth > 0 && roll < 0.2) return b.any(condition(scope, depth - 1), condition(scope, depth - 1));
        if (depth > 0 && roll < 0.27) return b.not(condition(scope, depth - 1));
        return b.compare(pick(['operator_gt', 'operator_lt', 'operator_equals']), value(scope, 2), value(scope, 2));
    };

    const statements = (scope, depth, length) => {
        const result = [];
        for (let index = 0; index < length; index++) result.push(statement(scope, depth));
        return result;
    };

    const statement = (scope, depth) => {
        const roll = next();
        const inner = () => statements(scope, depth - 1, 1 + Math.floor(next() * 3));
        if (roll < 0.26) return b.set(pick(WRITABLE), value(scope, 3));
        if (roll < 0.4) return b.change(pick(WRITABLE), value(scope, 2));
        if (roll < 0.47) return b.addToList(value(scope, 2));
        if (roll < 0.5) return b.replaceItem(value(scope, 1), value(scope, 2));
        if (roll < 0.52) return next() < 0.5 ? b.deleteAll() : b.deleteItem(value(scope, 1));
        if (roll < 0.57) return pick([
            () => b.goTo(value(scope, 2), value(scope, 2)),
            () => b.changeX(value(scope, 2)),
            () => b.setY(value(scope, 2)),
            () => b.point(value(scope, 2))
        ])();
        if (roll < 0.6) return b.resetTimer();
        if (depth > 0 && roll < 0.68) return b.when(condition(scope, 1), inner());
        if (depth > 0 && roll < 0.76) return b.either(condition(scope, 1), inner(), inner());
        if (depth > 0 && roll < 0.82) {
            const times = next() < 0.5 ? Math.floor(next() * 4) : b.op('operator_mod', value(scope, 1), 4);
            return b.repeat(times, inner());
        }
        if (depth > 0 && roll < 0.86) return b.forEach(pick(WRITABLE), Math.floor(next() * 4), inner());
        if (depth > 0 && roll < 0.9 && scope.counters.length) {
            const counter = scope.counters[0];
            const nested = {...scope, counters: scope.counters.slice(1)};
            const body = statements(nested, depth - 1, 1 + Math.floor(next() * 2));
            return b.until(b.gt(`$${counter}`, Math.floor(next() * 4)), [...body, b.change(counter, 1)]);
        }
        if (roll < 0.96 && scope.callable.length) {
            return b.call(pick(scope.callable), [value(scope, 2), value(scope, 2)]);
        }
        if (roll < 0.98 && depth < 3) return b.stop();
        return b.set(pick(WRITABLE), value(scope, 2));
    };

    procedures.forEach((procedure, index) => {
        const scope = {procedure, callable: procedures.slice(index + 1), counters: [COUNTERS[index]]};
        define(procedure, statements(scope, 3, 3 + Math.floor(next() * 5)));
    });
    const main = {procedure: null, callable: procedures, counters: []};
    whenFlagClicked([
        ...statements(main, 2, 2 + Math.floor(next() * 3)),
        b.call(procedures[0], [value(main, 2), value(main, 2)]),
        b.call(procedures[0], [value(main, 2), value(main, 2)])
    ]);
    whenFlagClicked([b.repeat(6, [b.change(pick(WRITABLE), 1), b.set(pick(WRITABLE), `$${pick(WRITABLE)}`)])]);
};

const PROGRAMS_PER_TEST = 50;
for (let group = 0; group < 6; group++) {
    test(`random programs leave the same results compiled and interpreted (group ${group})`, async () => {
        let reused = 0;
        for (let index = 0; index < PROGRAMS_PER_TEST; index++) {
            const seed = (group * PROGRAMS_PER_TEST) + index + 1;
            const {source} = await check(`seed ${seed}`, project => generate(seed, project));
            if (FORWARDED_STORE.test(source) || LOADED_VARIABLE.test(source)) reused++;
        }
        assert.ok(reused > PROGRAMS_PER_TEST / 2, `only ${reused} programs reused a value`);
    });
}
