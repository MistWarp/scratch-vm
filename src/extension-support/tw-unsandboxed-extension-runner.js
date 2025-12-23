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
    
    // Add timeout to setupUnsandboxedExtensionAPI to catch scripts that load but don't register
    const setupWithTimeout = () => new Promise((setupResolve, setupReject) => {
        const setupTimeout = setTimeout(() => {
            setupReject(new Error(`Extension did not register within timeout period`));
        }, 10000); // 10 second timeout for extension registration
        
        setupUnsandboxedExtensionAPI(vm).then(extensionObjects => {
            clearTimeout(setupTimeout);
            setupResolve(extensionObjects);
        })
            .catch(setupReject);
    });
    
    setupWithTimeout()
        .then(extensionObjects => {
            if (!isResolved) {
                isResolved = true;
                resolve(extensionObjects);
            }
        })
        .catch(error => {
            if (!isResolved) {
                isResolved = true;
                error.url = extensionURL;
                error.type = 'registration-timeout';
                console.error(`Extension registration timeout for ${extensionURL}:`, error);
                reject(error);
            }
        });

    const script = document.createElement('script');
    
    // Enhanced error handling
    script.onerror = event => {
        if (!isResolved) {
            isResolved = true;
            const error = new Error(`Failed to load extension script from ${extensionURL}`);
            error.url = extensionURL;
            error.event = event;
            error.type = 'script-load-error';
            console.error(`Error loading unsandboxed script ${extensionURL}:`, error);
            reject(error);
        }
    };
    
    // Handle load success but potential runtime errors
    script.onload = () => {
        console.log(`Successfully loaded extension script from ${extensionURL}`);
    };
    
    // Add overall timeout to catch hanging scripts
    const overallTimeout = setTimeout(() => {
        if (!isResolved) {
            isResolved = true;
            const error = new Error(`Overall timeout loading extension script from ${extensionURL}`);
            error.url = extensionURL;
            error.type = 'overall-timeout';
            console.error(`Overall timeout loading unsandboxed script ${extensionURL}`);
            reject(error);
        }
    }, 30000); // 30 second overall timeout
    
    // Clear timeout if promise resolves
    const originalResolve = resolve;
    resolve = (...args) => {
        clearTimeout(overallTimeout);
        return originalResolve(...args);
    };
    
    const originalReject = reject;
    reject = (...args) => {
        clearTimeout(overallTimeout);
        return originalReject(...args);
    };
    
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

// Because loading unsandboxed extensions requires messing with global state (global.Scratch),
// only let one extension load at a time.
const limiter = new AsyncLimiter(loadUnsandboxedExtension, 1);
const load = (extensionURL, vm) => limiter.do(extensionURL, vm);

module.exports = {
    setupUnsandboxedExtensionAPI,
    load
};
