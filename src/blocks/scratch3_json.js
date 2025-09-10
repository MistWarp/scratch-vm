const Cast = require('../util/cast.js');
const Variable = require('../engine/variable.js');

/**
 * Block primitives for Dictionaries (formerly JSON).
 * Complete rewrite using native JavaScript methods for object/array handling.
 */
class Scratch3JsonBlocks {
    constructor (runtime) {
        /**
         * The runtime instantiating this block package.
         * @type {Runtime}
         */
        this.runtime = runtime;
    }

    /**
     * Retrieve the block primitives implemented by this package.
     * @return {object.<string, Function>} Mapping of opcode to Function.
     */
    getPrimitives () {
        return {
            // Dictionary operations
            json_get: this.dictGet,
            json_set: this.dictSet,
            json_delete: this.dictDelete,
            json_keys: this.dictKeys,
            json_values: this.dictValues,
            json_entries: this.dictEntries,
            json_length: this.dictLength,
            json_has_key: this.dictHasKey,
            json_stringify: this.dictStringify,
            json_create_object: this.createObject,
            // Monitor controls
            json_show_variable: this.showDictVariable,
            json_hide_variable: this.hideDictVariable,
            
            // List conversion
            data_get_list_as: this.getListAs,
            data_set_list_to_array: this.setListToArray,
            
            // Variable accessor
            data_jsoncontents: this.getDictVariable
        };
    }

    /**
     * Get or create a Dictionary variable
     * @param {object} args - Block arguments
     * @param {object} util - Utility object
     * @return {Variable} Dictionary variable
     */
    lookupOrCreateDictVariable (args, util) {
        const variableId = args.JSON?.id || args.VARIABLE?.id || args.JSON;
        const variableName = args.JSON?.name || args.VARIABLE?.name || 'dict';
        
        let variable = util.target.lookupVariableById(variableId);
        
        if (!variable) {
            // Create new Dictionary variable
            variable = new Variable(variableId, variableName, Variable.JSON_TYPE, false);
            variable.value = {};
            util.target.variables[variableId] = variable;
        }
        
        // Ensure the variable type is correct
        if (variable.type !== Variable.JSON_TYPE) {
            variable.type = Variable.JSON_TYPE;
        }
        
        // Ensure we have a valid object/array value
        if (typeof variable.value === 'string') {
            try {
                variable.value = JSON.parse(variable.value);
            } catch (e) {
                variable.value = {};
            }
        } else if (typeof variable.value !== 'object' || variable.value === null) {
            variable.value = {};
        }
        
        return variable;
    }

    /**
     * Get Dictionary variable value (for monitors)
     * @param {object} args - Block arguments
     * @param {object} util - Utility object
     * @return {object} Dictionary object formatted for display
     */
    getDictVariable (args, util) {
        const variable = this.lookupOrCreateDictVariable(args, util);
        const value = variable.value;
        
        // Return raw value for compiled code, but format for display when possible
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            // For objects, create a readable key-value display
            const keys = Object.keys(value);
            if (keys.length === 0) {
                return '{}';
            }
            
            // Create a formatted display string showing key-value pairs
            const pairs = keys.slice(0, 10).map(key => {
                let val = value[key];
                if (typeof val === 'string') {
                    val = `"${val}"`;
                } else if (typeof val === 'object' && val !== null) {
                    val = Array.isArray(val) ? `[${val.length} items]` : '{object}';
                }
                return `${key}: ${val}`;
            });
            
            let result = `{${pairs.join(', ')}}`;
            if (keys.length > 10) {
                result += ` (${keys.length - 10} more...)`;
            }
            return result;
        }
        
