const {test} = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const VirtualMachine = require('../../src/virtual-machine');
const Thread = require('../../src/engine/thread');

const fixtureData = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'tw-addon-blocks.sb3'));

const runExecutionTests = compilerEnabled => async parent => {
    const load = async () => {
        const vm = new VirtualMachine();
        vm.setCompilerOptions({
            enabled: compilerEnabled
        });
        vm.on('COMPILE_ERROR', (target, error) => {
            assert.fail(`Compile error in ${target.getName()}: ${error}`);
        });
        await vm.loadProject(fixtureData);
        return vm;
    };

    const getVar = (vm, variableName) => {
        const variable = vm.runtime.getTargetForStage().lookupVariableByNameAndType(variableName, '');
        return variable.value;
    };

    await parent.test('baseline - no addon blocks', async () => {
        const vm = await load();
        assert.strictEqual(getVar(vm, 'block 1'), 'initial');
        assert.strictEqual(getVar(vm, 'block 2'), 'initial');
        assert.strictEqual(getVar(vm, 'block 3'), 'initial');
        assert.strictEqual(getVar(vm, 'block 4'), 'initial');
        assert.strictEqual(getVar(vm, 'block 4 output'), 'initial');

        vm.greenFlag();
        vm.runtime._step();

        assert.strictEqual(getVar(vm, 'block 1'), 'block 1 ran');
        assert.strictEqual(getVar(vm, 'block 2'), 'block 2: banana');
        assert.strictEqual(getVar(vm, 'block 3'), 'block 3 ran');
        assert.strictEqual(getVar(vm, 'block 4'), 'block 4 ran');
        assert.strictEqual(getVar(vm, 'block 4 output'), 'block 4: apple');
    });

    await parent.test('simple statement blocks', async t => {
        const vm = await load();
        t.plan(9);

        let calledBlock1 = false;
        let calledBlock2 = false;

        vm.addAddonBlock({
            procedureCode: 'block 1',
            callback: (args, util) => {
                calledBlock1 = true;
                t.assert.deepEqual(args, {});
                t.assert.ok(util.thread instanceof Thread);
                // may have to update when project changes
                t.assert.strictEqual(util.thread.peekStack(), 'd');
            }
        });

        vm.addAddonBlock({
            procedureCode: 'block 2 %s',
            arguments: ['number or text'],
            callback: (args, util) => {
                calledBlock2 = true;
                t.assert.deepEqual(args, {
                    'number or text': 'banana'
                });
                // may have to update when project changes
                t.assert.strictEqual(util.thread.peekStack(), 'c');
            }
        });

        vm.greenFlag();
        vm.runtime._step();

        t.assert.ok(calledBlock1);
        t.assert.ok(calledBlock2);

        // Overridden blocks should not run
        t.assert.strictEqual(getVar(vm, 'block 1'), 'false');
        t.assert.strictEqual(getVar(vm, 'block 2'), 'false');
    });

    await parent.test('statement blocks that never yield', async t => {
        const vm = await load();
        t.plan(6);

        let calledBlock1 = false;
        let calledBlock2 = false;

        vm.addAddonBlock({
            procedureCode: 'block 1',
            yields: false,
            callback: (args, util) => {
                calledBlock1 = true;
                t.assert.ok(util.thread instanceof Thread);
                // may have to update when project changes
                t.assert.strictEqual(util.thread.peekStack(), 'd');
            }
        });

        vm.addAddonBlock({
            procedureCode: 'block 2 %s',
            arguments: ['number or text'],
            yields: false,
            callback: args => {
                calledBlock2 = true;
                t.assert.deepEqual(args, {
                    'number or text': 'banana'
                });
            }
        });

        vm.greenFlag();
        vm.runtime._step();

        t.assert.ok(calledBlock1);
        t.assert.ok(calledBlock2);
        t.assert.strictEqual(getVar(vm, 'block 4'), 'block 4 ran');
    });

    await parent.test('yield with thread.status = STATUS_PROMISE_WAIT', async () => {
        const vm = await load();
        let threadToResume;
        let ranBlock3 = false;
        vm.addAddonBlock({
            procedureCode: 'block 3',
            callback: (args, util) => {
                ranBlock3 = true;
                util.thread.status = Thread.STATUS_PROMISE_WAIT;
                threadToResume = util.thread;
            },
            arguments: []
        });

        vm.greenFlag();
        vm.runtime._step();

        // Make sure we paused it
        assert.ok(ranBlock3);
        assert.strictEqual(threadToResume.status, Thread.STATUS_PROMISE_WAIT);

        // Should've stopped after block 2
        assert.strictEqual(getVar(vm, 'block 2'), 'block 2: banana');
        assert.strictEqual(getVar(vm, 'block 3'), 'false');
        assert.strictEqual(getVar(vm, 'block 4'), 'false');

        threadToResume.status = Thread.STATUS_RUNNING;
        vm.runtime._step();

        // Should've finished running
        assert.strictEqual(getVar(vm, 'block 3'), 'false'); // overridden, should not run
        assert.strictEqual(getVar(vm, 'block 4'), 'block 4 ran');
    });

    await parent.test('yield with util.yield()', async () => {
        const vm = await load();
        let shouldYield = true;
        let calledBlock1 = 0;

        vm.addAddonBlock({
            procedureCode: 'block 1',
            callback: (args, util) => {
                calledBlock1++;

                if (shouldYield) {
                    util.runtime.requestRedraw();
                    util.yield();
                }
            },
            arguments: []
        });

        vm.greenFlag();
        for (let i = 0; i < 10; i++) {
            vm.runtime._step();
        }

        assert.strictEqual(calledBlock1, 10);
        assert.strictEqual(getVar(vm, 'block 1'), 'false');
        assert.strictEqual(getVar(vm, 'block 2'), 'false');
        assert.strictEqual(getVar(vm, 'block 3'), 'false');
        assert.strictEqual(getVar(vm, 'block 4'), 'false');

        shouldYield = false;
        vm.runtime._step();

        assert.strictEqual(calledBlock1, 11);
        assert.strictEqual(getVar(vm, 'block 1'), 'false'); // overrridden, should not run
        assert.strictEqual(getVar(vm, 'block 2'), 'block 2: banana');
        assert.strictEqual(getVar(vm, 'block 3'), 'block 3 ran');
        assert.strictEqual(getVar(vm, 'block 4'), 'block 4 ran');
    });

    await parent.test('yield with resolved Promise', async () => {
        const vm = await load();
        let resolveCallback;
        vm.addAddonBlock({
            procedureCode: 'block 2 %s',
            arguments: ['number or text'],
            callback: () => new Promise(resolve => {
                resolveCallback = resolve;
            })
        });

        vm.greenFlag();
        for (let i = 0; i < 5; i++) {
            vm.runtime._step();
        }

        assert.strictEqual(typeof resolveCallback, 'function');
        assert.strictEqual(getVar(vm, 'block 1'), 'block 1 ran');
        assert.strictEqual(getVar(vm, 'block 2'), 'false');
        assert.strictEqual(getVar(vm, 'block 3'), 'false');
        assert.strictEqual(getVar(vm, 'block 4'), 'false');

        resolveCallback();
        await Promise.resolve();
        vm.runtime._step();
        assert.strictEqual(getVar(vm, 'block 2'), 'false'); // overridden, should not run
        assert.strictEqual(getVar(vm, 'block 3'), 'block 3 ran');
        assert.strictEqual(getVar(vm, 'block 4'), 'block 4 ran');
    });

    /*
    // Doesn't work right now -- not clear whether it should or not
    test.skip('yield with rejected Promise', t => {
        load().then(vm => {
            let rejectCallback;
            vm.addAddonBlock({
                procedureCode: 'block 2 %s',
                arguments: ['number or text'],
                callback: () => new Promise((resolve, reject) => {
                    rejectCallback = reject;
                })
            });

            vm.greenFlag();
            for (let i = 0; i < 5; i++) {
                vm.runtime._step();
            }

            t.type(rejectCallback, 'function');
            t.equal(getVar(vm, 'block 1'), 'block 1 ran');
            t.equal(getVar(vm, 'block 2'), 'false');
            t.equal(getVar(vm, 'block 3'), 'false');
            t.equal(getVar(vm, 'block 4'), 'false');

            rejectCallback(new Error('Intentional error for testing'));
            Promise.resolve().then(() => {
                vm.runtime._step();
                t.equal(getVar(vm, 'block 2'), 'false'); // overridden, should not run
                t.equal(getVar(vm, 'block 3'), 'block 3 ran');
                t.equal(getVar(vm, 'block 4'), 'block 4 ran');

                t.end();
            });
        });
    });
    */

    await parent.test('returning values', async () => {
        const vm = await load();
        vm.addAddonBlock({
            procedureCode: 'block 4 %s',
            callback: args => {
                assert.deepEqual(args, {
                    'number or text': 'apple'
                });
                return `value from addon block: ${args['number or text']}`;
            },
            arguments: ['number or text']
        });

        vm.greenFlag();
        vm.runtime._step();

        assert.strictEqual(getVar(vm, 'block 1'), 'block 1 ran');
        assert.strictEqual(getVar(vm, 'block 2'), 'block 2: banana');
        assert.strictEqual(getVar(vm, 'block 3'), 'block 3 ran');
        assert.strictEqual(getVar(vm, 'block 4'), 'false'); // block 4 itself should not have run, we overrode it
        assert.strictEqual(getVar(vm, 'block 4 output'), 'value from addon block: apple');
    });
};

