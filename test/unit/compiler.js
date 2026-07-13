const test = require('tap').test;

const VariablePool = require('../../src/compiler/variable-pool');
const compatBlocks = require('../../src/compiler/compat-blocks');
const CompatBlockUtility = require('../../src/compiler/compat-block-utility');
const IR = require('../../src/compiler/intermediate');
const {BLOCKS} = require('../../src/compiler/enums');
const {ScriptTreeGenerator} = require('../../src/compiler/irgen');
const JSGenerator = require('../../src/compiler/jsgen');
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

test('strings category compiles without the compatibility layer', t => {
    const runtime = {
        compilerOptions: {warpTimer: false},
        getTargetForStage: () => null,
        targets: []
    };
    const target = {runtime};
    const tree = new ScriptTreeGenerator({target, blockContainer: {}});
    tree.descendInputOfBlock = (_block, name) => ({kind: BLOCKS.CONSTANT, value: name});
    const script = new IR.IntermediateScript();
    const js = new JSGenerator(script, new IR.IntermediateRepresentation(script), target);

    for (const [opcode, kind] of [
        ['operator_change_case', BLOCKS.OP.CHANGECASE],
        ['operator_contains', BLOCKS.OP.CONTAINS],
        ['operator_index_of', BLOCKS.OP.INDEXOF],
        ['operator_join', BLOCKS.OP.JOIN],
        ['operator_length', BLOCKS.OP.LENGTH],
        ['operator_letter_of', BLOCKS.OP.LETTEROF],
        ['operator_letters_of', BLOCKS.OP.LETTERSOF],
        ['operator_newline', BLOCKS.CONSTANT],
        ['operator_repeat', BLOCKS.OP.REPEAT],
        ['operator_replace', BLOCKS.OP.REPLACE],
        ['operator_trim', BLOCKS.OP.TRIM]
    ]) {
        const node = tree.descendInput({opcode, inputs: {}, fields: {CASE: {value: 'uppercase'}}});
        t.equal(node.kind, kind, opcode);
        t.notMatch(js.descendInput(node).source, /executeInCompatibilityLayer|ext_scratch3_operators/, opcode);
    }
    t.doesNotThrow(() => execute.scopedEval(js.createScriptFactory()), 'generated helpers are valid JavaScript');
    t.end();
});

