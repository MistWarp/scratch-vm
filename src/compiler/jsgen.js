const log = require('../util/log');
const Cast = require('../util/cast');
const BlockType = require('../extension-support/block-type');
const VariablePool = require('./variable-pool');
const jsexecute = require('./jsexecute');
const environment = require('./environment');
const vm = require('../virtual-machine.js');
// Imported for JSDoc types, not to actually use
// eslint-disable-next-line no-unused-vars
const {IntermediateScript, IntermediateRepresentation} = require('./intermediate');

/**
 * @fileoverview Convert intermediate representations to JavaScript functions.
 */

/* eslint-disable max-len */
/* eslint-disable prefer-template */

const sanitize = string => {
    if (typeof string !== 'string') {
        log.warn(`sanitize got unexpected type: ${typeof string}`);
        string = '' + string;
    }
    return JSON.stringify(string).slice(1, -1);
};

const TYPE_NUMBER = 1;
const TYPE_STRING = 2;
const TYPE_BOOLEAN = 3;
const TYPE_UNKNOWN = 4;
const TYPE_NUMBER_NAN = 5;

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
 * @typedef Input
 * @property {() => string} asNumber
 * @property {() => string} asNumberOrNaN
 * @property {() => string} asString
 * @property {() => string} asBoolean
 * @property {() => string} asColor
 * @property {() => string} asUnknown
 * @property {() => string} asSafe
 * @property {() => boolean} isAlwaysNumber
 * @property {() => boolean} isAlwaysNumberOrNaN
 * @property {() => boolean} isNeverNumber
 */

/**
 * @implements {Input}
 */
class TypedInput {
    constructor (source, type) {
        if (typeof type !== 'number') throw new Error('type is invalid');
        this.source = source;
        this.type = type;
    }

    asNumber () {
        if (this.type === TYPE_NUMBER) return this.source;
        if (this.type === TYPE_NUMBER_NAN) return `(${this.source}||0)`;
        return `(+${this.source}||0)`;
    }

    asNumberOrNaN () {
        if (this.type === TYPE_NUMBER || this.type === TYPE_NUMBER_NAN) return this.source;
        return `+${this.source}`;
    }

    asString () {
        if (this.type === TYPE_STRING) return this.source;
        return `(""+${this.source})`;
    }

    asBoolean () {
        if (this.type === TYPE_BOOLEAN) return this.source;
        return `toBoolean(${this.source})`;
    }

    asColor () {
        return this.asUnknown();
    }

    asUnknown () {
        return this.source;
    }

    asSafe () {
        return this.asUnknown();
    }

    isAlwaysNumber () {
        return this.type === TYPE_NUMBER;
    }

    isAlwaysNumberOrNaN () {
        return this.type === TYPE_NUMBER || this.type === TYPE_NUMBER_NAN;
    }

    isNeverNumber () {
        return false;
    }
}

/**
 * @implements {Input}
 */
class ConstantInput {
    constructor (constantValue, safe) {
        this.constantValue = constantValue;
        this.safe = safe;
    }

    asNumber () {
        const n = +this.constantValue;
        if (n) return n.toString();
        return Object.is(n, -0) ? '-0' : '0';
    }

    asNumberOrNaN () {
        return this.asNumber();
    }

    asString () {
        return `"${sanitize('' + this.constantValue)}"`;
    }

    asBoolean () {
        return Cast.toBoolean(this.constantValue).toString();
    }

    asColor () {
        if (/^#[0-9a-f]{6,8}$/i.test(this.constantValue)) {
            const hex = this.constantValue.substr(1);
            return Number.parseInt(hex, 16).toString();
        }
        return this.asUnknown();
    }

    asUnknown () {
        if (typeof this.constantValue === 'number') return this.constantValue;
        const n = +this.constantValue;
        if (n.toString() === this.constantValue) return this.constantValue;
        return this.asString();
    }

    asSafe () {
        return this.safe ? this.asUnknown() : this.asString();
    }

    isAlwaysNumber () {
        const v = +this.constantValue;
        if (Number.isNaN(v)) return false;
        return v !== 0 || this.constantValue.toString().trim() !== '';
    }

    isAlwaysNumberOrNaN () {
        return this.isAlwaysNumber();
    }

    isNeverNumber () {
        return Number.isNaN(+this.constantValue);
    }
}

/**
 * @implements {Input}
 */
class VariableInput {
    constructor (source) {
        this.source = source;
        this.type = TYPE_UNKNOWN;
        this._value = null;
    }

    setInput (input) {
        if (input instanceof VariableInput) {
            if (input._value) {
                input = input._value;
            } else {
                this.type = TYPE_UNKNOWN;
                this._value = null;
                return;
            }
        }
        this._value = input;
        this.type = input instanceof TypedInput ? input.type : TYPE_UNKNOWN;
    }

    asNumber () {
        if (this.type === TYPE_NUMBER) return this.source;
        if (this.type === TYPE_NUMBER_NAN) return `(${this.source}||0)`;
        return `(+${this.source}||0)`;
    }

    asNumberOrNaN () {
        if (this.type === TYPE_NUMBER || this.type === TYPE_NUMBER_NAN) return this.source;
        return `+${this.source}`;
    }

    asString () {
        if (this.type === TYPE_STRING) return this.source;
        return `(""+${this.source})`;
    }

    asBoolean () {
        if (this.type === TYPE_BOOLEAN) return this.source;
        return `toBoolean(${this.source})`;
    }

    asColor () {
        return this.asUnknown();
    }

    asUnknown () {
        return this.source;
    }

    asSafe () {
        return this.asUnknown();
    }

    isAlwaysNumber () {
        return this._value ? this._value.isAlwaysNumber() : false;
    }

    isAlwaysNumberOrNaN () {
        return this._value ? this._value.isAlwaysNumberOrNaN() : false;
    }

    isNeverNumber () {
        return this._value ? this._value.isNeverNumber() : false;
    }
}

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

const isSafeConstantForEqualsOptimization = input => {
    const n = +input.constantValue;
    if (!n) return false;
    return n.toString() === input.constantValue.toString();
};

/**
 * A frame contains some information about the current substack being compiled.
 */
