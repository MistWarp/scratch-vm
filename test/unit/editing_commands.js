const path = require('path');
const {test} = require('tap');
const VirtualMachine = require('../../src/virtual-machine');
const makeTestStorage = require('../fixtures/make-test-storage');
const {readFileToBuffer} = require('../fixtures/readProjectFile');

const fixture = readFileToBuffer(path.resolve(__dirname, '../fixtures/default.sb3'));

const makeVM = async () => {
    const vm = new VirtualMachine();
    vm.attachStorage(makeTestStorage());
    await vm.loadProject(fixture);
    return vm;
};

const findAsset = vm => md5 => {
    for (const target of vm.runtime.targets) {
        for (const item of [...target.getCostumes(), ...target.getSounds()]) {
            if (item.md5 === md5 && item.asset) return item.asset;
        }
    }
    return null;
};

const makePair = async () => {
    const host = await makeVM();
    const guest = await makeVM();
    host.runtime.targets.forEach((target, index) => {
        guest.runtime.targets[index].id = target.id;
    });
    guest.runtime.invalidateTargetCaches();
    host.editingCommands.handler = command => host.editingCommands.execute(command);
    host.editingCommands.snapshot();
    const transfer = commit => guest.editingCommands.apply(JSON.parse(JSON.stringify(commit)), findAsset(host));
    return {host, guest, transfer};
};

const sprite = vm => vm.runtime.targets.find(target => !target.isStage);
const stage = vm => vm.runtime.getTargetForStage();

const menuBlock = (id, opcode, field, value) => ({
    id,
    opcode,
    fields: {[field]: {name: field, value}},
    inputs: {},
    next: null,
    parent: null,
    topLevel: true,
    shadow: false,
    x: 0,
    y: 0
});

