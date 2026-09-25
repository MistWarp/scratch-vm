const {test} = require('tap');
const VirtualMachine = require('../../src/virtual-machine');
const JSGenerator = require('../../src/compiler/jsgen');
const BlockType = require('../../src/extension-support/block-type');
const ArgumentType = require('../../src/extension-support/argument-type');

/**
 * @fileoverview
 * Constant folding happens on the intermediate representation. Folding must be invisible: a
 * script built from literals has to produce exactly the values the same script produces when
 * the operands arrive in variables at runtime, and the values the interpreter produces.
 */

const NUMBERS = ['NaN', '-Infinity', '-1e+308', '-7', '-1', '-0.5', '-0', '0', '0.5', '1', '4', '7', '1e+308', 'Infinity'];
const STRINGS = ['', ' ', '\t', '0', '00', '1', '1.0', '-0', 'abc', 'ABC', 'Hello World', 'true', 'TRUE', 'false', '1e3', 'NaN', 'Infinity', '🎉'];
const INDEXES = ['-1', '0', '1', '2', '1.5', '5', '11', 'abc', ''];

const BINARY_OPERATORS = [
    {opcode: 'operator_add', inputs: ['NUM1', 'NUM2'], values: NUMBERS},
    {opcode: 'operator_subtract', inputs: ['NUM1', 'NUM2'], values: NUMBERS},
    {opcode: 'operator_multiply', inputs: ['NUM1', 'NUM2'], values: NUMBERS},
    {opcode: 'operator_divide', inputs: ['NUM1', 'NUM2'], values: NUMBERS},
    {opcode: 'operator_mod', inputs: ['NUM1', 'NUM2'], values: NUMBERS},
    {opcode: 'operator_equals', inputs: ['OPERAND1', 'OPERAND2'], values: [...NUMBERS, ...STRINGS]},
    {opcode: 'operator_gt', inputs: ['OPERAND1', 'OPERAND2'], values: [...NUMBERS, ...STRINGS]},
    {opcode: 'operator_lt', inputs: ['OPERAND1', 'OPERAND2'], values: [...NUMBERS, ...STRINGS]},
    {opcode: 'operator_join', inputs: ['STRING1', 'STRING2'], values: [...NUMBERS, ...STRINGS]},
    {opcode: 'operator_contains', inputs: ['STRING1', 'STRING2'], values: STRINGS},
    {opcode: 'operator_index_of', inputs: ['SUBSTRING', 'STRING'], values: STRINGS},
    {opcode: 'operator_letter_of', inputs: ['LETTER', 'STRING'], left: INDEXES, right: STRINGS},
    {opcode: 'operator_repeat', inputs: ['STRING', 'REPEAT'], left: STRINGS, right: ['-1', '0', '1', '2.7', '3', 'NaN']}
];

