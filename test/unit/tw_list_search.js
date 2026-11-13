const {test} = require('node:test');
const assert = require('node:assert');
const jsexecute = require('../../src/compiler/jsexecute');
const Variable = require('../../src/engine/variable');
const Scratch3DataBlocks = require('../../src/blocks/scratch3_data');
const {stringify} = require('@turbowarp/json');

const VirtualMachine = require('../../src/virtual-machine');
const {listFind, listScan, listScanGeneric, listsMayHaveChanged} = require('../../src/compiler/list-search');

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
    globalState.thread = {target: {runtime: {runtimeOptions: {caseSensitiveLists: false}, targets: []}}};
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

const numbered = count => {
    const list = Variable.create(null, 'list', Variable.LIST_TYPE, false);
    for (let i = 0; i < count; i++) list.value.push(i);
    return list;
};

test('a list edited in place by other code is searched again', () => {
    const list = numbered(100);
    for (let i = 0; i < 40; i++) expectFind(list, 99, 'warm up');
    assert.ok(list._searchIndex.numbers);
    list._monitorUpToDate = 3;
    list.value[5] = 'zzz';
    listsMayHaveChanged();
    assert.strictEqual(listFind(list, 'zzz'), 5);
    assert.strictEqual(list._monitorUpToDate, 2, 'the monitor is told the list changed');
    assert.strictEqual(listFind(list, 5), -1);
    list.value.splice(0, 0, 'first');
    listsMayHaveChanged();
    assert.strictEqual(listFind(list, 'first'), 0);
    assert.strictEqual(listFind(list, 'zzz'), 6);
    list.value[7] = NaN;
    listsMayHaveChanged();
    assert.strictEqual(listFind(list, 'NaN'), 7);
});

test('an unchanged list keeps its index after other code has run', () => {
    const list = numbered(100);
    list.value[3] = NaN;
    for (let i = 0; i < 40; i++) expectFind(list, 99, 'warm up');
    const numbers = list._searchIndex.numbers;
    assert.ok(numbers);
    for (let round = 0; round < 200; round++) {
        listsMayHaveChanged();
        for (let i = 0; i < 5; i++) expectFind(list, 98 - i, 'after other code');
    }
    assert.strictEqual(list._searchIndex.numbers, numbers);
});

test('an index that costs more to check than it saves is dropped', () => {
    const list = numbered(100);
    for (let i = 0; i < 40; i++) expectFind(list, 99, 'warm up');
    assert.ok(list._searchIndex.numbers);
    let rounds = 0;
    while (list._searchIndex.numbers && rounds < 5000) {
        listsMayHaveChanged();
        expectFind(list, 0, 'cheap search');
        rounds++;
    }
    assert.ok(rounds < 5000, 'the index was never dropped');
    expectFind(list, 0, 'after the index was dropped');
});

test('two lists that share one array are searched without an index', () => {
    const first = numbered(100);
    const second = Variable.create(null, 'other', Variable.LIST_TYPE, false);
    const thread = {target: {runtime: {targets: [{variables: {first, second, plain: {type: '', value: 0}}}]}}};
    for (let i = 0; i < 40; i++) assert.strictEqual(listFind(first, 99, thread), 99);
    assert.ok(first._searchIndex.numbers);

    second.value = first.value;
    listsMayHaveChanged();
    assert.strictEqual(listFind(first, 99, thread), 99);
    assert.strictEqual(first._searchIndex.numbers, null);
    second.value[5] = 'zzz';
    second._monitorUpToDate = false;
    assert.strictEqual(listFind(first, 'zzz', thread), 5);
    assert.strictEqual(listFind(first, 5, thread), -1);
    for (let i = 0; i < 200; i++) assert.strictEqual(listFind(first, 99, thread), 99);
    assert.strictEqual(first._searchIndex.numbers, null);
    second.value.splice(0, 0, 'front');
    second._monitorUpToDate = false;
    assert.strictEqual(listFind(first, 'front', thread), 0);
    assert.strictEqual(listFind(first, 99, thread), 100);
});

test('a search between calls to other code does not build an index it cannot keep', () => {
    const list = numbered(2000);
    for (let i = 0; i < 400; i++) {
        listsMayHaveChanged();
        assert.strictEqual(listFind(list, 1999), 1999);
    }
    assert.strictEqual(list._searchIndex.numbers, null);
    for (let i = 0; i < 400; i++) assert.strictEqual(listFind(list, 1999), 1999);
    assert.ok(list._searchIndex.numbers, 'searches without other code in between build the index');
});

