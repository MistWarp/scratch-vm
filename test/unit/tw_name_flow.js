const {test} = require('node:test');
const assert = require('node:assert');
const VirtualMachine = require('../../src/virtual-machine');
const {namesReachingLookups} = require('../../src/compiler/name-flow');

const ASSET = 'cd21514d0531fdffb22204e0ec5ed84a';

const costume = name => ({
    name,
    dataFormat: 'svg',
    assetId: ASSET,
    md5ext: `${ASSET}.svg`,
    rotationCenterX: 0,
    rotationCenterY: 0
});

const block = (opcode, inputs = {}, fields = {}, extra = {}) => Object.assign({
    opcode,
    next: null,
    parent: null,
    inputs,
    fields,
    shadow: false,
    topLevel: false
}, extra);

const text = value => [1, [10, String(value)]];
const variable = name => [3, [12, name, name], [10, '']];
const reporter = id => [3, id, [10, '']];
const variableField = name => ({VARIABLE: [name, name]});
const listField = name => ({LIST: [name, name]});

const setTo = (name, value) => block('data_setvariableto', {VALUE: value}, variableField(name));
const setById = (id, name, value) => block('data_setvariableto', {VALUE: value}, {VARIABLE: [name, id]});
const readById = (id, name) => [3, [12, name, id], [10, '']];
const addTo = (name, value) => block('data_addtolist', {ITEM: value}, listField(name));
const switchCostume = value => block('looks_switchcostumeto', {COSTUME: value});
const loose = (opcode, inputs, fields, extra) => block(opcode, inputs, fields, Object.assign({
    topLevel: true,
    x: 0,
    y: 0
}, extra));

const stack = (blocks, ...ids) => {
    for (let i = 0; i < ids.length; i++) {
        blocks[ids[i]].next = ids[i + 1] || null;
        blocks[ids[i]].parent = ids[i - 1] || null;
    }
    blocks[ids[0]].topLevel = true;
    blocks[ids[0]].x = 0;
    blocks[ids[0]].y = 0;
    return blocks;
};

const procedure = (blocks, prefix, code, parameter) => {
    const argumentId = `${prefix}Argument`;
    blocks[`${prefix}Definition`] = block('procedures_definition', {custom_block: [1, `${prefix}Prototype`]});
    blocks[`${prefix}Prototype`] = block('procedures_prototype', parameter ? {
        [argumentId]: [1, `${prefix}Parameter`]
    } : {}, {}, {
        shadow: true,
        parent: `${prefix}Definition`,
        mutation: {
            tagName: 'mutation',
            children: [],
            proccode: code,
            argumentids: JSON.stringify(parameter ? [argumentId] : []),
            argumentnames: JSON.stringify(parameter ? [parameter] : []),
            argumentdefaults: JSON.stringify(parameter ? [''] : []),
            warp: 'false'
        }
    });
    if (parameter) {
        blocks[`${prefix}Parameter`] = block('argument_reporter_string_number', {}, {VALUE: [parameter, null]}, {
            shadow: true,
            parent: `${prefix}Prototype`
        });
    }
};

const call = (prefix, code, value) => block('procedures_call', value ? {[`${prefix}Argument`]: value} : {}, {}, {
    mutation: {
        tagName: 'mutation',
        children: [],
        proccode: code,
        argumentids: JSON.stringify(value ? [`${prefix}Argument`] : []),
        warp: 'false'
    }
});

const argument = name => block('argument_reporter_string_number', {}, {VALUE: [name, null]});

const makeTarget = (name, options) => {
    const variables = {};
    for (const entry of options.variables || []) {
        const [id, variableName] = Array.isArray(entry) ? entry : [entry, entry];
        variables[id] = [variableName, 0];
    }
    for (const variableName of options.cloudVariables || []) variables[variableName] = [variableName, 0, true];
    const lists = {};
    for (const listName of options.lists || []) lists[listName] = [listName, []];
    const target = {
        isStage: !!options.isStage,
        name,
        variables,
        lists,
        broadcasts: {},
        blocks: options.blocks || {},
        comments: {},
        currentCostume: options.currentCostume || 0,
        costumes: (options.costumes || ['plain']).map(costume),
        sounds: [],
        volume: 100,
        layerOrder: options.layerOrder || 0
    };
    if (!options.isStage) {
        Object.assign(target, {
            visible: true,
            x: 0,
            y: 0,
            size: 100,
            direction: 90,
            draggable: false,
            rotationStyle: 'all around'
        });
    }
    return target;
};

