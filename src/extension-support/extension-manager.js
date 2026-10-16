const dispatch = require('../dispatch/central-dispatch');
const log = require('../util/log');
const maybeFormatMessage = require('../util/maybe-format-message');

const BlockType = require('./block-type');
const SecurityManager = require('./tw-security-manager');
const {CONSOLE_LEVELS, MAX_CONSOLE_TEXT, formatConsoleArgs, locateInStack} = require('./tw-console-capture');

// These extensions are currently built into the VM repository but should not be loaded at startup.
// TODO: move these out into a separate repository?
// TODO: change extension spec so that library info, including extension ID, can be collected through static methods

const defaultBuiltinExtensions = {
    // This is an example that isn't loaded with the other core blocks,
    // but serves as a reference for loading core blocks as extensions.
    coreExample: () => require('../blocks/scratch3_core_example'),
    // These are the non-core built-in extensions.
    pen: () => require('../extensions/scratch3_pen'),
    wedo2: () => require('../extensions/scratch3_wedo2'),
    music: () => require('../extensions/scratch3_music'),
    microbit: () => require('../extensions/scratch3_microbit'),
    text2speech: () => require('../extensions/scratch3_text2speech'),
    translate: () => require('../extensions/scratch3_translate'),
    videoSensing: () => require('../extensions/scratch3_video_sensing'),
    ev3: () => require('../extensions/scratch3_ev3'),
    makeymakey: () => require('../extensions/scratch3_makeymakey'),
    boost: () => require('../extensions/scratch3_boost'),
    gdxfor: () => require('../extensions/scratch3_gdx_for'),
    patching: () => require('../extensions/mistwarp_patching'),
    rotur: () => require('../extensions/rotur').RoturAccount,
    roturEconomy: () => require('../extensions/rotur').RoturEconomy,
    roturKeys: () => require('../extensions/rotur').RoturKeys,
    roturStatus: () => require('../extensions/rotur').RoturStatus,
    roturSocial: () => require('../extensions/rotur').RoturSocial,
    roturShop: () => require('../extensions/rotur').RoturShop,
    roturGroups: () => require('../extensions/rotur').RoturGroups,
    roturFiles: () => require('../extensions/rotur').RoturFiles,
    mistwarpPlayers: () => require('../extensions/mistwarp_games').MistWarpPlayers,
    mistwarpMultiplayer: () => require('../extensions/mistwarp_games').MistWarpMultiplayer,
    mistwarpData: () => require('../extensions/mistwarp_games').MistWarpData,
    mistwarpMarketplace: () => require('../extensions/mistwarp_games').MistWarpMarketplace,
    mistwarpInventory: () => require('../extensions/mistwarp_games').MistWarpInventory,
    // tw: core extension
    tw: () => require('../extensions/tw')
};

const coreExtensions = [
    'motion',
    'looks',
    'sound',
    'events',
    'control',
    'sensing',
    'operators',
    'data',
    'procedures',
    'assets'
];

/**
 * @typedef {object} ArgumentInfo - Information about an extension block argument
 * @property {ArgumentType} type - the type of value this argument can take
 * @property {*|undefined} default - the default value of this argument (default: blank)
 */

/**
 * @typedef {object} ConvertedBlockInfo - Raw extension block data paired with processed data ready for scratch-blocks
 * @property {ExtensionBlockMetadata} info - the raw block info
 * @property {object} json - the scratch-blocks JSON definition for this block
 * @property {string} xml - the scratch-blocks XML definition for this block
 */

/**
 * @typedef {object} CategoryInfo - Information about a block category
 * @property {string} id - the unique ID of this category
 * @property {string} name - the human-readable name of this category
 * @property {string|undefined} blockIconURI - optional URI for the block icon image
 * @property {string} color1 - the primary color for this category, in '#rrggbb' format
 * @property {string} color2 - the secondary color for this category, in '#rrggbb' format
 * @property {string} color3 - the tertiary color for this category, in '#rrggbb' format
 * @property {Array.<ConvertedBlockInfo>} blocks - the blocks, separators, etc. in this category
 * @property {Array.<object>} menus - the menus provided by this category
 */

/**
 * @typedef {object} PendingExtensionWorker - Information about an extension worker still initializing
 * @property {string} extensionURL - the URL of the extension to be loaded by this worker
 * @property {Function} resolve - function to call on successful worker startup
 * @property {Function} reject - function to call on failed worker startup
 */

const ERROR_THROTTLE_MS = 250;

const toDataURL = source => `data:application/javascript,${encodeURIComponent(source)}`;

const workerIdOf = serviceName => +serviceName.split('.')[1];

const errorMessage = error => (error && typeof error.message === 'string' ? error.message : String(error));

const withoutFunctions = (key, value) => (typeof value === 'function' ? null : value);

const snapshotInfo = info => {
    try {
        return JSON.parse(JSON.stringify(info, withoutFunctions));
    } catch (e) {
        return null;
    }
};

const opcodeMetadata = snapshot => {
    const result = new Map();
    const blocks = snapshot && Array.isArray(snapshot.blocks) ? snapshot.blocks : [];
    for (const block of blocks) {
        if (
            block && typeof block === 'object' && block.opcode &&
            block.blockType !== BlockType.BUTTON &&
            block.blockType !== BlockType.LABEL &&
            block.blockType !== BlockType.XML
        ) {
            result.set(block.opcode, JSON.stringify(block));
        }
    }
    return result;
};

const diagnosticError = (kind, error, location = {}) => {
    const message = errorMessage(error);
    const result = new Error(message);
    result.diagnostics = [{
        severity: 'error',
        kind,
        message,
        line: (location && location.line) || null,
        column: (location && location.column) || null
    }];
    return result;
};

const UNKNOWN_LOAD_ERROR = Object.freeze({message: 'The extension failed to load.', line: null, column: null});

const runnerErrorKind = error => {
    if (error && error.type === 'syntax-error') return 'syntax';
    if (error && error.type === 'registration-timeout') return 'register';
    return 'load';
};

const consoleManagers = new Set();
let consoleCaptureInstalled = false;
let consoleCaptureBusy = false;

const captureConsoleLevel = (level, original) => function (...args) {
    original.apply(console, args);
    if (consoleCaptureBusy) return;
    consoleCaptureBusy = true;
    try {
        const stack = new Error().stack;
        for (const each of consoleManagers) each._captureConsole(level, args, stack);
    } finally {
        consoleCaptureBusy = false;
    }
};

const installConsoleCapture = manager => {
    consoleManagers.add(manager);
    if (consoleCaptureInstalled || typeof console === 'undefined') return;
    consoleCaptureInstalled = true;
    for (const level of CONSOLE_LEVELS) {
        if (typeof console[level] === 'function') console[level] = captureConsoleLevel(level, console[level]);
    }
};

const createExtensionService = extensionManager => {
    const service = {};
    service.registerExtensionServiceSync = extensionManager.registerExtensionServiceSync.bind(extensionManager);
    service.allocateWorker = extensionManager.allocateWorker.bind(extensionManager);
    service.onWorkerInit = extensionManager.onWorkerInit.bind(extensionManager);
    service.registerExtensionService = extensionManager.registerExtensionService.bind(extensionManager);
    return service;
};

class ExtensionManager {
    constructor (vm) {
        /**
         * The ID number to provide to the next extension worker.
         * @type {int}
         */
        this.nextExtensionWorker = 0;

        /**
         * FIFO queue of extensions which have been requested but not yet loaded in a worker,
         * along with promise resolution functions to call once the worker is ready or failed.
         *
         * @type {Array.<PendingExtensionWorker>}
         */
        this.pendingExtensions = [];

        /**
         * Map of worker ID to workers which have been allocated but have not yet finished initialization.
         * @type {Array.<PendingExtensionWorker>}
         */
        this.pendingWorkers = [];

        /**
         * Map of worker ID to the URL where it was loaded from.
         * @type {Array<string>}
         */
        this.workerURLs = [];

        /**
         * Map of loaded extension URLs/IDs (equivalent for built-in extensions) to service name.
         * @type {Map.<string,string>}
         * @private
         */
        this._loadedExtensions = new Map();

        this._unloadedExtensionURLs = new Map();

        this._unloadedExtensionDetails = new Map();

        this._holders = new Map();

        this._workers = [];

        this._workerModes = [];

        this._workerScripts = [];

        this._runningSources = [];

        this._workerLoadedURLs = [];

        this._urlModes = new Map();

        this._belongingExtensions = new Set();

        this._extensionMetadata = new Map();

        this._errorThrottle = new Map();

        this._reloadSequence = new Map();

        this._reloadCounter = 0;

        this._unsandboxedAllowances = new Map();

        /**
         * Responsible for determining security policies related to custom extensions.
         */
        this.securityManager = new SecurityManager();

        /**
         * @type {VirtualMachine}
         */
        this.vm = vm;

        /**
         * Keep a reference to the runtime so we can construct internal extension objects.
         * TODO: remove this in favor of extensions accessing the runtime as a service.
         * @type {Runtime}
         */
        this.runtime = vm.runtime;

        this.loadingAsyncExtensions = 0;
        this.asyncExtensionsLoadedCallbacks = [];

        this.builtinExtensions = Object.assign({}, defaultBuiltinExtensions);
        this.coreExtensions = coreExtensions;

        dispatch.setService('extensions', createExtensionService(this)).catch(e => {
            log.error(`ExtensionManager was unable to register extension service: ${JSON.stringify(e)}`);
        });
    }

