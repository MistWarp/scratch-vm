// @ts-check

const jsexecute = require('./jsexecute');
const {StackOpcode, InputOpcode, InputType} = require('./enums.js');
const {IntermediateInput, IntermediateStack} = require('./intermediate');

/**
 * @fileoverview Constant folding and dead branch removal on the intermediate representation.
 *
 * Every fold here computes exactly what the JavaScript generated for the unfolded node would
 * compute at runtime, so folding never changes what a project does. Folds that would drop an
 * input only do so when the generated code would not have evaluated it either, or when the
 * input has no side effects.
 */

/**
 * The helpers the generated scripts call, so folded values match runtime values bit for bit.
 */
const helpers = jsexecute.scopedEval(
    '({compareEqual, compareGreaterThan, compareLessThan, mod, tan, repeatString, replaceString})'
);

/**
 * Folding a repeat could otherwise embed an enormous literal in the generated script.
 */
const MAX_FOLDED_REPEAT_LENGTH = 1024;

/**
 * Inputs whose evaluation can be observed, so they may never be dropped.
 */
const IMPURE_INPUTS = new Set([
    InputOpcode.ADDON_CALL,
    InputOpcode.COMPATIBILITY_LAYER,
    InputOpcode.OLD_COMPILER_COMPATIBILITY_LAYER,
    InputOpcode.EXTENSION,
    InputOpcode.RAW_SOURCE,
    InputOpcode.PROCEDURE_CALL
]);

/**
 * Inputs that expect their direct inputs to stay in the shape the project author wrote them,
 * because a constant is spliced into their source as-is instead of as a literal.
 */
const RAW_INPUT_CONSUMERS = new Set([
    InputOpcode.EXTENSION,
    InputOpcode.RAW_SOURCE,
    StackOpcode.EXTENSION,
    StackOpcode.RAW_SOURCE
]);

