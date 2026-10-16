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

const extensionSource = ({value = 1, args = false, compiled = false} = {}) => [
    'class HotExtension {',
    '    getInfo () {',
    `        return {id: 'hot', name: 'Hot', blocks: [{opcode: 'value', blockType: 'reporter', text: ${
        args ? '\'value [A]\', arguments: {A: {type: \'number\'}}' : '\'value\''}}]};`,
    '    }',
    '    value () {',
    `        return ${value};`,
    '    }',
    '}',
    compiled ? `Scratch.vm.exports.compiler.register('hot', {value: {type: Scratch.vm.exports.compiler.types.ANY, ` +
        `compile: () => '${value}'}});` : '',
    'Scratch.extensions.register(new HotExtension());'
].join('\n');

const stageProject = extensions => ({
    targets: [{
        isStage: true,
        name: 'Stage',
        variables: {resultId: ['result', 0]},
        lists: {},
        broadcasts: {},
        blocks: {
            hat: {opcode: 'event_whenflagclicked', next: 'set', parent: null, inputs: {}, fields: {},
                topLevel: true, x: 0, y: 0},
            set: {opcode: 'data_setvariableto', next: null, parent: 'hat', inputs: {VALUE: [3, 'reporter', [10, '']]},
                fields: {VARIABLE: ['result', 'resultId']}, topLevel: false},
            reporter: {opcode: 'hot_value', next: null, parent: 'set', inputs: {}, fields: {}, topLevel: false}
        },
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

const load = async (source = extensionSource()) => {
    const vm = new VM();
    vm.securityManager.getSandboxMode = () => 'unsandboxed';
    vm.securityManager.canLoadExtensionFromProject = () => true;
    vm.setCompilerOptions({enabled: false});
    await vm.loadProject(stageProject({hot: toDataURL(source)}));
    return vm;
};

const run = vm => {
    vm.greenFlag();
    vm.runtime._step();
    return vm.runtime.getTargetForStage().variables.resultId.value;
};

test('confirm sees the opcode diff and a false answer keeps the old version', async t => {
    const vm = await load();
    const manager = vm.extensionManager;
    let seen = null;
    const error = await manager.reloadExtension('hot', extensionSource({value: 2, args: true}), {
        confirm: diff => {
            seen = diff;
            return Promise.resolve(false);
        }
    }).then(() => null, e => e);
    t.ok(error, 'rejected');
    t.match(error.message, /cancelled/);
    t.same(seen.ids, ['hot']);
    t.same(seen.changed, ['hot_value']);
    t.same(Object.keys(seen.details.hot_value.after.arguments), ['A'], 'the new signature is passed');
    t.notOk(seen.details.hot_value.before.arguments && Object.keys(seen.details.hot_value.before.arguments).length);
    t.equal(run(vm), 1, 'the old version still runs');
    t.equal(manager.getExtensionMode('hot'), 'unsandboxed');
    const ok = await manager.reloadExtension('hot', extensionSource({value: 3}), {confirm: () => true});
    t.same(ok.ids, ['hot']);
    t.equal(run(vm), 3, 'a true answer commits');
    vm.quit();
});

test('staged compiler entries are set aside while confirm waits', async t => {
    const vm = await load(extensionSource({compiled: true}));
    const manager = vm.extensionManager;
    const oldEntry = vm.runtime.compilerExtensions.get('hot_value');
    t.ok(oldEntry, 'the extension registered a compiler');
    let during = null;
    await manager.reloadExtension('hot', extensionSource({value: 5, compiled: true}), {
        confirm: () => {
            during = vm.runtime.compilerExtensions.get('hot_value');
            return true;
        }
    });
    t.equal(during, oldEntry, 'the live compiler is the old one while confirm waits');
    const newEntry = vm.runtime.compilerExtensions.get('hot_value');
    t.ok(newEntry && newEntry !== oldEntry, 'the staged compiler is installed on commit');

    let staged = null;
    const error = await manager.reloadExtension('hot', extensionSource({value: 6, compiled: true}), {
        confirm: () => {
            staged = vm.runtime.compilerExtensions.get('hot_value');
            return false;
        }
    }).then(() => null, e => e);
    t.ok(error);
    t.equal(staged, newEntry);
    t.equal(vm.runtime.compilerExtensions.get('hot_value'), newEntry, 'a refusal keeps the old compiler');
    vm.quit();
});

test('changes during confirm refuse the reload', async t => {
    const vm = await load();
    const manager = vm.extensionManager;
    const refuse = async (mutate, pattern) => {
        const error = await manager.reloadExtension('hot', extensionSource({value: 9}), {
            confirm: () => {
                mutate();
                return true;
            }
        }).then(() => null, e => e);
        t.ok(error, 'rejected');
        t.match(error.message, pattern);
        t.equal(run(vm), 1, 'the old version still runs');
    };
    await refuse(() => {
        vm.editingCommands.handler = () => {};
    }, /collaboration/);
    vm.editingCommands.handler = null;
    await refuse(() => {
        vm._projectLoadGeneration++;
    }, /project changed/);
    const original = manager._loadedExtensions.get('hot');
    await refuse(() => {
        manager._loadedExtensions.set('hot', 'something.else');
    }, /extension changed/);
    manager._loadedExtensions.set('hot', original);

    let newer = null;
    const older = manager.reloadExtension('hot', extensionSource({value: 7}), {
        confirm: () => {
            newer = manager.reloadExtension('hot', extensionSource({value: 8}));
            return newer.then(() => true);
        }
    }).then(() => null, e => e);
    const olderError = await older;
    t.match(olderError.message, /newer edit/);
    await newer;
    t.equal(run(vm), 8);
    vm.quit();
});

test('running unsandboxed needs a one-shot allowance from the security manager', async t => {
    const vm = await load();
    const manager = vm.extensionManager;
    const pretendSandboxed = () => {
        manager._workerModes[manager._workerIdFor('hot')] = 'iframe';
    };
    pretendSandboxed();
    const source = extensionSource({value: 4});
    const denied = await manager.reloadExtension('hot', source, {mode: 'unsandboxed'}).then(() => null, e => e);
    t.match(denied.message, /not allowed/, 'a drop alone gets no allowance');
    t.equal(await manager.requestUnsandboxedAllowance('hot', source, 'hot.js'), false,
        'the default security manager says no');
    t.match((await manager.reloadExtension('hot', source, {mode: 'unsandboxed'}).then(() => null, e => e)).message,
        /not allowed/);

    const prompts = [];
    vm.securityManager.canRunUnsandboxedFromFile = (fileName, text, id) => {
        prompts.push({fileName, id, first: text.split('\n')[0]});
        return Promise.resolve(true);
    };
    t.equal(await manager.requestUnsandboxedAllowance('hot', source, 'hot.js'), true);
    t.same(prompts, [{fileName: 'hot.js', id: 'hot', first: 'class HotExtension {'}]);
    const other = await manager.reloadExtension('hot', extensionSource({value: 5}), {mode: 'unsandboxed'})
        .then(() => null, e => e);
    t.match(other.message, /not allowed/, 'the allowance is for that source only');
    const used = await manager.reloadExtension('hot', source, {mode: 'unsandboxed'}).then(() => null, e => e);
    t.match(used.message, /not allowed/, 'a refused attempt used the allowance up');

    await manager.requestUnsandboxedAllowance('hot', source, 'hot.js');
    await manager.reloadExtension('hot', source, {mode: 'unsandboxed'});
    t.equal(manager.getExtensionMode('hot'), 'unsandboxed');
    t.equal(run(vm), 4);
    pretendSandboxed();
    const again = await manager.reloadExtension('hot', source, {mode: 'unsandboxed'}).then(() => null, e => e);
    t.match(again.message, /not allowed/, 'the allowance is one-shot');
    const unknown = await manager.reloadExtension('hot', source, {mode: 'nope'}).then(() => null, e => e);
    t.match(unknown.message, /Unknown extension mode/);
    vm.quit();
});
