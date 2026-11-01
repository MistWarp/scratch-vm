const {test} = require('node:test');
const assert = require('node:assert');
const path = require('path');
const VirtualMachine = require('../../src/index');
const Runtime = require('../../src/engine/runtime');
const sb3 = require('../../src/serialization/sb3');
const readFileToBuffer = require('../fixtures/readProjectFile').readFileToBuffer;
const exampleProjectPath = path.resolve(__dirname, '../fixtures/clone-cleanup.sb2');
const commentsSB2ProjectPath = path.resolve(__dirname, '../fixtures/comments.sb2');
const commentsSB3ProjectPath = path.resolve(__dirname, '../fixtures/comments.sb3');
const commentsSB3NoDupeIds = path.resolve(__dirname, '../fixtures/comments_no_duplicate_id_serialization.sb3');
const variableReporterSB2ProjectPath = path.resolve(__dirname, '../fixtures/top-level-variable-reporter.sb2');
const topLevelReportersProjectPath = path.resolve(__dirname, '../fixtures/top-level-reporters.sb3');
const draggableSB3ProjectPath = path.resolve(__dirname, '../fixtures/draggable.sb3');
const originSB3ProjectPath = path.resolve(__dirname, '../fixtures/origin.sb3');
const originAbsentSB3ProjectPath = path.resolve(__dirname, '../fixtures/origin-absent.sb3');
const FakeRenderer = require('../fixtures/fake-renderer');

test('serialize', async () => {
    const vm = new VirtualMachine();
    await vm.loadProject(readFileToBuffer(exampleProjectPath));
    const result = sb3.serialize(vm.runtime);
    // @todo Analyze
    assert.strictEqual(typeof JSON.stringify(result), 'string');
});

test('deserialize', async () => {
    const vm = new VirtualMachine();
    const {targets} = await sb3.deserialize('', vm.runtime);
    // @todo Analyze
    assert.strictEqual(typeof targets, 'object');
});

test('deserialize monitor with an inherited object property as its ID', async () => {
    const runtime = new Runtime();
    await sb3.deserialize({
        targets: [],
        monitors: [{
            id: 'constructor',
            opcode: 'data_variable',
            params: {VARIABLE: 'x'},
            visible: true,
            x: 0,
            y: 0
        }]
    }, runtime);

    assert.strictEqual(Object.prototype.hasOwnProperty.call(runtime.monitorBlocks._blocks, 'constructor'), true);
    assert.strictEqual(runtime.monitorBlocks._blocks.constructor.opcode, 'data_variable');
});


test('serialize sb2 project with comments as sb3', async () => {
    const vm = new VirtualMachine();
    await vm.loadProject(readFileToBuffer(commentsSB2ProjectPath));
    const result = sb3.serialize(vm.runtime);

    assert.strictEqual(typeof JSON.stringify(result), 'string');
    assert.strictEqual(typeof result.targets, 'object');
    assert.strictEqual(Array.isArray(result.targets), true);
    assert.strictEqual(result.targets.length, 2);

    const stage = result.targets[0];
    assert.strictEqual(stage.isStage, true);
    // The stage has 0 blocks, and 1 workspace comment
    assert.strictEqual(typeof stage.blocks, 'object');
    assert.strictEqual(Object.keys(stage.blocks).length, 0);
    assert.strictEqual(typeof stage.comments, 'object');
    assert.strictEqual(Object.keys(stage.comments).length, 1);
    const stageBlockComments = Object.values(stage.comments).filter(comment => !!comment.blockId);
    const stageWorkspaceComments = Object.values(stage.comments).filter(comment => comment.blockId === null);
    assert.strictEqual(stageBlockComments.length, 0);
    assert.strictEqual(stageWorkspaceComments.length, 1);

    const sprite = result.targets[1];
    assert.strictEqual(sprite.isStage, false);
    assert.strictEqual(typeof sprite.blocks, 'object');
    // Sprite 1 has 6 blocks, 5 block comments, and 1 workspace comment
    assert.strictEqual(Object.keys(sprite.blocks).length, 6);
    assert.strictEqual(typeof sprite.comments, 'object');
    assert.strictEqual(Object.keys(sprite.comments).length, 6);

    const spriteBlockComments = Object.values(sprite.comments).filter(comment => !!comment.blockId);
    const spriteWorkspaceComments = Object.values(sprite.comments).filter(comment => comment.blockId === null);
    assert.strictEqual(spriteBlockComments.length, 5);
    assert.strictEqual(spriteWorkspaceComments.length, 1);
});