const isPlainContainer = value => {
    if (Array.isArray(value)) return true;
    if (value === null || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
};

/**
 * Visit every intermediate input and stack reachable from a node's inputs, replacing each with
 * what the callbacks return.
 * @param {*} container The inputs object (or a nested plain object or array inside it).
 * @param {(input: IntermediateInput) => IntermediateInput} onInput
 * @param {(stack: IntermediateStack) => IntermediateStack} onStack
 */
const mapChildren = (container, onInput, onStack) => {
    for (const key of Object.keys(container)) {
        const value = container[key];
        if (value instanceof IntermediateInput) {
            container[key] = onInput(value);
        } else if (value instanceof IntermediateStack) {
            container[key] = onStack(value);
        } else if (isPlainContainer(value) && !Object.isFrozen(value)) {
            mapChildren(value, onInput, onStack);
        }
    }
};

/**
 * @param {IntermediateInput} input
 * @returns {boolean} true if evaluating the input has no observable effect.
 */
const isPure = input => {
    if (IMPURE_INPUTS.has(input.opcode)) return false;
    let pure = true;
    mapChildren(input.inputs, child => {
        if (!isPure(child)) pure = false;
        return child;
    }, stack => stack);
    return pure;
};

const isConstant = input => input.opcode === InputOpcode.CONSTANT;
const isNumberConstant = input => isConstant(input) && typeof input.inputs.value === 'number';
const isStringConstant = input => isConstant(input) && typeof input.inputs.value === 'string';
const isBooleanConstant = input => isConstant(input) && typeof input.inputs.value === 'boolean';
const isPositiveZero = input => isNumberConstant(input) && Object.is(input.inputs.value, 0);
const isNegativeZero = input => isNumberConstant(input) && Object.is(input.inputs.value, -0);
const isNumber = (input, value) => isNumberConstant(input) && input.inputs.value === value;

const numberConstant = value => new IntermediateInput(
    InputOpcode.CONSTANT, IntermediateInput.getNumberInputType(value), {value}
);

const booleanConstant = value => new IntermediateInput(InputOpcode.CONSTANT, InputType.BOOLEAN, {value});

/**
 * Same classification the IR generator gives string literals, without ever turning the
 * string into a number: a folded string must stay a string at runtime.
 * @param {string} value
 * @returns {IntermediateInput}
 */
const stringConstant = value => {
    let type = InputType.STRING_NAN;
    if (!Number.isNaN(+value) && (value.trim() !== '' || value.includes('\t'))) {
        type = InputType.STRING_NUM;
    } else if (value === 'true' || value === 'false') {
        type = InputType.STRING_BOOLEAN;
    }
    return new IntermediateInput(InputOpcode.CONSTANT, type, {value});
};

/**
 * Mirrors what the generated code does for each math block.
 */
const MATH_OPERATIONS = {
    [InputOpcode.OP_ABS]: value => Math.abs(value),
    [InputOpcode.OP_FLOOR]: value => Math.floor(value),
    [InputOpcode.OP_CEILING]: value => Math.ceil(value),
    [InputOpcode.OP_ROUND]: value => Math.round(value),
    [InputOpcode.OP_SQRT]: value => Math.sqrt(value),
    [InputOpcode.OP_SIN]: value => Math.round(Math.sin((Math.PI * value) / 180) * 1e10) / 1e10,
    [InputOpcode.OP_COS]: value => Math.round(Math.cos((Math.PI * value) / 180) * 1e10) / 1e10,
    [InputOpcode.OP_TAN]: value => helpers.tan(value),
    [InputOpcode.OP_ASIN]: value => (Math.asin(value) * 180) / Math.PI,
    [InputOpcode.OP_ACOS]: value => (Math.acos(value) * 180) / Math.PI,
    [InputOpcode.OP_ATAN]: value => (Math.atan(value) * 180) / Math.PI,
    [InputOpcode.OP_LOG_E]: value => Math.log(value),
    [InputOpcode.OP_LOG_10]: value => Math.log(value) / Math.LN10,
    [InputOpcode.OP_POW_E]: value => Math.exp(value),
    [InputOpcode.OP_POW_10]: value => 10 ** value
};

/**
 * Two string operands whose concatenation is known now.
 * @param {IntermediateInput} left
 * @param {IntermediateInput} right
 * @returns {IntermediateInput}
 */
const joinConstants = (left, right) => stringConstant(left.inputs.value + right.inputs.value);

/**
 * Fold a single node whose children have already been folded.
 * @param {IntermediateInput} input
 * @returns {IntermediateInput} The replacement node, or the same node if nothing applies.
 */
const foldOperation = input => {
    const node = input.inputs;

    switch (input.opcode) {
    case InputOpcode.CAST_BOOLEAN:
        return isConstant(node.target) ? node.target.toType(InputType.BOOLEAN) : input;
    case InputOpcode.CAST_NUMBER:
        return isConstant(node.target) ? node.target.toType(InputType.NUMBER) : input;
    case InputOpcode.CAST_NUMBER_INDEX:
        return isConstant(node.target) ? node.target.toType(InputType.NUMBER_INDEX) : input;
    case InputOpcode.CAST_NUMBER_OR_NAN:
        return isConstant(node.target) ? node.target.toType(InputType.NUMBER_OR_NAN) : input;
    case InputOpcode.CAST_STRING:
        return isConstant(node.target) ? node.target.toType(InputType.STRING) : input;
    case InputOpcode.CAST_COLOR:
        return isConstant(node.target) ? node.target.toType(InputType.COLOR) : input;

    case InputOpcode.OP_ADD: {
        const {left, right} = node;
        if (isNumberConstant(left) && isNumberConstant(right)) {
            return numberConstant(left.inputs.value + right.inputs.value);
        }
        // x + 0 is x unless x is -0, and x + -0 is always x.
        if (isNegativeZero(right) || (isPositiveZero(right) && !left.isSometimesType(InputType.NUMBER_NEG_ZERO))) {
            return left;
        }
        if (isNegativeZero(left) || (isPositiveZero(left) && !right.isSometimesType(InputType.NUMBER_NEG_ZERO))) {
            return right;
        }
        return input;
    }
    case InputOpcode.OP_SUBTRACT: {
        const {left, right} = node;
        if (isNumberConstant(left) && isNumberConstant(right)) {
            return numberConstant(left.inputs.value - right.inputs.value);
        }
        // x - 0 is always x, but -0 - -0 is 0.
        if (isPositiveZero(right) || (isNegativeZero(right) && !left.isSometimesType(InputType.NUMBER_NEG_ZERO))) {
            return left;
        }
        return input;
    }
    case InputOpcode.OP_MULTIPLY: {
        const {left, right} = node;
        if (isNumberConstant(left) && isNumberConstant(right)) {
            return numberConstant(left.inputs.value * right.inputs.value);
        }
        if (isNumber(right, 1)) return left;
        if (isNumber(left, 1)) return right;
        return input;
    }
    case InputOpcode.OP_DIVIDE: {
        const {left, right} = node;
        if (isNumberConstant(left) && isNumberConstant(right)) {
            return numberConstant(left.inputs.value / right.inputs.value);
        }
        if (isNumber(right, 1)) return left;
        return input;
    }
    case InputOpcode.OP_MOD: {
        const {left, right} = node;
        if (isNumberConstant(left) && isNumberConstant(right)) {
            return numberConstant(helpers.mod(left.inputs.value, right.inputs.value));
        }
        return input;
    }

    case InputOpcode.OP_ABS:
    case InputOpcode.OP_FLOOR:
    case InputOpcode.OP_CEILING:
    case InputOpcode.OP_ROUND:
    case InputOpcode.OP_SQRT:
    case InputOpcode.OP_SIN:
    case InputOpcode.OP_COS:
    case InputOpcode.OP_TAN:
    case InputOpcode.OP_ASIN:
    case InputOpcode.OP_ACOS:
    case InputOpcode.OP_ATAN:
    case InputOpcode.OP_LOG_E:
    case InputOpcode.OP_LOG_10:
    case InputOpcode.OP_POW_E:
    case InputOpcode.OP_POW_10:
        if (isNumberConstant(node.value)) {
            return numberConstant(MATH_OPERATIONS[input.opcode](node.value.inputs.value));
        }
        return input;

    case InputOpcode.OP_NOT:
        if (isBooleanConstant(node.operand)) return booleanConstant(!node.operand.inputs.value);
        if (node.operand.opcode === InputOpcode.OP_NOT) return node.operand.inputs.operand;
        return input;
    case InputOpcode.OP_AND: {
        const {left, right} = node;
        // The generated && never evaluates the right side after a false left side.
        if (isBooleanConstant(left)) return left.inputs.value ? right : left;
        if (isBooleanConstant(right)) {
            if (right.inputs.value) return left;
            if (isPure(left)) return right;
        }
        return input;
    }
    case InputOpcode.OP_OR: {
        const {left, right} = node;
        if (isBooleanConstant(left)) return left.inputs.value ? left : right;
        if (isBooleanConstant(right)) {
            if (!right.inputs.value) return left;
            if (isPure(left)) return right;
        }
        return input;
    }

    case InputOpcode.OP_EQUALS:
        if (isConstant(node.left) && isConstant(node.right)) {
            return booleanConstant(helpers.compareEqual(node.left.inputs.value, node.right.inputs.value));
        }
        return input;
    case InputOpcode.OP_GREATER:
        if (isConstant(node.left) && isConstant(node.right)) {
            return booleanConstant(helpers.compareGreaterThan(node.left.inputs.value, node.right.inputs.value));
        }
        return input;
    case InputOpcode.OP_LESS:
        if (isConstant(node.left) && isConstant(node.right)) {
            return booleanConstant(helpers.compareLessThan(node.left.inputs.value, node.right.inputs.value));
        }
        return input;

    case InputOpcode.OP_JOIN: {
        const {left, right} = node;
        if (isStringConstant(left) && isStringConstant(right)) return joinConstants(left, right);
        if (isStringConstant(left) && left.inputs.value === '') return right;
        if (isStringConstant(right) && right.inputs.value === '') return left;
        // Text concatenation is associative, so neighbouring literals merge: join(join(a, "x"), "y")
        // becomes join(a, "xy").
        if (isStringConstant(right) && left.opcode === InputOpcode.OP_JOIN && isStringConstant(left.inputs.right)) {
            node.left = left.inputs.left;
            node.right = joinConstants(left.inputs.right, right);
            return input;
        }
        if (isStringConstant(left) && right.opcode === InputOpcode.OP_JOIN && isStringConstant(right.inputs.left)) {
            node.left = joinConstants(left, right.inputs.left);
            node.right = right.inputs.right;
            return input;
        }
        return input;
    }
    case InputOpcode.OP_LENGTH:
        if (isStringConstant(node.string)) return numberConstant(node.string.inputs.value.length);
        return input;
    case InputOpcode.OP_LETTER_OF:
        if (isStringConstant(node.string) && isNumberConstant(node.letter)) {
            return stringConstant(node.string.inputs.value[node.letter.inputs.value - 1] || '');
        }
        return input;
    case InputOpcode.OP_LETTERS_OF:
        if (isStringConstant(node.string) && isNumberConstant(node.start) && isNumberConstant(node.end)) {
            const {string, start, end} = node;
            return stringConstant(string.inputs.value.substring(start.inputs.value - 1, end.inputs.value));
        }
        return input;
    case InputOpcode.OP_CONTAINS:
        if (isStringConstant(node.string) && isStringConstant(node.contains)) {
            return booleanConstant(
                node.string.inputs.value.toLowerCase().indexOf(node.contains.inputs.value.toLowerCase()) !== -1
            );
        }
        return input;
    case InputOpcode.OP_INDEX_OF:
        if (isStringConstant(node.string) && isStringConstant(node.substring)) {
            return numberConstant(
                node.string.inputs.value.toLowerCase().indexOf(node.substring.inputs.value.toLowerCase()) + 1
            );
        }
        return input;
    case InputOpcode.OP_CHANGE_CASE:
        if (isStringConstant(node.string)) {
            const value = node.string.inputs.value;
            return stringConstant(node.upper ? value.toUpperCase() : value.toLowerCase());
        }
        return input;
    case InputOpcode.OP_TRIM:
        if (isStringConstant(node.string)) return stringConstant(node.string.inputs.value.trim());
        return input;
    case InputOpcode.OP_REPEAT:
        if (isStringConstant(node.string) && isNumberConstant(node.count)) {
            const string = node.string.inputs.value;
            const count = node.count.inputs.value;
            if (!(string.length * count <= MAX_FOLDED_REPEAT_LENGTH)) return input;
            return stringConstant(helpers.repeatString(string, count));
        }
        return input;
    case InputOpcode.OP_REPLACE:
        if (isStringConstant(node.substring) && isStringConstant(node.string) && isStringConstant(node.replacement)) {
            return stringConstant(helpers.replaceString(
                node.substring.inputs.value, node.string.inputs.value, node.replacement.inputs.value
            ));
        }
        return input;
    }

    return input;
};

/**
 * Fold an input and everything inside it.
 * @param {IntermediateInput} input
 * @param {boolean} [allowConstant] Whether this input may be replaced by a constant.
 * @returns {IntermediateInput}
 */
const foldInput = (input, allowConstant = true) => {
    const childrenMayBecomeConstants = !RAW_INPUT_CONSUMERS.has(input.opcode);
    // eslint-disable-next-line no-use-before-define
    mapChildren(input.inputs, child => foldInput(child, childrenMayBecomeConstants), foldStack);

    if (isConstant(input)) return input;
    const folded = foldOperation(input);
    if (!allowConstant && folded !== input && isConstant(folded)) return input;
    return folded;
};

/**
 * @param {import('./intermediate').IntermediateStackBlock} block A block whose inputs are folded.
 * @returns {import('./intermediate').IntermediateStackBlock[]} What the block reduces to.
 */
const foldStackBlock = block => {
    const node = block.inputs;

    switch (block.opcode) {
    case StackOpcode.NOP:
        return [];
    case StackOpcode.CONTROL_IF_ELSE:
        if (isBooleanConstant(node.condition)) {
            return (node.condition.inputs.value ? node.whenTrue : node.whenFalse).blocks;
        }
        if (node.whenTrue.blocks.length === 0 && node.whenFalse.blocks.length === 0 && isPure(node.condition)) {
            return [];
        }
        return [block];
    case StackOpcode.CONTROL_WHILE:
        if (isBooleanConstant(node.condition) && !node.condition.inputs.value) return [];
        return [block];
    case StackOpcode.CONTROL_REPEAT:
        if (isNumberConstant(node.times) && !(node.times.inputs.value >= 0.5)) return [];
        return [block];
    case StackOpcode.CONTROL_FOR:
        if (isNumberConstant(node.count) && !(node.count.inputs.value > 0)) return [];
        return [block];
    case StackOpcode.CONTROL_WAIT_UNTIL:
        if (isBooleanConstant(node.condition) && node.condition.inputs.value) return [];
        return [block];
    }

    return [block];
};

/**
 * Fold a stack of blocks in place.
 * @param {IntermediateStack} stack
 * @returns {IntermediateStack} The same stack.
 */
const foldStack = stack => {
    const blocks = [];
    for (const block of stack.blocks) {
        const childrenMayBecomeConstants = !RAW_INPUT_CONSUMERS.has(block.opcode);
        mapChildren(block.inputs, child => foldInput(child, childrenMayBecomeConstants), foldStack);
        blocks.push(...foldStackBlock(block));
    }
    stack.blocks = blocks;
    return stack;
};

module.exports = {
    foldInput,
    foldStack,
    isPure
};