test('JSON extension compiles to native typed values', t => {
    const runtime = {
        compilerOptions: {warpTimer: false},
        getTargetForStage: () => null,
        targets: [],
        ext_skyhigh173JSON: {
            json_vm_setlist: (args, util) => { util.target.list = args.list; }
        }
    };
    const target = {runtime};
    const tree = new ScriptTreeGenerator({target, blockContainer: {}});
    const values = {json: '{"a":1}', item: 'b', value: 2, list: 'list-id'};
    tree.descendInputOfBlock = (_block, name) => ({kind: BLOCKS.CONSTANT, value: values[name]});
    const script = new IR.IntermediateScript();
    const js = new JSGenerator(script, new IR.IntermediateRepresentation(script), target);
    const block = opcode => ({opcode, inputs: values, fields: {}});

    const setNode = tree.descendInput(block('skyhigh173JSON_json_set'));
    const setInput = js.descendInput(setNode);
    t.equal(setNode.kind, BLOCKS.EXTENSION);
    t.equal(setInput.type, JSGenerator.unstable_exports.TYPE_JSON);
    t.notMatch(setInput.source, /yield|Compatibility/);
    t.notMatch(setInput.source, /runtime\.ext_/);
    const helpers = () => [...js.prependFunctions.values()].join(';\n');
    const evaluate = source => execute.scopedEval(`(() => {${helpers()}; return ${source};})()`);
    t.same(evaluate(setInput.source), {a: 1, b: 2}, 'known JSON stays native');
    t.equal(setInput.asJSON(), setInput.source, 'JSON inputs reuse the native value');
    t.equal(evaluate(setInput.asString()), '{"a":1,"b":2}', 'ordinary inputs stringify JSON');

    const lengthInput = js.descendInput({
        kind: BLOCKS.EXTENSION,
        opcode: 'skyhigh173JSON_json_jlength',
        inputs: {json: setNode},
        fields: {}
    });
    t.equal(evaluate(lengthInput.source), 2, 'native JSON operations compose');
    t.notMatch(lengthInput.source, /toScratchString|JSON\.stringify/, 'nested JSON stays native');

    const getInput = js.descendInput({
        kind: BLOCKS.EXTENSION,
        opcode: 'skyhigh173JSON_json_get',
        inputs: {
            json: {kind: BLOCKS.CONSTANT, value: '{"nested":{"x":1}}'},
            item: {kind: BLOCKS.CONSTANT, value: 'nested'}
        },
        fields: {}
    });
    t.same(evaluate(getInput.source), {x: 1}, 'get can return native JSON');
    t.equal(evaluate(getInput.asString()), '{"x":1}', 'dynamic JSON stringifies at the boundary');
    t.equal(evaluate(getInput.asUnknown()), '{"x":1}', 'raw block boundaries stringify nested JSON');

    const booleanInput = js.descendInput(tree.descendInput(block('skyhigh173JSON_json_is_valid')));
    t.equal(booleanInput.type, JSGenerator.unstable_exports.TYPE_BOOLEAN);

    const unknownInput = new JSGenerator.unstable_exports.TypedInput(
        'callback', JSGenerator.unstable_exports.TYPE_UNKNOWN
    );
    t.equal(unknownInput.asUnknown(), 'callback', 'unknown values can carry functions without stringifying');

    const getAllInput = js.descendInput({
        kind: BLOCKS.EXTENSION,
        opcode: 'skyhigh173JSON_json_get_all',
        inputs: {json: {kind: BLOCKS.CONSTANT, value: '{"a":1}'}},
        fields: {STYPE: 'keys'}
    });
    t.same(evaluate(getAllInput.source), ['a'], 'extension menu fields are accepted case-insensitively');

    const getAllWithoutMenu = js.descendInput({
        kind: BLOCKS.EXTENSION,
        opcode: 'skyhigh173JSON_json_get_all',
        inputs: {json: {kind: BLOCKS.CONSTANT, value: '{"a":1}'}},
        fields: {}
    });
    t.same(evaluate(getAllWithoutMenu.source), [], 'missing extension inputs compile with an empty fallback');

    tree.thread.stackClick = true;
    const visualReport = tree.descendStackedBlock(block('skyhigh173JSON_json_set'));
    t.equal(visualReport.kind, BLOCKS.VISUAL_REPORT);
    js.descendStackedBlock(visualReport);
    js.descendStackedBlock(tree.descendStackedBlock(block('skyhigh173JSON_json_vm_setlist')));
    t.match(js.source, /runtime\.visualReport/);
    t.match(js.source, /json_vm_setlist\(.+, \{target\}\)/);
    t.doesNotThrow(() => execute.scopedEval(js.createScriptFactory()), 'visual reporters generate valid JavaScript');

    delete runtime.ext_skyhigh173JSON;
    runtime.getOpcodeFunction = () => () => {};
    runtime._blockInfo = [{
        id: 'skyhigh173JSON',
        blocks: [{info: {opcode: 'json_array_reverse', blockType: 'reporter'}}]
    }];
    t.equal(tree.descendInput(block('skyhigh173JSON_json_get_all')).kind, BLOCKS.EXTENSION,
        'native block does not require an extension instance');
    t.equal(tree.descendInput(block('skyhigh173JSON_json_array_reverse')).kind, BLOCKS.COMPAT,
        'unavailable extension instance uses compatibility layer');
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

    t.same(execute.scopedEval('parseJSON("{\\"value\\":1}")'), {value: 1});
    t.equal(execute.scopedEval('parseJSON("not json")'), undefined);

    // yieldThenCall returns a generator that yields once then returns value
    const yieldRes = execute.scopedEval('(function(){ const g = yieldThenCall(()=>5); g.next(); return g.next().value; })()');
    t.equal(yieldRes, 5);

    t.end();
});
