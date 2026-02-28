const test = require('tap').test;

const VariablePool = require('../../src/compiler/variable-pool');
const compatBlocks = require('../../src/compiler/compat-blocks');
const CompatBlockUtility = require('../../src/compiler/compat-block-utility');
const IR = require('../../src/compiler/intermediate');
const {BLOCKS, TYPES, isNumber, isPositive} = require('../../src/compiler/enums');
const {IROptimizer} = require('../../src/compiler/iroptimizer');
const execute = require('../../src/compiler/jsexecute');
const {ConstantInput} = require('../../src/compiler/inputs');

test('VariablePool basic', t => {
    t.throws(() => new VariablePool('   '), { message: /prefix cannot be empty/ });
    const p = new VariablePool('v');
    t.equal(p.next(), 'v0');
    t.equal(p.next(), 'v1');
    t.end();
});

test('compat-blocks exports arrays', t => {
    t.ok(Array.isArray(compatBlocks.stacked));
    t.ok(Array.isArray(compatBlocks.inputs));
    // sanity check a couple known entries
    t.ok(compatBlocks.stacked.indexOf('sound_play') !== -1);
    t.ok(compatBlocks.inputs.indexOf('sound_volume') !== -1);
    t.end();
});

test('IntermediateScript defaults', t => {
    const s = new IR.IntermediateScript();
    t.equal(s.topBlockId, null);
    t.equal(s.isProcedure, false);
    t.equal(s.yields, true);
    const ir = new IR.IntermediateRepresentation();
    t.equal(ir.entry, null);
    t.same(ir.procedures, {});
    t.end();
});

test('CompatibilityLayerBlockUtility behavior', t => {
    t.throws(() => CompatBlockUtility.startProcedure(), /not supported/);
    t.throws(() => CompatBlockUtility.initParams(), /not supported/);
    t.throws(() => CompatBlockUtility.pushParam(), /not supported/);
    t.throws(() => CompatBlockUtility.getParam(), /not supported/);
    // startBranch should set internal state
    CompatBlockUtility.startBranch(2, true);
    t.same(CompatBlockUtility._startedBranch, [2, true]);
    t.end();
});

test('jsexecute helpers: boolean, precision, compare, list ops, math', t => {
    // toBoolean
    t.equal(execute.scopedEval('toBoolean(true)'), true);
    t.equal(execute.scopedEval("toBoolean('0')"), false);
    t.equal(execute.scopedEval("toBoolean('false')"), false);

    // limitPrecision
    t.equal(execute.scopedEval('limitPrecision(1.0000000001)'), 1);
    t.equal(execute.scopedEval('limitPrecision(1.0001)'), 1.0001);

    // compareEqual, greater, less
    t.equal(execute.scopedEval('compareEqual("abc","Abc")'), true);
    t.equal(execute.scopedEval('compareEqual(2,2)'), true);
    t.equal(execute.scopedEval('compareGreaterThan(5,2)'), true);
    t.equal(execute.scopedEval('compareLessThan(1,2)'), true);

    // list helpers: prepare a list object and run several ops
    const listResult = execute.scopedEval(`(function(){
        globalState.vm = { runtime: { runtimeOptions: { caseSensitiveLists: false } } };
        const l = { value: ['a','B','3'], _monitorUpToDate: true };
        const containsA = listContains(l, 'A');
        const idxB = listIndexOf(l, 'B');
        listReplace(l, 2, 'X');
        const replaced = l.value[1];
        listInsert(l, 'last', 'Z');
        listDelete(l, 1);
        const contents = listContents(l);
        return { containsA, idxB, replaced, contents, final: l.value };
    })()`);
    t.equal(listResult.containsA, true);
    t.equal(listResult.idxB, 2);
    t.equal(listResult.replaced, 'X');
    t.match(listResult.contents, /X/);

    // mod
    t.equal(execute.scopedEval('mod(-1,3)'), 2);

    // tan special cases
    t.equal(execute.scopedEval('tan(90)'), Infinity);
    t.equal(execute.scopedEval('tan(0)'), 0);

    // yieldThenCall returns a generator that yields once then returns value
    const yieldRes = execute.scopedEval('(function(){ const g = yieldThenCall(()=>5); g.next(); return g.next().value; })()');
    t.equal(yieldRes, 5);

    t.end();
});

