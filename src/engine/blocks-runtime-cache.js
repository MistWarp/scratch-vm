/**
 * @fileoverview
 * The BlocksRuntimeCache caches data about the top block of scripts so that
 * Runtime can iterate a targeted opcode and iterate the returned set faster.
 * Many top blocks need to match fields as well as opcode, since that matching
 * compares strings in uppercase we can go ahead and uppercase the cached value
 * so we don't need to in the future.
 */

const MAX_UPPER_CASE_STRINGS = 4096;
const MAX_UPPER_CASE_LENGTH = 64;
const upperCaseStrings = new Map();

const upperCase = value => {
    if (typeof value !== 'string') return String(value).toUpperCase();
    if (value.length > MAX_UPPER_CASE_LENGTH) return value.toUpperCase();
    let upper = upperCaseStrings.get(value);
    if (typeof upper === 'undefined') {
        upper = value.toUpperCase();
        const shared = upperCaseStrings.get(upper);
        if (typeof shared === 'undefined') {
            if (upperCaseStrings.size >= MAX_UPPER_CASE_STRINGS) upperCaseStrings.clear();
            upperCaseStrings.set(upper, upper);
        } else {
            upper = shared;
        }
        upperCaseStrings.set(value, upper);
    }
    return upper;
};

/**
 * A set of cached data about the top block of a script.
 * @param {Blocks} container - Container holding the block and related data
 * @param {string} blockId - Id for whose block data is cached in this instance
 */
class RuntimeScriptCache {
    constructor (container, blockId) {
        /**
         * Container with block data for blockId.
         * @type {Blocks}
         */
        this.container = container;

        /**
         * ID for block this instance caches.
         * @type {string}
         */
        this.blockId = blockId;

        const block = container.getBlock(blockId);
        const fields = container.getFields(block);

        /**
         * Formatted fields or fields of input blocks ready for comparison in
         * runtime.
         *
         * This is a clone of parts of the targeted blocks. Changes to these
         * clones are limited to copies under RuntimeScriptCache and will not
         * appear in the original blocks in their container. This copy is
         * modified changing the case of strings to uppercase. These uppercase
         * values will be compared later by the VM.
         * @type {object}
         */
        this.fieldsOfInputs = Object.assign({}, fields);
        if (Object.keys(fields).length === 0) {
            const inputs = container.getInputs(block);
            for (const input in inputs) {
                if (!Object.prototype.hasOwnProperty.call(inputs, input)) continue;
                const id = inputs[input].block;
                const inputBlock = container.getBlock(id);
                const inputFields = container.getFields(inputBlock);
                Object.assign(this.fieldsOfInputs, inputFields);
            }
        }
        for (const key in this.fieldsOfInputs) {
            const field = this.fieldsOfInputs[key] = Object.assign({}, this.fieldsOfInputs[key]);
            if (field.value.toUpperCase) {
                field.value = upperCase(field.value);
            }
        }
    }
}

const NO_SCRIPTS = Object.freeze([]);

/**
 * Get an array of scripts from a block container prefiltered to match opcode.
 * @param {Blocks} blocks - Container of blocks
 * @param {string} opcode - Opcode to filter top blocks by
 * @returns {Array.<RuntimeScriptCache>} - Array of RuntimeScriptCache cache
 *   objects
 */
exports.getScripts = function (blocks, opcode) {
    let scripts = blocks._cache.scripts[opcode];
    if (!scripts) {
        scripts = blocks._cache.scripts[opcode] = [];

        const allScripts = blocks._scripts;
        for (let i = 0; i < allScripts.length; i++) {
            const topBlockId = allScripts[i];
            const block = blocks.getBlock(topBlockId);
            if (block.opcode === opcode) {
                scripts.push(new RuntimeScriptCache(blocks, topBlockId));
            }
        }
    }
    return scripts;
};

exports.MIN_SCRIPTS_TO_INDEX = 4;

exports.getScriptsWithField = function (scripts, field, value) {
    let index = scripts.fieldIndex;
    if (!index || index.field !== field) {
        const byValue = new Map();
        for (let i = 0; i < scripts.length; i++) {
            const hatField = scripts[i].fieldsOfInputs[field];
            if (!hatField) continue;
            const matching = byValue.get(hatField.value);
            if (matching) {
                matching.push(scripts[i]);
            } else {
                byValue.set(hatField.value, [scripts[i]]);
            }
        }
        index = {field, byValue};
        scripts.fieldIndex = index;
    }
    return index.byValue.get(value) || NO_SCRIPTS;
};

exports.fieldsMatch = function (hatFields, matchFields) {
    for (const field in matchFields) {
        const hatField = hatFields[field];
        if (!hatField || hatField.value !== matchFields[field]) return false;
    }
    return true;
};

exports.upperCase = upperCase;

exports._RuntimeScriptCache = RuntimeScriptCache;
