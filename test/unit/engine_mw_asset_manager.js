const {test} = require('node:test');
const assert = require('node:assert');
const AssetManager = require('../../src/engine/mw-asset-manager');

test('replacing an asset keeps its position and emits change', () => {
    const manager = new AssetManager({});
    manager.addAsset('a.txt', {id: 1});
    manager.addAsset('data/b.txt', {id: 2});
    let changes = 0;
    manager.on('change', () => changes++);
    manager.addAsset('A.TXT', {id: 3});
    assert.deepStrictEqual(manager.assets.map(entry => entry.name), ['A.TXT', 'data/b.txt']);
    assert.strictEqual(manager.assets[0].asset.id, 3);
    assert.strictEqual(changes, 1);
});