test('compiled delete all drops the index', () => {
    const listDelete = jsexecute.scopedEval('listDelete');
    const list = numbered(100);
    for (let i = 0; i < 40; i++) expectFind(list, 99, 'warm up');
    assert.ok(list._searchIndex.numbers);
    listDelete(list, 'all');
    assert.strictEqual(list._searchIndex, null);
    assert.deepStrictEqual(list.value, []);
});

const EDIT = 'stage.variables.L.value[5] = "zzz"';

class Editor {
    getInfo () {
        return {
            id: 'editor',
            name: 'Editor',
            blocks: [
                {opcode: 'edit', blockType: 'command', text: 'edit', arguments: {}, compFunc: 'compileEdit'},
                {opcode: 'edited', blockType: 'reporter', text: 'edited', arguments: {},
                    compFunc: 'compileEdited'},
                {opcode: 'twice', blockType: 'loop', text: 'twice', arguments: {}, compFunc: 'compileTwice'},
                {opcode: 'never', blockType: 'conditional', text: 'never', arguments: {},
                    compFunc: 'compileEdit'},
                {opcode: 'around', blockType: 'command', text: 'around [FIND]',
                    arguments: {FIND: {type: 'string'}}, compFunc: 'compileAround'}
            ]
        };
    }
    compileEdit () {
        return `${EDIT};`;
    }
    compileEdited () {
        return `(${EDIT})`;
    }
    compileTwice (args, {branch}) {
        return `for (let pass = 0; pass < 2; pass++) {\nif (pass) ${EDIT};\n${branch(1)}}`;
    }
    compileAround (args) {
        return `stage.variables.before.value = ${args.FIND};\n${EDIT};\n` +
            `stage.variables.before.value = ${args.FIND};`;
    }
    edit () {}
    edited () {
        return '';
    }
    twice () {}
    never () {}
    around () {}
}

const useEditor = vm => {
    vm.extensionManager.addBuiltinExtension('editor', Editor);
    return () => {};
};

const useOldCompiler = vm => {
    const compatibility = require('../../src/compiler/old-compiler-compatibility');
    const {ScriptTreeGenerator, JSGenerator} = vm.exports.i_will_not_ask_for_help_when_these_break();
    const {Frame} = JSGenerator.unstable_exports;
    const tree = ScriptTreeGenerator.prototype;
    const generator = JSGenerator.prototype;
    const original = {
        treeStack: tree.descendStackedBlock,
        treeInput: tree.descendInput,
        stack: generator.descendStackedBlock,
        input: generator.descendInput
    };
    tree.descendStackedBlock = function (block) {
        if (block.opcode === 'sensing_oldedit') return {kind: 'test.edit'};
        if (block.opcode === 'sensing_oldtwice') {
            return {kind: 'test.twice', body: this.descendSubstack(block, 'SUBSTACK')};
        }
        if (block.opcode === 'sensing_oldaround') {
            return {kind: 'test.around', find: this.descendInputOfBlock(block, 'FIND')};
        }
        return original.treeStack.call(this, block);
    };
    tree.descendInput = function (block) {
        if (block.opcode === 'sensing_oldedited') return {kind: 'test.edited'};
        return original.treeInput.call(this, block);
    };
    generator.descendStackedBlock = function (node) {
        if (node.kind === 'test.edit') {
            this.source += `${EDIT};\n`;
        } else if (node.kind === 'test.twice') {
            this.source += `for (let pass = 0; pass < 2; pass++) {\nif (pass) ${EDIT};\n`;
            this.descendStack(node.body, new Frame(false));
            this.source += '}\n';
        } else if (node.kind === 'test.around') {
            this.source += `stage.variables.before.value = ${this.descendInput(node.find).asUnknown()};\n`;
            this.source += `${EDIT};\n`;
            this.source += `stage.variables.before.value = ${this.descendInput(node.find).asUnknown()};\n`;
        } else {
            original.stack.call(this, node);
        }
    };
    generator.descendInput = function (node) {
        if (node.kind === 'test.edited') return new JSGenerator.unstable_exports.TypedInput(`(${EDIT})`, 2);
        return original.input.call(this, node);
    };
    return () => {
        tree.descendStackedBlock = original.treeStack;
        tree.descendInput = original.treeInput;
        generator.descendStackedBlock = original.stack;
        generator.descendInput = original.input;
        compatibility.enabled = false;
    };
};