    /**
     * Check whether an extension is registered or is in the process of loading. This is intended to control loading or
     * adding extensions so it may return `true` before the extension is ready to be used. Use the promise returned by
     * `loadExtensionURL` if you need to wait until the extension is truly ready.
     * @param {string} extensionID - the ID of the extension.
     * @returns {boolean} - true if loaded, false otherwise.
     */
    isExtensionLoaded (extensionID) {
        return this._loadedExtensions.has(extensionID);
    }

    /**
     * Determine whether an extension with a given ID is built in to the VM, such as pen.
     * Note that "core extensions" like motion will return false here.
     * @param {string} extensionId
     * @returns {boolean}
     */
    isBuiltinExtension (extensionId) {
        return Object.prototype.hasOwnProperty.call(this.builtinExtensions, extensionId);
    }

    /**
     * Determine whether an extension with a given ID is registered as a core extension in the VM, such as motion.
     * Note that custom extensions or extensions that don't load on startup will return false here.
     * @param {string} extensionId
     * @returns {boolean}
     */
    isCoreExtension (extensionId) {
        return this.coreExtensions.includes(extensionId);
    }

    /**
     * Synchronously load an internal extension (core or non-core) by ID. This call will
     * fail if the provided id is not does not match an internal extension.
     * @param {string} extensionId - the ID of an internal extension
     */
    loadExtensionIdSync (extensionId) {
        if (!this.isBuiltinExtension(extensionId)) {
            log.warn(`Could not find extension ${extensionId} in the built in extensions.`);
            return;
        }

        /** @TODO dupe handling for non-builtin extensions. See commit 670e51d33580e8a2e852b3b038bb3afc282f81b9 */
        if (this.isExtensionLoaded(extensionId)) {
            const message = `Rejecting attempt to load a second extension with ID ${extensionId}`;
            log.warn(message);
            return;
        }

        const extension = this.builtinExtensions[extensionId]();
        const extensionInstance = new extension(this.runtime);
        const serviceName = this._registerInternalExtension(extensionInstance);
        this._loadedExtensions.set(extensionId, serviceName);
    }

    addBuiltinExtension (extensionId, extensionClass) {
        this.builtinExtensions[extensionId] = () => extensionClass;
    }

    _resolveExtensionURL (extensionURL) {
        try {
            new URL(extensionURL); // eslint-disable-line no-new
            return extensionURL;
        } catch (e) {
            try {
                return new URL(extensionURL, location.href).toString();
            } catch (e2) {
                return extensionURL;
            }
        }
    }

    _isValidExtensionURL (extensionURL) {
        try {
            const parsedURL = new URL(extensionURL);
            return (
                parsedURL.protocol === 'https:' ||
                parsedURL.protocol === 'http:' ||
                parsedURL.protocol === 'data:' ||
                parsedURL.protocol === 'file:'
            );
        } catch (e) {
            return false;
        }
    }

    /**
     * Load an extension by URL or internal extension ID
     * @param {string} extensionURL - the URL for the extension to load OR the ID of an internal extension
     * @param {string} [extensionId] - the ID the project expects this URL to register, for error reports
     * @returns {Promise} resolved once the extension is loaded and initialized or rejected on failure
     */
    async loadExtensionURL (extensionURL, extensionId) {
        try {
            return await this._loadExtensionURL(extensionURL);
        } catch (error) {
            this.reportExtensionError({
                extensionId: (error && error.extensionId) || extensionId || extensionURL,
                kind: error && error.kind === 'getInfo' ? 'getInfo' : 'load',
                error,
                line: error && error.line,
                column: error && error.column
            });
            throw error;
        }
    }

    async _loadExtensionURL (extensionURL) {
        if (this.isBuiltinExtension(extensionURL)) {
            this.loadExtensionIdSync(extensionURL);
            return;
        }

        if (this.isExtensionURLLoaded(extensionURL) || this.isCoreExtension(extensionURL)) {
            // Extension is already loaded or is a core extension.
            return;
        }

        const sandboxMode = await this.securityManager.getSandboxMode(extensionURL);
        this._urlModes.set(extensionURL, sandboxMode);
        const rewritten = this._resolveExtensionURL(await this.securityManager.rewriteExtensionURL(extensionURL));

        // A host may map a stable project-local extension reference to a URL that it
        // controls. Validate the URL that will actually be loaded, not the reference
        // stored in the project.
        if (!this._isValidExtensionURL(rewritten)) {
            throw new Error(`Invalid extension URL: ${extensionURL}`);
        }

        this.runtime.setExternalCommunicationMethod('customExtensions', true);

        this.loadingAsyncExtensions++;

        if (sandboxMode === 'unsandboxed') {
            const {load} = require('./tw-unsandboxed-extension-runner');
            let extensionObjects;
            let loadedURL = rewritten;
            try {
                extensionObjects = await load(rewritten, this.vm);
            } catch (rewrittenError) {
                if (rewritten === extensionURL) {
                    this._failedLoadingExtensionScript(rewrittenError);
                }
                // The rewritten URL is a pinned server copy that may not exist (for example,
                // an extension from an imported sprite that was never saved with this project).
                // Fall back to the original URL instead of failing the load.
                log.warn(`Falling back to original extension URL after rewrite failed: ${extensionURL}`,
                    rewrittenError);
                loadedURL = extensionURL;
                try {
                    extensionObjects = await load(extensionURL, this.vm);
                } catch (originalError) {
                    this._failedLoadingExtensionScript(originalError);
                }
            }
            const fakeWorkerId = this.nextExtensionWorker++;
            this.workerURLs[fakeWorkerId] = extensionURL;
            this._workerLoadedURLs[fakeWorkerId] = loadedURL;
            this._workerModes[fakeWorkerId] = sandboxMode;
            this._workerScripts[fakeWorkerId] = extensionObjects.script || null;
            installConsoleCapture(this);

            let registeredAny = false;
            try {
                for (const extensionObject of extensionObjects) {
                    let extensionInfo;
                    try {
                        extensionInfo = extensionObject.getInfo();
                    } catch (error) {
                        const location = this._locateInScript(extensionObjects.script, error && error.stack);
                        throw Object.assign(diagnosticError('getInfo', error, location), {
                            kind: 'getInfo',
                            line: location.line,
                            column: location.column
                        });
                    }
                    const serviceName = `unsandboxed.${fakeWorkerId}.${extensionInfo.id}`;
                    dispatch.setServiceSync(serviceName, extensionObject);
                    dispatch.callSync('extensions', 'registerExtensionServiceSync', serviceName);
                    this._loadedExtensions.set(extensionInfo.id, serviceName);
                    registeredAny = true;
                    this.runtime.compilerRegisterExtension(extensionInfo.id, extensionObject, extensionInfo);
                }
            } catch (error) {
                if (!registeredAny) {
                    delete this.workerURLs[fakeWorkerId];
                }
                this._failedLoadingExtensionScript(error);
            }

            this._finishedLoadingExtensionScript();
            return;
        }

        let ExtensionWorker;
        try {
            ExtensionWorker = await this._getWorkerClass(sandboxMode);
        } catch (error) {
            return this._failedLoadingExtensionScript(error);
        }

        const loadSandboxedOnce = extensionUrlToLoad => new Promise((resolve, reject) => {
            this._addExtensionWorker({
                extensionURL: extensionUrlToLoad,
                savedURL: extensionURL,
                resolve,
                reject,
                worker: new ExtensionWorker(),
                mode: sandboxMode
            });
        });

        try {
            await loadSandboxedOnce(rewritten);
            this._finishedLoadingExtensionScript();
        } catch (rewrittenError) {
            if (rewritten === extensionURL) {
                return this._failedLoadingExtensionScript(rewrittenError);
            }
            log.warn(`Falling back to original extension URL after rewrite failed: ${extensionURL}`,
                rewrittenError);
            return loadSandboxedOnce(extensionURL)
                .then(() => this._finishedLoadingExtensionScript())
                .catch(error => this._failedLoadingExtensionScript(error));
        }
        return;
    }

    /**
     * Reorder an extension by using current index and reorder to index
     * @param {string} extensionIndex - the index of the extension to reorder
     * @param {string} reorderIndex - the index to reorder the extension to
     * @returns {Promise} resolved once the extension is loaded and initialized or rejected on failure
     */
    reorderExtension (extensionIndex, reorderIndex) {
        const extensionIds = Array.from(this._loadedExtensions.keys());
        if (extensionIndex < 0 || extensionIndex >= extensionIds.length) return Promise.resolve();
        if (reorderIndex < 0 || reorderIndex >= extensionIds.length) return Promise.resolve();

        const [moved] = extensionIds.splice(extensionIndex, 1);
        extensionIds.splice(reorderIndex, 0, moved);

        return this.setExtensionOrder(extensionIds);
    }

    /**
     * Apply an ordered list of extension IDs, keeping any loaded IDs omitted from the list at the end.
     * @param {Iterable<string>} orderedExtensionIds ordered extension IDs
     * @returns {Promise} resolved after the runtime category order is updated
     */
    setExtensionOrder (orderedExtensionIds) {
        const currentIds = Array.from(this._loadedExtensions.keys());
        const loadedIds = new Set(currentIds);
        const seen = new Set();
        const extensionIds = [];

        for (const id of orderedExtensionIds) {
            if (loadedIds.has(id) && !seen.has(id)) {
                extensionIds.push(id);
                seen.add(id);
            }
        }
        for (const id of currentIds) {
            if (!seen.has(id)) extensionIds.push(id);
        }

        const nextLoadedExtensions = new Map();
        for (const id of extensionIds) {
            nextLoadedExtensions.set(id, this._loadedExtensions.get(id));
        }
        this._loadedExtensions = nextLoadedExtensions;

        // Keep runtime block category ordering consistent with extension order.
        return dispatch.call('runtime', '_setExtensionOrder', extensionIds);
    }

