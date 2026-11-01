const {test} = require('node:test');
const assert = require('node:assert');
const VM = require('../../src/virtual-machine');
const sb3 = require('../../src/serialization/sb3');
const Variable = require('../../src/engine/variable');
const {validateBlockIntegrity, CodeApplyError} = require('../../src/engine/replace-target-scripts');
const {FRACTCH_MAP_COMMENT_MAGIC} = require('../../src/serialization/fractch-context');

const makeTarget = (isStage, name, blocks, extra = {}) => Object.assign({
    isStage,
    name,
    variables: {},
    lists: {},
    broadcasts: {},
    blocks,
    comments: {},
    currentCostume: 0,
    costumes: [],
    sounds: [],
    volume: 100,
    layerOrder: isStage ? 0 : 1
}, isStage ?
    {tempo: 60, videoTransparency: 50, videoState: 'on', textToSpeechLanguage: null} :
    {visible: true, x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around'},
extra);

const top = (opcode, next, extra = {}) => Object.assign({opcode, next, parent: null, inputs: {}, fields: {},
    shadow: false, topLevel: true, x: 0, y: 0}, extra);
const child = (opcode, parent, next, extra = {}) => Object.assign({opcode, next, parent, inputs: {}, fields: {},
    shadow: false, topLevel: false}, extra);
const procMutation = {tagName: 'mutation', children: [], proccode: 'jump', argumentids: '[]', warp: 'false'};

const spriteBlocks = () => ({
    hat: top('event_whenflagclicked', 'loopA'),
    loopA: child('control_forever', 'hat', null, {inputs: {SUBSTACK: [2, 'moveA']}}),
    moveA: child('motion_movesteps', 'loopA', null, {inputs: {STEPS: [1, [4, '10']]}}),
    hatB: top('event_whenflagclicked', 'loopB', {y: 100, comment: 'onB'}),
    loopB: child('control_forever', 'hatB', null, {inputs: {SUBSTACK: [2, 'turnB']}}),
    turnB: child('motion_turnright', 'loopB', null, {inputs: {DEGREES: [1, [4, '15']]}}),
    hatC: top('event_whenflagclicked', 'loopC', {y: 200}),
    loopC: child('control_forever', 'hatC', null, {inputs: {SUBSTACK: [2, 'callC']}}),
    callC: child('procedures_call', 'loopC', null, {mutation: procMutation}),
    defJ: top('procedures_definition', 'changeJ', {y: 300, inputs: {custom_block: [1, 'protoJ']}}),
    protoJ: child('procedures_prototype', 'defJ', null, {shadow: true, mutation: Object.assign({}, procMutation, {
        argumentnames: '[]', argumentdefaults: '[]'})}),
    changeJ: child('motion_changeyby', 'defJ', null, {inputs: {DY: [1, [4, '1']]}}),
    hatR: top('event_whenbroadcastreceived', 'sayR', {y: 400, fields: {BROADCAST_OPTION: ['go', 'b1']}}),
    sayR: child('looks_say', 'hatR', null, {inputs: {MESSAGE: [1, [10, 'hi']]}}),
    hatO: top('event_whenkeypressed', 'sayO', {y: 500, fields: {KEY_OPTION: ['space', null]}}),
    sayO: child('looks_say', 'hatO', null, {inputs: {MESSAGE: [3, 'addO', [10, '']]}}),
    addO: child('operator_add', 'sayO', null, {inputs: {NUM1: [3, 'addO2', [4, '7']], NUM2: [1, [4, '3']]}}),
    addO2: child('operator_add', 'addO', null, {inputs: {NUM1: [1, [4, '1']], NUM2: [1, [4, '2']]}})
});

const project = () => ({
    targets: [
        makeTarget(true, 'Stage', {
            send: top('event_broadcast', null, {inputs: {BROADCAST_INPUT: [1, [11, 'go', 'b1']]}})
        }, {
            variables: {g: ['score', 5]},
            broadcasts: {b1: 'go'},
            comments: {
                cfg: {blockId: null, x: 0, y: 0, width: 200, height: 200, minimized: false,
                    text: 'Configuration\n{} // _twconfig_'}
            }
        }),
        makeTarget(false, 'Sprite1', spriteBlocks(), {
            variables: {l: ['lives', 3]},
            lists: {items: ['items', ['a']]},
            comments: {
                floating: {blockId: null, x: 9, y: 9, width: 200, height: 200, minimized: false, text: 'note'},
                onB: {blockId: 'hatB', x: 0, y: 0, width: 200, height: 200, minimized: false, text: 'b comment'},
                map: {blockId: null, x: 0, y: 0, width: 200, height: 200, minimized: true,
                    text: `${FRACTCH_MAP_COMMENT_MAGIC}{"hatB":"Enemies"}`}
            },
            frames: {f1: {title: 'Frame', x: 0, y: 0, width: 300, height: 300, collapsed: true,
                blocks: ['hatR', 'hatB']}}
        })
    ],
    monitors: [{id: 'l', mode: 'default', opcode: 'data_variable', params: {VARIABLE: 'lives'},
        spriteName: 'Sprite1', value: 0, width: 0, height: 0, x: 5, y: 5, visible: true,
        sliderMin: 0, sliderMax: 100, isDiscrete: true}],
    extensions: [],
    meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
});

const load = async ({compiled = true} = {}) => {
    const vm = new VM();
    vm.setCompilerOptions({enabled: compiled});
    await vm.loadProject(project());
    const sprite = vm.runtime.targets.find(target => !target.isStage);
    const stage = vm.runtime.getTargetForStage();
    let changes = 0;
    vm.on('PROJECT_CHANGED', () => {
        changes++;
    });
    return {vm, sprite, stage, changes: () => changes};
};

const sb3Subtree = (blocks, rootId, into) => {
    const pending = [rootId];
    while (pending.length) {
        const id = pending.pop();
        if (typeof id !== 'string' || into[id] || !blocks[id]) continue;
        const block = blocks[id];
        into[id] = JSON.parse(JSON.stringify(block));
        if (Array.isArray(block)) continue;
        if (block.next) pending.push(block.next);
        for (const input of Object.values(block.inputs)) pending.push(input[1], input[2]);
    }
    return into;
};

const rebuild = (vm, target, topIds, edit = () => {}) => {
    const entry = vm.getFractchContext(target.id).targets[0];
    const blocks = {};
    for (const topId of topIds) sb3Subtree(entry.blocks, topId, blocks);
    const obscuredShadows = {};
    for (const id of Object.keys(entry.obscuredShadows)) {
        if (blocks[id]) obscuredShadows[id] = entry.obscuredShadows[id];
    }
    edit(blocks);
    return {
        format: 'sb3',
        blocks,
        primitiveIds: entry.primitiveIds,
        obscuredShadows,
        keepScripts: target.blocks.getScripts().filter(id => !topIds.includes(id))
    };
};

const keepAllBut = (target, removed) => ({
    format: 'sb3',
    blocks: {},
    keepScripts: target.blocks.getScripts().filter(id => !removed.includes(id))
});

test('an edit reuses ids, keeps other scripts as they are and emits one change', async () => {
    const {vm, sprite, changes} = await load();
    const container = sprite.blocks;
    const kept = container.getBlock('hatB');
    const order = container.getScripts().slice();
    const stepsId = container.getBlock('moveA').inputs.STEPS.block;
    const revision = container.revision;
    const result = vm.replaceTargetScripts(sprite.id, rebuild(vm, sprite, ['hat'], blocks => {
        blocks.moveA.inputs.STEPS = [1, [4, '20']];
    }));
    assert.strictEqual(sprite.blocks, container, 'the Blocks container is kept');
    assert.strictEqual(container.getBlock('hatB'), kept, 'unchanged scripts keep their objects');
    assert.deepStrictEqual(container.getScripts(), order, 'script order is kept');
    assert.strictEqual(container.getBlock('moveA').inputs.STEPS.block, stepsId, 'primitive ids are honoured');
    assert.strictEqual(container.getBlock(stepsId).fields.NUM.value, '20');
    assert.strictEqual(changes(), 1, 'PROJECT_CHANGED is emitted once');
    assert.ok(container.revision > revision);
    assert.deepStrictEqual(result.rebuiltTopIds, ['hat']);
    assert.deepStrictEqual(result.removedTopIds, []);
    assert.deepStrictEqual(result.createdTopIds, []);
    assert.deepStrictEqual(validateBlockIntegrity(container._blocks), [], 'the result is consistent');
});

test('kept scripts are carried as they are, even when unusual', async () => {
    const {vm, sprite} = await load();
    sprite.blocks.getBlock('turnB').inputs.EXTRA = {name: 'EXTRA', block: 'missing', shadow: null};
    vm.replaceTargetScripts(sprite.id, rebuild(vm, sprite, ['hat'], blocks => {
        blocks.moveA.inputs.STEPS = [1, [4, '30']];
    }));
    assert.strictEqual(sprite.blocks.getBlock('turnB').inputs.EXTRA.block, 'missing');
});

test('a failed change leaves the target untouched', async () => {
    const {vm, sprite, changes} = await load();
    const blocks = sprite.blocks._blocks;
    const revision = sprite.blocks.revision;
    const variables = Object.keys(sprite.variables);
    const change = rebuild(vm, sprite, ['hat'], built => {
        built.moveA.parent = 'nowhere';
    });
    change.variables = {create: [{id: 'speed', name: 'speed', value: 1}], delete: ['l']};
    assert.throws(() => vm.replaceTargetScripts(sprite.id, change), CodeApplyError);
    assert.strictEqual(sprite.blocks._blocks, blocks);
    assert.strictEqual(sprite.blocks.revision, revision);
    assert.deepStrictEqual(Object.keys(sprite.variables), variables);
    assert.ok(vm.runtime.getMonitorState().has('l'), 'the monitor is untouched');
    assert.strictEqual(changes(), 0);
});

test('block integrity validation', () => {
    const valid = () => ({
        a: {id: 'a', opcode: 'looks_say', next: 'b', parent: null, topLevel: true, shadow: false, fields: {},
            inputs: {MESSAGE: {name: 'MESSAGE', block: 'm', shadow: 'm'}}},
        m: {id: 'm', opcode: 'text', next: null, parent: 'a', topLevel: false, shadow: true, inputs: {},
            fields: {TEXT: {name: 'TEXT', value: 'hi'}}},
        b: {id: 'b', opcode: 'operator_add', next: null, parent: 'a', topLevel: false, shadow: false, fields: {},
            inputs: {}, obscuredHeadShadows: ['s']},
        s: {id: 's', opcode: 'math_number', next: null, parent: 'b', topLevel: false, shadow: true, inputs: {},
            fields: {NUM: {name: 'NUM', value: '7'}}}
    });
    assert.deepStrictEqual(validateBlockIntegrity(valid()), []);
    const broken = mutate => {
        const blocks = valid();
        mutate(blocks);
        return validateBlockIntegrity(blocks).map(error => error.message);
    };
    assert.match(broken(b => {
        b.b.parent = 'x';
    }).join('\n'), /missing parent/);
    assert.match(broken(b => {
        b.a.next = 'gone';
    }).join('\n'), /missing next/);
    assert.match(broken(b => {
        b.a.inputs.MESSAGE.shadow = 'zzz';
    }).join('\n'), /missing shadow/);
    assert.match(broken(b => {
        b.m.parent = null;
        b.m.topLevel = true;
    }).join('\n'), /Shadow block m is top level/);
    assert.match(broken(b => {
        b.b.obscuredHeadShadows = ['nope'];
    }).join('\n'), /Obscured shadow nope/);
    assert.match(broken(b => {
        b.a.parent = 'b';
        b.a.topLevel = false;
        b.b.next = 'a';
    }).join('\n'), /cycle/);
    assert.match(broken(b => {
        b.a.topLevel = false;
    }).join('\n'), /not top level/);
    assert.match(broken(b => {
        b.b.inputs.X = {name: 'X', block: 'm', shadow: null};
    }).join('\n'), /referenced 2 times/);
    assert.match(broken(b => {
        b.a.inputs.MESSAGE.name = 'OTHER';
    }).join('\n'), /has the name OTHER/);
    const comments = {c: {blockId: 'b'}};
    const blocks = valid();
    blocks.a.comment = 'c';
    assert.match(validateBlockIntegrity(blocks, null, comments)[0].message, /attached elsewhere/);
    assert.deepStrictEqual(validateBlockIntegrity(blocks, ['m'], comments), [], 'only the listed blocks are checked');
});

test('threads are stopped by the rules', async () => {
    for (const compiled of [true, false]) {
        const {vm, sprite} = await load({compiled});
        const clone = sprite.makeClone();
        vm.greenFlag();
        vm.runtime._step();
        const cloneA = vm.runtime._pushThread('hat', clone);
        const cloneB = vm.runtime._pushThread('hatB', clone);
        const thread = topId => vm.runtime.threads.find(item => item.topBlock === topId && item.target === sprite);
        const threadA = thread('hat');
        const threadB = thread('hatB');
        const threadC = thread('hatC');
        assert.ok(threadA && threadB && threadC, 'the scripts run');
        const result = vm.replaceTargetScripts(sprite.id, rebuild(vm, sprite, ['hat', 'defJ'], blocks => {
            blocks.changeJ.inputs.DY = [1, [4, '2']];
        }));
        assert.ok(threadA.isKilled, `a changed script stops (${compiled})`);
        assert.ok(threadC.isKilled, `a script calling a changed procedure stops (${compiled})`);
        assert.ok(!threadB.isKilled, `an unrelated script keeps running (${compiled})`);
        assert.ok(cloneA.isKilled, 'clones follow the same rule');
        assert.ok(!cloneB.isKilled);
        assert.strictEqual(result.stoppedThreads, 3);
        assert.strictEqual(threadB.blockContainer, sprite.blocks, 'running threads keep a valid container');
        vm.runtime._step();
    }
});

test('variables are created, deleted and set as asked', async () => {
    const {vm, sprite, stage} = await load();
    const clone = sprite.makeClone();
    stage.variables.g.value = 99;
    sprite.variables.items.value.push('live');
    assert.ok(vm.runtime.getMonitorState().has('l'));
    const change = keepAllBut(sprite, []);
    change.variables = {
        create: [
            {id: 'speed', name: 'speed', value: 4},
            {id: 'hidden', name: '!local_score', value: 0},
            {id: 'msg', name: 'later', type: Variable.BROADCAST_MESSAGE_TYPE}
        ],
        delete: ['l'],
        set: {items: ['x', 'y']}
    };
    const result = vm.replaceTargetScripts(sprite.id, change);
    assert.strictEqual(sprite.variables.speed.value, 4);
    assert.strictEqual(clone.variables.speed.value, 4, 'new variables reach clones');
    assert.notStrictEqual(clone.variables.speed, sprite.variables.speed);
    assert.ok(stage.variables.msg, 'broadcasts are created on the Stage');
    assert.ok(!sprite.variables.l, 'deleted');
    assert.ok(!clone.variables.l, 'deleted on clones too');
    assert.ok(!vm.runtime.getMonitorState().has('l'), 'the monitor goes with it');
    assert.ok(!vm.runtime.monitorBlocks.getBlock('l'));
    assert.deepStrictEqual(sprite.variables.items.value, ['x', 'y'], 'an edited value is set');
    assert.strictEqual(stage.variables.g.value, 99, 'other live values are kept');
    assert.deepStrictEqual(result.createdVariableIds, ['speed', 'hidden', 'msg']);
    assert.deepStrictEqual(result.deletedVariableIds, ['l']);
});

test('variable changes are refused when unsafe', async () => {
    const {vm, sprite} = await load();
    const clash = keepAllBut(sprite, []);
    clash.variables = {create: [{id: 'other', name: 'score'}]};
    assert.throws(() => vm.replaceTargetScripts(sprite.id, clash), /score now names a different variable in the Stage/);

    const used = rebuild(vm, sprite, ['hat'], blocks => {
        blocks.moveA.inputs.STEPS = [3, [12, 'lives', 'l'], [4, '10']];
    });
    used.variables = {delete: ['l']};
    assert.throws(() => vm.replaceTargetScripts(sprite.id, used), /lives is used by Sprite1/);

    const global = keepAllBut(vm.runtime.getTargetForStage(), []);
    global.variables = {delete: ['b1']};
    assert.throws(() => vm.replaceTargetScripts(vm.runtime.getTargetForStage().id, global), /go is used by/);

    const twice = keepAllBut(sprite, []);
    twice.variables = {create: [{id: 'l', name: 'again'}]};
    assert.throws(() => vm.replaceTargetScripts(sprite.id, twice), /already used/);
    assert.ok(sprite.variables.l);
});

test('comments: reserved ones are taken live and build comments are checked', async () => {
    const {vm, sprite, stage} = await load();
    const reserved = stage.comments.cfg;
    const stageChange = keepAllBut(stage, []);
    stageChange.comments = {cfg: {blockId: null, x: 0, y: 0, width: 1, height: 1, minimized: false,
        text: 'edited // _twconfig_'}};
    vm.replaceTargetScripts(stage.id, stageChange);
    assert.strictEqual(stage.comments.cfg, reserved, 'the live reserved comment is kept');
    assert.strictEqual(reserved.text, 'Configuration\n{} // _twconfig_');
    const empty = keepAllBut(stage, []);
    empty.comments = {};
    vm.replaceTargetScripts(stage.id, empty);
    assert.strictEqual(stage.comments.cfg, reserved, 'even when the build has none');

    const twoOnOne = rebuild(vm, sprite, ['hat']);
    twoOnOne.comments = {
        c1: {blockId: 'moveA', x: 0, y: 0, width: 100, height: 100, minimized: false, text: 'one'},
        c2: {blockId: 'moveA', x: 0, y: 0, width: 100, height: 100, minimized: false, text: 'two'}
    };
    assert.throws(() => vm.replaceTargetScripts(sprite.id, twoOnOne), /two comments/);
    const second = rebuild(vm, sprite, ['hat']);
    second.comments = {c3: {blockId: 'hatB', x: 0, y: 0, width: 100, height: 100, minimized: false, text: 'x'}};
    assert.throws(() => vm.replaceTargetScripts(sprite.id, second), /second comment/);

    const attach = rebuild(vm, sprite, ['hat']);
    attach.comments = {
        c4: {blockId: 'moveA', x: 0, y: 0, width: 100, height: 100, minimized: false, text: 'go'},
        floating: {blockId: null, x: 1, y: 1, width: 100, height: 100, minimized: false, text: 'moved'},
        map: {blockId: null, x: 1, y: 1, width: 100, height: 100, minimized: true,
            text: `${FRACTCH_MAP_COMMENT_MAGIC}{}`}
    };
    vm.replaceTargetScripts(sprite.id, attach);
    assert.strictEqual(sprite.blocks.getBlock('moveA').comment, 'c4');
    assert.strictEqual(sprite.comments.c4.blockId, 'moveA');
    assert.strictEqual(sprite.comments.floating.text, 'moved');
    assert.strictEqual(sprite.comments.onB.blockId, 'hatB', 'comments of kept scripts are kept');
    assert.ok(sprite.comments.map);

    const keepComments = keepAllBut(sprite, []);
    vm.replaceTargetScripts(sprite.id, keepComments);
    assert.ok(sprite.comments.floating && sprite.comments.map, 'without comments in the change, floating ones stay');
});

test('frame membership is pruned and remapped', async () => {
    const {vm, sprite} = await load();
    assert.deepStrictEqual(sprite.frames.f1.blocks, ['hatR', 'hatB']);
    const change = rebuild(vm, sprite, ['hatB'], blocks => {
        blocks.hatB2 = Object.assign(blocks.hatB, {});
        delete blocks.hatB;
        blocks.loopB.parent = 'hatB2';
    });
    change.keepScripts = change.keepScripts.filter(id => id !== 'hatR');
    change.idMap = {hatB: 'hatB2'};
    vm.replaceTargetScripts(sprite.id, change);
    assert.deepStrictEqual(sprite.frames.f1.blocks, ['hatB2']);
});

test('undo and redo restore scripts, comments, declarations and monitors', async () => {
    const {vm, sprite} = await load();
    const lives = sprite.variables.l;
    const monitorBefore = JSON.stringify(vm.runtime.getMonitorState().get('l'));
    const blocksBefore = JSON.parse(JSON.stringify(sprite.blocks._blocks));
    const commentsBefore = JSON.stringify(sprite.comments);
    const change = keepAllBut(sprite, ['hatB', 'hatO']);
    change.comments = {};
    change.variables = {
        delete: ['l'],
        set: {items: ['z']},
        create: [{id: 'made', name: 'made', type: Variable.BROADCAST_MESSAGE_TYPE}, {id: 'mine', name: 'mine'}]
    };
    const applied = vm.replaceTargetScripts(sprite.id, change);
    assert.ok(!sprite.blocks.getBlock('hatB'));
    assert.ok(!sprite.comments.floating);
    assert.ok(!sprite.comments.map, 'the map comment follows the change');
    const afterHash = vm.getCodeStateHash(sprite.id);

    const undone = vm.replaceTargetScripts(sprite.id, {restore: applied.previous});
    assert.deepStrictEqual(JSON.parse(JSON.stringify(sprite.blocks._blocks)), blocksBefore,
        'blocks deep-equal the before state');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(sprite.comments)), JSON.parse(commentsBefore), 'comments too');
    assert.strictEqual(sprite.variables.l, lives, 'the deleted variable object comes back');
    assert.strictEqual(lives.value, 3);
    assert.deepStrictEqual(sprite.variables.items.value, ['a']);
    assert.strictEqual(JSON.stringify(vm.runtime.getMonitorState().get('l')), monitorBefore, 'the monitor comes back');
    assert.ok(vm.runtime.monitorBlocks.getBlock('l'));
    assert.deepStrictEqual(sprite.frames.f1.blocks, ['hatR', 'hatB']);
    assert.ok(!sprite.variables.mine, 'local variables the apply created are removed');
    assert.ok(vm.runtime.getTargetForStage().variables.made, 'Stage declarations the apply created stay');
    assert.deepStrictEqual(undone.leftInPlaceVariableIds, ['made']);

    vm.replaceTargetScripts(sprite.id, {restore: undone.previous});
    assert.ok(!sprite.variables.l, 'redo deletes again');
    assert.ok(!vm.runtime.getMonitorState().has('l'));
    assert.deepStrictEqual(sprite.variables.items.value, ['z']);
    assert.strictEqual(vm.getCodeStateHash(sprite.id), afterHash, 'redo lands on the applied state');
});

