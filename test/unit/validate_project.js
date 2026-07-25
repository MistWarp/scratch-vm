const test = require('tap').test;

const unpackPath = require.resolve('scratch-parser/lib/unpack');
const validatePath = require.resolve('../../src/serialization/validate-project');
const originalUnpack = require(unpackPath);

require.cache[unpackPath].exports = () => {
    throw new Error('scratch-parser unpack was used');
};
delete require.cache[validatePath];
const validateProject = require(validatePath);
require.cache[unpackPath].exports = originalUnpack;

test('raw project bytes use native decoding', t => {
    const project = {
        targets: [],
        monitors: [],
        extensions: [],
        meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
    };
    const bytes = new TextEncoder().encode(JSON.stringify(project));
    validateProject(bytes, false, (error, result) => {
        t.error(error);
        t.equal(result[0].projectVersion, 3);
        t.end();
    });
});