    /**
     * Unload an extension by URL or internal extension ID
     * @param {string} extensionURL - the URL for the extension to load OR the ID of an internal extension
     * @returns {boolean} true if the extension was loaded and has been removed
     */
    removeExtension (extensionURL) {
        if (!this.isExtensionLoaded(extensionURL)) {
            const message = `Rejecting attempt to remove an unloaded extension with ID ${extensionURL}`;
            log.warn(message);
            return false;
        }
        const serviceName = this._loadedExtensions.get(extensionURL);
        delete dispatch.services[serviceName];
        delete this.runtime[`ext_${extensionURL}`];
        this._loadedExtensions.delete(extensionURL);
        const holder = this._holders.get(extensionURL);
        if (holder) {
            holder.serviceName = null;
            holder.instance = null;
        }
        this.runtime._userSuppliedExtensionIds.delete(extensionURL);
        const workerId = +serviceName.split('.')[1];
        const workerStillUsed = Array.from(this._loadedExtensions.values())
            .some(otherServiceName => +otherServiceName.split('.')[1] === workerId);
        if (!workerStillUsed) {
            const url = this.workerURLs[workerId];
            this._forgetWorker(workerId);
            this._dropUnusedURLMode(url);
        }

        // Remove the extension category and primitives from runtime.
        dispatch.call('runtime', '_unregisterExtensionPrimitives', extensionURL);
        this.runtime.compilerUnregisterExtension(extensionURL);
        return true;
    }

    /**
     * Wait until all async extensions have loaded
     * @returns {Promise} resolved when all async extensions have loaded
     */
    allAsyncExtensionsLoaded () {
        if (this.loadingAsyncExtensions === 0) {
            return;
        }
        return new Promise((resolve, reject) => {
            this.asyncExtensionsLoadedCallbacks.push({
                resolve,
                reject
            });
        });
    }

    /**
     * Regenerate blockinfo for any loaded extensions
     * @param {string} [optExtensionId] Optional extension ID for refreshing
     * @returns {Promise} resolved once all the extensions have been reinitialized
     */
    refreshBlocks (optExtensionId) {
        const refresh = serviceName => dispatch.call(serviceName, 'getInfo')
            .then(info => {
                info = this._prepareExtensionInfo(serviceName, info);
                dispatch.call('runtime', '_refreshExtensionPrimitives', info);
            })
            .catch(e => {
                log.error('Failed to refresh built-in extension primitives', e);
            });
        if (optExtensionId) {
            if (!this._loadedExtensions.has(optExtensionId)) {
                return Promise.reject(new Error(`Unknown extension: ${optExtensionId}`));
            }
            return refresh(this._loadedExtensions.get(optExtensionId));
        }
        const allPromises = Array.from(this._loadedExtensions.values()).map(refresh);
        return Promise.all(allPromises);
    }

    allocateWorker () {
        return this._allocateWorkerInfo(this.pendingExtensions[0]);
    }

    _allocateWorkerInfo (workerInfo) {
        const index = this.pendingExtensions.indexOf(workerInfo);
        if (!workerInfo || index === -1) throw new Error('No extension is waiting for this worker.');
        this.pendingExtensions.splice(index, 1);
        const id = this.nextExtensionWorker++;
        workerInfo.workerId = id;
        this.pendingWorkers[id] = workerInfo;
        this.workerURLs[id] = workerInfo.savedURL || workerInfo.extensionURL;
        this._workerLoadedURLs[id] = workerInfo.extensionURL;
        if (workerInfo.worker) this._workers[id] = workerInfo.worker;
        if (workerInfo.mode) this._workerModes[id] = workerInfo.mode;
        return [id, workerInfo.extensionURL];
    }

    /**
     * Synchronously collect extension metadata from the specified service and begin the extension registration process.
     * @param {string} serviceName - the name of the service hosting the extension.
     */
    registerExtensionServiceSync (serviceName) {
        const info = dispatch.callSync(serviceName, 'getInfo');
        this._registerExtensionInfo(serviceName, info);
    }

    /**
     * Collect extension metadata from the specified service and begin the extension registration process.
     * @param {string} serviceName - the name of the service hosting the extension.
     */
    registerExtensionService (serviceName) {
        const workerInfo = this.pendingWorkers[workerIdOf(serviceName)];
        if (workerInfo && workerInfo.staged) {
            return dispatch.call(serviceName, 'getInfo').then(info => {
                workerInfo.staged.push({serviceName, info, instance: null});
            }, error => {
                workerInfo.getInfoError = error;
                throw error;
            });
        }
        return dispatch.call(serviceName, 'getInfo').then(info => {
            const holder = info && this._loadedExtensions.get(info.id);
            if ((holder && holder !== serviceName) || (info && this.isBuiltinExtension(info.id))) {
                throw new Error(`Another extension already uses the id ${info.id}.`);
            }
            this._registerExtensionInfo(serviceName, info);
            this._loadedExtensions.set(info.id, serviceName);
        });
    }

    _finishedLoadingExtensionScript () {
        this.loadingAsyncExtensions--;
        if (this.loadingAsyncExtensions === 0) {
            this.asyncExtensionsLoadedCallbacks.forEach(i => i.resolve());
            this.asyncExtensionsLoadedCallbacks = [];
        }
    }

    _failedLoadingExtensionScript (error) {
        this._finishedLoadingExtensionScript();
        throw error;
    }

    /**
     * Called by an extension worker to indicate that the worker has finished initialization.
     * @param {int} id - the worker ID.
     * @param {*?} e - the error encountered during initialization, if any.
     * @param {?{line: number, column: number}} location - where in the script the error happened, if known.
     */
    onWorkerInit (id, e, location) {
        const workerInfo = this.pendingWorkers[id];
        if (!workerInfo) return;
        delete this.pendingWorkers[id];
        if (e) {
            const workerStillUsed = Array.from(this._loadedExtensions.values())
                .some(serviceName => workerIdOf(serviceName) === id);
            if (!workerStillUsed) this._forgetWorker(id);
            const error = e instanceof Error ? e : new Error(String(e).replace(/^Error: /, ''));
            if (location) {
                error.line = location.line;
                error.column = location.column;
            }
            workerInfo.reject(error);
        } else {
            workerInfo.resolve();
        }
    }

    /**
     * Register an internal (non-Worker) extension object
     * @param {object} extensionObject - the extension object to register
     * @returns {string} The name of the registered extension service
     */
    _registerInternalExtension (extensionObject) {
        const extensionInfo = extensionObject.getInfo();
        const fakeWorkerId = this.nextExtensionWorker++;
        const serviceName = `extension_${fakeWorkerId}_${extensionInfo.id}`;
        dispatch.setServiceSync(serviceName, extensionObject);
        dispatch.callSync('extensions', 'registerExtensionServiceSync', serviceName);
        this.runtime.compilerRegisterExtension(extensionInfo.id, extensionObject, extensionInfo);
        return serviceName;
    }

    /**
     * Sanitize extension info then register its primitives with the VM.
     * @param {string} serviceName - the name of the service hosting the extension
     * @param {ExtensionInfo} extensionInfo - the extension's metadata
     * @private
     */
    _registerExtensionInfo (serviceName, extensionInfo) {
        if (extensionInfo && typeof extensionInfo.id === 'string') {
            this._extensionMetadata.set(extensionInfo.id, snapshotInfo(extensionInfo));
        }
        extensionInfo = this._prepareExtensionInfo(serviceName, extensionInfo);
        dispatch.call('runtime', '_registerExtensionPrimitives', extensionInfo).catch(e => {
            log.error(`Failed to register primitives for extension on service ${serviceName}:`, e);
        });
        if (this._unloadedExtensionURLs.has(extensionInfo.id)) {
            const url = this._unloadedExtensionURLs.get(extensionInfo.id);
            this._forgetUnloaded(extensionInfo.id);
            this._dropUnusedURLMode(url);
            this.runtime.resetAllCaches();
        }
    }

    /**
     * Apply minor cleanup and defaults for optional extension fields.
     * TODO: make the ID unique in cases where two copies of the same extension are loaded.
     * @param {string} serviceName - the name of the service hosting this extension block
     * @param {ExtensionInfo} extensionInfo - the extension info to be sanitized
     * @param {object} [stagingHolder] - a holder to use instead of the extension's own, for a dry run
     * @returns {ExtensionInfo} - a new extension info object with cleaned-up values
     * @private
     */
    _prepareExtensionInfo (serviceName, extensionInfo, stagingHolder) {
        extensionInfo = Object.assign({}, extensionInfo);
        if (!/^[a-z0-9]+$/i.test(extensionInfo.id)) {
            throw new Error('Invalid extension id');
        }
        const holder = stagingHolder || this._getHolder(extensionInfo.id);
        holder.serviceName = serviceName;
        holder.instance = dispatch.services[serviceName];
        extensionInfo.name = extensionInfo.name || extensionInfo.id;
        extensionInfo.blocks = extensionInfo.blocks || [];
        extensionInfo.targetTypes = extensionInfo.targetTypes || [];
        extensionInfo.blocks = extensionInfo.blocks.reduce((results, blockInfo) => {
            try {
                let result;
                switch (blockInfo) {
                case '---': // separator
                    result = '---';
                    break;
                default: // an ExtensionBlockMetadata object
                    result = this._prepareBlockInfo(serviceName, blockInfo, holder, extensionInfo.id);
                    break;
                }
                results.push(result);
            } catch (e) {
                // TODO: more meaningful error reporting
                log.error(`Error processing block: ${e.message}, Block:\n${JSON.stringify(blockInfo)}`);
            }
            return results;
        }, []);
        extensionInfo.menus = extensionInfo.menus || {};
        extensionInfo.menus = this._prepareMenuInfo(serviceName, extensionInfo.menus, holder, extensionInfo.id);
        return extensionInfo;
    }

