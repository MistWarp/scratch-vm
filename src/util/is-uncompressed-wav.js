const WAVE_FORMAT_PCM = 0x0001;
const WAVE_FORMAT_IEEE_FLOAT = 0x0003;
const WAVE_FORMAT_EXTENSIBLE = 0xFFFE;

const readTag = (bytes, offset) => String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3]
);

const isUncompressedWav = data => {
    if (!(data instanceof Uint8Array) || data.byteLength < 12) return true;
    if (readTag(data, 0) !== 'RIFF' || readTag(data, 8) !== 'WAVE') return true;
    let offset = 12;
    while (offset + 8 <= data.byteLength) {
        const size = (data[offset + 4] | (data[offset + 5] << 8) | (data[offset + 6] << 16) |
            (data[offset + 7] << 24)) >>> 0;
        if (readTag(data, offset) === 'fmt ') {
            if (offset + 10 > data.byteLength) return true;
            const format = data[offset + 8] | (data[offset + 9] << 8);
            return format === WAVE_FORMAT_PCM || format === WAVE_FORMAT_IEEE_FLOAT ||
                format === WAVE_FORMAT_EXTENSIBLE;
        }
        offset += 8 + size + (size & 1);
    }
    return true;
};

module.exports = isUncompressedWav;
