const log = require('../util/log');
const Cast = require('../util/cast');
const BlockType = require('../extension-support/block-type');
const VariablePool = require('./variable-pool');
const jsexecute = require('./jsexecute');
const environment = require('./environment');

const {
    TYPES, BLOCKS,
    getNameForType
} = require('./enums');


// Imported for JSDoc types, not to actually use
// eslint-disable-next-line no-unused-vars
const {IntermediateScript, IntermediateRepresentation} = require('./intermediate');
// eslint-disable-next-line no-unused-vars
const Variable = require('../engine/variable');

/* eslint-disable max-len */

/**
 * @fileoverview Convert intermediate representations to JavaScript functions.
 */

/**
 * @param {string} string
 * @returns {string}
 */
const sanitize = string => {
    if (typeof string !== 'string') {
        log.warn(`sanitize got unexpected type: ${typeof string}`);
        string = `${string}`;
    }
    return JSON.stringify(string).slice(1, -1);
};

/**
 * @type {JSGenerator|null}
 * @private
 */
let CURRENT_GENERATOR = null;

// Pen-related constants
const PEN_EXT = 'runtime.ext_pen';
const PEN_STATE = `${PEN_EXT}._getPenState(target)`;

/**
 * Variable pool used for factory function names.
 */
const factoryNameVariablePool = new VariablePool('factory');

/**
 * Variable pool used for generated functions (non-generator)
 */
const functionNameVariablePool = new VariablePool('fun');

/**
 * Variable pool used for generated generator functions.
 */
const generatorNameVariablePool = new VariablePool('gen');


/**
 * @param {Input} input
 * @returns {boolean}
 */
const isSafeConstantForEqualsOptimization = input => {
    if (typeof input.constantValue === 'undefined') return false;

    const numberValue = +input.constantValue;
    // Do not optimize 0 (+"" === 0 would be true)
    if (!numberValue) {
        return false;
    }
    // Do not optimize numbers when the original form does not match
    return numberValue.toString() === input.constantValue.toString();
};

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
 * @property {() => string} asStringOrEmpty gives the code to get the string version of the value, or "" if the value is null/undefined
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

// should inherit from object, only key thats garunteed is 'kind'
/**
 * @typedef {{ kind: number, [key: string]: any }} node
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
        this._generator = CURRENT_GENERATOR;
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
        if (this.type === TYPES.NUMBER_NAN) return `toNotNaN(${this.source} | 0)`;
        return `toNotNaN(+${this.source} | 0)`;
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
        return false;
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
        this._generator = CURRENT_GENERATOR;
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
            // Using the constant value allows numbers such as "010" to be interpreted as 8 (or SyntaxError in strict mode) instead of 10.
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
        return true && isSafeConstantForEqualsOptimization(this);
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
        this._generator = CURRENT_GENERATOR;
        this._cacheVar = null;
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

/**
 * @param {import('../engine/runtime')} runtime
 * @returns {Set<string>}
 */
const getNamesOfCostumesAndSounds = runtime => {
    const result = new Set();
    for (const target of runtime.targets) {
        if (target.isOriginal) {
            const sprite = target.sprite;
            for (const costume of sprite.costumes) {
                result.add(costume.name);
            }
            for (const sound of sprite.sounds) {
                result.add(sound.name);
            }
        }
    }
    return result;
};

/**
 * A frame contains some information about the current substack being compiled.
 */
class Frame {
    /**
     * @param {boolean} isLoop Whether this frame is a loop frame.
     */
    constructor (isLoop) {
        /**
         * Whether the current stack runs in a loop (while, for)
         * @type {boolean}
         * @readonly
         */
        this.isLoop = isLoop;

        /**
         * Whether the current block is the last block in the stack.
         * @type {boolean}
         */
        this.isLastBlock = false;

        /**
         * Whether the current frame can be broken out of (switch/case blocks)
         * @type {boolean}
         */
        this.isBreakable = false;

        /**
         * The variable name holding the switch value (for switch frames)
         * @type {string?}
         */
        this.switchValue = null;
    }
}

// Cache for Math constants and functions
const MATH_CACHE = {
    PI: 'const PI=Math.PI;',
    DEG_TO_RAD: 'const DEG_TO_RAD=PI/180;',
    RAD_TO_DEG: 'const RAD_TO_DEG=180/PI;',
    sin: 'const sin=Math.sin;',
    cos: 'const cos=Math.cos;',
    tan: 'const tan=Math.tan;',
    asin: 'const asin=Math.asin;',
    acos: 'const acos=Math.acos;',
    atan: 'const atan=Math.atan;',
    sqrt: 'const sqrt=Math.sqrt;',
    abs: 'const abs=Math.abs;',
    round: 'const round=Math.round;',
    floor: 'const floor=Math.floor;',
    ceil: 'const ceil=Math.ceil;',
    exp: 'const exp=Math.exp;',
    log: 'const log=Math.log;',
    LN10: 'const LN10=Math.LN10;',
    pow: 'const pow=Math.pow;',
    max: 'const max=Math.max;',
    min: 'const min=Math.min;'
};

class JSGenerator {
    /**
     * @param {IntermediateScript} script
     * @param {IntermediateRepresentation} ir
     * @param {Target} target
     */
    constructor (script, ir, target) {
        this.script = script;
        this.ir = ir;
        this.target = target;
        this.source = '';

        /**
         * @type {Object.<string, VariableInput>}
         */
        this.variableInputs = Object.create(null);

        this.isWarp = script.isWarp;
        this.isProcedure = script.isProcedure;
        this.warpTimer = script.warpTimer;

        /**
         * Stack of frames, most recent is last item.
         * @type {Frame[]}
         */
        this.frames = [];

        /**
         * Type contexts for each stack frame.
         * @type {Map<string, number>[]}
         */
        this.typeCtxs = [];

        /**
         * The current Frame.
         * @type {Frame?}
         */
        this.currentFrame = null;

        this.namesOfCostumesAndSounds = getNamesOfCostumesAndSounds(target.runtime);

        this.localVariables = new VariablePool('a');
        this._setupVariablesPool = new VariablePool('b');
        this._setupVariables = Object.create(null);
        this.usedMathFunctions = new Set();

        this.descendedIntoModulo = false;
        this.isInHat = false;

        this.debug = this.target.runtime.debug;
        this._cachedProperties = new Map();
        // Cache environment feature flags locally to avoid repeated global lookups.
        this.supportsNullishCoalescing = environment.supportsNullishCoalescing;

        this.typeCtxs.push(new Map());
    }

    getCurrentTypeCtx () {
        return this.typeCtxs[this.typeCtxs.length - 1];
    }

    clearVariableTypes () {
        this.getCurrentTypeCtx().clear();
    }

    /**
     * Enter a new frame
     * @param {Frame} frame New frame.
     */
    pushFrame (frame) {
        this.frames.push(frame);
        this.typeCtxs.push(new Map());
        this.currentFrame = frame;
    }

    /**
     * Exit the current frame
     */
    popFrame () {
        this.frames.pop();
        this.typeCtxs.pop();
        this.currentFrame = this.frames[this.frames.length - 1];
    }

    /**
     * @returns {boolean} true if the current block is the last command of a loop
     */
    isLastBlockInLoop () {
        for (let i = this.frames.length - 1; i >= 0; i--) {
            const frame = this.frames[i];
            if (!frame.isLastBlock) return false;
            if (frame.isLoop) return true;
        }
        return false;
    }

