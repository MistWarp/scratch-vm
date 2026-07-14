const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');

const input = defaultValue => ({
    type: ArgumentType.STRING,
    defaultValue
});

const block = (opcode, blockType, text, defaults) => ({
    opcode,
    blockType,
    text,
    arguments: Object.fromEntries(defaults.map((value, index) => {
        const name = `ARG${index + 1}`;
        return [name, input(value)];
    })),
    allowDropAnywhere: blockType === BlockType.REPORTER,
    func: 'unsupported'
});

class PatchingBlocks {
    getInfo () {
        return {
            id: 'patching',
            name: 'Patching',
            color1: '#9966ff',
            color2: '#855cd6',
            color3: '#774dcb',
            blocks: [
                block('jsreporter', BlockType.REPORTER, 'js [ARG1]', ['1 * 3']),
                block('jsboolean', BlockType.BOOLEAN, 'js [ARG1]', ['1 === 1']),
                block('jscommand', BlockType.COMMAND, 'js [ARG1]', ['console.log("hello")'])
            ]
        };
    }

    unsupported () {
        throw new Error('Patching blocks require the compiler');
    }
}

module.exports = PatchingBlocks;