test('deserialize sb3 project with comments', async () => {
    const vm = new VirtualMachine();
    await vm.loadProject(readFileToBuffer(commentsSB3ProjectPath));
    const runtime = vm.runtime;

    assert.strictEqual(typeof runtime.targets, 'object');
    assert.strictEqual(Array.isArray(runtime.targets), true);
    assert.strictEqual(runtime.targets.length, 2);

    const stage = runtime.targets[0];
    assert.strictEqual(stage.isStage, true);
    // The stage has 0 blocks, and 1 workspace comment
    assert.strictEqual(typeof stage.blocks, 'object');
    assert.strictEqual(Object.keys(stage.blocks._blocks).length, 0);
    assert.strictEqual(typeof stage.comments, 'object');
    assert.strictEqual(Object.keys(stage.comments).length, 1);
    const stageBlockComments = Object.values(stage.comments).filter(comment => !!comment.blockId);
    const stageWorkspaceComments = Object.values(stage.comments).filter(comment => comment.blockId === null);
    assert.strictEqual(stageBlockComments.length, 0);
    assert.strictEqual(stageWorkspaceComments.length, 1);

    const sprite = runtime.targets[1];
    assert.strictEqual(sprite.isStage, false);
    assert.strictEqual(typeof sprite.blocks, 'object');
    // Sprite 1 has 6 blocks, 5 block comments, and 1 workspace comment
    assert.strictEqual(Object.values(sprite.blocks._blocks).filter(block => !block.shadow).length, 6);
    assert.strictEqual(typeof sprite.comments, 'object');
    assert.strictEqual(Object.keys(sprite.comments).length, 6);

    const spriteBlockComments = Object.values(sprite.comments).filter(comment => !!comment.blockId);
    const spriteWorkspaceComments = Object.values(sprite.comments).filter(comment => comment.blockId === null);
    assert.strictEqual(spriteBlockComments.length, 5);
    assert.strictEqual(spriteWorkspaceComments.length, 1);
});

test('deserialize sb3 project with comments - no duplicate id serialization', async () => {
    const vm = new VirtualMachine();
    await vm.loadProject(readFileToBuffer(commentsSB3NoDupeIds));
    const runtime = vm.runtime;

    assert.strictEqual(typeof runtime.targets, 'object');
    assert.strictEqual(Array.isArray(runtime.targets), true);
    assert.strictEqual(runtime.targets.length, 2);

    const stage = runtime.targets[0];
    assert.strictEqual(stage.isStage, true);
    // The stage has 0 blocks, and 0 workspace comment
    assert.strictEqual(typeof stage.blocks, 'object');
    assert.strictEqual(Object.keys(stage.blocks._blocks).length, 0);
    assert.strictEqual(typeof stage.comments, 'object');
    assert.strictEqual(Object.keys(stage.comments).length, 0);

    const sprite = runtime.targets[1];
    assert.strictEqual(sprite.isStage, false);
    assert.strictEqual(typeof sprite.blocks, 'object');
    // Sprite1 has 1 blocks, 1 block comment, and 1 workspace comment
    assert.strictEqual(Object.values(sprite.blocks._blocks).filter(block => !block.shadow).length, 1);
    assert.strictEqual(typeof sprite.comments, 'object');
    assert.strictEqual(Object.keys(sprite.comments).length, 2);

    const spriteBlockComments = Object.values(sprite.comments).filter(comment => !!comment.blockId);
    const spriteWorkspaceComments = Object.values(sprite.comments).filter(comment => comment.blockId === null);
    assert.strictEqual(spriteBlockComments.length, 1);
    assert.strictEqual(spriteWorkspaceComments.length, 1);
});

