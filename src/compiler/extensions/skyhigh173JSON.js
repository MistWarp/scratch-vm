const {TYPES} = require('../enums');
const {sanitize} = require('../shared');

const id = 'skyhigh173JSON';
const block = (type, target = false) => ({type, target});

const blocks = {
    json_is_valid: block(TYPES.BOOLEAN),
    json_is: block(TYPES.BOOLEAN),
    json_get_all: block(TYPES.JSON),
    json_new: block(TYPES.JSON),
    json_has_key: block(TYPES.BOOLEAN),
    json_has_value: block(TYPES.BOOLEAN),
    json_equal: block(TYPES.BOOLEAN),
    json_jlength: block(TYPES.UNKNOWN),
    json_get: block(TYPES.JSON_VALUE),
    json_set: block(TYPES.JSON),
    json_delete: block(TYPES.JSON),
    json_length: block(TYPES.UNKNOWN),
    json_array_get: block(TYPES.JSON_VALUE),
    json_array_push: block(TYPES.JSON),
    json_array_set: block(TYPES.JSON),
    json_array_insert: block(TYPES.JSON),
    json_array_delete: block(TYPES.JSON),
    json_array_remove_all: block(TYPES.JSON),
    json_array_itemH: block(TYPES.STRING),
    json_array_from: block(TYPES.JSON),
    json_array_fromto: block(TYPES.JSON),
    json_array_reverse: block(TYPES.JSON),
    json_array_flat: block(TYPES.JSON),
    json_array_concat: block(TYPES.JSON),
    json_array_filter: block(TYPES.JSON),
    json_array_setlen: block(TYPES.JSON),
    json_array_create: block(TYPES.JSON),
    json_array_join: block(TYPES.STRING),
    json_array_sort: block(TYPES.JSON),
    json_array_analysis: block(TYPES.NUMBER_NAN),
    json_vm_getlist: block(TYPES.JSON, true),
    json_vm_setlist: block(null, true)
};

const helperSources = {
    extJSONValue: `const extJSONValue = value => {
        if (typeof value === "string" && (
            (value[0] === "[" && value[value.length - 1] === "]") ||
            (value[0] === "{" && value[value.length - 1] === "}")
        )) {
            try {
                value = JSON.parse(value) ?? "";
            } catch {
                // Keep the original string.
            }
        }
        if (Number.isNaN(value)) return "NaN";
        if (value === Infinity) return "Infinity";
        if (value === -Infinity) return "-Infinity";
        return value ?? "";
    }`,
    extJSONIsValid: `const extJSONIsValid = value => {
        if (typeof value !== "string") return false;
        value = value.trim();
        if (!(
            (value[0] === "[" && value[value.length - 1] === "]") ||
            (value[0] === "{" && value[value.length - 1] === "}")
        )) return false;
        try {
            JSON.parse(value);
            return true;
        } catch {
            return false;
        }
    }`,
    extJSONIs: `const extJSONIs = (json, type) => {
        if (!extJSONIsValid(json)) return false;
        const value = JSON.parse(json);
        return type === "Array" ? Array.isArray(value) : type === "Object" && !Array.isArray(value);
    }`,
    extJSONGetAll: `const extJSONGetAll = (json, type) => {
        try {
            const keys = Object.keys(json);
            if (type === "keys") return keys;
            if (type === "values") return keys.map(key => json[key] ?? "");
            if (type === "datas") return keys.map(key => [key, json[key] ?? ""]);
        } catch {
            // Return an empty JSON value.
        }
        return [];
    }`,
    extJSONNew: `const extJSONNew = type => type === "Array" ? [] : {}`,
    extJSONHasKey: `const extJSONHasKey = (json, key) => {
        try {
            return extJSONValue(key) in json;
        } catch {
            return false;
        }
    }`,
    extJSONGet: `const extJSONGet = (json, key) => {
        try {
            if (Object.prototype.hasOwnProperty.call(json, key)) {
                return json[key] ?? "";
            }
        } catch {
            // Return the extension's empty fallback.
        }
        return "";
    }`,
    extJSONSet: `const extJSONSet = (json, key, value) => {
        if (json === null || typeof json !== "object") return {};
        const result = Array.isArray(json) ? json.slice() : {...json};
        result[key] = extJSONValue(value);
        return result;
    }`,
    extJSONDelete: `const extJSONDelete = (json, key) => {
        if (json === null || typeof json !== "object") return {};
        const result = Array.isArray(json) ? json.slice() : {...json};
        delete result[key];
        return result;
    }`,
    extJSONLength: `const extJSONLength = json => {
        try {
            return Object.keys(json).length;
        } catch {
            return " ";
        }
    }`,
    extJSONArrayGet: `const extJSONArrayGet = (json, index) => {
        try {
            index = +index;
            if (Number.isNaN(index) || index === 0) return "";
            if (index > 0) index--;
            return (index >= 0 ? json[index] : json[json.length + index]) ?? "";
        } catch {
            return "";
        }
    }`,
    extJSONArrayPush: `const extJSONArrayPush = (json, value) => {
        if (!Array.isArray(json)) return [];
        const result = json.slice();
        result.push(extJSONValue(value));
        return result;
    }`,
    extJSONArraySet: `const extJSONArraySet = (json, index, value) => {
        if (!Array.isArray(json)) return [];
        const result = json.slice();
        result[index - 1] = extJSONValue(value);
        return result;
    }`,
    extJSONArrayInsert: `const extJSONArrayInsert = (json, index, value) => {
        if (!Array.isArray(json)) return [];
        const result = json.slice();
        result.splice(index - 1, 0, extJSONValue(value));
        return result;
    }`,
    extJSONArrayDelete: `const extJSONArrayDelete = (json, index) => {
        if (!Array.isArray(json)) return [];
        const result = json.slice();
        result.splice(index - 1, 1);
        return result;
    }`
};