const svgAsset = (vm, text) => {
    const storage = vm.runtime.storage;
    const asset = storage.createAsset(storage.AssetType.ImageVector, 'svg',
        Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4">${text}</svg>`), null, true);
    return {
        name: 'painted',
        asset,
        assetId: asset.assetId,
        dataFormat: 'svg',
        md5: `${asset.assetId}.svg`,
        rotationCenterX: 2,
        rotationCenterY: 2,
        bitmapResolution: 1
    };
};

test('costume and sound renames carry the rewritten block menus', async t => {
    const {host, guest, transfer} = await makePair();
    for (const vm of [host, guest]) {
        sprite(vm).blocks.createBlock(menuBlock('costume', 'looks_costume', 'COSTUME', 'costume1'));
        sprite(vm).blocks.createBlock(menuBlock('sound', 'sound_sounds_menu', 'SOUND_MENU', 'Meow'));
        vm.setEditingTarget(sprite(vm).id);
    }
    const costumeCommit = await host.renameCostume(0, 'hero');
    const costumePatch = costumeCommit.patches.find(patch => patch.id === sprite(host).id);
    t.equal(costumePatch.blocks.costume.fields.COSTUME.value, 'hero');
    await transfer(costumeCommit);
    t.equal(sprite(guest).blocks.getBlock('costume').fields.COSTUME.value, 'hero');
    t.equal(sprite(guest).getCostumes()[0].name, 'hero');

    const soundCommit = await host.renameSound(0, 'Purr');
    await transfer(soundCommit);
    t.equal(sprite(guest).blocks.getBlock('sound').fields.SOUND_MENU.value, 'Purr');
    t.equal(sprite(guest).getSounds()[0].name, 'Purr');
});

test('backdrop renames rewrite blocks in every target', async t => {
    const {host, guest, transfer} = await makePair();
    for (const vm of [host, guest]) {
        sprite(vm).blocks.createBlock(menuBlock('sprite-menu', 'looks_backdrops', 'BACKDROP', 'backdrop1'));
        stage(vm).blocks.createBlock(menuBlock('stage-menu', 'looks_backdrops', 'BACKDROP', 'backdrop1'));
        vm.setEditingTarget(stage(vm).id);
    }
    const commit = await host.renameCostume(0, 'night');
    t.ok(commit.patches.find(patch => patch.id === sprite(host).id).blocks);
    await transfer(commit);
    t.equal(sprite(guest).blocks.getBlock('sprite-menu').fields.BACKDROP.value, 'night');
    t.equal(stage(guest).blocks.getBlock('stage-menu').fields.BACKDROP.value, 'night');
    t.equal(stage(guest).getCostumes()[0].name, 'night');
});

test('addBackdrop syncs to the stage and only lists the new asset', async t => {
    const {host, guest, transfer} = await makePair();
    host.setEditingTarget(sprite(host).id);
    const commands = [];
    const execute = host.editingCommands.handler;
    host.editingCommands.handler = command => {
        commands.push(command);
        return execute(command);
    };
    const backdrop = svgAsset(host, '<rect width="4" height="4"/>');
    const commit = await host.addBackdrop(backdrop.md5, backdrop);
    t.equal(commands[0].method, 'addBackdrop');
    t.equal(commands[0].targetId, stage(host).id);
    t.same(commit.assetRefs, [backdrop.md5]);
    await transfer(commit);
    t.equal(stage(guest).getCostumes().length, 2);
    t.equal(stage(guest).getCostumes()[1].md5, backdrop.md5);
    t.equal(stage(guest).currentCostume, 1);
});

test('assetRefs skip assets the receiver already has', async t => {
    const {host, guest, transfer} = await makePair();
    const duplicate = await host.editingCommands.execute({method: 'duplicateSprite',
        args: [sprite(host).id],
        targetId: sprite(host).id});
    t.ok(duplicate.patches.some(patch => patch.create));
    t.same(duplicate.assetRefs, []);
    await transfer(duplicate);
    t.equal(guest.runtime.targets.filter(target => target.isOriginal).length, 3);

    host.setEditingTarget(sprite(host).id);
    const costume = svgAsset(host, '<circle r="2"/>');
    const added = await host.addCostume(costume.md5, costume);
    t.same(added.assetRefs, [costume.md5]);
});

test('drags produce one sprite info command when they stop', async t => {
    const {host, guest, transfer} = await makePair();
    const target = sprite(host);
    host.setEditingTarget(target.id);
    const commands = [];
    host.editingCommands.handler = command => {
        commands.push(command);
        return Promise.resolve();
    };
    host.startDrag(target.id);
    for (let i = 1; i <= 5; i++) host.postSpriteInfo({x: i * 10, y: -i, force: true});
    t.equal(commands.length, 0);
    t.equal(target.x, 50);
    host.stopDrag(target.id);
    t.equal(commands.length, 1);
    t.equal(commands[0].method, 'postSpriteInfo');
    t.same(commands[0].args[0], {x: 50, y: -5});
    const result = await host.editingCommands.execute(commands[0]);
    t.same(result.patches.find(patch => patch.id === target.id).props, {x: 50, y: -5});
    await transfer(result);
    t.equal(sprite(guest).x, 50);
    t.equal(sprite(guest).y, -5);
});

test('drags of clones stay local', async t => {
    const {host} = await makePair();
    const clone = sprite(host).makeClone();
    host.runtime.addTarget(clone);
    const commands = [];
    host.editingCommands.handler = command => {
        commands.push(command);
        return Promise.resolve();
    };
    host.startDrag(clone.id);
    host.postSpriteInfo({x: 5, y: 5, force: true});
    host.stopDrag(clone.id);
    t.equal(commands.length, 0);
    t.equal(clone.x, 5);
});

test('setVariableValue syncs to the owning target and keeps the variable object', async t => {
    const {host, guest, transfer} = await makePair();
    const id = Object.keys(stage(host).variables)[0];
    const guestVariable = stage(guest).variables[id];
    const commands = [];
    const execute = host.editingCommands.handler;
    host.editingCommands.handler = command => {
        commands.push(command);
        return execute(command);
    };
    const commit = await host.setVariableValue(sprite(host).id, id, 42);
    t.equal(commands[0].targetId, stage(host).id);
    t.equal(stage(host).variables[id].value, 42);
    await transfer(commit);
    t.equal(stage(guest).variables[id], guestVariable);
    t.equal(guestVariable.value, 42);
});

test('a failure after mutation still returns the diff', async t => {
    const {host, guest, transfer} = await makePair();
    const target = sprite(host);
    host.editingCommands.originals.postSpriteInfo = function () {
        this.editingTarget.setXY(10, 20);
        throw new Error('boom');
    };
    const commit = await host.editingCommands.execute({method: 'postSpriteInfo',
        args: [{visible: true}],
        targetId: target.id});
    t.equal(commit.error, 'boom');
    t.same(commit.patches[0].props, {x: 10, y: 20, visible: true});
    await transfer(commit);
    t.equal(sprite(guest).x, 10);
});

test('a detached occupying script is broadcast when the move fails', async t => {
    const {host} = await makePair();
    const target = sprite(host);
    const stack = id => Object.assign(menuBlock(id, 'motion_movesteps', 'X', ''), {fields: {}});
    target.blocks.createBlock(stack('parent'));
    target.blocks.createBlock(Object.assign(stack('occupied'), {parent: 'parent', topLevel: false}));
    target.blocks._blocks.parent.next = 'occupied';
    target.blocks.createBlock(stack('moving'));
    target.blocks.blocklyListen = () => {
        throw new Error('listen failed');
    };
    const commit = await host.editingCommands.execute({method: 'blockEvent',
        args: [{type: 'move', blockId: 'moving', newParentId: 'parent'}],
        targetId: target.id});
    t.equal(commit.error, 'listen failed');
    const patch = commit.patches.find(item => item.id === target.id);
    t.equal(patch.blocks.occupied.parent, null);
    t.equal(patch.blocks.occupied.topLevel, true);
});

test('a failure before mutation still rejects', async t => {
    const {host} = await makePair();
    await t.rejects(host.editingCommands.execute({method: 'blockEvent',
        args: [{type: 'move', blockId: 'missing'}],
        targetId: sprite(host).id}), /block was deleted/);
});

test('apply keeps clones after their original sprite', async t => {
    const {host, guest} = await makePair();
    await guest.duplicateSprite(sprite(guest).id);
    const [stageTarget, first, second] = guest.runtime.targets;
    const clone = first.makeClone();
    guest.runtime.addTarget(clone);
    t.same(guest.runtime.targets.map(target => target.id), [stageTarget.id, first.id, second.id, clone.id]);
    await guest.editingCommands.apply({patches: [], order: [stageTarget.id, second.id, first.id], assetRefs: []},
        findAsset(host));
    t.same(guest.runtime.targets.map(target => target.id), [stageTarget.id, second.id, first.id, clone.id]);
    await guest.editingCommands.apply({patches: [], order: [stageTarget.id, first.id, second.id], assetRefs: []},
        findAsset(host));
    t.same(guest.runtime.targets.map(target => target.id), [stageTarget.id, first.id, clone.id, second.id]);
    t.equal(guest.runtime.getSpriteTargetByName(first.getName()), first);
});

test('collab extension loads ask canLoadExtension except for builtins', async t => {
    const {host, guest} = await makePair();
    const asked = [];
    for (const vm of [host, guest]) {
        vm.editingCommands.canLoadExtension = url => {
            asked.push(url);
            return Promise.resolve(false);
        };
    }
    const url = 'https://extensions.example/blocked.js';
    await t.rejects(host.editingCommands.execute({method: 'loadExtensionURL', args: [url], targetId: null}),
        /The extension was not allowed\./);
    t.notOk(host.extensionManager.isExtensionURLLoaded(url));

    const builtin = await host.editingCommands.execute({method: 'loadExtensionURL', args: ['pen'], targetId: null});
    t.ok(host.extensionManager.isExtensionLoaded('pen'));
    t.same(asked, [url]);
    t.same(builtin.extension, {method: 'loadExtensionURL', args: ['pen']});

    const commit = {patches: [{id: sprite(guest).id, name: 'Renamed'}],
        order: guest.runtime.targets.map(target => target.id),
        assetRefs: [],
        extension: {method: 'loadExtensionURL', args: [url]}};
    await guest.editingCommands.apply(commit, findAsset(host));
    t.same(asked, [url, url]);
    t.notOk(guest.extensionManager.isExtensionURLLoaded(url));
    t.equal(sprite(guest).getName(), 'Renamed');

    await guest.editingCommands.apply(Object.assign({}, commit, {extension: builtin.extension}), findAsset(host));
    t.ok(guest.extensionManager.isExtensionLoaded('pen'));
    t.same(asked, [url, url]);
});
