const JSZip = require('@turbowarp/jszip');
const log = require('../util/log');
const unpack = require('scratch-parser/lib/unpack');
const parse = require('scratch-parser/lib/parse');
// Loaded only for scsf projects.
let scsfReader;
const getScsfReader = () => {
    if (typeof scsfReader === 'undefined') {
        try {
            scsfReader = require('../scsf-bundle.js').Reader;
        } catch (e) {
            scsfReader = null; // @flufi/scsf not available, scsf support disabled
        }
    }
    return scsfReader;
};

// Building the schema validators with ajv is a large part of loading a project, so they are precompiled by
// tools/generate-validators.js, and each is only loaded when first used (an sb3 project needs just the sb3 one). If a
// precompiled validator is missing, it is built at runtime instead.
const {SCHEMAS, prepareAjv} = require('./validator-schemas');

let ajv = null;
const lazyValidator = name => {
    let validate = null;
    const run = input => {
        if (!validate) {
            try {
                validate = require(`./validators/${name}.generated.js`);
            } catch (e) {
                ajv = ajv || require('ajv')({meta: false, validateSchema: false});
                validate = prepareAjv(ajv, SCHEMAS[name].sb2).compile(SCHEMAS[name].schema());
            }
        }
        const valid = validate(input);
        run.errors = validate.errors;
        return valid;
    };
    return run;
};

const validateSb3 = lazyValidator('sb3');
const validateSprite3 = lazyValidator('sprite3');
const validateSb2 = lazyValidator('sb2');
const validateSprite2 = lazyValidator('sprite2');

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
    // scsf projects are a JSON array; sb2/sb3 are objects. Sniff the first
    // non-whitespace character so we don't parse the whole project twice.
    if (typeof content === 'string') {
        let i = 0;
        while (i < content.length && content.charCodeAt(i) <= 32) i++;
        if (content[i] !== '[') return content;
    }
    try {
        const parsed = JSON.parse(content);
        const Reader = Array.isArray(parsed) && getScsfReader();
        if (Reader) {
            const reader = new Reader();
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

// Reads a stream into one buffer. (Response would do it, but loads all of Node's fetch implementation.)
const readAll = async (stream, size) => {
    const reader = stream.getReader();
    let buffer = new Uint8Array(size || 65536);
    let length = 0;
    for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        if (length + value.length > buffer.length) {
            const bigger = new Uint8Array(Math.max(buffer.length * 2, length + value.length));
            bigger.set(buffer.subarray(0, length));
            buffer = bigger;
        }
        buffer.set(value, length);
        length += value.length;
    }
    return buffer.subarray(0, length);
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
        // Decode in one go: stitching the string chunk by chunk costs about a second on a 175MB project.json.
        return readAll(inflated, total)
            .then(bytes => new TextDecoder().decode(bytes))
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
