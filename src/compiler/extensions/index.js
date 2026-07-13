const extensions = [
    require('./skyhigh173JSON')
];

const blocks = Object.create(null);
for (const extension of extensions) {
    for (const [opcode, info] of Object.entries(extension.blocks)) {
        blocks[`${extension.id}_${opcode}`] = {
            extension: extension.id,
            generate: extension.generate,
            native: extension.isNative(opcode),
            ...info
        };
    }
}

const get = opcode => blocks[opcode] || null;
const canCompile = (opcode, runtime) => {
    const block = get(opcode);
    return Boolean(block && (block.native || runtime[`ext_${block.extension}`]));
};

module.exports = {get, canCompile};