test('undo brings back a broadcast the VM cleaned up, under its live name', async () => {
    const {vm, sprite, stage} = await load();
    vm.setEditingTarget(sprite.id);
    const applied = vm.replaceTargetScripts(sprite.id, keepAllBut(sprite, ['hatR']));
    stage.blocks.deleteBlock('send');
    vm._broadcastCleanupNeeded = true;
    vm.emitWorkspaceUpdate();
    assert.ok(!stage.variables.b1, 'the VM removed the unused broadcast');
    vm.replaceTargetScripts(sprite.id, {restore: applied.previous});
    assert.strictEqual(stage.variables.b1.name, 'go', 'the broadcast is recreated');
    const threads = vm.runtime.startHats('event_whenbroadcastreceived', {BROADCAST_OPTION: 'go'});
    assert.ok(threads.some(thread => thread.topBlock === 'hatR'), 'the hat fires');
});

test('undo renames restored fields to live names', async () => {
    const {vm, sprite, stage} = await load();
    const applied = vm.replaceTargetScripts(sprite.id, keepAllBut(sprite, ['hatR']));
    stage.renameVariable('b1', 'start');
    stage.blocks.getBlock(stage.blocks.getBlock('send').inputs.BROADCAST_INPUT.block)
        .fields.BROADCAST_OPTION.value = 'start';
    vm.replaceTargetScripts(sprite.id, {restore: applied.previous});
    assert.strictEqual(sprite.blocks.getBlock('hatR').fields.BROADCAST_OPTION.value, 'start');
    const threads = vm.runtime.startHats('event_whenbroadcastreceived', {BROADCAST_OPTION: 'start'});
    assert.ok(threads.some(thread => thread.topBlock === 'hatR'));
});

