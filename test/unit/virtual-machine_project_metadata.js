const tap = require('tap');
const path = require('path');
const fs = require('fs');
const VirtualMachine = require('../../src/virtual-machine');

const test = tap.test;

const projectPath = path.resolve(__dirname, '../fixtures/default.sb3');

test('registered metadata is written to the project meta and read back on load', async t => {
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
    t.equal(loaded, undefined);

    created = '2026-11-01';
    const meta = JSON.parse(vm.toJSON()).meta;
    t.equal(meta.created, '2026-11-01');
    t.equal(meta.agent, 'custom');
    t.equal(meta.semver, '3.0.0');

    await vm.loadProject(vm.toJSON());
    t.equal(loaded, '2026-11-01');
    t.end();
});

test('a serializer that returns undefined writes nothing', t => {
    const vm = new VirtualMachine();
    vm.registerProjectMetadata('author', {serialize: () => undefined});
    const meta = JSON.parse(vm.toJSON()).meta;
    t.notOk(Object.prototype.hasOwnProperty.call(meta, 'author'));
    t.end();
});

test('sprite exports do not get project metadata', async t => {
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
    t.equal(calls, 0);
    t.notOk(json.meta);
    t.end();
});

test('keys are unique, built-in keys are reserved and handlers can be removed', t => {
    const vm = new VirtualMachine();
    const remove = vm.registerProjectMetadata('created', {serialize: () => 'a'});
    t.throws(() => vm.registerProjectMetadata('created', {}));
    t.throws(() => vm.registerProjectMetadata('platform', {}), TypeError);
    t.throws(() => vm.registerProjectMetadata('', {}), TypeError);
    remove();
    t.notOk(Object.prototype.hasOwnProperty.call(JSON.parse(vm.toJSON()).meta, 'created'));
    vm.registerProjectMetadata('created', {serialize: () => 'b'});
    remove();
    t.equal(JSON.parse(vm.toJSON()).meta.created, 'b');
    t.end();
});

test('a failing handler does not break saving or loading', async t => {
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
    t.ok(JSON.parse(json).meta);
    await vm.loadProject(fs.readFileSync(projectPath));
    t.ok(vm.runtime.targets.length > 0);
    t.end();
});
