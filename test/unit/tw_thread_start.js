const {test} = require('node:test');
const assert = require('node:assert');
const VirtualMachine = require('../../src/virtual-machine');
const Thread = require('../../src/engine/thread');
const Variable = require('../../src/engine/variable');
const jsexecute = require('../../src/compiler/jsexecute');

const ASSET = 'cd21514d0531fdffb22204e0ec5ed84a';

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
const number = value => [1, [4, String(value)]];
const reporter = id => [3, id, [10, '']];
const variableField = name => ({VARIABLE: [name, name]});

const setTo = (name, value) => block('data_setvariableto', {VALUE: value}, variableField(name));
const changeBy = (name, value) => block('data_changevariableby', {VALUE: number(value)}, variableField(name));
const receive = message => block('event_whenbroadcastreceived', {}, {BROADCAST_OPTION: [message, message]});
const broadcastAndWait = message => block('event_broadcastandwait', {BROADCAST_INPUT: [1, [11, message, message]]});
const forever = substack => block('control_forever', {SUBSTACK: [2, substack]});
const repeat = (times, substack) => block('control_repeat', {TIMES: number(times), SUBSTACK: [2, substack]});
const wait = seconds => block('control_wait', {DURATION: [1, [5, String(seconds)]]});

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

const inside = (blocks, parent, ...ids) => {
    for (let i = 0; i < ids.length; i++) {
        blocks[ids[i]].next = ids[i + 1] || null;
        blocks[ids[i]].parent = ids[i - 1] || parent;
    }
    return blocks;
};