test('serializing and deserializing sb3 preserves sprite layer order', async () => {
    const vm = new VirtualMachine();
    vm.attachRenderer(new FakeRenderer());
    await vm.loadProject(readFileToBuffer(path.resolve(__dirname, '../fixtures/ordering.sb2')));
    // Target get layer order needs a renderer,
    // fake the numbers we would get back from the
    // renderer in order to test that they are serialized
    // correctly
    vm.runtime.targets[0].getLayerOrder = () => 0;
    vm.runtime.targets[1].getLayerOrder = () => 20;
    vm.runtime.targets[2].getLayerOrder = () => 10;
    vm.runtime.targets[3].getLayerOrder = () => 30;

    const result = sb3.serialize(vm.runtime);

    assert.strictEqual(typeof JSON.stringify(result), 'string');
    assert.strictEqual(typeof result.targets, 'object');
    assert.strictEqual(Array.isArray(result.targets), true);
    assert.strictEqual(result.targets.length, 4);

    // First check that the sprites are ordered correctly (as they would
    // appear in the target pane)
    assert.strictEqual(result.targets[0].name, 'Stage');
    assert.strictEqual(result.targets[1].name, 'First');
    assert.strictEqual(result.targets[2].name, 'Second');
    assert.strictEqual(result.targets[3].name, 'Third');

    // Check that they are in the correct layer order (as they would render
    // back to front on the stage)
    assert.strictEqual(result.targets[0].layerOrder, 0);
    assert.strictEqual(result.targets[1].layerOrder, 2);
    assert.strictEqual(result.targets[2].layerOrder, 1);
    assert.strictEqual(result.targets[3].layerOrder, 3);

    const serializedObject = await result;
    const {targets, layerOrder} = await sb3.deserialize(
        JSON.parse(JSON.stringify(serializedObject)), new Runtime(), null, false);
    // First check that the sprites are ordered correctly (as they would
    // appear in the target pane)
    assert.strictEqual(targets[0].sprite.name, 'Stage');
    assert.strictEqual(targets[1].sprite.name, 'First');
    assert.strictEqual(targets[2].sprite.name, 'Second');
    assert.strictEqual(targets[3].sprite.name, 'Third');

    // Check that they are in the correct layer order (as they would render
    // back to front on the stage)
    assert.deepEqual(layerOrder, [0, 2, 1, 3]);
});

test('serializeBlocks', async () => {
    const vm = new VirtualMachine();
    await vm.loadProject(readFileToBuffer(commentsSB3ProjectPath));
    const blocks = vm.runtime.targets[1].blocks._blocks;
    const result = sb3.serializeBlocks(blocks);
    // @todo Analyze
    assert.strictEqual(typeof result[0], 'object');
    assert.ok(Object.keys(result[0]).length < Object.keys(blocks).length, 'less blocks in serialized format');
    assert.ok(Array.isArray(result[1]));
});

test('serializeBlocks serializes x and y for topLevel blocks with x,y of 0,0', async () => {
    const vm = new VirtualMachine();
    await vm.loadProject(readFileToBuffer(topLevelReportersProjectPath));
    // Verify that there are 2 blocks and they are both top level
    const blocks = vm.runtime.targets[1].blocks._blocks;
    const blockIds = Object.keys(blocks);
    assert.strictEqual(blockIds.length, 2);
    const blocksArray = blockIds.map(key => blocks[key]);
    assert.strictEqual(blocksArray.every(b => b.topLevel), true);
    // Simulate cleaning up the blocks by resetting x and y positions to 0
    blockIds.forEach(blockId => {
        blocks[blockId].x = 0;
        blocks[blockId].y = 0;
    });
    const result = sb3.serializeBlocks(blocks);
    const serializedBlocks = result[0];

    assert.strictEqual(typeof serializedBlocks, 'object');
    const serializedBlockIds = Object.keys(serializedBlocks);
    assert.strictEqual(serializedBlockIds.length, 2);
    const firstBlock = serializedBlocks[serializedBlockIds[0]];
    const secondBlock = serializedBlocks[serializedBlockIds[1]];
    assert.strictEqual(firstBlock.x, 0);
    assert.strictEqual(firstBlock.y, 0);
    assert.strictEqual(secondBlock.x, 0);
    assert.strictEqual(secondBlock.y, 0);
});

