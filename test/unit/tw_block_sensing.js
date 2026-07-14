const {test} = require('tap');
const Scratch3SensingBlocks = require('../../src/blocks/scratch3_sensing');
const Runtime = require('../../src/engine/runtime');

test('isOnline', t => {
    const rt = new Runtime();
    const sensing = new Scratch3SensingBlocks(rt);

    if (!global.navigator) {
        global.navigator = {};
    }

    Object.defineProperty(global.navigator, 'onLine', {
        get: () => false,
        configurable: true,
        enumerable: true
    });
    t.equal(sensing.isOnline(), false);

    Object.defineProperty(global.navigator, 'onLine', {
        get: () => true,
        configurable: true,
        enumerable: true
    });
    t.equal(sensing.isOnline(), true);

    t.end();
});

test('stage dimensions', t => {
    const rt = new Runtime();
    const primitives = new Scratch3SensingBlocks(rt).getPrimitives();
    t.equal(primitives.sensing_stagewidth(), rt.stageWidth);
    t.equal(primitives.sensing_stageheight(), rt.stageHeight);
    t.end();
});