test('undo restores obscured head shadows so a save keeps them', async () => {
    const {vm, sprite} = await load();
    const applied = vm.replaceTargetScripts(sprite.id, keepAllBut(sprite, ['hatO']));
    assert.ok(!JSON.stringify(sb3.serialize(vm.runtime)).includes('[4,"7"]'));
    vm.replaceTargetScripts(sprite.id, {restore: applied.previous});
    assert.ok(JSON.stringify(sb3.serialize(vm.runtime)).includes('[4,"7"]'), 'the hidden value is saved again');
    assert.deepStrictEqual(validateBlockIntegrity(sprite.blocks._blocks), []);
});

test('undo is refused when a recreated name now belongs to another variable', async () => {
    const {vm, stage} = await load();
    const change = keepAllBut(stage, []);
    change.variables = {delete: ['g']};
    const applied = vm.replaceTargetScripts(stage.id, change);
    stage.createVariable('g2', 'score', Variable.SCALAR_TYPE);
    assert.throws(() => vm.replaceTargetScripts(stage.id, {restore: applied.previous}),
        /score now names a different variable in the Stage/);
    assert.ok(!stage.variables.g);
});

test('editing code is refused during collaboration', async () => {
    const {vm, sprite} = await load();
    vm.editingCommands.handler = () => {};
    assert.throws(() => vm.replaceTargetScripts(sprite.id, keepAllBut(sprite, [])),
        /Editing code is unavailable during collaboration/);
});