test('deserializeBlocks', async () => {
    const vm = new VirtualMachine();
    await vm.loadProject(readFileToBuffer(commentsSB3ProjectPath));
    const blocks = vm.runtime.targets[1].blocks._blocks;
    const serialized = sb3.serializeBlocks(blocks)[0];
    const deserialized = sb3.deserializeBlocks(serialized);
    assert.strictEqual(Object.keys(deserialized).length, Object.keys(blocks).length, 'same number of blocks');
});

test('empty not blocks become Boolean toggles only while loading', () => {
    const serialized = {
        parent: {
            opcode: 'control_if',
            next: null,
            parent: null,
            inputs: {CONDITION: [2, 'not']},
            fields: {},
            shadow: false,
            topLevel: true,
            x: 0,
            y: 0
        },
        not: {
            opcode: 'operator_not',
            next: null,
            parent: 'parent',
            inputs: {},
            fields: {},
            shadow: false,
            topLevel: false
        }
    };
    const blocks = sb3.deserializeBlocks(serialized);

    assert.strictEqual(blocks.not.booleanToggle, true);
    assert.strictEqual(blocks.parent.inputs.CONDITION.block, 'not');
    assert.strictEqual(blocks.parent.inputs.CONDITION.shadow, null);

    const saved = sb3.serializeBlocks(blocks)[0];
    assert.strictEqual(saved.not.opcode, 'operator_not');
    assert.ok(!Object.prototype.hasOwnProperty.call(saved.not, 'booleanToggle'));
});

test('deserializeBlocks on already deserialized input', async () => {
    const vm = new VirtualMachine();
    await vm.loadProject(readFileToBuffer(commentsSB3ProjectPath));
    const blocks = vm.runtime.targets[1].blocks._blocks;
    const serialized = sb3.serializeBlocks(blocks)[0];
    const deserialized = sb3.deserializeBlocks(serialized);
    const deserializedAgain = sb3.deserializeBlocks(deserialized);
    assert.deepEqual(deserialized, deserializedAgain, 'no change from second pass of deserialize');
});

test('getExtensionIdForOpcode', () => {
    assert.strictEqual(sb3.getExtensionIdForOpcode('wedo_loopy'), 'wedo');

    // does not consider CORE to be extensions
    assert.ok(!sb3.getExtensionIdForOpcode('control_loopy'));

    // only considers things before the first underscore
    assert.strictEqual(sb3.getExtensionIdForOpcode('hello_there_loopy'), 'hello');

    // does not return anything for opcodes with no extension
    assert.ok(!sb3.getExtensionIdForOpcode('hello'));

    // forbidden characters must be replaced with '-'
    assert.strictEqual(sb3.getExtensionIdForOpcode('hi:there/happy_people'), 'hi-there-happy');
});

test('(#1608) serializeBlocks maintains top level variable reporters', async () => {
    const vm = new VirtualMachine();
    await vm.loadProject(readFileToBuffer(variableReporterSB2ProjectPath));
    const blocks = vm.runtime.targets[0].blocks._blocks;
    const result = sb3.serialize(vm.runtime);
    // Project should have 1 block, a top-level variable reporter
    assert.strictEqual(Object.keys(blocks).length, 1);
    assert.strictEqual(Object.keys(result.targets[0].blocks).length, 1);

    // Make sure deserializing these blocks works
    assert.doesNotThrow(() => {
        sb3.deserialize(JSON.parse(JSON.stringify(result)), vm.runtime);
    });
});

