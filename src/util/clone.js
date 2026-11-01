/** Returned by copyPlain when a value needs JSON's own rules. */
const NOT_PLAIN = Symbol('not plain');

/**
 * Copy data that a JSON round trip would leave unchanged: finite numbers, strings, booleans, null, and arrays and
 * plain objects of those. Returns NOT_PLAIN for anything else, so the caller can fall back to JSON.
 * @param {*} value Value to copy.
 * @param {number} depth How deep in the value this is. Very deep values, or cycles, use JSON.
 * @returns {*} The copy, or NOT_PLAIN.
 */
const copyPlain = (value, depth) => {
    switch (typeof value) {
    case 'string':
    case 'boolean':
        return value;
    case 'number':
        // JSON turns NaN and Infinity into null, and -0 into 0.
        return Number.isFinite(value) && !Object.is(value, -0) ? value : NOT_PLAIN;
    case 'object': {
        if (value === null) return null;
        if (depth > 64) return NOT_PLAIN;
        const proto = Object.getPrototypeOf(value);
        if (proto === Array.prototype) {
            const copy = new Array(value.length);
            for (let i = 0; i < value.length; i++) {
                // A hole is read as undefined, which isn't plain.
                const item = copyPlain(value[i], depth + 1);
                if (item === NOT_PLAIN) return NOT_PLAIN;
                copy[i] = item;
            }
            return copy;
        }
        // Other prototypes (Date, Map, boxed primitives, class instances) and toJSON have their own JSON rules.
        if (proto !== Object.prototype || typeof value.toJSON === 'function') return NOT_PLAIN;
        const copy = {};
        for (const key of Object.keys(value)) {
            // Assigning an own __proto__ key would set the copy's prototype instead.
            if (key === '__proto__') return NOT_PLAIN;
            const item = copyPlain(value[key], depth + 1);
            if (item === NOT_PLAIN) return NOT_PLAIN;
            copy[key] = item;
        }
        return copy;
    }
    default:
        // undefined, functions, symbols and bigints
        return NOT_PLAIN;
    }
};

/**
 * Methods for cloning JavaScript objects.
 * @type {object}
 */
class Clone {
    /**
     * Deep-clone a "simple" object: one which can be fully expressed with JSON.
     * Non-JSON values, such as functions, will be stripped from the clone.
     * @param {object} original - the object to be cloned.
     * @returns {object} a deep clone of the original object.
     */
    static simple (original) {
        // Every new clone copies its extensions' state through here, so skip the JSON text when the data is plain.
        const copy = copyPlain(original, 0);
        return copy === NOT_PLAIN ? JSON.parse(JSON.stringify(original)) : copy;
    }
}

module.exports = Clone;
