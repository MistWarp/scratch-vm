const EventEmitter = require('events');
const AssetUtil = require('../util/tw-asset-util');
const log = require('../util/log');

const FALLBACK_ASSET_TYPE = {
    contentType: 'application/octet-stream',
    name: 'CustomAsset',
    runtimeFormat: 'bin',
    immutable: true
};

const CONTENT_TYPES = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    bmp: 'image/bmp',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    wav: 'audio/wav',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    mp4: 'video/mp4',
    json: 'application/json',
    txt: 'text/plain',
    csv: 'text/csv',
    html: 'text/html'
};

const getContentType = dataFormat => CONTENT_TYPES[dataFormat] || 'application/octet-stream';

const UNSAFE_PATH_CHARS = '<>:"|?*';

const stripUnsafe = segment => Array.from(segment)
    .filter(character => character.charCodeAt(0) > 0x1f && !UNSAFE_PATH_CHARS.includes(character))
    .join('');

const normalizePath = path => String(path)
    .replace(/\\/g, '/')
    .split('/')
    .map(segment => stripUnsafe(segment.trim()))
    .filter(segment => segment !== '' && segment !== '.' && segment !== '..')
    .join('/');

const getFolder = path => {
    const index = path.lastIndexOf('/');
    return index === -1 ? '' : path.substring(0, index);
};

const getBaseName = path => {
    const index = path.lastIndexOf('/');
    return index === -1 ? path : path.substring(index + 1);
};

class AssetManager extends EventEmitter {
    constructor (runtime) {
        super();

        this.runtime = runtime;

        this.assets = [];

        this._objectURLs = new Map();
    }

    get assetType () {
        const storage = this.runtime.storage;
        if (storage && storage.AssetType && storage.AssetType.CustomAsset) {
            return storage.AssetType.CustomAsset;
        }
        return FALLBACK_ASSET_TYPE;
    }

    getUnusedName (path) {
        const normalized = normalizePath(path) || 'asset';
        if (!this.getAsset(normalized)) {
            return normalized;
        }
        const folder = getFolder(normalized);
        const base = getBaseName(normalized);
        const dot = base.lastIndexOf('.');
        const stem = dot > 0 ? base.substring(0, dot) : base;
        const extension = dot > 0 ? base.substring(dot) : '';
        const prefix = folder ? `${folder}/` : '';
        for (let i = 2; ; i++) {
            const candidate = `${prefix}${stem}${i}${extension}`;
            if (!this.getAsset(candidate)) {
                return candidate;
            }
        }
    }

    getAsset (name) {
        const normalized = normalizePath(name).toLowerCase();
        return this.assets.find(i => i.name.toLowerCase() === normalized) || null;
    }

    listFolder (folder) {
        const normalized = normalizePath(folder);
        return this.assets.filter(i => getFolder(i.name).toLowerCase() === normalized.toLowerCase());
    }

    addAsset (name, asset) {
        const normalized = normalizePath(name);
        if (!normalized) {
            return;
        }
        const existingIndex = this.assets.findIndex(i => i.name.toLowerCase() === normalized.toLowerCase());
        if (existingIndex !== -1) {
            this.releaseObjectURL(this.assets[existingIndex].name);
            this.assets.splice(existingIndex, 1);
        }
        this.assets.push({name: normalized, asset});
        this.changed();
    }

    createAsset (name, data, dataFormat) {
        const asset = this.runtime.storage.createAsset(
            this.assetType,
            dataFormat,
            data,
            null,
            true
        );
        this.addAsset(name, asset);
        return asset;
    }

    renameAsset (index, newName) {
        const entry = this.assets[index];
        const normalized = normalizePath(newName);
        if (!entry || !normalized || entry.name === normalized) {
            return;
        }
        this.releaseObjectURL(entry.name);
        const conflict = this.assets.some(i => i !== entry && i.name.toLowerCase() === normalized.toLowerCase());
        entry.name = conflict ? this.getUnusedName(normalized) : normalized;
        this.changed();
    }

    deleteAsset (index) {
        const entry = this.assets[index];
        if (!entry) {
            return;
        }
        this.releaseObjectURL(entry.name);
        this.assets.splice(index, 1);
        this.changed();
    }

    deleteAssetByName (name) {
        const normalized = normalizePath(name).toLowerCase();
        const index = this.assets.findIndex(i => i.name.toLowerCase() === normalized);
        if (index !== -1) {
            this.deleteAsset(index);
        }
    }

    getObjectURL (name) {
        const entry = this.getAsset(name);
        if (!entry) {
            return '';
        }
        if (this._objectURLs.has(entry.name)) {
            return this._objectURLs.get(entry.name);
        }
        if (typeof URL === 'undefined' || typeof Blob === 'undefined' || !URL.createObjectURL) {
            return '';
        }
        const blob = new Blob([entry.asset.data], {
            type: getContentType(entry.asset.dataFormat)
        });
        const url = URL.createObjectURL(blob);
        this._objectURLs.set(entry.name, url);
        return url;
    }

    releaseObjectURL (name) {
        const url = this._objectURLs.get(name);
        if (url) {
            URL.revokeObjectURL(url);
            this._objectURLs.delete(name);
        }
    }

    clear () {
        for (const name of Array.from(this._objectURLs.keys())) {
            this.releaseObjectURL(name);
        }
        if (this.assets.length === 0) {
            return;
        }
        this.assets = [];
        this.changed();
    }

    changed () {
        this.emit('change');
    }

    serializeJSON () {
        if (this.assets.length === 0) {
            return null;
        }

        return this.assets.map(entry => ({
            name: entry.name,
            md5ext: `${entry.asset.assetId}.${entry.asset.dataFormat}`
        }));
    }

    serializeAssets () {
        return this.assets.map(i => i.asset);
    }

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
module.exports.getContentType = getContentType;
module.exports.getFolder = getFolder;
module.exports.normalizePath = normalizePath;
