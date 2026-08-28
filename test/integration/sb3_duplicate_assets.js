const {test} = require('tap');
const Runtime = require('../../src/engine/runtime');
const sb3 = require('../../src/serialization/sb3');
const makeTestStorage = require('../fixtures/make-test-storage');
const FakeRenderer = require('../fixtures/fake-renderer');
const FakeBitmapAdapter = require('../fixtures/fake-bitmap-adapter');
const makeProject = require('../fixtures/duplicate-asset-project');

const makeAudioEngine = counters => ({
    createBank: () => ({
        players: [],
        addSoundPlayer (player) {
            this.players.push(player);
        }
    }),
    decodeSoundBuffer: sound => {
        counters.decodes++;
        return Promise.resolve({
            source: sound.data[0],
            sampleRate: 44100,
            length: 8
        });
    },
    createSoundPlayer: buffer => ({
        id: ++counters.playerId,
        buffer
    })
});

const makeRuntime = () => {
    const originalCreateImageBitmap = global.createImageBitmap;
    const runtime = new Runtime();
    const storage = makeTestStorage();
    const counters = {decodes: 0, imageDecodes: 0, playerId: 0};
    const assets = {
        'image-0': storage.createAsset(storage.AssetType.ImageBitmap, 'png', new Uint8Array([1]), 'image-0'),
        'image-1': storage.createAsset(storage.AssetType.ImageBitmap, 'png', new Uint8Array([2]), 'image-1'),
        'sound-0': storage.createAsset(storage.AssetType.Sound, 'wav', new Uint8Array([1]), 'sound-0'),
        'sound-1': storage.createAsset(storage.AssetType.Sound, 'wav', new Uint8Array([2]), 'sound-1')
    };
    const loads = new Map();
    storage.load = (assetType, assetId) => {
        loads.set(assetId, (loads.get(assetId) || 0) + 1);
        return Promise.resolve(assets[assetId] || null);
    };
    runtime.attachStorage(storage);
    runtime.attachRenderer(new FakeRenderer());
    runtime.attachV2BitmapAdapter(new FakeBitmapAdapter());
    runtime.attachAudioEngine(makeAudioEngine(counters));
    global.createImageBitmap = () => {
        counters.imageDecodes++;
        return Promise.resolve({width: 2, height: 2});
    };
    const restoreGlobals = () => {
        if (originalCreateImageBitmap) {
            global.createImageBitmap = originalCreateImageBitmap;
        } else {
            delete global.createImageBitmap;
        }
    };
    return {runtime, loads, counters, restoreGlobals};
};

test('SB3 loading deduplicates asset work but preserves every reference', async t => {
    const {runtime, loads, counters, restoreGlobals} = makeRuntime();
    t.teardown(restoreGlobals);
    const progress = [];
    runtime.on(Runtime.ASSET_PROGRESS, (finished, total, detail) => {
        if (detail) progress.push({finished, total, detail});
    });

    const result = await sb3.deserialize(makeProject(), runtime, null);
    const target = result.targets[0];

    t.same(Object.fromEntries(loads), {
        'image-0': 1,
        'image-1': 1,
        'sound-0': 1,
        'sound-1': 1
    }, 'each unique storage URL is requested once');
    t.equal(counters.decodes, 2, 'each unique sound is decoded once');
    t.equal(counters.imageDecodes, 2, 'each unique bitmap is decoded once');
    t.equal(target.sprite.costumes.length, 60, 'all costume references are attached');
    t.equal(new Set(target.sprite.costumes.map(costume => costume.skinId)).size, 60,
        'each costume reference keeps a separate renderer skin');
    t.equal(target.sprite.sounds.length, 40, 'all sound references are attached');
    t.equal(new Set(target.sprite.sounds.map(sound => sound.soundId)).size, 40,
        'each sound reference has a separate player');
    t.ok(target.sprite.costumes.every((costume, index) => costume.name === `costume ${index}`),
        'per-reference costume metadata is preserved');
    t.ok(progress.every((entry, index) => index === 0 || entry.finished >= progress[index - 1].finished),
        'overall progress is monotonic');
    t.same([...new Set(progress.map(entry => entry.detail.phase))], ['download', 'prepare'],
        'progress distinguishes download and preparation work');
    t.equal(progress[progress.length - 1].finished, progress[progress.length - 1].total,
        'progress completes after every reference is prepared');
});

test('a failed project-scoped asset entry is retried by the next load', async t => {
    const {runtime, loads, restoreGlobals} = makeRuntime();
    t.teardown(restoreGlobals);
    const retryProject = makeProject();
    retryProject.targets[0].costumes = retryProject.targets[0].costumes.slice(0, 1);
    retryProject.targets[0].sounds = [];
    const originalLoad = runtime.storage.load.bind(runtime.storage);
    let failOnce = true;
    runtime.storage.load = (assetType, assetId, format) => {
        if (assetId === 'image-0' && failOnce) {
            failOnce = false;
            loads.set(assetId, (loads.get(assetId) || 0) + 1);
            return Promise.reject(new Error('temporary failure'));
        }
        return originalLoad(assetType, assetId, format);
    };

    await sb3.deserialize(retryProject, runtime, null);
    await sb3.deserialize(retryProject, runtime, null);

    t.equal(loads.get('image-0'), 2, 'the second project load retries the failed asset');
});