    /**
     * @param {node} node Input node to compile.
     * @returns {Input} Compiled input.
     */
    descendInput (node) {
        switch (node.kind) {
        case BLOCKS.ADDONS.CALL:
            return new TypedInput(`(${this.descendAddonCall(node)})`, TYPES.UNKNOWN);

        case BLOCKS.COMPAT:
            // Compatibility layer inputs never use flags.
            return new TypedInput(`(${this.generateCompatibilityLayerCall(node, false)})`, TYPES.UNKNOWN);

        case BLOCKS.CONSTANT:
            return this.safeConstantInput(node.value);

        case BLOCKS.COUNTER.GET:
            return new TypedInput('runtime.ext_scratch3_control._counter', TYPES.NUMBER);

        case BLOCKS.KEYBOARD.PRESSED:
            return new TypedInput(`runtime.ioDevices.keyboard.getKeyIsDown(${this.descendInput(node.key).asSafe()})`, TYPES.BOOLEAN);

        case BLOCKS.LIST.CONTAINS:
            return new TypedInput(`listContains(${this.referenceVariable(node.list)}, ${this.descendInput(node.item).asUnknown()})`, TYPES.BOOLEAN);
        case BLOCKS.LIST.CONTENTS:
            return new TypedInput(`listContents(${this.referenceVariable(node.list)})`, TYPES.STRING);
        case BLOCKS.LIST.GET: {
            const index = this.descendInput(node.index);
            const list = this.referenceVariable(node.list);
            if (this.supportsNullishCoalescing) {
                if (index.isAlwaysInt() && index.isAlwaysConstant()) {
                    return new TypedInput(`(${list}.value[${(+index.asInt()) - 1}] ?? "")`, TYPES.UNKNOWN);
                }
                if (index.isAlwaysNumberOrNaN()) {
                    return new TypedInput(`(${list}.value[${index.asInt()} - 1] ?? "")`, TYPES.UNKNOWN);
                }
                if (index.isConstant('last')) {
                    return new TypedInput(`(${list}.value[${list}.value.length - 1] ?? "")`, TYPES.UNKNOWN);
                }
            }
            return new TypedInput(`listGet(${list}.value, ${index.asUnknown()})`, TYPES.UNKNOWN);
        }
        case BLOCKS.LIST.INDEXOF:
            return new TypedInput(`listIndexOf(${this.referenceVariable(node.list)}, ${this.descendInput(node.item).asUnknown()})`, TYPES.NUMBER_INT);
        case BLOCKS.LIST.LENGTH:
            return new TypedInput(`${this.referenceVariable(node.list)}.value.length`, TYPES.NUMBER_INT);
        case BLOCKS.LIST.AS:
            if (node.format === 'JSON') {
                return new TypedInput(`JSON.stringify(${this.referenceVariable(node.list)}.value)`, TYPES.STRING);
            } else if (node.format === 'STRING') {
                return new TypedInput(`(${this.referenceVariable(node.list)}.value.join(", "))`, TYPES.STRING);
            }
            break;
        case BLOCKS.LOOKS.SIZE:
            this.usedMathFunctions.add('round');
            return new TypedInput('round(target.size)', TYPES.NUMBER);
        case BLOCKS.LOOKS.BACKDROP_NAME:
            return new TypedInput('stage.getCostumes()[stage.currentCostume].name', TYPES.STRING);
        case BLOCKS.LOOKS.BACKDROP_NUMBER:
            return new TypedInput('(stage.currentCostume + 1)', TYPES.NUMBER_INT);
        case BLOCKS.LOOKS.COSTUME_NAME:
            return new TypedInput('target.getCostumes()[target.currentCostume].name', TYPES.STRING);
        case BLOCKS.LOOKS.COSTUME_NUMBER:
            return new TypedInput('(target.currentCostume + 1)', TYPES.NUMBER_INT);
        case BLOCKS.LOOKS.COSTUMES:
            return new TypedInput('JSON.stringify(target.getCostumes().map(costume => costume.name))', TYPES.STRING);

        case BLOCKS.MOTION.DIRECTION:
            return new TypedInput('target.direction', TYPES.NUMBER);
        case BLOCKS.MOTION.X_POSITION:
            return new TypedInput('limitPrecision(target.x)', TYPES.NUMBER);
        case BLOCKS.MOTION.Y_POSITION:
            return new TypedInput('limitPrecision(target.y)', TYPES.NUMBER);

        case BLOCKS.MOUSE.DOWN:
            return new TypedInput('runtime.ioDevices.mouse.getIsDown()', TYPES.BOOLEAN);
        case BLOCKS.MOUSE.X:
            return new TypedInput('runtime.ioDevices.mouse.getScratchX()', TYPES.NUMBER_INT);
        case BLOCKS.MOUSE.Y:
            return new TypedInput('runtime.ioDevices.mouse.getScratchY()', TYPES.NUMBER_INT);

        case BLOCKS.NOOP:
            return new TypedInput('""', TYPES.STRING);

        case BLOCKS.OP.ABS:
            this.usedMathFunctions.add('abs');
            return new TypedInput(`abs(${this.descendInput(node.value).asNumber()})`, TYPES.NUMBER);
        case BLOCKS.OP.ACOS:
            // Needs to be marked as NaN because Math.acos(1.0001) === NaN
            this.usedMathFunctions.add('acos');
            this.usedMathFunctions.add('PI');
            return new TypedInput(`((acos(${this.descendInput(node.value).asNumber()}) * 180) / PI)`, TYPES.NUMBER_NAN);
        case BLOCKS.OP.ADD: {
            // Needs to be marked as NaN because Infinity + -Infinity === NaN
            const left = this.descendInput(node.left);
            const right = this.descendInput(node.right);
            if (left.isAlwaysConstant() && right.isAlwaysConstant()) {
                const value = +left.constantValue + +right.constantValue;
                if (Number.isNaN(value)) {
                    return new ConstantInput('NaN', false);
                }
                return new ConstantInput(value, false);
            }
            if (left.isAlwaysFinite() || right.isAlwaysFinite()) {
                if (left.isAlwaysInt() && right.isAlwaysInt()) {
                    return new TypedInput(`(${left.asNumber()} + ${right.asNumber()})`, TYPES.NUMBER_INT);
                }
                return new TypedInput(`(${left.asNumber()} + ${right.asNumber()})`, TYPES.NUMBER);
            }
            return new TypedInput(`(${left.asNumber()} + ${right.asNumber()})`, TYPES.NUMBER_NAN);
        }
        case BLOCKS.OP.SUBTRACT: {
            // Needs to be marked as NaN because Infinity - Infinity === NaN
            const left = this.descendInput(node.left);
            const right = this.descendInput(node.right);
            if (left.isAlwaysFinite() || right.isAlwaysFinite()) {
                if (left.isAlwaysInt() && right.isAlwaysInt()) {
                    return new TypedInput(`(${left.asNumber()} - ${right.asNumber()})`, TYPES.NUMBER_INT);
                }
                return new TypedInput(`(${left.asNumber()} - ${right.asNumber()})`, TYPES.NUMBER);
            }
            return new TypedInput(`(${left.asNumber()} - ${right.asNumber()})`, TYPES.NUMBER_NAN);
        }
        case BLOCKS.OP.MULTIPLY: {
            // Needs to be marked as NaN because Infinity * 0 === NaN
            const left = this.descendInput(node.left);
            const right = this.descendInput(node.right);
            if (left.isAlwaysFinite() || right.isAlwaysFinite()) {
                return new TypedInput(`(${left.asNumber()} * ${right.asNumber()})`, TYPES.NUMBER);
            }
            return new TypedInput(`(${left.asNumber()} * ${right.asNumber()})`, TYPES.NUMBER_NAN);
        }
        case BLOCKS.OP.DIVIDE: {
            const left = this.descendInput(node.left);
            const right = this.descendInput(node.right);
            if (right.isAlwaysConstant()) {
                if (!right.isConstant(0)) {
                    return new TypedInput(`(${left.asNumber()} / ${right.asNumber()})`, TYPES.NUMBER);
                }
                if (left.isConstant(0)) {
                    return new TypedInput('NaN', TYPES.NUMBER_NAN);
                }
            }
            return new TypedInput(`(${left.asNumber()} / ${right.asNumber()})`, TYPES.NUMBER_NAN);
        }
        case BLOCKS.OP.AND:
            return new TypedInput(`(${this.descendInput(node.left).asBoolean()} && ${this.descendInput(node.right).asBoolean()})`, TYPES.BOOLEAN);
        case BLOCKS.OP.ASIN:
            // Needs to be marked as NaN because Math.asin(1.0001) === NaN
            this.usedMathFunctions.add('asin');
            this.usedMathFunctions.add('PI');
            return new TypedInput(`((asin(${this.descendInput(node.value).asNumber()}) * 180) / PI)`, TYPES.NUMBER_NAN);
        case BLOCKS.OP.ATAN:
            this.usedMathFunctions.add('atan');
            this.usedMathFunctions.add('PI');
            return new TypedInput(`((atan(${this.descendInput(node.value).asNumber()}) * 180) / PI)`, TYPES.NUMBER);
        case BLOCKS.OP.CEILING: {
            const value = this.descendInput(node.value);
            if (value.isAlwaysInt()) {
                return new TypedInput(`${value.asInt()}`, TYPES.NUMBER_INT);
            }
            this.usedMathFunctions.add('ceil');
            return new TypedInput(`ceil(${value.asNumber()})`, TYPES.NUMBER_INT);
        }
        case BLOCKS.OP.CONTAINS:
            return new TypedInput(`(${this.descendInput(node.string).asLowerString()}.indexOf(${this.descendInput(node.contains).asLowerString()}) !== -1)`, TYPES.BOOLEAN);
        case BLOCKS.OP.COS:
            this.usedMathFunctions.add('cos');
            this.usedMathFunctions.add('PI');
            this.usedMathFunctions.add('round');
            return new TypedInput(`(round(cos((PI * ${this.descendInput(node.value).asNumber()}) / 180) * 1e10) / 1e10)`, TYPES.NUMBER_NAN);
        case BLOCKS.OP.EQUALS: {
            const left = this.descendInput(node.left);
            const right = this.descendInput(node.right);
            // When both operands are known to never be numbers, only use string comparison to avoid all number parsing.
            if (left.isNeverNumber() || right.isNeverNumber()) {
                const leftLower = left.asLowerString();
                const rightLower = right.asLowerString();
                return new TypedInput(`(${leftLower} === ${rightLower})`, TYPES.BOOLEAN);
            }
            if (left.isAlwaysConstant() && right.isAlwaysConstant()) {
                const leftVal = left.constantValue;
                const rightVal = right.constantValue;
                return new ConstantInput(leftVal === rightVal, false);
            }
            const leftAlwaysNumber = left.isAlwaysNumber();
            const rightAlwaysNumber = right.isAlwaysNumber();
            // When both operands are known to be numbers, we can use ===
            if (leftAlwaysNumber && rightAlwaysNumber) {
                return new TypedInput(`(${left.asNumber()} === ${right.asNumber()})`, TYPES.BOOLEAN);
            }
            // In certain conditions, we can use === when one of the operands is known to be a safe number.
            if (leftAlwaysNumber && left.isAlwaysConstant() && isSafeConstantForEqualsOptimization(left)) {
                return new TypedInput(`(${left.asNumber()} === ${right.asNumber()})`, TYPES.BOOLEAN);
            }
            if (rightAlwaysNumber && right.isAlwaysConstant() && isSafeConstantForEqualsOptimization(right)) {
                return new TypedInput(`(${left.asNumber()} === ${right.asNumber()})`, TYPES.BOOLEAN);
            }
            // No compile-time optimizations possible - use fallback method.
            return new TypedInput(`compareEqual(${left.asUnknown()}, ${right.asUnknown()})`, TYPES.BOOLEAN);
        }
        case BLOCKS.OP.EXP:
            this.usedMathFunctions.add('exp');
            return new TypedInput(`exp(${this.descendInput(node.value).asNumber()})`, TYPES.NUMBER);
        case BLOCKS.OP.FLOOR: {
            const value = this.descendInput(node.value);
            if (value.isAlwaysInt()) {
                return new TypedInput(`${value.asNumber()}`, TYPES.NUMBER_INT);
            }
            this.usedMathFunctions.add('floor');
            return new TypedInput(`floor(${this.descendInput(node.value).asNumber()})`, TYPES.NUMBER_INT);
        }
        case BLOCKS.OP.GREATER: {
            const left = this.descendInput(node.left);
            const right = this.descendInput(node.right);
            if (left.isAlwaysFinite() && right.isAlwaysFinite()) {
                return new TypedInput(`(${left.asNumber()} > ${right.asNumber()})`, TYPES.BOOLEAN);
            }
            // When the left operand is a number or NaN and the right operand is a number, we can negate <=
            if (left.isAlwaysNumberOrNaN() && right.isAlwaysNumber()) {
                return new TypedInput(`!(${left.asNumberOrNaN()} <= ${right.asNumber()})`, TYPES.BOOLEAN);
            }
            // When either operand is known to never be a number, avoid all number parsing.
            if (left.isNeverNumber() || right.isNeverNumber()) {
                return new TypedInput(`(${left.asLowerString()} > ${right.asLowerString()})`, TYPES.BOOLEAN);
            }
            // No compile-time optimizations possible - use fallback method.
            return new TypedInput(`compareGreaterThan(${left.asUnknown()}, ${right.asUnknown()})`, TYPES.BOOLEAN);
        }
        case BLOCKS.OP.JOIN: {
            const left = this.descendInput(node.left);
            const right = this.descendInput(node.right);
            if (left.isAlwaysConstant() && right.isAlwaysConstant()) {
                const leftVal = left.constantValue;
                const rightVal = right.constantValue;
                if (typeof leftVal === 'string' && typeof rightVal === 'string') {
                    return new ConstantInput(leftVal + rightVal, false);
                }
            }
            return new TypedInput(`(${left.asString()} + ${right.asString()})`, TYPES.STRING);
        }
        case BLOCKS.OP.LENGTH:
            return new TypedInput(`${this.descendInput(node.string).asString()}.length`, TYPES.NUMBER);
        case BLOCKS.OP.LESS: {
            const left = this.descendInput(node.left);
            const right = this.descendInput(node.right);
            if (left.isAlwaysFinite() && right.isAlwaysFinite()) {
                return new TypedInput(`(${left.asNumber()} < ${right.asNumber()})`, TYPES.BOOLEAN);
            }
            // When the left operand is a number or NaN and the right operand is a number, we can use <
            if (left.isAlwaysNumberOrNaN() && right.isAlwaysNumber()) {
                return new TypedInput(`(${left.asNumberOrNaN()} < ${right.asNumber()})`, TYPES.BOOLEAN);
            }
            // When the left operand is a number and the right operand is a number or NaN, we can negate >=
            if (left.isAlwaysNumber() && right.isAlwaysNumberOrNaN()) {
                return new TypedInput(`!(${left.asNumber()} >= ${right.asNumberOrNaN()})`, TYPES.BOOLEAN);
            }
            // When either operand is known to never be a number, avoid all number parsing.
            if (left.isNeverNumber() || right.isNeverNumber()) {
                return new TypedInput(`(${left.asLowerString()} < ${right.asLowerString()})`, TYPES.BOOLEAN);
            }
            // No compile-time optimizations possible - use fallback method.
            return new TypedInput(`compareLessThan(${left.asUnknown()}, ${right.asUnknown()})`, TYPES.BOOLEAN);
        }
        case BLOCKS.OP.LETTEROF:
            return new TypedInput(`((${this.descendInput(node.string).asString()})[${this.descendInput(node.letter).asInt()} - 1] || "")`, TYPES.STRING);
        case BLOCKS.OP.LN:
            // Needs to be marked as NaN because Math.log(-1) == NaN
            return new TypedInput(`Math.log(${this.descendInput(node.value).asNumber()})`, TYPES.NUMBER_NAN);
        case BLOCKS.OP.LOG:
            // Needs to be marked as NaN because Math.log(-1) == NaN
            this.usedMathFunctions.add('log');
            this.usedMathFunctions.add('LN10');
            return new TypedInput(`(log(${this.descendInput(node.value).asNumber()}) / LN10)`, TYPES.NUMBER_NAN);
        case BLOCKS.OP.MOD:
            this.descendedIntoModulo = true;
            // Needs to be marked as NaN because mod(0, 0) (and others) == NaN
            return new TypedInput(`mod(${this.descendInput(node.left).asNumber()}, ${this.descendInput(node.right).asNumber()})`, TYPES.NUMBER_NAN);
        case BLOCKS.OP.PI:
            this.usedMathFunctions.add('PI');
            return new TypedInput('PI', TYPES.NUMBER);
        case BLOCKS.OP.NEWLINE:
            return new TypedInput('"\n"', TYPES.STRING);
        case BLOCKS.OP.NOT:
            return new TypedInput(`!${this.descendInput(node.operand).asBoolean()}`, TYPES.BOOLEAN);
        case BLOCKS.OP.OR:
            return new TypedInput(`(${this.descendInput(node.left).asBoolean()} || ${this.descendInput(node.right).asBoolean()})`, TYPES.BOOLEAN);
        case BLOCKS.OP.RANDOM: {
            const left = this.descendInput(node.low);
            const right = this.descendInput(node.high);
            if (left.isAlwaysInt() && right.isAlwaysInt()) {
                // Both inputs are ints, so we know neither are NaN
                return new TypedInput(`randomInt(${left.asNumber()}, ${right.asNumber()})`, TYPES.NUMBER_INT);
            }
            if (node.useFloats) {
                return new TypedInput(`randomFloat(${left.asNumber()}, ${right.asNumber()})`, TYPES.NUMBER_NAN);
            }
            return new TypedInput(`runtime.ext_scratch3_operators._random(${left.asUnknown()}, ${right.asUnknown()})`, TYPES.NUMBER_NAN);
        }
        case BLOCKS.OP.ROUND: {
            const inp = this.descendInput(node.value);
            if (inp.isAlwaysInt()) {
                return new TypedInput(`${inp.asNumber()}`, TYPES.NUMBER_INT);
            }
            this.usedMathFunctions.add('round');
            return new TypedInput(`round(${inp.asNumber()})`, TYPES.NUMBER_INT);
        }
        case BLOCKS.OP.SIN:
            this.usedMathFunctions.add('sin');
            this.usedMathFunctions.add('PI');
            this.usedMathFunctions.add('round');
            return new TypedInput(`(round(sin((PI * ${this.descendInput(node.value).asNumber()}) / 180) * 1e10) / 1e10)`, TYPES.NUMBER_NAN);
        case BLOCKS.OP.SQRT:
            // Needs to be marked as NaN because Math.sqrt(-1) === NaN
            this.usedMathFunctions.add('sqrt');
            return new TypedInput(`sqrt(${this.descendInput(node.value).asNumber()})`, TYPES.NUMBER_NAN);
        case BLOCKS.OP.TAN:
            return new TypedInput(`tan(${this.descendInput(node.value).asNumber()})`, TYPES.NUMBER_NAN);
        case BLOCKS.OP.TENEXP:
            return new TypedInput(`(10 ** ${this.descendInput(node.value).asNumber()})`, TYPES.NUMBER);

        case BLOCKS.PROCEDURES.CALL: {
            const procedureCode = node.code;
            const procedureVariant = node.variant;
            const procedureData = this.ir.procedures[procedureVariant];
            if (procedureData.stack === null) {
                // Procedure has no body; still evaluate arguments for side effects
                const args = [];
                for (const input of node.arguments) {
                    args.push(this.descendInput(input).asSafe());
                }
                if (args.length) {
                    return new TypedInput(`(${args.join(',')}, "")`, TYPES.STRING);
                }
                return new TypedInput('""', TYPES.STRING);
            }

            // Recursion makes this complicated because:
            //  - We need to yield *between* each call in the same command block
            //  - We need to evaluate arguments *before* that yield happens

            const procedureReference = `thread.procedures["${sanitize(procedureVariant)}"]`;
            const args = [];
            for (const input of node.arguments) {
                args.push(this.descendInput(input).asSafe());
            }
            const joinedArgs = args.join(',');

            const yieldForRecursion = !this.isWarp && procedureCode === this.script.procedureCode;
            const yieldForHat = this.isInHat;
            if (yieldForRecursion || yieldForHat) {
                const runtimeFunction = procedureData.yields ? 'yieldThenCallGenerator' : 'yieldThenCall';
                return new TypedInput(`(yield* ${runtimeFunction}(${procedureReference}, ${joinedArgs}))`, TYPES.UNKNOWN);
            }
            if (procedureData.yields) {
                return new TypedInput(`(yield* ${procedureReference}(${joinedArgs}))`, TYPES.UNKNOWN);
            }
            return new TypedInput(`${procedureReference}(${joinedArgs})`, TYPES.UNKNOWN);
        }
        case BLOCKS.PROCEDURES.ARGUMENT:
            return new TypedInput(`p${node.index}`, TYPES.UNKNOWN);
        case BLOCKS.SENSING.ANSWER:
            return new TypedInput(`runtime.ext_scratch3_sensing._answer`, TYPES.STRING);
        case BLOCKS.SENSING.COLOR_TOUCHING_COLOR:
            return new TypedInput(`target.colorIsTouchingColor(colorToList(${this.descendInput(node.target).asColor()}), colorToList(${this.descendInput(node.mask).asColor()}))`, TYPES.BOOLEAN);
        case BLOCKS.SENSING.DATE:
            return new TypedInput(`(new Date().getDate())`, TYPES.NUMBER);
        case BLOCKS.SENSING.DAYOFWEEK:
            return new TypedInput(`(new Date().getDay() + 1)`, TYPES.NUMBER);
        case BLOCKS.SENSING.DAYS_SINCE_2000:
            return new TypedInput('daysSince2000()', TYPES.NUMBER);
        case BLOCKS.SENSING.DISTANCE:
            return new TypedInput(`distance(${this.descendInput(node.target).asString()})`, TYPES.NUMBER);
        case BLOCKS.SENSING.HOUR:
            return new TypedInput(`(new Date().getHours())`, TYPES.NUMBER);
        case BLOCKS.SENSING.MINUTE:
            return new TypedInput(`(new Date().getMinutes())`, TYPES.NUMBER);
        case BLOCKS.SENSING.MONTH:
            return new TypedInput(`(new Date().getMonth() + 1)`, TYPES.NUMBER);
        case BLOCKS.SENSING.OF: {
            const object = this.descendInput(node.object).asString();
            const property = node.property;
            if (node.object.kind === BLOCKS.CONSTANT) {
                const isStage = node.object.value === '_stage_';
                // Note that if target isn't a stage, we can't assume it exists
                const objectReference = isStage ? 'stage' : this.evaluateOnce(`runtime.getSpriteTargetByName(${object})`);
                if (property === 'volume') {
                    return new TypedInput(`(${objectReference} ? ${objectReference}.volume : 0)`, TYPES.NUMBER);
                }
                if (isStage) {
                    switch (property) {
                    case 'background #':
                        // fallthrough for scratch 1.0 compatibility
                    case 'backdrop #':
                        return new TypedInput(`(${objectReference}.currentCostume + 1)`, TYPES.NUMBER);
                    case 'backdrop name':
                        return new TypedInput(`${objectReference}.getCostumes()[${objectReference}.currentCostume].name`, TYPES.STRING);
                    }
                } else {
                    switch (property) {
                    case 'x position':
                        return new TypedInput(`(${objectReference} ? ${objectReference}.x : 0)`, TYPES.NUMBER);
                    case 'y position':
                        return new TypedInput(`(${objectReference} ? ${objectReference}.y : 0)`, TYPES.NUMBER);
                    case 'direction':
                        return new TypedInput(`(${objectReference} ? ${objectReference}.direction : 0)`, TYPES.NUMBER);
                    case 'costume #':
                        return new TypedInput(`(${objectReference} ? ${objectReference}.currentCostume + 1 : 0)`, TYPES.NUMBER);
                    case 'costume name':
                        return new TypedInput(`(${objectReference} ? ${objectReference}.getCostumes()[${objectReference}.currentCostume].name : 0)`, TYPES.UNKNOWN);
                    case 'size':
                        return new TypedInput(`(${objectReference} ? ${objectReference}.size : 0)`, TYPES.NUMBER);
                    }
                }
                const variableReference = this.evaluateOnce(`${objectReference} && ${objectReference}.lookupVariableByNameAndType("${sanitize(property)}", "", true)`);
                return new TypedInput(`(${variableReference} ? ${variableReference}.value : 0)`, TYPES.UNKNOWN);
            }
            return new TypedInput(`runtime.ext_scratch3_sensing.getAttributeOf({OBJECT: ${object}, PROPERTY: "${sanitize(property)}" })`, TYPES.UNKNOWN);
        }
        case BLOCKS.SENSING.SECOND:
            return new TypedInput(`(new Date().getSeconds())`, TYPES.NUMBER);
        case BLOCKS.SENSING.REFRESH_TIME:
            return new TypedInput('(runtime.screenRefreshTime / 1000)', TYPES.NUMBER);
        case BLOCKS.SENSING.TOUCHING:
            return new TypedInput(`target.isTouchingObject(${this.descendInput(node.object).asUnknown()})`, TYPES.BOOLEAN);
        case BLOCKS.SENSING.TOUCHING_COLOR:
            return new TypedInput(`target.isTouchingColor(colorToList(${this.descendInput(node.color).asColor()}))`, TYPES.BOOLEAN);
        case BLOCKS.SENSING.USERNAME:
            return new TypedInput('runtime.ioDevices.userData.getUsername()', TYPES.STRING);
        case BLOCKS.SENSING.YEAR:
            return new TypedInput(`(new Date().getFullYear())`, TYPES.NUMBER);

        case BLOCKS.TIMER.GET:
            return new TypedInput('runtime.ioDevices.clock.projectTimer()', TYPES.NUMBER);

        case BLOCKS.TW.LAST_KEY_PRESSED:
            return new TypedInput('runtime.ioDevices.keyboard.getLastKeyPressed()', TYPES.STRING);

        case BLOCKS.VAR.GET:
            return this.descendVariable(node.variable);
        }
        log.warn(`JS: Unknown input: ${getNameForType(node.kind)} (${node.kind})`, node);
        throw new Error(`JS: Unknown input: ${getNameForType(node.kind)} (${node.kind})`);
    }

