// @ts-check

// ── Trait bits ────────────────────────────────────────────────
const TRAITS = {
    NUMBER: 1 << 0, // 0b00000001
    STRING: 1 << 1, // 0b00000010
    BOOLEAN: 1 << 2, // 0b00000100
    NAN: 1 << 3, // 0b00001000  NaN
    POSITIVE: 1 << 4, // 0b00010000
    NEGATIVE: 1 << 5, // 0b00100000
    INTEGER: 1 << 6, // 0b01000000
    ZERO: 1 << 7, // 0b10000000
    UNKNOWN: 1 << 8,
    PROCEDURE_ARG: 1 << 9,
    LOWER_CASE: 1 << 10,
    UPPER_CASE: 1 << 11
};

// ── Composed types ────────────────────
const TYPES = {
    UNKNOWN: TRAITS.UNKNOWN,
    NUMBER: TRAITS.NUMBER,
    NUMBER_NAN: TRAITS.NUMBER | TRAITS.NAN,
    NUMBER_ZERO: TRAITS.NUMBER | TRAITS.ZERO,
    NUMBER_INT: TRAITS.NUMBER | TRAITS.INTEGER,
    NUMBER_POS: TRAITS.NUMBER | TRAITS.POSITIVE,
    NUMBER_NEG: TRAITS.NUMBER | TRAITS.NEGATIVE,
    NUMBER_POS_INT: TRAITS.NUMBER | TRAITS.POSITIVE | TRAITS.INTEGER,
    NUMBER_NEG_INT: TRAITS.NUMBER | TRAITS.NEGATIVE | TRAITS.INTEGER,
    STRING: TRAITS.STRING,
    LOWER_STRING: TRAITS.STRING | TRAITS.LOWER_CASE,
    UPPER_STRING: TRAITS.STRING | TRAITS.UPPER_CASE,
    BOOLEAN: TRAITS.BOOLEAN,
    PROCEDURE_ARG: TRAITS.PROCEDURE_ARG
};

// ── Predicate helpers ─────────────────────────────────────────

/** @param {number} type */
const isNumber = type => (type & TRAITS.NUMBER) !== 0 && (type & TRAITS.NAN) === 0;

/** @param {number} type */
const isNumberOrNaN = type => (type & (TRAITS.NUMBER | TRAITS.NAN)) !== 0;
/** @param {number} type */
const isPositive = type => (type & TRAITS.POSITIVE) !== 0;
/** @param {number} type */
const isNegative = type => (type & TRAITS.NEGATIVE) !== 0;

/** @param {number} type */
const isInteger = type => (type & TRAITS.INTEGER) !== 0;

/** @param {number} type */
const isString = type => (type & TRAITS.STRING) !== 0;

// ── typeToInt: keep same semantics, now purely additive ───────
/** @param {number} type */
const typeToInt = type => {
    if (!isNumber(type)) return type;
    return (type & ~TRAITS.ZERO) | TRAITS.INTEGER;
};

/** @param {number} type */
const withoutNaN = type => type & ~TRAITS.NAN;

/** @param {number} type */
const couldBeNaN = type => (type & TRAITS.NAN) !== 0;

let INPUT_I = 1;
const id = () => INPUT_I++;

