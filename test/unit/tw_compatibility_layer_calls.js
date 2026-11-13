const {test} = require('node:test');
const assert = require('node:assert');
const VirtualMachine = require('../../src/virtual-machine');
const JSGenerator = require('../../src/compiler/jsgen');
const Thread = require('../../src/engine/thread');

const VARIABLES = ['a', 'b', 'c', 'count'];

const project = build => {
    const blocks = {};
    let n = 0;
    const add = block => {
        const id = `b${n++}`;
        blocks[id] = Object.assign({next: null, parent: null, inputs: {}, fields: {}, shadow: false,
            topLevel: false}, block);
        return id;
    };
    const chain = ids => {
        ids.forEach((id, index) => {
            blocks[id].next = ids[index + 1] || null;
        });
        return ids[0] || null;
    };
    const tools = {
        command: (opcode, inputs = {}) => add({opcode, inputs}),
        set: (name, reporter) => add({opcode: 'data_setvariableto', inputs: {VALUE: [3, reporter, [10, '']]},
            fields: {VARIABLE: [name, name]}}),
        change: name => add({opcode: 'data_changevariableby', inputs: {VALUE: [1, [4, '1']]},
            fields: {VARIABLE: [name, name]}}),
        repeat: (times, body) => add({opcode: 'control_repeat', inputs: {TIMES: [1, [6, String(times)]],
            SUBSTACK: [2, chain(body)]}}),
        text: value => [1, [10, value]],
        reporter: id => [3, id, [10, '']],
        warp: body => {
            const proccode = `warp ${n}`;
            const mutation = warp => ({tagName: 'mutation', children: [], proccode, argumentids: '[]',
                argumentnames: '[]', argumentdefaults: '[]', warp});
            const prototype = add({opcode: 'procedures_prototype', shadow: true, mutation: mutation('true')});
            const definition = add({opcode: 'procedures_definition', topLevel: true, x: 0, y: 0,
                inputs: {custom_block: [1, prototype]}});
            blocks[prototype].parent = definition;
            blocks[definition].next = chain(body);
            return add({opcode: 'procedures_call', mutation: mutation('true')});
        }
    };
    const body = build(tools);
    const hat = add({opcode: 'event_whenflagclicked', topLevel: true, x: 0, y: 0});
    blocks[hat].next = chain(body);
    return {
        targets: [
            {isStage: true, name: 'Stage', broadcasts: {}, blocks: {}, comments: {}, currentCostume: 0,
                costumes: [], sounds: [], volume: 100, layerOrder: 0,
                variables: Object.fromEntries(VARIABLES.map(name => [name, [name, 0]])), lists: {}},
            {isStage: false, name: 'Sprite', broadcasts: {}, blocks, comments: {}, currentCostume: 0,
                costumes: [], sounds: [], volume: 100, layerOrder: 1, visible: true, x: 0, y: 0, size: 100,
                direction: 90, draggable: false, rotationStyle: 'all around', variables: {}, lists: {}}
        ],
        monitors: [],
        extensions: [],
        meta: {semver: '3.0.0', vm: '3.0.0', agent: ''}
    };
};

const run = async (build, primitives, compiler) => {
    const vm = new VirtualMachine();
    vm.setCompilerOptions({enabled: compiler});
    await vm.loadProject(project(build));
    const calls = {};
    for (const [opcode, make] of Object.entries(primitives)) {
        const primitive = make();
        calls[opcode] = 0;
        vm.runtime._primitives[opcode] = (args, util) => {
            calls[opcode]++;
            return primitive(args, util);
        };
    }
    const sequencer = vm.runtime.sequencer;
    const stepThread = sequencer.stepThread;
    sequencer.stepThread = thread => {
        vm.runtime.redrawRequested = true;
        return stepThread.call(sequencer, thread);
    };
    let source = '';
    JSGenerator.testingApparatus = {report: (generator, generated) => {
        source += generated;
    }};
    vm.greenFlag();
    let steps = 0;
    while (vm.runtime.threads.length && steps < 500) {
        vm.runtime._step();
        steps++;
        await new Promise(resolve => setImmediate(resolve));
    }
    JSGenerator.testingApparatus = null;
    assert.strictEqual(vm.runtime.threads.length, 0, 'the project did not finish');
    const stage = vm.runtime.getTargetForStage();
    const state = Object.fromEntries(VARIABLES.map(name => [name, String(stage.variables[name].value)]));
    vm.quit();
    return {state, calls, steps, source};
};

const both = async (build, primitives) => {
    const compiled = await run(build, primitives, true);
    const interpreted = await run(build, primitives, false);
    assert.deepStrictEqual(compiled.state, interpreted.state, 'compiled and interpreted results differ');
    assert.deepStrictEqual(compiled.calls, interpreted.calls, 'compiled and interpreted call counts differ');
    assert.strictEqual(compiled.steps, interpreted.steps, 'compiled and interpreted step counts differ');
    return compiled;
};

