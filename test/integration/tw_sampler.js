const {test} = require('tap');
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

test('blockToLocation is stable and per-sprite', t => {
    const sampler = new Sampler(null);
    const a = sampler.blockToLocation('sprite1', 'block1');
    const b = sampler.blockToLocation('sprite1', 'block2');
    const c = sampler.blockToLocation('sprite2', 'block1');
    t.not(a, b);
    t.not(a, c);
    t.ok(a >= 0 && b >= 0 && c >= 0);
    t.equal(sampler.blockToLocation('sprite1', 'block1'), a);
    t.same(sampler.locationToBlock(c), {
        spriteId: 'sprite2',
        blockId: 'block1'
    });
    t.throws(() => sampler.locationToBlock(Sampler.IDLE));
    t.end();
});

test('disabled by default', async t => {
    const {vm, moves, draws} = await setup();
    vm.greenFlag();
    vm.runtime._step();
    t.equal(vm.runtime.sampler.pc, null);
    t.same(moves, [null, null]);
    t.same(draws, [null]);
    t.equal(vm.runtime.sampler.locations.length, 0);
    t.end();
});

test('basic level attributes compiled scripts to RUNTIME', async t => {
    const {vm, moves, draws} = await setup();
    vm.runtime.sampler.setEnabled(Sampler.LEVEL_BASIC);
    vm.greenFlag();
    vm.runtime._step();
    t.ok(vm.runtime.threads[0].isCompiled);
    t.same(moves, [Sampler.RUNTIME, Sampler.RUNTIME]);
    t.same(draws, [Sampler.RENDERER]);
    t.equal(vm.runtime.sampler.pc[0], Sampler.IDLE);
    t.equal(vm.runtime.sampler.locations.length, 0);
    t.end();
});

test('commands level attributes compiled scripts to blocks', async t => {
    const {vm, moves, draws} = await setup();
    const sampler = vm.runtime.sampler;
    sampler.setEnabled(Sampler.LEVEL_COMMANDS);
    vm.greenFlag();

    vm.runtime._step();
    t.ok(vm.runtime.threads[0].isCompiled);
    const spriteId = vm.runtime.getSpriteTargetByName('Sprite1').id;
    const changeOnce = sampler.blockToLocation(spriteId, 'b');
    const changeInLoop = sampler.blockToLocation(spriteId, 'f');
    t.same(moves, [changeOnce, changeInLoop]);
    t.same(draws, [Sampler.RENDERER]);
    t.equal(sampler.pc[0], Sampler.IDLE);

    vm.runtime._step();
    t.same(moves, [changeOnce, changeInLoop, changeInLoop]);
    t.same(draws, [Sampler.RENDERER, Sampler.RENDERER]);
    t.equal(sampler.pc[0], Sampler.IDLE);
    t.end();
});

test('setEnabled(0) turns sampling back off', async t => {
    const {vm, moves, draws} = await setup();
    vm.runtime.sampler.setEnabled(Sampler.LEVEL_COMMANDS);
    vm.runtime.sampler.setEnabled(0);
    t.equal(vm.runtime.sampler.enableBasic, false);
    t.equal(vm.runtime.sampler.enableCommands, false);

    vm.runtime.sampler.pc[0] = 1234;
    vm.greenFlag();
    vm.runtime._step();
    t.same(moves, [1234, 1234]);
    t.same(draws, [1234]);
    t.equal(vm.runtime.sampler.locations.length, 0);
    t.end();
});

test('Sampler is exported', t => {
    const vm = new VirtualMachine();
    t.equal(vm.exports.Sampler, Sampler);
    t.end();
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

test('commands level attributes compiled extension loops to the loop block', async t => {
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
    t.ok(source.includes('const pc = runtime.sampler.pc;'), 'the script reads the sampler buffer');
    t.ok(source.includes(`pc[0] = ${say};`), 'the branch body is attributed to its own block');
    t.ok(source.includes(`yield; pc[0] = ${loop};`), 'resuming after the loop yield is attributed to the loop block');
    t.end();
});