    /**
     * Prepare extension menus. e.g. setup binding for dynamic menu functions.
     * @param {string} serviceName - the name of the service hosting this extension block
     * @param {Array.<MenuInfo>} menus - the menu defined by the extension.
     * @param {object} holder - the extension's holder, which names its current service.
     * @param {string} extensionId - the extension ID.
     * @returns {Array.<MenuInfo>} - a menuInfo object with all preprocessing done.
     * @private
     */
    _prepareMenuInfo (serviceName, menus, holder, extensionId) {
        const menuNames = Object.getOwnPropertyNames(menus);
        for (let i = 0; i < menuNames.length; i++) {
            const menuName = menuNames[i];
            let menuInfo = menus[menuName];

            // If the menu description is in short form (items only) then normalize it to general form: an object with
            // its items listed in an `items` property.
            if (!menuInfo.items) {
                menuInfo = {
                    items: menuInfo
                };
                menus[menuName] = menuInfo;
            }
            // If `items` is a string, it should be the name of a function in the extension object. Calling the
            // function should return an array of items to populate the menu when it is opened.
            if (typeof menuInfo.items === 'string') {
                const menuItemFunctionName = menuInfo.items;
                // Bind the function here so we can pass a simple item generation function to Scratch Blocks later.
                menuInfo.items = () => this._getExtensionMenuItems(
                    dispatch.services[holder.serviceName],
                    menuItemFunctionName,
                    extensionId
                );
            }
        }
        return menus;
    }

    /**
     * Fetch the items for a particular extension menu, providing the target ID for context.
     * @param {object} extensionObject - the extension object providing the menu.
     * @param {string} menuItemFunctionName - the name of the menu function to call.
     * @param {string} [extensionId] - the extension ID, for error reports.
     * @returns {Array} menu items ready for scratch-blocks.
     * @private
     */
    _getExtensionMenuItems (extensionObject, menuItemFunctionName, extensionId) {
        // Fetch the items appropriate for the target currently being edited. This assumes that menus only
        // collect items when opened by the user while editing a particular target.
        const editingTarget = this.runtime.getEditingTarget() || this.runtime.getTargetForStage();
        const editingTargetID = editingTarget ? editingTarget.id : null;
        const extensionMessageContext = this.runtime.makeMessageContextForTarget(editingTarget);

        // TODO: Fix this to use dispatch.call when extensions are running in workers.
        const menuFunc = extensionObject ? extensionObject[menuItemFunctionName] : null;
        if (typeof menuFunc !== 'function') {
            log.warn(`Could not find extension menu function called ${menuItemFunctionName}`);
            return [['', '']];
        }
        let menuItems;
        try {
            const items = menuFunc.call(extensionObject, editingTargetID);
            if (!Array.isArray(items) || items.length === 0) return [['', '']];
            menuItems = items.map(
                item => {
                    item = maybeFormatMessage(item, extensionMessageContext);
                    switch (typeof item) {
                    case 'object':
                        return [
                            maybeFormatMessage(item.text, extensionMessageContext),
                            item.value
                        ];
                    case 'string':
                        return [item, item];
                    default:
                        return item;
                    }
                });
        } catch (error) {
            log.error(`Extension menu function ${menuItemFunctionName} threw`, error);
            this.reportExtensionError({
                extensionId: extensionId || null,
                kind: 'menu',
                opcode: menuItemFunctionName,
                error
            });
            return [['', '']];
        }

        if (!menuItems || menuItems.length < 1) {
            throw new Error(`Extension menu returned no items: ${menuItemFunctionName}`);
        }
        return menuItems;
    }

    /**
     * Apply defaults for optional block fields.
     * @param {string} serviceName - the name of the service hosting this extension block
     * @param {ExtensionBlockMetadata} blockInfo - the block info from the extension
     * @param {object} holder - the extension's holder, which names its current service.
     * @param {string} extensionId - the extension ID.
     * @returns {ExtensionBlockMetadata} - a new block info object which has values for all relevant optional fields.
     * @private
     */
    _prepareBlockInfo (serviceName, blockInfo, holder, extensionId) {
        if (blockInfo.blockType === BlockType.XML) {
            blockInfo = Object.assign({}, blockInfo);
            blockInfo.xml = String(blockInfo.xml) || '';
            return blockInfo;
        }

        blockInfo = Object.assign({}, {
            blockType: BlockType.COMMAND,
            terminal: false,
            blockAllThreads: false,
            arguments: {}
        }, blockInfo);
        blockInfo.text = blockInfo.text || blockInfo.opcode;

        switch (blockInfo.blockType) {
        case BlockType.EVENT:
            if (blockInfo.func) {
                log.warn(`Ignoring function "${blockInfo.func}" for event block ${blockInfo.opcode}`);
            }
            break;
        case BlockType.BUTTON:
            if (blockInfo.opcode) {
                log.warn(`Ignoring opcode "${blockInfo.opcode}" for button with text: ${blockInfo.text}`);
            }
            if (blockInfo.func) {
                blockInfo.callFunc = () => {
                    dispatch.call(holder.serviceName, blockInfo.func).catch(error => {
                        log.error(`Button "${blockInfo.text}" failed:`, error);
                        this.reportExtensionError({extensionId, kind: 'button', opcode: blockInfo.func, error});
                    });
                };
            } else {
                log.warn(`Ignoring button with no func, text: ${blockInfo.text}`);
                blockInfo.callFunc = () => {};
            }
            break;
        case BlockType.LABEL:
            if (blockInfo.opcode) {
                log.warn(`Ignoring opcode "${blockInfo.opcode}" for label: ${blockInfo.text}`);
            }
            break;
        default: {
            if (!blockInfo.opcode) {
                throw new Error('Missing opcode for block');
            }

            const funcName = blockInfo.func || blockInfo.opcode;

            const getBlockInfo = blockInfo.isDynamic ?
                args => args && args.mutation && args.mutation.blockInfo :
                () => blockInfo;
            const callBlockFunc = (() => {
                if (dispatch._isRemoteService(serviceName)) {
                    return (args, util, realBlockInfo) =>
                        dispatch.call(holder.serviceName, funcName, args, util, realBlockInfo)
                            .then(result => {
                                // Scratch is only designed to handle these types.
                                // If any other value comes in such as undefined, null, an object, etc.
                                // we'll convert it to a string to avoid undefined behavior.
                                if (
                                    typeof result === 'number' ||
                                    typeof result === 'string' ||
                                    typeof result === 'boolean'
                                ) {
                                    return result;
                                }
                                return `${result}`;
                            });
                }

                // avoid promise latency if we can call direct
                const serviceObject = dispatch.services[serviceName];
                if (typeof serviceObject[funcName] !== 'function') {
                    // The function might show up later as a dynamic property of the service object
                    log.warn(`Could not find extension block function called ${funcName}`);
                }
                return (args, util, realBlockInfo) => {
                    const instance = holder.instance;
                    // Dynamic extension methods can disappear when an extension is refreshed.
                    if (!instance || typeof instance[funcName] !== 'function') return '';
                    return instance[funcName](args, util, realBlockInfo);
                };
            })();

            const kind = blockInfo.blockType === BlockType.HAT ? 'hat' : 'block';
            const opcode = `${extensionId}_${blockInfo.opcode}`;
            blockInfo.func = (args, util) => {
                const thread = util ? util.thread : null;
                let entry = null;
                if (thread) {
                    entry = thread.isCompiled ? thread.stack[0] : thread.stackFrames[thread.stackFrames.length - 1];
                }
                const realBlockInfo = getBlockInfo(args);
                // TODO: filter args using the keys of realBlockInfo.arguments? maybe only if sandboxed?
                try {
                    const result = callBlockFunc(args, util, realBlockInfo);
                    if (result instanceof Promise) {
                        result.then(null, error => {
                            this._reportBlockError(extensionId, kind, opcode, thread, entry, error);
                        });
                    }
                    return result;
                } catch (error) {
                    this._reportBlockError(extensionId, kind, opcode, thread, entry, error);
                    throw error;
                }
            };
            break;
        }
        }

        return blockInfo;
    }

    getExtensionURLs () {
        const extensionURLs = {};
        for (const [extensionId, serviceName] of this._loadedExtensions.entries()) {
            if (Object.prototype.hasOwnProperty.call(this.builtinExtensions, extensionId)) {
                continue;
            }

            // Service names for extension workers are in the format "extension.WORKER_ID.EXTENSION_ID"
            const workerId = +serviceName.split('.')[1];
            const extensionURL = this.workerURLs[workerId];
            if (typeof extensionURL === 'string') {
                extensionURLs[extensionId] = extensionURL;
            }
        }
        for (const [extensionId, extensionURL] of this._unloadedExtensionURLs.entries()) {
            if (!Object.prototype.hasOwnProperty.call(extensionURLs, extensionId) &&
                !this._loadedExtensions.has(extensionId)) {
                extensionURLs[extensionId] = extensionURL;
            }
        }
        return extensionURLs;
    }

