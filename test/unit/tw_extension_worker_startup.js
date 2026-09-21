const {test} = require('tap');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../../src/extension-support/extension-worker'), 'utf8');

const startWorker = behavior => {
    let finish;
    let timeout;
    const errors = new Map();
    const result = new Promise(resolve => { finish = resolve; });
    const context = {
        module: {exports: {}},
        setTimeout: callback => { timeout = callback; return 1; },
        clearTimeout: () => {},
        self: {
            addEventListener: (type, callback) => errors.set(type, callback),
            removeEventListener: type => errors.delete(type)
        },
        document: {
            createElement: () => ({}),
            body: {appendChild: script => Promise.resolve().then(() => behavior({
                script,
                register: object => context.Scratch.extensions.register(object),
                crash: () => errors.get('error')({message: 'Extension requires VM access'}),
                timeout: () => timeout()
            }))}
        }
    };
    const dispatch = {
        waitForConnection: Promise.resolve(),
        setService: () => Promise.resolve(),
        call: (service, method, ...args) => {
            if (method === 'allocateWorker') return Promise.resolve([1, 'https://example.com/extension.js']);
            if (method === 'onWorkerInit') { finish(args); return Promise.resolve(); }
            if (method === 'registerExtensionService') return behavior.registrationError ?
                Promise.reject(new Error('Invalid extension metadata')) : Promise.resolve();
            return Promise.resolve();
        }
    };
    context.global = context;
    context.require = name => ({
        './tw-extension-api-common': {},
        './tw-scratchx-compatibility-layer': () => ({}),
        '../dispatch/worker-dispatch': dispatch,
        '../util/log': {error: () => {}},
        './tw-extension-worker-context': {isWorker: false},
        './tw-l10n': () => () => ''
    })[name];
    vm.runInNewContext(source, context);
    return {result, errors};
};

test('a script which loads without registering fails instead of hanging', async t => {
    const worker = startWorker(({script, timeout}) => { script.onload(); timeout(); });
    const [, error] = await worker.result;
    t.match(error, /did not finish registering/);
    await new Promise(resolve => setImmediate(resolve));
    t.equal(worker.errors.size, 0, 'startup error listener removed');
});

test('a runtime error before registration reaches the host', async t => {
    const worker = startWorker(({script, crash}) => { crash(); script.onload(); });
    const [, error] = await worker.result;
    t.match(error, /requires VM access/);
});

test('registration rejection reaches the host', async t => {
    const behavior = ({script, register}) => { register({}); script.onload(); };
    behavior.registrationError = true;
    const [, error] = await startWorker(behavior).result;
    t.match(error, /Invalid extension metadata/);
});

test('valid sandboxed extensions still initialize', async t => {
    const [id, error] = await startWorker(({script, register}) => { register({}); script.onload(); }).result;
    t.equal(id, 1);
    t.equal(error, undefined);
});