const UNARY_OPERATORS = [
    {opcode: 'operator_length', inputs: ['STRING'], values: STRINGS},
    {opcode: 'operator_trim', inputs: ['STRING'], values: STRINGS},
    {opcode: 'operator_change_case', inputs: ['STRING'], values: STRINGS, fields: {CASE: ['uppercase', null]}},
    {opcode: 'operator_change_case', inputs: ['STRING'], values: STRINGS, fields: {CASE: ['lowercase', null]}},
    {opcode: 'operator_round', inputs: ['NUM'], values: NUMBERS},
    ...['abs', 'floor', 'ceiling', 'sqrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'ln', 'log', 'e ^', '10 ^']
        .map(operator => ({opcode: 'operator_mathop', inputs: ['NUM'], values: NUMBERS, fields: {OPERATOR: [operator, null]}}))
];

const TERNARY_OPERATORS = [
    {opcode: 'operator_letters_of', inputs: ['LETTER1', 'LETTER2', 'STRING'], values: [INDEXES, INDEXES, STRINGS]},
    {opcode: 'operator_replace', inputs: ['SUBSTRING', 'STRING', 'REPLACE'], values: [STRINGS, STRINGS, ['', 'x', 'ABC']]}
];

const VARIABLE_IDS = ['v1', 'v2', 'v3'];

const literal = value => [1, [10, value]];

/**
 * Build a stage whose flag script reports every case twice: once from literals, once from variables.
 * @param {Array<{opcode: string, inputs: string[], fields?: object, operands: string[]}>} cases
 * @returns {object} project JSON
 */
const buildProject = cases => {
    const blocks = {};
    let previous = null;
    const append = (id, block) => {
        blocks[id] = Object.assign({next: null, parent: previous, fields: {}, inputs: {}, topLevel: false}, block);
        if (previous) blocks[previous].next = id;
        previous = id;
    };
    append('flag', {opcode: 'event_whenflagclicked', topLevel: true, x: 0, y: 0});

    cases.forEach((testCase, index) => {
        const literalInputs = {};
        const variableInputs = {};
        testCase.inputs.forEach((name, i) => {
            literalInputs[name] = literal(testCase.operands[i]);
            const getterId = `get${index}_${i}`;
            blocks[getterId] = {
                opcode: 'data_variable',
                next: null,
                parent: `variable${index}`,
                inputs: {},
                fields: {VARIABLE: [VARIABLE_IDS[i], VARIABLE_IDS[i]]},
                topLevel: false
            };
            variableInputs[name] = [3, getterId, [10, '']];
        });
        const fields = testCase.fields || {};

        blocks[`literalOp${index}`] = {
            opcode: testCase.opcode, next: null, parent: `literal${index}`, inputs: literalInputs, fields, topLevel: false
        };
        append(`literal${index}`, {
            opcode: 'fold_report',
            inputs: {TAG: literal('literal'), INPUT: [3, `literalOp${index}`, [10, '']]}
        });

        testCase.operands.forEach((operand, i) => {
            append(`set${index}_${i}`, {
                opcode: 'data_setvariableto',
                inputs: {VALUE: literal(operand)},
                fields: {VARIABLE: [VARIABLE_IDS[i], VARIABLE_IDS[i]]}
            });
        });
        blocks[`variableOp${index}`] = {
            opcode: testCase.opcode, next: null, parent: `variable${index}`, inputs: variableInputs, fields, topLevel: false
        };
        append(`variable${index}`, {
            opcode: 'fold_report',
            inputs: {TAG: literal('variable'), INPUT: [3, `variableOp${index}`, [10, '']]}
        });
    });

    const variables = {};
    for (const id of VARIABLE_IDS) variables[id] = [id, 0];

    return {
        targets: [{
            isStage: true,
            name: 'Stage',
            variables,
            lists: {},
            broadcasts: {},
            blocks,
            currentCostume: 0,
            costumes: [{name: 'backdrop1', dataFormat: 'svg', assetId: 'cd21514d0531fdffb22204e0ec5ed84a', md5ext: 'cd21514d0531fdffb22204e0ec5ed84a.svg'}],
            sounds: [],
            volume: 100
        }],
        monitors: [],
        extensions: [],
        meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
    };
};

class ReportExtension {
    constructor () {
        this.results = {literal: [], variable: []};
    }
    getInfo () {
        return {
            id: 'fold',
            name: 'Fold',
            blocks: [{
                opcode: 'report',
                blockType: BlockType.COMMAND,
                text: 'report [TAG] [INPUT]',
                arguments: {
                    TAG: {type: ArgumentType.STRING},
                    INPUT: {type: ArgumentType.STRING}
                }
            }]
        };
    }
    report (args) {
        this.results[args.TAG].push(args.INPUT);
    }
}

/**
 * @param {object} project
 * @param {boolean} compile
 * @returns {Promise<{results: object, source: string}>}
 */
const run = async (project, compile) => {
    const vm = new VirtualMachine();
    const reporter = new ReportExtension();
    vm.extensionManager.addBuiltinExtension('fold', class {
        constructor () {
            return reporter;
        }
    });
    vm.setCompilerOptions({enabled: compile});
    vm.on('COMPILE_ERROR', (target, error) => {
        throw new Error(`Compile error: ${error}`);
    });
    await vm.loadProject(project);

    let source = '';
    JSGenerator.testingApparatus = {report: (_generator, generated) => {
        source += generated;
    }};
    vm.greenFlag();
    while (vm.runtime.threads.length !== 0) {
        vm.runtime._step();
    }
    JSGenerator.testingApparatus = null;
    return {results: reporter.results, source};
};

const describe = (testCase, index) => `${testCase.opcode}${JSON.stringify(testCase.fields || {})}(${testCase.operands.map(o => JSON.stringify(o)).join(', ')}) #${index}`;

const show = value => (Object.is(value, -0) ? '-0' : JSON.stringify(value)) + ` (${typeof value})`;

const expandCases = () => {
    const cases = [];
    for (const operator of BINARY_OPERATORS) {
        const left = operator.left || operator.values;
        const right = operator.right || operator.values;
        for (const a of left) {
            for (const b of right) {
                cases.push({opcode: operator.opcode, inputs: operator.inputs, fields: operator.fields, operands: [a, b]});
            }
        }
    }
    for (const operator of UNARY_OPERATORS) {
        for (const a of operator.values) {
            cases.push({opcode: operator.opcode, inputs: operator.inputs, fields: operator.fields, operands: [a]});
        }
    }
    for (const operator of TERNARY_OPERATORS) {
        for (const a of operator.values[0]) {
            for (const b of operator.values[1]) {
                for (const c of operator.values[2]) {
                    cases.push({opcode: operator.opcode, inputs: operator.inputs, operands: [a, b, c]});
                }
            }
        }
    }
    return cases;
};

test('folded literals match the same operators run on variables and in the interpreter', async t => {
    const cases = expandCases();
    const project = buildProject(cases);

    const compiled = await run(project, true);
    const interpreted = await run(project, false);

    t.equal(compiled.results.literal.length, cases.length, 'every literal case reported');
    t.equal(compiled.results.variable.length, cases.length, 'every variable case reported');
    t.equal(interpreted.results.variable.length, cases.length, 'every interpreted case reported');

    let failures = 0;
    cases.forEach((testCase, i) => {
        const folded = compiled.results.literal[i];
        const runtime = compiled.results.variable[i];
        const reference = interpreted.results.variable[i];
        if (!Object.is(folded, runtime)) {
            failures++;
            t.fail(`${describe(testCase, i)}: folded ${show(folded)} but the compiled runtime gave ${show(runtime)}`);
        }
        if (!Object.is(folded, reference)) {
            failures++;
            t.fail(`${describe(testCase, i)}: folded ${show(folded)} but the interpreter gave ${show(reference)}`);
        }
    });
    t.equal(failures, 0, `${cases.length} cases fold to the value the runtime computes`);

    // tap's own matchers are far too slow on a source this large.
    t.notOk(/compareEqual\("/.test(compiled.source), 'no comparison of two literals is left for runtime');
    t.end();
});

/**
 * Compile a single stage script and return the generated source.
 * @param {object} blocks sb3 blocks, with a block with id "flag" as the hat.
 * @param {object} [extra] Extra stage properties.
 * @returns {Promise<string>}
 */
const compileScript = async (blocks, extra = {}) => {
    const vm = new VirtualMachine();
    vm.setCompilerOptions({enabled: true});
    vm.on('COMPILE_ERROR', (target, error) => {
        throw new Error(`Compile error: ${error}`);
    });
    await vm.loadProject({
        targets: [Object.assign({
            isStage: true,
            name: 'Stage',
            variables: {v1: ['v1', 0], v2: ['v2', 0]},
            lists: {},
            broadcasts: {},
            blocks,
            currentCostume: 0,
            costumes: [],
            sounds: [],
            volume: 100
        }, extra)],
        monitors: [],
        extensions: [],
        meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
    });
    let source = '';
    JSGenerator.testingApparatus = {report: (_generator, generated) => {
        source += generated;
    }};
    vm.runtime.precompile();
    JSGenerator.testingApparatus = null;
    return source;
};

const block = (opcode, inputs = {}, fields = {}, extra = {}) => Object.assign({opcode, inputs, fields, next: null, parent: null, topLevel: false}, extra);
const say = (id, message) => block('looks_say', {MESSAGE: message}, {}, {id});
const chain = list => {
    const blocks = {};
    for (let i = 0; i < list.length; i++) {
        const entry = list[i];
        blocks[entry.id] = entry;
        entry.next = i + 1 < list.length ? list[i + 1].id : null;
        entry.parent = i > 0 ? list[i - 1].id : null;
        delete entry.id;
    }
    return blocks;
};
const flag = () => block('event_whenflagclicked', {}, {}, {id: 'flag', topLevel: true, x: 0, y: 0});
const variable = name => block('data_variable', {}, {VARIABLE: [name, name]});

test('constant conditions choose their branch at compile time', async t => {
    const source = await compileScript(Object.assign(chain([
        flag(),
        block('control_if_else', {CONDITION: [2, 'cond'], SUBSTACK: [2, 'yes'], SUBSTACK2: [2, 'no']}, {}, {id: 'if'}),
        block('control_repeat', {TIMES: literal('0'), SUBSTACK: [2, 'never']}, {}, {id: 'repeat'}),
        block('control_wait_until', {CONDITION: [2, 'alwaysTrue']}, {}, {id: 'wait'}),
        block('control_repeat_until', {CONDITION: [2, 'notNot'], SUBSTACK: [2, 'loopBody']}, {}, {id: 'until'})
    ]), {
        cond: block('operator_equals', {OPERAND1: literal('1'), OPERAND2: literal('1.0')}),
        yes: say('yes', literal('taken')),
        no: say('no', literal('skipped')),
        never: say('never', literal('never')),
        alwaysTrue: block('operator_gt', {OPERAND1: literal('b'), OPERAND2: literal('A')}),
        notNot: block('operator_not', {OPERAND: [2, 'inner']}),
        inner: block('operator_not', {OPERAND: [2, 'compare']}),
        compare: block('operator_lt', {OPERAND1: [2, 'v1'], OPERAND2: literal('10')}),
        v1: variable('v1'),
        loopBody: say('loopBody', literal('looping'))
    }));

    t.match(source, /_say\("taken", target\)/, 'the true branch is kept');
    t.notMatch(source, /skipped|never/, 'the false branch and an empty repeat are gone');
    t.notMatch(source, /if \(/, 'no runtime condition remains');
    t.notMatch(source, /while \(!true\)|!!/, 'wait until true is gone and not-not is cancelled');
    t.match(source, /while \(!compareLessThan\(b0\.value, 10\)\) \{/, 'repeat until keeps the loop condition');
    t.end();
});

test('folding never drops an input whose evaluation could be observed', async t => {
    const source = await compileScript(Object.assign(chain([
        flag(),
        say('pureAnd', [2, 'pureAndFalse']),
        say('shortCircuit', [2, 'falseAndCall']),
        say('kept', [2, 'callAndFalse'])
    ]), {
        pureAndFalse: block('operator_and', {OPERAND1: [2, 'pureCondition'], OPERAND2: [2, 'no1']}),
        pureCondition: block('operator_lt', {OPERAND1: [2, 'v1'], OPERAND2: literal('10')}),
        v1: variable('v1'),
        no1: block('operator_equals', {OPERAND1: literal('1'), OPERAND2: literal('2')}),
        falseAndCall: block('operator_and', {OPERAND1: [2, 'no2'], OPERAND2: [2, 'call1']}),
        no2: block('operator_equals', {OPERAND1: literal('1'), OPERAND2: literal('2')}),
        call1: block('procedures_call', {}, {}, {mutation: {tagName: 'mutation', children: [], proccode: 'side effect', argumentids: '[]', warp: 'false'}}),
        callAndFalse: block('operator_and', {OPERAND1: [2, 'call2'], OPERAND2: [2, 'no3']}),
        call2: block('procedures_call', {}, {}, {mutation: {tagName: 'mutation', children: [], proccode: 'side effect', argumentids: '[]', warp: 'false'}}),
        no3: block('operator_equals', {OPERAND1: literal('1'), OPERAND2: literal('2')}),
        definition: block('procedures_definition', {custom_block: [1, 'prototype']}, {}, {topLevel: true, x: 0, y: 0, next: 'body'}),
        body: say('body', literal('side effect')),
        prototype: block('procedures_prototype', {}, {}, {shadow: true, mutation: {tagName: 'mutation', children: [], proccode: 'side effect', argumentids: '[]', argumentnames: '[]', argumentdefaults: '[]', warp: 'false'}})
    }));

    t.match(source, /_say\(false, target\);\n\w+\.ext_scratch3_looks\._say\(false, target\)/, 'a pure operand and a short-circuited call fold to false');
    t.match(source, /_say\(toBoolean\(thread\.procedures\["Zside effect"\]\(\)\) && false, target\)/, 'a call on the evaluated side stays');
    t.end();
});

test('folded values keep their runtime type and Scratch semantics', async t => {
    const source = await compileScript(Object.assign(chain([
        flag(),
        say('join', [2, 'joinNumbers']),
        say('nan', [2, 'sqrtNegative']),
        say('cast', [2, 'nanPlusOne']),
        say('mod', [2, 'negativeMod']),
        say('reassociated', [2, 'outerJoin']),
        say('lower', [2, 'equalsVariable'])
    ]), {
        joinNumbers: block('operator_join', {STRING1: literal('1'), STRING2: literal('2')}),
        sqrtNegative: block('operator_mathop', {NUM: literal('-1')}, {OPERATOR: ['sqrt', null]}),
        nanPlusOne: block('operator_add', {NUM1: [2, 'sqrtNegative2'], NUM2: literal('1')}),
        sqrtNegative2: block('operator_mathop', {NUM: literal('-1')}, {OPERATOR: ['sqrt', null]}),
        negativeMod: block('operator_mod', {NUM1: literal('-4'), NUM2: literal('4')}),
        outerJoin: block('operator_join', {STRING1: [2, 'innerJoin'], STRING2: literal('b')}),
        innerJoin: block('operator_join', {STRING1: [2, 'v1'], STRING2: literal('a')}),
        v1: variable('v1'),
        equalsVariable: block('operator_equals', {OPERAND1: [2, 'v2'], OPERAND2: literal('BaBaB')}),
        v2: variable('v2')
    }));

    t.match(source, /_say\("12", target\)/, 'join of two numbers stays a string');
    t.match(source, /_say\(NaN, target\)/, 'a folded NaN is emitted as NaN');
    t.match(source, /_say\(1, target\)/, 'a NaN cast to a number is 0 before adding');
    t.match(source, /_say\(-0, target\)/, '-4 mod 4 is -0 like the interpreter');
    t.match(source, /_say\("" \+ b0\.value \+ "ab", target\)/, 'neighbouring join literals merge');
    t.match(source, /\("" \+ b1\.value\)\.toLowerCase\(\) === "babab"/, 'the literal side of a comparison is lowercased now');
    t.end();
});

test('generated expressions only use the parentheses they need', async t => {
    const source = await compileScript(Object.assign(chain([
        flag(),
        block('data_setvariableto', {VALUE: [2, 'sum']}, {VARIABLE: ['v1', 'v1']}, {id: 'set'}),
        block('data_changevariableby', {VALUE: literal('-1')}, {VARIABLE: ['v1', 'v1']}, {id: 'change'}),
        block('control_if', {CONDITION: [2, 'compare'], SUBSTACK: [2, 'inner']}, {}, {id: 'if'})
    ]), {
        sum: block('operator_add', {NUM1: [2, 'product'], NUM2: [2, 'v1a']}),
        product: block('operator_multiply', {NUM1: [2, 'v1b'], NUM2: [2, 'difference']}),
        difference: block('operator_subtract', {NUM1: [2, 'v2a'], NUM2: literal('3')}),
        v1a: variable('v1'),
        v1b: variable('v1'),
        v2a: variable('v2'),
        compare: block('operator_lt', {OPERAND1: [2, 'sum2'], OPERAND2: literal('10')}),
        sum2: block('operator_add', {NUM1: [2, 'v1c'], NUM2: literal('1')}),
        v1c: variable('v1'),
        inner: say('inner', [2, 'joined']),
        joined: block('operator_join', {STRING1: literal('x='), STRING2: [2, 'v1d']}),
        v1d: variable('v1')
    }));

    t.match(source, /b0\.value = toNotNaN\(toNotNaN\(\+b0\.value\) \* \(toNotNaN\(\+b1\.value\) - 3\)\) \+ toNotNaN\(\+b0\.value\);/, 'nested arithmetic');
    t.match(source, /b0\.value = toNotNaN\(b0\.value\) - 1;/, 'adding a negative literal subtracts');
    t.match(source, /if \(b0\.value \+ 1 < 10\) \{/, 'conditions are not double wrapped');
    t.match(source, /_say\("x=" \+ b0\.value, target\)/, 'joining onto a string needs no cast');
    t.end();
});

test('raw source inputs keep the expression the author wrote', async t => {
    const source = await compileScript(Object.assign(chain([
        flag(),
        block('patching_jscommand', {
            ARG1: literal('globalThis.__x = '),
            ARG2: [2, 'joined'],
            ARG3: literal(';')
        }, {}, {id: 'patch', mutation: {tagName: 'mutation', children: [], itemcount: '3'}})
    ]), {
        joined: block('operator_join', {STRING1: literal('a'), STRING2: literal('b')})
    }), {});

    t.match(source, /globalThis\.__x = \("a" \+ "b"\);/, 'a literal is not spliced as bare source');
    t.end();
});
