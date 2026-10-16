const {test} = require('tap');
const VM = require('../../src/virtual-machine');

const stage = (blocks, variables = {}) => ({
    targets: [{
        isStage: true,
        name: 'Stage',
        variables,
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
    extensions: ['boom'],
    meta: {semver: '3.0.0', vm: '3.0.0', agent: ''}
});

const forever = (hatId, foreverId, bodyId, body) => ({
    [hatId]: {opcode: 'event_whenflagclicked', next: foreverId, parent: null, inputs: {}, fields: {},
        topLevel: true, x: 0, y: 0},
    [foreverId]: {opcode: 'control_forever', next: null, parent: hatId, inputs: {SUBSTACK: [2, bodyId]},
        fields: {}, topLevel: false},
    [bodyId]: {...body, next: null, parent: foreverId, topLevel: false}
});

const boomExtension = class {
    getInfo () {
        return {
            id: 'boom',
            name: 'Boom',
            blocks: [
                {opcode: 'explode', blockType: 'command', text: 'explode'},
                {opcode: 'whenBroken', blockType: 'hat', text: 'when broken', isEdgeActivated: true}
            ]
        };
    }
    explode () {
        throw new Error('explode threw');
    }
    whenBroken () {
        throw new Error('predicate threw');
    }
};

const loadCounterProject = async (vm, extraBlocks = {}) => {
    vm.extensionManager.addBuiltinExtension('boom', boomExtension);
    await vm.loadProject(stage({
        ...forever('hatA', 'loopA', 'explode', {opcode: 'boom_explode', inputs: {}, fields: {}}),
        ...forever('hatB', 'loopB', 'count', {
            opcode: 'data_changevariableby',
            inputs: {VALUE: [1, [4, '1']]},
            fields: {VARIABLE: ['counter', 'counterId']}
        }),
        ...extraBlocks
    }, {counterId: ['counter', 0]}));
};

const counter = vm => vm.runtime.getTargetForStage().variables.counterId.value;

for (const compiled of [true, false]) {
    test(`a throwing block does not stop other scripts (${compiled ? 'compiled' : 'interpreted'})`, async t => {
        const vm = new VM();
        vm.setCompilerOptions({enabled: compiled});
        await loadCounterProject(vm);
        vm.greenFlag();
        for (let i = 0; i < 3; i++) vm.runtime._step();

        t.ok(counter(vm) > 0, 'the counting script kept running');
        const throwing = vm.runtime.threads.find(thread => thread.topBlock === 'hatA');
        if (compiled) {
            t.notOk(throwing, 'the compiled thread whose generator threw was retired');
        } else {
            t.ok(throwing, 'the interpreted thread stays and retries the block next frame');
        }
        vm.quit();
    });
}

test('a throwing edge-activated hat predicate does not stop other scripts', async t => {
    const vm = new VM();
    await loadCounterProject(vm, {
        hatC: {opcode: 'boom_whenBroken', next: null, parent: null, inputs: {}, fields: {},
            topLevel: true, x: 0, y: 0}
    });
    vm.greenFlag();
    for (let i = 0; i < 3; i++) vm.runtime._step();
    t.ok(counter(vm) > 0, 'the counting script kept running');
    vm.quit();
});

test('a getInfo that throws rejects the load without hanging project load', async t => {
    const vm = new VM();
    vm.extensionManager.securityManager.getSandboxMode = () => 'unsandboxed';
    global.document = {
        createElement: () => {
            setTimeout(() => {
                if (global.Scratch && global.Scratch.extensions) {
                    global.Scratch.extensions.register({
                        getInfo: () => {
                            throw new Error('getInfo threw');
                        }
                    });
                }
            });
            return {};
        },
        head: {appendChild: () => {}},
        body: {appendChild: () => {}}
    };

    const url = 'https://example.com/broken.js';
    await t.rejects(vm.extensionManager.loadExtensionURL(url), /getInfo threw/);
    t.equal(vm.extensionManager.loadingAsyncExtensions, 0);
    await vm.extensionManager.allAsyncExtensionsLoaded();
    t.equal(vm.extensionManager.isExtensionURLLoaded(url), false, 'the URL can be loaded again');
    delete global.document;
    vm.quit();
});

test('removeExtension reports whether it removed anything', t => {
    const vm = new VM();
    vm.extensionManager.loadExtensionIdSync('pen');
    t.equal(vm.extensionManager.removeExtension('pen'), true);
    t.equal(vm.extensionManager.removeExtension('pen'), false);
    vm.quit();
    t.end();
});

test('removeExtension drops the compFunc compilers it registered', async t => {
    const vm = new VM();
    vm.extensionManager.addBuiltinExtension('compiledThing', class {
        getInfo () {
            return {
                id: 'compiledThing',
                blocks: [{opcode: 'one', blockType: 'reporter', text: 'one', compFunc: 'compileOne'}]
            };
        }
        compileOne () {
            return '1';
        }
        one () {
            return 1;
        }
    });
    vm.extensionManager.loadExtensionIdSync('compiledThing');
    t.ok(vm.runtime.compilerExtensions.has('compiledThing_one'));
    vm.extensionManager.removeExtension('compiledThing');
    t.notOk(vm.runtime.compilerExtensions.has('compiledThing_one'));
    t.ok(vm.runtime.compilerExtensions.has('mistsutils_notequals'), 'built-in compilers are kept');
    vm.quit();
});

test('denied and failed project extensions keep their URL for saving', async t => {
    const vm = new VM();
    const denied = 'https://example.com/denied.js';
    vm.securityManager.canLoadExtensionFromProject = () => false;
    await vm._loadExtensions(['deniedExtension'], new Map([['deniedExtension', denied]]));
    t.equal(vm.extensionManager.getExtensionURLs().deniedExtension, denied);

    vm.extensionManager.clearUnloadedExtensions();
    t.notOk(vm.extensionManager.getExtensionURLs().deniedExtension, 'forgotten when another project loads');
    vm.quit();
});

test('compiled extension commands that write variables do not leave stale types', async t => {
    const vm = new VM();
    vm.exports.compiler.register('writer', {
        setText: {
            type: vm.exports.compiler.types.COMMAND,
            compile: ({target}) => `${target}.lookupVariableById("numId").value = "abc";`
        }
    });
    vm.extensionManager.addBuiltinExtension('writer', class {
        getInfo () {
            return {id: 'writer', blocks: [{opcode: 'setText', blockType: 'command', text: 'set text'}]};
        }
        setText () {}
    });
    const project = stage({
        hat: {opcode: 'event_whenflagclicked', next: 'setNumber', parent: null, inputs: {}, fields: {},
            topLevel: true, x: 0, y: 0},
        setNumber: {opcode: 'data_setvariableto', next: 'write', parent: 'hat',
            inputs: {VALUE: [1, [10, '5']]}, fields: {VARIABLE: ['num', 'numId']}, topLevel: false},
        write: {opcode: 'writer_setText', next: 'setResult', parent: 'setNumber', inputs: {}, fields: {},
            topLevel: false},
        setResult: {opcode: 'data_setvariableto', next: null, parent: 'write',
            inputs: {VALUE: [3, 'add', [10, '']]}, fields: {VARIABLE: ['result', 'resultId']}, topLevel: false},
        add: {opcode: 'operator_add', next: null, parent: 'setResult',
            inputs: {NUM1: [3, 'readNum', [4, '']], NUM2: [1, [4, '1']]}, fields: {}, topLevel: false},
        readNum: {opcode: 'data_variable', next: null, parent: 'add', inputs: {},
            fields: {VARIABLE: ['num', 'numId']}, topLevel: false}
    }, {numId: ['num', 0], resultId: ['result', 0]});
    project.extensions = ['writer'];
    await vm.loadProject(project);
    vm.greenFlag();
    vm.runtime._step();
    t.equal(vm.runtime.getTargetForStage().variables.resultId.value, 1, '"abc" + 1 is 1 in Scratch');
    vm.quit();
});

test('a compiled command that declares a variable can be used twice in one script', async t => {
    const vm = new VM();
    vm.exports.compiler.register('declarer', {
        bump: {
            type: vm.exports.compiler.types.COMMAND,
            compile: ({target}) => `const v = ${target}.lookupVariableById("countId"); v.value = +v.value + 1;`
        }
    });
    vm.extensionManager.addBuiltinExtension('declarer', class {
        getInfo () {
            return {id: 'declarer', blocks: [{opcode: 'bump', blockType: 'command', text: 'bump'}]};
        }
        bump () {}
    });
    const errors = [];
    vm.on('COMPILE_ERROR', (target, error) => errors.push(error));
    const project = stage({
        hat: {opcode: 'event_whenflagclicked', next: 'first', parent: null, inputs: {}, fields: {},
            topLevel: true, x: 0, y: 0},
        first: {opcode: 'declarer_bump', next: 'second', parent: 'hat', inputs: {}, fields: {}, topLevel: false},
        second: {opcode: 'declarer_bump', next: null, parent: 'first', inputs: {}, fields: {}, topLevel: false}
    }, {countId: ['count', 0]});
    project.extensions = ['declarer'];
    await vm.loadProject(project);
    vm.greenFlag();
    vm.runtime._step();
    t.same(errors, [], 'the script compiled');
    t.equal(vm.runtime.getTargetForStage().variables.countId.value, 2);
    vm.quit();
});

const mockScriptLoads = registrations => {
    let index = 0;
    global.document = {
        createElement: () => {
            const ids = registrations[index++] || [];
            setTimeout(() => {
                for (const [id, version] of ids) {
                    global.Scratch.extensions.register({
                        getInfo: () => ({id, name: `${id} ${version}`, blocks: []})
                    });
                }
            }, 20);
            return {};
        },
        head: {appendChild: () => {}},
        body: {appendChild: () => {}}
    };
};

test('removing one extension of a multi-extension script keeps the URL its siblings use', async t => {
    const vm = new VM();
    vm.extensionManager.securityManager.getSandboxMode = () => 'unsandboxed';
    mockScriptLoads([[['sibA', 'v1'], ['sibB', 'v1']]]);
    const url = 'https://example.com/pair.js';
    await vm.extensionManager.loadExtensionURL(url);
    vm.extensionManager.removeExtension('sibA');
    t.equal(vm.extensionManager.getExtensionURLs().sibB, url);
    delete global.document;
    vm.quit();
});

test('a project replaces every extension registered by an older copy of its script', async t => {
    const vm = new VM();
    vm.extensionManager.securityManager.getSandboxMode = () => 'unsandboxed';
    vm.securityManager.canLoadExtensionFromProject = () => true;
    mockScriptLoads([[['pairA', 'old'], ['pairB', 'old']], [['pairA', 'new'], ['pairB', 'new']]]);
    await vm.extensionManager.loadExtensionURL('https://example.com/old.js');

    const newURL = 'https://example.com/new.js';
    await vm._loadExtensions(['pairA', 'pairB'], new Map([['pairA', newURL], ['pairB', newURL]]), () => true, true);

    const names = vm.runtime._blockInfo.filter(info => info.id.startsWith('pair')).map(info => info.name);
    t.same(names.sort(), ['pairA new', 'pairB new'], 'one category each, from the new script');
    t.same(vm.extensionManager.getExtensionURLs(), {pairA: newURL, pairB: newURL});
    delete global.document;
    vm.quit();
});

test('removeExtension drops compiler.register entries and restores built-in compilers it replaced', t => {
    const vm = new VM();
    const builtin = vm.runtime.compilerExtensions.get('mistsutils_notequals');
    vm.exports.compiler.register('mistsutils', {
        notequals: {type: vm.exports.compiler.types.BOOLEAN, compile: () => 'false'}
    });
    vm.exports.compiler.register('mine', {
        thing: {type: vm.exports.compiler.types.NUMBER, compile: () => '1'}
    });
    vm.runtime.compilerUnregisterExtension('mistsutils');
    vm.runtime.compilerUnregisterExtension('mine');
    t.equal(vm.runtime.compilerExtensions.get('mistsutils_notequals'), builtin);
    t.notOk(vm.runtime.compilerExtensions.has('mine_thing'));
    vm.quit();
    t.end();
});

test('thread errors are emitted for the editor', async t => {
    const vm = new VM();
    const seen = [];
    vm.runtime.on('THREAD_ERROR', ({error}) => seen.push(error.message));
    await loadCounterProject(vm);
    vm.greenFlag();
    vm.runtime._step();
    t.ok(seen.includes('explode threw'));
    vm.quit();
});

test('a script loaded for several extensions of a project is loaded once', async t => {
    const vm = new VM();
    vm.extensionManager.securityManager.getSandboxMode = () => 'unsandboxed';
    vm.securityManager.canLoadExtensionFromProject = () => true;
    mockScriptLoads([[['onceA', 'v1'], ['onceB', 'v1']], [['onceA', 'v2'], ['onceB', 'v2']]]);
    const url = 'https://example.com/once.js';
    await vm._loadExtensions(['onceA', 'onceB'], new Map([['onceA', url], ['onceB', url]]));
    const names = vm.runtime._blockInfo.filter(info => info.id.startsWith('once')).map(info => info.name);
    t.same(names.sort(), ['onceA v1', 'onceB v1']);
    delete global.document;
    vm.quit();
});

test('a hat predicate that throws every frame is logged once', async t => {
    const log = require('../../src/util/log');
    const originalError = log.error;
    let logged = 0;
    log.error = () => {
        logged++;
    };
    const vm = new VM();
    await loadCounterProject(vm, {
        hatC: {opcode: 'boom_whenBroken', next: null, parent: null, inputs: {}, fields: {},
            topLevel: true, x: 0, y: 0}
    });
    for (let i = 0; i < 20; i++) vm.runtime._step();
    log.error = originalError;
    t.equal(logged, 1);
    vm.quit();
});

test('extension message context reports the target type', t => {
    const vm = new VM();
    t.same(vm.runtime.makeMessageContextForTarget({isStage: true}), {targetType: 'stage'});
    t.same(vm.runtime.makeMessageContextForTarget({isStage: false}), {targetType: 'sprite'});
    vm.quit();
    t.end();
});

test('a primitive shadow without its field still saves', async t => {
    const vm = new VM();
    await vm.loadProject(stage({
        hat: {opcode: 'event_whenflagclicked', next: 'say', parent: null, inputs: {}, fields: {},
            topLevel: true, x: 0, y: 0},
        say: {opcode: 'looks_say', next: null, parent: 'hat', inputs: {MESSAGE: [1, [10, 'hi']]}, fields: {},
            topLevel: false}
    }));
    const blocks = vm.runtime.getTargetForStage().blocks;
    const shadowId = blocks.getBlock('say').inputs.MESSAGE.shadow;
    blocks.getBlock(shadowId).fields = {};
    const saved = JSON.parse(vm.toJSON());
    const reloaded = new VM();
    await reloaded.loadProject(saved);
    const opcodes = Object.values(reloaded.runtime.getTargetForStage().blocks._blocks).map(block => block.opcode);
    t.same(opcodes.sort(), ['event_whenflagclicked', 'looks_say', 'text'], 'the project saved and loaded again');
    vm.quit();
    reloaded.quit();
});

test('a dynamic menu that throws or returns a null item falls back to an empty menu', t => {
    const vm = new VM();
    const extension = {
        throwing: () => {
            throw new Error('menu threw');
        },
        withNull: () => [null, 'a']
    };
    t.same(vm.extensionManager._getExtensionMenuItems(extension, 'throwing'), [['', '']]);
    t.same(vm.extensionManager._getExtensionMenuItems(extension, 'withNull'), [['', '']]);
    vm.quit();
    t.end();
});

test('blocks of a failed extension can be dragged to another sprite', async t => {
    const vm = new VM();
    await vm.loadProject(stage({}));
    vm.extensionManager.recordUnloadedExtension('ghost', 'https://example.com/ghost.js');
    const stageTarget = vm.runtime.getTargetForStage();
    await vm.shareBlocksToTarget([{
        id: 'g', opcode: 'ghost_say', next: null, parent: null, inputs: {}, fields: {}, shadow: false,
        topLevel: true, x: 0, y: 0
    }], stageTarget.id);
    const opcodes = Object.values(stageTarget.blocks._blocks).map(block => block.opcode);
    t.same(opcodes, ['ghost_say']);
    t.equal(vm.extensionManager.getExtensionURLs().ghost, 'https://example.com/ghost.js');
    vm.quit();
});

test('an extension that loads after failing is no longer reported as unloaded', t => {
    const vm = new VM();
    vm.extensionManager.recordUnloadedExtension('pen', 'https://example.com/pen.js');
    t.equal(vm.extensionManager.isExtensionUnloaded('pen'), true);
    vm.extensionManager.loadExtensionIdSync('pen');
    t.equal(vm.extensionManager.isExtensionUnloaded('pen'), false);
    vm.quit();
    t.end();
});