test('type system: positive/negative integers and helper functions', t => {
    // Test isNumber helper
    t.ok(isNumber(TYPES.NUMBER), 'isNumber(NUMBER)');
    t.ok(isNumber(TYPES.NUMBER_INT), 'isNumber(NUMBER_INT)');
    t.ok(isNumber(TYPES.NUMBER_POS_INT), 'isNumber(NUMBER_POS_INT)');
    t.ok(isNumber(TYPES.NUMBER_NEG_INT), 'isNumber(NUMBER_NEG_INT)');
    t.ok(isNumber(TYPES.NUMBER_POS), 'isNumber(NUMBER_POS)');
    t.ok(isNumber(TYPES.NUMBER_NEG), 'isNumber(NUMBER_NEG)');
    t.notOk(isNumber(TYPES.STRING), '!isNumber(STRING)');
    t.notOk(isNumber(TYPES.BOOLEAN), '!isNumber(BOOLEAN)');
    t.notOk(isNumber(TYPES.NUMBER_NAN), '!isNumber(NUMBER_NAN)');

    // Test isPositive helper
    t.ok(isPositive(TYPES.NUMBER_POS), 'isPositive(NUMBER_POS)');
    t.ok(isPositive(TYPES.NUMBER_POS_INT), 'isPositive(NUMBER_POS_INT)');
    t.notOk(isPositive(TYPES.NUMBER), '!isPositive(NUMBER)');
    t.notOk(isPositive(TYPES.NUMBER_INT), '!isPositive(NUMBER_INT)');
    t.notOk(isPositive(TYPES.NUMBER_NEG), '!isPositive(NUMBER_NEG)');
    t.notOk(isPositive(TYPES.NUMBER_NEG_INT), '!isPositive(NUMBER_NEG_INT)');
    t.notOk(isPositive(TYPES.STRING), '!isPositive(STRING)');
    t.notOk(isPositive(TYPES.BOOLEAN), '!isPositive(BOOLEAN)');

    // Test ConstantInput type inference for positive integers
    const posInt = new ConstantInput(5, true);
    t.equal(posInt.type, TYPES.NUMBER_POS_INT, 'positive integer constant has NUMBER_POS_INT type');
    t.ok(posInt.isAlwaysInt(), 'positive integer constant is always int');
    t.ok(posInt.isAlwaysFinite(), 'positive integer constant is always finite');

    // Test ConstantInput type inference for negative integers
    const negInt = new ConstantInput(-5, true);
    t.equal(negInt.type, TYPES.NUMBER_NEG_INT, 'negative integer constant has NUMBER_NEG_INT type');
    t.ok(negInt.isAlwaysInt(), 'negative integer constant is always int');
    t.ok(negInt.isAlwaysFinite(), 'negative integer constant is always finite');

    // Test ConstantInput type inference for zero
    const zero = new ConstantInput(0, true);
    t.equal(zero.type, TYPES.NUMBER_ZERO, 'zero constant has NUMBER_INT type');
    t.ok(zero.isAlwaysInt(), 'zero constant is always int');
    t.ok(zero.isAlwaysFinite(), 'zero constant is always finite');

    // Test ConstantInput type inference for positive floats
    const posFloat = new ConstantInput(3.14, true);
    t.equal(posFloat.type, TYPES.NUMBER_POS, 'positive float constant has NUMBER_POS type');
    t.notOk(posFloat.isAlwaysInt(), 'positive float constant is not always int');
    t.ok(posFloat.isAlwaysFinite(), 'positive float constant is always finite');

    // Test ConstantInput type inference for negative floats
    const negFloat = new ConstantInput(-3.14, true);
    t.equal(negFloat.type, TYPES.NUMBER_NEG, 'negative float constant has NUMBER type');
    t.notOk(negFloat.isAlwaysInt(), 'negative float constant is not always int');
    t.ok(negFloat.isAlwaysFinite(), 'negative float constant is always finite');

    t.end();
});
