const {test} = require('tap');
const VM = require('../../src/virtual-machine');
const Runtime = require('../../src/engine/runtime');
const Blocks = require('../../src/engine/blocks');
const Variable = require('../../src/engine/variable');

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

const project = () => ({
    targets: [
        makeTarget(true, 'Stage', {}, {variables: {g: ['score', 5]}, broadcasts: {b1: 'go'}}),
        makeTarget(false, 'Sprite1', {
            hat: {opcode: 'event_whenflagclicked', next: 'set', parent: null, inputs: {}, fields: {},
                shadow: false, topLevel: true, x: 0, y: 0},
            set: {opcode: 'data_setvariableto', next: null, parent: 'hat', inputs: {VALUE: [1, [10, '1']]},
                fields: {VARIABLE: ['lives', 'l']}, shadow: false, topLevel: false},
            costume: {opcode: 'looks_switchcostumeto', next: null, parent: null,
                inputs: {COSTUME: [1, 'menu']}, fields: {}, shadow: false, topLevel: true, x: 0, y: 100},
            menu: {opcode: 'looks_costume', next: null, parent: 'costume', inputs: {},
                fields: {COSTUME: ['costume1', null]}, shadow: true, topLevel: false},
            broadcaster: {opcode: 'event_broadcast', next: null, parent: null,
                inputs: {BROADCAST_INPUT: [1, [11, 'go', 'b1']]}, fields: {}, shadow: false, topLevel: true,
                x: 0, y: 200}
        }, {variables: {l: ['lives', 3]}})
    ],
    monitors: [],
    extensions: [],
    meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
});

const load = async () => {
    const vm = new VM();
    await vm.loadProject(project());
    const sprite = vm.runtime.targets.find(target => !target.isStage);
    const stage = vm.runtime.getTargetForStage();
    vm.setEditingTarget(sprite.id);
    return {vm, sprite, stage};
};

test('Blocks.revision moves on real changes only', t => {
    const blocks = new Blocks(new Runtime());
    const revision = () => blocks.revision;
    t.equal(revision(), 0);
    t.notOk(Object.keys(blocks).includes('revision'), 'revision is not enumerable');
    blocks.createBlock({id: 'a', opcode: 'motion_movesteps', next: null, parent: null, inputs: {},
        fields: {}, shadow: false, topLevel: true, x: 0, y: 0});
    blocks.createBlock({id: 'v', opcode: 'data_variable', next: null, parent: null, inputs: {},
        fields: {VARIABLE: {name: 'VARIABLE', value: 'x', id: 'xid'}}, shadow: false, topLevel: true, x: 0, y: 0});
    t.equal(revision(), 2);
    blocks.createBlock({id: 'a', opcode: 'motion_movesteps', next: null, parent: null, inputs: {}, fields: {}});
    t.equal(revision(), 2, 'creating an existing block is a no-op');
    blocks.resetCache();
    t.equal(revision(), 2, 'resetCache does not count');
    blocks.moveBlock({id: 'a', newCoordinate: {x: 0, y: 0}});
    t.equal(revision(), 2, 'a no-op move does not count');
    blocks.moveBlock({id: 'a', newCoordinate: {x: 5, y: 0}});
    t.equal(revision(), 3);
    blocks.updateBlocksAfterVarRename('xid', 'x');
    t.equal(revision(), 3, 'renaming to the same name does not count');
    blocks.updateBlocksAfterVarRename('xid', 'y');
    t.equal(revision(), 4);
    blocks.updateAssetName('nothing', 'else', 'sprite');
    t.equal(revision(), 4);
    blocks.changeBlock({id: 'a', element: 'mutation', value: '<mutation></mutation>'});
    t.equal(revision(), 5);
    blocks.updateTargetSpecificBlocks(true);
    t.equal(revision(), 5);
    blocks.deleteBlock('missing');
    t.equal(revision(), 5);
    blocks.deleteBlock('a');
    t.equal(revision(), 6);
    t.end();
});

test('declRevision moves on declaration and comment changes, not values', async t => {
    const {vm, sprite, stage} = await load();
    const start = sprite.declRevision;
    sprite.variables.l.value = 10;
    vm.setVariableValue(sprite.id, 'l', 11);
    t.equal(sprite.declRevision, start, 'value changes do not count');
    sprite.createVariable('n', 'new', Variable.SCALAR_TYPE);
    t.equal(sprite.declRevision, start + 1);
    sprite.renameVariable('n', 'newer');
    t.equal(sprite.declRevision, start + 2);
    sprite.deleteVariable('n');
    t.equal(sprite.declRevision, start + 3);
    sprite.lookupOrCreateVariable('auto', 'auto');
    sprite.lookupOrCreateList('autolist', 'autolist');
    t.equal(sprite.declRevision, start + 5);

    const stageStart = stage.declRevision;
    vm.runtime.createNewGlobalVariable('fresh');
    t.equal(stage.declRevision, stageStart + 1);

    const keyBefore = vm.getFractchChangeKey(sprite.id);
    stage.createVariable('g2', 'other', Variable.SCALAR_TYPE);
    t.not(vm.getFractchChangeKey(sprite.id), keyBefore, 'a sprite key follows the Stage declarations');
    t.end();
});

