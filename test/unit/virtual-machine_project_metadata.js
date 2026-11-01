const {test} = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const VirtualMachine = require('../../src/virtual-machine');

const projectPath = path.resolve(__dirname, '../fixtures/default.sb3');

test('registered metadata is written to the project meta and read back on load', async () => {
    const vm = new VirtualMachine();
    let loaded = 'unset';
    let created = null;
    vm.registerProjectMetadata('created', {
        serialize: () => created,
        deserialize: value => {
            loaded = value;
        }
    });
    vm.registerProjectMetadata('agent', {serialize: builtIn => `${builtIn}custom`});

    await vm.loadProject(fs.readFileSync(projectPath));
    assert.strictEqual(loaded, undefined);

    created = '2026-11-01';
    const meta = JSON.parse(vm.toJSON()).meta;
    assert.strictEqual(meta.created, '2026-11-01');
    assert.strictEqual(meta.agent, 'custom');
    assert.strictEqual(meta.semver, '3.0.0');

    await vm.loadProject(vm.toJSON());
    assert.strictEqual(loaded, '2026-11-01');
});

test('a serializer that returns undefined writes nothing', () => {
    const vm = new VirtualMachine();
    vm.registerProjectMetadata('author', {serialize: () => undefined});
    const meta = JSON.parse(vm.toJSON()).meta;
    assert.ok(!Object.prototype.hasOwnProperty.call(meta, 'author'));
});

test('sprite exports do not get project metadata', async () => {
    const vm = new VirtualMachine();
    await vm.loadProject(fs.readFileSync(projectPath));
    let calls = 0;
    vm.registerProjectMetadata('created', {
        serialize: () => {
            calls++;
            return 'x';
        }
    });
    const sprite = vm.runtime.targets.find(target => !target.isStage);
    const json = JSON.parse(vm.toJSON(sprite.id));
    assert.strictEqual(calls, 0);
    assert.ok(!json.meta);
});

test('keys are unique, built-in keys are reserved and handlers can be removed', () => {
    const vm = new VirtualMachine();
    const remove = vm.registerProjectMetadata('created', {serialize: () => 'a'});
    assert.throws(() => vm.registerProjectMetadata('created', {}));
    assert.throws(() => vm.registerProjectMetadata('platform', {}), TypeError);
    assert.throws(() => vm.registerProjectMetadata('', {}), TypeError);
    remove();
    assert.ok(!Object.prototype.hasOwnProperty.call(JSON.parse(vm.toJSON()).meta, 'created'));
    vm.registerProjectMetadata('created', {serialize: () => 'b'});
    remove();
    assert.strictEqual(JSON.parse(vm.toJSON()).meta.created, 'b');
});

test('a failing handler does not break saving or loading', async () => {
    const vm = new VirtualMachine();
    vm.registerProjectMetadata('broken', {
        serialize: () => {
            throw new Error('save');
        },
        deserialize: () => {
            throw new Error('load');
        }
    });
    const json = vm.toJSON();
    assert.ok(JSON.parse(json).meta);
    await vm.loadProject(fs.readFileSync(projectPath));
    assert.ok(vm.runtime.targets.length > 0);
});

test('handlers also get the whole meta being saved or loaded', async () => {
    const vm = new VirtualMachine();
    let savedMeta = null;
    let loadedMeta = null;
    vm.registerProjectMetadata('created', {
        serialize: (value, meta) => {
            savedMeta = Object.assign({}, meta);
            return 'today';
        },
        deserialize: (value, meta) => {
            loadedMeta = meta;
            meta.semver = 'changed';
        }
    });
    const editedSemvers = [];
    vm.registerProjectMetadata('edited', {
        deserialize: (value, meta) => {
            editedSemvers.push(meta.semver);
        }
    });

    const json = JSON.parse(vm.toJSON());
    assert.strictEqual(savedMeta.semver, '3.0.0');
    assert.ok(savedMeta.platform);
    assert.ok(!Object.prototype.hasOwnProperty.call(savedMeta, 'created'));

    await vm.loadProject(fs.readFileSync(projectPath));
    json.meta.custom = {kept: true};
    await vm.loadProject(JSON.stringify(json));
    assert.deepStrictEqual(editedSemvers, ['changed', 'changed']);
    assert.deepStrictEqual(loadedMeta.custom, {kept: true});
    assert.strictEqual(loadedMeta.created, 'today');
    assert.strictEqual(JSON.parse(vm.toJSON()).meta.semver, '3.0.0');
});

test('a handler changing the loaded meta does not change what the VM loads', async () => {
    const vm = new VirtualMachine();
    const mismatches = [];
    vm.runtime.on('PLATFORM_MISMATCH', (platform, proceed) => {
        mismatches.push(platform.name);
        proceed();
    });
    vm.registerProjectMetadata('created', {
        deserialize: (value, meta) => {
            meta.platform.name = 'Changed';
        }
    });
    const json = JSON.parse(vm.toJSON());
    json.meta.platform = {name: 'Other', url: 'https://example.com/'};
    await vm.loadProject(JSON.stringify(json));
    assert.deepStrictEqual(mismatches, ['Other']);
});
