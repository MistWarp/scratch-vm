const {test} = require('node:test');
const assert = require('node:assert');
const uid = require('../../src/util/uid');

const SOUP = '!#%()*+,-./:;=?@[]^_`{|}~' +
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

test('uid returns 20 characters from the Blockly alphabet', () => {
    for (let i = 0; i < 2000; i++) {
        const id = uid();
        assert.strictEqual(id.length, 20);
        for (const character of id) assert.ok(SOUP.includes(character), `unexpected ${character}`);
    }
});

test('uid does not repeat and uses the whole alphabet in every position', () => {
    const seen = new Set();
    const used = Array.from({length: 20}, () => new Set());
    for (let i = 0; i < 20000; i++) {
        const id = uid();
        seen.add(id);
        for (let position = 0; position < 20; position++) used[position].add(id[position]);
    }
    assert.strictEqual(seen.size, 20000);
    for (let position = 0; position < 20; position++) {
        assert.strictEqual(used[position].size, SOUP.length, `position ${position}`);
    }
});

test('uid handles the smallest and largest random values', t => {
    t.mock.method(Math, 'random', () => 0);
    assert.strictEqual(uid(), SOUP[0].repeat(20));
    Math.random.mock.mockImplementation(() => 1 - Number.EPSILON);
    assert.strictEqual(uid(), SOUP[SOUP.length - 1].repeat(20));
});

test('uid draws one random number per character, so seeded projects keep their random sequence', t => {
    const random = t.mock.method(Math, 'random', () => 0.5);
    uid();
    assert.strictEqual(random.mock.callCount(), 20);
});

test('uid maps each random number to one character in the order drawn', t => {
    let seed = 12345;
    const next = () => {
        seed = ((seed * 1103515245) + 12345) % 2147483648;
        return seed / 2147483648;
    };
    const draws = [];
    t.mock.method(Math, 'random', () => {
        const value = next();
        draws.push(value);
        return value;
    });
    for (let i = 0; i < 50; i++) {
        draws.length = 0;
        const id = uid();
        assert.strictEqual(id, draws.map(value => SOUP[Math.floor(value * SOUP.length)]).join(''));
    }
});