test('a block that answers at once is called without a generator', async () => {
    const {state, calls, source} = await both(t => [
        t.set('a', t.command('sensing_testvalue')),
        t.command('sensing_testcommand'),
        t.set('b', t.command('sensing_testvalue'))
    ], {
        sensing_testvalue: () => {
            let next = 10;
            return () => next++;
        },
        sensing_testcommand: () => () => {}
    });
    assert.deepStrictEqual([state.a, state.b], ['10', '11']);
    assert.deepStrictEqual(calls, {sensing_testvalue: 2, sensing_testcommand: 1});
    assert.match(source, /executeInCompatibilityLayerNow\(/);
    assert.doesNotMatch(source, /yield\* executeInCompatibilityLayer\(/);
});

test('a block that returns a promise is waited for', async () => {
    const {state, calls} = await both(t => [
        t.set('a', t.command('sensing_testpromise')),
        t.command('sensing_testpromise'),
        t.change('count')
    ], {
        sensing_testpromise: () => () => new Promise(resolve => setImmediate(() => resolve('later')))
    });
    assert.deepStrictEqual([state.a, state.count], ['later', '1']);
    assert.strictEqual(calls.sensing_testpromise, 2);
});

test('a block that yields runs again with the same stack frame', async () => {
    const frames = [];
    const {state, calls} = await both(t => [
        t.set('a', t.command('sensing_testyield')),
        t.set('b', t.command('sensing_testyield'))
    ], {
        sensing_testyield: () => (args, util) => {
            const frame = util.stackFrame;
            frame.runs = (frame.runs || 0) + 1;
            frames.push(frame.runs);
            if (frame.runs < 3) {
                util.yield();
                return '';
            }
            return `ran ${frame.runs}`;
        }
    });
    assert.deepStrictEqual([state.a, state.b], ['ran 3', 'ran 3']);
    assert.strictEqual(calls.sensing_testyield, 6);
    assert.deepStrictEqual(frames.slice(0, 6), [1, 2, 3, 1, 2, 3]);
});

test('a block that yields for a tick runs again on the next step', async () => {
    const {state, steps} = await both(t => [
        t.set('a', t.command('sensing_testtick')),
        t.change('count')
    ], {
        sensing_testtick: () => (args, util) => {
            const frame = util.stackFrame;
            frame.runs = (frame.runs || 0) + 1;
            if (frame.runs < 4) {
                util.yieldTick();
                return '';
            }
            return frame.runs;
        }
    });
    assert.deepStrictEqual([state.a, state.count], ['4', '1']);
    assert.ok(steps >= 4, 'each tick took a step');
});

test('each call starts with an empty stack frame', async () => {
    const seen = [];
    await both(t => [
        t.command('sensing_testframe'),
        t.command('sensing_testframe'),
        t.repeat(2, [t.command('sensing_testframe')])
    ], {
        sensing_testframe: () => (args, util) => {
            seen.push(util.stackFrame.mark);
            util.stackFrame.mark = true;
        }
    });
    assert.strictEqual(seen.length, 8);
    assert.ok(seen.every(mark => typeof mark === 'undefined'));
});

test('a block that ends its thread stops the script', async () => {
    const {state} = await both(t => [
        t.change('count'),
        t.command('sensing_teststop'),
        t.change('count')
    ], {
        sensing_teststop: () => (args, util) => {
            util.thread.status = Thread.STATUS_DONE;
        }
    });
    assert.strictEqual(state.count, '1');
});

test('a waiting block at the end of a loop does not add a second pause', async () => {
    const {state, calls} = await both(t => [
        t.repeat(5, [
            t.change('count'),
            t.command('sensing_testpromise')
        ])
    ], {
        sensing_testpromise: () => () => Promise.resolve()
    });
    assert.strictEqual(state.count, '5');
    assert.strictEqual(calls.sensing_testpromise, 5);
});

test('a waiting block in the middle of a loop keeps the pause at the end', async () => {
    const {state, calls} = await both(t => [
        t.repeat(5, [
            t.command('sensing_testpromise'),
            t.change('count'),
            t.command('sensing_testcommand')
        ])
    ], {
        sensing_testpromise: () => () => Promise.resolve(),
        sensing_testcommand: () => () => {}
    });
    assert.strictEqual(state.count, '5');
    assert.deepStrictEqual(calls, {sensing_testpromise: 5, sensing_testcommand: 5});
});

test('inputs are passed to the block on every run', async () => {
    const received = [];
    const {state} = await both(t => [
        t.set('a', t.command('sensing_testecho', {TEXT: t.text('first')})),
        t.set('b', t.command('sensing_testecho', {TEXT: t.text('second')}))
    ], {
        sensing_testecho: () => (args, util) => {
            received.push(args.TEXT);
            const frame = util.stackFrame;
            if (!frame.waited) {
                frame.waited = true;
                util.yield();
                return '';
            }
            return `${args.TEXT}!`;
        }
    });
    assert.deepStrictEqual([state.a, state.b], ['first!', 'second!']);
    assert.deepStrictEqual(received.slice(0, 4), ['first', 'first', 'second', 'second']);
});

test('a block that yields inside a warp script runs again in the same step', async () => {
    const frames = [];
    const {state, calls, steps} = await both(t => [
        t.warp([
            t.repeat(3, [
                t.command('sensing_testyield'),
                t.change('count')
            ])
        ]),
        t.change('count')
    ], {
        sensing_testyield: () => (args, util) => {
            const frame = util.stackFrame;
            frame.runs = (frame.runs || 0) + 1;
            frames.push(frame.runs);
            if (frame.runs < 3) util.yield();
        }
    });
    assert.strictEqual(state.count, '4');
    assert.strictEqual(calls.sensing_testyield, 9);
    assert.deepStrictEqual(frames.slice(0, 9), [1, 2, 3, 1, 2, 3, 1, 2, 3]);
    assert.strictEqual(steps, 1);
});

test('a stack frame first used on a later run is kept for the runs after it', async () => {
    const seen = [];
    const {calls} = await both(t => [
        t.command('sensing_testlate'),
        t.command('sensing_testlate')
    ], {
        sensing_testlate: () => {
            let run = 0;
            return (args, util) => {
                run++;
                if (run % 3 === 1) {
                    util.yield();
                    return;
                }
                if (run % 3 === 2) {
                    seen.push(util.stackFrame.mark);
                    util.stackFrame.mark = run;
                    util.yield();
                    return;
                }
                seen.push(util.stackFrame.mark);
            };
        }
    });
    assert.strictEqual(calls.sensing_testlate, 6);
    assert.deepStrictEqual(seen.slice(0, 4), [undefined, 2, undefined, 5]);
});

test('a block that returns a promise and also yields waits for the promise', async () => {
    const {state, calls} = await run(t => [
        t.set('a', t.command('sensing_testboth')),
        t.change('count')
    ], {
        sensing_testboth: () => (args, util) => {
            util.yield();
            return new Promise(resolve => setImmediate(() => resolve('both')));
        }
    }, true);
    assert.deepStrictEqual([state.a, state.count], ['both', '1']);
    assert.strictEqual(calls.sensing_testboth, 1);
});

test('a block whose promise rejects lets the script carry on', async () => {
    const {state, calls} = await both(t => [
        t.command('sensing_testreject'),
        t.change('count'),
        t.command('sensing_testreject'),
        t.change('count')
    ], {
        sensing_testreject: () => () => new Promise((resolve, reject) => setImmediate(() => reject(new Error('no'))))
    });
    assert.strictEqual(state.count, '2');
    assert.strictEqual(calls.sensing_testreject, 2);
});

test('a block that makes its thread wait is not run again', async () => {
    const {state, calls} = await run(t => [
        t.set('a', t.command('sensing_testhold')),
        t.change('count')
    ], {
        sensing_testhold: () => (args, util) => {
            const thread = util.thread;
            thread.status = Thread.STATUS_PROMISE_WAIT;
            setImmediate(() => {
                thread.status = Thread.STATUS_RUNNING;
            });
            return 'ignored';
        }
    }, true);
    assert.deepStrictEqual([state.a, state.count], ['', '1']);
    assert.strictEqual(calls.sensing_testhold, 1);
});

test('a waiting block used as the input of another waiting block', async () => {
    const {state, calls} = await run(t => [
        t.set('a', t.command('sensing_testwrap', {
            TEXT: t.reporter(t.command('sensing_testwrap', {TEXT: t.text('x')}))
        })),
        t.repeat(2, [
            t.set('b', t.command('sensing_testwrap', {TEXT: t.text('y')}))
        ])
    ], {
        sensing_testwrap: () => {
            const waited = new Set();
            return (args, util) => {
                if (!waited.has(args.TEXT)) {
                    waited.add(args.TEXT);
                    util.yield();
                    return '';
                }
                waited.delete(args.TEXT);
                return `<${args.TEXT}>`;
            };
        }
    }, true);
    assert.deepStrictEqual([state.a, state.b], ['<<x>>', '<y>']);
    assert.strictEqual(calls.sensing_testwrap, 8);
});

test('an addon block that waits is resumed', async () => {
    const vm = new VirtualMachine();
    vm.setCompilerOptions({enabled: true});
    await vm.loadProject(project(t => [
        t.command('procedures_call'),
        t.change('count')
    ]));
    const sprite = vm.runtime.targets.find(target => !target.isStage);
    const call = Object.values(sprite.blocks._blocks).find(block => block.opcode === 'procedures_call');
    call.mutation = {tagName: 'mutation', children: [], proccode: 'pause', argumentids: '[]', warp: 'false'};
    sprite.blocks.resetCache();
    let runs = 0;
    vm.runtime.addAddonBlock({procedureCode: 'pause', arguments: [], hidden: true, callback: () => {
        runs++;
        return new Promise(resolve => setImmediate(resolve));
    }});
    vm.greenFlag();
    for (let step = 0; step < 50 && vm.runtime.threads.length; step++) {
        vm.runtime._step();
        await new Promise(resolve => setImmediate(resolve));
    }
    assert.strictEqual(vm.runtime.threads.length, 0);
    assert.strictEqual(runs, 1);
    assert.strictEqual(String(vm.runtime.getTargetForStage().variables.count.value), '1');
    vm.quit();
});