test('with compiler disabled', runExecutionTests(false));
test('with compiler enabled', runExecutionTests(true));

test('block info', () => {
    const vm = new VirtualMachine();

    const BLOCK_INFO_ID = 'a-b';

    vm.addAddonBlock({
        procedureCode: 'hidden %s',
        arguments: ['number or text'],
        callback: () => {},
        hidden: true
    });

    let blockInfo = vm.runtime._blockInfo.find(i => i.id === BLOCK_INFO_ID);
    assert.strictEqual(blockInfo, undefined);

    vm.addAddonBlock({
        procedureCode: 'statement %s',
        arguments: ['number or text'],
        callback: () => {}
    });
    vm.addAddonBlock({
        procedureCode: 'input %s',
        arguments: ['an argument'],
        callback: () => {},
        return: 1
    });

    blockInfo = vm.runtime._blockInfo.find(i => i.id === BLOCK_INFO_ID);
    assert.strictEqual(typeof blockInfo.id, 'string');
    assert.strictEqual(typeof blockInfo.name, 'string');
    assert.strictEqual(typeof blockInfo.color1, 'string');
    assert.strictEqual(typeof blockInfo.color2, 'string');
    assert.strictEqual(typeof blockInfo.color3, 'string');
    assert.deepEqual(blockInfo.blocks, [
        {
            info: {},
            // eslint-disable-next-line max-len
            xml: '<block type="procedures_call" gap="16"><mutation generateshadows="true" warp="false" proccode="statement %s" argumentnames="[&quot;number or text&quot;]" argumentids="[&quot;arg0&quot;]" argumentdefaults="[&quot;&quot;]"></mutation></block>'
        },
        {
            info: {},
            // eslint-disable-next-line max-len
            xml: '<block type="procedures_call" gap="16"><mutation generateshadows="true" warp="false" proccode="input %s" argumentnames="[&quot;an argument&quot;]" argumentids="[&quot;arg0&quot;]" argumentdefaults="[&quot;&quot;]" return="1"></mutation></block>'
        }
    ]);
});

