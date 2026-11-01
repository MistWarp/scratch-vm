const {test} = require('node:test');
const assert = require('node:assert');
const VM = require('../../src/virtual-machine');
const sb3 = require('../../src/serialization/sb3');
const {
    FRACTCH_MAP_COMMENT_MAGIC,
    isMapComment,
    isReservedComment
} = require('../../src/serialization/fractch-context');

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

const mapText = `${FRACTCH_MAP_COMMENT_MAGIC}{"hat":"Enemies"}`;

const project = () => ({
    targets: [
        makeTarget(true, 'Stage', {}, {
            variables: {g: ['score', 5], pi: ['mistwarp.pi', Math.PI]},
            lists: {small: ['small', [1, 2, 3]], big: ['big', Array.from({length: 500}, (_, i) => i)]},
            broadcasts: {b1: 'go'},
            comments: {
                cfg: {blockId: null, x: 0, y: 0, width: 200, height: 200, minimized: false,
                    text: 'Configuration\n{} // _twconfig_'}
            }
        }),
        makeTarget(false, 'Sprite1', {
            hat: {opcode: 'event_whenflagclicked', next: 'say', parent: null, inputs: {}, fields: {},
                shadow: false, topLevel: true, x: 0, y: 0, comment: 'attached'},
            say: {opcode: 'looks_say', next: 'sayPi', parent: 'hat', inputs: {MESSAGE: [3, 'add', [10, 'hi']]},
                fields: {}, shadow: false, topLevel: false},
            add: {opcode: 'operator_add', next: null, parent: 'say',
                inputs: {NUM1: [3, 'add2', [4, '7']], NUM2: [1, [4, '3']]}, fields: {}, shadow: false,
                topLevel: false},
            add2: {opcode: 'operator_add', next: null, parent: 'add',
                inputs: {NUM1: [1, [4, '1']], NUM2: [1, [4, '2']]}, fields: {}, shadow: false, topLevel: false},
            sayPi: {opcode: 'looks_say', next: null, parent: 'say', inputs: {MESSAGE: [3, [12, 'mistwarp.pi',
                'mistwarp.pi'], [10, '']]}, fields: {}, shadow: false, topLevel: false},
            loose: [12, 'lives', 'l', 10, 300]
        }, {
            variables: {l: ['lives', 3]},
            comments: {
                attached: {blockId: 'hat', x: 0, y: 0, width: 200, height: 200, minimized: false, text: 'start'},
                map: {blockId: null, x: 0, y: 0, width: 200, height: 200, minimized: true, text: mapText},
                free: {blockId: null, x: 5, y: 5, width: 200, height: 200, minimized: false,
                    text: 'x'.repeat(9000)}
            }
        })
    ],
    monitors: [],
    extensions: [],
    meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
});

const load = async () => {
    const vm = new VM();
    await vm.loadProject(project());
    const sprite = vm.runtime.targets.find(target => !target.isStage);
    return {vm, sprite, stage: vm.runtime.getTargetForStage()};
};

test('context is sb3 form from the live VM without expanding', async () => {
    const {vm, sprite} = await load();
    const before = JSON.stringify(sprite.blocks._blocks);
    const context = vm.getFractchContext();
    assert.strictEqual(JSON.stringify(sprite.blocks._blocks), before, 'the live blocks are not touched');
    assert.strictEqual(context.generation, vm._projectLoadGeneration);
    assert.strictEqual(context.targets.length, 2);
    const entry = context.targets.find(target => target.id === sprite.id);
    assert.strictEqual(entry.name, 'Sprite1');
    assert.strictEqual(entry.changeKey, vm.getFractchChangeKey(sprite.id));

    const add = entry.blocks.add;
    assert.strictEqual(add.mutation.itemcount, '3', 'the variadic operator stays collapsed');
    assert.deepStrictEqual(Object.keys(add.inputs), ['NUM1', 'NUM2', 'NUM3']);
    assert.ok(!entry.blocks.add2, 'no expanded operator is minted');
    assert.deepStrictEqual(add.inputs.NUM1, [1, [4, '1']], 'primitives are compressed');
    const piId = sprite.blocks.getBlock('sayPi').inputs.MESSAGE.block;
    assert.strictEqual(entry.blocks[piId].opcode, 'operator_pi', 'constants are not expanded into variables');
    assert.ok(!Object.keys(entry.variables).some(id => id.startsWith('mistwarp.')));

    const liveAdd = sprite.blocks.getBlock('add');
    assert.deepStrictEqual(entry.primitiveIds.add.NUM1,
        {block: liveAdd.inputs.NUM1.block, shadow: liveAdd.inputs.NUM1.shadow});
    assert.strictEqual(entry.obscuredShadows.add.length, 1);
    const obscured = entry.obscuredShadows.add[0];
    assert.strictEqual(obscured.id, liveAdd.obscuredHeadShadows[0]);
    assert.strictEqual(obscured.blocks[obscured.id].fields.NUM.value, '7', 'the obscured shadow keeps its value');
    assert.ok(!entry.blocks[obscured.id], 'the obscured shadow is only in the sidecar');

    const looseId = sprite.blocks.getScripts().find(id => sprite.blocks.getBlock(id).opcode === 'data_variable');
    assert.deepStrictEqual(entry.blocks[looseId], [12, 'lives', 'l', 10, 300], 'loose reporters keep their live id');
    assert.strictEqual(entry.comments.free.text.length, 9000, 'comment text is not split');
    assert.strictEqual(entry.comments.attached.blockId, 'hat');
    assert.ok(entry.comments.map, 'the map comment is in the context');
});

