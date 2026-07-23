const test = require('tap').test;
const Runtime = require('../../src/engine/runtime');

const makeRuntime = spriteCount => {
    const runtime = new Runtime();
    const stage = {isStage: true, id: 'stage'};
    runtime.executableTargets = [stage];
    const sprites = [];
    for (let i = 0; i < spriteCount; i++) {
        const sprite = {isStage: false, id: `sprite${i}`};
        sprites.push(sprite);
        runtime.executableTargets.push(sprite);
    }
    return {runtime, stage, sprites};
};

const order = runtime => runtime.executableTargets.map(target => target.id).join(',');

test('setExecutablePosition matches the splice-based reordering it replaced', t => {
    const referenceMove = (targets, oldIndex, delta) => {
        const copy = targets.slice();
        const moved = copy[oldIndex];
        copy.splice(oldIndex, 1);
        let newIndex = oldIndex + delta;
        if (newIndex > copy.length) newIndex = copy.length;
        if (newIndex <= 0) newIndex = (copy.length > 0 && copy[0].isStage) ? 1 : 0;
        copy.splice(newIndex, 0, moved);
        return copy.map(target => target.id).join(',');
    };

    for (let spriteCount = 1; spriteCount <= 8; spriteCount++) {
        for (let from = 0; from <= spriteCount; from++) {
            for (let delta = -(spriteCount + 2); delta <= spriteCount + 2; delta++) {
                const {runtime} = makeRuntime(spriteCount);
                const expected = referenceMove(runtime.executableTargets, from, delta);
                runtime.moveExecutable(runtime.executableTargets[from], delta);
                t.equal(order(runtime), expected, `n=${spriteCount} from=${from} delta=${delta}`);
            }
        }
    }
    t.end();
});

test('go to front and back put targets at the ends, keeping the stage first', t => {
    const {runtime, sprites} = makeRuntime(4);
    runtime.setExecutablePosition(sprites[3], Infinity);
    t.equal(order(runtime), 'stage,sprite0,sprite1,sprite2,sprite3', 'front means last in execution order');

    runtime.setExecutablePosition(sprites[0], Infinity);
    t.equal(order(runtime), 'stage,sprite1,sprite2,sprite3,sprite0', 'moving to front shifts the rest down');

    runtime.setExecutablePosition(sprites[0], -Infinity);
    t.equal(order(runtime), 'stage,sprite0,sprite1,sprite2,sprite3', 'back means just after the stage');
    t.end();
});

test('repositioning a target that is already in place changes nothing', t => {
    const {runtime, sprites} = makeRuntime(4);
    const before = order(runtime);
    const returned = runtime.setExecutablePosition(sprites[0], -Infinity);
    t.equal(order(runtime), before, 'order is untouched');
    t.equal(returned, 1, 'still reports the resting index');

    const front = runtime.setExecutablePosition(sprites[3], Infinity);
    t.equal(order(runtime), before, 'front target already at the end stays put');
    t.equal(front, 4, 'reports the last index');
    t.end();
});