const makeTarget = (name, options) => {
    const variables = {};
    for (const variableName of options.variables || []) variables[variableName] = [variableName, 0];
    const broadcasts = {};
    for (const message of options.broadcasts || []) broadcasts[message] = message;
    const target = {
        isStage: !!options.isStage,
        name,
        variables,
        lists: {},
        broadcasts,
        blocks: options.blocks || {},
        comments: {},
        currentCostume: 0,
        costumes: [{
            name: 'plain',
            dataFormat: 'svg',
            assetId: ASSET,
            md5ext: `${ASSET}.svg`,
            rotationCenterX: 0,
            rotationCenterY: 0
        }],
        sounds: [],
        volume: 100,
        layerOrder: options.layerOrder || 0
    };
    if (!options.isStage) {
        Object.assign(target, {
            visible: true,
            x: options.x || 0,
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

const broadcast = (vm, message) => vm.runtime.startHats('event_whenbroadcastreceived', {BROADCAST_OPTION: message});

const send = (vm, message) => {
    const started = broadcast(vm, message);
    vm.runtime._step();
    return started;
};

const targetNamed = (vm, name) => vm.runtime.targets.find(target => target.getName() === name);

const valueOf = (vm, name) => targetNamed(vm, 'Stage').variables[name].value;

const linked = (target, topBlock) => target.scriptStates.get(topBlock).instance;

const counter = () => makeProject({variables: ['count'], broadcasts: ['go']}, {
    name: 'Sprite',
    blocks: stack({
        hat: receive('go'),
        change: changeBy('count', 1)
    }, 'hat', 'change')
});

test('a script is linked once per sprite and reused by later threads', async () => {
    const vm = await load(counter());
    const sprite = targetNamed(vm, 'Sprite');

    const [first] = send(vm, 'go');
    assert.ok(first.isCompiled);
    const instance = linked(sprite, 'hat');
    const [second] = send(vm, 'go');

    assert.notStrictEqual(second, first);
    assert.strictEqual(linked(sprite, 'hat'), instance);
    assert.strictEqual(valueOf(vm, 'count'), 2);
});

test('a script is linked again when a variable it captured is replaced', async () => {
    const vm = await load(counter());
    const sprite = targetNamed(vm, 'Sprite');
    const stage = targetNamed(vm, 'Stage');

    send(vm, 'go');
    const instance = linked(sprite, 'hat');
    const replacement = new Variable('count', 'count', Variable.SCALAR_TYPE, false);
    replacement.value = 10;
    stage.variables.count = replacement;
    send(vm, 'go');

    assert.notStrictEqual(linked(sprite, 'hat'), instance);
    assert.strictEqual(replacement.value, 11);
});

test('a script is linked again when a variable it captured is deleted', async () => {
    const vm = await load(counter());
    const sprite = targetNamed(vm, 'Sprite');
    const stage = targetNamed(vm, 'Stage');

    send(vm, 'go');
    const deleted = stage.variables.count;
    stage.deleteVariable('count');
    send(vm, 'go');

    assert.strictEqual(deleted.value, 1);
    assert.strictEqual(sprite.lookupVariableById('count').value, 1);
});

test('clones link their own copy of a script and keep their own variables', async () => {
    const vm = await load(makeProject({broadcasts: ['go']}, {
        name: 'Sprite',
        variables: ['mine'],
        blocks: stack(stack({
            flag: block('event_whenflagclicked'),
            create: block('control_create_clone_of', {CLONE_OPTION: [1, 'menu']}),
            menu: block('control_create_clone_of_menu', {}, {CLONE_OPTION: ['_myself_', null]}, {
                shadow: true,
                parent: 'create'
            }),
            hat: receive('go'),
            change: changeBy('mine', 1)
        }, 'flag', 'create'), 'hat', 'change')
    }));
    vm.greenFlag();
    vm.runtime._step();
    const [original, clone] = vm.runtime.targets.filter(target => target.getName() === 'Sprite');
    assert.ok(clone && !clone.isOriginal);

    send(vm, 'go');
    clone.variables.mine.value = 5;
    send(vm, 'go');

    assert.strictEqual(original.variables.mine.value, 2);
    assert.strictEqual(clone.variables.mine.value, 6);
    assert.notStrictEqual(linked(clone, 'hat'), linked(original, 'hat'));
});

test('a script is linked again when the sprite it reads from changes', async () => {
    const vm = await load(makeProject({variables: ['seen'], broadcasts: ['go']}, {
        name: 'Reader',
        blocks: stack({
            hat: receive('go'),
            set: setTo('seen', reporter('of')),
            of: block('sensing_of', {OBJECT: [1, 'ofMenu']}, {PROPERTY: ['x position', null]}, {parent: 'set'}),
            ofMenu: block('sensing_of_object_menu', {}, {OBJECT: ['Other', null]}, {shadow: true, parent: 'of'})
        }, 'hat', 'set')
    }, {name: 'Other', x: 10}, {name: 'Spare', x: 20}));

    send(vm, 'go');
    assert.strictEqual(valueOf(vm, 'seen'), 10);

    vm.runtime.disposeTarget(targetNamed(vm, 'Other'));
    send(vm, 'go');
    assert.strictEqual(valueOf(vm, 'seen'), 0);

    vm.renameSprite(targetNamed(vm, 'Spare').id, 'Other');
    send(vm, 'go');
    assert.strictEqual(valueOf(vm, 'seen'), 20);
});

test('a script is linked again when a block function it captured is replaced', async () => {
    const vm = await load(makeProject({broadcasts: ['go']}, {
        name: 'Sprite',
        blocks: stack({
            hat: receive('go'),
            glide: block('motion_glidesecstoxy', {SECS: number(0), X: number(30), Y: number(0)})
        }, 'hat', 'glide')
    }));

    send(vm, 'go');
    assert.strictEqual(targetNamed(vm, 'Sprite').x, 30);

    let calls = 0;
    vm.runtime._primitives.motion_glidesecstoxy = () => {
        calls++;
    };
    send(vm, 'go');
    assert.strictEqual(calls, 1);
});

test('an edited script runs its new blocks', async () => {
    const vm = await load(makeProject({variables: ['value'], broadcasts: ['go']}, {
        name: 'Sprite',
        blocks: stack({
            hat: receive('go'),
            set: setTo('value', text('before'))
        }, 'hat', 'set')
    }));
    const sprite = targetNamed(vm, 'Sprite');

    send(vm, 'go');
    assert.strictEqual(valueOf(vm, 'value'), 'before');

    sprite.blocks.changeBlock({
        id: sprite.blocks.getBlock('set').inputs.VALUE.shadow,
        element: 'field',
        name: 'TEXT',
        value: 'after'
    });
    send(vm, 'go');
    assert.strictEqual(valueOf(vm, 'value'), 'after');
});

test('a deleted script leaves no state behind once its thread is gone', async () => {
    const vm = await load(counter());
    const sprite = targetNamed(vm, 'Sprite');

    send(vm, 'go');
    assert.ok(sprite.scriptStates.has('hat'));

    sprite.blocks.deleteBlock('hat');
    assert.deepStrictEqual(send(vm, 'go'), []);
    Thread.scriptStateFor(sprite, 'other');
    assert.ok(!sprite.scriptStates.has('hat'));
});

const loops = () => makeProject({variables: ['count'], broadcasts: ['one', 'two', 'three']}, {
    name: 'Sprite',
    blocks: ['one', 'two', 'three'].reduce((blocks, message) => inside(stack(Object.assign(blocks, {
        [`${message}Hat`]: receive(message),
        [`${message}Forever`]: forever(`${message}Change`),
        [`${message}Change`]: changeBy('count', 1)
    }), `${message}Hat`, `${message}Forever`), `${message}Forever`, `${message}Change`), {})
});

test('a clicked stack and a hat thread for the same script run side by side', async () => {
    const vm = await load(loops());
    const sprite = targetNamed(vm, 'Sprite');

    const [hatThread] = send(vm, 'one');
    vm.runtime.toggleScript('oneForever', {target: sprite, stackClick: true});
    const clicked = vm.runtime.threads[1];
    assert.ok(clicked.stackClick);
    assert.strictEqual(clicked.scriptState, null);
    assert.strictEqual(sprite.scriptStates.get('oneHat').thread, hatThread);
    assert.ok(!sprite.scriptStates.has('oneForever'));

    const [restarted] = send(vm, 'one');
    assert.notStrictEqual(restarted, hatThread);
    assert.deepStrictEqual(vm.runtime.threads, [restarted, clicked]);
    assert.strictEqual(sprite.scriptStates.get('oneHat').thread, restarted);
});

test('a restarted thread keeps its place in the thread list', async () => {
    const vm = await load(loops());

    const [one] = send(vm, 'one');
    const [two] = send(vm, 'two');
    const [three] = send(vm, 'three');
    assert.deepStrictEqual(vm.runtime.threads, [one, two, three]);

    const [restarted] = broadcast(vm, 'two');
    assert.notStrictEqual(restarted, two);
    assert.ok(!two.inThreadList);
    assert.deepStrictEqual(vm.runtime.threads, [one, restarted, three]);

    vm.runtime._step();
    assert.deepStrictEqual(vm.runtime.threads, [one, restarted, three]);
});

test('the thread map is rebuilt when it is read', async () => {
    const vm = await load(loops());
    const runtime = vm.runtime;
    const map = runtime.threadMap;

    const [one] = send(vm, 'one');
    const [two] = send(vm, 'two');
    assert.strictEqual(runtime.threadMap, map);
    assert.strictEqual(map.size, 2);
    assert.strictEqual(map.get(one.getId()), one);
    assert.strictEqual(map.get(two.getId()), two);

    const [restarted] = broadcast(vm, 'one');
    assert.strictEqual(runtime.threadMap.get(one.getId()), restarted);

    runtime._stopThread(two);
    runtime._step();
    assert.deepStrictEqual(Array.from(runtime.threadMap.values()), [restarted]);

    vm.stopAll();
    runtime._step();
    assert.strictEqual(runtime.threadMap.size, 0);
});

test('updateThreadMap adopts threads that were put in the thread list by hand', async () => {
    const vm = await load(loops());
    const runtime = vm.runtime;
    const sprite = targetNamed(vm, 'Sprite');

    const thread = new Thread('oneHat');
    thread.target = sprite;
    thread.blockContainer = sprite.blocks;
    thread.pushStack('oneHat');
    runtime.threads.push(thread);
    runtime.updateThreadMap();
    assert.strictEqual(runtime.threadMap.get(thread.getId()), thread);

    const [restarted] = broadcast(vm, 'one');
    assert.notStrictEqual(restarted, thread);
    assert.deepStrictEqual(runtime.threads, [restarted]);
});

test('threads that finish in one step are kept up to a limit and all counted', async () => {
    const blocks = {};
    for (let i = 0; i < 200; i++) {
        blocks[`hat${i}`] = receive('go');
        blocks[`change${i}`] = changeBy('count', 1);
        stack(blocks, `hat${i}`, `change${i}`);
    }
    blocks.clicked = changeBy('count', 1000);
    stack(blocks, 'clicked');
    const vm = await load(makeProject({variables: ['count'], broadcasts: ['go']}, {name: 'Sprite', blocks}));
    const runtime = vm.runtime;
    let started = 0;
    runtime.on('PROJECT_RUN_START', () => started++);

    const threads = broadcast(vm, 'go');
    runtime.toggleScript('clicked', {target: targetNamed(vm, 'Sprite'), stackClick: true});
    const clicked = runtime.threads[200];
    runtime._step();

    assert.strictEqual(threads.length, 200);
    assert.strictEqual(valueOf(vm, 'count'), 1200);
    assert.strictEqual(runtime._lastStepDoneThreads.length, 129);
    assert.strictEqual(runtime.sequencer.doneThreadsNotKept, 72);
    assert.ok(runtime._lastStepDoneThreads.includes(clicked));
    assert.strictEqual(runtime.threads.length, 0);
    assert.strictEqual(started, 1);

    runtime._step();
    assert.strictEqual(runtime.sequencer.doneThreadsNotKept, 0);
});

const MESSAGES = ['m1', 'm2', 'MiXed', 'm4', '5', 'm6'];

const receivers = () => {
    const blocks = {};
    MESSAGES.forEach((message, index) => {
        blocks[`hat${index}`] = receive(message);
        blocks[`change${index}`] = changeBy('count', 2 ** index);
        stack(blocks, `hat${index}`, `change${index}`);
    });
    return makeProject({variables: ['count'], broadcasts: MESSAGES}, {name: 'Sprite', blocks});
};

const countAfter = (vm, message) => {
    targetNamed(vm, 'Stage').variables.count.value = 0;
    send(vm, message);
    return valueOf(vm, 'count');
};

test('a sprite with many hats starts only the ones whose field matches', async () => {
    const vm = await load(receivers());

    assert.strictEqual(countAfter(vm, 'm1'), 1);
    assert.strictEqual(countAfter(vm, 'M2'), 2);
    assert.strictEqual(countAfter(vm, 'mixed'), 4);
    assert.strictEqual(countAfter(vm, 'MIXED'), 4);
    assert.strictEqual(countAfter(vm, 5), 16);
    assert.strictEqual(countAfter(vm, 'm6'), 32);
    assert.strictEqual(countAfter(vm, 'missing'), 0);
    assert.strictEqual(countAfter(vm, 'constructor'), 0);
});

test('hats are matched again after a hat field is edited', async () => {
    const vm = await load(receivers());
    const sprite = targetNamed(vm, 'Sprite');
    assert.strictEqual(countAfter(vm, 'm4'), 8);

    sprite.blocks.getBlock('hat3').fields.BROADCAST_OPTION.value = 'fresh';
    sprite.blocks.resetCache();

    assert.strictEqual(countAfter(vm, 'm4'), 0);
    assert.strictEqual(countAfter(vm, 'Fresh'), 8);
});

test('hats must match every requested field', async () => {
    const vm = await load(receivers());
    const start = fields => {
        targetNamed(vm, 'Stage').variables.count.value = 0;
        const threads = vm.runtime.startHats('event_whenbroadcastreceived', fields);
        vm.runtime._step();
        return threads.length;
    };

    assert.strictEqual(start({BROADCAST_OPTION: 'm1'}), 1);
    assert.strictEqual(start({BROADCAST_OPTION: 'm1', OTHER: 'x'}), 0);
    assert.strictEqual(start({OTHER: 'x'}), 0);
    assert.strictEqual(start(), MESSAGES.length);
    assert.strictEqual(valueOf(vm, 'count'), 63);
});

const waiting = () => makeProject({variables: ['count', 'seen', 'finished'], broadcasts: ['start', 'work']}, {
    name: 'Sender',
    blocks: stack({
        hat: receive('start'),
        wait: broadcastAndWait('work'),
        set: setTo('seen', [3, [12, 'count', 'count'], [10, '']]),
        finish: changeBy('finished', 1)
    }, 'hat', 'wait', 'set', 'finish')
}, {
    name: 'Worker',
    blocks: inside(stack({
        hat: receive('work'),
        repeat: repeat(3, 'change'),
        change: changeBy('count', 1),
        pause: wait(0)
    }, 'hat', 'repeat'), 'repeat', 'change', 'pause')
});

test('broadcast and wait continues once every started script has finished', async () => {
    const vm = await load(waiting());

    broadcast(vm, 'start');
    for (let i = 0; i < 2; i++) vm.runtime._step();
    assert.strictEqual(valueOf(vm, 'count'), 2);
    assert.strictEqual(valueOf(vm, 'finished'), 0);

    for (let i = 0; i < 10; i++) vm.runtime._step();
    assert.strictEqual(valueOf(vm, 'seen'), 3);
    assert.strictEqual(valueOf(vm, 'finished'), 1);
    assert.strictEqual(vm.runtime.threads.length, 0);
});

test('broadcast and wait continues when the scripts it started are restarted by someone else', async () => {
    const vm = await load(waiting());

    broadcast(vm, 'start');
    vm.runtime._step();
    broadcast(vm, 'work');
    vm.runtime._step();
    assert.strictEqual(valueOf(vm, 'finished'), 1);
    assert.strictEqual(valueOf(vm, 'seen'), 1);
    assert.strictEqual(vm.runtime.threads.length, 1);
});

test('broadcast and wait with no receivers does not wait and leaks no global', async () => {
    const before = Object.keys(global);
    const vm = await load(makeProject({variables: ['finished'], broadcasts: ['start', 'nobody']}, {
        name: 'Sender',
        blocks: stack({
            hat: receive('start'),
            wait: broadcastAndWait('nobody'),
            finish: changeBy('finished', 1)
        }, 'hat', 'wait', 'finish')
    }));

    send(vm, 'start');
    assert.strictEqual(valueOf(vm, 'finished'), 1);
    assert.deepStrictEqual(Object.keys(global), before);
});

test('playground data lists a running hat thread', async () => {
    const vm = await load(loops());
    vm.setEditingTarget(targetNamed(vm, 'Sprite').id);
    send(vm, 'one');

    let data = null;
    vm.on('playgroundData', playgroundData => {
        data = playgroundData;
    });
    vm.getPlaygroundData();

    const threads = JSON.parse(data.threads);
    assert.strictEqual(threads.length, 1);
    assert.strictEqual(threads[0].topBlock, 'oneHat');
    assert.ok(!('scriptState' in threads[0]));
});

test('the waitThreads helper works in a script that uses nothing else', () => {
    const script = jsexecute.scopedEval(`(function* () {
        yield* waitThreads([]);
        yield* waitThreads([{inThreadList: false}]);
        return 'finished';
    })`);
    assert.deepStrictEqual(script().next(), {value: 'finished', done: true});
});

test('a long broadcast name matches whatever its case', async () => {
    const long = `Message ${'x'.repeat(300)}`;
    const vm = await load(makeProject({variables: ['count'], broadcasts: [long]}, {
        name: 'Sprite',
        blocks: stack({
            hat: receive(long),
            change: changeBy('count', 1)
        }, 'hat', 'change')
    }));

    send(vm, long);
    send(vm, long.toUpperCase());
    send(vm, long.toLowerCase());
    send(vm, `${long}x`);
    assert.strictEqual(valueOf(vm, 'count'), 3);
});

const stopOthers = () => block('control_stop', {}, {STOP_OPTION: ['other scripts in sprite', null]}, {
    mutation: {tagName: 'mutation', children: [], hasnext: 'true'}
});

test('a script stopped by stop other scripts in sprite starts again with the same instance', async () => {
    const blocks = inside(stack({
        hat: receive('go'),
        forever: forever('change'),
        change: changeBy('count', 1),
        pause: wait(0)
    }, 'hat', 'forever'), 'forever', 'change', 'pause');
    Object.assign(blocks, stack({
        haltHat: receive('halt'),
        halt: stopOthers(),
        mark: changeBy('halted', 1)
    }, 'haltHat', 'halt', 'mark'));
    const vm = await load(makeProject({variables: ['count', 'halted'], broadcasts: ['go', 'halt']}, {
        name: 'Sprite',
        blocks
    }));
    const sprite = targetNamed(vm, 'Sprite');

    const [first] = send(vm, 'go');
    const instance = linked(sprite, 'hat');
    send(vm, 'halt');
    assert.ok(!first.inThreadList);
    assert.strictEqual(valueOf(vm, 'halted'), 1);
    const stoppedAt = valueOf(vm, 'count');
    vm.runtime._step();
    assert.strictEqual(valueOf(vm, 'count'), stoppedAt);
    assert.strictEqual(vm.runtime.threads.length, 0);

    const [second] = send(vm, 'go');
    assert.notStrictEqual(second, first);
    assert.ok(second.inThreadList);
    assert.strictEqual(linked(sprite, 'hat'), instance);
    assert.ok(valueOf(vm, 'count') > stoppedAt);
});

const selfBroadcast = () => makeProject({variables: ['count', 'finished'], broadcasts: ['go']}, {
    name: 'Sprite',
    blocks: inside(stack({
        hat: receive('go'),
        change: changeBy('count', 1),
        check: block('control_if', {CONDITION: [2, 'less'], SUBSTACK: [2, 'again']}),
        less: block('operator_lt', {OPERAND1: [3, [12, 'count', 'count'], [10, '']], OPERAND2: text(3)}, {}, {
            parent: 'check'
        }),
        again: block('event_broadcast', {BROADCAST_INPUT: [1, [11, 'go', 'go']]}),
        finish: changeBy('finished', 1)
    }, 'hat', 'change', 'check', 'finish'), 'check', 'again')
});

test('a script that broadcasts to itself restarts and each run still reaches its end', async () => {
    const results = [];
    for (const enabled of [true, false]) {
        const vm = await load(selfBroadcast());
        vm.setCompilerOptions({enabled});
        broadcast(vm, 'go');
        for (let i = 0; i < 6; i++) vm.runtime._step();
        results.push({
            count: valueOf(vm, 'count'),
            finished: valueOf(vm, 'finished'),
            threads: vm.runtime.threads.length
        });
    }

    assert.deepStrictEqual(results[0], {count: 3, finished: 3, threads: 0});
    assert.deepStrictEqual(results[1], results[0]);
});

test('broadcast and wait with a name read from a variable waits for that message', async () => {
    const project = waiting();
    project.targets[0].variables.which = ['which', 'WORK'];
    project.targets[1].blocks.wait = block('event_broadcastandwait', {
        BROADCAST_INPUT: [3, [12, 'which', 'which'], [11, 'start', 'start']]
    }, {}, {next: 'set', parent: 'hat'});
    const vm = await load(project);

    broadcast(vm, 'start');
    for (let i = 0; i < 2; i++) vm.runtime._step();
    assert.strictEqual(valueOf(vm, 'finished'), 0);
    for (let i = 0; i < 10; i++) vm.runtime._step();
    assert.strictEqual(valueOf(vm, 'seen'), 3);
    assert.strictEqual(valueOf(vm, 'finished'), 1);

    targetNamed(vm, 'Stage').variables.which.value = 'nothing';
    broadcast(vm, 'start');
    vm.runtime._step();
    assert.strictEqual(valueOf(vm, 'finished'), 2);
});
