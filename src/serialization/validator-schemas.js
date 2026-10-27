// The project schemas, shared by validate-project.js and tools/generate-validators.js.

const SCHEMAS = {
    sb3: {schema: () => require('scratch-parser/lib/sb3_schema.json'), sb2: false},
    sprite3: {schema: () => require('scratch-parser/lib/sprite3_schema.json'), sb2: false},
    sb2: {schema: () => require('scratch-parser/lib/sb2_schema.json'), sb2: true},
    sprite2: {schema: () => require('scratch-parser/lib/sprite2_schema.json'), sb2: true}
};

let sb3Definitions = null;
const getSb3Definitions = () => {
    if (!sb3Definitions) {
        // Copy so that removing the list item type does not change scratch-parser's own copy.
        sb3Definitions = JSON.parse(JSON.stringify(require('scratch-parser/lib/sb3_definitions.json')));
        const list = sb3Definitions.definitions && sb3Definitions.definitions.list;
        if (list && Array.isArray(list.items) && list.items[1]) {
            delete list.items[1].items;
        }
    }
    return sb3Definitions;
};

/**
 * Add the definitions a schema refers to.
 * @param {object} ajv An Ajv instance.
 * @param {boolean} sb2 Whether to add the sb2 definitions too.
 * @returns {object} The same instance.
 */
const prepareAjv = (ajv, sb2) => {
    if (!ajv.getSchema('https://scratch.mit.edu/sb3_definitions.json')) ajv.addSchema(getSb3Definitions());
    if (sb2 && !ajv.getSchema('https://scratch.mit.edu/sb2_definitions.json')) {
        ajv.addSchema(require('scratch-parser/lib/sb2_definitions.json'));
    }
    return ajv;
};

module.exports = {SCHEMAS, prepareAjv};
