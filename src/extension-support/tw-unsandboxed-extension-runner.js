const ScratchCommon = require('./tw-extension-api-common');
const AsyncLimiter = require('../util/async-limiter');
const createTranslate = require('./tw-l10n');
const staticFetch = require('../util/tw-static-fetch');

/* eslint-disable require-await */

/**
 * Parse a URL object or return null.
 * @param {string} url
 * @returns {URL|null}
 */
const parseURL = url => {
    try {
        return new URL(url, location.href);
    } catch (e) {
        return null;
    }
};

/**
 * Sets up the global.Scratch API for an unsandboxed extension.
 * @param {VirtualMachine} vm
 * @returns {Promise<object[]>} Resolves with a list of extension objects when Scratch.extensions.register is called.
 */
const setupUnsandboxedExtensionAPI = vm => new Promise(resolve => {
    const extensionObjects = [];
    const register = extensionObject => {
        extensionObjects.push(extensionObject);
        resolve(extensionObjects);
    };

    // Create a new copy of global.Scratch for each extension
    const Scratch = Object.assign({}, global.Scratch || {}, ScratchCommon);
    Scratch.extensions = {
        unsandboxed: true,
        register
    };
    Scratch.vm = vm;
    Scratch.renderer = vm.runtime.renderer;

    Scratch.canFetch = async url => {
        const parsed = parseURL(url);
        if (!parsed) {
            return false;
        }
        // Always allow protocols that don't involve a remote request.
        if (parsed.protocol === 'blob:' || parsed.protocol === 'data:') {
            return true;
        }
        return vm.securityManager.canFetch(parsed.href);
    };

    Scratch.canOpenWindow = async url => {
        const parsed = parseURL(url);
        if (!parsed) {
            return false;
        }
        // Always reject protocols that would allow code execution.
        // eslint-disable-next-line no-script-url
        if (parsed.protocol === 'javascript:') {
            return false;
        }
        return vm.securityManager.canOpenWindow(parsed.href);
    };

    Scratch.canRedirect = async url => {
        const parsed = parseURL(url);
        if (!parsed) {
            return false;
        }
        // Always reject protocols that would allow code execution.
        // eslint-disable-next-line no-script-url
        if (parsed.protocol === 'javascript:') {
            return false;
        }
        return vm.securityManager.canRedirect(parsed.href);
    };

    Scratch.canRecordAudio = async () => vm.securityManager.canRecordAudio();

    Scratch.canRecordVideo = async () => vm.securityManager.canRecordVideo();

    Scratch.canReadClipboard = async () => vm.securityManager.canReadClipboard();

    Scratch.canNotify = async () => vm.securityManager.canNotify();

    Scratch.canGeolocate = async () => vm.securityManager.canGeolocate();

    Scratch.canEmbed = async url => {
        const parsed = parseURL(url);
        if (!parsed) {
            return false;
        }
        return vm.securityManager.canEmbed(parsed.href);
    };

    Scratch.canDownload = async (url, name) => {
        const parsed = parseURL(url);
        if (!parsed) {
            return false;
        }
        // Always reject protocols that would allow code execution.
        // eslint-disable-next-line no-script-url
        if (parsed.protocol === 'javascript:') {
            return false;
        }
        return vm.securityManager.canDownload(url, name);
    };

    Scratch.fetch = async (url, options) => {
        const actualURL = url instanceof Request ? url.url : url;

        const staticFetchResult = staticFetch(url);
        if (staticFetchResult) {
            return staticFetchResult;
        }

        if (!await Scratch.canFetch(actualURL)) {
            throw new Error(`Permission to fetch ${actualURL} rejected.`);
        }
        return fetch(url, options);
    };

    Scratch.download = async (url, file) => {
        if (!await Scratch.canDownload(url, file)) {
            throw new Error(`Permission to download ${file} rejected.`);
        }

        // Initiate a download in a browser-compatible way.
        const link = document.createElement('a');
        link.href = url;
        link.download = file;
        document.body.appendChild(link);
        link.click();
        if (typeof link.remove === 'function') {
            link.remove();
        } else if (link.parentNode && typeof link.parentNode.removeChild === 'function') {
            link.parentNode.removeChild(link);
        }
    };

    Scratch.openWindow = async (url, features) => {
        if (!await Scratch.canOpenWindow(url)) {
            throw new Error(`Permission to open tab ${url} rejected.`);
        }
        // Use noreferrer to prevent new tab from accessing `window.opener`
        const baseFeatures = 'noreferrer';
        features = features ? `${baseFeatures},${features}` : baseFeatures;
        return window.open(url, '_blank', features);
    };

    Scratch.redirect = async url => {
        if (!await Scratch.canRedirect(url)) {
            throw new Error(`Permission to redirect to ${url} rejected.`);
        }
        location.href = url;
    };

    Scratch.translate = createTranslate(vm);

    // Allow VM users to extend the API surface for unsandboxed extensions.
    // This is used by tests and by embedding environments.
    if (vm && typeof vm.emit === 'function') {
        vm.emit('CREATE_UNSANDBOXED_EXTENSION_API', Scratch);
    }

    // ScratchX compatibility layer: many old unsandboxed extensions expect a
    // global `ScratchExtensions.register(...)` function.
    // Keep this alias in sync with the simplified ScratchX layer used elsewhere.
    global.ScratchExtensions = {
        register: (name, descriptor, extensionObject) => {
            void name;
            void descriptor;
            Scratch.extensions.register(extensionObject);
        }
    };

    // Assign the Scratch object to global so extensions can access it
    global.Scratch = Scratch;
});

