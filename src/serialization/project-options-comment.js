/**
 * @fileoverview
 * Reads and writes the project options that are stored as JSON in a floating
 * Stage comment ending with the _twconfig_ marker.
 */

const ExtendedJSON = require('@turbowarp/json');
const {RESERVED_COMMENT_MARKERS} = require('./reserved-comments');

const PROJECT_OPTIONS_MARKER = RESERVED_COMMENT_MARKERS.projectOptions;

const NO_OPTIONS_LINE = 'NO_OPTIONS_LINE';
const INVALID_OPTIONS_JSON = 'INVALID_OPTIONS_JSON';

/**
 * @param {string} text Comment text.
 * @returns {boolean} True if the comment holds project options.
 */
const isProjectOptionsText = text => text.includes(PROJECT_OPTIONS_MARKER);

/**
 * @param {string} text Comment text.
 * @returns {{options: object}|{error: string, cause: (Error|undefined)}} The parsed options, or why they
 * could not be read.
 */
const parseProjectOptionsText = text => {
    const lineWithMagic = text.split('\n').find(i => i.endsWith(PROJECT_OPTIONS_MARKER));
    if (!lineWithMagic) {
        return {error: NO_OPTIONS_LINE};
    }
    const jsonText = lineWithMagic.substr(0, lineWithMagic.length - PROJECT_OPTIONS_MARKER.length);
    try {
        const parsed = ExtendedJSON.parse(jsonText);
        if (!parsed || typeof parsed !== 'object') {
            throw new Error('Invalid object');
        }
        return {options: parsed};
    } catch (e) {
        return {error: INVALID_OPTIONS_JSON, cause: e};
    }
};

/**
 * @param {object} options Project options to store.
 * @returns {string} Comment text that parseProjectOptionsText reads back.
 */
const serializeProjectOptionsText = options => `Configuration for https://turbowarp.org/\nYou can move, resize, and minimize this comment, but don't edit it by hand. This comment can be deleted to remove the stored settings.\n${ExtendedJSON.stringify(options)}${PROJECT_OPTIONS_MARKER}`;

/**
 * @param {object} oldObject Default options.
 * @param {object} newObject Current options.
 * @returns {object} The entries of newObject that differ from oldObject, recursing into objects.
 */
const differingProjectOptions = (oldObject, newObject) => {
    const result = {};
    for (const key of Object.keys(newObject)) {
        const newValue = newObject[key];
        const oldValue = oldObject[key];
        if (typeof newValue === 'object' && newValue) {
            const valueDiffering = differingProjectOptions(oldValue, newValue);
            if (Object.keys(valueDiffering).length > 0) {
                result[key] = valueDiffering;
            }
        } else if (newValue !== oldValue) {
            result[key] = newValue;
        }
    }
    return result;
};

module.exports = {
    PROJECT_OPTIONS_MARKER,
    NO_OPTIONS_LINE,
    INVALID_OPTIONS_JSON,
    isProjectOptionsText,
    parseProjectOptionsText,
    serializeProjectOptionsText,
    differingProjectOptions
};
