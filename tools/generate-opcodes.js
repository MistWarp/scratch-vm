const fs = require('fs');
const path = require('path');
const nodeVM = require('vm');
const Runtime = require('../src/engine/runtime');
const {EXTENDABLE_OPERATORS} = require('../src/serialization/sb3');

const OUTPUT = path.resolve(__dirname, '../src/engine/opcodes.generated.json');
const DEFAULT_SCRATCH_BLOCKS = path.resolve(__dirname, '../../scratch-blocks');
const BLOCK_FILES = [
    'blocks_common/colour.js',
    'blocks_common/math.js',
    'blocks_common/matrix.js',
    'blocks_common/note.js',
    'blocks_common/text.js',
    'blocks_vertical/vertical_extensions.js',
    'blocks_vertical/assets.js',
    'blocks_vertical/control.js',
    'blocks_vertical/data.js',
    'blocks_vertical/event.js',
    'blocks_vertical/extensions.js',
    'blocks_vertical/looks.js',
    'blocks_vertical/motion.js',
    'blocks_vertical/operators.js',
    'blocks_vertical/procedures.js',
    'blocks_vertical/sensing.js',
    'blocks_vertical/sound.js'
];
const MUTATION_INPUT_OPCODES = ['procedures_call', 'procedures_prototype'];

const makeAny = () => {
    const target = function () {};
    let any = null;
    any = new Proxy(target, {
        get (object, key) {
            if (key === Symbol.toPrimitive) return () => '';
            if (key === Symbol.iterator) return [][Symbol.iterator];
            if (key === 'toString' || key === 'valueOf') return () => '';
            const descriptor = Object.getOwnPropertyDescriptor(object, key);
            if (descriptor && !descriptor.configurable) return Reflect.get(object, key);
            return any;
        },
        set () {
            return true;
        },
        apply () {
            return any;
        },
        construct () {
            return any;
        }
    });
    return any;
};

const makeNamespace = (any, backing = {}) => new Proxy(backing, {
    get (object, key) {
        if (Object.prototype.hasOwnProperty.call(object, key)) return object[key];
        if (typeof key === 'symbol') return object[key];
        return any;
    }
});

const createBlocklyStub = () => {
    const any = makeAny();
    const blocks = {};
    const messages = new Proxy({}, {
        get: (object, key) => (typeof key === 'string' ? '' : object[key])
    });
    const backings = new Map();
    const rootBacking = {Blocks: blocks, Msg: messages};
    const Blockly = makeNamespace(any, rootBacking);
    backings.set(Blockly, rootBacking);
    const provide = name => {
        const parts = name.split('.');
        if (parts.shift() !== 'Blockly') return;
        let current = Blockly;
        for (const part of parts) {
            const backing = backings.get(current);
            if (!backing) return;
            if (!Object.prototype.hasOwnProperty.call(backing, part)) {
                const childBacking = {};
                const child = makeNamespace(any, childBacking);
                backings.set(child, childBacking);
                backing[part] = child;
            }
            current = backing[part];
        }
    };
    const goog = makeNamespace(any, {
        provide,
        require: () => {},
        inherits: () => {}
    });
    return {Blockly, blocks, goog, any};
};

