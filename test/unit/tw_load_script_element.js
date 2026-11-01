const {test} = require('node:test');
const assert = require('node:assert');

const setup = () => {
    const listeners = new Set();
    const appended = [];
    global.window = {
        addEventListener: (type, listener) => {
            if (type === 'error') listeners.add(listener);
        },
        removeEventListener: (type, listener) => {
            if (type === 'error') listeners.delete(listener);
        }
    };
    global.document = {
        currentScript: null,
        createElement: () => ({}),
        body: {
            appendChild: script => appended.push(script)
        }
    };
    const run = (script, body) => {
        global.document.currentScript = script;
        try {
            body();
        } catch (error) {
            for (const listener of [...listeners]) listener({error, message: `Uncaught ${error}`});
        }
        global.document.currentScript = null;
    };
    return {appended, listeners, run};
};

const load = () => {
    delete require.cache[require.resolve('../../src/extension-support/tw-load-script-element')];
    return require('../../src/extension-support/tw-load-script-element');
};

test('resolves once the script has run', async () => {
    const {appended, listeners, run} = setup();
    const promise = load()('https://example.com/a.js');
    run(appended[0], () => {});
    appended[0].onload();
    await promise;
    assert.strictEqual(listeners.size, 0);
});

test('rejects when the script throws while running', async () => {
    const {appended, listeners, run} = setup();
    const promise = load()('https://example.com/a.js');
    run(appended[0], () => {
        throw new Error('boom');
    });
    appended[0].onload();
    await assert.rejects(promise, /encountered runtime error: Error: boom/);
    assert.strictEqual(listeners.size, 0);
});

test('ignores errors from other scripts and hides data: URLs', async () => {
    const {appended, run} = setup();
    const promise = load()('data:text/javascript,1');
    run({}, () => {
        throw new Error('other script');
    });
    appended[0].onerror();
    await assert.rejects(promise, {message: /^Custom extension could not be loaded/});
});
