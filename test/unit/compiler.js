const test = require('tap').test;

const VariablePool = require('../../src/compiler/variable-pool');
const compatBlocks = require('../../src/compiler/compat-blocks');
const CompatBlockUtility = require('../../src/compiler/compat-block-utility');
const IR = require('../../src/compiler/intermediate');
const {BLOCKS} = require('../../src/compiler/enums');
const {IROptimizer} = require('../../src/compiler/iroptimizer');
const execute = require('../../src/compiler/jsexecute');

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
