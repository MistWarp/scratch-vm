const {test} = require('tap');
const makeTestStorage = require('../fixtures/make-test-storage');
const VirtualMachine = require('../../src/virtual-machine');

const makeProject = (config, monitors) => ({
    targets: [{
        isStage: true,
        name: 'Stage',
        variables: Object.fromEntries(monitors.map(([id]) => [id, [id, 0]])),
        lists: {},
        broadcasts: {},
        blocks: {},
        comments: config ? {
            config: {
                blockId: null,
                x: 0,
                y: 0,
                width: 350,
                height: 170,
                minimized: false,
                text: `Configuration for https://turbowarp.org/\n${JSON.stringify(config)} // _twconfig_`
            }
        } : {},
        currentCostume: 0,
        costumes: [{
            name: 'backdrop1',
            dataFormat: 'svg',
            assetId: 'cd21514d0531fdffb22204e0ec5ed84a',
            md5ext: 'cd21514d0531fdffb22204e0ec5ed84a.svg',
            rotationCenterX: 240,
            rotationCenterY: 180
        }],
        sounds: [],
        volume: 100,
        layerOrder: 0,
        tempo: 60,
        videoTransparency: 50,
        videoState: 'on',
        textToSpeechLanguage: null
    }],
    monitors: monitors.map(([id, x, y]) => ({
        id,
        mode: 'default',
        opcode: 'data_variable',
        params: {VARIABLE: id},
        spriteName: null,
        value: 0,
        width: 0,
        height: 0,
        x,
        y,
        visible: true,
        sliderMin: 0,
        sliderMax: 100,
        isDiscrete: true
    })),
    extensions: [],
    meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
});

const makeVM = () => {
    const vm = new VirtualMachine();
    vm.attachStorage(makeTestStorage());
    return vm;
};

const positions = vm => Object.fromEntries(
    vm.runtime.getMonitorState().valueSeq()
        .map(monitor => [monitor.get('id'), [monitor.get('x'), monitor.get('y')]])
);

const wideMonitors = [
    ['topLeft', -150, -35],
    ['belowTopLeft', -150, 15],
    ['farRight', 490, 175],
    ['bottomRight', 440, 355],
    ['bottomLeft', -140, 355],
    ['offStage', 700, 600]
];

test('monitors keep their positions on a custom stage size', async t => {
    const vm = makeVM();
    await vm.loadProject(makeProject({width: 800, height: 450}, wideMonitors));
    t.equal(vm.runtime.stageWidth, 800);
    t.equal(vm.runtime.stageHeight, 450);
    t.same(positions(vm), {
        topLeft: [10, 10],
        belowTopLeft: [10, 60],
        farRight: [650, 220],
        bottomRight: [600, 400],
        bottomLeft: [20, 400],
        offStage: [800, 450]
    });
    t.end();
});

test('monitor positions survive saving and loading a custom stage size', async t => {
    const vm = makeVM();
    await vm.loadProject(makeProject({width: 800, height: 450}, wideMonitors));
    const saved = JSON.parse(vm.toJSON());
    t.same(saved.monitors.map(monitor => [monitor.id, monitor.x, monitor.y]), [
        ['topLeft', -150, -35],
        ['belowTopLeft', -150, 15],
        ['farRight', 490, 175],
        ['bottomRight', 440, 355],
        ['bottomLeft', -140, 355],
        ['offStage', 640, 405]
    ]);

    const reloaded = makeVM();
    await reloaded.loadProject(JSON.stringify(saved));
    t.same(positions(reloaded), positions(vm));
    t.end();
});

test('monitor positions do not depend on the previous stage size', async t => {
    const vm = makeVM();
    vm.setStageSize(320, 240);
    await vm.loadProject(makeProject({width: 800, height: 450}, wideMonitors));
    t.same(positions(vm).farRight, [650, 220]);
    t.same(positions(vm).topLeft, [10, 10]);

    await vm.loadProject(makeProject({width: 320, height: 240}, [['small', 300, 300]]));
    t.same(positions(vm).small, [220, 240]);
    t.end();
});

test('monitors outside the default stage are still clamped', async t => {
    const vm = makeVM();
    await vm.loadProject(makeProject(null, [['inside', 100, 50], ['outside', 600, -20]]));
    t.equal(vm.runtime.stageWidth, 480);
    t.same(positions(vm), {
        inside: [100, 50],
        outside: [480, 0]
    });
    t.end();
});
