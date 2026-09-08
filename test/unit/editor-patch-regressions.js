const test = require('tap').test;
const Runtime = require('../../src/engine/runtime');
const EditingCommands = require('../../src/editing/commands');
const Target = require('../../src/engine/target');

test('remote sprite renames refresh cached name lookups', async t => {
    const runtime = new Runtime();
    const target = {id: 'sprite', isStage: false, sprite: {name: 'before'}};
    runtime.targets = [target];
    t.equal(runtime.getSpriteTargetByName('before'), target);
    const commands = Object.create(EditingCommands.prototype);
    commands.vm = {runtime};
    await commands.applyState(target, {name: 'after'}, () => null);
    t.equal(runtime.getSpriteTargetByName('after'), target);
    t.notOk(runtime.getSpriteTargetByName('before'));
    runtime.targets = [];
    runtime.dispose();
});

test('cloud variable patches notify create, rename and delete exactly once', async t => {
    const runtime = new Runtime();
    const target = new Target(runtime);
    target.isStage = true;
    const calls = [];
    runtime.ioDevices.cloud.requestCreateVariable = v => calls.push(['create', v.name]);
    runtime.ioDevices.cloud.requestRenameVariable = (a, b) => calls.push(['rename', a, b]);
    runtime.ioDevices.cloud.requestDeleteVariable = name => calls.push(['delete', name]);
    const commands = Object.create(EditingCommands.prototype);
    commands.vm = {runtime};
    const variable = {id: 'v', name: 'score', type: '', isCloud: true, value: 0};
    await commands.applyState(target, {variables: {v: variable}}, () => null);
    await commands.applyState(target, {variables: {v: variable}}, () => null);
    await commands.applyState(target, {variables: {v: {...variable, name: 'points'}}}, () => null);
    await commands.applyState(target, {variables: {v: null}}, () => null);
    t.same(calls, [['create', 'score'], ['rename', 'score', 'points'], ['delete', 'points']]);
    runtime.targets = [];
    runtime.dispose();
});
