const {test} = require('node:test');
const assert = require('node:assert');
const path = require('path');
const VirtualMachine = require('../../src/index');
const Runtime = require('../../src/engine/runtime');
const sb3 = require('../../src/serialization/sb3');
const adapter = require('../../src/engine/adapter');
const readFileToBuffer = require('../fixtures/readProjectFile').readFileToBuffer;
const makeTestStorage = require('../fixtures/make-test-storage');
const projectPath = path.resolve(__dirname, '../fixtures/comments.sb3');

test('frames round-trip through sb3 and the workspace xml', () => {
    const vm = new VirtualMachine();
    return vm.loadProject(readFileToBuffer(projectPath)).then(() => {
        const stage = vm.runtime.getTargetForStage();
        const sprite = vm.runtime.targets.find(target => !target.isStage);

        sprite.createFrame('f1', 'Movement', 40, 60, 400, 300, false, []);
        sprite.createFrame('f2', 'Collapsed', 40, 400, 400, 300, true, ['blockA']);

        const json = JSON.parse(JSON.stringify(sb3.serialize(vm.runtime)));
        const spriteJson = json.targets.find(target => !target.isStage);
        const stageJson = json.targets.find(target => target.isStage);

        assert.ok(spriteJson.frames, 'the sprite serializes its frames');
        assert.strictEqual(spriteJson.frames.f1.title, 'Movement');
        assert.strictEqual(spriteJson.frames.f1.collapsed, false);
        assert.ok(!('blocks' in spriteJson.frames.f1),
            'an expanded frame stores no member list: membership is geometric');
        assert.deepStrictEqual(spriteJson.frames.f2.blocks, ['blockA'],
            'a collapsed frame remembers the blocks it swallowed');

        // A target with no frames must not gain a frames key, so that projects which
        // do not use the feature stay byte-identical to what vanilla would write.
        assert.ok(!('frames' in stageJson), 'a frameless target has no frames key');

        return sb3.deserialize(json, new Runtime()).then(({targets}) => {
            const back = targets.find(target => !target.isStage);
            assert.strictEqual(Object.keys(back.frames).length, 2);
            assert.strictEqual(back.frames.f1.title, 'Movement');
            assert.strictEqual(back.frames.f1.width, 400);
            assert.strictEqual(back.frames.f2.collapsed, true);
            assert.deepStrictEqual(back.frames.f2.blocks, ['blockA']);

            // The editor only ever sees frames through the workspace xml.
            vm.setEditingTarget(sprite.id);
            let xml = null;
            vm.on('workspaceUpdate', data => {
                xml = data.xml;
            });
            vm.emitWorkspaceUpdate();
            assert.match(xml, /<frame [^>]*id="f1"/, 'frames reach the editor');
            assert.match(xml, /blocks="blockA"/, 'a collapsed frame carries its members');

            assert.strictEqual(stage.frames && Object.keys(stage.frames).length, 0);
        });
    });
});

test('frame events from the editor reach the target', () => {
    const vm = new VirtualMachine();
    return vm.loadProject(readFileToBuffer(projectPath)).then(() => {
        const sprite = vm.runtime.targets.find(target => !target.isStage);
        vm.setEditingTarget(sprite.id);

        // blocklyListen drops any event without a block, var, comment or frame id.
        vm.blockListener({
            type: 'frame_create',
            frameId: 'newFrame',
            title: 'Setup',
            xy: {x: 5, y: 7},
            width: 200,
            height: 100,
            collapsed: false,
            blockIds: []
        });
        assert.ok(sprite.frames.newFrame, 'frame_create creates the frame');
        assert.strictEqual(sprite.frames.newFrame.title, 'Setup');

        vm.blockListener({
            type: 'frame_move',
            frameId: 'newFrame',
            newCoordinate_: {x: 50, y: 70}
        });
        assert.strictEqual(sprite.frames.newFrame.x, 50, 'frame_move updates the position');

        vm.blockListener({
            type: 'frame_change',
            frameId: 'newFrame',
            newContents_: {collapsed: true, blockIds: ['b1']}
        });
        assert.strictEqual(sprite.frames.newFrame.collapsed, true, 'frame_change collapses');
        assert.deepStrictEqual(sprite.frames.newFrame.blocks, ['b1'], 'frame_change records members');

        vm.blockListener({
            type: 'frame_change',
            frameId: 'newFrame',
            newContents_: {title: 'Renamed'}
        });
        assert.strictEqual(sprite.frames.newFrame.title, 'Renamed');

        vm.blockListener({
            type: 'frame_delete',
            frameId: 'newFrame'
        });
        assert.ok(!sprite.frames.newFrame, 'frame_delete removes the frame');
    });
});