const POKES = {
    'a compatibility layer block': {
        block: {opcode: 'sensing_testpoke'},
        install: (vm, poke) => {
            vm.runtime._primitives.sensing_testpoke = poke;
        }
    },
    'an addon block': {
        block: {opcode: 'procedures_call', mutation: {tagName: 'mutation', children: [], proccode: 'poke',
            argumentids: '[]', warp: 'false'}},
        install: (vm, poke) => {
            vm.runtime.addAddonBlock({procedureCode: 'poke', arguments: [], callback: poke, hidden: true});
        }
    },
    'an addon block that never yields': {
        block: {opcode: 'procedures_call', mutation: {tagName: 'mutation', children: [], proccode: 'poke',
            argumentids: '[]', warp: 'false'}},
        install: (vm, poke) => {
            vm.runtime.addAddonBlock({procedureCode: 'poke', arguments: [], callback: poke, hidden: true,
                yields: false});
        }
    },
    'a raw patch': {
        block: {opcode: 'mistsutils_patchcommand', inputs: {A: [1, [10, 'stage.variables.L.value[5] = "zzz";']]}},
        prepare: vm => {
            vm.securityManager.canLoadExtensionFromProject = () => true;
        },
        install: () => {}
    },
    'a listener for an event a block fires': {
        block: {opcode: 'looks_say', inputs: {MESSAGE: [1, [10, 'hi']]}},
        install: (vm, poke) => {
            vm.runtime.on('SAY', poke);
        }
    },
    'code that runs between two rounds of stepping': {
        block: {opcode: 'control_wait', inputs: {DURATION: [1, [5, '0']]}, next: 'again'},
        install: () => {},
        betweenSteps: true
    },
    'the source an extension compiles for a command': {
        block: {opcode: 'editor_edit'},
        prepare: useEditor,
        install: () => {}
    },
    'the source an extension compiles for a reporter': {
        block: {opcode: 'data_setvariableto', inputs: {VALUE: [3, 'edited', [10, '']]},
            fields: {VARIABLE: ['old', 'old']}},
        extra: ({add}) => add('edited', {opcode: 'editor_edited'}),
        prepare: useEditor,
        install: () => {}
    },
    'the source an extension compiles around its branch': {
        block: {opcode: 'editor_twice', inputs: {SUBSTACK: [2, 'inside']}},
        extra: ({set, itemNumber}) => set('inside', 'before', itemNumber('insideFind', 'zzz')),
        prepare: useEditor,
        install: () => {},
        before: '6'
    },
    'the source an extension compiles for a block with no branch': {
        block: {opcode: 'editor_never'},
        prepare: useEditor,
        install: () => {}
    },
    'the source an extension compiles around its input': {
        block: {opcode: 'editor_around', inputs: {FIND: [3, 'aroundFind', [10, '']]}},
        extra: ({itemNumber}) => itemNumber('aroundFind', 'zzz'),
        prepare: useEditor,
        install: () => {},
        before: '6'
    },
    'a command compiled through the old compiler API': {
        block: {opcode: 'sensing_oldedit'},
        prepare: useOldCompiler,
        install: () => {}
    },
    'a reporter compiled through the old compiler API': {
        block: {opcode: 'data_setvariableto', inputs: {VALUE: [3, 'edited', [10, '']]},
            fields: {VARIABLE: ['old', 'old']}},
        extra: ({add}) => add('edited', {opcode: 'sensing_oldedited'}),
        prepare: useOldCompiler,
        install: () => {}
    },
    'old compiler API source around its branch': {
        block: {opcode: 'sensing_oldtwice', inputs: {SUBSTACK: [2, 'inside']}},
        extra: ({set, itemNumber}) => set('inside', 'before', itemNumber('insideFind', 'zzz')),
        prepare: useOldCompiler,
        install: () => {},
        before: '6'
    },
    'old compiler API source around its input': {
        block: {opcode: 'sensing_oldaround', inputs: {FIND: [3, 'aroundFind', [10, '']]}},
        extra: ({itemNumber}) => itemNumber('aroundFind', 'zzz'),
        prepare: useOldCompiler,
        install: () => {},
        before: '6'
    }
};