class Frame {
    constructor (isLoop) {
        this.isLoop = isLoop;
        this.isLastBlock = false;
        this.isBreakable = false;
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
    constructor (script, ir, target) {
        this.script = script;
        this.ir = ir;
        this.target = target;
        this.source = '';
        this.variableInputs = {};
        this.isWarp = script.isWarp;
        this.isProcedure = script.isProcedure;
        this.warpTimer = script.warpTimer;
        this.frames = [];
        this.currentFrame = null;
        this.namesOfCostumesAndSounds = getNamesOfCostumesAndSounds(target.runtime);
        this.localVariables = new VariablePool('a');
        this._setupVariablesPool = new VariablePool('b');
        this._setupVariables = {};
        this.usedMathFunctions = new Set();
        this.descendedIntoModulo = false;
        this.isInHat = false;
        this.debug = this.target.runtime.debug;
        this._cachedProperties = new Map();
        // Cache environment feature flags locally to avoid repeated global lookups.
        this.supportsNullishCoalescing = environment.supportsNullishCoalescing;
    }

    pushFrame (frame) {
        this.frames.push(frame);
        this.currentFrame = frame;
    }

    popFrame () {
        this.frames.pop();
        this.currentFrame = this.frames[this.frames.length - 1];
    }

    isLastBlockInLoop () {
        for (let i = this.frames.length - 1; i >= 0; i--) {
            const frame = this.frames[i];
            if (!frame.isLastBlock) return false;
            if (frame.isLoop) return true;
        }
        return false;
    }

    descendInput (node) {
        switch (node.kind) {
        case 'addons.call':
            return new TypedInput(`(${this.descendAddonCall(node)})`, TYPE_UNKNOWN);

        case 'compat':
            return new TypedInput(`(${this.generateCompatibilityLayerCall(node, false)})`, TYPE_UNKNOWN);

        case 'constant':
            return this.safeConstantInput(node.value);

        case 'counter.get':
            return new TypedInput('runtime.ext_scratch3_control._counter', TYPE_NUMBER);

        case 'keyboard.pressed':
            return new TypedInput(`runtime.ioDevices.keyboard.getKeyIsDown(${this.descendInput(node.key).asSafe()})`, TYPE_BOOLEAN);

        case 'list.contains':
            return new TypedInput(`listContains(${this.referenceVariable(node.list)},${this.descendInput(node.item).asUnknown()})`, TYPE_BOOLEAN);
        case 'list.contents':
            return new TypedInput(`listContents(${this.referenceVariable(node.list)})`, TYPE_STRING);
        case 'list.get': {
            const list = this.referenceVariable(node.list);
            const index = this.descendInput(node.index);
            if (this.supportsNullishCoalescing) {
                if (index instanceof ConstantInput) {
                    if (index.constantValue === 'last') {
                        return new TypedInput(`(${list}.value.at(-1)??"")`, TYPE_UNKNOWN);
                    }
                    const idx = +index.constantValue;
                    if (!isNaN(idx) && idx >= 1) {
                        return new TypedInput(`(${list}.value[${idx - 1}]??"")`, TYPE_UNKNOWN);
                    }
                }
                if (index.isAlwaysNumberOrNaN()) {
                    const idx = index instanceof ConstantInput && !isNaN(index.constantValue) ?
                        index.constantValue - 1 :
                        `${index.asNumber()}-1`;
                    return new TypedInput(`(${list}.value[${idx}]??"")`, TYPE_UNKNOWN);
                }
            }
            return new TypedInput(`listGet(${list}.value,${index.asUnknown()})`, TYPE_UNKNOWN);
        }
        case 'list.indexOf': {
            const list = this.referenceVariable(node.list);
            const idx = this.descendInput(node.item);
            if (idx instanceof ConstantInput) {
                let val = idx.constantValue;
                if (idx.isAlwaysNumberOrNaN()) val = idx.asNumber();
                else if (idx.isNeverNumber()) val = idx.asString();
                else val = idx.asUnknown();
                return new TypedInput(`(${list}.value.indexOf(${val})+1)`, TYPE_NUMBER);
            }
            return new TypedInput(`listIndexOf(${list},${idx.asUnknown()})`, TYPE_NUMBER);
        }
        case 'list.length':
            return new TypedInput(`${this.referenceVariable(node.list)}.value.length`, TYPE_NUMBER);
        case 'list.json':
            return new TypedInput(`JSON.stringify(${this.referenceVariable(node.list)}.value)`, TYPE_STRING);

        case 'looks.size':
            this.usedMathFunctions.add('round');
            return new TypedInput('round(target.size)', TYPE_NUMBER);
        case 'looks.backdropName':
            return new TypedInput('stage.getCostumes()[stage.currentCostume].name', TYPE_STRING);
        case 'looks.backdropNumber':
            return new TypedInput('(stage.currentCostume+1)', TYPE_NUMBER);
        case 'looks.costumeName':
            return new TypedInput('target.getCostumes()[target.currentCostume].name', TYPE_STRING);
        case 'looks.costumeNumber':
            return new TypedInput('(target.currentCostume+1)', TYPE_NUMBER);
        case 'looks.costumes':
            return new TypedInput('JSON.stringify(target.getCostumes().map(c=>c.name))', TYPE_STRING);

        case 'motion.direction':
            return new TypedInput('target.direction', TYPE_NUMBER);
        case 'motion.x':
            return new TypedInput('target.x', TYPE_NUMBER);
        case 'motion.y':
            return new TypedInput('target.y', TYPE_NUMBER);

        case 'mouse.down':
            return new TypedInput('runtime.ioDevices.mouse.getIsDown()', TYPE_BOOLEAN);
        case 'mouse.x':
            return new TypedInput('runtime.ioDevices.mouse.getScratchX()', TYPE_NUMBER);
        case 'mouse.y':
            return new TypedInput('runtime.ioDevices.mouse.getScratchY()', TYPE_NUMBER);

        case 'noop':
            return new TypedInput('""', TYPE_STRING);

        case 'op.abs':
            this.usedMathFunctions.add('abs');
            return new TypedInput(`abs(${this.descendInput(node.value).asNumber()})`, TYPE_NUMBER);
        case 'op.acos':
            this.usedMathFunctions.add('acos');
            this.usedMathFunctions.add('RAD_TO_DEG');
            return new TypedInput(`(acos(${this.descendInput(node.value).asNumber()})*RAD_TO_DEG)`, TYPE_NUMBER_NAN);
        case 'op.add': {
            const left = this.descendInput(node.left);
            const right = this.descendInput(node.right);
            // Constant folding for addition
            if (left instanceof ConstantInput && right instanceof ConstantInput) {
                const result = (+left.constantValue) + (+right.constantValue);
                return new TypedInput(result.toString(), TYPE_NUMBER_NAN);
            }
            if (left instanceof ConstantInput && +left.constantValue === 0) return new TypedInput(right.asNumber(), TYPE_NUMBER_NAN);
            if (right instanceof ConstantInput && +right.constantValue === 0) return new TypedInput(left.asNumber(), TYPE_NUMBER_NAN);
            return new TypedInput(`(${left.asNumber()}+${right.asNumber()})`, TYPE_NUMBER_NAN);
        }
        case 'op.subtract': {
            const left = this.descendInput(node.left);
            const right = this.descendInput(node.right);
            // Constant folding for subtraction
            if (left instanceof ConstantInput && right instanceof ConstantInput) {
                const result = (+left.constantValue) - (+right.constantValue);
                return new TypedInput(result.toString(), TYPE_NUMBER_NAN);
            }
            if (right instanceof ConstantInput && +right.constantValue === 0) return new TypedInput(left.asNumber(), TYPE_NUMBER_NAN);
            return new TypedInput(`(${left.asNumber()}-${right.asNumber()})`, TYPE_NUMBER_NAN);
        }
        case 'op.and':
            return new TypedInput(`(${this.descendInput(node.left).asBoolean()}&&${this.descendInput(node.right).asBoolean()})`, TYPE_BOOLEAN);
        case 'op.asin':
            // Needs to be marked as NaN because Math.asin(1.0001) === NaN
            this.usedMathFunctions.add('asin');
            this.usedMathFunctions.add('RAD_TO_DEG');
            return new TypedInput(`(asin(${this.descendInput(node.value).asNumber()})*RAD_TO_DEG)`, TYPE_NUMBER_NAN);
        case 'op.atan':
            this.usedMathFunctions.add('atan');
            this.usedMathFunctions.add('RAD_TO_DEG');
            return new TypedInput(`(atan(${this.descendInput(node.value).asNumber()})*RAD_TO_DEG)`, TYPE_NUMBER);
        case 'op.ceiling':
            this.usedMathFunctions.add('ceil');
            return new TypedInput(`ceil(${this.descendInput(node.value).asNumber()})`, TYPE_NUMBER);
        case 'op.contains': {
            const string = this.descendInput(node.string);
            const contains = this.descendInput(node.contains);
            // Optimize constant empty string searches
            if (contains instanceof ConstantInput && contains.constantValue === '') {
                return new TypedInput('true', TYPE_BOOLEAN);
            }
            return new TypedInput(`${string.asString()}.toLowerCase().includes(${contains.asString()}.toLowerCase())`, TYPE_BOOLEAN);
        }
        case 'op.cos':
            this.usedMathFunctions.add('cos');
            this.usedMathFunctions.add('round');
            this.usedMathFunctions.add('DEG_TO_RAD');
            return new TypedInput(`(round(cos(${this.descendInput(node.value).asNumber()}*DEG_TO_RAD)*1e10)/1e10)`, TYPE_NUMBER_NAN);
        case 'op.divide': {
            const left = this.descendInput(node.left);
            const right = this.descendInput(node.right);
            // Constant folding for division
            if (left instanceof ConstantInput && right instanceof ConstantInput) {
                const result = (+left.constantValue) / (+right.constantValue);
                return new TypedInput(result.toString(), TYPE_NUMBER_NAN);
            }
            // Optimize dividing by 1
            if (right instanceof ConstantInput && +right.constantValue === 1) {
                return new TypedInput(left.asNumber(), TYPE_NUMBER_NAN);
            }
            return new TypedInput(`(${left.asNumber()}/${right.asNumber()})`, TYPE_NUMBER_NAN);
        }
        case 'op.equals': {
            const left = this.descendInput(node.left);
            const right = this.descendInput(node.right);
            if (left.isNeverNumber() || right.isNeverNumber()) {
                const ls = left.safe ? left.asString().toLowerCase() : `${left.asString()}.toLowerCase()`;
                const rs = right.safe ? right.asString().toLowerCase() : `${right.asString()}.toLowerCase()`;
                return new TypedInput(`(${ls}===${rs})`, TYPE_BOOLEAN);
            }
            const leftAlwaysNumber = left.isAlwaysNumber();
            const rightAlwaysNumber = right.isAlwaysNumber();
            if (leftAlwaysNumber && rightAlwaysNumber) {
                return new TypedInput(`(${left.asNumber()}===${right.asNumber()})`, TYPE_BOOLEAN);
            }
            if ((leftAlwaysNumber && left instanceof ConstantInput && isSafeConstantForEqualsOptimization(left)) ||
                (rightAlwaysNumber && right instanceof ConstantInput && isSafeConstantForEqualsOptimization(right))) {
                return new TypedInput(`(${left.asNumber()}===${right.asNumber()})`, TYPE_BOOLEAN);
            }
            return new TypedInput(`compareEqual(${left.asUnknown()},${right.asUnknown()})`, TYPE_BOOLEAN);
        }
        case 'op.e^':
            this.usedMathFunctions.add('exp');
            return new TypedInput(`exp(${this.descendInput(node.value).asNumber()})`, TYPE_NUMBER);
        case 'op.floor':
            this.usedMathFunctions.add('floor');
            return new TypedInput(`floor(${this.descendInput(node.value).asNumber()})`, TYPE_NUMBER);
        case 'op.greater': {
            const left = this.descendInput(node.left);
            const right = this.descendInput(node.right);
            if (left.isAlwaysNumber() && right.isAlwaysNumberOrNaN()) {
                return new TypedInput(`(${left.asNumber()}>${right.asNumberOrNaN()})`, TYPE_BOOLEAN);
            }
            if (left.isAlwaysNumberOrNaN() && right.isAlwaysNumber()) {
                return new TypedInput(`!(${left.asNumberOrNaN()}<=${right.asNumber()})`, TYPE_BOOLEAN);
            }
            if (left.isNeverNumber() || right.isNeverNumber()) {
                return new TypedInput(`(${left.asString()}.toLowerCase()>${right.asString()}.toLowerCase())`, TYPE_BOOLEAN);
            }
            return new TypedInput(`compareGreaterThan(${left.asUnknown()},${right.asUnknown()})`, TYPE_BOOLEAN);
        }
        case 'op.join': {
            const left = this.descendInput(node.left);
            const right = this.descendInput(node.right);
            // Constant folding for string concatenation
            if (left instanceof ConstantInput && right instanceof ConstantInput) {
                const result = String(left.constantValue) + String(right.constantValue);
                return new ConstantInput(result, true);
            }
            // Optimize concatenating empty strings
            if (left instanceof ConstantInput && left.constantValue === '') {
                return new TypedInput(right.asString(), TYPE_STRING);
            }
            if (right instanceof ConstantInput && right.constantValue === '') {
                return new TypedInput(left.asString(), TYPE_STRING);
            }
            return new TypedInput(`(${left.asString()}+${right.asString()})`, TYPE_STRING);
        }
        case 'op.length':
            return new TypedInput(`${this.descendInput(node.string).asString()}.length`, TYPE_NUMBER);
        case 'op.less': {
            const left = this.descendInput(node.left);
            const right = this.descendInput(node.right);
            if (left.isAlwaysNumberOrNaN() && right.isAlwaysNumber()) {
                return new TypedInput(`(${left.asNumberOrNaN()}<${right.asNumber()})`, TYPE_BOOLEAN);
            }
            if (left.isAlwaysNumber() && right.isAlwaysNumberOrNaN()) {
                return new TypedInput(`!(${left.asNumber()}>=${right.asNumberOrNaN()})`, TYPE_BOOLEAN);
            }
            if (left.isNeverNumber() || right.isNeverNumber()) {
                return new TypedInput(`(${left.asString()}.toLowerCase()<${right.asString()}.toLowerCase())`, TYPE_BOOLEAN);
            }
            return new TypedInput(`compareLessThan(${left.asUnknown()},${right.asUnknown()})`, TYPE_BOOLEAN);
        }
        case 'op.letterOf': {
            const string = this.descendInput(node.string);
            const letter = this.descendInput(node.letter);
            // Use direct array access for constant indices
            if (letter instanceof ConstantInput) {
                const idx = +letter.constantValue;
                if (!isNaN(idx) && idx >= 1) {
                    return new TypedInput(`(${string.asString()}[${idx - 1}]||"")`, TYPE_STRING);
                }
                if (letter.constantValue === 'last') {
                    return new TypedInput(`(${string.asString()}.slice(-1)||"")`, TYPE_STRING);
                }
            }
            const idx = letter.asNumber();
            return new TypedInput(`(${string.asString()}[${idx}-1]||"")`, TYPE_STRING);
        }
        case 'op.ln':
            this.usedMathFunctions.add('log');
            return new TypedInput(`log(${this.descendInput(node.value).asNumber()})`, TYPE_NUMBER_NAN);
        case 'op.log':
            // Needs to be marked as NaN because Math.log(-1) == NaN
            this.usedMathFunctions.add('log');
            this.usedMathFunctions.add('LN10');
            return new TypedInput(`(log(${this.descendInput(node.value).asNumber()})/LN10)`, TYPE_NUMBER_NAN);
        case 'op.mod':
            this.descendedIntoModulo = true;
            // Needs to be marked as NaN because mod(0, 0) (and others) == NaN
            return new TypedInput(`mod(${this.descendInput(node.left).asNumber()}, ${this.descendInput(node.right).asNumber()})`, TYPE_NUMBER_NAN);
        case 'op.pi':
            this.usedMathFunctions.add('PI');
            return new TypedInput('PI', TYPE_NUMBER);
        case 'op.newline':
            return new TypedInput('"\n"', TYPE_STRING);
        case 'op.multiply': {
            const left = this.descendInput(node.left);
            const right = this.descendInput(node.right);
            // Constant folding for multiplication
            if (left instanceof ConstantInput && right instanceof ConstantInput) {
                const result = (+left.constantValue) * (+right.constantValue);
                return new TypedInput(result.toString(), TYPE_NUMBER_NAN);
            }
            // Optimize multiplying by 1
            if (left instanceof ConstantInput && +left.constantValue === 1) {
                return new TypedInput(right.asNumber(), TYPE_NUMBER_NAN);
            }
            if (right instanceof ConstantInput && +right.constantValue === 1) {
                return new TypedInput(left.asNumber(), TYPE_NUMBER_NAN);
            }
            // Optimize multiplying by 0
            if ((left instanceof ConstantInput && +left.constantValue === 0) ||
                (right instanceof ConstantInput && +right.constantValue === 0)) {
                return new TypedInput('0', TYPE_NUMBER);
            }
            return new TypedInput(`(${left.asNumber()}*${right.asNumber()})`, TYPE_NUMBER_NAN);
        }
        case 'op.not':
            return new TypedInput(`!${this.descendInput(node.operand).asBoolean()}`, TYPE_BOOLEAN);
        case 'op.or':
            return new TypedInput(`(${this.descendInput(node.left).asBoolean()} || ${this.descendInput(node.right).asBoolean()})`, TYPE_BOOLEAN);
        case 'op.random':
            if (node.useInts) {
                // Both inputs are ints, so we know neither are NaN
                return new TypedInput(`randomInt(${this.descendInput(node.low).asNumber()}, ${this.descendInput(node.high).asNumber()})`, TYPE_NUMBER);
            }
            if (node.useFloats) {
                return new TypedInput(`randomFloat(${this.descendInput(node.low).asNumber()}, ${this.descendInput(node.high).asNumber()})`, TYPE_NUMBER_NAN);
            }
            return new TypedInput(`runtime.ext_scratch3_operators._random(${this.descendInput(node.low).asUnknown()}, ${this.descendInput(node.high).asUnknown()})`, TYPE_NUMBER_NAN);
        case 'op.round':
            this.usedMathFunctions.add('round');
            return new TypedInput(`round(${this.descendInput(node.value).asNumber()})`, TYPE_NUMBER);
        case 'op.sin':
            this.usedMathFunctions.add('sin');
            this.usedMathFunctions.add('round');
            this.usedMathFunctions.add('DEG_TO_RAD');
            return new TypedInput(`(round(sin(${this.descendInput(node.value).asNumber()}*DEG_TO_RAD)*1e10)/1e10)`, TYPE_NUMBER_NAN);
        case 'op.sqrt':
            this.usedMathFunctions.add('sqrt');
            // Needs to be marked as NaN because Math.sqrt(-1) === NaN
            return new TypedInput(`sqrt(${this.descendInput(node.value).asNumber()})`, TYPE_NUMBER_NAN);
        case 'op.tan':
            this.usedMathFunctions.add('tan');
            return new TypedInput(`tan(${this.descendInput(node.value).asNumber()})`, TYPE_NUMBER_NAN);
        case 'op.10^':
            return new TypedInput(`(10 ** ${this.descendInput(node.value).asNumber()})`, TYPE_NUMBER);

        case 'procedures.call': {
            const procedureCode = node.code;
            const procedureVariant = node.variant;
            const procedureData = this.ir.procedures[procedureVariant];
            if (procedureData.stack === null) {
                // TODO still need to evaluate arguments for side effects
                return new TypedInput('""', TYPE_STRING);
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
                return new TypedInput(`(yield* ${runtimeFunction}(${procedureReference}, ${joinedArgs}))`, TYPE_UNKNOWN);
            }
            if (procedureData.yields) {
                return new TypedInput(`(yield* ${procedureReference}(${joinedArgs}))`, TYPE_UNKNOWN);
            }
            return new TypedInput(`${procedureReference}(${joinedArgs})`, TYPE_UNKNOWN);
        }
        case 'procedures.argument':
            return new TypedInput(`p${node.index}`, TYPE_UNKNOWN);

        case 'sensing.answer':
            return new TypedInput(`runtime.ext_scratch3_sensing._answer`, TYPE_STRING);
        case 'sensing.colorTouchingColor':
            return new TypedInput(`target.colorIsTouchingColor(colorToList(${this.descendInput(node.target).asColor()}), colorToList(${this.descendInput(node.mask).asColor()}))`, TYPE_BOOLEAN);
        case 'sensing.date':
            return new TypedInput(`(new Date().getDate())`, TYPE_NUMBER);
        case 'sensing.dayofweek':
            return new TypedInput(`(new Date().getDay() + 1)`, TYPE_NUMBER);
        case 'sensing.daysSince2000':
            return new TypedInput('daysSince2000()', TYPE_NUMBER);
        case 'sensing.distance':
            // TODO: on stages, this can be computed at compile time
            return new TypedInput(`distance(${this.descendInput(node.target).asString()})`, TYPE_NUMBER);
        case 'sensing.hour':
            return new TypedInput(`(new Date().getHours())`, TYPE_NUMBER);
        case 'sensing.minute':
            return new TypedInput(`(new Date().getMinutes())`, TYPE_NUMBER);
        case 'sensing.month':
            return new TypedInput(`(new Date().getMonth() + 1)`, TYPE_NUMBER);
        case 'sensing.of': {
            const object = this.descendInput(node.object).asString();
            const property = node.property;
            if (node.object.kind === 'constant') {
                const isStage = node.object.value === '_stage_';
                // Note that if target isn't a stage, we can't assume it exists
                const objectReference = isStage ? 'stage' : this.evaluateOnce(`runtime.getSpriteTargetByName(${object})`);
                if (property === 'volume') {
                    return new TypedInput(`(${objectReference} ? ${objectReference}.volume : 0)`, TYPE_NUMBER);
                }
                if (isStage) {
                    switch (property) {
                    case 'background #':
                        // fallthrough for scratch 1.0 compatibility
                    case 'backdrop #':
                        return new TypedInput(`(${objectReference}.currentCostume + 1)`, TYPE_NUMBER);
                    case 'backdrop name':
                        return new TypedInput(`${objectReference}.getCostumes()[${objectReference}.currentCostume].name`, TYPE_STRING);
                    }
                } else {
                    switch (property) {
                    case 'x position':
                        return new TypedInput(`(${objectReference} ? ${objectReference}.x : 0)`, TYPE_NUMBER);
                    case 'y position':
                        return new TypedInput(`(${objectReference} ? ${objectReference}.y : 0)`, TYPE_NUMBER);
                    case 'direction':
                        return new TypedInput(`(${objectReference} ? ${objectReference}.direction : 0)`, TYPE_NUMBER);
                    case 'costume #':
                        return new TypedInput(`(${objectReference} ? ${objectReference}.currentCostume + 1 : 0)`, TYPE_NUMBER);
                    case 'costume name':
                        return new TypedInput(`(${objectReference} ? ${objectReference}.getCostumes()[${objectReference}.currentCostume].name : 0)`, TYPE_UNKNOWN);
                    case 'size':
                        return new TypedInput(`(${objectReference} ? ${objectReference}.size : 0)`, TYPE_NUMBER);
                    }
                }
                const variableReference = this.evaluateOnce(`${objectReference} && ${objectReference}.lookupVariableByNameAndType("${sanitize(property)}", "", true)`);
                return new TypedInput(`(${variableReference} ? ${variableReference}.value : 0)`, TYPE_UNKNOWN);
            }
            return new TypedInput(`runtime.ext_scratch3_sensing.getAttributeOf({OBJECT: ${object}, PROPERTY: "${sanitize(property)}" })`, TYPE_UNKNOWN);
        }
        case 'sensing.second':
            return new TypedInput(`(new Date().getSeconds())`, TYPE_NUMBER);
        case 'sensing.refreshTime':
            return new TypedInput('(runtime.screenRefreshTime / 1000)', TYPE_NUMBER);
        case 'sensing.touching':
            return new TypedInput(`target.isTouchingObject(${this.descendInput(node.object).asUnknown()})`, TYPE_BOOLEAN);
        case 'sensing.touchingColor':
            return new TypedInput(`target.isTouchingColor(colorToList(${this.descendInput(node.color).asColor()}))`, TYPE_BOOLEAN);
        case 'sensing.username':
            return new TypedInput('runtime.ioDevices.userData.getUsername()', TYPE_STRING);
        case 'sensing.year':
            return new TypedInput(`(new Date().getFullYear())`, TYPE_NUMBER);

        case 'timer.get':
            return new TypedInput('runtime.ioDevices.clock.projectTimer()', TYPE_NUMBER);

        case 'tw.lastKeyPressed':
            return new TypedInput('runtime.ioDevices.keyboard.getLastKeyPressed()', TYPE_STRING);

        case 'var.get':
            return this.descendVariable(node.variable);

        default:
            log.warn(`JS: Unknown input: ${node.kind}`, node);
            throw new Error(`JS: Unknown input: ${node.kind}`);
        }
    }

    /**
     * @param {*} node Stacked node to compile.
     */
    descendStackedBlock (node) {
        switch (node.kind) {
        case 'addons.call':
            this.source += `${this.descendAddonCall(node)};\n`;
            break;

        case 'compat': {
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

        case 'control.createClone':
            this.source += `runtime.ext_scratch3_control._createClone(${this.descendInput(node.target).asString()}, target);\n`;
            break;
        case 'control.deleteClone':
            this.source += 'if (!target.isOriginal) {\n';
            this.source += '  runtime.disposeTarget(target);\n';
            this.source += '  runtime.stopForTarget(target);\n';
            this.retire();
            this.source += '}\n';
            break;
        case 'control.for': {
            this.resetVariableInputs();
            const index = this.localVariables.next();
            this.source += `var ${index} = 0; `;
            this.source += `while (${index} < ${this.descendInput(node.count).asNumber()}) { `;
            this.source += `${index}++; `;
            this.source += `${this.referenceVariable(node.variable)}.value = ${index};\n`;
            this.descendStack(node.do, new Frame(true));
            this.yieldLoop();
            this.source += '}\n';
            break;
        }
        case 'control.if': {
            const condition = this.descendInput(node.condition);
            // Optimize constant conditions
            if (condition instanceof ConstantInput) {
                if (Cast.toBoolean(condition.constantValue)) {
                    this.descendStack(node.whenTrue, new Frame(false));
                } else if (node.whenFalse.length) {
                    this.descendStack(node.whenFalse, new Frame(false));
                }
                break;
            }
            this.source += `if (${condition.asBoolean()}) {\n`;
            this.descendStack(node.whenTrue, new Frame(false));
            if (node.whenFalse.length) {
                this.source += `} else {\n`;
                this.descendStack(node.whenFalse, new Frame(false));
            }
            this.source += `}\n`;
            break;
        }
        case 'control.repeat': {
            const times = this.descendInput(node.times);
            // Optimize constant zero repeats
            if (times instanceof ConstantInput && +times.constantValue <= 0) {
                // Skip the entire loop
                break;
            }
            // Optimize constant one repeat by unrolling
            if (times instanceof ConstantInput && +times.constantValue === 1) {
                this.descendStack(node.do, new Frame(false));
                break;
            }
            const i = this.localVariables.next();
            this.source += `for (var ${i} = ${times.asNumber()}; ${i} >= 0.5; ${i}--) {\n`;
            this.descendStack(node.do, new Frame(true));
            this.yieldLoop();
            this.source += `}\n`;
            break;
        }
        case 'control.stopAll':
            this.source += 'runtime.stopAll();\n';
            this.retire();
            break;
        case 'control.stopOthers':
            this.source += 'runtime.stopForTarget(target, thread);\n';
            break;
        case 'control.stopScript':
            this.stopScript();
            break;
        case 'control.wait': {
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
        case 'control.waitUntil': {
            this.resetVariableInputs();
            this.source += `while (!${this.descendInput(node.condition).asBoolean()}) {\n`;
            this.yieldStuckOrNotWarp();
            this.source += `}\n`;
            break;
        }
        case 'control.while':
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

        case 'counter.clear':
            this.source += 'runtime.ext_scratch3_control._counter = 0;\n';
            break;
        case 'counter.increment':
            this.source += 'runtime.ext_scratch3_control._counter++;\n';
            break;

        case 'hat.edge':
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
        case 'hat.predicate':
            this.isInHat = true;
            this.source += `if (!${this.descendInput(node.condition).asBoolean()}) {\n`;
            this.retire();
            this.source += '}\n';
            this.source += 'yield;\n';
            this.isInHat = false;
            break;

        case 'event.broadcast':
            this.source += `startHats("event_whenbroadcastreceived", { BROADCAST_OPTION: ${this.descendInput(node.broadcast).asString()} });\n`;
            this.resetVariableInputs();
            break;
        case 'event.broadcastAndWait':
            this.source += `yield* waitThreads(startHats("event_whenbroadcastreceived", { BROADCAST_OPTION: ${this.descendInput(node.broadcast).asString()} }));\n`;
            this.yielded();
            break;

        case 'list.add': {
            const list = this.referenceVariable(node.list);
            this.source += `${list}.value.push(${this.descendInput(node.item).asSafe()});\n`;
            if (vm.enableMonitorUpdates) {
                this.source += `${list}._monitorUpToDate = false;\n`;
            }
            break;
        }
        case 'list.delete': {
            const list = this.referenceVariable(node.list);
            const index = this.descendInput(node.index);
            if (index instanceof ConstantInput) {
                if (index.constantValue === 'last') {
                    this.source += `${list}.value.pop();\n`;
                    if (vm.enableMonitorUpdates) {
                        this.source += `${list}._monitorUpToDate = false;\n`;
                    }
                    break;
                }
                if (+index.constantValue === 1) {
                    this.source += `${list}.value.shift();\n`;
                    if (vm.enableMonitorUpdates) {
                        this.source += `${list}._monitorUpToDate = false;\n`;
                    }
                    break;
                }
                if (index.isAlwaysNumber() && +index.constantValue >= 1) {
                    this.source += `if (${list}.value.length >= ${index.constantValue}){${list}.value.splice(${index.constantValue - 1}, 1);${list}._monitorUpToDate = false}`;
                    break;
                }
            }
            this.source += `listDelete(${list}, ${index.asUnknown()});\n`;
            break;
        }
        case 'list.deleteAll':
            this.source += `${this.referenceVariable(node.list)}.value = [];\n`;
            break;
        case 'list.hide':
            this.source += `runtime.monitorBlocks.changeBlock({ id: "${sanitize(node.list.id)}", element: "checkbox", value: false }, runtime);\n`;
            break;
        case 'list.insert': {
            const list = this.referenceVariable(node.list);
            const index = this.descendInput(node.index);
            const item = this.descendInput(node.item);
            if (index instanceof ConstantInput && +index.constantValue === 1) {
                this.source += `${list}.value.unshift(${item.asSafe()});\n`;
                if (vm.enableMonitorUpdates) {
                    this.source += `${list}._monitorUpToDate = false;\n`;
                }
                break;
            }
            this.source += `listInsert(${list}, ${index.asUnknown()}, ${item.asSafe()});\n`;
            break;
        }
        case 'list.replace': {
            const idx = this.descendInput(node.index);
            const variable = this.referenceVariable(node.list);
            const value = this.descendInput(node.item).asSafe();
            if (idx instanceof ConstantInput && idx.isAlwaysNumber() && +idx.constantValue >= 1) {
                this.source += `if (${variable}.value.length >= ${idx.constantValue}){${variable}.value[${idx.constantValue - 1}] = ${value};${variable}._monitorUpToDate = false}`;
                break;
            }
            this.source += `listReplace(${variable}, ${idx.asUnknown()}, ${value});\n`;
            break;
        }
        case 'list.show':
            this.source += `runtime.monitorBlocks.changeBlock({ id: "${sanitize(node.list.id)}", element: "checkbox", value: true }, runtime);\n`;
            break;

        case 'looks.backwardLayers':
            if (!this.target.isStage) {
                this.source += `target.goBackwardLayers(${this.descendInput(node.layers).asNumber()});\n`;
            }
            break;
        case 'looks.clearEffects':
            this.source += 'target.clearEffects();\n';
            break;
        case 'looks.changeEffect':
            if (Object.prototype.hasOwnProperty.call(this.target.effects, node.effect)) {
                this.source += `target.setEffect("${sanitize(node.effect)}", runtime.ext_scratch3_looks.clampEffect("${sanitize(node.effect)}", ${this.descendInput(node.value).asNumber()} + target.effects["${sanitize(node.effect)}"]));\n`;
            }
            break;
        case 'looks.changeSize':
            this.source += `target.setSize(target.size + ${this.descendInput(node.size).asNumber()});\n`;
            break;
        case 'looks.forwardLayers':
            if (!this.target.isStage) {
                this.source += `target.goForwardLayers(${this.descendInput(node.layers).asNumber()});\n`;
            }
            break;
        case 'looks.goToBack':
            if (!this.target.isStage) {
                this.source += 'target.goToBack();\n';
            }
            break;
        case 'looks.goToFront':
            if (!this.target.isStage) {
                this.source += 'target.goToFront();\n';
            }
            break;
        case 'looks.hide':
            this.source += 'target.setVisible(false);\n';
            this.source += 'runtime.ext_scratch3_looks._renderBubble(target);\n';
            break;
        case 'looks.nextBackdrop':
            this.source += 'runtime.ext_scratch3_looks._setBackdrop(stage, stage.currentCostume + 1, true);\n';
            break;
        case 'looks.nextCostume':
            this.source += 'target.setCostume(target.currentCostume + 1);\n';
            break;
        case 'looks.setEffect':
            if (Object.prototype.hasOwnProperty.call(this.target.effects, node.effect)) {
                this.source += `target.setEffect("${sanitize(node.effect)}", runtime.ext_scratch3_looks.clampEffect("${sanitize(node.effect)}", ${this.descendInput(node.value).asNumber()}));\n`;
            }
            break;
        case 'looks.setSize':
            this.source += `target.setSize(${this.descendInput(node.size).asNumber()});\n`;
            break;
        case 'looks.show':
            this.source += 'target.setVisible(true);\n';
            this.source += 'runtime.ext_scratch3_looks._renderBubble(target);\n';
            break;
        case 'looks.switchBackdrop':
            this.source += `runtime.ext_scratch3_looks._setBackdrop(stage, ${this.descendInput(node.backdrop).asSafe()});\n`;
            break;
        case 'looks.switchCostume':
            this.source += `runtime.ext_scratch3_looks._setCostume(target, ${this.descendInput(node.costume).asSafe()});\n`;
            break;

        case 'motion.changeX':
            this.source += `target.setXY(target.x + ${this.descendInput(node.dx).asNumber()}, target.y);\n`;
            break;
        case 'motion.changeY':
            this.source += `target.setXY(target.x, target.y + ${this.descendInput(node.dy).asNumber()});\n`;
            break;
        case 'motion.ifOnEdgeBounce':
            this.source += `runtime.ext_scratch3_motion._ifOnEdgeBounce(target);\n`;
            break;
        case 'motion.setDirection':
            this.source += `target.setDirection(${this.descendInput(node.direction).asNumber()});\n`;
            break;
        case 'motion.pointtowards_xy':
            this.usedMathFunctions.add('atan');
            this.usedMathFunctions.add('RAD_TO_DEG');
            {
                const xNum = this.descendInput(node.x).asNumber();
                const yNum = this.descendInput(node.y).asNumber();
                this.source += `target.setDirection(180 + ((atan((${xNum} - target.x) / (${yNum} - target.y)) * RAD_TO_DEG) + (${yNum} > target.y ? 180 : 0)));\n`;
            }
            break;
        case 'motion.pointtowards_xyfrom':
            this.usedMathFunctions.add('atan');
            this.usedMathFunctions.add('RAD_TO_DEG');
            {
                const xNum = this.descendInput(node.x).asNumber();
                const yNum = this.descendInput(node.y).asNumber();
                const fromXNum = this.descendInput(node.fromx).asNumber();
                const fromYNum = this.descendInput(node.fromy).asNumber();
                this.source += `target.setDirection(180 + ((atan((${xNum} - ${fromXNum}) / (${yNum} - ${fromYNum})) * RAD_TO_DEG) + (${yNum} > ${fromYNum} ? 180 : 0)));\n`;
            }
            break;
        case 'motion.setRotationStyle':
            this.source += `target.setRotationStyle("${sanitize(node.style)}");\n`;
            break;
        case 'motion.setX': // fallthrough
        case 'motion.setY': // fallthrough
        case 'motion.setXY': {
            this.descendedIntoModulo = false;
            const x = 'x' in node ? this.descendInput(node.x).asNumber() : 'target.x';
            const y = 'y' in node ? this.descendInput(node.y).asNumber() : 'target.y';
            this.source += `target.setXY(${x}, ${y});\n`;
            if (this.descendedIntoModulo) {
                this.source += `if (target.interpolationData) target.interpolationData = null;\n`;
            }
            break;
        }
        case 'motion.step':
            this.source += `runtime.ext_scratch3_motion._moveSteps(${this.descendInput(node.steps).asNumber()}, target);\n`;
            break;

        case 'noop':
            break;

        case 'pen.clear':
            this.source += `${PEN_EXT}.clear();\n`;
            break;
        case 'pen.down':
            this.source += `${PEN_EXT}._penDown(target);\n`;
            break;
        case 'pen.changeParam':
            this.source += `${PEN_EXT}._setOrChangeColorParam(${this.descendInput(node.param).asString()}, ${this.descendInput(node.value).asNumber()}, ${PEN_STATE}, true);\n`;
            break;
        case 'pen.changeSize':
            this.source += `${PEN_EXT}._changePenSizeBy(${this.descendInput(node.size).asNumber()}, target);\n`;
            break;
        case 'pen.legacyChangeHue':
            this.source += `${PEN_EXT}._changePenHueBy(${this.descendInput(node.hue).asNumber()}, target);\n`;
            break;
        case 'pen.legacyChangeShade':
            this.source += `${PEN_EXT}._changePenShadeBy(${this.descendInput(node.shade).asNumber()}, target);\n`;
            break;
        case 'pen.legacySetHue':
            this.source += `${PEN_EXT}._setPenHueToNumber(${this.descendInput(node.hue).asNumber()}, target);\n`;
            break;
        case 'pen.legacySetShade':
            this.source += `${PEN_EXT}._setPenShadeToNumber(${this.descendInput(node.shade).asNumber()}, target);\n`;
            break;
        case 'pen.setColor':
            this.source += `${PEN_EXT}._setPenColorToColor(${this.descendInput(node.color).asColor()}, target);\n`;
            break;
        case 'pen.setParam':
            this.source += `${PEN_EXT}._setOrChangeColorParam(${this.descendInput(node.param).asString()}, ${this.descendInput(node.value).asNumber()}, ${PEN_STATE}, false);\n`;
            break;
        case 'pen.setSize':
            this.source += `${PEN_EXT}._setPenSizeTo(${this.descendInput(node.size).asNumber()}, target);\n`;
            break;
        case 'pen.stamp':
            this.source += `${PEN_EXT}._stamp(target);\n`;
            break;
        case 'pen.printText':
            this.source += `${PEN_EXT}._printText(${this.descendInput(node.text).asSafe()}, ${this.descendInput(node.x).asNumber()}, ${this.descendInput(node.y).asNumber()}, target);\n`;
            break;
        case 'pen.up':
            this.source += `${PEN_EXT}._penUp(target);\n`;
            break;

        case 'procedures.call': {
            const procedureCode = node.code;
            const procedureVariant = node.variant;
            const procedureData = this.ir.procedures[procedureVariant];
            if (procedureData.stack === null) {
                // TODO still need to evaluate arguments
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
            break;
        }
        case 'procedures.return':
            this.stopScriptAndReturn(this.descendInput(node.value).asSafe());
            break;

        case 'timer.reset':
            this.source += 'runtime.ioDevices.clock.resetProjectTimer();\n';
            break;

        case 'tw.debugger':
            this.source += 'debugger;\n';
            break;

        case 'var.hide':
            this.source += `runtime.monitorBlocks.changeBlock({ id: "${sanitize(node.variable.id)}", element: "checkbox", value: false }, runtime);\n`;
            break;
        case 'var.set': {
            const variable = this.descendVariable(node.variable);
            const value = this.descendInput(node.value);
            if (variable._value instanceof ConstantInput &&
                value instanceof ConstantInput &&
                variable._value.constantValue === value.constantValue) {
                break;
            }
            variable.setInput(value);
            this.source += `${variable.source} = ${value.asSafe()};\n`;
            if (node.variable.isCloud) {
                this.source += `runtime.ioDevices.cloud.requestUpdateVariable("${sanitize(node.variable.name)}", ${variable.source});\n`;
            }
            break;
        }
        case 'var.show':
            this.source += `runtime.monitorBlocks.changeBlock({ id: "${sanitize(node.variable.id)}", element: "checkbox", value: true }, runtime);\n`;
            break;

        case 'visualReport': {
            const value = this.localVariables.next();
            this.source += `const ${value} = ${this.descendInput(node.input).asUnknown()};`;
            // blocks like legacy no-ops can return a literal `undefined`
            this.source += `runtime.visualReport("${sanitize(this.script.topBlockId)}", ${value});\n`;
            break;
        }

        case 'control.switch': {
            this.source += `switch (${this.descendInput(node.value).asString()}) {\n`;
            this.descendStack(node.do, new Frame(false));
            this.source += `}\n`;
            break;
        }
        case 'control.case': {
            this.source += `case ${this.descendInput(node.value).asString()}: {\n`;
            
            this.descendStack(node.do, new Frame(false));
            this.source += 'break; }\n';
            break;
        }
        case 'control.default': {
            this.source += `default:\n`;
            
            this.descendStack(node.do, new Frame(false));
            break;
        }
        case 'control.break': {
            this.source += 'break;\n';
            break;
        }
        case 'control.case_fallthrough': {
            this.source += `case ${this.descendInput(node.value).asString()}:\n`;
            // No break statement - allows fallthrough to next case
            break;
        }

        default:
            log.warn(`JS: Unknown stacked block: ${node.kind}`, node);
            throw new Error(`JS: Unknown stacked block: ${node.kind}`);
        }
    }

    /**
     * Compile a Record of input objects into a safe JS string.
     * @param {Record<string, unknown>} inputs
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
        this.variableInputs = {};
    }

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

    descendVariable (variable) {
        if (Object.prototype.hasOwnProperty.call(this.variableInputs, variable.id)) {
            return this.variableInputs[variable.id];
        }
        const input = new VariableInput(`${this.referenceVariable(variable)}.value`);
        this.variableInputs[variable.id] = input;
        return input;
    }

    referenceVariable (variable) {
        if (variable.scope === 'target') {
            return this.evaluateOnce(`target.variables["${sanitize(variable.id)}"]`);
        }
        return this.evaluateOnce(`stage.variables["${sanitize(variable.id)}"]`);
    }

    descendAddonCall (node) {
        const inputs = this.descendInputRecord(node.arguments);
        const blockFunction = `runtime.getAddonBlock("${sanitize(node.code)}").callback`;
        const blockId = `"${sanitize(node.blockId)}"`;
        return `yield* executeInCompatibilityLayer(${inputs}, ${blockFunction}, ${this.isWarp}, false, ${blockId})`;
    }

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
    }

    /**
     * Write JS to request a redraw.
     */
    requestRedraw () {
        this.source += 'runtime.requestRedraw();\n';
    }

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
                if (MATH_CACHE[k]) mathKeys.add(k);
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

        // Add common runtime optimizations
        if (this.usedMathFunctions.has('abs') ||
            this.usedMathFunctions.has('round') ||
            this.usedMathFunctions.has('floor') ||
            this.usedMathFunctions.has('ceil')) {
            script += 'const isNaN=Number.isNaN;\n';
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
        // Mistwarp specific to disable the monitor updates being compiled if the user specifies
        if (typeof vm.enableMonitorUpdates === 'undefined') {
            console.log('Set Montior updates on vm');
            vm.enableMonitorUpdates = true;
        }

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

        return fn;
    }
}

// For extensions.
JSGenerator.unstable_exports = {
    TYPE_NUMBER,
    TYPE_STRING,
    TYPE_BOOLEAN,
    TYPE_UNKNOWN,
    TYPE_NUMBER_NAN,
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

// Test hook used by automated snapshot testing.
JSGenerator.testingApparatus = null;

module.exports = JSGenerator;
