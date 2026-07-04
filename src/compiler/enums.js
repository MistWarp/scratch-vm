// @ts-check

const TYPES = {
    NUMBER_POS_INF: 0x001,
    NUMBER_POS_INT: 0x002,
    NUMBER_POS_FRACT: 0x004,
    NUMBER_POS_REAL: 0x006,
    NUMBER_ZERO: 0x008,
    NUMBER_NEG_ZERO: 0x010,
    NUMBER_NEG_INT: 0x020,
    NUMBER_NEG_FRACT: 0x040,
    NUMBER_NEG_REAL: 0x060,
    NUMBER_NEG_INF: 0x080,

    NAN: 0x100,

    NUMBER_ANY_ZERO: 0x018,
    NUMBER_INF: 0x081,
    NUMBER_POS: 0x007,
    NUMBER_NEG: 0x0E0,
    NUMBER_WHOLE: 0x00A,
    NUMBER_FRACT: 0x044,
    NUMBER_REAL: 0x07E,

    NUMBER: 0x0FF,
    NUMBER_OR_NAN: 0x1FF,
    NUMBER_INDEX: 0x1BB,
    NUMBER_INTERPRETABLE: 0x12FF,

    STRING_NUM: 0x200,
    STRING_NAN: 0x400,
    STRING_BOOLEAN: 0x800,
    STRING: 0xE00,

    BOOLEAN: 0x1000,
    BOOLEAN_INTERPRETABLE: 0x1800,

    OBJECT: 0x2000,
    ARRAY: 0x4000,

    ANY: 0x7FFF,
    COLOR: 0x8000,

    NUMBER_INT: 0x03A,
    NUMBER_NAN: 0x1FF,
    UNKNOWN: 0x7FFF,
    LOWER_STRING: 0x10000,
    PROCEDURE_ARG: 0x20000
};

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
    TYPES,
    BLOCKS,
    getNameForType
};