test('(#1850) sprite draggability state read when loading SB3 file', async () => {
    const vm = new VirtualMachine();
    await vm.loadProject(readFileToBuffer(draggableSB3ProjectPath));
    const sprite1Obj = vm.runtime.targets.find(target => target.sprite.name === 'Sprite1');
    // Sprite1 in project should have draggable set to true
    assert.strictEqual(sprite1Obj.draggable, true);
});

test('load origin value from SB3 file json metadata', async () => {
    const vm = new VirtualMachine();
    await vm.loadProject(readFileToBuffer(originSB3ProjectPath));
    assert.strictEqual(typeof vm.runtime.origin, 'string');
    await vm.loadProject(readFileToBuffer(originAbsentSB3ProjectPath));
    // After loading a project with an origin, then loading one without an origin,
    // origin value should no longer be set.
    assert.strictEqual(vm.runtime.origin, null);
});

test('serialize origin value if it is present', async () => {
    const vm = new VirtualMachine();
    await vm.loadProject(readFileToBuffer(originSB3ProjectPath));
    const result = sb3.serialize(vm.runtime);
    assert.strictEqual(typeof result.meta.origin, 'string');
});

test('do not serialize origin value if it is not present', async () => {
    const vm = new VirtualMachine();
    await vm.loadProject(readFileToBuffer(originAbsentSB3ProjectPath));
    const result = sb3.serialize(vm.runtime);
    assert.strictEqual(result.meta.origin, undefined);
});

// Nested same-opcode operators (e.g. ((a+b)+c)+d) are merged into one variadic block on load
// (collapseOperators) and rebuilt on save (expandOperators). When the user typed a value into a
// slot and then dropped a reporter on top of it, that "obscured" shadow has no place in the merged
// block and must be set aside and restored, or the value is lost on the next save. This also has to
// work regardless of the order blocks appear in the project and at every nesting depth.
const buildNestedAddChain = (depth, order) => {
    const blocks = {};
    let childId = null;
    for (let i = 0; i < depth; i++) {
        const id = `op${i}`;
        const headShadow = `hs${i}`;
        const tailShadow = `ts${i}`;
        blocks[headShadow] = {opcode: 'math_number', next: null, parent: id, inputs: {},
            fields: {NUM: [String(90 + i), null]}, shadow: true, topLevel: false};
        blocks[tailShadow] = {opcode: 'math_number', next: null, parent: id, inputs: {},
            fields: {NUM: [String(200 + i), null]}, shadow: true, topLevel: false};
        blocks[id] = {opcode: 'operator_add', next: null, parent: null, inputs: {
            NUM1: childId ? [3, childId, headShadow] : [1, headShadow],
            NUM2: [1, tailShadow]
        }, fields: {}, shadow: false, topLevel: false};
        if (childId) blocks[childId].parent = id;
        childId = id;
    }
    blocks.hat = {opcode: 'event_whenflagclicked', next: 'say', parent: null, inputs: {},
        fields: {}, shadow: false, topLevel: true, x: 0, y: 0};
    blocks.say = {opcode: 'looks_say', next: null, parent: 'hat',
        inputs: {MESSAGE: [3, childId, [10, '']]}, fields: {}, shadow: false, topLevel: false};
    blocks[childId].parent = 'say';
    const keys = order ? order(Object.keys(blocks)) : Object.keys(blocks);
    const ordered = {};
    for (const k of keys) ordered[k] = blocks[k];
    return {
        targets: [
            {isStage: true, name: 'Stage', variables: {}, lists: {}, broadcasts: {}, blocks: {},
                comments: {}, currentCostume: 0, costumes: [], sounds: [], volume: 100, layerOrder: 0,
                tempo: 60, videoTransparency: 50, videoState: 'off', textToSpeechLanguage: null},
            {isStage: false, name: 'Sprite1', variables: {}, lists: {}, broadcasts: {}, blocks: ordered,
                comments: {}, currentCostume: 0, costumes: [], sounds: [], volume: 100, layerOrder: 1,
                visible: true, x: 0, y: 0, size: 100, direction: 90, draggable: false,
                rotationStyle: 'all around'}
        ], monitors: [], extensions: [], meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
    };
};

