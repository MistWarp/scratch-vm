const {TYPES} = require('./enums');
const Cast = require('../util/cast');
const {sanitize} = require('./shared');

let CURRENT_GENERATOR;

const setCurrentGenerator = generator => {
    CURRENT_GENERATOR = generator;
};

setCurrentGenerator(null);

/**
 * @typedef {string | number | boolean} ConstantValue
 */

/**
 * @typedef Input
 * @property {number} type The type of this input.
 * @property {string} source The source code for this input.
 * @property {JSGenerator|null} _generator The JSGenerator that created this input.
 * @property {string?} _cacheVar The name of the variable caching this input, if any.
 * @property {ConstantValue} [constantValue] The constant value of this input, if any.
 * @property {() => string} asNumber gives the code to get the number version of the value
 * @property {() => string} asInt gives the code to get the truncated integer version of the value
 * @property {() => string} asNumberOrNaN gives the code to get the number version of the value, possibly NaN
 * @property {() => string} asString gives the code to get the string version of the value
 * @property {() => string} asStringOrEmpty gives the code to get the string version of the value ?? ""
 * @property {() => string} asLowerString gives the code to get the lower-case version of the string
 * @property {() => string} asBoolean gives the code to get the boolean version of the value
 * @property {() => string} asColor gives the code to get the color version of the value
 * @property {() => string} asUnknown gives the code to get the value without any conversion
 * @property {() => boolean} isSafe means that the value is safe to use without conversion
 * @property {() => string} asSafe gives the code to get the value in a safe way (converted to string if not safe)
 * @property {() => boolean} isAlwaysNumber means that a value is always a number (never NaN)
 * @property {() => boolean} isAlwaysNumberOrNaN means that a value is either a number or NaN
 * @property {() => boolean} isNeverNumber means that a value is never a number (always NaN or non-number)
 * @property {() => boolean} isAlwaysInt means that a value is always an integer
 * @property {() => boolean} isAlwaysFinite means that a value is always a finite number (never NaN or Infinity)
 * @property {() => boolean} isAlwaysConstant means that a value is constant
 * @property {(value: ConstantValue) => boolean} isConstant means that a value is always a specified constant
 */

/**
 * @implements {Input}
 */
class TypedInput {
    /**
     * @param {string} source The source code for this input.
     * @param {number} type The type of this input.
     */
    constructor (source, type) {
        if (typeof type !== 'number') throw new Error('type is invalid');
        this.source = source;
        this.type = type;
        this._cacheVar = null;
        this._lastLinePos = -1;
    }

    asNumber () {
        if (this.type === TYPES.NUMBER) return this.source;
        if (this.type === TYPES.NUMBER_INT) return this.source;
        if (this.type === TYPES.NUMBER_NAN) return `toNotNaN(${this.source})`;
        const ret = `toNotNaN(+${this.source})`;
        return ret;
    }

    asInt () {
        if (this.type === TYPES.NUMBER_INT) return this.source;
        if (this.type === TYPES.NUMBER) return `(${this.source} | 0)`;
        return `toNotNaN(${this.source} | 0)`;
    }

    asNumberOrNaN () {
        if (this.type === TYPES.NUMBER ||
            this.type === TYPES.NUMBER_NAN ||
            this.type === TYPES.NUMBER_INT) return this.source;
        return `(+${this.source})`;
    }

    asStringOrEmpty () {
        if (this.type === TYPES.STRING) return this.source;
        return `("" + ${this.source})`;
    }

    asString () {
        if (this.type === TYPES.STRING) return this.source;
        return `("" + ${this.source})`;
    }

    asLowerString () {
        if (this.type === TYPES.LOWER_STRING) return this.source;
        return `("" + ${this.source}).toLowerCase()`;
    }

    asBoolean () {
        if (this.type === TYPES.BOOLEAN) return this.source;
        return `toBoolean(${this.source})`;
    }

    asColor () {
        return this.asUnknown();
    }

    asUnknown () {
        return `${this.source}`;
    }

    isSafe () {
        return true;
    }

    asSafe () {
        return this.asUnknown();
    }

    isAlwaysInt () {
        return this.type === TYPES.NUMBER_INT;
    }

    isAlwaysNumber () {
        return this.type === TYPES.NUMBER ||
               this.type === TYPES.NUMBER_INT;
    }

