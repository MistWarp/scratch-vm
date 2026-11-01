const {test} = require('node:test');
const assert = require('node:assert');

const compatibility = require('../../src/compiler/old-compiler-compatibility');
const {InputOpcode, InputType} = require('../../src/compiler/enums');
const {IntermediateInput} = require('../../src/compiler/intermediate');

test('legacy compiler exports used by extensions remain available', () => {
    const exports = compatibility.JSGeneratorStub.unstable_exports;

    assert.strictEqual(typeof exports.TypedInput, 'function');
    assert.strictEqual(typeof exports.ConstantInput, 'function');
    assert.strictEqual(typeof exports.VariableInput, 'function');
    assert.strictEqual(typeof exports.Frame, 'function');
    assert.strictEqual(exports.sanitize('"\n'), '\\"\\n');
    assert.strictEqual(new exports.ConstantInput('value').constantValue, 'value');
    assert.strictEqual(new exports.VariableInput('variable').asUnknown(), 'variable');

    const stub = new compatibility.JSGeneratorStub({
        script: {},
        ir: {},
        target: {},
        frames: [],
        currentFrame: null
    });
    const literal = stub.fakeThis.descendInput(new IntermediateInput(
        InputOpcode.CONSTANT,
        InputType.STRING,
        {value: 'raw source'}
    ));
    assert.ok(literal instanceof exports.ConstantInput, 'raw patch inputs remain literals');
});
