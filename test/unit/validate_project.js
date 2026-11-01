const {test} = require('node:test');
const assert = require('node:assert');

const unpackPath = require.resolve('scratch-parser/lib/unpack');
const validatePath = require.resolve('../../src/serialization/validate-project');
const originalUnpack = require(unpackPath);

require.cache[unpackPath].exports = () => {
    throw new Error('scratch-parser unpack was used');
};
delete require.cache[validatePath];
const validateProject = require(validatePath);
require.cache[unpackPath].exports = originalUnpack;

test('raw project bytes use native decoding', (t, done) => {
    const project = {
        targets: [],
        monitors: [],
        extensions: [],
        meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
    };
    const bytes = new TextEncoder().encode(JSON.stringify(project));
    validateProject(bytes, false, (error, result) => {
        assert.ifError(error);
        assert.strictEqual(result[0].projectVersion, 3);
        done();
    });
});
