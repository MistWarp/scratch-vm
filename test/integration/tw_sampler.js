const {test} = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const VirtualMachine = require('../../src/virtual-machine');
const Sampler = require('../../src/engine/tw-sampler');
const FakeRenderer = require('../fixtures/fake-renderer');
const JSGenerator = require('../../src/compiler/jsgen');

const fixture = fs.readFileSync(path.join(__dirname, '../fixtures/tw-sampler.sb3'));

global.document = {
    hidden: false
};

const setup = async () => {
    const vm = new VirtualMachine();
    const renderer = new FakeRenderer();
    vm.attachRenderer(renderer);
    await vm.loadProject(fixture);

    const moves = [];
    const draws = [];
    const getPC = () => (vm.runtime.sampler.pc ? vm.runtime.sampler.pc[0] : null);
    const originalUpdateDrawablePosition = renderer.updateDrawablePosition;
    renderer.updateDrawablePosition = function (...args) {
        if (moves.length < 100) moves.push(getPC());
        return originalUpdateDrawablePosition.apply(this, args);
    };
    renderer.draw = () => {
        if (draws.length < 100) draws.push(getPC());
    };

    return {vm, moves, draws};
};

test('blockToLocation is stable and per-sprite', () => {
    const sampler = new Sampler(null);
    const a = sampler.blockToLocation('sprite1', 'block1');
    const b = sampler.blockToLocation('sprite1', 'block2');
    const c = sampler.blockToLocation('sprite2', 'block1');
    assert.notStrictEqual(a, b);
    assert.notStrictEqual(a, c);
    assert.ok(a >= 0 && b >= 0 && c >= 0);
    assert.strictEqual(sampler.blockToLocation('sprite1', 'block1'), a);
    assert.deepStrictEqual(sampler.locationToBlock(c), {
        spriteId: 'sprite2',
        blockId: 'block1'
    });
    assert.throws(() => sampler.locationToBlock(Sampler.IDLE));
});

test('disabled by default', async () => {
    const {vm, moves, draws} = await setup();
    vm.greenFlag();
    vm.runtime._step();
    assert.strictEqual(vm.runtime.sampler.pc, null);
    assert.deepStrictEqual(moves, [null, null]);
    assert.deepStrictEqual(draws, [null]);
    assert.strictEqual(vm.runtime.sampler.locations.length, 0);
});

test('basic level attributes compiled scripts to RUNTIME', async () => {
    const {vm, moves, draws} = await setup();
    vm.runtime.sampler.setEnabled(Sampler.LEVEL_BASIC);
    vm.greenFlag();
    vm.runtime._step();
    assert.ok(vm.runtime.threads[0].isCompiled);
    assert.deepStrictEqual(moves, [Sampler.RUNTIME, Sampler.RUNTIME]);
    assert.deepStrictEqual(draws, [Sampler.RENDERER]);
    assert.strictEqual(vm.runtime.sampler.pc[0], Sampler.IDLE);
    assert.strictEqual(vm.runtime.sampler.locations.length, 0);
});

test('commands level attributes compiled scripts to blocks', async () => {
    const {vm, moves, draws} = await setup();
    const sampler = vm.runtime.sampler;
    sampler.setEnabled(Sampler.LEVEL_COMMANDS);
    vm.greenFlag();

    vm.runtime._step();
    assert.ok(vm.runtime.threads[0].isCompiled);
    const spriteId = vm.runtime.getSpriteTargetByName('Sprite1').id;
    const changeOnce = sampler.blockToLocation(spriteId, 'b');
    const changeInLoop = sampler.blockToLocation(spriteId, 'f');
    assert.deepStrictEqual(moves, [changeOnce, changeInLoop]);
    assert.deepStrictEqual(draws, [Sampler.RENDERER]);
    assert.strictEqual(sampler.pc[0], Sampler.IDLE);

    vm.runtime._step();
    assert.deepStrictEqual(moves, [changeOnce, changeInLoop, changeInLoop]);
    assert.deepStrictEqual(draws, [Sampler.RENDERER, Sampler.RENDERER]);
    assert.strictEqual(sampler.pc[0], Sampler.IDLE);
});