    /**
     * Remember the URL of a project extension that was denied or failed to load, so saving the
     * project keeps it and the project can still be opened.
     * @param {string} extensionId The extension ID used by the project's blocks.
     * @param {string} extensionURL The URL stored in the project.
     * @param {{denied: boolean, error: *}} [details] Whether it was denied, or the error it failed with.
     */
    recordUnloadedExtension (extensionId, extensionURL, details = {}) {
        this._unloadedExtensionURLs.set(extensionId, extensionURL);
        const error = details.error;
        let described = null;
        if (error) {
            const diagnostic = error.diagnostics && error.diagnostics[0];
            described = {
                message: errorMessage(error),
                line: (diagnostic && diagnostic.line) || error.line || null,
                column: (diagnostic && diagnostic.column) || error.column || null
            };
        }
        this._unloadedExtensionDetails.set(extensionId, {
            denied: Boolean(details.denied),
            error: details.denied ? null : (described || UNKNOWN_LOAD_ERROR)
        });
    }

    /**
     * @param {string} extensionId The extension ID.
     * @returns {boolean} true if the current project uses this extension but it was denied or failed to load.
     */
    isExtensionUnloaded (extensionId) {
        return !this._loadedExtensions.has(extensionId) && this._unloadedExtensionURLs.has(extensionId);
    }

    /**
     * Forget extensions recorded by recordUnloadedExtension, when a different project loads.
     */
    clearUnloadedExtensions () {
        this._unloadedExtensionURLs.clear();
        this._unloadedExtensionDetails.clear();
    }

    resetProjectExtensions (extensionIDs = []) {
        this.clearUnloadedExtensions();
        this._urlModes.clear();
        this.runtime._userSuppliedExtensionIds.clear();
        this._belongingExtensions = new Set(extensionIDs);
    }

    getBelongingExtensionIds () {
        return Array.from(this._belongingExtensions);
    }

    _dropUnusedURLMode (url) {
        if (typeof url !== 'string' || !url.startsWith('data:')) return;
        if (Object.values(this.workerURLs).includes(url)) return;
        if (Array.from(this._unloadedExtensionURLs.values()).includes(url)) return;
        this._urlModes.delete(url);
    }

    _markUserSupplied (ids) {
        for (const id of ids) this.runtime.suppressSeededCompilers(id);
    }

    _forgetUnloaded (extensionId) {
        this._unloadedExtensionURLs.delete(extensionId);
        this._unloadedExtensionDetails.delete(extensionId);
    }

    forgetProjectExtension (extensionId) {
        this._belongingExtensions.delete(extensionId);
        this._forgetUnloaded(extensionId);
    }

    _getHolder (extensionId) {
        let holder = this._holders.get(extensionId);
        if (!holder) {
            holder = {serviceName: null, instance: null};
            this._holders.set(extensionId, holder);
        }
        return holder;
    }

    _addExtensionWorker (workerInfo) {
        const ownsService = service => (
            typeof service === 'string' &&
            typeof workerInfo.workerId === 'number' &&
            service.startsWith(`extension.${workerInfo.workerId}.`)
        );
        const guard = {
            call: (service, method, args) => {
                if (service === 'extensions' && method === 'allocateWorker') {
                    return this._allocateWorkerInfo(workerInfo);
                }
                if (service === 'extensions' && method === 'onWorkerInit' && args[0] === workerInfo.workerId) {
                    return this.onWorkerInit(workerInfo.workerId, args[1], args[2]);
                }
                if (service === 'extensions' && method === 'reportConsole') {
                    return this.reportConsole(workerInfo.workerId, args[0], args[1], args[2], args[3]);
                }
                if (
                    service === 'extensions' && method === 'registerExtensionService' &&
                    ownsService(args[0]) && dispatch.services[args[0]] === workerInfo.worker && (
                        this.pendingWorkers[workerInfo.workerId] === workerInfo ||
                        (!workerInfo.staged && this._workers[workerInfo.workerId] === workerInfo.worker)
                    )
                ) {
                    return this.registerExtensionService(args[0]);
                }
                throw new Error(`An extension worker may not call ${service}.${method}`);
            },
            setService: ownsService
        };
        this.pendingExtensions.push(workerInfo);
        dispatch.addWorker(workerInfo.worker, guard);
    }

    _forgetWorker (workerId) {
        delete this.workerURLs[workerId];
        delete this._workerLoadedURLs[workerId];
        delete this._workerModes[workerId];
        delete this._workerScripts[workerId];
        delete this._runningSources[workerId];
        const pending = this.pendingWorkers[workerId];
        if (pending) {
            delete this.pendingWorkers[workerId];
            pending.reject(dispatch.WORKER_REMOVED_ERROR);
        }
        const worker = this._workers[workerId];
        delete this._workers[workerId];
        if (worker) dispatch.removeWorker(worker);
    }

    _siblingIds (workerId) {
        const ids = [];
        for (const [id, serviceName] of this._loadedExtensions.entries()) {
            if (workerIdOf(serviceName) === workerId) ids.push(id);
        }
        return ids;
    }

    _workerIdFor (extensionId) {
        const serviceName = this._loadedExtensions.get(extensionId);
        return serviceName ? workerIdOf(serviceName) : null;
    }

    _locateInScript (script, stack) {
        const location = script ? locateInStack(stack, script.names, script.lineOffset) : null;
        return location || {line: null, column: null};
    }

    /**
     * Forward a console call made by extension code to the runtime as EXTENSION_CONSOLE.
     * @param {number} workerId The worker (or unsandboxed script) that made the call.
     * @param {string} level One of log, info, warn, error and debug.
     * @param {string} text The formatted arguments.
     * @param {?number} line Line in the extension source, if known.
     * @param {?number} column Column in the extension source, if known.
     */
    reportConsole (workerId, level, text, line, column) {
        const ids = this._siblingIds(workerId);
        if (!ids.length) return;
        this.runtime.emit('EXTENSION_CONSOLE', {
            extensionId: ids[0],
            level: CONSOLE_LEVELS.includes(level) ? level : 'log',
            message: String(text).slice(0, MAX_CONSOLE_TEXT),
            line: Number(line) || null,
            column: Number(column) || null
        });
    }

    _captureConsole (level, args, stack) {
        for (let workerId = 0; workerId < this._workerScripts.length; workerId++) {
            const script = this._workerScripts[workerId];
            if (!script || this._workerModes[workerId] !== 'unsandboxed') continue;
            const location = locateInStack(stack, script.names, script.lineOffset);
            if (!location) continue;
            this.reportConsole(workerId, level, formatConsoleArgs(args), location.line, location.column);
            return;
        }
    }

    _reportBlockError (extensionId, kind, opcode, thread, entry, error) {
        let blockId = null;
        if (typeof entry === 'string') {
            blockId = entry;
        } else if (entry && entry.op) {
            blockId = entry.op.id;
        }
        let targetId = null;
        if (thread && thread.target) {
            const original = thread.target.sprite && thread.target.sprite.clones[0];
            targetId = (original || thread.target).id;
        }
        this.reportExtensionError({extensionId, kind, opcode, blockId, targetId, error});
    }

    reportExtensionError ({extensionId, kind, opcode = null, blockId = null, targetId = null, error, line, column}) {
        if (error === dispatch.WORKER_REMOVED_ERROR) return;
        const stack = error && typeof error.stack === 'string' ? error.stack : null;
        let location = {line: line || null, column: column || null};
        if (!location.line && this._loadedExtensions.has(extensionId)) {
            location = this._locateInScript(this._workerScripts[this._workerIdFor(extensionId)], stack);
        }
        const payload = {
            extensionId,
            kind,
            opcode,
            blockId,
            targetId,
            message: errorMessage(error),
            stack,
            line: location.line,
            column: location.column
        };
        const key = `${extensionId}:${blockId || opcode || ''}:${kind}`;
        const now = Date.now();
        const entry = this._errorThrottle.get(key);
        if (!entry || (!entry.timer && now - entry.time >= ERROR_THROTTLE_MS)) {
            if (this._errorThrottle.size >= 1000) this._errorThrottle.clear();
            this._errorThrottle.set(key, {time: now, count: 0, pending: null, timer: null});
            this.runtime.emit('EXTENSION_ERROR', Object.assign(payload, {count: 1}));
            return;
        }
        entry.count++;
        entry.pending = payload;
        if (!entry.timer) {
            entry.timer = setTimeout(() => {
                const count = entry.count;
                const pending = entry.pending;
                entry.time = Date.now();
                entry.count = 0;
                entry.pending = null;
                entry.timer = null;
                this.runtime.emit('EXTENSION_ERROR', Object.assign(pending, {count}));
            }, Math.max(0, ERROR_THROTTLE_MS - (now - entry.time)));
        }
    }

    _dropThrottledErrors (ids) {
        for (const [key, entry] of this._errorThrottle.entries()) {
            if (!ids.some(id => key.startsWith(`${id}:`))) continue;
            if (entry.timer) clearTimeout(entry.timer);
            this._errorThrottle.delete(key);
        }
    }

    async _getWorkerClass (mode) {
        /* eslint-disable max-len */
        if (mode === 'worker') {
            return require('worker-loader?name=js/extension-worker/extension-worker.[hash].js!./extension-worker');
        }
        if (mode === 'iframe') {
            return (await import(/* webpackChunkName: "iframe-extension-worker" */ './tw-iframe-extension-worker')).default;
        }
        /* eslint-enable max-len */
        throw diagnosticError('load', new Error(`Invalid sandbox mode: ${mode}`));
    }

