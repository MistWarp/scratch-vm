const {test} = require('tap');
const nodeVM = require('vm');
const {resolveObjectURL} = require('buffer');
const VM = require('../../src/virtual-machine');
const dispatch = require('../../src/dispatch/central-dispatch');

delete global.navigator;
global.location = {href: 'https://example.com/'};
global.window = new EventTarget();

const dispatchScriptError = (src, error) => {
    let filename = src;
    let lineno = 0;
    let colno = 0;
    if (error instanceof SyntaxError) {
        const [first, , caret] = error.stack.split('\n');
        lineno = +first.slice(first.lastIndexOf(':') + 1);
        colno = caret.indexOf('^') + 1;
    } else {
        const frame = /(mistwarp-extension:\/\/\/[^:]+):(\d+):(\d+)/.exec(error.stack);
        if (frame) {
            filename = frame[1];
            lineno = +frame[2];
            colno = +frame[3];
        }
    }
    const event = new Event('error');
    Object.assign(event, {error, message: `Uncaught ${error}`, filename, lineno, colno});
    global.window.dispatchEvent(event);
};

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
                const text = await blob.text();
                try {
                    nodeVM.runInThisContext(text, {filename: script.src});
                } catch (error) {
                    dispatchScriptError(script.src, error);
                }
                script.onload();
            });
        }
    }
};

const toDataURL = source => `data:application/javascript,${encodeURIComponent(source)}`;

const defaultBlocks = [
    {opcode: 'value', blockType: 'reporter', text: 'value'},
    {opcode: 'wait', blockType: 'command', text: 'wait'}
];

const extensionSource = ({id = 'hot', value = 1, blocks = defaultBlocks, extra = ''} = {}) => [
    'class HotExtension {',
    '    getInfo () {',
    `        return {id: '${id}', name: 'Hot', blocks: ${JSON.stringify(blocks)}};`,
    '    }',
    '    value () {',
    `        return ${value};`,
    '    }',
    '    wait () {',
    '        return new Promise(() => {});',
    '    }',
    extra,
    '}',
    'Scratch.extensions.register(new HotExtension());'
].join('\n');

const stageProject = (blocks, extensions = {}) => ({
    targets: [{
        isStage: true,
        name: 'Stage',
        variables: {resultId: ['result', 0]},
        lists: {},
        broadcasts: {},
        blocks,
        comments: {},
        currentCostume: 0,
        costumes: [],
        sounds: [],
        volume: 100,
        layerOrder: 0,
        tempo: 60,
        videoTransparency: 50,
        videoState: 'on',
        textToSpeechLanguage: null
    }],
    monitors: [],
    extensions: Object.keys(extensions),
    extensionURLs: extensions,
    meta: {semver: '3.0.0', vm: '3.0.0', agent: ''}
});

const loop = body => ({
    hat: {opcode: 'event_whenflagclicked', next: 'loop', parent: null, inputs: {}, fields: {},
        topLevel: true, x: 0, y: 0},
    loop: {opcode: 'control_forever', next: null, parent: 'hat', inputs: {SUBSTACK: [2, 'body']},
        fields: {}, topLevel: false},
    body: {...body, next: null, parent: 'loop', topLevel: false}
});

const setResultToValue = () => ({
    ...loop({opcode: 'data_setvariableto', inputs: {VALUE: [3, 'reporter', [10, '']]},
        fields: {VARIABLE: ['result', 'resultId']}}),
    reporter: {opcode: 'hot_value', next: null, parent: 'body', inputs: {}, fields: {}, topLevel: false}
});

const makeVM = () => {
    const vm = new VM();
    vm.securityManager.getSandboxMode = () => 'unsandboxed';
    vm.securityManager.canLoadExtensionFromProject = () => true;
    return vm;
};

const result = vm => vm.runtime.getTargetForStage().variables.resultId.value;

for (const compiled of [true, false]) {
    test(`reload swaps method bodies under existing caches (${compiled ? 'compiled' : 'interpreted'})`, async t => {
        const vm = makeVM();
        vm.setCompilerOptions({enabled: compiled});
        await vm.loadProject(stageProject(setResultToValue(), {hot: toDataURL(extensionSource())}));
        vm.greenFlag();
        vm.runtime._step();
        t.equal(result(vm), 1);
        const cache = vm.runtime.getTargetForStage().blocks._cache;
        const cached = compiled ? cache.compiledScripts.hat : cache._executeCached.body;
        t.ok(cached, 'the script is cached');

        const reloaded = await vm.extensionManager.reloadExtension('hot', extensionSource({value: 2}));
        t.same(reloaded, {ids: ['hot'], removed: [], added: [], changed: []});
        vm.runtime._step();
        t.equal(result(vm), 2, 'the cached script calls the new code');
        const after = compiled ? cache.compiledScripts.hat : cache._executeCached.body;
        t.equal(after, cached, 'the cache was not reset');
        t.match(vm.extensionManager.getExtensionURLs().hot, /^data:/);
        t.equal(await vm.extensionManager.getExtensionSource('hot'), extensionSource({value: 2}));
        t.equal(vm.extensionManager.getExtensionMode('hot'), 'unsandboxed');
        vm.quit();
    });
}