const makeProject = (stage, ...sprites) => ({
    targets: [
        makeTarget('Stage', Object.assign({isStage: true}, stage)),
        ...sprites.map((sprite, index) => makeTarget(sprite.name, Object.assign({layerOrder: index + 1}, sprite)))
    ],
    monitors: [],
    extensions: [],
    meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
});

const load = async project => {
    const vm = new VirtualMachine();
    vm.setCompilerOptions({enabled: true});
    vm.runtime.start = () => {};
    await vm.loadProject(project);
    return vm;
};

const run = vm => {
    vm.greenFlag();
    for (let i = 0; i < 5; i++) vm.runtime._step();
};

const targetNamed = (vm, name) => vm.runtime.targets.find(target => target.getName() === name);

const valueOf = (vm, targetName, variableName) => {
    const target = targetNamed(vm, targetName);
    return Object.values(target.variables).find(candidate => candidate.name === variableName).value;
};

const NUMBERED = ['2', '1', 'plain'];

test('whole number constants are stored as numbers unless they can reach a name lookup', async () => {
    const vm = await load(makeProject({variables: ['free', 'used', 'copy'], lists: ['freeList', 'usedList']}, {
        name: 'Sprite',
        costumes: NUMBERED,
        currentCostume: 2,
        blocks: stack({
            hat: block('event_whenflagclicked'),
            setFree: setTo('free', text(2)),
            setUsed: setTo('used', text(2)),
            addFree: addTo('freeList', text(1)),
            addUsed: addTo('usedList', text(1)),
            switchUsed: switchCostume(variable('used')),
            setCopy: setTo('copy', reporter('firstUsed')),
            firstUsed: block('data_itemoflist', {INDEX: [1, [7, '1']]}, listField('usedList'), {parent: 'setCopy'}),
            switchBackdrop: block('looks_switchbackdropto', {BACKDROP: variable('copy')})
        }, 'hat', 'setFree', 'setUsed', 'addFree', 'addUsed', 'switchUsed', 'setCopy', 'switchBackdrop')
    }));
    run(vm);

    assert.strictEqual(valueOf(vm, 'Stage', 'free'), 2);
    assert.strictEqual(valueOf(vm, 'Stage', 'used'), '2');
    assert.deepStrictEqual(valueOf(vm, 'Stage', 'freeList'), [1]);
    assert.deepStrictEqual(valueOf(vm, 'Stage', 'usedList'), ['1']);
    assert.strictEqual(valueOf(vm, 'Stage', 'copy'), '1');
    assert.strictEqual(targetNamed(vm, 'Sprite').currentCostume, 0, 'costume picked by name, not by index');
});

test('names that are not whole numbers keep the TurboWarp rule', async () => {
    const vm = await load(makeProject({variables: ['half', 'padded', 'word', 'whole']}, {
        name: 'Sprite',
        costumes: ['1.5', '007', 'word', '7'],
        blocks: stack({
            hat: block('event_whenflagclicked'),
            setHalf: setTo('half', text('1.5')),
            setPadded: setTo('padded', text('007')),
            setWord: setTo('word', text('word')),
            setWhole: setTo('whole', text('7'))
        }, 'hat', 'setHalf', 'setPadded', 'setWord', 'setWhole')
    }));
    run(vm);

    assert.strictEqual(valueOf(vm, 'Stage', 'half'), '1.5');
    assert.strictEqual(valueOf(vm, 'Stage', 'padded'), '007');
    assert.strictEqual(valueOf(vm, 'Stage', 'word'), 'word');
    assert.strictEqual(valueOf(vm, 'Stage', 'whole'), 7);
});

test('projects without whole number names preserve every costume name', async () => {
    const vm = await load(makeProject({variables: ['half']}, {
        name: 'Sprite',
        costumes: ['1.5'],
        blocks: stack({
            hat: block('event_whenflagclicked'),
            setHalf: setTo('half', text('1.5'))
        }, 'hat', 'setHalf')
    }));
    run(vm);

    assert.strictEqual(valueOf(vm, 'Stage', 'half'), '1.5');
});