    async _stageExtensionScript (source, mode) {
        const url = toDataURL(source);
        if (mode === 'unsandboxed') {
            const {load} = require('./tw-unsandboxed-extension-runner');
            let objects;
            try {
                objects = await load(url, this.vm, source);
            } catch (error) {
                throw diagnosticError(runnerErrorKind(error), error, error);
            }
            const workerId = this.nextExtensionWorker++;
            const entries = [];
            for (const instance of objects) {
                let info;
                try {
                    info = instance.getInfo();
                } catch (error) {
                    throw diagnosticError('getInfo', error, this._locateInScript(objects.script, error && error.stack));
                }
                entries.push({info, instance, serviceName: `unsandboxed.${workerId}.${info && info.id}`});
            }
            return {workerId, mode, worker: null, entries, script: objects.script || null};
        }
        const ExtensionWorker = await this._getWorkerClass(mode);
        const worker = new ExtensionWorker();
        const workerInfo = {extensionURL: url, mode, worker, staged: []};
        try {
            await new Promise((resolve, reject) => {
                workerInfo.resolve = resolve;
                workerInfo.reject = reject;
                this._addExtensionWorker(workerInfo);
            });
        } catch (error) {
            if (workerInfo.getInfoError) throw diagnosticError('getInfo', workerInfo.getInfoError);
            throw diagnosticError(/SyntaxError/.test(errorMessage(error)) ? 'syntax' : 'load', error, error);
        }
        return {workerId: workerInfo.workerId, mode, worker, workerInfo, entries: workerInfo.staged, script: null};
    }

    _discardStage (stage) {
        if (!stage) return;
        for (const {instance, serviceName} of stage.entries) {
            if (instance && dispatch.services[serviceName] === instance) delete dispatch.services[serviceName];
            if (instance && typeof instance.dispose === 'function') {
                try {
                    instance.dispose();
                } catch (error) {
                    log.warn('dispose() of a discarded extension threw', error);
                }
            }
        }
        if (stage.worker) this._forgetWorker(stage.workerId);
    }

    _dryBuild (entry) {
        const {info, instance, serviceName} = entry;
        if (instance && dispatch.services[serviceName] !== instance) dispatch.setServiceSync(serviceName, instance);
        const menus = {};
        for (const menuName of Object.keys(info.menus || {})) {
            const menu = info.menus[menuName];
            menus[menuName] = menu && typeof menu === 'object' && !Array.isArray(menu) ? Object.assign({}, menu) : menu;
        }
        const prepared = this._prepareExtensionInfo(serviceName, Object.assign({}, info, {menus}), {});
        const scratchRuntime = Object.create(this.runtime);
        scratchRuntime._primitives = {};
        scratchRuntime._hats = {};
        scratchRuntime._flowing = {};
        scratchRuntime.extensionButtons = new Map();
        const category = {id: info.id};
        scratchRuntime._fillExtensionCategoryHeader(category, prepared);
        scratchRuntime._fillExtensionCategory(category, prepared);
    }

    _validateStage (stage) {
        const ids = [];
        for (const {info} of stage.entries) {
            if (!info || typeof info !== 'object' || typeof info.id !== 'string' || !/^[a-z0-9]+$/i.test(info.id)) {
                throw diagnosticError('contract', new Error(
                    'The extension id must be a string of only letters and numbers.'
                ));
            }
            if (ids.includes(info.id)) {
                throw diagnosticError('contract', new Error(`The script registered the id ${info.id} twice.`));
            }
            if (typeof info.blocks !== 'undefined' && !Array.isArray(info.blocks)) {
                throw diagnosticError('contract', new Error('getInfo().blocks must be an array.'));
            }
            if (typeof info.menus !== 'undefined' && (info.menus === null || typeof info.menus !== 'object')) {
                throw diagnosticError('contract', new Error('getInfo().menus must be an object.'));
            }
            const fields = info.customFieldTypes;
            if (typeof fields !== 'undefined' && (fields === null || typeof fields !== 'object')) {
                throw diagnosticError('contract', new Error('getInfo().customFieldTypes must be an object.'));
            }
            for (const fieldName of Object.keys(fields || {})) {
                if (!fields[fieldName] || typeof fields[fieldName] !== 'object') {
                    throw diagnosticError('contract', new Error(`Custom field type ${fieldName} must be an object.`));
                }
            }
            for (const menuName of Object.keys(info.menus || {})) {
                const menu = info.menus[menuName];
                const items = menu && typeof menu === 'object' && !Array.isArray(menu) ? menu.items : menu;
                if (typeof items === 'string' || typeof items === 'function') continue;
                try {
                    this.runtime._convertMenuItems(items);
                } catch (error) {
                    throw diagnosticError('getInfo', new Error(`Menu ${menuName} is invalid: ${errorMessage(error)}`));
                }
            }
            ids.push(info.id);
        }
        for (const entry of stage.entries) {
            try {
                this._dryBuild(entry);
            } catch (error) {
                throw diagnosticError('getInfo', error);
            }
        }
        return ids;
    }

    _registerStaged (stage, url, source, keepURL) {
        this.runtime.setExternalCommunicationMethod('customExtensions', true);
        this._markUserSupplied(stage.entries.map(entry => entry.info.id));
        for (const {info, instance, serviceName} of stage.entries) {
            if (instance && dispatch.services[serviceName] !== instance) dispatch.setServiceSync(serviceName, instance);
            this._registerExtensionInfo(serviceName, info);
            this._loadedExtensions.set(info.id, serviceName);
            if (instance) this.runtime.compilerRegisterExtension(info.id, instance, info);
        }
        this._recordStagedWorker(stage, url, source, keepURL);
    }

    _recordStagedWorker (stage, url, source, keepURL) {
        if (stage.mode === 'unsandboxed') installConsoleCapture(this);
        this.workerURLs[stage.workerId] = url;
        this._workerLoadedURLs[stage.workerId] = keepURL ? null : url;
        this._workerModes[stage.workerId] = stage.mode;
        this._workerScripts[stage.workerId] = stage.script;
        if (stage.worker) this._workers[stage.workerId] = stage.worker;
        if (keepURL) this._runningSources[stage.workerId] = source;
        if (stage.workerInfo) stage.workerInfo.staged = null;
        this._urlModes.set(url, stage.mode);
    }

    _compilerEntries (ids) {
        const prefixes = ids.map(id => `${id}_`);
        const entries = new Map();
        for (const [opcode, entry] of this.runtime.compilerExtensions.entries()) {
            if (prefixes.some(prefix => opcode.startsWith(prefix))) entries.set(opcode, entry);
        }
        return entries;
    }

    _restoreCompilerEntries (ids, snapshot) {
        for (const opcode of this._compilerEntries(ids).keys()) {
            if (!snapshot.has(opcode)) this.runtime.compilerExtensions.delete(opcode);
        }
        for (const [opcode, entry] of snapshot.entries()) {
            this.runtime.compilerExtensions.set(opcode, entry);
        }
    }

    async requestUnsandboxedAllowance (id, source, fileName) {
        this._unsandboxedAllowances.delete(id);
        if (typeof id !== 'string' || typeof source !== 'string') return false;
        const allowed = await this.securityManager.canRunUnsandboxedFromFile(fileName, source, id);
        if (allowed === true) this._unsandboxedAllowances.set(id, source);
        return allowed === true;
    }

    _consumeUnsandboxedAllowance (id, source) {
        const allowed = this._unsandboxedAllowances.get(id) === source;
        this._unsandboxedAllowances.delete(id);
        return allowed;
    }

    _reloadDiff (stage) {
        const results = [];
        const removedOpcodes = new Set();
        const details = {};
        let metadataChanged = false;
        for (const {info} of stage.entries) {
            const oldSnapshot = this._extensionMetadata.get(info.id);
            const newSnapshot = snapshotInfo(info);
            if (!oldSnapshot || !newSnapshot || JSON.stringify(oldSnapshot) !== JSON.stringify(newSnapshot)) {
                metadataChanged = true;
            }
            const oldOpcodes = opcodeMetadata(oldSnapshot);
            const newOpcodes = opcodeMetadata(newSnapshot);
            const removed = [];
            const added = [];
            const changed = [];
            for (const [opcode, metadata] of oldOpcodes.entries()) {
                if (!newOpcodes.has(opcode)) {
                    removed.push(`${info.id}_${opcode}`);
                } else if (newOpcodes.get(opcode) !== metadata) {
                    changed.push(`${info.id}_${opcode}`);
                    details[`${info.id}_${opcode}`] = {
                        before: JSON.parse(metadata),
                        after: JSON.parse(newOpcodes.get(opcode))
                    };
                }
            }
            for (const opcode of newOpcodes.keys()) {
                if (!oldOpcodes.has(opcode)) added.push(`${info.id}_${opcode}`);
            }
            for (const opcode of removed) removedOpcodes.add(opcode);
            results.push({id: info.id, removed, added, changed});
        }
        return {results, removedOpcodes, metadataChanged, details};
    }