test('a reload with a syntax error rejects with its position and keeps the old version', async t => {
    const vm = makeVM();
    await vm.loadProject(stageProject(setResultToValue(), {hot: toDataURL(extensionSource())}));
    vm.greenFlag();
    vm.runtime._step();
    const broken = 'Scratch.extensions.register({\n    getInfo: () => ({id: \'hot\' blocks: []})\n});';
    const error = await vm.extensionManager.reloadExtension('hot', broken).then(() => null, e => e);
    t.ok(error, 'rejected');
    t.equal(error.diagnostics[0].kind, 'syntax');
    t.equal(error.diagnostics[0].line, 2);
    t.ok(error.diagnostics[0].column > 0);
    vm.runtime._step();
    t.equal(result(vm), 1, 'the old version still runs');
    t.equal(await vm.extensionManager.getExtensionSource('hot'), extensionSource());
    vm.quit();
});

test('a reload that registers different ids is rejected', async t => {
    const vm = makeVM();
    await vm.loadProject(stageProject(setResultToValue(), {hot: toDataURL(extensionSource())}));
    const error = await vm.extensionManager.reloadExtension('hot', extensionSource({id: 'cold'}))
        .then(() => null, e => e);
    t.equal(error.diagnostics[0].kind, 'contract');
    t.ok(vm.extensionManager.isExtensionLoaded('hot'));
    t.notOk(vm.extensionManager.isExtensionLoaded('cold'));
    const invalid = await vm.extensionManager.reloadExtension('hot', extensionSource({id: 'not-valid'}))
        .then(() => null, e => e);
    t.equal(invalid.diagnostics[0].kind, 'contract');
    vm.quit();
});

test('a reload that removes an opcode reports it and stops threads using it', async t => {
    const vm = makeVM();
    await vm.loadProject(stageProject(loop({opcode: 'hot_wait', inputs: {}, fields: {}}),
        {hot: toDataURL(extensionSource())}));
    vm.greenFlag();
    vm.runtime._step();
    const thread = vm.runtime.threads.find(item => item.topBlock === 'hat');
    t.ok(thread, 'the thread is waiting on the block');
    const events = [];
    vm.runtime.on('EXTENSION_RELOADED', event => events.push(event));
    const reloaded = await vm.extensionManager.reloadExtension('hot', extensionSource({
        blocks: [{opcode: 'value', blockType: 'reporter', text: 'value'}]
    }));
    t.same(reloaded.removed, ['hot_wait']);
    t.same(events, [{id: 'hot', removed: ['hot_wait'], added: [], changed: []}]);
    t.ok(thread.isKilled, 'the thread was retired');
    t.notOk(vm.runtime.getOpcodeFunction('hot_wait'));
    t.equal(vm.runtime._blockInfo.filter(info => info.id === 'hot').length, 1, 'the category is reused');
    vm.quit();
});

test('block errors are reported with their block and position, throttled', async t => {
    const extra = '    explode () {\n        throw new Error(\'explode threw\');\n    }';
    const source = extensionSource({
        blocks: [{opcode: 'explode', blockType: 'command', text: 'explode'}],
        extra
    });
    const throwLine = source.split('\n').findIndex(line => line.includes('throw new Error')) + 1;
    const vm = makeVM();
    vm.setCompilerOptions({enabled: false});
    await vm.loadProject(stageProject(loop({opcode: 'hot_explode', inputs: {}, fields: {}}),
        {hot: toDataURL(source)}));
    const events = [];
    vm.runtime.on('EXTENSION_ERROR', event => events.push(event));
    vm.greenFlag();
    for (let i = 0; i < 10; i++) vm.runtime._step();
    t.equal(events.length, 1, 'one report inside the throttle window');
    t.match(events[0], {
        extensionId: 'hot',
        kind: 'block',
        opcode: 'hot_explode',
        blockId: 'body',
        targetId: vm.runtime.getTargetForStage().id,
        message: 'explode threw',
        line: throwLine,
        count: 1
    });
    await new Promise(resolve => setTimeout(resolve, 300));
    t.equal(events.length, 2);
    t.equal(events[1].count, 9, 'the repeats are counted');
    t.ok(vm.runtime.threads.some(thread => thread.topBlock === 'hat'), 'the interpreted thread keeps retrying');
    vm.quit();
});

test('a compiled block error reports the block that threw', async t => {
    const extra = '    explode () {\n        throw new Error(\'explode threw\');\n    }';
    const source = extensionSource({blocks: [{opcode: 'explode', blockType: 'command', text: 'explode'}], extra});
    const vm = makeVM();
    await vm.loadProject(stageProject(loop({opcode: 'hot_explode', inputs: {}, fields: {}}),
        {hot: toDataURL(source)}));
    const events = [];
    vm.runtime.on('EXTENSION_ERROR', event => events.push(event));
    vm.greenFlag();
    vm.runtime._step();
    t.equal(events[0].blockId, 'body');
    vm.quit();
});