test('custom block arguments stay strings only when that block passes them to a lookup', async () => {
    const blocks = {
        hat: block('event_whenflagclicked'),
        callShow: call('show', 'show %s', text(2)),
        callKeep: call('keep', 'keep %s', text(2)),
        showSwitch: switchCostume(reporter('showUse')),
        showUse: argument('value'),
        showSet: setTo('shown', reporter('showUseAgain')),
        showUseAgain: argument('value'),
        keepSet: setTo('kept', reporter('keepUse')),
        keepUse: argument('value')
    };
    procedure(blocks, 'show', 'show %s', 'value');
    procedure(blocks, 'keep', 'keep %s', 'value');
    stack(blocks, 'hat', 'callShow', 'callKeep');
    stack(blocks, 'showDefinition', 'showSwitch', 'showSet');
    stack(blocks, 'keepDefinition', 'keepSet');

    const vm = await load(makeProject({variables: ['shown', 'kept']}, {
        name: 'Sprite',
        costumes: NUMBERED,
        currentCostume: 2,
        blocks
    }));
    run(vm);

    assert.strictEqual(valueOf(vm, 'Stage', 'shown'), '2');
    assert.strictEqual(valueOf(vm, 'Stage', 'kept'), 2);
    assert.strictEqual(targetNamed(vm, 'Sprite').currentCostume, 0);
});

test('cloud variables keep strings', async () => {
    const vm = await load(makeProject({cloudVariables: ['☁ score'], variables: ['local']}, {
        name: 'Sprite',
        costumes: NUMBERED,
        blocks: stack({
            hat: block('event_whenflagclicked'),
            setCloud: setTo('☁ score', text(2)),
            setLocal: setTo('local', text(2))
        }, 'hat', 'setCloud', 'setLocal')
    }));
    run(vm);

    assert.strictEqual(valueOf(vm, 'Stage', '☁ score'), '2');
    assert.strictEqual(valueOf(vm, 'Stage', 'local'), 2);
});

test('the analysis follows every way a value can travel to a lookup', async () => {
    const blocks = {
        key: loose('sensing_keypressed', {KEY_OPTION: variable('key name')}),
        sound: loose('sound_play', {SOUND_MENU: variable('sound name')}),
        backdrop: loose('looks_switchbackdroptoandwait', {BACKDROP: reporter('backdropItem')}),
        backdropItem: block('data_itemoflist', {INDEX: [1, [7, '1']]}, listField('backdrops'), {parent: 'backdrop'}),
        addMiddle: loose('data_addtolist', {ITEM: variable('middle')}, listField('backdrops')),
        setMiddle: loose('data_setvariableto', {VALUE: variable('origin')}, variableField('middle')),
        insertHead: loose('data_insertatlist', {INDEX: [1, [7, '1']], ITEM: variable('head')}, listField('backdrops')),
        replaceTail: loose('data_replaceitemoflist', {
            INDEX: [1, [7, '1']],
            ITEM: variable('tail')
        }, listField('backdrops')),
        remote: loose('looks_switchcostumeto', {COSTUME: reporter('remoteRead')}),
        remoteRead: block('sensing_of', {OBJECT: text('Other')}, {PROPERTY: ['remote score', null]}, {
            parent: 'remote'
        }),
        result: loose('looks_switchcostumeto', {COSTUME: variable('got')}),
        setGot: loose('data_setvariableto', {VALUE: reporter('giveCall')}, variableField('got')),
        giveCall: call('give', 'give'),
        giveReturn: block('procedures_return', {VALUE: variable('returned')}),
        setFree: loose('data_setvariableto', {VALUE: variable('other free')}, variableField('free')),
        sayFree: loose('looks_say', {MESSAGE: variable('said')}),
        joined: loose('looks_switchcostumeto', {COSTUME: reporter('join')}),
        join: block('operator_join', {STRING1: variable('joined part'), STRING2: text('')}, {}, {parent: 'joined'})
    };
    blocks.giveCall.parent = 'setGot';
    procedure(blocks, 'give', 'give', null);
    stack(blocks, 'giveDefinition', 'giveReturn');

    const names = [
        'key name', 'sound name', 'middle', 'origin', 'head', 'tail', 'got', 'returned', 'free', 'other free',
        'said', 'joined part', 'extension input', 'extension field'
    ];
    const vm = await load(makeProject({variables: names, lists: ['backdrops']}, {
        name: 'Sprite',
        costumes: NUMBERED,
        blocks
    }, {
        name: 'Other',
        variables: ['remote score']
    }));

    const sprite = targetNamed(vm, 'Sprite');
    sprite.blocks.createBlock({
        id: 'extension',
        opcode: 'someextension_block',
        next: null,
        parent: null,
        topLevel: true,
        shadow: false,
        x: 0,
        y: 0,
        inputs: {
            A: {name: 'A', block: 'extensionInput', shadow: null},
            B: {name: 'B', block: 'extensionText', shadow: 'extensionText'}
        },
        fields: {
            F: {name: 'F', value: 'extension field'}
        }
    });
    sprite.blocks.createBlock({
        id: 'extensionInput',
        opcode: 'data_variable',
        next: null,
        parent: 'extension',
        topLevel: false,
        shadow: false,
        inputs: {},
        fields: {
            VARIABLE: {name: 'VARIABLE', id: 'extension input', value: 'extension input', variableType: ''}
        }
    });
    sprite.blocks.createBlock({
        id: 'extensionText',
        opcode: 'text',
        next: null,
        parent: 'extension',
        topLevel: false,
        shadow: true,
        inputs: {},
        fields: {
            TEXT: {name: 'TEXT', value: 'named in text'}
        }
    });

    const reached = Array.from(namesReachingLookups(vm.runtime)).sort();
    assert.deepStrictEqual(reached, [
        'i:backdrops',
        'i:extension input',
        'i:got',
        'i:head',
        'i:key name',
        'i:middle',
        'i:origin',
        'i:returned',
        'i:sound name',
        'i:tail',
        'n:extension field',
        'n:named in text',
        'n:remote score',
        'r:give'
    ]);
});