    /**
     * @param {*} node Stacked node to compile.
     */
    descendStackedBlock (node) {
        switch (node.kind) {
        case BLOCKS.ADDONS.CALL:
            this.source += `${this.descendAddonCall(node)};\n`;
            break;

        case BLOCKS.COMPAT: {
            // If the last command in a loop returns a promise, immediately continue to the next iteration.
            // If you don't do this, the loop effectively yields twice per iteration and will run at half-speed.
            const isLastInLoop = this.isLastBlockInLoop();

            const blockType = node.blockType;
            if (blockType === BlockType.COMMAND || blockType === BlockType.HAT) {
                this.source += `${this.generateCompatibilityLayerCall(node, isLastInLoop)};\n`;
            } else if (blockType === BlockType.CONDITIONAL || blockType === BlockType.LOOP) {
                const branchVariable = this.localVariables.next();
                this.source += `const ${branchVariable} = createBranchInfo(${blockType === BlockType.LOOP});\n`;
                this.source += `while (${branchVariable}.branch = +(${this.generateCompatibilityLayerCall(node, false, branchVariable)})) {\n`;
                this.source += `switch (${branchVariable}.branch) {\n`;
                for (const index in node.substacks) {
                    this.source += `case ${+index}: {\n`;
                    this.descendStack(node.substacks[index], new Frame(false));
                    this.source += `break;\n`;
                    this.source += `}\n`; // close case
                }
                this.source += '}\n'; // close switch
                this.source += `if (!${branchVariable}.isLoop) break;\n`;
                this.yieldLoop();
                this.source += '}\n'; // close while
            } else {
                throw new Error(`Unknown block type: ${blockType}`);
            }

            if (isLastInLoop) {
                this.source += 'if (hasResumedFromPromise) {hasResumedFromPromise = false;continue;}\n';
            }
            break;
        }

        case BLOCKS.CONTROL.CREATE_CLONE:
            this.source += `runtime.ext_scratch3_control._createClone(${this.descendInput(node.target).asString()}, target);\n`;
            break;
        case BLOCKS.CONTROL.DELETE_CLONE:
            this.source += 'if (!target.isOriginal) {\n';
            this.source += '  runtime.disposeTarget(target);\n';
            this.source += '  runtime.stopForTarget(target);\n';
            this.retire();
            this.source += '}\n';
            break;
        case BLOCKS.CONTROL.FOR: {
            const index = this.localVariables.next();
            this.source += `var ${index} = 0; `;
            this.source += `while (${index} < ${this.descendInput(node.count).asNumber()}) { `;
            this.source += `${index}++; `;
            this.source += `${this.referenceVariable(node.variable)}.value = ${index};\n`;
            this.setVariableType(node.variable.name, TYPES.NUMBER);
            this.descendStack(node.do, new Frame(true));
            this.yieldLoop();
            this.source += '}\n';
            break;
        }
        case BLOCKS.CONTROL.IF:
            this.source += `if (${this.descendInput(node.condition).asBoolean()}) {\n`;
            this.descendStack(node.whenTrue, new Frame(false));
            // only add the else branch if it won't be empty
            // this makes scripts have a bit less useless noise in them
            if (node.whenFalse.length) {
                this.resetVariableInputs();
                this.source += `} else {\n`;
                this.descendStack(node.whenFalse, new Frame(false));
            }
            this.source += `}\n`;
            break;
        case BLOCKS.CONTROL.REPEAT: {
            const i = this.localVariables.next();
            this.source += `for (var ${i} = ${this.descendInput(node.times).asNumber()}; ${i} >= 0.5; ${i}--) {\n`;
            this.descendStack(node.do, new Frame(true));
            this.yieldLoop();
            this.source += `}\n`;
            break;
        }
        case BLOCKS.CONTROL.STOP_ALL:
            this.source += 'runtime.stopAll();\n';
            this.retire();
            break;
        case BLOCKS.CONTROL.STOP_OTHERS:
            this.source += 'runtime.stopForTarget(target, thread);\n';
            break;
        case BLOCKS.CONTROL.STOP_SCRIPT:
            this.stopScript();
            break;
        case BLOCKS.CONTROL.WAIT: {
            const duration = this.localVariables.next();
            this.usedMathFunctions.add('max');
            this.source += `thread.timer = timer();\n`;
            this.source += `var ${duration} = max(0, 1000 * ${this.descendInput(node.seconds).asNumber()});\n`;
            this.requestRedraw();
            // always yield at least once, even on 0 second durations
            this.yieldNotWarp();
            this.source += `while (thread.timer.timeElapsed() < ${duration}) {\n`;
            this.yieldStuckOrNotWarp();
            this.source += '}\n';
            this.source += 'thread.timer = null;\n';
            break;
        }
        case BLOCKS.CONTROL.WAIT_UNTIL: {
            this.resetVariableInputs();
            this.source += `while (!${this.descendInput(node.condition).asBoolean()}) {\n`;
            this.yieldStuckOrNotWarp();
            this.source += `}\n`;
            break;
        }
        case BLOCKS.CONTROL.WHILE:
            this.resetVariableInputs();
            this.source += `while (${this.descendInput(node.condition).asBoolean()}) {\n`;
            this.descendStack(node.do, new Frame(true));
            if (node.warpTimer) {
                this.yieldStuckOrNotWarp();
            } else {
                this.yieldLoop();
            }
            this.source += `}\n`;
            break;

        case BLOCKS.COUNTER.CLEAR:
            this.source += 'runtime.ext_scratch3_control._counter = 0;\n';
            break;
        case BLOCKS.COUNTER.INCR:
            this.source += 'runtime.ext_scratch3_control._counter++;\n';
            break;

        case BLOCKS.HAT.EDGE:
            this.isInHat = true;
            this.source += '{\n';
            // For exact Scratch parity, evaluate the input before checking old edge state.
            // Can matter if the input is not instantly evaluated.
            this.source += `const resolvedValue = ${this.descendInput(node.condition).asBoolean()};\n`;
            this.source += `const id = "${sanitize(node.id)}";\n`;
            this.source += 'const hasOldEdgeValue = target.hasEdgeActivatedValue(id);\n';
            this.source += `const oldEdgeValue = target.updateEdgeActivatedValue(id, resolvedValue);\n`;
            this.source += `const edgeWasActivated = hasOldEdgeValue ? (!oldEdgeValue && resolvedValue) : resolvedValue;\n`;
            this.source += `if (!edgeWasActivated) {\n`;
            this.retire();
            this.source += '}\n';
            this.source += 'yield;\n';
            this.source += '}\n';
            this.isInHat = false;
            break;
        case BLOCKS.HAT.PREDICATE:
            this.isInHat = true;
            this.source += `if (!${this.descendInput(node.condition).asBoolean()}) {\n`;
            this.retire();
            this.source += '}\n';
            this.source += 'yield;\n';
            this.isInHat = false;
            break;

        case BLOCKS.EVENT.BROADCAST:
            this.source += `startHats("event_whenbroadcastreceived", { BROADCAST_OPTION: ${this.descendInput(node.broadcast).asString()} });\n`;
            this.resetVariableInputs();
            this.clearVariableTypes();
            break;
        case BLOCKS.EVENT.BROADCAST_AND_WAIT:
            this.source += `yield* waitThreads(startHats("event_whenbroadcastreceived", { BROADCAST_OPTION: ${this.descendInput(node.broadcast).asString()} }));\n`;
            this.yielded();
            break;

        case BLOCKS.LIST.ADD: {
            const list = this.referenceVariable(node.list);
            this.source += `${list}.value.push(${this.descendInput(node.item).asSafe()});\n`;
            this.source += `${list}._monitorUpToDate = false;\n`;
            break;
        }
        case BLOCKS.LIST.DELETE: {
            const list = this.referenceVariable(node.list);
            const index = this.descendInput(node.index);
            if (index.isConstant('last')) {
                this.source += `${list}.value.pop();\n`;
                this.source += `${list}._monitorUpToDate = false;\n`;
                break;
            }
            if (index.isConstant(1)) {
                this.source += `${list}.value.shift();\n`;
                this.source += `${list}._monitorUpToDate = false;\n`;
                break;
            }
            // do not need a special case for all as that is handled in IR generation (list.deleteAll)
            this.source += `listDelete(${list}, ${index.asUnknown()});\n`;
            break;
        }
        case BLOCKS.LIST.DELETE_ALL:
            this.source += `${this.referenceVariable(node.list)}.value = [];\n`;
            break;
        case BLOCKS.LIST.HIDE:
            this.source += `runtime.monitorBlocks.changeBlock({ id: "${sanitize(node.list.id)}", element: "checkbox", value: false }, runtime);\n`;
            break;
        case BLOCKS.LIST.INSERT: {
            const list = this.referenceVariable(node.list);
            const index = this.descendInput(node.index);
            const item = this.descendInput(node.item);
            if (index.isConstant(1)) {
                this.source += `${list}.value.unshift(${item.asSafe()});\n`;
                this.source += `${list}._monitorUpToDate = false;\n`;
                break;
            }
            if (index.isConstant('last')) {
                this.source += `${list}.value.push(${item.asSafe()});\n`;
                this.source += `${list}._monitorUpToDate = false;\n`;
                break;
            }
            this.source += `listInsert(${list}, ${index.asUnknown()}, ${item.asSafe()});\n`;
            break;
        }
        case BLOCKS.LIST.REPLACE: {
            const listRef = this.referenceVariable(node.list);
            const idxInput = this.descendInput(node.index);
            this.source += `listReplace(${listRef}, ${idxInput.asUnknown()}, ${this.descendInput(node.item).asSafe()});\n`;
            break;
        }
        case BLOCKS.LIST.SHOW:
            this.source += `runtime.monitorBlocks.changeBlock({ id: "${sanitize(node.list.id)}", element: "checkbox", value: true }, runtime);\n`;
            break;
        
        case BLOCKS.LIST.SET_ARRAY:
            this.source += `try { ${this.referenceVariable(node.list)}.value = JSON.parse(${this.descendInput(node.array).asString()}) }catch{};\n`;
            break;

        case BLOCKS.LOOKS.BACKWARD_LAYERS:
            if (!this.target.isStage) {
                this.source += `target.goBackwardLayers(${this.descendInput(node.layers).asNumber()});\n`;
            }
            break;
        case BLOCKS.LOOKS.CLEAR_EFFECTS:
            this.source += 'target.clearEffects();\n';
            break;
        case BLOCKS.LOOKS.CHANGE_EFFECT:
            if (Object.prototype.hasOwnProperty.call(this.target.effects, node.effect)) {
                this.source += `target.setEffect("${sanitize(node.effect)}", runtime.ext_scratch3_looks.clampEffect("${sanitize(node.effect)}", ${this.descendInput(node.value).asNumber()} + target.effects["${sanitize(node.effect)}"]));\n`;
            }
            break;
        case BLOCKS.LOOKS.CHANGE_SIZE:
            this.source += `target.setSize(target.size + ${this.descendInput(node.size).asNumber()});\n`;
            break;
        case BLOCKS.LOOKS.FORWARD_LAYERS:
            if (!this.target.isStage) {
                this.source += `target.goForwardLayers(${this.descendInput(node.layers).asNumber()});\n`;
            }
            break;
        case BLOCKS.LOOKS.GOTO_BACK:
            if (!this.target.isStage) {
                this.source += 'target.goToBack();\n';
            }
            break;
        case BLOCKS.LOOKS.GOTO_FRONT:
            if (!this.target.isStage) {
                this.source += 'target.goToFront();\n';
            }
            break;
        case BLOCKS.LOOKS.HIDE:
            this.source += 'target.setVisible(false);\n';
            this.source += 'runtime.ext_scratch3_looks._renderBubble(target);\n';
            break;
        case BLOCKS.LOOKS.NEXT_BACKDROP:
            this.source += 'runtime.ext_scratch3_looks._setBackdrop(stage, stage.currentCostume + 1, true);\n';
            break;
        case BLOCKS.LOOKS.NEXT_COSTUME:
            this.source += 'target.setCostume(target.currentCostume + 1);\n';
            break;
        case BLOCKS.LOOKS.SET_EFFECT:
            if (Object.prototype.hasOwnProperty.call(this.target.effects, node.effect)) {
                this.source += `target.setEffect("${sanitize(node.effect)}", runtime.ext_scratch3_looks.clampEffect("${sanitize(node.effect)}", ${this.descendInput(node.value).asNumber()}));\n`;
            }
            break;
        case BLOCKS.LOOKS.SET_SIZE:
            this.source += `target.setSize(${this.descendInput(node.size).asNumber()});\n`;
            break;
        case BLOCKS.LOOKS.SHOW:
            this.source += 'target.setVisible(true);\n';
            this.source += 'runtime.ext_scratch3_looks._renderBubble(target);\n';
            break;
        case BLOCKS.LOOKS.SWITCH_BACKDROP:
            this.source += `runtime.ext_scratch3_looks._setBackdrop(stage, ${this.descendInput(node.backdrop).asSafe()});\n`;
            break;
        case BLOCKS.LOOKS.SWITCH_COSTUME:
            this.source += `runtime.ext_scratch3_looks._setCostume(target, ${this.descendInput(node.costume).asSafe()});\n`;
            break;
        case BLOCKS.LOOKS.SAY:
            this.source += `runtime.ext_scratch3_looks._say(${this.descendInput(node.message).asSafe()}, target);\n`;
            break;
        case BLOCKS.LOOKS.THINK:
            this.source += `runtime.ext_scratch3_looks._think(${this.descendInput(node.message).asSafe()}, target);\n`;
            break;

        case BLOCKS.MOTION.CHANGE_X:
            this.source += `target.setXY(target.x + ${this.descendInput(node.dx).asNumber()}, target.y);\n`;
            break;
        case BLOCKS.MOTION.CHANGE_Y:
            this.source += `target.setXY(target.x, target.y + ${this.descendInput(node.dy).asNumber()});\n`;
            break;
        case BLOCKS.MOTION.IF_ON_EDGE_BOUNCE:
            this.source += `runtime.ext_scratch3_motion._ifOnEdgeBounce(target);\n`;
            break;
        case BLOCKS.MOTION.SET_DIRECTION:
            this.source += `target.setDirection(${this.descendInput(node.direction).asNumber()});\n`;
            break;
        case BLOCKS.MOTION.POINT_TOWARDS_XY:
            this.usedMathFunctions.add('atan');
            this.usedMathFunctions.add('PI');
            this.source += `target.setDirection(180 + ((atan((${this.descendInput(node.x).asNumber()} - target.x) / (${this.descendInput(node.y).asNumber()} - target.y)) * 180 / PI) + (${this.descendInput(node.y).asNumber()} > target.y ? 180 : 0)));\n`;
            break;
        case BLOCKS.MOTION.POINT_TOWARDS_XY_FROM:
            this.usedMathFunctions.add('atan');
            this.usedMathFunctions.add('PI');
            this.source += `target.setDirection(180 + ((atan((${this.descendInput(node.x).asNumber()} - ${this.descendInput(node.fromx).asNumber()}) / (${this.descendInput(node.y).asNumber()} - ${this.descendInput(node.fromy).asNumber()})) * 180 / PI) + (${this.descendInput(node.y).asNumber()} > ${this.descendInput(node.fromy).asNumber()} ? 180 : 0)));\n`;
            break;
        case BLOCKS.MOTION.SET_ROTATION_STYLE:
            this.source += `target.setRotationStyle("${sanitize(node.style)}");\n`;
            break;
        case BLOCKS.MOTION.SET_X: // fallthrough
        case BLOCKS.MOTION.SET_Y: // fallthrough
        case BLOCKS.MOTION.SET_XY: {
            this.descendedIntoModulo = false;
            const x = 'x' in node ? this.descendInput(node.x).asNumber() : 'target.x';
            const y = 'y' in node ? this.descendInput(node.y).asNumber() : 'target.y';
            this.source += `target.setXY(${x}, ${y});\n`;
            if (this.descendedIntoModulo) {
                this.source += `if (target.interpolationData) target.interpolationData = null;\n`;
            }
            break;
        }
        case BLOCKS.MOTION.STEP:
            this.source += `runtime.ext_scratch3_motion._moveSteps(${this.descendInput(node.steps).asNumber()}, target);\n`;
            break;

        case BLOCKS.NOOP:
            break;

        case BLOCKS.PEN.CLEAR:
            this.source += `${PEN_EXT}.clear();\n`;
            break;
        case BLOCKS.PEN.DOWN:
            this.source += `${PEN_EXT}._penDown(target);\n`;
            break;
        case BLOCKS.PEN.CHANGE_PARAM:
            this.source += `${PEN_EXT}._setOrChangeColorParam(${this.descendInput(node.param).asString()}, ${this.descendInput(node.value).asNumber()}, ${PEN_STATE}, true);\n`;
            break;
        case BLOCKS.PEN.CHANGE_SIZE:
            this.source += `${PEN_EXT}._changePenSizeBy(${this.descendInput(node.size).asNumber()}, target);\n`;
            break;
        case BLOCKS.PEN.LEGACY_CHANGE_HUE:
            this.source += `${PEN_EXT}._changePenHueBy(${this.descendInput(node.hue).asNumber()}, target);\n`;
            break;
        case BLOCKS.PEN.LEGACY_CHANGE_SHADE:
            this.source += `${PEN_EXT}._changePenShadeBy(${this.descendInput(node.shade).asNumber()}, target);\n`;
            break;
        case BLOCKS.PEN.LEGACY_SET_HUE:
            this.source += `${PEN_EXT}._setPenHueToNumber(${this.descendInput(node.hue).asNumber()}, target);\n`;
            break;
        case BLOCKS.PEN.LEGACY_SET_SHADE:
            this.source += `${PEN_EXT}._setPenShadeToNumber(${this.descendInput(node.shade).asNumber()}, target);\n`;
            break;
        case BLOCKS.PEN.SET_COLOR:
            this.source += `${PEN_EXT}._setPenColorToColor(${this.descendInput(node.color).asColor()}, target);\n`;
            break;
        case BLOCKS.PEN.SET_PARAM:
            this.source += `${PEN_EXT}._setOrChangeColorParam(${this.descendInput(node.param).asString()}, ${this.descendInput(node.value).asNumber()}, ${PEN_STATE}, false);\n`;
            break;
        case BLOCKS.PEN.SET_SIZE:
            this.source += `${PEN_EXT}._setPenSizeTo(${this.descendInput(node.size).asNumber()}, target);\n`;
            break;
        case BLOCKS.PEN.STAMP:
            this.source += `${PEN_EXT}._stamp(target);\n`;
            break;
        case BLOCKS.PEN.PRINT_TEXT:
            this.source += `${PEN_EXT}._printText(${this.descendInput(node.text).asSafe()}, ${this.descendInput(node.x).asNumber()}, ${this.descendInput(node.y).asNumber()}, target);\n`;
            break;
        case BLOCKS.PEN.DRAW_TRIANGLE:
            this.source += `${PEN_EXT}._triangle(${this.descendInput(node.x0).asNumber()}, ${this.descendInput(node.y0).asNumber()}, ${this.descendInput(node.x1).asNumber()}, ${this.descendInput(node.y1).asNumber()}, ${this.descendInput(node.x2).asNumber()}, ${this.descendInput(node.y2).asNumber()}, target);\n`;
            break;
        case BLOCKS.PEN.UP:
            this.source += `${PEN_EXT}._penUp(target);\n`;
            break;

        case BLOCKS.PROCEDURES.CALL: {
            const procedureCode = node.code;
            const procedureVariant = node.variant;
            const procedureData = this.ir.procedures[procedureVariant];
            if (procedureData.stack === null) {
                // Procedure has no body; still evaluate arguments for side effects
                break;
            }

            const yieldForRecursion = !this.isWarp && procedureCode === this.script.procedureCode;
            if (yieldForRecursion) {
                this.yieldNotWarp();
            }

            if (procedureData.yields) {
                this.source += 'yield* ';
            }
            this.source += `thread.procedures["${sanitize(procedureVariant)}"](`;
            const args = [];
            for (const input of node.arguments) {
                args.push(this.descendInput(input).asSafe());
            }
            this.source += args.join(',');
            this.source += ');\n';

            this.resetVariableInputs();
            this.clearVariableTypes();
            break;
        }
        case BLOCKS.PROCEDURES.RETURN:
            this.stopScriptAndReturn(this.descendInput(node.value).asSafe());
            break;

        case BLOCKS.TIMER.RESET:
            this.source += 'runtime.ioDevices.clock.resetProjectTimer();\n';
            break;

        case BLOCKS.TW.DEBUGGER:
            this.source += 'debugger;\n';
            break;

        case BLOCKS.VAR.HIDE:
            this.source += `runtime.monitorBlocks.changeBlock({ id: "${sanitize(node.variable.id)}", element: "checkbox", value: false }, runtime);\n`;
            break;
        case BLOCKS.VAR.SET: {
            const variable = this.descendVariable(node.variable);
            const value = this.descendInput(node.value);
            this.variableInputs[node.variable.id] = variable;
            variable.setInput(value);
            // const valueType = variable.type;
            // this.source += `// Set variable ${node.variable.name} (type: ${valueType})\n`;
            this.source += `${variable.source} = ${value.asSafe()};\n`;
            if (node.variable.isCloud) {
                this.source += `runtime.ioDevices.cloud.requestUpdateVariable("${sanitize(node.variable.name)}", ${variable.source});\n`;
            }
            break;
        }
        case BLOCKS.VAR.SHOW:
            this.source += `runtime.monitorBlocks.changeBlock({ id: "${sanitize(node.variable.id)}", element: "checkbox", value: true }, runtime);\n`;
            break;

        case BLOCKS.VISUAL_REPORT: {
            const value = this.localVariables.next();
            this.source += `const ${value} = ${this.descendInput(node.input).asUnknown()};`;
            // blocks like legacy no-ops can return a literal `undefined`
            this.source += `runtime.visualReport("${sanitize(this.script.topBlockId || '')}", ${value});\n`;
            break;
        }

        case BLOCKS.CONTROL.SWITCH: {
            const value = this.descendInput(node.value);
            this.source += `switch (${node.useNumbers ? value.asNumber() : value.asString()}) {\n`;
            this.descendStack(node.do, new Frame(false));
            this.source += `}\n`;
            break;
        }
        case BLOCKS.CONTROL.CASE: {
            const value = this.descendInput(node.value);
            this.source += `case ${node.useNumbers ? value.asNumber() : value.asString()}: {\n`;
            
            this.descendStack(node.do, new Frame(false));
            this.source += 'break; }\n';
            break;
        }
        case BLOCKS.CONTROL.DEFAULT: {
            this.source += `default:\n`;
            
            this.descendStack(node.do, new Frame(false));
            break;
        }
        case BLOCKS.CONTROL.BREAK: {
            this.source += 'break;\n';
            break;
        }
        case BLOCKS.CONTROL.CASE_FALLTHROUGH: {
            this.source += `case ${this.descendInput(node.value).asString()}:\n`;
            // No break statement - allows fallthrough to next case
            break;
        }

        default:
            log.warn(`JS: Unknown stacked block: ${getNameForType(node.kind)} (${node.kind})`, node);
            throw new Error(`JS: Unknown stacked block: ${getNameForType(node.kind)} (${node.kind})`);
        }
    }

