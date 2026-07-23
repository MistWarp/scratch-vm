const assert = require('assert');
const extensions = require('../../../src/extensions/rotur');

const SECRET = 'rotur_SECRET_TOKEN';

const makeRuntime = () => ({
    projectName: 'test',
    targets: [{blocks: {_blocks: {}}}],
    roturHost: {
        getUser: () => ({loggedIn: true, username: 'alice', id: '1', token: SECRET, key: SECRET}),
        ensureConsent: () => Promise.resolve(true),
        grantedScopes: () => [],
        call: () => Promise.resolve({ok: true, token: SECRET})
    }
});

const containsSecret = value => {
    if (value === null || typeof value === 'undefined') return false;
    return String(value).includes(SECRET);
};

const run = async () => {
    for (const [name, Extension] of Object.entries(extensions)) {
        const runtime = makeRuntime();
        const instance = new Extension(runtime);
        const info = instance.getInfo();

        for (const block of info.blocks) {
            if (block === '---' || block.blockType === 'label') continue;
            assert.ok(
                !/token/i.test(block.opcode) && !/token/i.test(block.text || ''),
                `${name}.${block.opcode} must not expose a token block`
            );
        }

        for (const block of info.blocks) {
            if (block === '---' || block.blockType === 'label') continue;
            const handler = instance[block.opcode];
            if (typeof handler !== 'function') continue;
            const args = Object.fromEntries(
                Object.keys(block.arguments || {}).map(key => [key, 'x'])
            );
            // eslint-disable-next-line no-await-in-loop
            const result = await handler(args);
            assert.ok(
                !containsSecret(result),
                `${name}.${block.opcode} leaked the token in its return value`
            );
        }
    }
    // eslint-disable-next-line no-console
    console.log('rotur token-safety self-check passed');
};

run().catch(error => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
});
