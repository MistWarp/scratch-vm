const fs = require('fs');
const {test} = require('tap');
const Runtime = require('../../src/engine/runtime');
const {
    OUTPUT,
    DEFAULT_SCRATCH_BLOCKS,
    generateOpcodeTable,
    serializeOpcodeTable
} = require('../../tools/generate-opcodes');
const table = require('../../src/engine/opcodes.generated.json');

const haveScratchBlocks = fs.existsSync(DEFAULT_SCRATCH_BLOCKS);

test('the committed opcode table matches its sources', {skip: !haveScratchBlocks && 'scratch-blocks is not next to scratch-vm'}, t => {
    const generated = generateOpcodeTable();
    t.equal(fs.readFileSync(OUTPUT, 'utf8'), serializeOpcodeTable(generated),
        'run node tools/generate-opcodes.js to update it');
    t.end();
});

test('the table covers every VM primitive and hat', t => {
    const runtime = new Runtime();
    for (const opcode of Object.keys(runtime._primitives)) {
        t.ok(table.opcodes[opcode] && table.opcodes[opcode].primitive, `${opcode} is a primitive`);
    }
    for (const opcode of Object.keys(runtime._hats)) {
        t.ok(table.opcodes[opcode] && table.opcodes[opcode].hat, `${opcode} is a hat`);
    }
    t.end();
});

test('input and field names for each kind of script', t => {
    const entry = opcode => table.opcodes[opcode];
    t.same(entry('control_if_else').inputs, ['CONDITION', 'SUBSTACK', 'SUBSTACK2']);
    t.same(entry('control_repeat').inputs, ['TIMES', 'SUBSTACK']);
    t.same(entry('control_forever').inputs, ['SUBSTACK']);
    t.same(entry('control_stop').fields, ['STOP_OPTION'], 'imperatively built blocks are covered');
    t.same(entry('operator_add').inputs, ['NUM1', 'NUM2']);
    t.same(entry('operator_add').fields, []);
    t.same(entry('operator_add').variadic, {prefix: 'NUM', minItems: 2, collapsed: true});
    t.same(entry('operator_join').variadic, {prefix: 'STRING', minItems: 2, collapsed: true});
    t.equal(entry('procedures_call').mutationInputs, 'argumentids');
    t.equal(entry('procedures_prototype').mutationInputs, 'argumentids');
    t.same(entry('procedures_definition').inputs, ['custom_block']);
    t.same(entry('argument_reporter_string_number').fields, ['VALUE']);
    t.same(entry('data_setvariableto').fields, ['VARIABLE']);
    t.same(entry('data_setvariableto').inputs, ['VALUE']);
    t.ok(entry('math_number').definition && !entry('math_number').primitive, 'shadow opcodes are listed');
    t.same(entry('looks_costume').fields, ['COSTUME'], 'menu opcodes are listed');
    t.end();
});
