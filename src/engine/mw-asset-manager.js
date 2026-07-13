const EventEmitter = require('events');
const AssetUtil = require('../util/tw-asset-util');
const StringUtil = require('../util/string-util');
const log = require('../util/log');

/**
 * @typedef InternalAsset
 * @property {string} name The asset's name
 * @property {Asset} asset scratch-storage asset holding the raw bytes
 */

const FALLBACK_ASSET_TYPE = {
    contentType: 'application/octet-stream',
    name: 'CustomAsset',
    runtimeFormat: 'bin',
    immutable: true
};

class AssetManager extends EventEmitter {
    /**
     * @param {Runtime} runtime
     */
    constructor (runtime) {
        super();

        /** @type {Runtime} */
        this.runtime = runtime;

        /** @type {Array<InternalAsset>} */
        this.assets = [];
    }

    /**
     * scratch-storage asset type used for custom assets. Registered by scratch-gui; VM-only
     * environments fall back to a local definition so tests and the playground still work.
     * @returns {object}
     */
    get assetType () {
        const storage = this.runtime.storage;
        if (storage && storage.AssetType && storage.AssetType.CustomAsset) {
            return storage.AssetType.CustomAsset;
        }
        return FALLBACK_ASSET_TYPE;
    }

    /**
     * @param {string} name Untrusted name input
     * @returns {string} A name not already in use
     */
    getUnusedName (name) {
        return StringUtil.caseInsensitiveUnusedName(name, this.assets.map(i => i.name));
    }

    /**
     * @param {string} name
     * @returns {InternalAsset|null}
     */
    getAsset (name) {
        return this.assets.find(i => i.name.toLowerCase() === String(name).toLowerCase()) || null;
    }

    /**
     * @param {string} name
     * @param {Asset} asset scratch-storage asset
     */
    addAsset (name, asset) {
        const existingIndex = this.assets.findIndex(i => i.name.toLowerCase() === name.toLowerCase());
        if (existingIndex !== -1) {
            this.assets.splice(existingIndex, 1);
        }
        this.assets.push({name, asset});
        this.changed();
    }

    /**
     * @param {number} index
     * @param {string} newName
     */
    renameAsset (index, newName) {
        const entry = this.assets[index];
        if (!entry || entry.name === newName) {
            return;
        }
        entry.name = StringUtil.caseInsensitiveUnusedName(
            newName,
            this.assets.filter(i => i !== entry).map(i => i.name)
        );
        this.changed();
    }

    /**
     * @param {number} index
     */
    deleteAsset (index) {
        this.assets.splice(index, 1);
        this.changed();
    }

    clear () {
        if (this.assets.length === 0) {
            return;
        }
        this.assets = [];
        this.changed();
    }

    changed () {
        this.emit('change');
    }

    /**
     * Get data to save in project.json and sb3 files.
     * @returns {Array<{name: string; md5ext: string}>|null}
     */
    serializeJSON () {
        if (this.assets.length === 0) {
            return null;
        }

        return this.assets.map(entry => ({
            name: entry.name,
            md5ext: `${entry.asset.assetId}.${entry.asset.dataFormat}`
        }));
    }

    /**
     * @returns {Asset[]} list of scratch-storage assets
     */
    serializeAssets () {
        return this.assets.map(i => i.asset);
    }

    /**
     * @param {unknown} json
     * @param {JSZip} [zip]
     * @param {boolean} [keepExisting]
     * @returns {Promise<void>}
     */
    async deserialize (json, zip, keepExisting) {
        if (!keepExisting) {
            this.clear();
        }

        if (!Array.isArray(json)) {
            return;
        }

        for (const entry of json) {
            if (!entry || typeof entry !== 'object') {
                continue;
            }

            try {
                const name = entry.name;
                const md5ext = entry.md5ext;
                if (typeof name !== 'string' || typeof md5ext !== 'string' || this.getAsset(name)) {
                    continue;
                }

                const asset = await AssetUtil.getByMd5ext(this.runtime, zip, this.assetType, md5ext);
                this.addAsset(name, asset);
            } catch (e) {
                log.error('could not add custom asset', e);
            }
        }
    }
}

module.exports = AssetManager;
