const {test} = require('tap');
const nodeVM = require('vm');
const {resolveObjectURL} = require('buffer');
const VM = require('../../src/virtual-machine');
const {formatConsoleArgs, locateInStack} = require('../../src/extension-support/tw-console-capture');

delete global.navigator;
global.location = {href: 'https://example.com/'};
global.window = new EventTarget();

global.document = {
    createElement: tag => (tag === 'script' ? {tagName: 'SCRIPT'} : {tagName: 'LINK', remove: () => {}}),
    head: {appendChild: () => {}},
    body: {
        appendChild: script => {
            if (script.tagName !== 'SCRIPT') return;
            const blob = resolveObjectURL(script.src);
            setTimeout(async () => {
                if (!blob) {
                    script.onerror();
                    return;
                }
                nodeVM.runInThisContext(await blob.text(), {filename: script.src});
                script.onload();
            });
        }
    }
};

const toDataURL = source => `data:application/javascript,${encodeURIComponent(source)}`;

const source = body => [
    '(function () { class Loud {',
    '    getInfo () {',
    '        return {id: \'loud\', name: \'Loud\', blocks: [',
    '            {opcode: \'speak\', blockType: \'command\', text: \'speak\'},',
    '            {opcode: \'boom\', blockType: \'command\', text: \'boom\'}',
    '        ]};',
    '    }',
    '    speak () {',
    `        ${body}`,
    '    }',
    '    boom () {',
    '        throw new Error(\'boom\');',
    '    }',
    '}',
    'Scratch.extensions.register(new Loud()); })();'
].join('\n');

const project = (opcode, extensions) => ({
    targets: [{
        isStage: true,
        name: 'Stage',
        variables: {},
        lists: {},
        broadcasts: {},
        blocks: {
            hat: {opcode: 'event_whenflagclicked',
                next: 'call',
                parent: null,
                inputs: {},
                fields: {},
                topLevel: true,
                x: 0,
                y: 0},
            call: {opcode, next: null, parent: 'hat', inputs: {}, fields: {}, topLevel: false}
        },
        comments: {},
        currentCostume: 0,
        costumes: [],
        sounds: [],
        volume: 100,
        layerOrder: 0
    }],
    monitors: [],
    extensions: Object.keys(extensions),
    extensionURLs: extensions,
    meta: {semver: '3.0.0', vm: '3.0.0', agent: ''}
});

const makeVM = () => {
    const vm = new VM();
    vm.securityManager.getSandboxMode = () => 'unsandboxed';
    vm.securityManager.canLoadExtensionFromProject = () => true;
    vm.setCompilerOptions({enabled: false});
    return vm;
};

test('console arguments are formatted and located', t => {
    t.equal(formatConsoleArgs(['a', 1, {b: 2}, new Error('x')]), 'a 1 {"b":2} Error: x');
    const circular = {};
    circular.self = circular;
    t.equal(formatConsoleArgs([circular]), '[object Object]');
    t.same(locateInStack('at f (mistwarp-extension:///3.js:12:5)', ['mistwarp-extension:///3.js'], 1),
        {line: 11, column: 5});
    t.equal(locateInStack('at f (other.js:1:1)', ['mistwarp-extension:///3.js']), null);
    t.end();
});

test('an unsandboxed extension console call reaches EXTENSION_CONSOLE with its line', async t => {
    const vm = makeVM();
    const text = source('console.warn(\'hello\', 42);');
    await vm.loadProject(project('loud_speak', {loud: toDataURL(text)}));
    const events = [];
    vm.runtime.on('EXTENSION_CONSOLE', event => events.push(event));
    console.log('not from an extension');
    vm.greenFlag();
    vm.runtime._step();
    t.equal(events.length, 1, 'only the extension call is captured');
    t.match(events[0], {extensionId: 'loud', level: 'warn', message: 'hello 42', line: 9});
    vm.quit();
});

test('a sandboxed worker reports console output through dispatch for its own extension only', async t => {
    const tick = () => new Promise(resolve => setImmediate(resolve));
    const workers = [];
    class FakeWorker {
        constructor () {
            this.isRemote = true;
            this.sent = [];
            workers.push(this);
        }
        postMessage (data) {
            this.sent.push(data);
        }
        send (message) {
            this.onmessage({data: message});
        }
        response (responseId) {
            return this.sent.find(message => message.responseId === responseId && !message.service);
        }
    }
    const vm = makeVM();
    vm.securityManager.getSandboxMode = () => 'iframe';
    vm.extensionManager._getWorkerClass = () => Promise.resolve(FakeWorker);
    const events = [];
    vm.runtime.on('EXTENSION_CONSOLE', event => events.push(event));
    const loading = vm.extensionManager.loadExtensionURL('https://example.com/sandboxed.js');
    while (!workers.length) await tick();
    const worker = workers[0];
    worker.send({service: 'extensions', method: 'allocateWorker', responseId: 'a', args: []});
    await tick();
    const [workerId] = worker.response('a').result;
    const serviceName = `extension.${workerId}.0`;
    worker.send({service: 'dispatch', method: 'setService', responseId: 's', args: [serviceName]});
    worker.send({service: 'extensions', method: 'registerExtensionService', responseId: 'r', args: [serviceName]});
    await tick();
    const getInfo = worker.sent.find(message => message.service === serviceName && message.method === 'getInfo');
    worker.send({responseId: getInfo.responseId, result: {id: 'sbx', name: 'Sbx', blocks: []}});
    await tick();
    worker.send({service: 'extensions', method: 'onWorkerInit', responseId: 'i', args: [workerId]});
    await loading;
    worker.send({service: 'extensions', method: 'reportConsole', responseId: 'c', args: ['error', 'bad', 3, 7]});
    worker.send({service: 'extensions', method: 'reportConsole', responseId: 'd', args: ['shout', 'odd']});
    await tick();
    t.same(events, [
        {extensionId: 'sbx', level: 'error', message: 'bad', line: 3, column: 7},
        {extensionId: 'sbx', level: 'log', message: 'odd', line: null, column: null}
    ]);
    vm.quit();
});

test('a reload drops throttled error reports of the previous version', async t => {
    const vm = makeVM();
    const text = source('return 1;');
    await vm.loadProject(project('loud_boom', {loud: toDataURL(text)}));
    const events = [];
    vm.runtime.on('EXTENSION_ERROR', event => events.push(event));
    vm.greenFlag();
    vm.runtime._step();
    vm.greenFlag();
    vm.runtime._step();
    t.equal(events.length, 1, 'the repeat is throttled');
    await vm.extensionManager.reloadExtension('loud', text.replace('throw new Error(\'boom\');', 'return 2;'));
    await new Promise(resolve => setTimeout(resolve, 300));
    t.equal(events.length, 1, 'the throttled copy from before the reload is dropped');
    vm.quit();
});

test('threads that start emit THREAD_STARTED and replaced scripts emit TARGET_SCRIPTS_REPLACED', async t => {
    const vm = makeVM();
    await vm.loadProject(project('control_wait', {}));
    const started = [];
    vm.runtime.on('THREAD_STARTED', thread => started.push(thread.topBlock));
    vm.greenFlag();
    vm.greenFlag();
    t.same(started, ['hat', 'hat'], 'a new thread and a restarted thread are both reported');
    const replaced = [];
    vm.runtime.on('TARGET_SCRIPTS_REPLACED', id => replaced.push(id));
    const stage = vm.runtime.getTargetForStage();
    const before = vm.replaceTargetScripts(stage.id, {restore: {}});
    t.ok(before);
    t.same(replaced, [stage.id]);
    vm.quit();
});
