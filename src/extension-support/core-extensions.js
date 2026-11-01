/**
 * @fileoverview
 * The built-in block groups that are never loaded as extensions.
 */

/**
 * Opcode prefixes of built-in blocks. An opcode whose prefix is not listed
 * here, such as pen_clear, belongs to an extension.
 * @type {string[]}
 */
const CORE_OPCODE_PREFIXES = [
    'argument',
    'assets',
    'colour',
    'control',
    'data',
    'event',
    'looks',
    'math',
    'motion',
    'operator',
    'procedures',
    'sensing',
    'sound'
];

/**
 * Extension IDs of the built-in categories. ExtensionManager.isCoreExtension
 * reports these as built in.
 * @type {string[]}
 */
const CORE_EXTENSION_IDS = [
    'motion',
    'looks',
    'sound',
    'events',
    'control',
    'sensing',
    'operators',
    'data',
    'procedures',
    'assets'
];

module.exports = {
    CORE_OPCODE_PREFIXES,
    CORE_EXTENSION_IDS
};