const helperDependencies = {
    extJSONIs: ['extJSONIsValid'],
    extJSONHasKey: ['extJSONValue'],
    extJSONSet: ['extJSONValue'],
    extJSONArrayPush: ['extJSONValue'],
    extJSONArraySet: ['extJSONValue'],
    extJSONArrayInsert: ['extJSONValue']
};

const useHelper = (compiler, name) => {
    for (const dependency of helperDependencies[name] || []) {
        useHelper(compiler, dependency);
    }
    compiler.prependFunctions.set(name, helperSources[name]);
    return name;
};

const findArgument = (values, name) => Object.keys(values || {})
    .find(candidate => candidate.toLowerCase() === name.toLowerCase());

const compileArgument = (node, compiler, name) => {
    const inputName = findArgument(node.inputs, name);
    if (inputName && node.inputs[inputName]) return compiler.descendInput(node.inputs[inputName]);

    const fieldName = findArgument(node.fields, name);
    if (fieldName) {
        const field = node.fields[fieldName];
        return compiler.safeConstantInput(field && typeof field === 'object' ? field.value : field);
    }

    // Old projects and extension patches can omit menu shadows. Match Scratch's empty-input fallback.
    return compiler.safeConstantInput('');
};

const nativeCall = (node, compiler, helper, inputs, jsonInputs = [], valueInputs = []) =>
    `${useHelper(compiler, helper)}(${inputs
        .map(name => {
            const input = compileArgument(node, compiler, name);
            if (jsonInputs.includes(name)) return input.asJSON();
            if (valueInputs.includes(name) && !input.isAlwaysConstant()) return input.source;
            return input.asSafe();
        })
        .join(', ')})`;

const nativeGenerators = {
    json_is_valid: (node, compiler) => nativeCall(node, compiler, 'extJSONIsValid', ['json']),
    json_is: (node, compiler) => nativeCall(node, compiler, 'extJSONIs', ['json', 'types']),
    json_get_all: (node, compiler) => nativeCall(node, compiler, 'extJSONGetAll', ['json', 'Stype'], ['json']),
    json_new: (node, compiler) => nativeCall(node, compiler, 'extJSONNew', ['json']),
    json_has_key: (node, compiler) => nativeCall(node, compiler, 'extJSONHasKey', ['json', 'key'], ['json']),
    json_jlength: (node, compiler) => nativeCall(node, compiler, 'extJSONLength', ['json'], ['json']),
    json_get: (node, compiler) => nativeCall(node, compiler, 'extJSONGet', ['json', 'item'], ['json']),
    json_set: (node, compiler) => nativeCall(node, compiler, 'extJSONSet',
        ['json', 'item', 'value'], ['json'], ['value']),
    json_delete: (node, compiler) => nativeCall(node, compiler, 'extJSONDelete', ['json', 'item'], ['json']),
    json_length: (node, compiler) => nativeCall(node, compiler, 'extJSONLength', ['json'], ['json']),
    json_array_get: (node, compiler) => nativeCall(node, compiler, 'extJSONArrayGet', ['json', 'item'], ['json']),
    json_array_push: (node, compiler) => nativeCall(node, compiler, 'extJSONArrayPush',
        ['json', 'item'], ['json'], ['item']),
    json_array_set: (node, compiler) => nativeCall(node, compiler, 'extJSONArraySet',
        ['json', 'pos', 'item'], ['json'], ['item']),
    json_array_insert: (node, compiler) => nativeCall(node, compiler, 'extJSONArrayInsert',
        ['json', 'pos', 'item'], ['json'], ['item']),
    json_array_delete: (node, compiler) => nativeCall(node, compiler, 'extJSONArrayDelete',
        ['json', 'item'], ['json'])
};

const generateExtensionCall = (node, compiler, info) => {
    const args = [];
    for (const [name, input] of Object.entries(node.inputs)) {
        args.push(`"${sanitize(name)}":${compiler.descendInput(input).asSafe()}`);
    }
    for (const [name, value] of Object.entries(node.fields)) {
        args.push(`"${sanitize(name)}":"${sanitize(value)}"`);
    }
    const method = node.opcode.substring(id.length + 1);
    return `runtime.ext_${id}.${method}({${args.join(',')}}${info.target ? ', {target}' : ''})`;
};

const generate = (node, compiler, info) => {
    const opcode = node.opcode.substring(id.length + 1);
    const native = nativeGenerators[opcode];
    if (native) return native(node, compiler);
    const source = generateExtensionCall(node, compiler, info);
    return info.type === TYPES.JSON ? `(parseJSON(${source}) ?? {})` : source;
};

const isNative = opcode => Boolean(nativeGenerators[opcode]);

module.exports = {id, blocks, generate, isNative};
