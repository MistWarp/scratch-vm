const test = require('tap').test;

const {deserializeCostume, deserializeSound} = require('../../src/serialization/deserialize-assets');

test('duplicate sound references inflate and create the asset once', async t => {
    let inflateCount = 0;
    let createCount = 0;
    const file = {
        async: async () => {
            inflateCount++;
            return new Uint8Array([1, 2, 3]);
        }
    };
    const storage = {
        AssetType: {Sound: {name: 'Sound'}},
        DataFormat: {MP3: 'mp3', WAV: 'wav'},
        createAsset: (assetType, dataFormat, data) => {
            createCount++;
            return {assetId: 'shared', dataFormat, data};
        }
    };
    const zip = {file: () => file};
    const first = {dataFormat: 'mp3', md5: 'shared.mp3', name: 'first'};
    const second = {dataFormat: 'mp3', md5: 'shared.mp3', name: 'second'};

    await Promise.all([
        deserializeSound(first, {storage}, zip),
        deserializeSound(second, {storage}, zip)
    ]);

    t.equal(inflateCount, 1);
    t.equal(createCount, 1);
    t.equal(first.asset, second.asset);
});

test('duplicate costume references inflate and create the asset once', async t => {
    let inflateCount = 0;
    let createCount = 0;
    const file = {
        async: async () => {
            inflateCount++;
            return new Uint8Array([4, 5, 6]);
        }
    };
    const storage = {
        AssetType: {ImageBitmap: {name: 'ImageBitmap'}, ImageVector: {name: 'ImageVector'}},
        createAsset: (assetType, dataFormat, data) => {
            createCount++;
            return {assetId: 'shared', dataFormat, data};
        }
    };
    const zip = {file: () => file};
    const first = {assetId: 'shared', dataFormat: 'png', name: 'first'};
    const second = {assetId: 'shared', dataFormat: 'png', name: 'second'};

    await Promise.all([
        deserializeCostume(first, {storage}, zip),
        deserializeCostume(second, {storage}, zip)
    ]);

    t.equal(inflateCount, 1);
    t.equal(createCount, 1);
    t.equal(first.asset, second.asset);
});

test('zip asset cache does not cross storage instances', async t => {
    const file = {
        async: async () => new Uint8Array([7, 8, 9])
    };
    const zip = {file: () => file};
    const makeStorage = label => ({
        AssetType: {Sound: {name: 'Sound'}},
        DataFormat: {MP3: 'mp3', WAV: 'wav'},
        createAsset: (assetType, dataFormat, data) => ({
            assetId: label,
            dataFormat,
            data
        })
    });
    const first = {dataFormat: 'wav', md5: 'shared.wav', name: 'first'};
    const second = {dataFormat: 'wav', md5: 'shared.wav', name: 'second'};

    await deserializeSound(first, {storage: makeStorage('first-storage')}, zip);
    await deserializeSound(second, {storage: makeStorage('second-storage')}, zip);

    t.equal(first.asset.assetId, 'first-storage');
    t.equal(second.asset.assetId, 'second-storage');
});