const BLOCKS = {
    MOTION: {
        X_POSITION: id(),
        Y_POSITION: id(),
        DIRECTION: id(),
        CHANGE_X: id(),
        CHANGE_Y: id(),
        SET_ROTATION_STYLE: id(),
        SET_XY: id(),
        SET_X: id(),
        SET_Y: id(),
        SET_DIRECTION: id(),
        POINT_TOWARDS_XY: id(),
        POINT_TOWARDS_XY_FROM: id(),
        STEP: id(),
        IF_ON_EDGE_BOUNCE: id()
    },

    CONSTANT: id(),

    COUNTER: {
        GET: id(),
        INCR: id(),
        CLEAR: id()
    },

    KEYBOARD: {
        PRESSED: id()
    },

    VAR: {
        GET: id(),
        SET: id(),
        CHANGE: id(),
        SHOW: id(),
        HIDE: id()
    },

    LIST: {
        CONTAINS: id(),
        CONTENTS: id(),
        GET: id(),
        INDEXOF: id(),
        LENGTH: id(),
        AS: id(),
        ADD: id(),
        DELETE: id(),
        DELETE_ALL: id(),
        HIDE: id(),
        INSERT: id(),
        REPLACE: id(),
        SHOW: id(),
        SET_ARRAY: id()
    },

    LOOKS: {
        BACKDROP_NUMBER: id(),
        BACKDROP_NAME: id(),
        COSTUME_NUMBER: id(),
        COSTUME_NAME: id(),
        SIZE: id(),
        COSTUMES: id(),
        FORWARD_LAYERS: id(),
        BACKWARD_LAYERS: id(),
        CLEAR_EFFECTS: id(),
        CHANGE_EFFECT: id(),
        CHANGE_SIZE: id(),
        GOTO_BACK: id(),
        GOTO_FRONT: id(),
        HIDE: id(),
        NEXT_BACKDROP: id(),
        NEXT_COSTUME: id(),
        SET_EFFECT: id(),
        SET_SIZE: id(),
        SHOW: id(),
        SWITCH_BACKDROP: id(),
        SWITCH_COSTUME: id(),
        SAY: id(),
        THINK: id()
    },

    SENSING: {
        ANSWER: id(),
        COLOR_TOUCHING_COLOR: id(),
        YEAR: id(),
        DATE: id(),
        DAYOFWEEK: id(),
        DAYS_SINCE_2000: id(),
        DISTANCE: id(),
        HOUR: id(),
        MINUTE: id(),
        MONTH: id(),
        OF: id(),
        REFRESH_TIME: id(),
        SECOND: id(),
        TODAY: id(),
        TOUCHING_COLOR: id(),
        TOUCHING: id(),
        ONLINE: id(),
        USERNAME: id()
    },

    MOUSE: {
        DOWN: id(),
        X: id(),
        Y: id()
    },

    OP: {
        ABS: id(),
        ACOS: id(),
        ASIN: id(),
        ATAN: id(),
        CEILING: id(),
        COS: id(),
        FLOOR: id(),
        LN: id(),
        LOG: id(),
        ROUND: id(),
        SIN: id(),
        SQRT: id(),
        TAN: id(),
        ADD: id(),
        SUBTRACT: id(),
        MULTIPLY: id(),
        DIVIDE: id(),
        RANDOM: id(),
        NOT: id(),
        OR: id(),
        AND: id(),
        EQUALS: id(),
        GREATER: id(),
        LESS: id(),
        LETTEROF: id(),
        LENGTH: id(),
        CONTAINS: id(),
        MOD: id(),
        EXP: id(),
        JOIN: id(),
        TENEXP: id(),
        PI: id(),
        NEWLINE: id()
    },

    PROCEDURES: {
        ARGUMENT: id(),
        CALL: id(),
        RETURN: id(),
        DEFINITION: id()
    },

    NOOP: id(),

    COMPAT: id(),

    ADDONS: {
        CALL: id()
    },

    CONTROL: {
        IF: id(),
        REPEAT: id(),
        REPEAT_UNTIL: id(),
        FOR: id(),
        WHILE: id(),
        SWITCH: id(),
        CASE: id(),
        DEFAULT: id(),
        BREAK: id(),
        CASE_FALLTHROUGH: id(),
        DELETE_CLONE: id(),
        CREATE_CLONE: id(),
        STOP_ALL: id(),
        STOP_OTHERS: id(),
        STOP_SCRIPT: id(),
        WAIT: id(),
        WAIT_UNTIL: id()
    },

    HAT: {
        EDGE: id(),
        PREDICATE: id()
    },

    EVENT: {
        BROADCAST: id(),
        BROADCAST_AND_WAIT: id()
    },

    PEN: {
        CLEAR: id(),
        CHANGE_PARAM: id(),
        CHANGE_HUE: id(),
        CHANGE_SHADE: id(),
        CHANGE_SIZE: id(),
        LEGACY_CHANGE_HUE: id(),
        LEGACY_CHANGE_SHADE: id(),
        LEGACY_SET_HUE: id(),
        LEGACY_SET_SHADE: id(),
        DOWN: id(),
        UP: id(),
        SET_COLOR: id(),
        SET_PARAM: id(),
        SET_SIZE: id(),
        STAMP: id(),
        PRINT_TEXT: id(),
        DRAW_TRIANGLE: id()
    },

    SOUND: {
        CHANGE_VOLUME: id(),
        SET_VOLUME: id(),
        PLAY_SOUND: id(),
        STOP_ALL_SOUNDS: id(),
        STOP_OTHER_SOUNDS: id(),
        STOP_THIS_SOUND: id()
    },

    TIMER: {
        RESET: id(),
        GET: id()
    },

    TW: {
        DEBUGGER: id(),
        LAST_KEY_PRESSED: id()
    },

    VISUAL_REPORT: id()
};

/**
 * @param {number} typeId
 * @returns {string|undefined}
 */
const getNameForType = typeId => {
    /**
     * @param {object} obj
     * @param {string} path
     * @returns {string|undefined}
     */
    const search = (obj, path) => {
        for (const [key, val] of Object.entries(obj)) {
            const newPath = path ? `${path}.${key}` : key;
            if (typeof val === 'number') {
                if (val === typeId) return newPath;
            } else if (val && typeof val === 'object') {
                const found = search(val, newPath);
                if (found) return found;
            }
        }
    };

    return search(BLOCKS, 'BLOCKS');
};

export {
    TRAITS,
    TYPES,
    BLOCKS,
    getNameForType,
    isNumber,
    isNumberOrNaN,
    isPositive,
    isNegative,
    typeToInt,
    isInteger,
    isString,
    couldBeNaN,
    withoutNaN
};
