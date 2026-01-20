const log = require('../util/log');

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

module.exports = {sanitize, isSafeConstantForEqualsOptimization, getNamesOfCostumesAndSounds};
