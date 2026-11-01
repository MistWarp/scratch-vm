const {test} = require('node:test');
const assert = require('node:assert');

const {deserializeSound} = require('../../src/serialization/deserialize-assets');
const {serializeSounds} = require('../../src/serialization/serialize-assets');

test('deserializeSound preserves compressed OGG assets', async () => {
    const bytes = new Uint8Array([0x4f, 0x67, 0x67, 0x53]);
    const soundFile = {
        async: async format => {
            assert.strictEqual(format, 'uint8array');
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
            assert.strictEqual(assetType, 'sound');
            assert.strictEqual(dataFormat, 'ogg');
            assert.deepStrictEqual(data, bytes);
            return {assetId: 'sound', data, dataFormat};
        }
    };
    const sound = {
        dataFormat: 'ogg',
        md5: 'sound.ogg',
        name: 'Music'
    };

    await deserializeSound(sound, {storage}, zip);

    assert.strictEqual(sound.asset.dataFormat, 'ogg');
    assert.strictEqual(sound.md5, 'sound.ogg');
    assert.deepStrictEqual(serializeSounds({targets: [{sprite: {sounds: [sound]}}]}), [{
        fileName: 'sound.ogg',
        fileContent: bytes
    }]);
});
