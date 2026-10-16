/* eslint-env worker */

const ScratchCommon = require('./tw-extension-api-common');
const createScratchX = require('./tw-scratchx-compatibility-layer');
const dispatch = require('../dispatch/worker-dispatch');
const log = require('../util/log');
const {isWorker} = require('./tw-extension-worker-context');
const createTranslate = require('./tw-l10n');
const {CONSOLE_LEVELS, formatConsoleArgs, locateInStack} = require('./tw-console-capture');

const translate = createTranslate(null);

let scriptCounter = 0;
let scriptNames = [];

const readEmbeddedSource = url => {
    if (!url.startsWith('data:') || typeof fetch !== 'function' || typeof Blob !== 'function') {
        return Promise.resolve(null);
    }
    return fetch(url)
        .then(response => response.text())
        .catch(() => null);
};

const appendScript = src => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.onload = () => resolve();
    script.onerror = () => {
        reject(new Error(`Error in sandboxed script: ${src}. Check the console for more information.`));
    };
    script.src = src;
    document.body.appendChild(script);
});

const loadScripts = url => {
    if (isWorker) {
        scriptNames = [url];
        importScripts(url);
        return;
    }
    scriptNames = [url];
    return readEmbeddedSource(url).then(source => {
        if (source === null) return appendScript(url);
        const name = `mistwarp-extension:///sandboxed-${++scriptCounter}.js`;
        const blobURL = URL.createObjectURL(new Blob([`${source}\n//# sourceURL=${name}`], {
            type: 'text/javascript'
        }));
        scriptNames = [blobURL, name];
        return appendScript(blobURL).finally(() => URL.revokeObjectURL(blobURL));
    });
};

class ExtensionWorker {
    constructor () {
        this.nextExtensionId = 0;

        this.initialRegistrations = [];

        this.firstRegistrationPromise = new Promise(resolve => {
            this.firstRegistrationCallback = resolve;
        });

        dispatch.waitForConnection.then(() => {
            dispatch.call('extensions', 'allocateWorker').then(async x => {
                const [id, extension] = x;
                this.workerId = id;

                let timer;
                let onError;
                const failed = new Promise((resolve, reject) => {
                    timer = setTimeout(() => reject(new Error(
                        `Extension did not finish registering within 30 seconds: ${extension}`
                    )), 30000);
                    onError = event => {
                        const error = new Error(event.message || `Extension failed to start: ${extension}`);
                        if (scriptNames.includes(event.filename)) {
                            error.line = event.lineno || null;
                            error.column = event.colno || null;
                        }
                        reject(error);
                    };
                    if (typeof self.addEventListener === 'function') self.addEventListener('error', onError);
                });
                try {
                    await Promise.race([loadScripts(extension), failed]);
                    await Promise.race([this.firstRegistrationPromise, failed]);

                    const initialRegistrations = this.initialRegistrations;
                    this.initialRegistrations = null;

                    await Promise.race([Promise.all(initialRegistrations), failed]);
                    await dispatch.call('extensions', 'onWorkerInit', id);
                } catch (e) {
                    log.error(e);
                    this.failed = true;
                    const location = e && e.line ? {line: e.line, column: e.column} : null;
                    await dispatch.call('extensions', 'onWorkerInit', id, `${e}`, location);
                } finally {
                    clearTimeout(timer);
                    if (typeof self.removeEventListener === 'function') self.removeEventListener('error', onError);
                }
            });
        });

        this.extensions = [];
    }

    register (extensionObject) {
        if (this.failed) return Promise.reject(new Error('Extension initialization has already failed.'));
        const extensionId = this.nextExtensionId++;
        this.extensions.push(extensionObject);
        const serviceName = `extension.${this.workerId}.${extensionId}`;
        const promise = dispatch.setService(serviceName, extensionObject)
            .then(() => dispatch.call('extensions', 'registerExtensionService', serviceName));
        if (this.initialRegistrations) {
            this.firstRegistrationCallback();
            this.initialRegistrations.push(promise);
        }
        return promise;
    }
}

let forwardingConsole = false;

const forwardConsoleLevel = (level, original) => function (...args) {
    original.apply(console, args);
    if (forwardingConsole) return;
    forwardingConsole = true;
    try {
        const location = locateInStack(new Error().stack, scriptNames);
        if (location) {
            dispatch.call('extensions', 'reportConsole', level, formatConsoleArgs(args),
                location.line, location.column).catch(() => {});
        }
    } finally {
        forwardingConsole = false;
    }
};

const forwardConsole = () => {
    if (typeof console === 'undefined') return;
    for (const level of CONSOLE_LEVELS) {
        if (typeof console[level] === 'function') console[level] = forwardConsoleLevel(level, console[level]);
    }
};

forwardConsole();

global.Scratch = global.Scratch || {};
Object.assign(global.Scratch, ScratchCommon, {
    canFetch: () => Promise.resolve(true),
    fetch: (url, options) => fetch(url, options),
    download: () => Promise.reject(new Error('Scratch.download not supported in sandboxed extensions')),
    canOpenWindow: () => Promise.resolve(false),
    openWindow: () => Promise.reject(new Error('Scratch.openWindow not supported in sandboxed extensions')),
    canRedirect: () => Promise.resolve(false),
    redirect: () => Promise.reject(new Error('Scratch.redirect not supported in sandboxed extensions')),
    canRecordAudio: () => Promise.resolve(false),
    canRecordVideo: () => Promise.resolve(false),
    canReadClipboard: () => Promise.resolve(false),
    canNotify: () => Promise.resolve(false),
    canGeolocate: () => Promise.resolve(false),
    canEmbed: () => Promise.resolve(false),
    canDownload: () => Promise.resolve(false),
    translate
});

/**
 * Expose only specific parts of the worker to extensions.
 */
const extensionWorker = new ExtensionWorker();
global.Scratch.extensions = {
    isMistWarp: true,
    register: extensionWorker.register.bind(extensionWorker)
};

global.ScratchExtensions = createScratchX(global.Scratch);
