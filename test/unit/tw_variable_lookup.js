const {test} = require('node:test');
const assert = require('node:assert');
const Target = require('../../src/engine/target');
const Variable = require('../../src/engine/variable');
const Runtime = require('../../src/engine/runtime');

const slowLookup = (target, name, type, skipStage) => {
    for (const id in target.variables) {
        const variable = target.variables[id];
        if (variable.name === name && variable.type === type) return variable;
    }
    if (!skipStage && target.runtime && !target.isStage) {
        const stage = target.runtime.getTargetForStage();
        if (stage) return slowLookup(stage, name, type, true);
    }
    return null;
};

const makeRandom = seed => {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
};

const makeTargets = () => {
    const runtime = new Runtime();
    const stage = new Target(runtime);
    stage.isStage = true;
    const sprite = new Target(runtime);
    runtime.targets = [stage, sprite];
    return {stage, sprite};
};

test('repeated lookups return the same variable', () => {
    const {sprite} = makeTargets();
    sprite.createVariable('a', 'score', Variable.SCALAR_TYPE);
    sprite.createVariable('b', 'score', Variable.LIST_TYPE);
    for (let i = 0; i < 3; i++) {
        assert.strictEqual(sprite.lookupVariableByNameAndType('score', Variable.SCALAR_TYPE), sprite.variables.a);
        assert.strictEqual(sprite.lookupVariableByNameAndType('score', Variable.LIST_TYPE), sprite.variables.b);
        assert.strictEqual(sprite.lookupVariableByNameAndType('score'), sprite.variables.a);
        assert.strictEqual(sprite.lookupVariableByNameAndType('missing', Variable.SCALAR_TYPE), null);
        assert.strictEqual(sprite.lookupVariableByNameAndType(5), undefined);
    }
});

test('lookup follows renames, deletions and replacements', () => {
    const {sprite} = makeTargets();
    sprite.createVariable('a', 'score', Variable.SCALAR_TYPE);
    const first = sprite.variables.a;
    assert.strictEqual(sprite.lookupVariableByNameAndType('score', ''), first);

    sprite.renameVariable('a', 'points');
    assert.strictEqual(sprite.lookupVariableByNameAndType('score', ''), null);
    assert.strictEqual(sprite.lookupVariableByNameAndType('points', ''), first);

    first.name = 'direct';
    assert.strictEqual(sprite.lookupVariableByNameAndType('points', ''), null);
    assert.strictEqual(sprite.lookupVariableByNameAndType('direct', ''), first);

    delete sprite.variables.a;
    assert.strictEqual(sprite.lookupVariableByNameAndType('direct', ''), null);

    sprite.variables.a = new Variable('a', 'direct', Variable.SCALAR_TYPE, false);
    assert.strictEqual(sprite.lookupVariableByNameAndType('direct', ''), sprite.variables.a);
    assert.notStrictEqual(sprite.variables.a, first);

    sprite.deleteVariable('a');
    assert.strictEqual(sprite.lookupVariableByNameAndType('direct', ''), null);

    sprite.createVariable('c', 'direct', Variable.SCALAR_TYPE);
    assert.strictEqual(sprite.lookupVariableByNameAndType('direct', ''), sprite.variables.c);
    const replacement = new Variable('c', 'direct', Variable.SCALAR_TYPE, false);
    sprite.variables = {c: replacement};
    assert.strictEqual(sprite.lookupVariableByNameAndType('direct', ''), replacement);

    replacement.type = Variable.LIST_TYPE;
    assert.strictEqual(sprite.lookupVariableByNameAndType('direct', ''), null);
    assert.strictEqual(sprite.lookupVariableByNameAndType('direct', Variable.LIST_TYPE), replacement);
});

test('lookup returns the first of several variables with one name', () => {
    const {sprite} = makeTargets();
    sprite.createVariable('a', 'other', Variable.SCALAR_TYPE);
    sprite.createVariable('b', 'score', Variable.SCALAR_TYPE);
    assert.strictEqual(sprite.lookupVariableByNameAndType('score', ''), sprite.variables.b);
    sprite.renameVariable('a', 'score');
    assert.strictEqual(sprite.lookupVariableByNameAndType('score', ''), sprite.variables.a);
    sprite.createVariable('7', 'score', Variable.SCALAR_TYPE);
    assert.strictEqual(sprite.lookupVariableByNameAndType('score', ''), sprite.variables['7']);
    sprite.deleteVariable('7');
    assert.strictEqual(sprite.lookupVariableByNameAndType('score', ''), sprite.variables.a);
});

test('lookup falls back to the stage unless told to skip it', () => {
    const {stage, sprite} = makeTargets();
    stage.createVariable('g', 'global', Variable.SCALAR_TYPE);
    for (let i = 0; i < 2; i++) {
        assert.strictEqual(sprite.lookupVariableByNameAndType('global', ''), stage.variables.g);
        assert.strictEqual(sprite.lookupVariableByNameAndType('global', '', true), null);
        assert.strictEqual(stage.lookupVariableByNameAndType('global', '', true), stage.variables.g);
    }
    sprite.createVariable('l', 'global', Variable.SCALAR_TYPE);
    assert.strictEqual(sprite.lookupVariableByNameAndType('global', ''), sprite.variables.l);
    stage.renameVariable('g', 'renamed');
    sprite.deleteVariable('l');
    assert.strictEqual(sprite.lookupVariableByNameAndType('global', ''), null);
    assert.strictEqual(sprite.lookupVariableByNameAndType('renamed', ''), stage.variables.g);
});

test('lookup matches a plain scan through random edits', () => {
    const random = makeRandom(11);
    const pick = list => list[Math.floor(random() * list.length)];
    const names = ['a', 'b', 'c', 'd', 'constructor', '__proto__', ''];
    const types = [Variable.SCALAR_TYPE, Variable.LIST_TYPE, Variable.BROADCAST_MESSAGE_TYPE];
    const {stage, sprite} = makeTargets();
    let nextId = 0;
    let found = 0;
    for (let round = 0; round < 4000; round++) {
        const target = pick([stage, sprite]);
        const ids = Object.keys(target.variables);
        const action = Math.floor(random() * 7);
        if (action === 0 && ids.length < 12) {
            target.createVariable(`id${nextId++}`, pick(names), pick(types));
        } else if (action === 1 && ids.length > 0) {
            target.renameVariable(pick(ids), pick(names));
        } else if (action === 2 && ids.length > 0) {
            target.deleteVariable(pick(ids));
        } else if (action === 3 && ids.length > 0) {
            delete target.variables[pick(ids)];
        } else if (action === 4 && ids.length > 0) {
            const id = pick(ids);
            target.variables[id] = new Variable(id, target.variables[id].name, target.variables[id].type, false);
        } else if (action === 5 && ids.length > 0 && random() < 0.2) {
            const copy = {};
            for (const id of ids.reverse()) copy[id] = target.variables[id];
            target.variables = copy;
        }
        for (let query = 0; query < 4; query++) {
            const name = pick(names);
            const type = pick(types);
            const skipStage = random() < 0.5;
            const expected = slowLookup(sprite, name, type, skipStage);
            assert.strictEqual(sprite.lookupVariableByNameAndType(name, type, skipStage), expected);
            if (expected) found++;
        }
    }
    assert.ok(found > 1000);
});
