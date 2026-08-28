const JSZip = require('@turbowarp/jszip');
const log = require('../util/log');

// A single asset can be referenced by several sprites. JSZip otherwise
// inflates it, hashes it, and creates the same storage asset once per reference.
// Key first by storage so a zip reused with another runtime cannot return an
// asset created by an incompatible storage instance. Weak keys allow both
// levels to disappear after loading.
const assetPromises = new WeakMap();

const createAssetOnce = function (file, storage, assetType, dataFormat, assetId, generateId) {
    let byFile = assetPromises.get(storage);
    if (!byFile) {
        byFile = new WeakMap();
        assetPromises.set(storage, byFile);
    }
    let byType = byFile.get(file);
    if (!byType) {
        byType = new Map();
        byFile.set(file, byType);
    }
    const assetTypeName = assetType && assetType.name ? assetType.name : String(assetType);
    const key = `${assetTypeName}\0${dataFormat}\0${assetId || ''}\0${generateId ? '1' : '0'}`;
    let promise = byType.get(key);
    if (!promise) {
        promise = file.async('uint8array')
            .then(data => storage.createAsset(assetType, dataFormat, data, assetId, generateId));
        byType.set(key, promise);
        promise.catch(() => {
            if (byType.get(key) === promise) byType.delete(key);
        });
    }
    return promise;
};

/**
 * Deserializes sound from file into storage cache so that it can
 * be loaded into the runtime.
 * @param {object} sound Descriptor for sound from sb3 file
 * @param {Runtime} runtime The runtime containing the storage to cache the sounds in
 * @param {JSZip} zip The zip containing the sound file being described by `sound`
 * @param {string} assetFileName Optional file name for the given asset
 * (sb2 files have filenames of the form [int].[ext],
 * sb3 files have filenames of the form [md5].[ext])
 * @return {Promise} Promise that resolves after the described sound has been stored
 * into the runtime storage cache, the sound was already stored, or an error has
 * occurred.
 */
const deserializeSound = function (sound, runtime, zip, assetFileName) {
    const fileName = assetFileName ? assetFileName : sound.md5;
    const storage = runtime.storage;
    if (!storage) {
        log.warn('No storage module present; cannot load sound asset: ', fileName);
        return Promise.resolve(null);
    }

    if (!zip) { // Zip will not be provided if loading project json from server
        return Promise.resolve(null);
    }

    let soundFile = zip.file(fileName);
    if (!soundFile) {
        // look for assetfile in a flat list of files, or in a folder
        const fileMatch = new RegExp(`^([^/]*/)?${fileName}$`);
        soundFile = zip.file(fileMatch)[0]; // use first matching file
    }

    if (!soundFile) {
        log.error(`Could not find sound file associated with the ${sound.name} sound.`);
        return Promise.resolve(null);
    }

    if (!JSZip.support.uint8array) {
        log.error('JSZip uint8array is not supported in this browser.');
        return Promise.resolve(null);
    }

    const requestedFormat = sound.dataFormat.toLowerCase();
    let dataFormat = storage.DataFormat.WAV;
    if (requestedFormat === 'mp3') {
        dataFormat = storage.DataFormat.MP3;
    } else if (requestedFormat === 'ogg') {
        dataFormat = storage.DataFormat.OGG || 'ogg';
    }
    return createAssetOnce(
        soundFile,
        storage,
        storage.AssetType.Sound,
        dataFormat,
        null,
        true
    )
        .then(asset => {
            sound.asset = asset;
            sound.assetId = asset.assetId;
            sound.md5 = `${asset.assetId}.${asset.dataFormat}`;
        });
};

