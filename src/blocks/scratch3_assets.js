const Cast = require('../util/cast');
const Base64Util = require('../util/base64-util');
const staticFetch = require('../util/tw-static-fetch');
const {loadCostumeFromAsset} = require('../import/load-costume');
const {loadSoundFromAsset} = require('../import/load-sound');
const {getContentType, getFolder} = require('../engine/mw-asset-manager');
const log = require('../util/log');

const EXTENSIONS_BY_CONTENT_TYPE = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/ogg': 'ogg',
    'video/mp4': 'mp4',
    'application/json': 'json',
    'text/plain': 'txt',
    'text/csv': 'csv',
    'text/html': 'html'
};

const encodeText = text => {
    const encoded = new Uint8Array(text.length * 3);
    let length = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.codePointAt(i);
        if (code < 0x80) {
            encoded[length++] = code;
        } else if (code < 0x800) {
            encoded[length++] = 0xc0 | (code >> 6);
            encoded[length++] = 0x80 | (code & 0x3f);
        } else {
            encoded[length++] = 0xe0 | (code >> 12);
            encoded[length++] = 0x80 | ((code >> 6) & 0x3f);
            encoded[length++] = 0x80 | (code & 0x3f);
        }
    }
    return encoded.slice(0, length);
};

const extensionFromPath = path => {
    const base = path.substring(path.lastIndexOf('/') + 1);
    const dot = base.lastIndexOf('.');
    if (dot <= 0) {
        return '';
    }
    return base.substring(dot + 1).toLowerCase();
};

class Scratch3AssetsBlocks {
    constructor (runtime) {
        this.runtime = runtime;
    }

    getPrimitives () {
        return {
            assets_load: this.load,
            assets_unload: this.unload,
            assets_unloadall: this.unloadAll,
            assets_get: this.get,
            assets_byte: this.byteOf,
            assets_check: this.check,
            assets_set: this.set,
            assets_delete: this.deleteAsset,
            assets_allnames: this.allNames,
            assets_infolder: this.inFolder
        };
    }

    get assetManager () {
        return this.runtime.assetManager;
    }

    _getEntry (name) {
        return this.assetManager.getAsset(Cast.toString(name));
    }

    _retag (asset, assetType) {
        return this.runtime.storage.createAsset(
            assetType,
            asset.dataFormat,
            asset.data,
            asset.assetId,
            false
        );
    }

    _findSoundIndex (target, name) {
        return target.getSounds().findIndex(sound => sound.name === name);
    }

    _disposeSoundPlayer (soundBank, soundId) {
        if (!soundBank || !soundId) {
            return;
        }
        const player = soundBank.soundPlayers[soundId];
        if (player) {
            player.dispose();
            delete soundBank.soundPlayers[soundId];
        }
        soundBank.playerTargets.delete(soundId);
        const effects = soundBank.soundEffects.get(soundId);
        if (effects) {
            effects.dispose();
            soundBank.soundEffects.delete(soundId);
        }
    }

    load (args, util) {
        if (Cast.toString(args.KIND) === 'sound') {
            return this.loadSound(args, util);
        }
        return this.loadCostume(args, util);
    }

    loadCostume (args, util) {
        const entry = this._getEntry(args.ASSET);
        const target = util.target;
        if (!entry || target.getCostumeIndexByName(entry.name) !== -1) {
            return;
        }

        const storage = this.runtime.storage;
        const dataFormat = entry.asset.dataFormat;
        const assetType = dataFormat === 'svg' ?
            storage.AssetType.ImageVector :
            storage.AssetType.ImageBitmap;
        const asset = this._retag(entry.asset, assetType);

        const costume = {
            name: entry.name,
            asset: asset,
            assetId: asset.assetId,
            md5: `${asset.assetId}.${dataFormat}`,
            dataFormat: dataFormat,
            bitmapResolution: 1
        };

        return loadCostumeFromAsset(costume, this.runtime)
            .then(() => {
                target.addCostume(costume);
            })
            .catch(e => {
                log.warn(`Could not load asset "${entry.name}" as a costume`, e);
            });
    }

    loadSound (args, util) {
        const entry = this._getEntry(args.ASSET);
        const target = util.target;
        if (!entry || this._findSoundIndex(target, entry.name) !== -1) {
            return;
        }

        const storage = this.runtime.storage;
        const dataFormat = entry.asset.dataFormat;
        const asset = this._retag(entry.asset, storage.AssetType.Sound);

        const sound = {
            name: entry.name,
            asset: asset,
            assetId: asset.assetId,
            md5: `${asset.assetId}.${dataFormat}`,
            dataFormat: dataFormat,
            format: ''
        };

        return loadSoundFromAsset(sound, asset, this.runtime, target.sprite.soundBank)
            .then(() => {
                target.addSound(sound);
            })
            .catch(e => {
                log.warn(`Could not load asset "${entry.name}" as a sound`, e);
            });
    }

