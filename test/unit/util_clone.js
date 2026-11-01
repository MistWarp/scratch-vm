const {test} = require('node:test');
const assert = require('node:assert');
const Clone = require('../../src/util/clone');

const jsonCopy = value => JSON.parse(JSON.stringify(value));

const randomValue = depth => {
    const kinds = [
        () => (Math.random() * 100) - 50,
        () => [NaN, Infinity, -Infinity, -0, 0][Math.floor(Math.random() * 5)],
        () => `s${Math.random()}`,
        () => Math.random() < 0.5,
        () => null,
        () => undefined, // eslint-disable-line no-undefined
        () => () => {},
        () => new Date(0),
        () => {
            const array = Array.from({length: Math.floor(Math.random() * 4)}, () => randomValue(depth + 1));
            if (Math.random() < 0.2) array[array.length + 1] = 1; // leaves a hole
            return array;
        },
        () => {
            const object = {};
            for (let i = Math.floor(Math.random() * 4); i > 0; i--) object[`k${i}`] = randomValue(depth + 1);
            return object;
        }
    ];
    // Stop nesting past a few levels.
    const count = depth > 3 ? kinds.length - 2 : kinds.length;
    return kinds[Math.floor(Math.random() * count)]();
};

test('simple gives the same result as a JSON round trip', () => {
    for (let i = 0; i < 2000; i++) {
        const value = {root: randomValue(0)};
        assert.deepStrictEqual(Clone.simple(value), jsonCopy(value));
    }
});

test('simple copies plain data without sharing it', () => {
    const original = {pen: {color: 66.66, size: 1}, list: [1, 'a', true, null]};
    const copy = Clone.simple(original);
    assert.deepStrictEqual(copy, original);
    assert.notStrictEqual(copy.pen, original.pen);
    assert.notStrictEqual(copy.list, original.list);
});

test('simple follows JSON for values it does not copy itself', () => {
    // eslint-disable-next-line no-new-wrappers
    const boxed = {n: new Number(3), s: new String('x'), b: new Boolean(false)};
    assert.deepStrictEqual(Clone.simple(boxed), {n: 3, s: 'x', b: false});
    assert.strictEqual(Object.is(Clone.simple({a: -0}).a, 0), true);
    assert.deepStrictEqual(Clone.simple({a: NaN, b: [Infinity]}), {a: null, b: [null]});
    assert.deepStrictEqual(Clone.simple({d: new Date(0)}), {d: '1970-01-01T00:00:00.000Z'});
});

test('simple keeps an own __proto__ key as data', () => {
    const copy = Clone.simple(JSON.parse('{"__proto__": {"polluted": true}}'));
    assert.strictEqual(Object.getPrototypeOf(copy), Object.prototype);
    assert.deepStrictEqual(Object.keys(copy), ['__proto__']);
    assert.strictEqual(copy.polluted, undefined); // eslint-disable-line no-undefined
});

test('simple still rejects cycles like JSON does', () => {
    const cycle = {};
    cycle.self = cycle;
    assert.throws(() => Clone.simple(cycle), TypeError);
});
