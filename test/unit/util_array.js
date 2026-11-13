const {test} = require('node:test');
const assert = require('node:assert');
const ArrayUtil = require('../../src/util/array-util');

const numbered = length => Array.from({length}, (_, index) => index);

test('removeAt matches splice for every index', () => {
    for (const length of [1, 2, 5, 64, 65, 66, 200]) {
        for (let index = 0; index < length; index++) {
            const expected = numbered(length);
            expected.splice(index, 1);
            const actual = numbered(length);
            ArrayUtil.removeAt(actual, index);
            assert.deepStrictEqual(actual, expected, `length ${length} index ${index}`);
        }
    }
});

test('removeAt matches splice for an index that is not in the array', () => {
    for (const index of [-1, -3, 5, 9]) {
        const expected = numbered(5);
        expected.splice(index, 1);
        const actual = numbered(5);
        ArrayUtil.removeAt(actual, index);
        assert.deepStrictEqual(actual, expected, `index ${index}`);
    }
});

test('move matches removing and reinserting for every pair of indices', () => {
    for (const length of [1, 2, 5, 70, 140]) {
        for (let from = 0; from < length; from++) {
            for (let to = 0; to < length; to++) {
                const expected = numbered(length);
                expected.splice(to, 0, expected.splice(from, 1)[0]);
                const actual = numbered(length);
                ArrayUtil.move(actual, from, to);
                assert.deepStrictEqual(actual, expected, `length ${length} from ${from} to ${to}`);
            }
        }
    }
});

test('removeAt matches splice for an index that is not a whole number', () => {
    for (const index of [0.5, 1.5, 3.9, -0.5, NaN, Infinity, -Infinity]) {
        const expected = numbered(5);
        expected.splice(index, 1);
        const actual = numbered(5);
        ArrayUtil.removeAt(actual, index);
        assert.deepStrictEqual(actual, expected, `index ${index}`);
        assert.deepStrictEqual(Object.keys(actual), Object.keys(expected), `keys for index ${index}`);
    }
});

test('move matches removing and reinserting for a destination that is not a whole number in range', () => {
    for (const length of [1, 2, 5, 70]) {
        for (let from = 0; from < length; from++) {
            for (const to of [0.5, 1.5, 2.999, length - 0.5, length, length + 3, -1, -1.5, NaN, Infinity, -Infinity]) {
                const expected = numbered(length);
                expected.splice(to, 0, expected.splice(from, 1)[0]);
                const actual = numbered(length);
                ArrayUtil.move(actual, from, to);
                assert.deepStrictEqual(actual, expected, `length ${length} from ${from} to ${to}`);
                assert.deepStrictEqual(
                    Object.keys(actual),
                    Object.keys(expected),
                    `keys for length ${length} from ${from} to ${to}`
                );
            }
        }
    }
});