    unload (args, util) {
        const name = Cast.toString(args.ASSET);
        const target = util.target;

        const costumeIndex = target.getCostumeIndexByName(name);
        if (costumeIndex !== -1) {
            const costume = target.getCostumes()[costumeIndex];
            if (target.deleteCostume(costumeIndex)) {
                if (this.runtime.renderer && typeof costume.skinId === 'number') {
                    this.runtime.renderer.destroySkin(costume.skinId);
                }
            }
        }

        const soundIndex = this._findSoundIndex(target, name);
        if (soundIndex !== -1) {
            const sound = target.getSounds()[soundIndex];
            target.deleteSound(soundIndex);
            this._disposeSoundPlayer(target.sprite.soundBank, sound.soundId);
        }

        const entry = this.assetManager.getAsset(name);
        if (entry) {
            this.assetManager.releaseObjectURL(entry.name);
        }
    }

    unloadAll (args, util) {
        for (const entry of this.assetManager.assets.slice()) {
            this.unload({ASSET: entry.name}, util);
        }
    }

    check (args, util) {
        const name = Cast.toString(args.ASSET);
        if (Cast.toString(args.STATE) === 'exists') {
            return this._getEntry(name) !== null;
        }
        const target = util.target;
        return target.getCostumeIndexByName(name) !== -1 || this._findSoundIndex(target, name) !== -1;
    }

    get (args) {
        const entry = this._getEntry(args.ASSET);
        const property = Cast.toString(args.PROPERTY);
        if (!entry) {
            return property === 'size' ? 0 : '';
        }
        const asset = entry.asset;
        switch (property) {
        case 'data uri':
            return asset.encodeDataURI(getContentType(asset.dataFormat));
        case 'base64':
            return Base64Util.uint8ArrayToBase64(asset.data);
        case 'url':
            return this.assetManager.getObjectURL(entry.name);
        case 'size':
            return asset.data.length;
        case 'format':
            return asset.dataFormat;
        case 'folder':
            return getFolder(entry.name);
        default:
            return asset.decodeText();
        }
    }

    byteOf (args) {
        const entry = this._getEntry(args.ASSET);
        if (!entry) {
            return '';
        }
        const index = Cast.toNumber(args.INDEX);
        const data = entry.asset.data;
        if (index < 1 || index > data.length || index !== Math.floor(index)) {
            return '';
        }
        return data[index - 1];
    }

    allNames () {
        return this.assetManager.assets.map(entry => entry.name).join(',');
    }

    inFolder (args) {
        return this.assetManager.listFolder(Cast.toString(args.FOLDER))
            .map(entry => entry.name)
            .join(',');
    }

    set (args) {
        const name = Cast.toString(args.ASSET);
        if (!name) {
            return;
        }

        const value = Cast.toString(args.VALUE);
        const format = Cast.toString(args.FORMAT);

        if (format === 'url') {
            return this._setFromURL(name, value);
        }

        const existing = this.assetManager.getAsset(name);
        let data;
        let dataFormat;

        try {
            if (format === 'base64') {
                data = Base64Util.base64ToUint8Array(value);
                dataFormat = existing ? existing.asset.dataFormat : 'bin';
            } else {
                data = encodeText(value);
                dataFormat = existing ? existing.asset.dataFormat : 'txt';
            }
        } catch (e) {
            log.warn('could not decode a value into a custom asset', e);
            return;
        }

        this.assetManager.createAsset(existing ? existing.name : name, data, dataFormat);
    }

    async _setFromURL (name, url) {
        let response = staticFetch(url);

        if (!response) {
            let parsed;
            try {
                parsed = new URL(url);
            } catch (e) {
                log.warn(`Not a valid URL for a custom asset: ${url}`);
                return;
            }

            if (parsed.protocol !== 'data:' && parsed.protocol !== 'blob:') {
                const securityManager = this.runtime.extensionManager &&
                    this.runtime.extensionManager.securityManager;
                if (!securityManager || !await securityManager.canFetch(parsed.href)) {
                    log.warn(`Not allowed to fetch ${parsed.href} into a custom asset`);
                    return;
                }
            }

            try {
                response = await fetch(parsed.href);
            } catch (e) {
                log.warn(`Could not fetch ${parsed.href} into a custom asset`, e);
                return;
            }

            if (!response.ok) {
                log.warn(`Could not fetch ${parsed.href} into a custom asset: HTTP ${response.status}`);
                return;
            }
        }

        const buffer = await response.arrayBuffer();
        const contentType = (response.headers.get('content-type') || '')
            .split(';')[0]
            .trim()
            .toLowerCase();

        const existing = this.assetManager.getAsset(name);
        const dataFormat = EXTENSIONS_BY_CONTENT_TYPE[contentType] ||
            extensionFromPath(url.split('?')[0]) ||
            'bin';

        this.assetManager.createAsset(
            existing ? existing.name : name,
            new Uint8Array(buffer),
            dataFormat
        );
    }

    deleteAsset (args) {
        this.assetManager.deleteAssetByName(Cast.toString(args.ASSET));
    }
}

module.exports = Scratch3AssetsBlocks;
