const {test} = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const JSZip = require('@turbowarp/jszip');
const normalize = require('../../src/util/normalize-asset-data');
const VirtualMachine = require('../../src/virtual-machine');

test('archive serialization preserves foreign binary views and their bounds', async () => {
    const data = vm.runInNewContext('new Uint8Array([99, 1, 2, 3, 88]).subarray(1, 4)');
    assert.ok(!(data instanceof Uint8Array), 'fixture belongs to another realm');
    const machine = new VirtualMachine();
    machine.runtime.targets = [{sprite: {
        costumes: [{asset: {assetId: 'costume', dataFormat: 'png', data}}],
        sounds: []
    }}];
    const files = machine.serializeAssets();
    const zip = new JSZip();
    machine._addFileDescsToZip(files, zip);
    const saved = await zip.generateAsync({type: 'uint8array'});
    const restored = await JSZip.loadAsync(saved);
    assert.deepStrictEqual(Array.from(await restored.file('costume.png').async('uint8array')), [1, 2, 3]);
    assert.deepStrictEqual(Array.from(data), [1, 2, 3], 'original data is untouched');
    machine.runtime.targets = [];
    machine.quit();
});

test('normalization preserves bytes for DataView and foreign ArrayBuffer', () => {
    const buffer = new Uint8Array([99, 1, 2, 88]).buffer;
    assert.deepStrictEqual(Array.from(normalize(new DataView(buffer, 1, 2), 'image.png')), [1, 2]);
    const foreign = vm.runInNewContext('new Uint8Array([4, 5]).buffer');
    assert.deepStrictEqual(Array.from(normalize(foreign, 'image.png')), [4, 5]);
    const bytes = new Uint8Array([6]);
    assert.strictEqual(normalize(bytes, 'image.png'), bytes, 'local bytes need no copy');
});

test('invalid asset data fails with its filename instead of losing the asset', () => {
    for (const data of [undefined, null, {}, {0: 1}]) {
        assert.throws(() => normalize(data, 'broken.svg'), /Cannot save asset 'broken.svg'/);
    }
});

test('normalizes JSON-serialized Buffer assets without accepting invalid bytes', () => {
    assert.deepStrictEqual(Array.from(normalize({type: 'Buffer', data: [0, 127, 255]}, 'image.svg')), [0, 127, 255]);
    assert.throws(() => normalize({type: 'Buffer', data: [256]}, 'image.svg'));
});