test('variables that share a name in different sprites are tracked separately', async () => {
    const vm = await load(makeProject({}, {
        name: 'Looks',
        costumes: NUMBERED,
        currentCostume: 2,
        variables: [['looksTemp', 'temp']],
        blocks: stack({
            hat: block('event_whenflagclicked'),
            set: setById('looksTemp', 'temp', text(2)),
            show: switchCostume(readById('looksTemp', 'temp'))
        }, 'hat', 'set', 'show')
    }, {
        name: 'Maths',
        costumes: NUMBERED,
        variables: [['mathsTemp', 'temp']],
        blocks: stack({
            hat: block('event_whenflagclicked'),
            set: setById('mathsTemp', 'temp', text(2))
        }, 'hat', 'set')
    }));
    run(vm);

    assert.strictEqual(valueOf(vm, 'Looks', 'temp'), '2');
    assert.strictEqual(targetNamed(vm, 'Looks').currentCostume, 0);
    assert.strictEqual(valueOf(vm, 'Maths', 'temp'), 2);
});

test('a variable read by name from another sprite keeps its names', async () => {
    const vm = await load(makeProject({}, {
        name: 'Owner',
        costumes: NUMBERED,
        variables: [['ownerRemote', 'remote'], ['ownerPrivate', 'private']],
        blocks: stack({
            hat: block('event_whenflagclicked'),
            setRemote: setById('ownerRemote', 'remote', text(2)),
            setPrivate: setById('ownerPrivate', 'private', text(2))
        }, 'hat', 'setRemote', 'setPrivate')
    }, {
        name: 'Reader',
        costumes: NUMBERED,
        currentCostume: 2,
        blocks: stack({
            hat: block('event_whenflagclicked'),
            wait: block('control_wait', {DURATION: [1, [5, '0']]}),
            show: switchCostume(reporter('remoteOf')),
            remoteOf: block('sensing_of', {OBJECT: [1, 'remoteMenu']}, {PROPERTY: ['remote', null]}, {
                parent: 'show'
            }),
            remoteMenu: block('sensing_of_object_menu', {}, {OBJECT: ['Owner', null]}, {
                parent: 'remoteOf',
                shadow: true
            })
        }, 'hat', 'wait', 'show')
    }));
    run(vm);

    assert.strictEqual(valueOf(vm, 'Owner', 'remote'), '2');
    assert.strictEqual(valueOf(vm, 'Owner', 'private'), 2);
    assert.strictEqual(targetNamed(vm, 'Reader').currentCostume, 0, 'costume picked by name, not by index');
});

