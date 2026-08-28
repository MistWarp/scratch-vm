const test = require('tap').test;

const {deserializeSound} = require('../../src/serialization/deserialize-assets');
const {serializeSounds} = require('../../src/serialization/serialize-assets');

test('deserializeSound preserves compressed OGG assets', async t => {
    const bytes = new Uint8Array([0x4f, 0x67, 0x67, 0x53]);
    const soundFile = {
        async: async format => {
            t.equal(format, 'uint8array');
            return bytes;
        }
    };
    const zip = {
        file: name => name === 'sound.ogg' ? soundFile : null
    };
    const storage = {
        AssetType: {Sound: 'sound'},
        DataFormat: {MP3: 'mp3', WAV: 'wav'},
        createAsset: (assetType, dataFormat, data) => {
            t.equal(assetType, 'sound');
            t.equal(dataFormat, 'ogg');
            t.same(data, bytes);
            return {assetId: 'sound', data, dataFormat};
        }
    };
    const sound = {
        dataFormat: 'ogg',
        md5: 'sound.ogg',
        name: 'Music'
    };

    await deserializeSound(sound, {storage}, zip);

    t.equal(sound.asset.dataFormat, 'ogg');
    t.equal(sound.md5, 'sound.ogg');
    t.same(serializeSounds({targets: [{sprite: {sounds: [sound]}}]}), [{
        fileName: 'sound.ogg',
        fileContent: bytes
    }]);
});
