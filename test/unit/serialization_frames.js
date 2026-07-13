const test = require('tap').test;
const path = require('path');
const VirtualMachine = require('../../src/index');
const Runtime = require('../../src/engine/runtime');
const sb3 = require('../../src/serialization/sb3');
const readFileToBuffer = require('../fixtures/readProjectFile').readFileToBuffer;
const projectPath = path.resolve(__dirname, '../fixtures/comments.sb3');

test('frames round-trip through sb3 and the workspace xml', t => {
    const vm = new VirtualMachine();
    vm.loadProject(readFileToBuffer(projectPath)).then(() => {
        const stage = vm.runtime.getTargetForStage();
        const sprite = vm.runtime.targets.find(target => !target.isStage);

        sprite.createFrame('f1', 'Movement', 40, 60, 400, 300, '#CF63CF', false, []);
        sprite.createFrame('f2', 'Collapsed', 40, 400, 400, 300, '#FFBF00', true, ['blockA']);

        const json = JSON.parse(JSON.stringify(sb3.serialize(vm.runtime)));
        const spriteJson = json.targets.find(target => !target.isStage);
        const stageJson = json.targets.find(target => target.isStage);

        t.ok(spriteJson.frames, 'the sprite serializes its frames');
        t.equal(spriteJson.frames.f1.title, 'Movement');
        t.equal(spriteJson.frames.f1.color, '#CF63CF');
        t.equal(spriteJson.frames.f1.collapsed, false);
        t.notOk('blocks' in spriteJson.frames.f1,
            'an expanded frame stores no member list: membership is geometric');
        t.same(spriteJson.frames.f2.blocks, ['blockA'],
            'a collapsed frame remembers the blocks it swallowed');

        // A target with no frames must not gain a frames key, so that projects which
        // do not use the feature stay byte-identical to what vanilla would write.
        t.notOk('frames' in stageJson, 'a frameless target has no frames key');

        return sb3.deserialize(json, new Runtime()).then(({targets}) => {
            const back = targets.find(target => !target.isStage);
            t.equal(Object.keys(back.frames).length, 2);
            t.equal(back.frames.f1.title, 'Movement');
            t.equal(back.frames.f1.width, 400);
            t.equal(back.frames.f2.collapsed, true);
            t.same(back.frames.f2.blocks, ['blockA']);

            // The editor only ever sees frames through the workspace xml.
            vm.setEditingTarget(sprite.id);
            let xml = null;
            vm.on('workspaceUpdate', data => {
                xml = data.xml;
            });
            vm.emitWorkspaceUpdate();
            t.match(xml, /<frame [^>]*id="f1"/, 'frames reach the editor');
            t.match(xml, /blocks="blockA"/, 'a collapsed frame carries its members');

            t.equal(stage.frames && Object.keys(stage.frames).length, 0);
            t.end();
        });
    });
});

test('frame events from the editor reach the target', t => {
    const vm = new VirtualMachine();
    vm.loadProject(readFileToBuffer(projectPath)).then(() => {
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
            color: '#59C059',
            collapsed: false,
            blockIds: []
        });
        t.ok(sprite.frames.newFrame, 'frame_create creates the frame');
        t.equal(sprite.frames.newFrame.title, 'Setup');

        vm.blockListener({
            type: 'frame_move',
            frameId: 'newFrame',
            newCoordinate_: {x: 50, y: 70}
        });
        t.equal(sprite.frames.newFrame.x, 50, 'frame_move updates the position');

        vm.blockListener({
            type: 'frame_change',
            frameId: 'newFrame',
            newContents_: {collapsed: true, blockIds: ['b1']}
        });
        t.equal(sprite.frames.newFrame.collapsed, true, 'frame_change collapses');
        t.same(sprite.frames.newFrame.blocks, ['b1'], 'frame_change records members');

        vm.blockListener({
            type: 'frame_change',
            frameId: 'newFrame',
            newContents_: {title: 'Renamed', color: '#FF6680'}
        });
        t.equal(sprite.frames.newFrame.title, 'Renamed');
        t.equal(sprite.frames.newFrame.color, '#FF6680');

        vm.blockListener({
            type: 'frame_delete',
            frameId: 'newFrame'
        });
        t.notOk(sprite.frames.newFrame, 'frame_delete removes the frame');
        t.end();
    });
});
