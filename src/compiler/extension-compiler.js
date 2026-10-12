// @ts-check

const BlockType = require('../extension-support/block-type');
const {COMPILER_TYPES, isCompilerType} = require('./enums.js');

/**
 * The type of value a compiled block produces. A descriptor may declare one
 * explicitly with `returnType` (or `type`); otherwise it comes from the block
 * type. Reporters default to ANY because a Scratch reporter can return any
 * value. Returns null when the block cannot be compiled at all.
 * @param {string|undefined} blockType A BlockType value from getInfo.
 * @param {string|undefined} declared A COMPILER_TYPES value from the descriptor.
 * @returns {string|null} A COMPILER_TYPES value, or null if unsupported.
 */
const resolveCompilerType = (blockType, declared) => {
    if (declared) {
        if (!isCompilerType(declared)) {
            throw new TypeError(`Unknown compiler returnType: ${declared}`);
        }
        return declared;
    }
    switch (blockType) {
    case BlockType.BOOLEAN:
        return COMPILER_TYPES.BOOLEAN;
    case BlockType.REPORTER:
        return COMPILER_TYPES.ANY;
    case BlockType.COMMAND:
        return COMPILER_TYPES.COMMAND;
    default:
        // A missing block type is a command (Scratch's default); anything else
        // (hats, loops, conditionals, buttons, labels, XML) cannot be compiled.
        return blockType ? null : COMPILER_TYPES.COMMAND;
    }
};

/**
 * Names of the `cast` helpers handed to a `compFunc`, mapped to the name of the
 * `input` helper each one delegates to. `null` is the untyped input, and `raw`
 * is the input with no coercion.
 * @readonly
 */
const CAST_METHODS = Object.freeze({
    toAny: null,
    toNumber: 'number',
    toNumberOrNaN: 'numberOrNaN',
    toString: 'string',
    toBoolean: 'boolean',
    toRaw: 'raw'
});

/**
 * @param {*} token A token from `args`, or a bare argument name.
 * @returns {string} The argument or field name.
 */
const getTokenName = token => {
    if (typeof token === 'string') return token;
    if (token && typeof token.name === 'string') return token.name;
    throw new TypeError('cast helpers expect a block argument');
};

/**
 * A block argument or field handed to a `compFunc` in `args`. Interpolating it
 * (`${args.NAME}`) yields the value coerced to "any"; pass it to a `cast` helper
 * to get a specific type instead.
 * @typedef {Object} CompFuncToken
 * @property {string} name
 * @property {'input'|'field'} kind
 * @property {*} [value] The raw field value, for field tokens.
 * @property {() => string} toString
 */

/**
 * Build the `args` and `cast` values handed to a `compFunc`. Both come from one
 * resolver, so a token's default `toString` and `cast.toAny(token)` always agree.
 * @param {Array<string>} inputNames Names of the block's inputs.
 * @param {Object.<string, *>} fields Values of the block's fields, keyed by name.
 * @param {*} input Compiles a named input to source; also carries the named
 * coercion helpers (`number`, `string`, ...) and `raw`.
 * @param {(name: string) => string} field Returns a field value as a JSON literal.
 * @returns {{args: Object.<string, CompFuncToken>, cast: Object.<string, (token: *) => string>}}
 */
const buildCompFuncHelpers = (inputNames, fields, input, field) => {
    /**
     * @param {*} token A token or a bare argument name.
     * @param {string|null} type An `input` helper name, or null for "any".
     * @returns {string} JavaScript source for the value.
     */
    const sourceOf = (token, type) => {
        const name = getTokenName(token);
        if (typeof token === 'object' && token.kind === 'field') {
            return field(name);
        }
        return type === null ? input(name) : input[type](name);
    };

    /**
     * @param {string} name Argument or field name.
     * @param {'input'|'field'} kind What the token refers to.
     * @returns {CompFuncToken}
     */
    const makeToken = (name, kind) => {
        /** @type {CompFuncToken} */
        const token = {name, kind, toString: () => sourceOf({name, kind}, null)};
        if (kind === 'field') token.value = fields[name];
        return token;
    };

    /** @type {Object.<string, CompFuncToken>} */
    const args = {};
    for (const name of inputNames) {
        args[name] = makeToken(name, 'input');
    }
    for (const name of Object.keys(fields)) {
        args[name] = makeToken(name, 'field');
    }

    /** @type {Object.<string, (token: *) => string>} */
    const cast = {};
    for (const [method, type] of Object.entries(CAST_METHODS)) {
        cast[method] = token => sourceOf(token, type);
    }

    return {args, cast};
};

module.exports = {
    resolveCompilerType,
    buildCompFuncHelpers
};