test('argument defaults', () => {
    const vm = new VirtualMachine();

    vm.addAddonBlock({
        procedureCode: 'defaults %s %n %b %s',
        arguments: ['text', 'number', 'boolean', 'no default'],
        argumentDefaults: ['a < b', 5, 'true'],
        callback: () => {}
    });

    const blockInfo = vm.runtime._blockInfo.find(i => i.id === 'a-b');
    assert.deepStrictEqual(blockInfo.blocks, [
        {
            info: {},
            // eslint-disable-next-line max-len
            xml: '<block type="procedures_call" gap="16"><mutation generateshadows="true" warp="false" proccode="defaults %s %n %b %s" argumentnames="[&quot;text&quot;,&quot;number&quot;,&quot;boolean&quot;,&quot;no default&quot;]" argumentids="[&quot;arg0&quot;,&quot;arg1&quot;,&quot;arg2&quot;,&quot;arg3&quot;]" argumentdefaults="[&quot;a &lt; b&quot;,&quot;5&quot;,&quot;true&quot;,&quot;&quot;]"></mutation><value name="arg0"><shadow type="text"><field name="TEXT">a &lt; b</field></shadow></value><value name="arg1"><shadow type="math_number"><field name="NUM">5</field></shadow></value></block>'
        }
    ]);

    assert.deepStrictEqual(vm.runtime.getAddonBlock('defaults %s %n %b %s').namesIdsDefaults, [
        ['text', 'number', 'boolean', 'no default'],
        ['arg0', 'arg1', 'arg2', 'arg3'],
        ['a < b', '5', 'true', '']
    ]);
});