test('the code state hash ignores values and reserved comments', async () => {
    const {vm, sprite, stage} = await load();
    const spriteHash = vm.getCodeStateHash(sprite.id);
    const stageHash = vm.getCodeStateHash(stage.id);
    sprite.variables.l.value = 100;
    stage.variables.g.value = 100;
    vm.runtime.storeProjectOptions({mistwarpTheme: 'x'});
    assert.strictEqual(vm.getCodeStateHash(sprite.id), spriteHash);
    assert.strictEqual(vm.getCodeStateHash(stage.id), stageHash);
    stage.renameVariable('g', 'points');
    assert.strictEqual(vm.getCodeStateHash(sprite.id), spriteHash, 'the sprite does not reference g');
    assert.notStrictEqual(vm.getCodeStateHash(stage.id), stageHash);
    vm.replaceTargetScripts(sprite.id, rebuild(vm, sprite, ['hat'], blocks => {
        blocks.moveA.inputs.STEPS = [3, [12, 'points', 'g'], [4, '10']];
    }));
    const referencing = vm.getCodeStateHash(sprite.id);
    stage.renameVariable('g', 'score');
    assert.notStrictEqual(vm.getCodeStateHash(sprite.id), referencing, 'a referenced Stage variable counts');
    const before = vm.getCodeStateHash(sprite.id);
    sprite.blocks.changeBlock({id: sprite.blocks.getBlock('turnB').inputs.DEGREES.block, element: 'field',
        name: 'NUM', value: '11'});
    assert.notStrictEqual(vm.getCodeStateHash(sprite.id), before);
});

