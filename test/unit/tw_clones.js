const Runtime = require('../../src/engine/runtime');
const Sprite = require('../../src/sprites/sprite');
const Sound = require('../../src/blocks/scratch3_sound');
const Looks = require('../../src/blocks/scratch3_looks');

const {test} = require('node:test');
const assert = require('node:assert');

test('clone counter', () => {
    const rt = new Runtime();
    const sprite = new Sprite(null, rt);
    const original = sprite.createClone();
    assert.strictEqual(rt._cloneCounter, 0);
    const clone = original.makeClone();
    assert.strictEqual(rt._cloneCounter, 1);
    clone.dispose();
    assert.strictEqual(rt._cloneCounter, 0);
    original.dispose();
    assert.strictEqual(rt._cloneCounter, 0);
});

const jsonCopy = value => JSON.parse(JSON.stringify(value));

const NO_EFFECTS = {color: 0, fisheye: 0, whirl: 0, pixelate: 0, mosaic: 0, brightness: 0, ghost: 0};

test('a clone copies graphic effects the way a JSON round trip does', () => {
    const rt = new Runtime();
    const original = new Sprite(null, rt).createClone();
    const changes = [
        {},
        {ghost: 50, color: -20.5},
        {ghost: NaN},
        {color: Infinity},
        {whirl: -0},
        {mosaic: '3'},
        {pixelate: null},
        {fisheye: undefined}, // eslint-disable-line no-undefined
        {extra: 1},
        {brightness: {nested: [1, 2]}}
    ];
    for (const change of changes) {
        original.effects = Object.assign({}, NO_EFFECTS, change);
        const clone = original.makeClone();
        assert.deepStrictEqual(clone.effects, jsonCopy(original.effects));
        assert.deepStrictEqual(Object.keys(clone.effects), Object.keys(jsonCopy(original.effects)));
        assert.notStrictEqual(clone.effects, original.effects);
        clone.dispose();
    }

    original.effects = Object.assign(Object.create({inherited: 1}), NO_EFFECTS);
    assert.deepStrictEqual(original.makeClone().effects, NO_EFFECTS);
});

test('a clone copies sound state the way a JSON round trip does', () => {
    const rt = new Runtime();
    const sound = new Sound(rt);
    const original = new Sprite(null, rt).createClone();
    const states = [
        {effects: {pitch: 0, pan: 0}},
        {effects: {pitch: 120, pan: -100}},
        {effects: {pitch: NaN, pan: 0}},
        {effects: {pitch: 0, pan: -0}},
        {effects: {pitch: '10', pan: 0}},
        {effects: {pitch: 0}},
        {effects: {pitch: 0, pan: 0, extra: 1}},
        {effects: {pitch: 0, pan: 0}, volume: 50},
        {effects: null},
        {}
    ];
    for (const state of states) {
        original.setCustomState(Sound.STATE_KEY, state);
        const clone = original.makeClone();
        sound._onTargetCreated(clone, original);
        const copy = clone.getCustomState(Sound.STATE_KEY);
        assert.deepStrictEqual(copy, jsonCopy(state));
        assert.notStrictEqual(copy, state);
        if (state.effects) assert.notStrictEqual(copy.effects, state.effects);
        clone.dispose();
    }
});

test('a removed target without a speech bubble gets no bubble state', () => {
    const rt = new Runtime();
    const looks = new Looks(rt);
    const original = new Sprite(null, rt).createClone();
    const destroyed = [];
    rt.renderer = {
        destroyDrawable: id => destroyed.push(`drawable ${id}`),
        destroySkin: id => destroyed.push(`skin ${id}`)
    };

    looks._onTargetWillExit(original);
    assert.strictEqual(typeof original.getCustomState(Looks.STATE_KEY), 'undefined');
    assert.deepStrictEqual(destroyed, []);

    const bubble = looks._getBubbleState(original);
    bubble.drawableId = 7;
    bubble.skinId = 9;
    looks._onTargetWillExit(original);
    assert.deepStrictEqual(destroyed, ['drawable 7', 'skin 9']);
    assert.strictEqual(bubble.drawableId, null);
    assert.strictEqual(bubble.skinId, null);
});