test('a custom block calling an addon block that never yields stays a plain function', async () => {
    const JSGenerator = require('../../src/compiler/jsgen');
    // "p" is a custom block whose only block calls the addon block "log %s"; the green flag script calls "p".
    const prototype = {opcode: 'procedures_prototype', next: null, parent: 'def', inputs: {}, fields: {}, shadow: true,
        topLevel: false, mutation: {tagName: 'mutation', children: [], proccode: 'p', argumentids: '[]',
            argumentnames: '[]', argumentdefaults: '[]', warp: 'false'}};
    const blocks = {
        def: {opcode: 'procedures_definition', next: 'log', parent: null, inputs: {custom_block: [1, 'proto']},
            fields: {}, shadow: false, topLevel: true, x: 0, y: 0},
        proto: prototype,
        log: {opcode: 'procedures_call', next: null, parent: 'def', inputs: {arg0: [1, [10, 'hi']]}, fields: {},
            shadow: false, topLevel: false, mutation: {tagName: 'mutation', children: [], proccode: 'log %s',
                argumentids: '["arg0"]', warp: 'false'}},
        hat: {opcode: 'event_whenflagclicked', next: 'call', parent: null, inputs: {}, fields: {}, shadow: false,
            topLevel: true, x: 0, y: 200},
        call: {opcode: 'procedures_call', next: null, parent: 'hat', inputs: {}, fields: {}, shadow: false,
            topLevel: false, mutation: {tagName: 'mutation', children: [], proccode: 'p', argumentids: '[]',
                warp: 'false'}}
    };
    const compile = async yields => {
        const vm = new VirtualMachine();
        const logged = [];
        vm.addAddonBlock({procedureCode: 'log %s', arguments: ['content'], yields,
            callback: ({content}) => logged.push(content)});
        await vm.loadProject({targets: [{isStage: true, name: 'Stage', variables: {}, lists: {}, broadcasts: {},
            blocks, comments: {}, currentCostume: 0, costumes: [], sounds: [], volume: 100, layerOrder: 0}],
        monitors: [], extensions: [], meta: {semver: '3.0.0', vm: '3.0.0', agent: ''}});
        const sources = [];
        JSGenerator.testingApparatus = {report: (generator, source) => sources.push(source)};
        vm.greenFlag();
        vm.runtime._step();
        JSGenerator.testingApparatus = null;
        const procedure = sources.find(source => source.includes('log %s'));
        return {procedure, logged};
    };

    const plain = await compile(false);
    assert.match(plain.procedure, /return function /);
    assert.doesNotMatch(plain.procedure, /yield/);
    assert.deepStrictEqual(plain.logged, ['hi']);

    const yielding = await compile(undefined);
    assert.match(yielding.procedure, /return function\* /);
    assert.deepStrictEqual(yielding.logged, ['hi']);
});