const loadSprite = async (blocks, comments = {}) => {
    const vm = new VM();
    const json = project();
    json.targets[1] = makeTarget(false, 'Sprite1', blocks, {comments});
    json.monitors = [];
    await vm.loadProject(json);
    return {vm, sprite: vm.runtime.targets.find(target => !target.isStage)};
};

test('a rebuilt script takes over a shadow whose parent pointer was lost', async () => {
    const {vm, sprite} = await loadSprite({
        hat: top('event_whenflagclicked', 'sw'),
        sw: child('looks_switchcostumeto', 'hat', null, {inputs: {COSTUME: [3, 'num', 'orphan']}}),
        num: child('looks_costumenumbername', 'sw', null, {fields: {NUMBER_NAME: ['number', null]}}),
        orphan: top('looks_costume', null, {shadow: true, fields: {COSTUME: ['costume1', null]}})
    });
    assert.strictEqual(sprite.blocks.getBlock('orphan').parent, null);
    vm.replaceTargetScripts(sprite.id, rebuild(vm, sprite, ['hat'], blocks => {
        blocks.orphan.parent = 'sw';
        blocks.orphan.topLevel = false;
    }));
    assert.strictEqual(sprite.blocks.getBlock('orphan').parent, 'sw');
    assert.deepStrictEqual(sprite.blocks.getScripts(), ['hat']);
    assert.deepStrictEqual(validateBlockIntegrity(sprite.blocks._blocks), []);
});

