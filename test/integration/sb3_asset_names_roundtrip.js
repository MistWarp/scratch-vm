const {test} = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const JSZip = require('@turbowarp/jszip');
const makeTestStorage = require('../fixtures/make-test-storage');
const VirtualMachine = require('../../src/index');

const md5 = data => crypto.createHash('md5').update(data)
    .digest('hex');

const oggData = Buffer.from('OggS not really vorbis');
const svgData = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>');

const fakeAudioEngine = {
    createBank: () => ({addSoundPlayer () {}}),
    decodeSoundPlayer: () => Promise.resolve({id: 'player', buffer: {sampleRate: 44100, length: 8}}),
    decodeSoundBuffer: () => Promise.resolve({sampleRate: 44100, length: 8}),
    createSoundPlayer: buffer => ({id: 'player', buffer})
};

const makeProject = ({soundId, soundFile, costumeId}) => {
    const zip = new JSZip();
    zip.file('project.json', JSON.stringify({
        targets: [{
            isStage: true,
            name: 'Stage',
            variables: {},
            lists: {},
            broadcasts: {},
            blocks: {},
            comments: {},
            currentCostume: 0,
            costumes: [{
                name: 'backdrop1',
                assetId: costumeId,
                md5ext: `${costumeId}.svg`,
                dataFormat: 'svg',
                rotationCenterX: 1,
                rotationCenterY: 1
            }],
            sounds: [{
                name: 'song',
                assetId: soundId,
                md5ext: `${soundId}.ogg`,
                dataFormat: 'ogg',
                rate: 44100,
                sampleCount: 8
            }],
            volume: 100,
            layerOrder: 0
        }],
        monitors: [],
        extensions: [],
        meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
    }));
    zip.file(`${costumeId}.svg`, svgData);
    zip.file(soundFile || `${soundId}.ogg`, oggData);
    return zip.generateAsync({type: 'uint8array'});
};

const loadAndSave = async project => {
    const vm = new VirtualMachine();
    vm.attachStorage(makeTestStorage());
    vm.attachAudioEngine(fakeAudioEngine);
    await vm.loadProject(project);
    const saved = await vm.saveProjectSb3('uint8array');
    const zip = await JSZip.loadAsync(saved);
    const json = JSON.parse(await zip.file('project.json').async('string'));
    return {vm, saved, zip, stage: json.targets[0]};
};

const assertFilesMatchProject = ({zip, stage}) => {
    for (const asset of [...stage.costumes, ...stage.sounds]) {
        assert.ok(zip.file(asset.md5ext), `${asset.md5ext} should be in the saved project`);
        assert.strictEqual(asset.md5ext, `${asset.assetId}.${asset.dataFormat}`);
    }
};

test('OGG sounds stay OGG and keep their file through two saves', async () => {
    const first = await loadAndSave(await makeProject({soundId: md5(oggData), costumeId: md5(svgData)}));
    assert.strictEqual(first.stage.sounds[0].md5ext, `${md5(oggData)}.ogg`);
    assertFilesMatchProject(first);

    const second = await loadAndSave(first.saved);
    assert.ok(!second.vm.runtime.targets[0].getSounds()[0].broken);
    assert.strictEqual(second.stage.sounds[0].md5ext, `${md5(oggData)}.ogg`);
    assertFilesMatchProject(second);
});

test('assets listed under another hash are saved under the name of their data', async () => {
    const saved = await loadAndSave(await makeProject({
        soundId: '0123456789abcdef0123456789abcdef',
        costumeId: 'fedcba9876543210fedcba9876543210'
    }));
    assert.strictEqual(saved.stage.sounds[0].md5ext, `${md5(oggData)}.ogg`);
    assert.strictEqual(saved.stage.costumes[0].md5ext, `${md5(svgData)}.svg`);
    assertFilesMatchProject(saved);
});

test('a sound listed as .ogg but stored as .mp3 still loads', async () => {
    const soundId = md5(oggData);
    const saved = await loadAndSave(await makeProject({
        soundId,
        soundFile: `${soundId}.mp3`,
        costumeId: md5(svgData)
    }));
    assert.ok(!saved.vm.runtime.targets[0].getSounds()[0].broken);
    assert.strictEqual(saved.stage.sounds[0].md5ext, `${soundId}.mp3`);
    assertFilesMatchProject(saved);
});
