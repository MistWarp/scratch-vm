const {test} = require('node:test');
const assert = require('node:assert');
const jsexecute = require('../../src/compiler/jsexecute');
const Variable = require('../../src/engine/variable');
const Scratch3DataBlocks = require('../../src/blocks/scratch3_data');
const {stringify} = require('@turbowarp/json');

const {listFind, listScan, listScanGeneric} = require('../../src/compiler/list-search');

const makeRandom = seed => {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
};

const ODD_VALUES = [
    0, -0, 1, -1, 16, 1000, 0.5, 1e21, NaN, Infinity, -Infinity,
    '0', '-0', '', ' ', '\t', '\n', '.', '1', '1.0', ' 1 ', '+1', '1e3', '1E3', '0x10', '0X10', '0b11', '0B11',
    'true', 'TRUE', 'false', 'nan', 'NaN', 'NAN', 'Infinity', 'INFINITY', 'infinity', '-Infinity', '-INFINITY',
    '+Infinity', 'apple', 'Apple', 'APPLE', 'apple ', 'x', 'X', 'İ', 'i̇', 'K', 'k', 'ÄPFEL', 'äpfel',
    ' 5', ' ', 'e', 'E5', '5e', 'undefined', 'null', '[object Object]',
    true, false
];
const UNINDEXABLE_VALUES = [null, undefined, {}, [], [5], ['a']];

const randomValue = (random, allowUnindexable) => {
    const roll = random();
    if (roll < 0.3) return ODD_VALUES[Math.floor(random() * ODD_VALUES.length)];
    if (roll < 0.6) return Math.floor(random() * 40);
    if (roll < 0.75) return String(Math.floor(random() * 40));
    if (roll < 0.85) return `item${Math.floor(random() * 20)}`;
    if (roll < 0.95) return `ITEM${Math.floor(random() * 20)}`;
    if (allowUnindexable && roll < 0.953) {
        return UNINDEXABLE_VALUES[Math.floor(random() * UNINDEXABLE_VALUES.length)];
    }
    return (random() * 40) - 20;
};

const expectFind = (list, item, context) => {
    const expected = listScanGeneric(list.value, item, 0);
    const actual = listFind(list, item);
    if (actual !== expected) {
        assert.fail(`${context}: searching ${stringify(item)} gave ${actual} instead of ${expected}`);
    }
};

test('scan matches the generic scan for every pair of values', () => {
    const values = ODD_VALUES.concat(UNINDEXABLE_VALUES);
    for (const item of values) {
        for (const value of values) {
            const array = ['unrelated', 7, value];
            const expected = listScanGeneric(array, item, 0);
            const actual = listScan(array, item, 0);
            if (actual !== expected) {
                assert.fail(`${stringify(item)} in [${stringify(value)}] gave ${actual} instead of ${expected}`);
            }
        }
    }
});

test('indexed search matches the generic scan for every pair of values', () => {
    for (const item of ODD_VALUES) {
        for (const value of ODD_VALUES) {
            const list = Variable.create(null, 'list', Variable.LIST_TYPE, false);
            for (let i = 0; i < 40; i++) list.value.push(`filler${i}`);
            list.value.push(value);
            for (let i = 0; i < 40; i++) expectFind(list, 'filler39', 'warm up');
            assert.ok(list._searchIndex.numbers, 'index was built');
            expectFind(list, item, `[${stringify(value)}]`);
        }
    }
});

const mutate = (random, list, allowUnindexable) => {
    const array = list.value;
    const roll = random();
    if (roll < 0.35) {
        array.push(randomValue(random, allowUnindexable));
        list._monitorUpToDate = list._monitorUpToDate > 1 ? 2 : false;
    } else if (roll < 0.55) {
        if (array.length === 0) return;
        array[Math.floor(random() * array.length)] = randomValue(random, allowUnindexable);
        list._monitorUpToDate = false;
    } else if (roll < 0.7) {
        array.splice(Math.floor(random() * (array.length + 1)), 0, randomValue(random, allowUnindexable));
        list._monitorUpToDate = false;
    } else if (roll < 0.85) {
        if (array.length === 0) return;
        array.splice(Math.floor(random() * array.length), 1);
        list._monitorUpToDate = false;
    } else if (roll < 0.88) {
        list.value = array.slice();
    } else if (roll < 0.9) {
        list.value = array.map(() => randomValue(random, allowUnindexable));
    } else if (roll < 0.93) {
        list.value = [];
    } else if (roll < 0.97) {
        array.pop();
        list._monitorUpToDate = false;
    } else {
        const state = list._monitorUpToDate;
        if (state !== true && state !== 3) list._monitorUpToDate = state === 2 ? 3 : true;
    }
};

const runRandomSession = (seed, allowUnindexable) => {
    const random = makeRandom(seed);
    const list = Variable.create(null, 'list', Variable.LIST_TYPE, false);
    const size = Math.floor(random() * 120);
    for (let i = 0; i < size; i++) list.value.push(randomValue(random, allowUnindexable));
    let indexedSearches = 0;
    for (let step = 0; step < 400; step++) {
        const searches = random() < 0.2 ? 40 : 1 + Math.floor(random() * 4);
        for (let i = 0; i < searches; i++) {
            const item = random() < 0.5 && list.value.length > 0 ?
                list.value[Math.floor(random() * list.value.length)] :
                randomValue(random, allowUnindexable);
            expectFind(list, item, `seed ${seed} step ${step}`);
            if (list._searchIndex && list._searchIndex.numbers) indexedSearches++;
        }
        const mutations = Math.floor(random() * 3);
        for (let i = 0; i < mutations; i++) mutate(random, list, allowUnindexable);
    }
    return indexedSearches;
};