/**
 * Deserializes costume from file into storage cache so that it can
 * be loaded into the runtime.
 * @param {object} costume Descriptor for costume from sb3 file
 * @param {Runtime} runtime The runtime containing the storage to cache the costumes in
 * @param {JSZip} zip The zip containing the costume file being described by `costume`
 * @param {string} assetFileName Optional file name for the given asset
 * (sb2 files have filenames of the form [int].[ext],
 * sb3 files have filenames of the form [md5].[ext])
 * @param {string} textLayerFileName Optional file name for the given asset's text layer
 * (sb2 only; files have filenames of the form [int].png)
 * @return {Promise} Promise that resolves after the described costume has been stored
 * into the runtime storage cache, the costume was already stored, or an error has
 * occurred.
 */
const deserializeCostume = function (costume, runtime, zip, assetFileName, textLayerFileName) {
    const storage = runtime.storage;
    const assetId = costume.assetId;
    const fileName = assetFileName ? assetFileName :
        `${assetId}.${costume.dataFormat}`;

    if (!storage) {
        log.warn('No storage module present; cannot load costume asset: ', fileName);
        return Promise.resolve(null);
    }

    if (costume.asset) {
        // When uploading a sprite from an image file, the asset data will be provided
        // @todo Cache the asset data somewhere and pull it out here
        return Promise.resolve(storage.createAsset(
            costume.asset.assetType,
            costume.asset.dataFormat,
            new Uint8Array(Object.keys(costume.asset.data).map(key => costume.asset.data[key])),
            null,
            true
        )).then(asset => {
            costume.asset = asset;
            costume.assetId = asset.assetId;
            costume.md5 = `${asset.assetId}.${asset.dataFormat}`;
        });
    }

    if (!zip) {
        // Zip will not be provided if loading project json from server
        return Promise.resolve(null);
    }

    let costumeFile = zip.file(fileName);
    if (!costumeFile) {
        // look for assetfile in a flat list of files, or in a folder
        const fileMatch = new RegExp(`^([^/]*/)?${fileName}$`);
        costumeFile = zip.file(fileMatch)[0]; // use the first matched file
    }

    if (!costumeFile) {
        log.error(`Could not find costume file associated with the ${costume.name} costume.`);
        return Promise.resolve(null);
    }
    let assetType = null;
    const costumeFormat = costume.dataFormat.toLowerCase();
    if (costumeFormat === 'svg') {
        assetType = storage.AssetType.ImageVector;
    } else if (['png', 'bmp', 'jpeg', 'jpg', 'gif'].indexOf(costumeFormat) >= 0) {
        assetType = storage.AssetType.ImageBitmap;
    } else {
        log.error(`Unexpected file format for costume: ${costumeFormat}`);
    }
    if (!JSZip.support.uint8array) {
        log.error('JSZip uint8array is not supported in this browser.');
        return Promise.resolve(null);
    }

    // textLayerMD5 exists if there is a text layer, which is a png of text from Scratch 1.4
    // that was opened in Scratch 2.0. In this case, set costume.textLayerAsset.
    let textLayerFilePromise;
    if (costume.textLayerMD5) {
        const textLayerFile = zip.file(textLayerFileName);
        if (!textLayerFile) {
            log.error(`Could not find text layer file associated with the ${costume.name} costume.`);
            return Promise.resolve(null);
        }
        textLayerFilePromise = createAssetOnce(
            textLayerFile,
            storage,
            storage.AssetType.ImageBitmap,
            'png',
            costume.textLayerMD5,
            false
        )
            .then(asset => {
                costume.textLayerAsset = asset;
            });
    } else {
        textLayerFilePromise = Promise.resolve(null);
    }

    return Promise.all([textLayerFilePromise,
        createAssetOnce(
            costumeFile,
            storage,
            assetType,
            // TODO eventually we want to map non-png's to their actual file types?
            costumeFormat,
            null,
            true
        )
            .then(asset => {
                costume.asset = asset;
                costume.assetId = asset.assetId;
                costume.md5 = `${asset.assetId}.${asset.dataFormat}`;
            })
    ]);
};

module.exports = {
    deserializeSound,
    deserializeCostume
};
