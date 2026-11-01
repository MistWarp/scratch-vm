const {test} = require('node:test');
const assert = require('node:assert');
const ExtensionManager = require('../../src/extension-support/extension-manager');
const VM = require('../../src/virtual-machine');

test('isBuiltinExtension', () => {
    const fakeRuntime = {};
    const manager = new ExtensionManager(fakeRuntime);
    assert.strictEqual(manager.isBuiltinExtension('pen'), true);
    assert.strictEqual(manager.isBuiltinExtension('lksdfjlskdf'), false);
});

test('_resolveExtensionURL', () => {
    const fakeRuntime = {};
    const manager = new ExtensionManager(fakeRuntime);
    const originalLocation = global.location;
    global.location = {href: 'https://mistwarp.org/editor'};

    assert.strictEqual(manager._resolveExtensionURL('https://extensions.turbowarp.org/fetch.js'),
        'https://extensions.turbowarp.org/fetch.js', 'absolute URLs pass through unchanged');
    assert.strictEqual(manager._resolveExtensionURL('data:application/javascript;base64,YWxlcnQoMSk='),
        'data:application/javascript;base64,YWxlcnQoMSk=');

    assert.strictEqual(manager._resolveExtensionURL('extensions/OSLUtils.js'), 'https://mistwarp.org/extensions/OSLUtils.js',
        'a project-relative reference resolves against the page');
    assert.strictEqual(manager._isValidExtensionURL(manager._resolveExtensionURL('extensions/OSLUtils.js')), true,
        'and is then accepted instead of rejected as an invalid URL');
    assert.strictEqual(new URL(manager._resolveExtensionURL('../../../etc/passwd')).origin, 'https://mistwarp.org',
        'resolving never escapes the page origin');

    global.location = originalLocation;
});

test('_isValidExtensionURL', () => {
    const fakeRuntime = {};
    const manager = new ExtensionManager(fakeRuntime);
    assert.strictEqual(manager._isValidExtensionURL('fetch'), false);
    assert.strictEqual(manager._isValidExtensionURL(''), false);
    assert.strictEqual(manager._isValidExtensionURL('extensions.turbowarp.org/fetch.js'), false);
    assert.strictEqual(manager._isValidExtensionURL('https://extensions.turbowarp.org/fetch.js'), true);
    assert.strictEqual(manager._isValidExtensionURL('http://extensions.turbowarp.org/fetch.js'), true);
    assert.strictEqual(manager._isValidExtensionURL('http://localhost:8000'), true);
    assert.strictEqual(manager._isValidExtensionURL('data:application/javascript;base64,YWxlcnQoMSk='), true);
    assert.strictEqual(manager._isValidExtensionURL('file:///home/test/extension.js'), true);
});

test('setExtensionOrder applies saved order and keeps omitted extensions', async () => {
    const vm = new VM();
    const manager = vm.extensionManager;
    manager._loadedExtensions = new Map([
        ['first', 'service.first'],
        ['second', 'service.second'],
        ['third', 'service.third']
    ]);

    await manager.setExtensionOrder(['third', 'first']);

    assert.deepStrictEqual(Array.from(manager._loadedExtensions.keys()), ['third', 'first', 'second']);
});

test('inline extensions use the configured sandbox', async () => {
    const vm = new VM();
    const source = 'data:application/javascript,';
    vm.extensionManager.securityManager.getSandboxMode = url => {
        assert.strictEqual(url, source);
        return 'invalid';
    };

    await assert.rejects(vm.extensionManager.loadExtensionURL(source), /Invalid sandbox mode/);
});

test('project-local extension references can be rewritten to valid URLs', async () => {
    const vm = new VM();
    const storedReference = 'extensions/SPanimations.js';
    const sourceURL = 'https://example.com/saved-extension-source.js';
    vm.extensionManager.securityManager.getSandboxMode = url => {
        assert.strictEqual(url, storedReference);
        return 'invalid';
    };
    vm.extensionManager.securityManager.rewriteExtensionURL = url => {
        assert.strictEqual(url, storedReference);
        return sourceURL;
    };

    await assert.rejects(vm.extensionManager.loadExtensionURL(storedReference), /Invalid sandbox mode/);
});

test('invalid extension references are rejected when they are not rewritten', async () => {
    const vm = new VM();
    const storedReference = 'extensions/SPanimations.js';

    await assert.rejects(vm.extensionManager.loadExtensionURL(storedReference), /Invalid extension URL/);
});

test('loadExtensionURL, getExtensionURLs, deduplication', async () => {
    const vm = new VM();

    let loadedExtensions = 0;
    vm.extensionManager.securityManager.getSandboxMode = () => 'unsandboxed';
    global.document = {
        createElement: () => {
            loadedExtensions++;
            const element = {};
            setTimeout(() => {
                global.Scratch.extensions.register({
                    getInfo: () => ({
                        id: `extension${loadedExtensions}`
                    })
                });
            });
            return element;
        },
        body: {
            appendChild: () => {}
        }
    };
    global.window = {
        addEventListener: () => {},
        removeEventListener: () => {}
    };

    const url1 = 'https://turbowarp.org/1.js';
    assert.strictEqual(vm.extensionManager.isExtensionURLLoaded(url1), false);
    assert.deepEqual(vm.extensionManager.getExtensionURLs(), {});
    await vm.extensionManager.loadExtensionURL(url1);
    assert.strictEqual(vm.extensionManager.isExtensionURLLoaded(url1), true);
    assert.strictEqual(loadedExtensions, 1);
    assert.deepEqual(vm.extensionManager.getExtensionURLs(), {
        extension1: url1
    });

    // Loading the extension again should do nothing.
    await vm.extensionManager.loadExtensionURL(url1);
    assert.strictEqual(vm.extensionManager.isExtensionURLLoaded(url1), true);
    assert.strictEqual(loadedExtensions, 1);
    assert.deepEqual(vm.extensionManager.getExtensionURLs(), {
        extension1: url1
    });

    // Loading another extension should work
    const url2 = 'https://turbowarp.org/2.js';
    assert.strictEqual(vm.extensionManager.isExtensionURLLoaded(url2), false);
    await vm.extensionManager.loadExtensionURL(url2);
    assert.strictEqual(vm.extensionManager.isExtensionURLLoaded(url2), true);
    assert.strictEqual(loadedExtensions, 2);
    assert.deepEqual(vm.extensionManager.getExtensionURLs(), {
        extension1: url1,
        extension2: url2
    });
});

test('dynamic extension menus tolerate missing methods and empty results', () => {
    const vm = new VM();
    for (const extension of [{}, {menu: 1}, {menu: () => null}, {menu: () => []}]) {
        assert.deepStrictEqual(vm.extensionManager._getExtensionMenuItems(extension, 'menu'), [['', '']]);
    }
    assert.deepStrictEqual(vm.extensionManager._getExtensionMenuItems({menu: () => ['hello']}, 'menu'),
        [['hello', 'hello']]);
    vm.quit();
});

test('a failed extension load does not reject other loads waiting for extensions', async () => {
    const manager = new ExtensionManager({});
    manager.loadingAsyncExtensions = 2;
    const waiting = manager.allAsyncExtensionsLoaded();
    assert.throws(() => manager._failedLoadingExtensionScript(new Error('failed')), /failed/);
    assert.strictEqual(manager.loadingAsyncExtensions, 1);
    manager._finishedLoadingExtensionScript();
    await waiting;
    assert.strictEqual(manager.loadingAsyncExtensions, 0);
});