/**
 * Disable the existing global.Scratch unsandboxed extension APIs.
 * This helps debug poorly designed extensions.
 */
const teardownUnsandboxedExtensionAPI = () => {
    // Check if global.Scratch exists before trying to access it
    if (global.Scratch && global.Scratch.extensions) {
        global.Scratch.extensions.register = () => {
            throw new Error('Too late to register new extensions.');
        };
    }

    // Remove ScratchX alias between loads to keep global state clean.
    delete global.ScratchExtensions;
};

/**
 * Load an unsandboxed extension from an arbitrary URL. This is dangerous.
 * @param {string} extensionURL
 * @param {Virtualmachine} vm
 * @returns {Promise<object[]>} Resolves with a list of extension objects if the extension was loaded successfully.
 */
const loadUnsandboxedExtension = (extensionURL, vm) => new Promise((resolve, reject) => {
    let isResolved = false;
    let registrationTimeout = null;
    let overallTimeout = null;

    const settle = (fn, arg) => {
        if (isResolved) return;
        isResolved = true;
        clearTimeout(registrationTimeout);
        clearTimeout(overallTimeout);
        fn(arg);
    };

    setupUnsandboxedExtensionAPI(vm)
        .then(extensionObjects => settle(resolve, extensionObjects))
        .catch(error => {
            error.url = extensionURL;
            error.type = 'registration-error';
            settle(reject, error);
        });

    const script = document.createElement('script');

    script.onerror = event => {
        const error = new Error(`Failed to load extension script from ${extensionURL}`);
        error.url = extensionURL;
        error.event = event;
        error.type = 'script-load-error';
        console.error(`Error loading unsandboxed script ${extensionURL}:`, error);
        settle(reject, error);
    };

    // Only start the registration deadline once the script has actually executed. A well-behaved
    // extension calls register() synchronously as it runs, so it has already resolved by now; this
    // grace period only catches scripts that ran but never registered. Arming it before the script
    // executes (e.g. during a slow download) would release the load queue while this script is
    // still pending, letting the next extension's global.Scratch capture this one's late
    // register() call. See tw-unsandboxed-extension-runner registration serialization.
    script.onload = () => {
        if (isResolved) return;
        registrationTimeout = setTimeout(() => {
            const error = new Error(`Extension did not register within timeout period`);
            error.url = extensionURL;
            error.type = 'registration-timeout';
            console.error(`Extension registration timeout for ${extensionURL}:`, error);
            settle(reject, error);
        }, 10000); // 10 second registration deadline, measured from script execution
    };

    // Catch scripts that never load or execute at all.
    overallTimeout = setTimeout(() => {
        const error = new Error(`Overall timeout loading extension script from ${extensionURL}`);
        error.url = extensionURL;
        error.type = 'overall-timeout';
        console.error(`Overall timeout loading unsandboxed script ${extensionURL}`);
        settle(reject, error);
    }, 30000); // 30 second overall timeout

    script.src = extensionURL;
    document.body.appendChild(script);
})
    .then(objects => {
        teardownUnsandboxedExtensionAPI();
        return objects;
    })
    .catch(error => {
        teardownUnsandboxedExtensionAPI();
        throw error;
    });

const prefetchExtensionScript = extensionURL => {
    if (typeof document === 'undefined') {
        return;
    }
    const parsed = parseURL(extensionURL);
    if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
        return;
    }
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'script';
    link.href = extensionURL;
    link.onload = () => link.remove();
    link.onerror = () => link.remove();
    document.head.appendChild(link);
};

// Because loading unsandboxed extensions requires messing with global state (global.Scratch),
// only let one extension register at a time. The script download is started up front (in
// parallel across extensions) so only the registration step is serialized.
const limiter = new AsyncLimiter(loadUnsandboxedExtension, 1);
const load = (extensionURL, vm) => {
    prefetchExtensionScript(extensionURL);
    return limiter.do(extensionURL, vm);
};

module.exports = {
    setupUnsandboxedExtensionAPI,
    load
};