    async reloadExtension (id, source, {keepURL = false, confirm = null, mode: requestedMode = null} = {}) {
        if (typeof source !== 'string') {
            throw diagnosticError('load', new Error('The extension source must be a string.'));
        }
        if (!this._loadedExtensions.has(id)) {
            if (this._unloadedExtensionURLs.has(id)) return this._fixUnloadedExtension(id, source, keepURL);
            throw diagnosticError('load', new Error(`Unknown extension: ${id}`));
        }
        const workerId = this._workerIdFor(id);
        const currentMode = this._workerModes[workerId] || this._urlModes.get(this.workerURLs[workerId]);
        if (this.isBuiltinExtension(id) || !currentMode) {
            throw diagnosticError('load', new Error(`${id} is built in and cannot be reloaded.`));
        }
        let mode = currentMode;
        if (requestedMode && requestedMode !== currentMode) {
            if (!['worker', 'iframe', 'unsandboxed'].includes(requestedMode)) {
                throw diagnosticError('load', new Error(`Unknown extension mode: ${requestedMode}`));
            }
            if (requestedMode === 'unsandboxed' && !this._consumeUnsandboxedAllowance(id, source)) {
                throw diagnosticError('load', new Error('Running this extension without the sandbox was not allowed.'));
            }
            mode = requestedMode;
        }
        const oldIds = this._siblingIds(workerId);
        const compilerSnapshot = this._compilerEntries(oldIds);
        const ticket = ++this._reloadCounter;
        for (const oldId of oldIds) this._reloadSequence.set(oldId, ticket);
        const isNewest = () => oldIds.every(oldId => this._reloadSequence.get(oldId) === ticket);
        let stage = null;
        let stagedCompilers = null;
        try {
            stage = await this._stageExtensionScript(source, mode);
            if (!isNewest()) throw diagnosticError('load', new Error('A newer edit replaced this one.'));
            const newIds = this._validateStage(stage);
            const currentIds = this._loadedExtensions.has(id) ? this._siblingIds(this._workerIdFor(id)) : [];
            if (newIds.length !== currentIds.length || newIds.some(newId => !currentIds.includes(newId))) {
                throw diagnosticError('contract', new Error(
                    `The script must register exactly ${currentIds.join(', ')}, but it registered ` +
                    `${newIds.join(', ') || 'nothing'}.`
                ));
            }
            stagedCompilers = this._compilerEntries(newIds);
            if (confirm) {
                this._restoreCompilerEntries(oldIds, compilerSnapshot);
                this.runtime.resetAllCaches();
                const generation = this.vm._projectLoadGeneration;
                const serviceName = this._loadedExtensions.get(id);
                const {results, details} = this._reloadDiff(stage);
                const diff = {ids: newIds, mode, removed: [], added: [], changed: [], details};
                for (const entry of results) {
                    diff.removed.push(...entry.removed);
                    diff.added.push(...entry.added);
                    diff.changed.push(...entry.changed);
                }
                const approved = await confirm(diff);
                if (approved !== true) throw diagnosticError('load', new Error('The reload was cancelled.'));
                if (!isNewest()) throw diagnosticError('load', new Error('A newer edit replaced this one.'));
                if (this.vm.editingCommands && this.vm.editingCommands.handler) {
                    throw diagnosticError('load',
                        new Error('Reloading extensions is unavailable during collaboration.'));
                }
                if (this.vm._projectLoadGeneration !== generation) {
                    throw diagnosticError('load', new Error('The project changed while reloading.'));
                }
                if (this._loadedExtensions.get(id) !== serviceName || this._workerIdFor(id) !== workerId) {
                    throw diagnosticError('load', new Error('The extension changed while reloading.'));
                }
            }
        } catch (error) {
            this._discardStage(stage);
            if (isNewest()) this._restoreCompilerEntries(oldIds, compilerSnapshot);
            throw error.diagnostics ? error : diagnosticError('load', error);
        }
        return this._commitReload(stage, source, keepURL, compilerSnapshot, stagedCompilers, currentMode);
    }

    _commitReload (stage, source, keepURL, compilerSnapshot, capturedCompilers, oldMode) {
        const ids = stage.entries.map(entry => entry.info.id);
        const oldWorkerId = this._workerIdFor(ids[0]);
        const oldURL = this.workerURLs[oldWorkerId];
        const oldWorker = this._workers[oldWorkerId];
        const stagedCompilers = capturedCompilers || this._compilerEntries(ids);

        const {results, removedOpcodes, metadataChanged} = this._reloadDiff(stage);
        let usesCompilers = Array.from(compilerSnapshot.entries())
            .some(([opcode, entry]) => this.runtime._seededCompilers.get(opcode) !== entry);
        for (const {info} of stage.entries) {
            if (this.runtime._extensionCompilerOpcodes.has(info.id)) usesCompilers = true;
            if (Array.isArray(info.blocks) && info.blocks.some(block => block && block.compFunc)) usesCompilers = true;
        }
        for (const [opcode, entry] of stagedCompilers.entries()) {
            if (compilerSnapshot.get(opcode) !== entry) usesCompilers = true;
        }

        const backup = this._backupForCommit(ids, oldWorkerId);
        try {
            this._markUserSupplied(ids);
            for (const {info, instance, serviceName} of stage.entries) {
                if (instance && dispatch.services[serviceName] !== instance) {
                    dispatch.setServiceSync(serviceName, instance);
                }
                this._loadedExtensions.set(info.id, serviceName);
                this._extensionMetadata.set(info.id, snapshotInfo(info));
                this.runtime._refreshExtensionPrimitives(this._prepareExtensionInfo(serviceName, info), true);
                if (instance) this.runtime[`ext_${info.id}`] = instance;
            }

            if (usesCompilers) {
                for (const id of ids) this.runtime.compilerUnregisterExtension(id);
                for (const [opcode, entry] of stagedCompilers.entries()) {
                    if (compilerSnapshot.get(opcode) !== entry) this.runtime.compilerExtensions.set(opcode, entry);
                }
                for (const {info, instance} of stage.entries) {
                    if (instance) this.runtime.compilerRegisterExtension(info.id, instance, info);
                }
            }
            this._recordStagedWorker(stage, keepURL && oldURL ? oldURL : toDataURL(source), source, keepURL && oldURL);
        } catch (error) {
            this._restoreCommitBackup(backup, stage, compilerSnapshot);
            throw diagnosticError('load', error);
        }

        if (removedOpcodes.size) {
            this.runtime.stopThreadsUsingOpcodes(opcode => removedOpcodes.has(opcode));
        }

        for (const id of ids) {
            const oldServiceName = backup.serviceNames.get(id);
            if ((oldMode || stage.mode) === 'unsandboxed') {
                const oldInstance = dispatch.services[oldServiceName];
                if (oldInstance && typeof oldInstance.dispose === 'function') {
                    try {
                        oldInstance.dispose();
                    } catch (error) {
                        log.warn(`dispose() of the previous ${id} threw`, error);
                    }
                }
                delete dispatch.services[oldServiceName];
            } else {
                dispatch.call(oldServiceName, 'dispose').catch(() => {});
            }
        }

        delete this.workerURLs[oldWorkerId];
        delete this._workerLoadedURLs[oldWorkerId];
        delete this._workerModes[oldWorkerId];
        delete this._workerScripts[oldWorkerId];
        delete this._runningSources[oldWorkerId];
        delete this._workers[oldWorkerId];
        if (oldWorker) setTimeout(() => dispatch.removeWorker(oldWorker), 0);
        this._dropUnusedURLMode(oldURL);

        this._dropThrottledErrors(ids);
        if (metadataChanged && !usesCompilers) this.runtime.resetAllCaches();
        for (const id of ids) this._belongingExtensions.add(id);
        this.runtime.emitProjectChanged();

        const result = {ids, removed: [], added: [], changed: []};
        for (const entry of results) {
            result.removed.push(...entry.removed);
            result.added.push(...entry.added);
            result.changed.push(...entry.changed);
            this.runtime.emit('EXTENSION_RELOADED', entry);
        }
        return result;
    }

    _backupForCommit (ids, oldWorkerId) {
        const prefixes = ids.map(id => `${id}_`);
        const pick = object => {
            const picked = {};
            for (const key of Object.keys(object)) {
                if (prefixes.some(prefix => key.startsWith(prefix))) picked[key] = object[key];
            }
            return picked;
        };
        const backup = {
            ids,
            userSupplied: ids.filter(id => this.runtime._userSuppliedExtensionIds.has(id)),
            serviceNames: new Map(),
            holders: new Map(),
            metadata: new Map(),
            instances: new Map(),
            compilerOpcodes: new Map(),
            categories: new Map(),
            primitives: pick(this.runtime._primitives),
            hats: pick(this.runtime._hats),
            flowing: pick(this.runtime._flowing),
            buttons: Array.from(this.runtime.extensionButtons.entries())
                .filter(([key]) => prefixes.some(prefix => key.startsWith(prefix))),
            oldWorkerId,
            worker: {
                url: this.workerURLs[oldWorkerId],
                loadedURL: this._workerLoadedURLs[oldWorkerId],
                mode: this._workerModes[oldWorkerId],
                script: this._workerScripts[oldWorkerId],
                source: this._runningSources[oldWorkerId]
            }
        };
        for (const id of ids) {
            backup.serviceNames.set(id, this._loadedExtensions.get(id));
            backup.holders.set(id, Object.assign({}, this._getHolder(id)));
            backup.metadata.set(id, this._extensionMetadata.get(id));
            backup.instances.set(id, this.runtime[`ext_${id}`]);
            backup.compilerOpcodes.set(id, this.runtime._extensionCompilerOpcodes.get(id));
            const category = this.runtime._blockInfo.find(info => info.id === id);
            if (category) backup.categories.set(category, Object.assign({}, category));
        }
        return backup;
    }