test('a created extension is saved without blocks until another project loads', async t => {
    const vm = makeVM();
    await vm.loadProject(stageProject({}));
    const ids = await vm.extensionManager.createExtension(extensionSource({id: 'fresh'}), {unsandboxed: true});
    t.same(ids, ['fresh']);
    const saved = JSON.parse(vm.toJSON());
    t.same(saved.extensions, ['fresh']);
    t.match(saved.extensionURLs.fresh, /^data:/);
    t.match(vm.extensionManager.getExtensionEntries().find(entry => entry.id === 'fresh'), {
        kind: 'embedded', status: 'loaded', mode: 'unsandboxed', name: 'Hot', error: null
    });

    await vm.loadProject(stageProject({}));
    t.same(JSON.parse(vm.toJSON()).extensions, [], 'not written into another project');

    vm.securityManager.canCreateUnsandboxedExtension = () => Promise.resolve(false);
    await t.rejects(vm.extensionManager.createExtension(extensionSource({id: 'other'}), {unsandboxed: true}));
    t.notOk(vm.extensionManager.isExtensionLoaded('other'));
    vm.quit();
});

test('removeExtensionFromProject keeps the rest of every script', async t => {
    const vm = makeVM();
    const blocks = {
        hat: {opcode: 'event_whenflagclicked', next: 'wait', parent: null, inputs: {}, fields: {},
            topLevel: true, x: 10, y: 20},
        wait: {opcode: 'hot_wait', next: 'change1', parent: 'hat', inputs: {}, fields: {}, topLevel: false},
        change1: {opcode: 'data_changevariableby', next: 'branch', parent: 'wait',
            inputs: {VALUE: [1, [4, '1']]}, fields: {VARIABLE: ['result', 'resultId']}, topLevel: false},
        branch: {opcode: 'hot_branch', next: 'set', parent: 'change1', inputs: {SUBSTACK: [2, 'change2']},
            fields: {}, topLevel: false},
        change2: {opcode: 'data_changevariableby', next: null, parent: 'branch',
            inputs: {VALUE: [1, [4, '2']]}, fields: {VARIABLE: ['result', 'resultId']}, topLevel: false},
        set: {opcode: 'data_setvariableto', next: null, parent: 'branch',
            inputs: {VALUE: [3, 'echo', [10, '']]}, fields: {VARIABLE: ['result', 'resultId']}, topLevel: false},
        echo: {opcode: 'hot_echo', next: null, parent: 'set', inputs: {TEXT: [3, 'join', [10, 'x']]},
            fields: {}, topLevel: false},
        join: {opcode: 'operator_join', next: null, parent: 'echo',
            inputs: {STRING1: [1, [10, 'a']], STRING2: [1, [10, 'b']]}, fields: {}, topLevel: false},
        hatOnly: {opcode: 'hot_when', next: 'change3', parent: null, inputs: {}, fields: {},
            topLevel: true, x: 300, y: 40},
        change3: {opcode: 'data_changevariableby', next: null, parent: 'hatOnly',
            inputs: {VALUE: [1, [4, '3']]}, fields: {VARIABLE: ['result', 'resultId']}, topLevel: false}
    };
    const source = extensionSource({blocks: [
        ...defaultBlocks,
        {opcode: 'branch', blockType: 'conditional', text: 'branch'},
        {opcode: 'echo', blockType: 'reporter', text: 'echo [TEXT]', arguments: {TEXT: {type: 'string'}}},
        {opcode: 'when', blockType: 'hat', text: 'when'}
    ]});
    const project = stageProject(blocks, {hot: toDataURL(source)});
    project.targets[0].comments = {
        note: {blockId: 'wait', x: 0, y: 0, width: 100, height: 100, minimized: false, text: 'note'}
    };
    await vm.loadProject(project);
    vm.runtime.monitorBlocks.createBlock({id: 'hot_value', opcode: 'hot_value', inputs: {}, fields: {},
        next: null, parent: null, shadow: false, topLevel: true, isMonitored: true});
    vm.runtime.requestAddMonitor({id: 'hot_value', opcode: 'hot_value', visible: true});
    vm.greenFlag();
    vm.runtime._step();

    t.match(vm.getExtensionUsage('hot'), {id: 'hot', totalBlocks: 4, totalHatScripts: 1, totalMonitors: 1});
    let changes = 0;
    vm.runtime.on('PROJECT_CHANGED', () => changes++);
    vm.removeExtensionFromProject(['hot']);
    t.equal(changes, 1);

    const stage = vm.runtime.getTargetForStage();
    const remaining = stage.blocks._blocks;
    t.notOk(Object.values(remaining).some(block => block.opcode.startsWith('hot_')), 'no extension blocks remain');
    t.equal(remaining.hat.next, 'change1');
    t.equal(remaining.change1.parent, 'hat');
    t.equal(remaining.change1.next, 'set', 'the next block took the removed block\'s place');
    t.equal(remaining.set.parent, 'change1');
    t.equal(remaining.change2.parent, null);
    t.equal(remaining.change2.topLevel, true, 'the branch is a loose script');
    t.equal(remaining.join.parent, null);
    t.equal(remaining.join.topLevel, true, 'the reporter is a loose block');
    t.equal(remaining[remaining.set.inputs.VALUE.block].opcode, 'text', 'the slot has its shadow back');
    t.equal(remaining.change3.topLevel, true, 'the hat script is loose');
    t.same({x: remaining.change3.x, y: remaining.change3.y}, {x: 300, y: 40});
    t.ok(stage.blocks._scripts.includes('change2') && stage.blocks._scripts.includes('change3'));
    t.equal(stage.comments.note.blockId, null, 'the comment is kept');
    t.notOk(vm.runtime.getMonitorState().has('hot_value'));
    t.notOk(vm.runtime.monitorBlocks.getBlock('hot_value'));
    t.notOk(vm.extensionManager.isExtensionLoaded('hot'));

    const saved = JSON.parse(vm.toJSON());
    t.same(saved.extensions, []);
    t.notOk(saved.extensionURLs && saved.extensionURLs.hot);
    vm.quit();
});