test('a frame drag carries its scripts to another sprite', () => {
    // What Blockly.Events.EndFrameDrag sends: every script in the frame,
    // wrapped in one <xml> element, plus the frame itself.
    const dragged = adapter({
        xml: {
            outerHTML: '<xml>' +
                '<block type="event_whenflagclicked" id="b1" x="60" y="90"></block>' +
                '<block type="event_whenflagclicked" id="b2" x="60" y="200"></block>' +
                '</xml>'
        }
    });
    assert.strictEqual(dragged.length, 2, 'the <xml> wrapper does not hide the scripts');

    const payload = {
        blocks: dragged,
        frames: [{title: 'Movement', x: 40, y: 60, width: 400, height: 300}]
    };

    const vm = new VirtualMachine();
    return vm.loadProject(readFileToBuffer(projectPath)).then(() => {
        const from = vm.runtime.targets.find(target => !target.isStage);
        const to = vm.runtime.getTargetForStage();
        const roundTripped = JSON.parse(JSON.stringify(
            sb3.serializeStandaloneBlocks(payload, vm.runtime)));
        assert.deepStrictEqual(roundTripped.frames, payload.frames, 'frames survive the backpack format');

        return vm.shareBlocksToTarget(roundTripped, to.id, from.id).then(() => {
            const frames = Object.values(to.frames);
            assert.strictEqual(frames.length, 1, 'the frame arrives on the other target');
            assert.strictEqual(frames[0].title, 'Movement');
            assert.ok(frames[0].id, 'the copy gets its own id');
            assert.strictEqual(frames[0].collapsed, false, 'a shared frame always arrives expanded');
            assert.deepStrictEqual(frames[0].blocks, [], 'so it needs no member list');
            assert.strictEqual(Object.keys(to.blocks._blocks).length, 2, 'the scripts come with it');

            const frame = frames[0];
            const inside = Object.values(to.blocks._blocks)
                .filter(block => block.topLevel)
                .filter(block =>
                    block.x >= frame.x && block.x <= frame.x + frame.width &&
                    block.y >= frame.y && block.y <= frame.y + frame.height);
            assert.strictEqual(inside.length, 2, 'both scripts land inside the copied frame');
            assert.strictEqual(inside[1].y - inside[0].y, 110, 'and keep their spacing');
        });
    });
});

test('a collapsed frame keeps its blocks when saving shortens block ids', () => {
    const vm = new VirtualMachine();
    return vm.loadProject(readFileToBuffer(projectPath)).then(() => {
        const sprite = vm.runtime.targets.find(target => !target.isStage);
        const topId = sprite.blocks.getScripts()[0];
        const opcode = sprite.blocks.getBlock(topId).opcode;
        sprite.createFrame('f1', 'Collapsed', 0, 0, 400, 300, true, [topId, 'goneBlock']);

        const json = JSON.parse(JSON.stringify(sb3.serialize(vm.runtime, null, {allowOptimization: true})));
        const frame = json.targets.find(target => !target.isStage).frames.f1;
        const blocks = json.targets.find(target => !target.isStage).blocks;

        assert.notStrictEqual(frame.blocks[0], topId, 'the block id was shortened');
        assert.ok(blocks[frame.blocks[0]], 'the frame points at a block that exists');
        assert.strictEqual(blocks[frame.blocks[0]].opcode, opcode, 'and it is the block the frame swallowed');
        assert.strictEqual(frame.blocks[1], 'goneBlock', 'an id with no block is left alone');
        assert.ok(!blocks.goneBlock, 'and no shortened id takes it over');
    });
});

test('duplicating a sprite copies its frames and points collapsed ones at the copied blocks', () => {
    const vm = new VirtualMachine();
    vm.attachStorage(makeTestStorage());
    return vm.loadProject(readFileToBuffer(projectPath)).then(() => {
        const sprite = vm.runtime.targets.find(target => !target.isStage);
        const topId = sprite.blocks.getScripts()[0];
        sprite.createFrame('open', 'Open', 40, 60, 400, 300, false, []);
        sprite.createFrame('shut', 'Shut', 40, 400, 400, 300, true, [topId]);

        return sprite.duplicate().then(copy => {
            assert.deepStrictEqual(Object.keys(copy.frames).sort(), ['open', 'shut']);
            assert.strictEqual(copy.frames.open.title, 'Open');
            assert.strictEqual(copy.frames.shut.collapsed, true);
            assert.strictEqual(copy.frames.shut.blocks.length, 1);
            const member = copy.frames.shut.blocks[0];
            assert.notStrictEqual(member, topId, 'the copy points at its own block');
            assert.ok(copy.blocks.getBlock(member), 'which exists in the copy');
            assert.strictEqual(copy.blocks.getBlock(member).opcode, sprite.blocks.getBlock(topId).opcode);
            assert.notStrictEqual(copy.frames.shut, sprite.frames.shut, 'the frame objects are not shared');
        });
    });
});