test('a variable block that no longer matches a variable id keeps the TurboWarp rule', async () => {
    const vm = await load(makeProject({variables: ['kept']}, {
        name: 'Sprite',
        costumes: NUMBERED,
        blocks: stack({
            hat: block('event_whenflagclicked'),
            setStale: setById('stale id', 'kept', text(2)),
            setMissing: setById('missing', 'missing', text(2))
        }, 'hat', 'setStale', 'setMissing')
    }));
    run(vm);

    assert.strictEqual(valueOf(vm, 'Stage', 'kept'), '2');
    assert.strictEqual(valueOf(vm, 'Sprite', 'missing'), 2);
});

const twoSpriteProject = readerFirst => {
    const writer = {
        name: 'Writer',
        costumes: NUMBERED,
        blocks: stack({
            hat: block('event_whenflagclicked'),
            setShared: setTo('shared', text(2))
        }, 'hat', 'setShared')
    };
    const reader = {
        name: 'Reader',
        costumes: NUMBERED,
        currentCostume: 2,
        blocks: stack({
            hat: block('event_whenflagclicked'),
            wait: block('control_wait', {DURATION: [1, [5, '0']]})
        }, 'hat', 'wait')
    };
    return makeProject({variables: ['shared']}, ...(readerFirst ? [reader, writer] : [writer, reader]));
};

const addCostumeSwitch = (target, variableName) => {
    target.blocks.createBlock({
        id: 'addedSwitch',
        opcode: 'looks_switchcostumeto',
        next: null,
        parent: 'wait',
        topLevel: false,
        shadow: false,
        inputs: {
            COSTUME: {name: 'COSTUME', block: 'addedRead', shadow: null}
        },
        fields: {}
    });
    target.blocks.createBlock({
        id: 'addedRead',
        opcode: 'data_variable',
        next: null,
        parent: 'addedSwitch',
        topLevel: false,
        shadow: false,
        inputs: {},
        fields: {
            VARIABLE: {name: 'VARIABLE', id: variableName, value: variableName, variableType: ''}
        }
    });
    target.blocks.getBlock('wait').next = 'addedSwitch';
    target.blocks.resetCache();
};

for (const readerFirst of [false, true]) {
    const order = readerFirst ? 'reader below writer' : 'writer below reader';

    test(`a new lookup in one sprite recompiles the sprites that store into it (${order})`, async () => {
        const vm = await load(twoSpriteProject(readerFirst));
        run(vm);
        assert.strictEqual(valueOf(vm, 'Stage', 'shared'), 2);

        const reader = targetNamed(vm, 'Reader');
        addCostumeSwitch(reader, 'shared');
        run(vm);

        assert.strictEqual(valueOf(vm, 'Stage', 'shared'), '2');
        assert.strictEqual(reader.currentCostume, 0, 'costume picked by name, not by index');
    });

    test(`removing the only lookup lets the constant become a number again (${order})`, async () => {
        const vm = await load(twoSpriteProject(readerFirst));
        const reader = targetNamed(vm, 'Reader');
        addCostumeSwitch(reader, 'shared');
        run(vm);
        assert.strictEqual(valueOf(vm, 'Stage', 'shared'), '2');

        reader.blocks.getBlock('wait').next = null;
        reader.blocks.deleteBlock('addedSwitch');
        run(vm);

        assert.strictEqual(valueOf(vm, 'Stage', 'shared'), 2);
    });

    test(`renaming a variable keeps its lookups (${order})`, async () => {
        const vm = await load(twoSpriteProject(readerFirst));
        const reader = targetNamed(vm, 'Reader');
        addCostumeSwitch(reader, 'shared');
        run(vm);
        assert.strictEqual(valueOf(vm, 'Stage', 'shared'), '2');

        assert.ok(vm.renameVariable('shared', 'renamed'));
        reader.setCostume(2);
        run(vm);

        assert.strictEqual(valueOf(vm, 'Stage', 'renamed'), '2');
        assert.strictEqual(reader.currentCostume, 0);
    });

    test(`a sprite added later can turn a stored number back into a name (${order})`, async () => {
        const vm = await load(twoSpriteProject(readerFirst));
        run(vm);
        assert.strictEqual(valueOf(vm, 'Stage', 'shared'), 2);

        const added = makeTarget('Added', {
            costumes: NUMBERED,
            currentCostume: 2,
            blocks: stack({
                hat: block('event_whenflagclicked'),
                wait: block('control_wait', {DURATION: [1, [5, '0']]}),
                switchShared: switchCostume(variable('shared'))
            }, 'hat', 'wait', 'switchShared')
        });
        await vm.addSprite(JSON.stringify(added));
        if (readerFirst) vm.runtime.moveExecutable(targetNamed(vm, 'Added'), -10);
        run(vm);

        assert.strictEqual(valueOf(vm, 'Stage', 'shared'), '2');
        assert.strictEqual(targetNamed(vm, 'Added').currentCostume, 0);
    });
}