test('setEnabled(0) turns sampling back off', async () => {
    const {vm, moves, draws} = await setup();
    vm.runtime.sampler.setEnabled(Sampler.LEVEL_COMMANDS);
    vm.runtime.sampler.setEnabled(0);
    assert.strictEqual(vm.runtime.sampler.enableBasic, false);
    assert.strictEqual(vm.runtime.sampler.enableCommands, false);

    vm.runtime.sampler.pc[0] = 1234;
    vm.greenFlag();
    vm.runtime._step();
    assert.deepStrictEqual(moves, [1234, 1234]);
    assert.deepStrictEqual(draws, [1234]);
    assert.strictEqual(vm.runtime.sampler.locations.length, 0);
});

test('Sampler is exported', () => {
    const vm = new VirtualMachine();
    assert.strictEqual(vm.exports.Sampler, Sampler);
});

const RepeatExtension = class {
    getInfo () {
        return {
            id: 'samplerLoop',
            name: 'Sampler loop',
            blocks: [{
                opcode: 'repeatTimes',
                blockType: 'loop',
                text: 'repeat [TIMES] times',
                arguments: {TIMES: {type: 'number'}},
                compFunc: 'compRepeatTimes'
            }]
        };
    }
    compRepeatTimes (args, {cast, branch, yieldLoop}) {
        return `for (let i = 0, n = ${cast.toNumber(args.TIMES)}; i < n; i++) {
            ${branch(1, {isLoop: true})}
            ${yieldLoop()}
        }`;
    }
    repeatTimes () {}
};

test('commands level attributes compiled extension loops to the loop block', async () => {
    const vm = new VirtualMachine();
    vm.extensionManager.addBuiltinExtension('samplerLoop', RepeatExtension);
    await vm.loadProject({
        targets: [{
            isStage: true,
            name: 'Stage',
            variables: {},
            lists: {},
            broadcasts: {},
            blocks: {
                flag: {opcode: 'event_whenflagclicked', next: 'loop', parent: null, inputs: {}, fields: {}, topLevel: true, x: 0, y: 0},
                loop: {
                    opcode: 'samplerLoop_repeatTimes',
                    next: null,
                    parent: 'flag',
                    inputs: {TIMES: [1, [4, '3']], SUBSTACK: [2, 'say']},
                    fields: {},
                    topLevel: false
                },
                say: {opcode: 'looks_say', next: null, parent: 'loop', inputs: {MESSAGE: [1, [10, 'hi']]}, fields: {}, topLevel: false}
            },
            comments: {},
            currentCostume: 0,
            costumes: [],
            sounds: [],
            volume: 100,
            layerOrder: 0,
            tempo: 60,
            videoTransparency: 50,
            videoState: 'on',
            textToSpeechLanguage: null
        }],
        monitors: [],
        extensions: [],
        meta: {semver: '3.0.0', vm: '3.0.0', agent: ''}
    });
    const sampler = vm.runtime.sampler;
    sampler.setEnabled(Sampler.LEVEL_COMMANDS);

    let source = '';
    JSGenerator.testingApparatus = {report: (generator, generated) => {
        source += generated;
    }};
    vm.runtime.precompile();
    JSGenerator.testingApparatus = null;

    const stageId = vm.runtime.getTargetForStage().id;
    const loop = sampler.blockToLocation(stageId, 'loop');
    const say = sampler.blockToLocation(stageId, 'say');
    assert.ok(source.includes('const pc = runtime.sampler.pc;'), 'the script reads the sampler buffer');
    assert.ok(source.includes(`pc[0] = ${say};`), 'the branch body is attributed to its own block');
    assert.ok(source.includes(`yield; pc[0] = ${loop};`),
        'resuming after the loop yield is attributed to the loop block');
});