    /**
     * Compile a Record of input objects into a safe JS string.
     * @param {Record<string, node>} inputs
     * @returns {string}
     */
    descendInputRecord (inputs) {
        let result = '{';
        for (const name of Object.keys(inputs)) {
            const node = inputs[name];
            result += `"${sanitize(name)}":${this.descendInput(node).asSafe()},`;
        }
        result += '}';
        return result;
    }

    resetVariableInputs () {
        this.variableInputs = Object.create(null);
    }

    /**
     * @param {node[]} nodes
     * @param {Frame} frame
     */
    descendStack (nodes, frame) {
        // Entering a stack -- all bets are off.
        // TODO: allow if/else to inherit values
        this.resetVariableInputs();
        this.pushFrame(frame);

        for (let i = 0; i < nodes.length; i++) {
            frame.isLastBlock = i === nodes.length - 1;
            this.descendStackedBlock(nodes[i]);
        }

        // Leaving a stack -- any assumptions made in the current stack do not apply outside of it
        // TODO: in if/else this might create an extra unused object
        this.resetVariableInputs();
        this.popFrame();
    }

    /**
     * @param {Variable} variable
     * @returns {VariableInput}
     */
    descendVariable (variable) {
        let input;
        if (Object.prototype.hasOwnProperty.call(this.variableInputs, variable.id)) {
            input = this.variableInputs[variable.id];
        } else {
            input = new VariableInput(`${this.referenceVariable(variable)}.value`);
            this.variableInputs[variable.id] = input;
        }
        return input;
    }