test('extendable operators preserve obscured shadows across a load/save round trip', async () => {
    const orderings = [
        keys => keys,
        keys => [...keys].reverse(),
        keys => [...keys].sort(),
        keys => [...keys].sort().reverse()
    ];
    const runtime = new Runtime();
    runtime.extendableOperators = true;
    const checkDepth = async (depth, order) => {
        const project = buildNestedAddChain(depth, order);
        const {targets} = await sb3.deserialize(JSON.parse(JSON.stringify(project)), runtime);
        for (const target of targets) runtime.addTarget(target);
        const raw = JSON.stringify(sb3.serialize(runtime).targets[1].blocks);
        for (const target of targets) runtime.disposeTarget(target);
        for (let i = 0; i < depth; i++) {
            assert.ok(raw.includes(`"${90 + i}"`), `depth ${depth}: obscured/head shadow ${90 + i} preserved`);
            assert.ok(raw.includes(`"${200 + i}"`), `depth ${depth}: tail shadow ${200 + i} preserved`);
        }
        // The internal bookkeeping annotation must never leak into the saved project.
        assert.ok(!raw.includes('obscuredHeadShadows'), `depth ${depth}: annotation not serialized`);
    };
    for (const depth of [2, 3, 4, 5, 6]) {
        for (const order of orderings) {
            await checkDepth(depth, order);
        }
    }
});

// pi/newline have no vanilla opcode, so they are saved as stage variables holding their value and
// turned back into blocks on load.
const buildConstantsProject = () => ({
    targets: [
        {isStage: true, name: 'Stage', variables: {}, lists: {}, broadcasts: {}, blocks: {},
            comments: {}, currentCostume: 0, costumes: [], sounds: [], volume: 100, layerOrder: 0,
            tempo: 60, videoTransparency: 50, videoState: 'off', textToSpeechLanguage: null},
        {isStage: false, name: 'Sprite1', variables: {}, lists: {}, broadcasts: {}, blocks: {
            hat: {opcode: 'event_whenflagclicked', next: 'say', parent: null, inputs: {},
                fields: {}, shadow: false, topLevel: true, x: 0, y: 0},
            say: {opcode: 'looks_say', next: null, parent: 'hat',
                inputs: {MESSAGE: [3, 'join', [10, '']]}, fields: {}, shadow: false, topLevel: false},
            join: {opcode: 'operator_join', next: null, parent: 'say',
                inputs: {STRING1: [3, 'pi', [10, 'a']], STRING2: [3, 'newline', [10, 'b']]},
                fields: {}, shadow: false, topLevel: false},
            pi: {opcode: 'operator_pi', next: null, parent: 'join', inputs: {}, fields: {},
                shadow: false, topLevel: false},
            newline: {opcode: 'operator_newline', next: null, parent: 'join', inputs: {}, fields: {},
                shadow: false, topLevel: false}
        }, comments: {}, currentCostume: 0, costumes: [], sounds: [], volume: 100, layerOrder: 1,
        visible: true, x: 0, y: 0, size: 100, direction: 90, draggable: false,
        rotationStyle: 'all around'}
    ], monitors: [], extensions: [], meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
});