test('large lists are kept out of the context', async () => {
    const {vm, stage} = await load();
    const entry = vm.getFractchContext(stage.id).targets[0];
    assert.deepStrictEqual(entry.lists.small, ['small', [1, 2, 3]]);
    assert.deepStrictEqual(entry.lists.big, ['big', null]);
    assert.deepStrictEqual(entry.keptLists, {big: {length: 500}});
    assert.ok(entry.comments.cfg);
});

test('the context matches what a save would load back', async () => {
    const {vm, sprite} = await load();
    const entry = vm.getFractchContext(sprite.id).targets[0];
    const blocks = JSON.parse(JSON.stringify(entry.blocks));
    sb3.deserializeBlocks(blocks, entry.primitiveIds);
    for (const id of Object.keys(entry.obscuredShadows)) {
        blocks[id].obscuredHeadShadows = entry.obscuredShadows[id].map(item => item && item.id);
        for (const item of entry.obscuredShadows[id]) Object.assign(blocks, item.blocks);
    }
    const live = JSON.parse(JSON.stringify(sprite.blocks._blocks));
    assert.deepStrictEqual(Object.keys(blocks).sort(), Object.keys(live).sort(), 'every block id comes back');
    for (const id of Object.keys(live)) {
        assert.deepEqual(blocks[id].inputs, live[id].inputs, `inputs of ${id}`);
        assert.deepEqual(blocks[id].fields, live[id].fields, `fields of ${id}`);
    }
});

test('reserved and map comments are recognized', () => {
    const stage = {isStage: true};
    const sprite = {isStage: false};
    const comment = text => ({blockId: null, text});
    assert.ok(isReservedComment(stage, comment('x // _twconfig_')));
    assert.ok(isReservedComment(stage, comment('WORKSPACE_BOOKMARKS:{}')));
    assert.ok(isReservedComment(stage, comment('{} // _gamepad_')));
    assert.ok(!isReservedComment(sprite, comment('x // _twconfig_')), 'only on the Stage');
    assert.ok(!isReservedComment(stage, {blockId: 'a', text: 'x // _twconfig_'}), 'only floating comments');
    assert.ok(!isReservedComment(stage, comment('hello')));
    assert.ok(isMapComment(comment(`${FRACTCH_MAP_COMMENT_MAGIC}{}`)));
    assert.ok(!isMapComment({blockId: 'a', text: `${FRACTCH_MAP_COMMENT_MAGIC}{}`}));
    assert.ok(!isMapComment(comment(`x${FRACTCH_MAP_COMMENT_MAGIC}`)));
});

test('the map comment is hidden from the workspace but kept in the project', async () => {
    const {vm, sprite} = await load();
    let update = null;
    vm.on('workspaceUpdate', data => {
        update = data;
    });
    vm.setEditingTarget(sprite.id);
    vm.emitWorkspaceUpdate();
    assert.ok(update);
    assert.ok(!update.headerXml.includes(FRACTCH_MAP_COMMENT_MAGIC), 'not in the header comments');
    assert.ok(!update.xml.includes(FRACTCH_MAP_COMMENT_MAGIC), 'not in the full xml');
    assert.ok(!update.blocks.comments.map, 'not in the comments the descs loader gets');
    assert.ok(update.blocks.comments.attached, 'other comments are still passed');
    assert.ok(update.blocks.comments.free);
    assert.ok(update.headerXml.includes('id="free"'));
    assert.ok(sprite.comments.map, 'the target still has it');
    const saved = sb3.serialize(vm.runtime);
    const savedSprite = saved.targets.find(target => !target.isStage);
    assert.ok(Object.values(savedSprite.comments).some(comment => comment.text.startsWith(FRACTCH_MAP_COMMENT_MAGIC)),
        'the sb3 still carries it');
});