    /**
     * @param {Variable} variable
     * @returns {string}
     */
    referenceVariable (variable) {
        if (variable.scope === 'target') {
            return this.evaluateOnce(`target.variables["${sanitize(variable.id)}"]`);
        }
        return this.evaluateOnce(`stage.variables["${sanitize(variable.id)}"]`);
    }

    /**
     * @param {node} node
     * @returns {string}
     */
    descendAddonCall (node) {
        const inputs = this.descendInputRecord(node.arguments);
        const blockFunction = `runtime.getAddonBlock("${sanitize(node.code)}").callback`;
        const blockId = `"${sanitize(node.blockId)}"`;
        return `yield* executeInCompatibilityLayer(${inputs}, ${blockFunction}, ${this.isWarp}, false, ${blockId})`;
    }

    /**
     * @param {string} source
     * @returns {string}
     */
    evaluateOnce (source) {
        if (Object.prototype.hasOwnProperty.call(this._setupVariables, source)) {
            return this._setupVariables[source];
        }
        const variable = this._setupVariablesPool.next();
        this._setupVariables[source] = variable;
        return variable;
    }

    retire () {
        // After running retire() (sets thread status and cleans up some unused data), we need to return to the event loop.
        // When in a procedure, return will only send us back to the previous procedure, so instead we yield back to the sequencer.
        // Outside of a procedure, return will correctly bring us back to the sequencer.
        if (this.isProcedure) {
            this.source += 'retire(); yield;\n';
        } else {
            this.source += 'retire(); return;\n';
        }
    }

