// @ts-check

const TYPES = {
    NUMBER: 1,
    STRING: 2,
    BOOLEAN: 3,
    UNKNOWN: 4,
    NUMBER_NAN: 5,
    LOWER_STRING: 6,
    NUMBER_INT: 7,
    PROCEDURE_ARG: 8
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
