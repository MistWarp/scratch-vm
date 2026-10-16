const test = require('tap').test;
const AssetManager = require('../../src/engine/mw-asset-manager');

test('replacing an asset keeps its position and emits change', t => {
    const manager = new AssetManager({});
    manager.addAsset('a.txt', {id: 1});
    manager.addAsset('data/b.txt', {id: 2});
    let changes = 0;
    manager.on('change', () => changes++);
    manager.addAsset('A.TXT', {id: 3});
    t.same(manager.assets.map(entry => entry.name), ['A.TXT', 'data/b.txt']);
    t.equal(manager.assets[0].asset.id, 3);
    t.equal(changes, 1);
    t.end();
});