    isAlwaysNumberOrNaN () {
        return this.type === TYPES.NUMBER ||
               this.type === TYPES.NUMBER_NAN ||
               this.type === TYPES.NUMBER_INT;
    }

    isNeverNumber () {
        return false;
    }

    isAlwaysFinite () {
        return this.type === TYPES.NUMBER_INT;
    }

    isAlwaysConstant () {
        return false;
    }

    isConstant () {
        return false;
    }
}

/**
 * @implements {Input}
 * @property {ConstantInput} constantValue The underlying value of the constantInput
 * @property {() => true} isAlwaysConstant
 */
class ConstantInput {
    /**
     * @param {string|number|boolean} constantValue The constant value.
     * @param {boolean} safe Whether the constant value is safe to use.
     */
    constructor (constantValue, safe) {
        this.constantValue = constantValue;
        this.safe = safe;
        this.source = `${constantValue}`;
        this._cacheVar = null;

        this.type = TYPES.UNKNOWN;
        if (Number.isFinite(constantValue)) {
            this.type = Number.isInteger(constantValue) ?
                TYPES.NUMBER_INT :
                TYPES.NUMBER;
        } else if (typeof constantValue === 'string') {
            this.type = TYPES.STRING;
        } else if (typeof constantValue === 'boolean') {
            this.type = TYPES.BOOLEAN;
        }
    }

    asNumber () {
        // Compute at compilation time
        const numberValue = +this.constantValue;
        if (numberValue) {
            // It's important that we use the number's stringified value and not the constant value
            // Using the constant value allows numbers such as "010"
            // to be interpreted as 8 (or SyntaxError in strict mode) instead of 10.
            return numberValue.toString();
        }
        // numberValue is one of 0, -0, or NaN
        if (Object.is(numberValue, -0)) {
            return '-0';
        }
        return '0';
    }

    asInt () {
        if (this.isAlwaysInt()) {
            return this.asNumber();
        }
        return `${+this.constantValue | 0}`;
    }

    asNumberOrNaN () {
        return this.asNumber();
    }

    asString () {
        return `"${sanitize(`${this.constantValue}`)}"`;
    }

    asStringOrEmpty () {
        return this.asString();
    }

    asLowerString () {
        return `"${sanitize(`${this.constantValue}`).toLowerCase()}"`;
    }

    asBoolean () {
        // Compute at compilation time
        return Cast.toBoolean(this.constantValue).toString();
    }

    asColor () {
        // Attempt to parse hex code at compilation time
        const strConst = `${this.constantValue}`;
        if (/^#[0-9a-f]{6,8}$/i.test(strConst)) {
            const hex = strConst.substr(1);
            return Number.parseInt(hex, 16).toString();
        }
        return this.asUnknown();
    }

    asUnknown () {
        if (typeof this.constantValue === 'boolean') {
            return this.constantValue ? 'true' : 'false';
        }
        // Attempt to convert strings to numbers if it is unlikely to break things
        if (typeof this.constantValue === 'number') {
            // todo: handle NaN?
            return `${this.constantValue}`;
        }
        const numberValue = +this.constantValue;
        if (numberValue.toString() === this.constantValue) {
            return `${this.constantValue}`;
        }
        return this.asString();
    }

    isSafe () {
        if (typeof this.constantValue === 'boolean') {
            return true;
        }
        if (Number.isFinite(this.constantValue)) {
            return true;
        }
        return this.safe;
    }

    asSafe () {
        if (this.isSafe()) {
            return this.asUnknown();
        }
        return this.asString();
    }

    isAlwaysNumber () {
        const value = +this.constantValue;
        if (Number.isNaN(value)) {
            return false;
        }
        // Empty strings evaluate to 0 but should not be considered a number.
        if (value === 0) {
            return this.constantValue.toString().trim() !== '';
        }
        return true;
    }

    isAlwaysInt () {
        const numberValue = +this.constantValue;
        return numberValue === (numberValue | 0);
    }

    isAlwaysNumberOrNaN () {
        return this.isAlwaysNumber();
    }

    isNeverNumber () {
        return Number.isNaN(+this.constantValue);
    }

    isAlwaysFinite () {
        if (this.constantValue === '') return false;
        const value = +this.constantValue;
        if (Number.isNaN(value)) {
            return false;
        }
        if (Math.abs(value) === Infinity) {
            return false;
        }
        return true;
    }