const searchProject = (pokeBlock, extra, extensions) => {
    const blocks = {};
    const add = (id, block) => {
        blocks[id] = Object.assign({next: null, parent: null, inputs: {}, fields: {}, shadow: false,
            topLevel: false}, block);
        return id;
    };
    const itemNumber = (id, item) => add(id, {opcode: 'data_itemnumoflist', inputs: {ITEM: [1, [10, item]]},
        fields: {LIST: ['L', 'L']}});
    const set = (id, name, reporter) => add(id, {opcode: 'data_setvariableto',
        inputs: {VALUE: [3, reporter, [10, '']]}, fields: {VARIABLE: [name, name]}});
    add('flag', {opcode: 'event_whenflagclicked', topLevel: true, x: 0, y: 0, next: 'warm'});
    add('warm', {opcode: 'control_repeat', inputs: {TIMES: [1, [6, '40']], SUBSTACK: [2, 'warmSet']},
        next: 'poke'});
    set('warmSet', 'before', itemNumber('warmFind', 'zzz'));
    add('poke', Object.assign({next: 'afterNew'}, pokeBlock));
    if (extra) extra({add, set, itemNumber});
    set('again', 'before', itemNumber('findAgain', 'zzz'));
    blocks.again.next = 'pause';
    add('pause', {opcode: 'control_wait', inputs: {DURATION: [1, [5, '0']]}, next: 'afterNew'});
    set('afterNew', 'new', itemNumber('findNew', 'zzz'));
    blocks.afterNew.next = 'afterOld';
    set('afterOld', 'old', itemNumber('findOld', '5'));
    const items = [];
    for (let i = 0; i < 100; i++) items.push(i);
    return {
        targets: [
            {isStage: true, name: 'Stage', broadcasts: {}, blocks: {}, comments: {}, currentCostume: 0,
                costumes: [], sounds: [], volume: 100, layerOrder: 0,
                variables: {before: ['before', 0], new: ['new', 0], old: ['old', 0]}, lists: {L: ['L', items]}},
            {isStage: false, name: 'Sprite', broadcasts: {}, blocks, comments: {}, currentCostume: 0,
                costumes: [], sounds: [], volume: 100, layerOrder: 1, visible: true, x: 0, y: 0, size: 100,
                direction: 90, draggable: false, rotationStyle: 'all around', variables: {}, lists: {}}
        ],
        monitors: [],
        extensions: extensions || [],
        meta: {semver: '3.0.0', vm: '3.0.0', agent: ''}
    };
};

for (const [name, poke] of Object.entries(POKES)) {
    test(`a list edited in place by ${name} is searched again`, async () => {
        const vm = new VirtualMachine();
        vm.setCompilerOptions({enabled: true});
        const restore = poke.prepare ? poke.prepare(vm) : null;
        await vm.loadProject(searchProject(poke.block, poke.extra,
            poke.prepare === useEditor ? ['editor'] : []));
        const stage = vm.runtime.getTargetForStage();
        const list = stage.variables.L;
        const edit = () => {
            list.value[5] = 'zzz';
        };
        poke.install(vm, edit);
        vm.setTurboMode(!poke.betweenSteps);
        vm.greenFlag();
        if (poke.betweenSteps) {
            const stepThreads = () => {
                vm.runtime.redrawRequested = false;
                vm.runtime.sequencer.stepThreads();
            };
            vm.runtime._step();
            stepThreads();
            assert.strictEqual(vm.runtime.threads.length, 1, 'the script is waiting');
            assert.ok(list._searchIndex && list._searchIndex.numbers, 'the index was built before the edit');
            edit();
            for (let step = 0; step < 50 && vm.runtime.threads.length; step++) stepThreads();
        } else {
            for (let step = 0; step < 50 && vm.runtime.threads.length; step++) vm.runtime._step();
        }
        assert.strictEqual(vm.runtime.threads.length, 0);
        assert.ok(vm.runtime.threads.length === 0 && list._searchIndex, 'the search never used the index path');
        if (restore) restore();
        assert.strictEqual(String(stage.variables.before.value), poke.before || '0');
        assert.strictEqual(String(stage.variables.new.value), '6');
        assert.strictEqual(String(stage.variables.old.value), '0');

        list.value[9] = 'between';
        assert.strictEqual(vm.setVariableValue(stage.id, 'L', list.value), true);
        assert.strictEqual(list._searchIndex, null);
        assert.strictEqual(list._monitorUpToDate, false);
        vm.quit();
    });
}