test('a rebuilt script keeps a stack input loaded in the same-block form', async () => {
    const {vm, sprite} = await loadSprite({
        hat: top('event_whenflagclicked', 'if'),
        if: child('control_if', 'hat', null, {inputs: {SUBSTACK: [1, 'say']}}),
        say: child('looks_say', 'if', null, {inputs: {MESSAGE: [1, [10, 'hi']]}})
    });
    assert.strictEqual(sprite.blocks.getBlock('if').inputs.SUBSTACK.shadow, 'say');
    vm.replaceTargetScripts(sprite.id, rebuild(vm, sprite, ['hat']));
    assert.strictEqual(sprite.blocks.getBlock('if').inputs.SUBSTACK.block, 'say');
});

test('a comment attached to a block that no longer exists is carried', async () => {
    const dangling = {blockId: 'gone', x: 1, y: 2, width: 200, height: 200, minimized: false, text: 'old'};
    const {vm, sprite} = await loadSprite({hat: top('event_whenflagclicked', null)}, {dangling});
    const comment = sprite.comments.dangling;
    assert.strictEqual(comment.blockId, 'gone');
    vm.replaceTargetScripts(sprite.id, rebuild(vm, sprite, ['hat']));
    assert.strictEqual(sprite.comments.dangling, comment, 'kept when the change has no comments');
    const change = rebuild(vm, sprite, ['hat']);
    change.comments = {dangling};
    vm.replaceTargetScripts(sprite.id, change);
    assert.strictEqual(sprite.comments.dangling, comment, 'kept when the change passes it back');
});

