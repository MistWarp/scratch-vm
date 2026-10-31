const {test} = require('tap');

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

test('resolves once the script has run', async t => {
    const {appended, listeners, run} = setup();
    const promise = load()('https://example.com/a.js');
    run(appended[0], () => {});
    appended[0].onload();
    await promise;
    t.equal(listeners.size, 0);
    t.end();
});

test('rejects when the script throws while running', async t => {
    const {appended, listeners, run} = setup();
    const promise = load()('https://example.com/a.js');
    run(appended[0], () => {
        throw new Error('boom');
    });
    appended[0].onload();
    await t.rejects(promise, /encountered runtime error: Error: boom/);
    t.equal(listeners.size, 0);
    t.end();
});

test('ignores errors from other scripts and hides data: URLs', async t => {
    const {appended, run} = setup();
    const promise = load()('data:text/javascript,1');
    run({}, () => {
        throw new Error('other script');
    });
    appended[0].onerror();
    await t.rejects(promise, /^Custom extension could not be loaded/);
    t.end();
});