const createBlock = (target, id, opcode, parent, inputs = {}, fields = {}, extra = {}) => {
    const createdInputs = {};
    for (const name of Object.keys(inputs)) createdInputs[name] = {name, block: inputs[name], shadow: null};
    const createdFields = {};
    for (const name of Object.keys(fields)) createdFields[name] = Object.assign({name}, fields[name]);
    target.blocks.createBlock(Object.assign({
        id,
        opcode,
        next: null,
        parent,
        topLevel: false,
        shadow: false,
        inputs: createdInputs,
        fields: createdFields
    }, extra));
};

test('a block the analysis does not know feeding a lookup keeps every name', async () => {
    const vm = await load(makeProject({variables: ['hidden', 'other']}, {
        name: 'Sprite',
        costumes: NUMBERED,
        currentCostume: 2,
        blocks: stack({
            hat: block('event_whenflagclicked'),
            setHidden: setTo('hidden', text(2)),
            setOther: setTo('other', text(2)),
            wait: block('control_wait', {DURATION: [1, [5, '0']]})
        }, 'hat', 'setHidden', 'setOther', 'wait')
    }));
    run(vm);
    assert.strictEqual(valueOf(vm, 'Stage', 'hidden'), 2);

    const sprite = targetNamed(vm, 'Sprite');
    vm.runtime._primitives.unknown_read = args => valueOf(vm, 'Stage', String(args.NAME));
    createBlock(sprite, 'addedSwitch', 'looks_switchcostumeto', 'wait', {COSTUME: 'addedRead'});
    createBlock(sprite, 'addedRead', 'unknown_read', 'addedSwitch', {NAME: 'addedJoin'});
    createBlock(sprite, 'addedJoin', 'operator_join', 'addedRead', {STRING1: 'addedHead', STRING2: 'addedTail'});
    createBlock(sprite, 'addedHead', 'text', 'addedJoin', {}, {TEXT: {value: 'hid'}}, {shadow: true});
    createBlock(sprite, 'addedTail', 'text', 'addedJoin', {}, {TEXT: {value: 'den'}}, {shadow: true});
    sprite.blocks.getBlock('wait').next = 'addedSwitch';
    sprite.blocks.resetCache();
    run(vm);

    assert.strictEqual(valueOf(vm, 'Stage', 'hidden'), '2');
    assert.strictEqual(valueOf(vm, 'Stage', 'other'), '2');
    assert.strictEqual(sprite.currentCostume, 0, 'costume picked by name, not by index');
    assert.strictEqual(namesReachingLookups(vm.runtime), null);
});

test('a variable made after its old namesake was deleted keeps the lookups that find it by name', async () => {
    const vm = await load(makeProject({variables: [['first', 'shared']]}, {
        name: 'Sprite',
        costumes: NUMBERED,
        currentCostume: 2,
        blocks: stack({
            hat: block('event_whenflagclicked'),
            wait: block('control_wait', {DURATION: [1, [5, '0']]}),
            switchShared: switchCostume(readById('left over', 'shared'))
        }, 'hat', 'wait', 'switchShared')
    }));
    run(vm);

    const stage = vm.runtime.getTargetForStage();
    stage.deleteVariable('first');
    stage.createVariable('second', 'shared', '');
    createBlock(stage, 'addedHat', 'event_whenflagclicked', null, {}, {}, {
        topLevel: true,
        x: 0,
        y: 0,
        next: 'addedSet'
    });
    createBlock(stage, 'addedSet', 'data_setvariableto', 'addedHat', {VALUE: 'addedValue'}, {
        VARIABLE: {value: 'shared', id: 'second', variableType: ''}
    });
    createBlock(stage, 'addedValue', 'text', 'addedSet', {}, {TEXT: {value: '2'}}, {shadow: true});
    targetNamed(vm, 'Sprite').setCostume(2);
    run(vm);

    assert.strictEqual(stage.variables.second.value, '2');
    assert.strictEqual(targetNamed(vm, 'Sprite').currentCostume, 0, 'costume picked by name, not by index');
});