test('pi and newline round trip through stage variables', async () => {
    const runtime = new Runtime();
    const {targets} = await sb3.deserialize(buildConstantsProject(), runtime);
    for (const target of targets) runtime.addTarget(target);

    const saved = sb3.serialize(runtime);
    const stage = saved.targets.find(target => target.isStage);
    assert.deepStrictEqual(stage.variables['mistwarp.pi'], ['mistwarp.pi', Math.PI], 'pi saved as a stage variable');
    assert.deepStrictEqual(stage.variables['mistwarp.newline'], ['mistwarp.newline', '\n'],
        'newline saved as a stage variable');

    const savedBlocks = saved.targets[1].blocks;
    const opcodes = Object.values(savedBlocks).map(block => block.opcode);
    assert.ok(!opcodes.includes('operator_pi'), 'no operator_pi block saved');
    assert.ok(!opcodes.includes('operator_newline'), 'no operator_newline block saved');
    const join = Object.values(savedBlocks).find(block => block.opcode === 'operator_join');
    assert.deepStrictEqual(join.inputs.STRING1[1], [12, 'mistwarp.pi', 'mistwarp.pi'], 'pi is a variable reporter');
    assert.deepStrictEqual(join.inputs.STRING2[1], [12, 'mistwarp.newline', 'mistwarp.newline'],
        'newline is a variable reporter');

    for (const target of targets) runtime.disposeTarget(target);

    const reloadRuntime = new Runtime();
    const reloaded = await sb3.deserialize(JSON.parse(JSON.stringify(saved)), reloadRuntime);
    const reloadedStage = reloaded.targets.find(target => target.isStage);
    assert.deepStrictEqual(Object.keys(reloadedStage.variables), [], 'constant variables are not recreated on load');
    const reloadedOpcodes = Object.values(reloaded.targets[1].blocks._blocks).map(block => block.opcode);
    assert.ok(reloadedOpcodes.includes('operator_pi'), 'pi block restored');
    assert.ok(reloadedOpcodes.includes('operator_newline'), 'newline block restored');
    assert.ok(!reloadedOpcodes.includes('data_variable'), 'no leftover variable reporters');
});

const operatorProject = blocks => ({
    targets: [
        {isStage: true, name: 'Stage', variables: {}, lists: {}, broadcasts: {}, blocks: {},
            comments: {}, currentCostume: 0, costumes: [], sounds: [], volume: 100, layerOrder: 0,
            tempo: 60, videoTransparency: 50, videoState: 'off', textToSpeechLanguage: null},
        {isStage: false, name: 'Sprite1', variables: {v: ['dir', 0]}, lists: {}, broadcasts: {},
            blocks: Object.assign({
                hat: {opcode: 'event_whenflagclicked', next: 'say', parent: null, inputs: {},
                    fields: {}, shadow: false, topLevel: true, x: 0, y: 0}
            }, blocks),
            comments: {}, currentCostume: 0, costumes: [], sounds: [], volume: 100, layerOrder: 1,
            visible: true, x: 0, y: 0, size: 100, direction: 90, draggable: false,
            rotationStyle: 'all around'}
    ], monitors: [], extensions: [], meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
});

const roundTrip = async project => {
    const runtime = new Runtime();
    runtime.extendableOperators = true;
    const {targets} = await sb3.deserialize(JSON.parse(JSON.stringify(project)), runtime);
    for (const target of targets) runtime.addTarget(target);
    const sprite = targets.find(target => !target.isStage);
    const saved = sb3.serialize(runtime).targets.find(target => !target.isStage).blocks;
    return {sprite, saved, runtime};
};

test('empty extendable operator inputs get a shadow back on load and save', async () => {
    const {sprite, saved} = await roundTrip(operatorProject({
        say: {opcode: 'looks_say', next: 'say2', parent: 'hat', inputs: {MESSAGE: [3, 'add', [10, '']]},
            fields: {}, shadow: false, topLevel: false},
        add: {opcode: 'operator_add', next: null, parent: 'say',
            inputs: {NUM1: [3, [12, 'dir', 'v'], [4, '']], NUM2: [1, null]},
            fields: {}, shadow: false, topLevel: false},
        say2: {opcode: 'looks_say', next: null, parent: 'say', inputs: {MESSAGE: [3, 'join', [10, '']]},
            fields: {}, shadow: false, topLevel: false},
        join: {opcode: 'operator_join', next: null, parent: 'say2', inputs: {STRING1: [1, [10, 'a']]},
            fields: {}, shadow: false, topLevel: false}
    }));
    const add = sprite.blocks.getBlock('add');
    const num2 = sprite.blocks.getBlock(add.inputs.NUM2.block);
    assert.strictEqual(num2.opcode, 'math_number');
    assert.ok(num2.shadow);
    assert.strictEqual(add.inputs.NUM2.shadow, add.inputs.NUM2.block);
    const join = sprite.blocks.getBlock('join');
    assert.strictEqual(sprite.blocks.getBlock(join.inputs.STRING2.block).opcode, 'text');
    const savedAdd = Object.values(saved).find(block => block.opcode === 'operator_add');
    assert.deepStrictEqual(savedAdd.inputs.NUM2, [1, [4, '']]);
    const savedJoin = Object.values(saved).find(block => block.opcode === 'operator_join');
    assert.deepStrictEqual(savedJoin.inputs.STRING2, [1, [10, '']]);
});