    _restoreCommitBackup (backup, stage, compilerSnapshot) {
        for (const id of backup.ids) {
            this._loadedExtensions.set(id, backup.serviceNames.get(id));
            Object.assign(this._getHolder(id), backup.holders.get(id));
            this._extensionMetadata.set(id, backup.metadata.get(id));
            if (typeof backup.instances.get(id) === 'undefined') {
                delete this.runtime[`ext_${id}`];
            } else {
                this.runtime[`ext_${id}`] = backup.instances.get(id);
            }
            this.runtime._purgeExtensionPrimitives(id);
        }
        Object.assign(this.runtime._primitives, backup.primitives);
        Object.assign(this.runtime._hats, backup.hats);
        Object.assign(this.runtime._flowing, backup.flowing);
        for (const [key, callback] of backup.buttons) this.runtime.extensionButtons.set(key, callback);
        for (const [category, copy] of backup.categories.entries()) {
            for (const key of Object.keys(category)) delete category[key];
            Object.assign(category, copy);
        }
        for (const id of backup.ids) {
            if (!backup.userSupplied.includes(id)) this.runtime._userSuppliedExtensionIds.delete(id);
        }
        this._restoreCompilerEntries(backup.ids, compilerSnapshot);
        for (const [id, opcodes] of backup.compilerOpcodes.entries()) {
            if (opcodes) {
                this.runtime._extensionCompilerOpcodes.set(id, opcodes);
            } else {
                this.runtime._extensionCompilerOpcodes.delete(id);
            }
        }
        if (stage.workerId !== backup.oldWorkerId) {
            delete this.workerURLs[stage.workerId];
            delete this._workerLoadedURLs[stage.workerId];
            delete this._workerModes[stage.workerId];
            delete this._workerScripts[stage.workerId];
            delete this._runningSources[stage.workerId];
        }
        const worker = backup.worker;
        this.workerURLs[backup.oldWorkerId] = worker.url;
        this._workerLoadedURLs[backup.oldWorkerId] = worker.loadedURL;
        this._workerModes[backup.oldWorkerId] = worker.mode;
        this._workerScripts[backup.oldWorkerId] = worker.script;
        if (typeof worker.source === 'string') this._runningSources[backup.oldWorkerId] = worker.source;
        this._discardStage(stage);
        this.runtime.resetAllCaches();
        for (const category of backup.categories.keys()) {
            this.runtime.emit('BLOCKSINFO_UPDATE', category);
        }
    }

    async _fixUnloadedExtension (id, source, keepURL) {
        const ticket = ++this._reloadCounter;
        this._reloadSequence.set(id, ticket);
        const url = this._unloadedExtensionURLs.get(id);
        const details = this._unloadedExtensionDetails.get(id) || {};
        let mode = details.denied ? null : this._urlModes.get(url);
        if (!mode) {
            if (details.denied && !await this.securityManager.canLoadExtensionFromProject(url)) {
                throw diagnosticError('load', new Error('Loading this extension was not allowed.'));
            }
            mode = await this.securityManager.getSandboxMode(url);
        }
        let stage = null;
        let ids;
        try {
            stage = await this._stageExtensionScript(source, mode);
            if (this._reloadSequence.get(id) !== ticket) {
                throw diagnosticError('load', new Error('A newer edit replaced this one.'));
            }
            ids = this._validateStage(stage);
            if (!ids.includes(id)) {
                throw diagnosticError('contract', new Error(
                    `The script must register ${id}, but it registered ${ids.join(', ') || 'nothing'}.`
                ));
            }
            const taken = ids.find(newId => this._loadedExtensions.has(newId));
            if (taken) {
                throw diagnosticError('contract', new Error(`Another extension already uses the id ${taken}.`));
            }
        } catch (error) {
            this._discardStage(stage);
            throw error.diagnostics ? error : diagnosticError('load', error);
        }
        this._registerStaged(stage, keepURL ? url : toDataURL(source), source, keepURL);
        const result = {ids, removed: [], added: [], changed: []};
        for (const newId of ids) {
            this._forgetUnloaded(newId);
            this._belongingExtensions.add(newId);
            const added = Array.from(opcodeMetadata(this._extensionMetadata.get(newId)).keys())
                .map(opcode => `${newId}_${opcode}`);
            result.added.push(...added);
            this.runtime.emit('EXTENSION_RELOADED', {id: newId, removed: [], added, changed: []});
        }
        this.runtime.resetAllCaches();
        this.runtime.emitProjectChanged();
        return result;
    }

    async createExtension (source, {unsandboxed = false} = {}) {
        if (typeof source !== 'string') {
            throw diagnosticError('load', new Error('The extension source must be a string.'));
        }
        if (unsandboxed && !await this.securityManager.canCreateUnsandboxedExtension()) {
            throw diagnosticError('load', new Error('Running this extension without the sandbox was not allowed.'));
        }
        const mode = unsandboxed ? 'unsandboxed' : 'iframe';
        let stage = null;
        let ids;
        try {
            stage = await this._stageExtensionScript(source, mode);
            ids = this._validateStage(stage);
            const taken = ids.find(id => this._loadedExtensions.has(id));
            if (taken) {
                throw diagnosticError('contract', new Error(`Another extension already uses the id ${taken}.`));
            }
        } catch (error) {
            this._discardStage(stage);
            throw error.diagnostics ? error : diagnosticError('load', error);
        }
        this._registerStaged(stage, toDataURL(source), source, false);
        let fixedUnloaded = false;
        for (const id of ids) {
            if (this._unloadedExtensionURLs.has(id)) fixedUnloaded = true;
            this._forgetUnloaded(id);
            this._belongingExtensions.add(id);
        }
        if (fixedUnloaded) this.runtime.resetAllCaches();
        this.runtime.emitProjectChanged();
        return ids;
    }

    async convertToEmbedded (id) {
        const source = await this.getExtensionSource(id, {fetch: true});
        if (typeof source !== 'string') {
            throw new Error(`${id} has no source to embed.`);
        }
        const url = toDataURL(source);
        if (this._loadedExtensions.has(id)) {
            const workerId = this._workerIdFor(id);
            const mode = this._workerModes[workerId];
            const oldURL = this.workerURLs[workerId];
            this.workerURLs[workerId] = url;
            this._workerLoadedURLs[workerId] = url;
            delete this._runningSources[workerId];
            if (mode) this._urlModes.set(url, mode);
            this._dropUnusedURLMode(oldURL);
            for (const siblingId of this._siblingIds(workerId)) this._belongingExtensions.add(siblingId);
            this._markUserSupplied(this._siblingIds(workerId));
        } else {
            const oldURL = this._unloadedExtensionURLs.get(id);
            const mode = this._urlModes.get(oldURL);
            this._unloadedExtensionURLs.set(id, url);
            if (mode) this._urlModes.set(url, mode);
            this._dropUnusedURLMode(oldURL);
            this._belongingExtensions.add(id);
            this._markUserSupplied([id]);
        }
        this.runtime.emitProjectChanged();
    }

    async _readExtensionURL (url) {
        if (url.startsWith('data:')) {
            return require('./tw-unsandboxed-extension-runner').decodeDataURL(url);
        }
        let response;
        try {
            response = await fetch(url);
        } catch (error) {
            throw new Error(`Could not fetch ${url}: ${errorMessage(error)}`);
        }
        if (!response.ok) {
            throw new Error(`Could not fetch ${url}: HTTP ${response.status}`);
        }
        return response.text();
    }

    getExtensionSource (id, {fetch: allowFetch = false, fresh = false} = {}) {
        if (this._loadedExtensions.has(id)) {
            if (this.isBuiltinExtension(id)) return Promise.resolve(null);
            const workerId = this._workerIdFor(id);
            const savedURL = this.workerURLs[workerId];
            const fromURL = typeof savedURL === 'string' && !savedURL.startsWith('data:');
            if (typeof this._runningSources[workerId] === 'string' && !(fresh && fromURL)) {
                return Promise.resolve(this._runningSources[workerId]);
            }
            const url = this._workerLoadedURLs[workerId] || this.workerURLs[workerId];
            if (typeof url !== 'string') return Promise.resolve(null);
            return this._readExtensionURL(url);
        }
        if (this._unloadedExtensionURLs.has(id)) {
            const url = this._unloadedExtensionURLs.get(id);
            if (!url.startsWith('data:') && !allowFetch) return Promise.resolve(null);
            return this._readExtensionURL(url);
        }
        return Promise.resolve(null);
    }

    getExtensionMode (id) {
        if (this._loadedExtensions.has(id)) {
            if (this.isBuiltinExtension(id)) return null;
            const workerId = this._workerIdFor(id);
            return this._workerModes[workerId] || this._urlModes.get(this.workerURLs[workerId]) || null;
        }
        if (this._unloadedExtensionURLs.has(id)) {
            return this._urlModes.get(this._unloadedExtensionURLs.get(id)) || null;
        }
        return null;
    }

    getExtensionEntries () {
        const entries = [];
        const kindOf = url => {
            if (typeof url !== 'string') return 'builtin';
            return url.startsWith('data:') ? 'embedded' : 'url';
        };
        for (const id of this._loadedExtensions.keys()) {
            if (this.isCoreExtension(id)) continue;
            const builtin = this.isBuiltinExtension(id);
            const url = builtin ? null : (this.workerURLs[this._workerIdFor(id)] || null);
            const category = this.runtime._blockInfo.find(info => info.id === id);
            entries.push({
                id,
                url,
                kind: builtin ? 'builtin' : kindOf(url),
                status: 'loaded',
                mode: this.getExtensionMode(id),
                name: (category && category.name) || id,
                error: null
            });
        }
        for (const [id, url] of this._unloadedExtensionURLs.entries()) {
            if (this._loadedExtensions.has(id)) continue;
            const details = this._unloadedExtensionDetails.get(id) || {denied: false, error: null};
            entries.push({
                id,
                url,
                kind: kindOf(url),
                status: details.denied ? 'denied' : 'failed',
                mode: this.getExtensionMode(id),
                name: id,
                error: details.denied ? null : (details.error || UNKNOWN_LOAD_ERROR)
            });
        }
        return entries;
    }

    isExtensionURLLoaded (url) {
        return Object.values(this.workerURLs).includes(url);
    }
}

module.exports = ExtensionManager;