    stopScript () {
        if (this.isProcedure) {
            this.source += 'return "";\n';
        } else {
            this.retire();
        }
    }

    /**
     * @param {string} valueJS JS code of value to return.
     */
    stopScriptAndReturn (valueJS) {
        if (this.isProcedure) {
            this.source += `return ${valueJS};\n`;
        } else {
            this.retire();
        }
    }

    yieldLoop () {
        if (this.warpTimer) {
            this.yieldStuckOrNotWarp();
        } else {
            this.yieldNotWarp();
        }
    }

    /**
     * Write JS to yield the current thread if warp mode is disabled.
     */
    yieldNotWarp () {
        if (!this.isWarp) {
            this.source += 'yield;\n';
            this.yielded();
        }
    }

    /**
     * Write JS to yield the current thread if warp mode is disabled or if the script seems to be stuck.
     */
    yieldStuckOrNotWarp () {
        if (this.isWarp) {
            this.source += 'if (isStuck()) yield;\n';
        } else {
            this.source += 'yield;\n';
        }
        this.yielded();
    }

    yielded () {
        if (!this.script.yields) {
            throw new Error('Script yielded but is not marked as yielding.');
        }
        // Control may have been yielded to another script -- all bets are off.
        this.resetVariableInputs();
        this.clearVariableTypes();
    }