    isAlwaysConstant () {
        return true;
    }

    /**
     * @param {ConstantValue} testValue
     * @returns {boolean}
     */
    isConstant (testValue) {
        const val = this.constantValue;
        if (+testValue === 0) {
            if (Object.is(+val, -0)) {
                return false;
            }
        }
        if (this.isAlwaysNumber()) {
            return +val === +testValue;
        }
        return val === testValue;
    }
}

/**
 * @implements {Input}
 */
class VariableInput {
    /**
     * @param {string} source The source code for this input.
     */
    constructor (source) {
        this.source = source;
        this.type = TYPES.UNKNOWN;
        this._cacheVar = null;
        this._generator = CURRENT_GENERATOR;
        this._lastLinePos = -1;
        /**
         * The value this variable was most recently set to, if any.
         * @type {Input}
         * @private
         */
        this._value = null;
    }

    /**
     * @param {Input} input The input this variable was most recently set to.
     */
    setInput (input) {
        if (input instanceof VariableInput) {
            // When being set to another variable, extract the value it was set to.
            // Otherwise, you may end up with infinite recursion in analysis methods when a variable is set to itself.
            if (input._value) {
                input = input._value;
            } else {
                this.type = TYPES.UNKNOWN;
                this._value = null;
                return;
            }
        }
        this._value = input;
        if (Object.hasOwn(input, 'constantValue')) {
            this.constantValue = input.constantValue;
        }
        if (input instanceof TypedInput || input instanceof ConstantInput) {
            this.type = input.type;
        } else {
            this.type = TYPES.UNKNOWN;
        }
        if (this._generator) {
            this._generator.setVariableType(this.source, this.type);
        }
    }

    asNumber () {
        if (this.type === TYPES.NUMBER) return this.source;
        if (this.type === TYPES.NUMBER_INT) return this.source;
        if (this.type === TYPES.NUMBER_NAN) return `toNotNaN(${this.source})`;
        return `toNotNaN(+${this.source})`;
    }

    asInt () {
        if (this.type === TYPES.NUMBER_INT) return this.source;
        if (this.type === TYPES.NUMBER ||
            this.type === TYPES.NUMBER_NAN) return `(${this.source} | 0)`;
        return `toNotNaN(+${this.source} | 0)`;
    }

    asNumberOrNaN () {
        if (this.type === TYPES.NUMBER ||
            this.type === TYPES.NUMBER_NAN ||
            this.type === TYPES.NUMBER_INT) return this.source;
        return `(+${this.source})`;
    }

    asString () {
        if (this.type === TYPES.STRING) return this.source;
        return `("" + ${this.source})`;
    }

    asStringOrEmpty () {
        if (this.type === TYPES.STRING) return this.source;
        return `("" + ${this.source})`;
    }

    asLowerString () {
        if (this.type === TYPES.LOWER_STRING) return this.source;
        return `("" + ${this.source}).toLowerCase()`;
    }

    asBoolean () {
        if (this.type === TYPES.BOOLEAN) return this.source;
        return `toBoolean(${this.source})`;
    }

    asColor () {
        return this.asUnknown();
    }

    asUnknown () {
        return this.source;
    }

    isSafe () {
        return true;
    }

    asSafe () {
        return this.asUnknown();
    }

    isAlwaysNumber () {
        if (this._value) {
            return this._value.isAlwaysNumber();
        }
        return false;
    }

    isAlwaysInt () {
        if (this._value) {
            return this._value.isAlwaysInt();
        }
        return false;
    }

    isAlwaysNumberOrNaN () {
        if (this._value) {
            return this._value.isAlwaysNumberOrNaN();
        }
        return false;
    }

    isNeverNumber () {
        if (this._value) {
            return this._value.isNeverNumber();
        }
        return false;
    }

    isAlwaysFinite () {
        if (this._value) {
            return this._value.isAlwaysFinite();
        }
        return false;
    }

    isAlwaysConstant () {
        if (this._value) {
            return this._value.isAlwaysConstant();
        }
        return false;
    }

    /**
     * @param {ConstantValue} testValue
     * @returns {boolean}
     */
    isConstant (testValue) {
        if (this._value) {
            return this._value.isConstant(testValue);
        }
        return false;
    }
}

module.exports = {TypedInput, ConstantInput, VariableInput, setCurrentGenerator};
