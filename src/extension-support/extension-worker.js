/* eslint-env worker */

const ScratchCommon = require('./tw-extension-api-common');
const createScratchX = require('./tw-scratchx-compatibility-layer');
const dispatch = require('../dispatch/worker-dispatch');
const log = require('../util/log');
const {isWorker} = require('./tw-extension-worker-context');
const createTranslate = require('./tw-l10n');

const translate = createTranslate(null);

const loadScripts = url => {
    if (isWorker) {
        importScripts(url);
    } else {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.onload = () => resolve();
            script.onerror = () => {
                reject(new Error(`Error in sandboxed script: ${url}. Check the console for more information.`));
            };
            script.src = url;
            document.body.appendChild(script);
        });
    }
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
                    onError = event => reject(new Error(event.message || `Extension failed to start: ${extension}`));
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
                    await dispatch.call('extensions', 'onWorkerInit', id, `${e}`);
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