test('clones follow the analysis of the sprite they came from', async () => {
    const vm = await load(makeProject({}, {
        name: 'Sprite',
        costumes: NUMBERED,
        currentCostume: 2,
        variables: ['looked up', 'free'],
        blocks: Object.assign(
            stack({
                hat: block('event_whenflagclicked'),
                makeClone: block('control_create_clone_of', {CLONE_OPTION: [1, 'cloneMenu']}),
                cloneMenu: block('control_create_clone_of_menu', {}, {CLONE_OPTION: ['_myself_', null]}, {
                    shadow: true,
                    parent: 'makeClone'
                })
            }, 'hat', 'makeClone'),
            stack({
                cloneHat: block('control_start_as_clone'),
                setLookedUp: setTo('looked up', text(2)),
                setFree: setTo('free', text(2)),
                switchLookedUp: switchCostume(variable('looked up'))
            }, 'cloneHat', 'setLookedUp', 'setFree', 'switchLookedUp')
        )
    }));
    run(vm);

    const clone = vm.runtime.targets.find(target => !target.isOriginal);
    const cloneValue = name => Object.values(clone.variables).find(candidate => candidate.name === name).value;
    assert.strictEqual(cloneValue('looked up'), '2');
    assert.strictEqual(cloneValue('free'), 2);
    assert.strictEqual(clone.currentCostume, 0, 'costume picked by name, not by index');
});

test('a custom block the analysis cannot read does not stop other scripts from compiling', async () => {
    const broken = stack({
        hat: block('event_whenflagclicked'),
        callBroken: call('broken', 'broken %s', text(1))
    }, 'hat', 'callBroken');
    procedure(broken, 'broken', 'broken %s', 'value');
    broken.brokenDefinition.topLevel = true;
    delete broken.brokenPrototype.mutation.argumentdefaults;
    const vm = await load(makeProject({variables: ['free']}, {
        name: 'Broken',
        costumes: NUMBERED,
        blocks: broken
    }, {
        name: 'Other',
        costumes: NUMBERED,
        blocks: stack({
            hat: block('event_whenflagclicked'),
            setFree: setTo('free', text(2))
        }, 'hat', 'setFree')
    }));
    run(vm);

    const other = targetNamed(vm, 'Other');
    const result = other.blocks.getCachedCompileResult('hat');
    assert.ok(result && result.success, 'the unrelated script was not compiled');
    assert.strictEqual(valueOf(vm, 'Stage', 'free'), '2', 'every name is kept when the analysis fails');
});

test('a variable renamed without the editor is analysed again', async () => {
    const vm = await load(makeProject({}, {
        name: 'Owner',
        costumes: NUMBERED,
        variables: [['ownerValue', 'value']],
        blocks: stack({
            hat: block('event_whenflagclicked'),
            setValue: setById('ownerValue', 'value', text(2))
        }, 'hat', 'setValue')
    }, {
        name: 'Reader',
        costumes: NUMBERED,
        currentCostume: 2,
        blocks: stack({
            hat: block('event_whenflagclicked'),
            wait: block('control_wait', {DURATION: [1, [5, '0']]}),
            show: switchCostume(reporter('remoteOf')),
            remoteOf: block('sensing_of', {OBJECT: [1, 'remoteMenu']}, {PROPERTY: ['remote', null]}, {
                parent: 'show'
            }),
            remoteMenu: block('sensing_of_object_menu', {}, {OBJECT: ['Owner', null]}, {
                parent: 'remoteOf',
                shadow: true
            })
        }, 'hat', 'wait', 'show')
    }));
    run(vm);
    assert.strictEqual(valueOf(vm, 'Owner', 'value'), 2);

    const owner = targetNamed(vm, 'Owner');
    owner.variables.ownerValue.name = 'remote';
    owner.bumpDeclRevision();
    vm.stopAll();
    targetNamed(vm, 'Reader').setCostume(2);
    run(vm);

    assert.strictEqual(valueOf(vm, 'Owner', 'remote'), '2');
    assert.strictEqual(targetNamed(vm, 'Reader').currentCostume, 0, 'costume picked by name, not by index');
});