        return value;
    }

    /**
     * Get a value from Dictionary by key
     * @param {object} args - Block arguments
     * @param {object} util - Utility object
     * @return {any} Value at the specified key
     */
    dictGet (args, util) {
        const variable = this.lookupOrCreateDictVariable(args, util);
        const dictObj = variable.value;
        const key = Cast.toString(args.KEY);
        
        if (typeof dictObj === 'object' && dictObj !== null) {
            return typeof dictObj[key] === 'undefined' ? '' : dictObj[key];
        }
        
        return '';
    }

    /**
     * Set a value in Dictionary by key
     * @param {object} args - Block arguments
     * @param {object} util - Utility object
     */
    dictSet (args, util) {
        const variable = this.lookupOrCreateDictVariable(args, util);
        const dictObj = variable.value;
        const key = Cast.toString(args.KEY);
        let value = args.VALUE;
        
        // Ensure we have an object to work with
        if (typeof dictObj !== 'object' || dictObj === null) {
            variable.value = {};
        }
        
        // Try to parse value as JSON if it's a string
        if (typeof value === 'string') {
            try {
                value = JSON.parse(value);
            } catch (e) {
                // Keep as string if parsing fails
            }
        }
        
        variable.value[key] = value;
    }

    /**
     * Delete a key from Dictionary
     * @param {object} args - Block arguments
     * @param {object} util - Utility object
     */
    dictDelete (args, util) {
        const variable = this.lookupOrCreateDictVariable(args, util);
        const dictObj = variable.value;
        const key = Cast.toString(args.KEY);
        
        if (typeof dictObj === 'object' && dictObj !== null) {
            delete dictObj[key];
        }
    }

    /**
     * Get all keys from Dictionary as an array
     * @param {object} args - Block arguments
     * @param {object} util - Utility object
     * @return {Array} Array of keys
     */
    dictKeys (args, util) {
        const variable = this.lookupOrCreateDictVariable(args, util);
        const dictObj = variable.value;
        
        if (typeof dictObj === 'object' && dictObj !== null) {
            return Object.keys(dictObj);
        }
        
        return [];
    }

    /**
     * Get all values from Dictionary as an array
     * @param {object} args - Block arguments
     * @param {object} util - Utility object
     * @return {Array} Array of values
     */
    dictValues (args, util) {
        const variable = this.lookupOrCreateDictVariable(args, util);
        const dictObj = variable.value;
        
        if (typeof dictObj === 'object' && dictObj !== null) {
            return Object.values(dictObj);
        }
        
        return [];
    }

    /**
     * Get all entries from Dictionary as an array of [key, value] pairs
     * @param {object} args - Block arguments
     * @param {object} util - Utility object
     * @return {Array} Array of [key, value] pairs
     */
    dictEntries (args, util) {
        const variable = this.lookupOrCreateDictVariable(args, util);
        const dictObj = variable.value;
        
        if (typeof dictObj === 'object' && dictObj !== null) {
            return Object.entries(dictObj);
        }
        
        return [];
    }

    /**
     * Get the number of keys in Dictionary
     * @param {object} args - Block arguments
     * @param {object} util - Utility object
     * @return {number} Number of keys
     */
    dictLength (args, util) {
        const variable = this.lookupOrCreateDictVariable(args, util);
        const dictObj = variable.value;
        
        if (typeof dictObj === 'object' && dictObj !== null) {
            if (Array.isArray(dictObj)) {
                return dictObj.length;
            }
            return Object.keys(dictObj).length;
        }
        
        return 0;
    }

    /**
     * Check if Dictionary has a specific key
     * @param {object} args - Block arguments
     * @param {object} util - Utility object
     * @return {boolean} True if key exists
     */
    dictHasKey (args, util) {
        const variable = this.lookupOrCreateDictVariable(args, util);
        const dictObj = variable.value;
        const key = Cast.toString(args.KEY);
        
        if (typeof dictObj === 'object' && dictObj !== null) {
            return Object.prototype.hasOwnProperty.call(dictObj, key);
        }
        
        return false;
    }

    /**
     * Stringify Dictionary/JSON
     * @param {object} args - Block arguments
     * @return {string} Stringified JSON
     */
    dictStringify (args, util) {
        const variable = this.lookupOrCreateDictVariable(args, util);
        const dictObj = variable.value;

        try {
            return JSON.stringify(dictObj);
        } catch (e) {
            return '{}';
        }
    }

    /**
     * Parse text as Dictionary/JSON
     * @param {object} args - Block arguments
     * @return {object} Parsed JSON object
     */
    dictFromText (args) {
        const text = Cast.toString(args.TEXT);
        
        try {
            return JSON.parse(text);
        } catch (e) {
            return {};
        }
    }

    /**
     * Convert Dictionary to text string
     * @param {object} args - Block arguments
     * @param {object} util - Utility object
     * @return {string} Dictionary as text
     */
    dictToText (args, util) {
        const variable = this.lookupOrCreateDictVariable(args, util);
        const dictObj = variable.value;
        
        try {
            return JSON.stringify(dictObj);
        } catch (e) {
            return '{}';
        }
    }

    /**
     * Create an empty Dictionary object
     * @return {object} Empty object
     */
    dictCreateObject () {
        return {};
    }

    /**
     * Create an empty Dictionary array
     * @return {Array} Empty array
     */
    dictCreateArray () {
        return [];
    }

    // === NEW LIST OPERATIONS ===

    // === MONITOR CONTROLS ===

    /**
     * Show Dictionary variable monitor
     * @param {object} args - Block arguments
     * @param {object} util - Utility object
     */
    showDictVariable (args, util) {
        const variable = this.lookupOrCreateDictVariable(args, util);
        variable.isCloudVariable = false;
        this.runtime.requestAddMonitor({
            id: variable.id,
            mode: 'default',
            opcode: 'data_jsoncontents',
            params: {JSON: variable.name},
            spriteName: util.target.isStage ? null : util.target.sprite.name
        });
    }

    /**
     * Hide Dictionary variable monitor
     * @param {object} args - Block arguments
     * @param {object} util - Utility object
     */
    hideDictVariable (args, util) {
        const variable = this.lookupOrCreateDictVariable(args, util);
        this.runtime.requestRemoveMonitor(variable.id);
    }

    /**
     * Create/Set Dictionary object from string or object
     * @param {object} args - Block arguments
     * @param {object} util - Utility object
     */
    createObject (args, util) {
        const variable = this.lookupOrCreateDictVariable(args, util);
        const value = Cast.toString(args.VALUE || '{}');
        
        try {
            // Try to parse as JSON first
            variable.value = JSON.parse(value);
        } catch {
            // If parsing fails, create empty object
            variable.value = {};
        }
        
        // Ensure it's an object (not array or primitive)
        if (typeof variable.value !== 'object' || variable.value === null || Array.isArray(variable.value)) {
            variable.value = {};
        }
    }

    /**
     * Get list as specific type
     * @param {object} args - Block arguments
     * @param {object} util - Utility object
     * @return {any} List converted to specified type
     */
    getListAs (args, util) {
        const list = util.target.lookupVariableByNameAndType(args.LIST?.name || args.LIST, '', true);
        if (!list) return '';
        
        const type = args.TYPE || 'array';
        if (type === 'json') {
            return JSON.stringify(list.value);
        }
        return list.value;
    }

    /**
     * Set list to array from various inputs
     * @param {object} args - Block arguments
     * @param {object} util - Utility object
     */
    setListToArray (args, util) {
        const list = util.target.lookupVariableByNameAndType(args.LIST?.name || args.LIST, '', true);
        if (!list) return;
        
        const value = args.VALUE;
        
        if (typeof value === 'string') {
            try {
                // Try to parse as JSON array
                const parsed = JSON.parse(value);
                if (Array.isArray(parsed)) {
                    list.value = parsed;
                } else {
                    // If not an array, make it a single-item array
                    list.value = [value];
                }
            } catch {
                // If parsing fails, treat as single string value
                list.value = [value];
            }
        } else if (Array.isArray(value)) {
            list.value = value;
        } else {
            // Convert single value to array
            list.value = [value];
        }
    }
}

module.exports = Scratch3JsonBlocks;