test('detached blocks and stray script entries are carried where they are', async () => {
    const {vm, sprite} = await load();
    const container = sprite.blocks;
    container.createBlock({id: 'loose', opcode: 'data_variable', parent: null, topLevel: false, next: null,
        shadow: false, inputs: {}, fields: {VARIABLE: {name: 'VARIABLE', value: 'lives', id: 'l'}}});
    container.createBlock({id: 'stray', opcode: 'motion_movesteps', parent: 'hat', topLevel: false, next: null,
        shadow: false, inputs: {}, fields: {}});
    container._scripts.push('loopB');
    const loose = container.getBlock('loose');
    const stray = container.getBlock('stray');
    const order = container.getScripts().slice();
    const change = rebuild(vm, sprite, ['hat']);
    const entry = vm.getFractchContext(sprite.id).targets[0];
    change.blocks.loose = entry.blocks.loose;
    change.blocks.stray = entry.blocks.stray;
    change.keepScripts = change.keepScripts.filter(id => id !== 'loopB').concat('loose');
    vm.replaceTargetScripts(sprite.id, change);
    assert.deepStrictEqual(container.getScripts(), order, 'no script is added or dropped');
    assert.strictEqual(container.getBlock('loose'), loose);
    assert.strictEqual(container.getBlock('stray'), stray);
    assert.ok(container.getBlock('turnB'), 'the stray entry does not take blocks from its script');
});

test('a rebuilt definition keeps a prototype loaded without a shadow slot', async () => {
    const {vm, sprite} = await load();
    sprite.blocks.getBlock('defJ').inputs.custom_block.shadow = null;
    vm.replaceTargetScripts(sprite.id, rebuild(vm, sprite, ['defJ']));
    assert.strictEqual(sprite.blocks.getBlock('defJ').inputs.custom_block.block, 'protoJ');
});