    /**
     * Write JS to request a redraw.
     */
    requestRedraw () {
        this.source += 'runtime.requestRedraw();\n';
    }

    /**
     * @param {ConstantValue} value
     * @returns {ConstantInput}
     */
    safeConstantInput (value) {
        const unsafe = typeof value === 'string' && this.namesOfCostumesAndSounds.has(value);
        return new ConstantInput(value, !unsafe);
    }

    /**
     * Generate a call into the compatibility layer.
     * @param {*} node The "compat" kind node to generate from.
     * @param {boolean} setFlags Whether flags should be set describing how this function was processed.
     * @param {string|null} [frameName] Name of the stack frame variable, if any
     * @returns {string} The JS of the call.
     */
    generateCompatibilityLayerCall (node, setFlags, frameName = null) {
        const opcode = node.opcode;

        let result = 'yield* executeInCompatibilityLayer({';

        for (const inputName of Object.keys(node.inputs)) {
            const input = node.inputs[inputName];
            const compiledInput = this.descendInput(input).asSafe();
            result += `"${sanitize(inputName)}":${compiledInput},`;
        }
        for (const fieldName of Object.keys(node.fields)) {
            const field = node.fields[fieldName];
            result += `"${sanitize(fieldName)}":"${sanitize(field)}",`;
        }
        const opcodeFunction = this.evaluateOnce(`runtime.getOpcodeFunction("${sanitize(opcode)}")`);
        result += `}, ${opcodeFunction}, ${this.isWarp}, ${setFlags}, "${sanitize(node.id)}", ${frameName})`;

        return result;
    }