test('failed and denied entries are listed and fixed with reloadExtension', async t => {
    const vm = makeVM();
    const broken = 'Scratch.extensions.register({\n    getInfo: () => ({id: \'hot\' blocks: []})\n});';
    const project = stageProject(setResultToValue(), {hot: toDataURL(broken)});
    await vm.loadProject(project);
    const entry = vm.extensionManager.getExtensionEntries().find(item => item.id === 'hot');
    t.match(entry, {status: 'failed', kind: 'embedded', mode: 'unsandboxed', error: {line: 2}});
    t.equal(await vm.extensionManager.getExtensionSource('hot'), broken);

    const fixed = await vm.extensionManager.reloadExtension('hot', extensionSource({value: 5}));
    t.same(fixed.ids, ['hot']);
    t.notOk(vm.extensionManager.getExtensionEntries().some(item => item.status !== 'loaded'));
    vm.greenFlag();
    vm.runtime._step();
    t.equal(result(vm), 5, 'the fixed extension runs');

    vm.securityManager.canLoadExtensionFromProject = () => false;
    project.extensionURLs = {hot: toDataURL(extensionSource({value: 6}))};
    await vm.loadProject(project);
    t.match(vm.extensionManager.getExtensionEntries().find(item => item.id === 'hot'),
        {status: 'denied', error: null});
    vm.securityManager.canLoadExtensionFromProject = () => true;
    await vm.extensionManager.reloadExtension('hot', extensionSource({value: 7}));
    vm.greenFlag();
    vm.runtime._step();
    t.equal(result(vm), 7);
    vm.quit();
});

test('removeWorker drops its services and rejects calls waiting on it', async t => {
    let terminated = false;
    const worker = {isRemote: true, postMessage: () => {}, terminate: () => {
        terminated = true;
    }};
    dispatch.workers.push(worker);
    dispatch.services['test.worker'] = worker;
    const pending = dispatch.call('test.worker', 'method');
    dispatch.removeWorker(worker);
    await t.rejects(pending);
    t.notOk(dispatch.services['test.worker']);
    t.notOk(dispatch.workers.includes(worker));
    t.ok(terminated);
});

test('a reload whose custom field types are invalid fails before touching the running version', async t => {
    const vm = makeVM();
    await vm.loadProject(stageProject(setResultToValue(), {hot: toDataURL(extensionSource())}));
    vm.greenFlag();
    vm.runtime._step();
    const broken = extensionSource({value: 3}).replace("name: 'Hot',", "name: 'Hot', customFieldTypes: {f: null},");
    const error = await vm.extensionManager.reloadExtension('hot', broken).then(() => null, e => e);
    t.ok(error && error.diagnostics, 'rejected with diagnostics');
    vm.runtime._step();
    t.equal(result(vm), 1, 'the old version still runs');
    t.match(JSON.parse(vm.toJSON()).extensionURLs.hot, /^data:/);
    t.equal(vm.extensionManager.getExtensionMode('hot'), 'unsandboxed');
    await vm.extensionManager.reloadExtension('hot', extensionSource({value: 4}));
    vm.runtime._step();
    t.equal(result(vm), 4, 'a later reload still works');
    vm.quit();
});

