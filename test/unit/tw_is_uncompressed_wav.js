const {test} = require('tap');
const isUncompressedWav = require('../../src/util/is-uncompressed-wav');

const wav = (format, {listChunk = false, oddChunk = false} = {}) => {
    const parts = [];
    if (listChunk) parts.push(Buffer.from('LIST'), Buffer.from([4, 0, 0, 0]), Buffer.from('INFO'));
    if (oddChunk) parts.push(Buffer.from('junk'), Buffer.from([3, 0, 0, 0]), Buffer.from([1, 2, 3, 0]));
    const fmt = Buffer.alloc(16);
    fmt.writeUInt16LE(format, 0);
    parts.push(Buffer.from('fmt '), Buffer.from([16, 0, 0, 0]), fmt);
    parts.push(Buffer.from('data'), Buffer.from([0, 0, 0, 0]));
    const body = Buffer.concat(parts);
    const size = Buffer.alloc(4);
    size.writeUInt32LE(body.length + 4, 0);
    return new Uint8Array(Buffer.concat([Buffer.from('RIFF'), size, Buffer.from('WAVE'), body]));
};

test('PCM, float and extensible WAV files are uncompressed', t => {
    t.ok(isUncompressedWav(wav(0x0001)));
    t.ok(isUncompressedWav(wav(0x0003)));
    t.ok(isUncompressedWav(wav(0xFFFE)));
    t.end();
});

test('ADPCM and other encodings are compressed', t => {
    t.notOk(isUncompressedWav(wav(0x0011)));
    t.notOk(isUncompressedWav(wav(0x0002)));
    t.notOk(isUncompressedWav(wav(0x0055)));
    t.end();
});

test('fmt chunks after other chunks are found, including odd-sized ones', t => {
    t.notOk(isUncompressedWav(wav(0x0011, {listChunk: true})));
    t.notOk(isUncompressedWav(wav(0x0011, {oddChunk: true})));
    t.ok(isUncompressedWav(wav(0x0001, {listChunk: true, oddChunk: true})));
    t.end();
});

test('anything that is not a parseable WAV file is treated as uncompressed', t => {
    t.ok(isUncompressedWav(new Uint8Array(0)));
    t.ok(isUncompressedWav(new Uint8Array([1, 2, 3])));
    t.ok(isUncompressedWav(new TextEncoder().encode('not a wav file at all')));
    t.ok(isUncompressedWav(wav(0x0011).subarray(0, 21)));
    t.ok(isUncompressedWav('RIFF'));
    t.ok(isUncompressedWav(null));
    t.end();
});