test('inputs left past the item count are not saved', async () => {
    const {sprite, saved, runtime} = await roundTrip(operatorProject({
        say: {opcode: 'looks_say', next: null, parent: 'hat', inputs: {MESSAGE: [3, 'mul', [10, '']]},
            fields: {}, shadow: false, topLevel: false},
        mul: {opcode: 'operator_multiply', next: null, parent: 'say',
            inputs: {NUM1: [1, [4, '2']], NUM2: [1, [4, '3']]},
            fields: {}, shadow: false, topLevel: false}
    }));
    const mul = sprite.blocks.getBlock('mul');
    sprite.blocks.createBlock({id: 'stale', opcode: 'math_number', inputs: {},
        fields: {NUM: {name: 'NUM', value: '9'}}, next: null, topLevel: false, parent: null, shadow: true});
    mul.inputs.NUM3 = {name: 'NUM3', block: null, shadow: 'stale'};
    const savedMul = Object.values(sb3.serialize(runtime).targets[1].blocks)
        .find(block => block.opcode === 'operator_multiply');
    assert.deepStrictEqual(Object.keys(savedMul.inputs).sort(), ['NUM1', 'NUM2']);
    assert.ok(sprite.blocks.getBlock('stale'), 'saving does not change the running project');
    assert.ok(Object.values(saved).every(block => !Array.isArray(block) || block[0] !== 4));
});

test('an input whose block went missing falls back to its shadow', async () => {
    const {sprite, runtime} = await roundTrip(operatorProject({
        say: {opcode: 'looks_say', next: null, parent: 'hat', inputs: {MESSAGE: [3, 'add', [10, '']]},
            fields: {}, shadow: false, topLevel: false},
        add: {opcode: 'operator_add', next: null, parent: 'say',
            inputs: {NUM1: [1, [4, '1']], NUM2: [1, [4, '2']]},
            mutation: {tagName: 'mutation', children: [], itemcount: '3'},
            fields: {}, shadow: false, topLevel: false}
    }));
    const add = sprite.blocks.getBlock('add');
    assert.strictEqual(sprite.blocks.getBlock(add.inputs.NUM3.block).opcode, 'math_number',
        'missing third input is filled');
    add.inputs.NUM3 = {name: 'NUM3', block: null, shadow: add.inputs.NUM3.shadow};
    const saved = sb3.serialize(runtime).targets[1].blocks;
    const adds = Object.values(saved).filter(block => block.opcode === 'operator_add');
    assert.strictEqual(adds.length, 2, 'three items are saved as two nested blocks');
    for (const block of adds) {
        for (const name of ['NUM1', 'NUM2']) {
            const input = block.inputs[name];
            assert.ok(input && (input[0] !== 1 || input[1] !== null), `${name} is not empty`);
            assert.ok(!(input[0] === 3 && input[1] === null), `${name} has a block`);
        }
    }
});

test('empty boolean operands stay empty', async () => {
    const {sprite, saved} = await roundTrip(operatorProject({
        if: {opcode: 'control_if', next: null, parent: 'hat', inputs: {CONDITION: [2, 'and']},
            fields: {}, shadow: false, topLevel: false},
        and: {opcode: 'operator_and', next: null, parent: 'if', inputs: {},
            fields: {}, shadow: false, topLevel: false}
    }));
    assert.deepEqual(sprite.blocks.getBlock('and').inputs, {});
    assert.deepEqual(Object.values(saved).find(block => block.opcode === 'operator_and').inputs, {});
});
