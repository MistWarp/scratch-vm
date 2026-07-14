const test = require('tap').test;

const compatibility = require('../../src/compiler/old-compiler-compatibility');
const {InputOpcode, InputType} = require('../../src/compiler/enums');
const {IntermediateInput} = require('../../src/compiler/intermediate');

test('legacy compiler exports used by extensions remain available', t => {
    const exports = compatibility.JSGeneratorStub.unstable_exports;

    t.type(exports.TypedInput, 'function');
    t.type(exports.ConstantInput, 'function');
    t.type(exports.VariableInput, 'function');
    t.type(exports.Frame, 'function');
    t.equal(exports.sanitize('"\n'), '\\"\\n');
    t.equal(new exports.ConstantInput('value').constantValue, 'value');
    t.equal(new exports.VariableInput('variable').asUnknown(), 'variable');

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
    t.type(literal, exports.ConstantInput, 'raw patch inputs remain literals');
    t.end();
});
