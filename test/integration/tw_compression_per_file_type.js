const {test} = require('tap');
const fs = require('fs');
const path = require('path');
const VM = require('../../src/virtual-machine');
const makeTestStorage = require('../fixtures/make-test-storage');
const JSZip = require('@turbowarp/jszip');

test('saveProjectSb3() per-file compression', t => {
    const vm = new VM();
    vm.attachStorage(makeTestStorage());
    const fixture = fs.readFileSync(path.join(__dirname, '../fixtures/tw-mixed-file-formats.sb3'));
    vm.loadProject(fixture)
        .then(() => vm.saveProjectSb3('arraybuffer'))
        .then(buffer => JSZip.loadAsync(buffer))
        .then(zip => {
            const isCompressed = pathInZip => {
                // note: uses JSZip private APIs, not very stable, but it should be okay...
                const file = zip.files[pathInZip];
                return file._data.compression.magic === '\x08\x00';
            };

            t.ok(isCompressed('project.json'));
            t.ok(isCompressed('5cb46ddd903fc2c9976ff881df9273c9.wav'));
            t.ok(isCompressed('cd21514d0531fdffb22204e0ec5ed84a.svg'));

            t.notOk(isCompressed('0b2e50ca4107ce57416e2ceb840a6347.jpg'));
            t.notOk(isCompressed('5c8826d846c06dddeb77590e8792fb7d.png'));

            t.end();
        });
});

const wavWithFormat = (format, extraChunk) => {
    const chunks = [];
    if (extraChunk) {
        chunks.push(Buffer.from('LIST'), Buffer.from([3, 0, 0, 0]), Buffer.from([1, 2, 3, 0]));
    }
    const fmt = Buffer.alloc(16);
    fmt.writeUInt16LE(format, 0);
    fmt.writeUInt16LE(1, 2);
    fmt.writeUInt32LE(22050, 4);
    chunks.push(Buffer.from('fmt '), Buffer.from([16, 0, 0, 0]), fmt);
    const samples = Buffer.alloc(4096);
    for (let i = 0; i < samples.length; i++) samples[i] = (i * 7) & 0xff;
    const size = Buffer.alloc(4);
    size.writeUInt32LE(samples.length, 0);
    chunks.push(Buffer.from('data'), size, samples);
    const body = Buffer.concat(chunks);
    const riffSize = Buffer.alloc(4);
    riffSize.writeUInt32LE(body.length + 4, 0);
    return new Uint8Array(Buffer.concat([Buffer.from('RIFF'), riffSize, Buffer.from('WAVE'), body]));
};

test('saveProjectSb3() stores WAV files that are already compressed', t => {
    const vm = new VM();
    vm.attachStorage(makeTestStorage());
    const fixture = fs.readFileSync(path.join(__dirname, '../fixtures/tw-mixed-file-formats.sb3'));
    vm.loadProject(fixture)
        .then(() => {
            const sound = vm.runtime.targets
                .map(target => target.sprite.sounds)
                .reduce((a, b) => a.concat(b), [])
                .find(item => item.asset.dataFormat === 'wav');
            sound.asset.data = wavWithFormat(0x11, true);
            return vm.saveProjectSb3('arraybuffer');
        })
        .then(buffer => JSZip.loadAsync(buffer))
        .then(zip => {
            const file = zip.files['5cb46ddd903fc2c9976ff881df9273c9.wav'];
            t.equal(file._data.compression.magic, '\x00\x00');
            t.ok(zip.files['project.json']._data.compression.magic === '\x08\x00');
            t.end();
        });
});

test('project.json in the zip matches toJSON()', t => {
    const vm = new VM();
    vm.attachStorage(makeTestStorage());
    const fixture = fs.readFileSync(path.join(__dirname, '../fixtures/tw-mixed-file-formats.sb3'));
    vm.loadProject(fixture)
        .then(() => vm.saveProjectSb3('arraybuffer'))
        .then(buffer => JSZip.loadAsync(buffer))
        .then(zip => zip.file('project.json').async('string'))
        .then(json => {
            t.equal(json, vm.toJSON());
            t.end();
        });
});
