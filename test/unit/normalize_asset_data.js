const test = require('tap').test;
const vm = require('vm');
const JSZip = require('@turbowarp/jszip');
const normalize = require('../../src/util/normalize-asset-data');
const VirtualMachine = require('../../src/virtual-machine');

test('archive serialization preserves foreign binary views and their bounds', async t => {
    const data = vm.runInNewContext('new Uint8Array([99, 1, 2, 3, 88]).subarray(1, 4)');
    t.notOk(data instanceof Uint8Array, 'fixture belongs to another realm');
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
    t.same(Array.from(await restored.file('costume.png').async('uint8array')), [1, 2, 3]);
    t.same(Array.from(data), [1, 2, 3], 'original data is untouched');
    machine.runtime.targets = [];
    machine.quit();
});

test('normalization preserves bytes for DataView and foreign ArrayBuffer', t => {
    const buffer = new Uint8Array([99, 1, 2, 88]).buffer;
    t.same(Array.from(normalize(new DataView(buffer, 1, 2), 'image.png')), [1, 2]);
    const foreign = vm.runInNewContext('new Uint8Array([4, 5]).buffer');
    t.same(Array.from(normalize(foreign, 'image.png')), [4, 5]);
    const bytes = new Uint8Array([6]);
    t.equal(normalize(bytes, 'image.png'), bytes, 'local bytes need no copy');
    t.end();
});

test('invalid asset data fails with its filename instead of losing the asset', t => {
    for (const data of [undefined, null, {}, {0: 1}]) {
        t.throws(() => normalize(data, 'broken.svg'), /Cannot save asset 'broken.svg'/);
    }
    t.end();
});