test('search stays correct while the list changes', () => {
    let indexedSearches = 0;
    for (let seed = 1; seed <= 60; seed++) {
        indexedSearches += runRandomSession(seed, false);
    }
    assert.ok(indexedSearches > 1000, `only ${indexedSearches} searches used the index`);
});

test('search stays correct with values that cannot be indexed', () => {
    for (let seed = 100; seed <= 130; seed++) {
        runRandomSession(seed, true);
    }
});

test('appending keeps the index and other changes drop it', () => {
    const list = Variable.create(null, 'list', Variable.LIST_TYPE, false);
    for (let i = 0; i < 100; i++) list.value.push(i);
    for (let i = 0; i < 40; i++) expectFind(list, 99, 'warm up');
    const index = list._searchIndex;
    assert.ok(index.numbers);
    assert.strictEqual(list._monitorUpToDate, 2);

    list.value.push('new');
    list._monitorUpToDate = list._monitorUpToDate > 1 ? 2 : false;
    expectFind(list, 'NEW', 'after append');
    assert.ok(index.numbers);
    assert.strictEqual(index.indexed, 101);

    list.value[5] = 'changed';
    list._monitorUpToDate = false;
    expectFind(list, 5, 'after replace');
    assert.strictEqual(index.numbers, null);
    expectFind(list, 'changed', 'after replace');
});

test('the list monitor still sees changes while an index is alive', () => {
    const list = Variable.create(null, 'list', Variable.LIST_TYPE, false);
    for (let i = 0; i < 100; i++) list.value.push(i);
    const blocks = new Scratch3DataBlocks(null);
    const util = {
        target: {lookupOrCreateList: () => list},
        thread: {updateMonitor: true}
    };
    const args = {LIST: {id: list.id, name: list.name}};

    const first = blocks.getListContents(args, util);
    assert.notStrictEqual(first, list.value);
    assert.strictEqual(blocks.getListContents(args, util), list.value);

    for (let i = 0; i < 40; i++) expectFind(list, 99, 'warm up');
    assert.ok(list._searchIndex.numbers);
    assert.strictEqual(blocks.getListContents(args, util), list.value);

    list.value.push(100);
    list._monitorUpToDate = list._monitorUpToDate > 1 ? 2 : false;
    const afterAppend = blocks.getListContents(args, util);
    assert.notStrictEqual(afterAppend, list.value);
    assert.deepStrictEqual(afterAppend, list.value);
    assert.strictEqual(blocks.getListContents(args, util), list.value);
    expectFind(list, 100, 'after append');
    assert.ok(list._searchIndex.numbers);

    list.value[0] = 'zero';
    list._monitorUpToDate = false;
    assert.notStrictEqual(blocks.getListContents(args, util), list.value);
    expectFind(list, 0, 'after replace');
});

test('a list shortened in place without the flag drops the index', () => {
    const list = Variable.create(null, 'list', Variable.LIST_TYPE, false);
    for (let i = 0; i < 100; i++) list.value.push(i);
    for (let i = 0; i < 40; i++) expectFind(list, 99, 'warm up');
    assert.ok(list._searchIndex.numbers);
    list.value.length = 50;
    expectFind(list, 99, 'after truncation');
    expectFind(list, 49, 'after truncation');
});

test('contains matches the plain scan for short and long lists', () => {
    const {listContains, globalState} = jsexecute.scopedEval('({listContains, globalState})');
    const previousThread = globalState.thread;
    globalState.thread = {target: {runtime: {runtimeOptions: {caseSensitiveLists: false}}}};
    const random = makeRandom(21);
    let contained = 0;
    for (let round = 0; round < 600; round++) {
        const list = Variable.create(null, 'list', Variable.LIST_TYPE, false);
        const length = round % 3 === 0 ? 40 + Math.floor(random() * 30) : Math.floor(random() * 31);
        for (let i = 0; i < length; i++) list.value.push(randomValue(random, true));
        for (let query = 0; query < 30; query++) {
            const item = randomValue(random, true);
            const expected = listScanGeneric(list.value, item, 0) !== -1;
            assert.strictEqual(listContains(list, item), expected, `contains ${stringify(item)}`);
            if (expected) contained++;
        }
    }
    globalState.thread = previousThread;
    assert.ok(contained > 1000);
});

test('delete all drops the index', () => {
    const blocks = new Scratch3DataBlocks({});
    const list = Variable.create('id', 'list', Variable.LIST_TYPE, false);
    for (let i = 0; i < 100; i++) list.value.push(i);
    for (let i = 0; i < 40; i++) expectFind(list, 99, 'warm up');
    assert.ok(list._searchIndex.numbers);
    blocks.deleteAllOfList({LIST: {id: 'id', name: 'list'}}, {target: {lookupOrCreateList: () => list}});
    assert.strictEqual(list._searchIndex, null);
    assert.deepStrictEqual(list.value, []);
    expectFind(list, 99, 'after delete all');
});