test('an unexpected failure while committing a reload restores the running version', async t => {
    const vm = makeVM();
    await vm.loadProject(stageProject(setResultToValue(), {hot: toDataURL(extensionSource())}));
    vm.greenFlag();
    vm.runtime._step();
    const original = vm.runtime._refreshExtensionPrimitives;
    vm.runtime._refreshExtensionPrimitives = () => {
        throw new Error('refresh failed');
    };
    const error = await vm.extensionManager.reloadExtension('hot', extensionSource({value: 3})).then(() => null, e => e);
    vm.runtime._refreshExtensionPrimitives = original;
    t.ok(error && error.diagnostics, 'rejected with diagnostics');
    vm.runtime._step();
    t.equal(result(vm), 1, 'the old version still runs');
    t.equal(vm.runtime._blockInfo.find(info => info.id === 'hot').blocks.length, 2, 'the category is intact');
    t.equal(await vm.extensionManager.getExtensionSource('hot'), extensionSource());
    t.equal(vm.extensionManager.getExtensionMode('hot'), 'unsandboxed');
    await vm.extensionManager.reloadExtension('hot', extensionSource({value: 4}));
    vm.runtime._step();
    t.equal(result(vm), 4);
    vm.quit();
});

test('an extension that throws after registering still loads', async t => {
    const vm = makeVM();
    const source = `${extensionSource({id: 'late'})}\nthrow new Error('after register');`;
    t.same(await vm.extensionManager.createExtension(source, {unsandboxed: true}), ['late']);
    vm.quit();
});

test('load errors from a project name the extension id', async t => {
    const vm = makeVM();
    const events = [];
    vm.runtime.on('EXTENSION_ERROR', event => events.push(event));
    await vm.loadProject(stageProject({
        lone: {opcode: 'broken_say', next: null, parent: null, inputs: {}, fields: {}, topLevel: true, x: 0, y: 0}
    }, {broken: toDataURL('this is not javascript')}));
    t.equal(events[0].extensionId, 'broken');
    vm.quit();
});

test('data URLs decode leniently', t => {
    const {decodeDataURL} = require('../../src/extension-support/tw-unsandboxed-extension-runner');
    t.equal(decodeDataURL('data:,a%zzb%41%E2%9C%93'), 'a%zzbA✓');
    t.equal(decodeDataURL('data:;base64,aGk%3D'), 'hi');
    t.equal(decodeDataURL(toDataURL('café 100%')), 'café 100%');
    t.end();
});

test('menu errors from different extensions are throttled separately', t => {
    const vm = makeVM();
    const events = [];
    vm.runtime.on('EXTENSION_ERROR', event => events.push(event));
    const menus = {menu: () => {
        throw new Error('menu threw');
    }};
    vm.extensionManager._getExtensionMenuItems(menus, 'menu', 'first');
    vm.extensionManager._getExtensionMenuItems(menus, 'menu', 'second');
    t.same(events.map(event => event.extensionId), ['first', 'second']);
    vm.quit();
    t.end();
});

test('calls rejected because a worker was removed are not reported', t => {
    const vm = makeVM();
    const events = [];
    vm.runtime.on('EXTENSION_ERROR', event => events.push(event));
    vm.extensionManager.reportExtensionError({extensionId: 'gone', kind: 'block', error: dispatch.WORKER_REMOVED_ERROR});
    t.same(events, []);
    vm.quit();
    t.end();
});

test('sandboxed workers can only reach their own extension protocol', async t => {
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
    let victimCalled = false;
    dispatch.setServiceSync('unsandboxed.999.victim', {getInfo: () => {
        victimCalled = true;
    }});

    const loading = vm.extensionManager.loadExtensionURL('https://example.com/sandboxed.js');
    while (!workers.length) await tick();
    const worker = workers[0];
    worker.send({service: 'extensions', method: 'allocateWorker', responseId: 'a', args: []});
    await tick();
    const [workerId] = worker.response('a').result;

    worker.send({service: 'unsandboxed.999.victim', method: 'getInfo', responseId: 'evil', args: []});
    worker.send({service: 'dispatch', method: 'setService', responseId: 'steal', args: ['extensions']});
    worker.send({service: 'extensions', method: 'allocateWorker', responseId: 'again', args: []});
    await tick();
    t.ok(worker.response('evil').error, 'calling an unsandboxed service is rejected');
    t.notOk(victimCalled);
    t.ok(worker.response('steal').error, 'replacing a main page service is rejected');
    t.not(dispatch.services.extensions, worker);
    t.ok(worker.response('again').error, 'a worker cannot allocate twice');

    const serviceName = `extension.${workerId}.0`;
    worker.send({service: 'dispatch', method: 'setService', responseId: 's', args: [serviceName]});
    worker.send({service: 'extensions', method: 'registerExtensionService', responseId: 'r', args: [serviceName]});
    await tick();
    const getInfo = worker.sent.find(message => message.service === serviceName && message.method === 'getInfo');
    const intruder = new FakeWorker();
    dispatch.addWorker(intruder);
    intruder.send({responseId: getInfo.responseId, result: {id: 'forged', blocks: []}});
    worker.send({responseId: getInfo.responseId, result: {
        id: 'sbx', name: 'Sandboxed', blocks: [{opcode: 'ping', blockType: 'reporter', text: 'ping'}]
    }});
    await tick();
    worker.send({service: 'extensions', method: 'onWorkerInit', responseId: 'i', args: [workerId]});
    await loading;
    t.ok(vm.extensionManager.isExtensionLoaded('sbx'));
    t.notOk(vm.extensionManager.isExtensionLoaded('forged'), 'a response from another worker is ignored');
    t.equal(vm.extensionManager.getExtensionMode('sbx'), 'iframe');

    const pinged = vm.runtime.getOpcodeFunction('sbx_ping')({}, null);
    await tick();
    const call = worker.sent.find(message => message.service === serviceName && message.method === 'ping');
    worker.send({responseId: call.responseId, result: 'pong'});
    t.equal(await pinged, 'pong', 'blocks run through the worker');
    dispatch.removeWorker(intruder);
    delete dispatch.services['unsandboxed.999.victim'];
    vm.quit();
});

