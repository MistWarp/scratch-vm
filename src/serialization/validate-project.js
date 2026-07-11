const unpack = require('scratch-parser/lib/unpack');
const parse = require('scratch-parser/lib/parse');
let scsfReader;
try {
    const scsfModule = require('../scsf-bundle.js');
    scsfReader = scsfModule.Reader;
} catch (e) {
    // @flufi/scsf not available, scsf support disabled
}

const ajv = require('ajv')();
ajv.addSchema(require('scratch-parser/lib/sb2_definitions.json'));
const sb3Definitions = require('scratch-parser/lib/sb3_definitions.json');
const sb3ListDefinition = sb3Definitions.definitions && sb3Definitions.definitions.list;
if (sb3ListDefinition && Array.isArray(sb3ListDefinition.items) && sb3ListDefinition.items[1]) {
    delete sb3ListDefinition.items[1].items;
}
ajv.addSchema(sb3Definitions);

const validateSb3 = ajv.compile(require('scratch-parser/lib/sb3_schema.json'));
const validateSprite3 = ajv.compile(require('scratch-parser/lib/sprite3_schema.json'));
const validateSb2 = ajv.compile(require('scratch-parser/lib/sb2_schema.json'));
const validateSprite2 = ajv.compile(require('scratch-parser/lib/sprite2_schema.json'));

const validateOnce = function (isSprite, input, callback) {
    const validate3 = isSprite ? validateSprite3 : validateSb3;
    if (validate3(input)) {
        input.projectVersion = 3;
        return callback(null, input);
    }

    const validate2 = isSprite ? validateSprite2 : validateSb2;
    if (validate2(input)) {
        input.projectVersion = 2;
        return callback(null, input);
    }

    callback({
        validationError: 'Could not parse as a valid SB2 or SB3 project.',
        sb3Errors: validate3.errors,
        sb2Errors: validate2.errors
    });
};

const validateWithFix = function (isSprite, input, callback) {
    validateOnce(isSprite, input, (err, result) => {
        if (!err) {
            callback(null, result);
            return;
        }

        try {
            // eslint-disable-next-line global-require
            const sb3fix = require('@turbowarp/sb3fix');
            const fixed = sb3fix.fixJSON(input);
            validateOnce(isSprite, fixed, (err2, result2) => {
                if (err2) {
                    callback(err);
                } else {
                    callback(null, result2);
                }
            });
        } catch (sb3fixError) {
            callback(err);
        }
    });
};

const tryConvertScsf = function (content) {
    if (!scsfReader) return content;
    try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
            const reader = new scsfReader();
            const project = reader.readProject(parsed);
            const json = project.outputJson();
            json.projectVersion = 3;
            return JSON.stringify(json);
        }
    } catch (e) {
        // not scsf, proceed with normal parsing
    }
    return content;
};

module.exports = function (input, isSprite, callback) {
    unpack(input, isSprite, (unpackError, unpackedProject) => {
        if (unpackError) {
            callback(unpackError);
            return;
        }
        const projectContent = tryConvertScsf(unpackedProject[0]);
        parse(projectContent, (parseError, parsedProject) => {
            if (parseError) {
                callback(parseError);
                return;
            }
            validateWithFix(isSprite, parsedProject, (validationError, validatedProject) => {
                if (validationError) {
                    callback(validationError);
                    return;
                }
                callback(null, [validatedProject, unpackedProject[1]]);
            });
        });
    });
};
