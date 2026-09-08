/**
 * Convert binary data from extensions and other realms to types JSZip accepts.
 * Preserve view boundaries, including DataViews and typed-array subarrays.
 * @param {*} data Asset contents
 * @param {string} fileName Asset name for diagnostics
 * @returns {*} Supported ZIP contents
 */
const normalizeAssetData = (data, fileName) => {
    if (data instanceof Uint8Array) return data;
    if (ArrayBuffer.isView(data)) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    const type = Object.prototype.toString.call(data);
    if (type === '[object ArrayBuffer]' || type === '[object SharedArrayBuffer]') {
        return new Uint8Array(data);
    }
    if (typeof data === 'string' || Array.isArray(data) || type === '[object Blob]' || type === '[object File]') {
        return data;
    }
    // Never silently omit an asset from a saved project.
    throw new TypeError(`Cannot save asset '${fileName}': unsupported asset data ${type}`);
};

module.exports = normalizeAssetData;