    getScriptFactoryName () {
        return factoryNameVariablePool.next();
    }

    /**
     * @param {boolean} yields
     * @returns {string}
     */
    getScriptName (yields) {
        let name = yields ? generatorNameVariablePool.next() : functionNameVariablePool.next();
        if (this.isProcedure) {
            const simplifiedProcedureCode = this.script.procedureCode
                .replace(/%[\w]/g, '') // remove arguments
                .replace(/[^a-zA-Z0-9]/g, '_') // remove unsafe
                .substring(0, 20); // keep length reasonable
            name += `_${simplifiedProcedureCode}`;
        }
        return name;
    }

    /**
     * Generate the JS to pass into eval() based on the current state of the compiler.
     * @returns {string} JS to pass into eval()
     */
    createScriptFactory () {
        let script = '';

        // Setup the factory
        script += `(function ${this.getScriptFactoryName()}(thread) {\n`;
        script += 'const target = thread.target;\n';
        script += 'const runtime = target.runtime;\n';
        script += 'const stage = runtime.getTargetForStage();\n';

        // Inject cached Math prelude if we recorded usages during compilation.
        if (this.usedMathFunctions && this.usedMathFunctions.size) {
            // Build a set of math keys to emit. Include simple dependencies (PI for DEG/RAD constants).
            const mathKeys = new Set();
            for (const k of this.usedMathFunctions) {
                if (k in MATH_CACHE) mathKeys.add(k);
                if (k === 'DEG_TO_RAD' || k === 'RAD_TO_DEG') mathKeys.add('PI');
            }
            // Ensure deterministic order for stable output (prefer the order in MATH_CACHE)
            const ordered = Object.keys(MATH_CACHE).filter(k => mathKeys.has(k));
            if (ordered.length) {
                for (const key of ordered) {
                    script += `${MATH_CACHE[key]}\n`;
                }
            }
        }

        for (const varValue of Object.keys(this._setupVariables)) {
            const varName = this._setupVariables[varValue];
            script += `const ${varName} = ${varValue};\n`;
        }

        // Generated script
        script += 'return ';
        if (this.script.yields) {
            script += `function* `;
        } else {
            script += `function `;
        }
        script += this.getScriptName(this.script.yields);
        script += ' (';
        if (this.script.arguments.length) {
            const args = [];
            for (let i = 0; i < this.script.arguments.length; i++) {
                args.push(`p${i}`);
            }
            script += args.join(',');
        }
        script += ') {\n';

        script += this.source;

        script += '}; })';

        return script;
    }

    /**
     * Compile this script.
     * @returns {Function} The factory function for the script.
     */
    compile () {
        CURRENT_GENERATOR = this;
        if (this.script.stack) {
            this.descendStack(this.script.stack, new Frame(false));
        }
        this.stopScript();

        const factory = this.createScriptFactory();
        const fn = jsexecute.scopedEval(factory);

        if (this.debug) {
            log.info(`JS: ${this.target.getName()}: compiled ${this.script.procedureCode || 'script'}`, factory);
        }

        if (JSGenerator.testingApparatus) {
            JSGenerator.testingApparatus.report(this, factory);
        }

        CURRENT_GENERATOR = null;
        return fn;
    }

    /**
     * @param {string} name
     * @param {number} type
     */
    setVariableType (name, type) {
        const ctxs = this.typeCtxs;
        for (let i = ctxs.length - 1; i >= 0; i--) {
            const ctx = ctxs[i];
            if (ctx.has(name)) {
                if (ctx.get(name) !== type) {
                    // clear the type if it changed in a higher context
                    ctx.delete(name);
                }
            }
        }
        this.getCurrentTypeCtx().set(name, type);
    }

    /**
     * @param {string} name
     * @returns {number|undefined}
     */
    getVariableType (name) {
        const ctxs = this.typeCtxs;
        for (let i = ctxs.length - 1; i >= 0; i--) {
            const ctx = ctxs[i];
            if (ctx.has(name)) {
                return ctx.get(name);
            }
        }
    }
}

// For extensions.
JSGenerator.unstable_exports = {
    TYPES,
    TYPE_NUMBER: TYPES.NUMBER,
    TYPE_STRING: TYPES.STRING,
    TYPE_BOOLEAN: TYPES.BOOLEAN,
    TYPE_NUMBER_NAN: TYPES.NUMBER_NAN,
    TYPE_UNKNOWN: TYPES.UNKNOWN,
    BLOCKS,
    factoryNameVariablePool,
    functionNameVariablePool,
    generatorNameVariablePool,
    VariablePool,
    PEN_EXT,
    PEN_STATE,
    TypedInput,
    ConstantInput,
    VariableInput,
    Frame,
    sanitize
};

/**
 * @type {{ report: (generator: JSGenerator, factory: string) => void } | null}
 * Test hook used by automated snapshot testing.
 */
JSGenerator.testingApparatus = null;

module.exports = JSGenerator;
