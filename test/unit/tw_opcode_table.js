const fs = require('fs');
const {test} = require('node:test');
const assert = require('node:assert');
const Runtime = require('../../src/engine/runtime');
const {
    OUTPUT,
    DEFAULT_SCRATCH_BLOCKS,
    generateOpcodeTable,
    serializeOpcodeTable
} = require('../../tools/generate-opcodes');
const table = require('../../src/engine/opcodes.generated.json');

const haveScratchBlocks = fs.existsSync(DEFAULT_SCRATCH_BLOCKS);

test('the committed opcode table matches its sources', {skip: !haveScratchBlocks && 'scratch-blocks is not next to scratch-vm'}, () => {
    const generated = generateOpcodeTable();
    assert.strictEqual(fs.readFileSync(OUTPUT, 'utf8'), serializeOpcodeTable(generated),
        'run node tools/generate-opcodes.js to update it');
});

test('the table covers every VM primitive and hat', () => {
    const runtime = new Runtime();
    for (const opcode of Object.keys(runtime._primitives)) {
        assert.ok(table.opcodes[opcode] && table.opcodes[opcode].primitive, `${opcode} is a primitive`);
    }
    for (const opcode of Object.keys(runtime._hats)) {
        assert.ok(table.opcodes[opcode] && table.opcodes[opcode].hat, `${opcode} is a hat`);
    }
});

test('input and field names for each kind of script', () => {
    const entry = opcode => table.opcodes[opcode];
    assert.deepStrictEqual(entry('control_if_else').inputs, ['CONDITION', 'SUBSTACK', 'SUBSTACK2']);
    assert.deepStrictEqual(entry('control_repeat').inputs, ['TIMES', 'SUBSTACK']);
    assert.deepStrictEqual(entry('control_forever').inputs, ['SUBSTACK']);
    assert.deepStrictEqual(entry('control_stop').fields, ['STOP_OPTION'], 'imperatively built blocks are covered');
    assert.deepStrictEqual(entry('operator_add').inputs, ['NUM1', 'NUM2']);
    assert.deepStrictEqual(entry('operator_add').fields, []);
    assert.deepStrictEqual(entry('operator_add').variadic, {prefix: 'NUM', minItems: 2, collapsed: true});
    assert.deepStrictEqual(entry('operator_join').variadic, {prefix: 'STRING', minItems: 2, collapsed: true});
    assert.strictEqual(entry('procedures_call').mutationInputs, 'argumentids');
    assert.strictEqual(entry('procedures_prototype').mutationInputs, 'argumentids');
    assert.deepStrictEqual(entry('procedures_definition').inputs, ['custom_block']);
    assert.deepStrictEqual(entry('argument_reporter_string_number').fields, ['VALUE']);
    assert.deepStrictEqual(entry('data_setvariableto').fields, ['VARIABLE']);
    assert.deepStrictEqual(entry('data_setvariableto').inputs, ['VALUE']);
    assert.ok(entry('math_number').definition && !entry('math_number').primitive, 'shadow opcodes are listed');
    assert.deepStrictEqual(entry('looks_costume').fields, ['COSTUME'], 'menu opcodes are listed');
});
