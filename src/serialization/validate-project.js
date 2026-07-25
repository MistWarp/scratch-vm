const JSZip = require('@turbowarp/jszip');
const log = require('../util/log');
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

const parseProject = function (input, callback) {
    const hasBackspaceEscape = typeof input === 'string' &&
        (input.indexOf('\\b') !== -1 || input.indexOf('\\u0008') !== -1);
    if (typeof input === 'string' && !hasBackspaceEscape) {
        try {
            return callback(null, JSON.parse(input));
        } catch (e) {
            // Fall through for non-standard JSON supported by scratch-parser.
        }
    }
    return parse(input, callback);
};

const tryConvertScsf = function (content) {
    if (!scsfReader) return content;
    // scsf projects are a JSON array; sb2/sb3 are objects. Sniff the first
    // non-whitespace character so we don't parse the whole project twice.
    if (typeof content === 'string') {
        let i = 0;
        while (i < content.length && content.charCodeAt(i) <= 32) i++;
        if (content[i] !== '[') return content;
    }
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

const PROJECT_JSON_RE = /^([^/]*\/)?project\.json$/;
const SPRITE_JSON_RE = /^([^/]*\/)?sprite\.json$/;
const SCSF_JSON_RE = /^([^/]*\/)?scsf\.json$/;

/**
 * Is this a zip (sb3/sprite3), by its first two bytes?
 * @param {*} input Project data.
 * @returns {boolean} True if it starts with the zip signature.
 */
const looksLikeZip = function (input) {
    if (typeof input === 'string') return false;
    let bytes = null;
    if (input instanceof ArrayBuffer) {
        bytes = new Uint8Array(input, 0, Math.min(2, input.byteLength));
    } else if (ArrayBuffer.isView(input)) {
        bytes = new Uint8Array(input.buffer, input.byteOffset, Math.min(2, input.byteLength));
    }
    // 'PK'
    return !!bytes && bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
};

const unpackJson = function (input, isSprite, callback) {
    const bytes = input instanceof ArrayBuffer ?
        new Uint8Array(input) :
        new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    callback(null, [new TextDecoder().decode(bytes), null]);
};

/**
 * JSZip's compression id for a deflated entry.
 * @const {string}
 */
const DEFLATE_MAGIC = '\x08\x00';

/**
 * Read a zip entry as text, using JSZip's own inflate and UTF-8 decode.
 * @param {object} entry A JSZip entry.
 * @returns {Promise<string>} The entry's text.
 */
const readEntryTextViaJSZip = function (entry) {
    // JSZip's UTF-8 decoder is a hand-written loop in the browser (there is no
    // Buffer to delegate to), and on a multi-megabyte project.json it costs far
    // more than the inflate does. TextDecoder is the platform's, and is not.
    return entry.async('uint8array')
        .then(bytes => new TextDecoder().decode(bytes));
};

/**
 * Read a zip entry as text, letting the platform inflate it if it can. JSZip
 * inflates in JavaScript; DecompressionStream does it natively, several times
 * faster. Falls back to JSZip for anything unexpected.
 * @param {object} entry A JSZip entry.
 * @param {Function} onProgress Called with the bytes unzipped so far.
 * @returns {Promise<string>} The entry's text.
 */
const readEntryText = function (entry, onProgress) {
    const data = entry._data;
    const canGoNative = typeof DecompressionStream !== 'undefined' &&
        typeof Blob !== 'undefined' &&
        typeof Response !== 'undefined' &&
        typeof TransformStream !== 'undefined' &&
        data && data.compressedContent &&
        data.compression && data.compression.magic === DEFLATE_MAGIC;
    if (!canGoNative) {
        // Worth knowing about: JSZip's own inflate and UTF-8 decode are several
        // times slower, and on a large project that is seconds.
        log.warn('Unzipping the project the slow way; the native path was unavailable.');
        return readEntryTextViaJSZip(entry);
    }
    const total = data.uncompressedSize || 0;
    const compressedTotal = data.compressedSize || data.compressedContent.byteLength || 0;
    let compressedLoaded = 0;
    let lastProgress = -1;
    try {
        // Count compressed input instead of routing the much larger output
        // through another transform just to update the loading screen.
        const counter = new TransformStream({
            transform (chunk, controller) {
                compressedLoaded += chunk.byteLength;
                const loaded = total && compressedTotal ?
                    Math.round((compressedLoaded / compressedTotal) * total) : compressedLoaded;
                const progress = Math.floor(total ? (loaded / total) * 100 : loaded / (1024 * 1024));
                if (progress !== lastProgress) {
                    lastProgress = progress;
                    onProgress(loaded, total || compressedTotal);
                }
                controller.enqueue(chunk);
            }
        });
        const inflated = new Blob([data.compressedContent]).stream()
            .pipeThrough(counter)
            .pipeThrough(new DecompressionStream('deflate-raw'));
        // Collect the bytes and decode them in one go, rather than letting
        // Response.text() stitch the string together chunk by chunk. On a
        // 175MB project.json that is about a second.
        return new Response(inflated).arrayBuffer()
            .then(buffer => new TextDecoder().decode(buffer))
            .catch(() => readEntryTextViaJSZip(entry));
    } catch (e) {
        return readEntryTextViaJSZip(entry);
    }
};

/**
 * Pull the json out of an sb3 ourselves rather than through scratch-parser,
 * which goes through JSZip's slow inflate and UTF-8 decode.
 * @param {*} input Zipped project data.
 * @param {boolean} isSprite Whether this is a sprite rather than a project.
 * @param {Function} callback Called with (error, [json, zip]).
 * @returns {void}
 */
const unzipProject = function (input, isSprite, callback, onProgress) {
    JSZip.loadAsync(input)
        .then(zip => {
            const entry = (!isSprite && zip.file(SCSF_JSON_RE)[0]) ||
                zip.file(isSprite ? SPRITE_JSON_RE : PROJECT_JSON_RE)[0];
            if (!entry) {
                return Promise.reject(new Error('missing project or sprite json'));
            }
            return readEntryText(entry, (loaded, total) => {
                onProgress('unzipping', loaded, total);
            }).then(text => {
                callback(null, [text, zip]);
            });
        })
        .catch(error => {
            callback(`Failed to unzip and extract project.json, with error: ${error}`);
        });
};

/**
 * @param {*} input Project data.
 * @param {boolean} isSprite Whether to treat the input as a sprite.
 * @param {Function} callback Called with (error, [project, zip]).
 * @param {Function=} optOnProgress Called with (stage, loaded, total) as the
 *     project is unzipped, parsed and validated, for the loading screen.
 * @returns {void}
 */
module.exports = function (input, isSprite, callback, optOnProgress) {
    const onProgress = optOnProgress || function () {};
    const canDecode = typeof TextDecoder !== 'undefined' &&
        (input instanceof ArrayBuffer || ArrayBuffer.isView(input));
    const unpackProject = canDecode ? (looksLikeZip(input) ? unzipProject : unpackJson) : unpack;
    // unpack (scratch-parser) ignores the extra argument; unzipProject uses it.
    unpackProject(input, isSprite, (unpackError, unpackedProject) => {
        if (unpackError) {
            callback(unpackError);
            return;
        }
        const projectContent = tryConvertScsf(unpackedProject[0]);
        const size = typeof projectContent === 'string' ? projectContent.length : 0;
        onProgress('parsing', 0, size);
        // Let the browser paint the new loading stage before JSON.parse blocks
        // the main thread on large projects.
        setTimeout(() => {
            parseProject(projectContent, (parseError, parsedProject) => {
                if (parseError) {
                    callback(parseError);
                    return;
                }
                onProgress('checking', 0, size);
                validateWithFix(isSprite, parsedProject, (validationError, validatedProject) => {
                    if (validationError) {
                        callback(validationError);
                        return;
                    }
                    callback(null, [validatedProject, unpackedProject[1]]);
                });
            });
        }, 0);
    }, onProgress);
};