test('a fresh source read of a URL extension skips the text kept from the last reload', async t => {
    const vm = makeVM();
    await vm.loadProject(stageProject(setResultToValue(), {hot: toDataURL(extensionSource())}));
    const manager = vm.extensionManager;
    await manager.reloadExtension('hot', extensionSource({value: 2}), {keepURL: true});
    const workerId = manager._workerIdFor('hot');
    manager.workerURLs[workerId] = 'https://example.com/hot.js';
    delete manager._workerLoadedURLs[workerId];
    manager._readExtensionURL = url => Promise.resolve(`fetched ${url}`);
    t.equal(await manager.getExtensionSource('hot'), extensionSource({value: 2}));
    t.equal(await manager.getExtensionSource('hot', {fresh: true}), 'fetched https://example.com/hot.js');
    vm.quit();
});

const tick = () => new Promise(resolve => setImmediate(resolve));

class ProtocolWorker {
    constructor () {
        this.isRemote = true;
        this.sent = [];
        ProtocolWorker.created.push(this);
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
    async answer (service, method, result) {
        await tick();
        const call = this.sent.find(message => message.service === service && message.method === method);
        this.send({responseId: call.responseId, result});
        await tick();
    }
}
ProtocolWorker.created = [];

const startSandboxedLoad = async (vm, url) => {
    ProtocolWorker.created.length = 0;
    vm.securityManager.getSandboxMode = () => 'iframe';
    vm.extensionManager._getWorkerClass = () => Promise.resolve(ProtocolWorker);
    const loading = vm.extensionManager.loadExtensionURL(url);
    loading.catch(() => {});
    while (!ProtocolWorker.created.length) await tick();
    const worker = ProtocolWorker.created[0];
    worker.send({service: 'extensions', method: 'allocateWorker', responseId: 'a', args: []});
    await tick();
    return {worker, loading, workerId: worker.response('a').result[0]};
};

test('an extension created without blocks survives saving and reopening twice', async t => {
    const vm = makeVM();
    await vm.loadProject(stageProject({}));
    await vm.extensionManager.createExtension(extensionSource({id: 'keep'}), {unsandboxed: true});
    const saved = JSON.parse(vm.toJSON());
    vm.quit();
    const reopened = makeVM();
    await reopened.loadProject(saved);
    t.ok(reopened.extensionManager.isExtensionLoaded('keep'), 'loaded on reopen');
    const savedAgain = JSON.parse(reopened.toJSON());
    t.same(savedAgain.extensions, ['keep']);
    t.equal(savedAgain.extensionURLs.keep, saved.extensionURLs.keep);
    reopened.quit();
});

test('a terminated iframe worker ignores late messages', t => {
    const Module = require('module');
    const originalResolve = Module._resolveFilename;
    Module._resolveFilename = function (request, ...rest) {
        if (request.startsWith('./tw-load-script-as-plain-text!')) {
            return originalResolve.call(this, '../util/uid', ...rest);
        }
        return originalResolve.call(this, request, ...rest);
    };
    const IframeExtensionWorker = require('../../src/extension-support/tw-iframe-extension-worker');
    Module._resolveFilename = originalResolve;
    const originalCreate = global.document.createElement;
    const iframe = {
        dataset: {},
        style: {},
        setAttribute: () => {},
        remove: () => {
            iframe.contentWindow = null;
        },
        contentWindow: {postMessage: () => {}}
    };
    global.document.createElement = tag => (tag === 'iframe' ? iframe : originalCreate(tag));
    const worker = new IframeExtensionWorker();
    global.document.createElement = originalCreate;
    worker.ready = true;
    worker.terminate();
    t.doesNotThrow(() => worker.postMessage({responseId: 1, result: null}));
    t.end();
});

test('decodeDataURL takes the native path for well formed sources', t => {
    const {decodeDataURL} = require('../../src/extension-support/tw-unsandboxed-extension-runner');
    const source = 'const x = "café";\n'.repeat(15000);
    const url = toDataURL(source);
    const time = fn => {
        let best = Infinity;
        for (let i = 0; i < 3; i++) {
            const start = process.hrtime.bigint();
            fn();
            best = Math.min(best, Number(process.hrtime.bigint() - start) / 1e6);
        }
        return best;
    };
    const body = url.slice(url.indexOf(',') + 1);
    const native = time(() => decodeURIComponent(body));
    t.equal(decodeDataURL(url), source);
    t.ok(time(() => decodeDataURL(url)) < (native * 5) + 10, 'close to native decodeURIComponent');
    t.end();
});

test('removing a worker while it starts rejects its load', async t => {
    const vm = makeVM();
    const {loading, workerId} = await startSandboxedLoad(vm, 'https://example.com/starting.js');
    vm.extensionManager._forgetWorker(workerId);
    await t.rejects(loading);
    t.equal(vm.extensionManager.loadingAsyncExtensions, 0);
    vm.quit();
});

test('a discarded staged instance is disposed', async t => {
    const vm = makeVM();
    await vm.loadProject(stageProject(setResultToValue(), {hot: toDataURL(extensionSource())}));
    global.disposedStage = false;
    const source = extensionSource({id: 'other', extra: '    dispose () {\n        globalThis.disposedStage = true;\n    }'});
    await t.rejects(vm.extensionManager.reloadExtension('hot', source));
    t.equal(global.disposedStage, true);
    vm.quit();
});

test('created extensions mark the project as using custom extensions', async t => {
    const vm = makeVM();
    await vm.extensionManager.createExtension(extensionSource({id: 'flagged'}), {unsandboxed: true});
    t.equal(vm.runtime.externalCommunicationMethods.customExtensions, true);
    vm.quit();
});

test('an older overlapping reload is discarded', async t => {
    const vm = makeVM();
    await vm.loadProject(stageProject(setResultToValue(), {hot: toDataURL(extensionSource())}));
    vm.greenFlag();
    const older = vm.extensionManager.reloadExtension('hot', extensionSource({value: 2})).then(() => null, e => e);
    const newer = vm.extensionManager.reloadExtension('hot', extensionSource({value: 3}));
    const olderError = await older;
    await newer;
    t.match(olderError && olderError.diagnostics[0].message, /newer edit/);
    vm.runtime._step();
    t.equal(result(vm), 3);
    vm.quit();
});

test('a sandboxed worker can register late but cannot take another id', async t => {
    const vm = makeVM();
    vm.extensionManager.loadExtensionIdSync('pen');
    const {worker, loading, workerId} = await startSandboxedLoad(vm, 'https://example.com/greedy.js');
    const first = `extension.${workerId}.0`;
    worker.send({service: 'dispatch', method: 'setService', responseId: 's0', args: [first]});
    worker.send({service: 'extensions', method: 'registerExtensionService', responseId: 'r0', args: [first]});
    await worker.answer(first, 'getInfo', {id: 'pen', blocks: []});
    t.ok(worker.response('r0').error, 'a builtin id cannot be taken');
    t.notEqual(vm.extensionManager._loadedExtensions.get('pen'), first);
    worker.send({service: 'extensions', method: 'onWorkerInit', responseId: 'i', args: [workerId]});
    await loading.catch(() => {});
    const late = `extension.${workerId}.1`;
    worker.send({service: 'dispatch', method: 'setService', responseId: 's1', args: [late]});
    worker.send({service: 'extensions', method: 'registerExtensionService', responseId: 'r1', args: [late]});
    await worker.answer(late, 'getInfo', {id: 'late', blocks: []});
    t.notOk(worker.response('r1').error, 'registering after startup works');
    t.equal(vm.extensionManager._loadedExtensions.get('late'), late);
    const thief = `extension.${workerId}.2`;
    worker.send({service: 'dispatch', method: 'setService', responseId: 's2', args: [thief]});
    worker.send({service: 'extensions', method: 'registerExtensionService', responseId: 'r2', args: [thief]});
    await worker.answer(thief, 'getInfo', {id: 'pen', blocks: []});
    t.ok(worker.response('r2').error, 'a late registration cannot take a loaded id');
    vm.quit();
});

test('late failures of a cancelled project load are not recorded', async t => {
    const vm = makeVM();
    let cancelled = false;
    const original = vm.extensionManager.loadExtensionURL.bind(vm.extensionManager);
    vm.extensionManager.loadExtensionURL = (...args) => {
        const loading = original(...args);
        cancelled = true;
        return loading;
    };
    await vm._loadExtensions(['late'], new Map([['late', toDataURL('not javascript at all')]]), () => !cancelled)
        .catch(() => {});
    cancelled = false;
    await vm._loadExtensions(['other'], new Map([['other', toDataURL(extensionSource({id: 'notother'}))]]),
        () => !cancelled).catch(() => {});
    t.notOk(vm.extensionManager.isExtensionUnloaded('late'), 'the failure is not recorded');
    t.notOk(vm.extensionManager.isExtensionUnloaded('other'), 'the missing registration is not recorded');
    vm.quit();
});

test('replaced reload URLs do not keep their recorded mode', async t => {
    const vm = makeVM();
    await vm.loadProject(stageProject(setResultToValue(), {hot: toDataURL(extensionSource())}));
    for (let value = 2; value < 5; value++) {
        await vm.extensionManager.reloadExtension('hot', extensionSource({value}));
    }
    const dataModes = Array.from(vm.extensionManager._urlModes.keys()).filter(url => url.startsWith('data:'));
    t.same(dataModes, [vm.extensionManager.getExtensionURLs().hot]);
    vm.quit();
});

test('user supplied code for a gallery id replaces its built-in compilers until removed', async t => {
    const vm = makeVM();
    const seeded = vm.runtime.compilerExtensions.get('mistsutils_notequals');
    t.ok(seeded, 'the gallery compiler is seeded');
    await vm.extensionManager.createExtension(extensionSource({
        id: 'mistsutils',
        blocks: [{opcode: 'notequals', blockType: 'Boolean', text: 'not equal'}]
    }), {unsandboxed: true});
    t.notOk(vm.runtime.compilerExtensions.has('mistsutils_notequals'), 'the built-in compiler no longer runs');
    vm.extensionManager.removeExtension('mistsutils');
    t.equal(vm.runtime.compilerExtensions.get('mistsutils_notequals'), seeded, 'restored on removal');
    vm.quit();
});

test('a failed id that loads through another path is no longer recorded as failed', t => {
    const vm = makeVM();
    vm.extensionManager.recordUnloadedExtension('pen', 'https://example.com/pen.js', {error: new Error('x')});
    let resets = 0;
    const reset = vm.runtime.resetAllCaches.bind(vm.runtime);
    vm.runtime.resetAllCaches = () => {
        resets++;
        reset();
    };
    vm.extensionManager.loadExtensionIdSync('pen');
    t.notOk(vm.extensionManager._unloadedExtensionURLs.has('pen'));
    t.ok(resets > 0, 'caches are reset');
    vm.quit();
    t.end();
});

test('an older overlapping fix of a failed entry is discarded', async t => {
    const vm = makeVM();
    const broken = 'not javascript at all';
    await vm.loadProject(stageProject(setResultToValue(), {hot: toDataURL(broken)}));
    const older = vm.extensionManager.reloadExtension('hot', extensionSource({value: 2})).then(() => null, e => e);
    const newer = vm.extensionManager.reloadExtension('hot', extensionSource({value: 3}));
    const olderError = await older;
    await newer;
    t.match(olderError && olderError.diagnostics[0].message, /newer edit/);
    vm.greenFlag();
    vm.runtime._step();
    t.equal(result(vm), 3);
    vm.quit();
});

test('a whole project load swaps outdated extensions without the install flag', async t => {
    const vm = makeVM();
    await vm.extensionManager.createExtension(extensionSource({id: 'swap'}), {unsandboxed: true});
    await vm._loadExtensions(['swap'], new Map([['swap', toDataURL(extensionSource({id: 'swap', value: 2}))]]),
        () => true, true);
    t.equal(vm.runtime.ext_swap.value(), 2);
    vm.quit();
});

test('usage counts scripts started by blocks of an unloaded extension', async t => {
    const vm = makeVM();
    await vm.loadProject(stageProject({
        top: {opcode: 'ghost_when', next: 'after', parent: null, inputs: {}, fields: {}, topLevel: true, x: 0, y: 0},
        after: {opcode: 'ghost_do', next: null, parent: 'top', inputs: {}, fields: {}, topLevel: false}
    }, {ghost: toDataURL('not javascript at all')}));
    t.match(vm.getExtensionUsage('ghost'), {totalBlocks: 2, totalHatScripts: 1});
    vm.quit();
});

test('removing an extension clears its holder', async t => {
    const vm = makeVM();
    await vm.extensionManager.createExtension(extensionSource({id: 'held'}), {unsandboxed: true});
    const holder = vm.extensionManager._holders.get('held');
    t.ok(holder.instance);
    vm.extensionManager.removeExtension('held');
    t.same(holder, {serviceName: null, instance: null});
    vm.quit();
});

test('built-in extensions listed without blocks are not loaded on open', async t => {
    const vm = makeVM();
    const project = stageProject({});
    project.extensions = ['pen'];
    await vm.loadProject(project);
    t.notOk(vm.extensionManager.isExtensionLoaded('pen'));
    vm.quit();
});

test('collaboration cannot load the patching extension without permission', async t => {
    const vm = makeVM();
    vm.securityManager.canLoadExtensionFromProject = url => url !== 'builtin:patching';
    t.equal(await vm.editingCommands.allowExtension('loadExtensionURL', ['patching']), false);
    t.equal(await vm.editingCommands.allowExtension('loadExtensionURL', ['pen']), true);
    vm.quit();
});