test('Blockly comment events go through Target methods', async t => {
    const {vm, sprite} = await load();
    const decl = () => sprite.declRevision;
    const blocks = () => sprite.blocks.revision;
    let d = decl();
    let b = blocks();
    const key = vm.getFractchChangeKey(sprite.id);
    vm.blockListener({type: 'comment_create', commentId: 'c1', blockId: null, text: 'hello',
        xy: {x: 1, y: 2}, width: 100, height: 100, minimized: false});
    t.equal(decl(), d + 1);
    t.equal(blocks(), b, 'a floating comment does not touch blocks');
    t.not(vm.getFractchChangeKey(sprite.id), key);
    d = decl();
    vm.blockListener({type: 'comment_change', commentId: 'c1', newContents_: {text: 'bye'}});
    t.equal(sprite.comments.c1.text, 'bye');
    t.equal(decl(), d + 1);
    d = decl();
    vm.blockListener({type: 'comment_move', commentId: 'c1', newCoordinate_: {x: 50, y: 60}});
    t.same([sprite.comments.c1.x, sprite.comments.c1.y], [50, 60]);
    t.equal(decl(), d + 1);
    d = decl();
    b = blocks();
    vm.blockListener({type: 'comment_create', commentId: 'c2', blockId: 'hat', text: 'on hat',
        xy: {x: 1, y: 2}, width: 100, height: 100, minimized: false});
    t.equal(sprite.blocks.getBlock('hat').comment, 'c2');
    t.equal(decl(), d + 1);
    t.equal(blocks(), b + 1, 'attaching a comment changes the block');
    d = decl();
    b = blocks();
    vm.blockListener({type: 'comment_delete', commentId: 'c2', blockId: 'hat'});
    t.notOk(sprite.comments.c2);
    t.notOk(sprite.blocks.getBlock('hat').comment);
    t.equal(decl(), d + 1);
    t.equal(blocks(), b + 1);
    t.end();
});

test('direct writers bump their counters', async t => {
    const {vm, sprite, stage} = await load();
    const stageDecl = stage.declRevision;
    sprite.blocks.deleteBlock('broadcaster');
    vm._broadcastCleanupNeeded = true;
    vm.emitWorkspaceUpdate();
    t.notOk(stage.variables.b1, 'the unused broadcast is cleaned up');
    t.equal(stage.declRevision, stageDecl + 1, 'broadcast cleanup bumps the Stage');

    let b = sprite.blocks.revision;
    vm.renameSprite(sprite.id, 'Hero');
    t.equal(sprite.blocks.revision, b, 'no block refers to the sprite');
    sprite.blocks.getBlock('menu').fields.COSTUME.value = 'old';
    vm.runtime.targets.forEach(target => target.blocks.updateAssetName('old', 'new', 'costume'));
    t.equal(sprite.blocks.revision, b + 1);

    b = sprite.blocks.revision;
    sprite.renameVariable('l', 'hearts');
    sprite.blocks.updateBlocksAfterVarRename('l', 'hearts');
    t.equal(sprite.blocks.revision, b + 1);

    b = sprite.blocks.revision;
    sprite.mergeVariables('l', 'l2');
    t.equal(sprite.blocks.revision, b + 1, 'mergeVariables rewrites fields');

    const optionsDecl = stage.declRevision;
    vm.runtime.storeProjectOptions();
    vm.runtime.storeProjectOptions({mistwarpTheme: 'dark'});
    t.equal(stage.declRevision, optionsDecl + 2, 'project options comment writes bump the Stage');
    t.end();
});

test('the change key includes the extension signature hash', async t => {
    const {vm, sprite} = await load();
    const key = vm.getFractchChangeKey(sprite.id);
    const context = vm.getFractchContext(sprite.id);
    t.equal(context.targets[0].changeKey, key);
    t.ok(key.endsWith(`:${context.extensionSignatureHash}`));
    await vm.extensionManager.loadExtensionURL('pen');
    const after = vm.getFractchContext(sprite.id);
    t.not(after.extensionSignatureHash, context.extensionSignatureHash);
    t.ok(after.extensionSignatures.pen.blocks.some(block => block.opcode === 'setPenColorToColor'));
    t.not(vm.getFractchChangeKey(sprite.id), key);
    t.end();
});
