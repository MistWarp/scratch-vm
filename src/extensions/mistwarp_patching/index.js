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
    constructor (runtime) {
        this.runtime = runtime;
        this.warned = false;
    }

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

    unsupported (args, util) {
        if (!this.warned) {
            this.warned = true;
            const error = new Error('Patching blocks require the compiler. Turn the compiler back on in settings.');
            const target = util && util.target;
            if (this.runtime && target) {
                this.runtime.emitCompileError(target, error);
            } else {
                console.warn(error); // eslint-disable-line no-console
            }
        }
        return '';
    }
}

module.exports = PatchingBlocks;