const recordDefinition = (definition, any) => {
    const inputs = [];
    const fields = [];
    const addInput = name => {
        if (typeof name === 'string' && name && !inputs.includes(name)) inputs.push(name);
    };
    const addField = name => {
        if (typeof name === 'string' && name && !fields.includes(name)) fields.push(name);
    };
    const input = new Proxy({}, {
        get (object, key) {
            if (key === 'appendField') {
                return (field, name) => {
                    addField(name);
                    return input;
                };
            }
            return () => input;
        }
    });
    const state = {};
    const self = new Proxy(state, {
        get (object, key) {
            if (key === 'jsonInit') {
                return json => {
                    if (!json || typeof json !== 'object') return;
                    for (let i = 0; Object.prototype.hasOwnProperty.call(json, `message${i}`) ||
                        Object.prototype.hasOwnProperty.call(json, `args${i}`); i++) {
                        for (const arg of json[`args${i}`] || []) {
                            if (!arg || typeof arg !== 'object') continue;
                            if (arg.type === 'input_value' || arg.type === 'input_statement') {
                                addInput(arg.name);
                            } else if (typeof arg.type === 'string' && arg.type.startsWith('field_')) {
                                addField(arg.name);
                            }
                        }
                    }
                };
            }
            if (key === 'appendValueInput' || key === 'appendStatementInput') {
                return name => {
                    addInput(name);
                    return input;
                };
            }
            if (key === 'appendDummyInput') return () => input;
            if (key === 'getInput' || key === 'getField') return () => null;
            if (key === 'inputList') return [];
            if (Object.prototype.hasOwnProperty.call(object, key)) return object[key];
            if (Object.prototype.hasOwnProperty.call(definition, key)) return definition[key];
            if (typeof key === 'symbol') return object[key];
            return any;
        },
        set (object, key, value) {
            object[key] = value;
            return true;
        }
    });
    let error = null;
    try {
        if (typeof definition.init === 'function') definition.init.call(self);
    } catch (e) {
        error = e;
    }
    return {inputs, fields, error};
};

const readScratchBlocks = scratchBlocksDir => {
    const {Blockly, blocks, goog, any} = createBlocklyStub();
    const context = nodeVM.createContext({Blockly, goog, console: {log () {}, warn () {}, error () {}}});
    for (const file of BLOCK_FILES) {
        const source = fs.readFileSync(path.join(scratchBlocksDir, file), 'utf8');
        nodeVM.runInContext(source, context, {filename: file});
    }
    const result = {};
    for (const opcode of Object.keys(blocks)) {
        const definition = blocks[opcode];
        if (!definition || typeof definition !== 'object') continue;
        const recorded = recordDefinition(definition, any);
        const variadic = typeof definition.inputPrefix_ === 'string';
        result[opcode] = {
            inputs: recorded.inputs,
            fields: variadic ? [] : recorded.fields,
            variadic: variadic ? {prefix: definition.inputPrefix_, minItems: definition.minItems_ || 2} : null
        };
    }
    return result;
};

const readRuntime = () => {
    const runtime = new Runtime();
    return {
        primitives: Object.keys(runtime._primitives),
        hats: Object.keys(runtime._hats)
    };
};

const generateOpcodeTable = ({scratchBlocksDir = DEFAULT_SCRATCH_BLOCKS} = {}) => {
    const scratchBlocks = readScratchBlocks(scratchBlocksDir);
    const {primitives, hats} = readRuntime();
    const opcodes = new Set([...primitives, ...hats, ...Object.keys(scratchBlocks)]);
    const table = {};
    for (const opcode of Array.from(opcodes).sort()) {
        const definition = scratchBlocks[opcode] || null;
        const entry = {
            inputs: definition ? definition.inputs : [],
            fields: definition ? definition.fields : [],
            primitive: primitives.includes(opcode),
            hat: hats.includes(opcode),
            definition: Boolean(definition)
        };
        if (definition && definition.variadic) {
            entry.variadic = Object.assign({}, definition.variadic, {
                collapsed: Object.prototype.hasOwnProperty.call(EXTENDABLE_OPERATORS, opcode)
            });
        }
        if (MUTATION_INPUT_OPCODES.includes(opcode)) entry.mutationInputs = 'argumentids';
        table[opcode] = entry;
    }
    return {
        sources: ['runtime._primitives', 'runtime._hats', 'scratch-blocks Blockly.Blocks'],
        opcodes: table
    };
};

const serializeOpcodeTable = table => `${JSON.stringify(table, null, 2)}\n`;

if (require.main === module) {
    const scratchBlocksDir = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_SCRATCH_BLOCKS;
    fs.writeFileSync(OUTPUT, serializeOpcodeTable(generateOpcodeTable({scratchBlocksDir})));
    process.stdout.write(`Wrote ${OUTPUT}\n`);
}

module.exports = {
    OUTPUT,
    DEFAULT_SCRATCH_BLOCKS,
    generateOpcodeTable,
    serializeOpcodeTable
};
