const {test} = require('node:test');
const assert = require('node:assert');
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

test('PCM, float and extensible WAV files are uncompressed', () => {
    assert.ok(isUncompressedWav(wav(0x0001)));
    assert.ok(isUncompressedWav(wav(0x0003)));
    assert.ok(isUncompressedWav(wav(0xFFFE)));
});

test('ADPCM and other encodings are compressed', () => {
    assert.ok(!isUncompressedWav(wav(0x0011)));
    assert.ok(!isUncompressedWav(wav(0x0002)));
    assert.ok(!isUncompressedWav(wav(0x0055)));
});

test('fmt chunks after other chunks are found, including odd-sized ones', () => {
    assert.ok(!isUncompressedWav(wav(0x0011, {listChunk: true})));
    assert.ok(!isUncompressedWav(wav(0x0011, {oddChunk: true})));
    assert.ok(isUncompressedWav(wav(0x0001, {listChunk: true, oddChunk: true})));
});

test('anything that is not a parseable WAV file is treated as uncompressed', () => {
    assert.ok(isUncompressedWav(new Uint8Array(0)));
    assert.ok(isUncompressedWav(new Uint8Array([1, 2, 3])));
    assert.ok(isUncompressedWav(new TextEncoder().encode('not a wav file at all')));
    assert.ok(isUncompressedWav(wav(0x0011).subarray(0, 21)));
    assert.ok(isUncompressedWav('RIFF'));
    assert.ok(isUncompressedWav(null));
});
