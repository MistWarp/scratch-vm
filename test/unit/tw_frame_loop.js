const tap = require('tap');
const Runtime = require('../../src/engine/runtime');

const test = tap.test;

const makeRuntime = () => {
    const rt = new Runtime();
    rt.draws = 0;
    rt.renderer = {
        draw: () => {
            rt.draws++;
        }
    };
    return rt;
};

test('every step draws exactly once', t => {
    const rt = makeRuntime();
    for (let i = 0; i < 5; i++) {
        rt._step();
    }
    t.equal(rt.draws, 5);
    t.end();
});

test('steps do not draw while interpolation owns drawing', t => {
    const rt = makeRuntime();
    rt.setInterpolation(true);
    rt.start();
    rt._step();
    t.equal(rt.draws, 0);
    rt._renderInterpolatedPositions();
    t.equal(rt.draws, 1);
    rt.quit();
    t.end();
});

test('screenRefreshTime measures the gap between draws', t => {
    const rt = makeRuntime();
    let time = 1000;
    rt.frameLoop.now = () => time;
    rt._step();
    time += 33;
    rt._step();
    t.equal(rt.screenRefreshTime, 33);
    t.end();
});

test('framerates above 250 run several steps per timer tick and draw once', t => {
    const rt = makeRuntime();
    rt.setFramerate(1000);
    rt.start();
    clearInterval(rt.frameLoop._stepInterval);
    let steps = 0;
    const originalStep = rt._step;
    rt._step = function () {
        steps++;
        return originalStep.call(this);
    };
    rt.frameLoop._lastStepTime -= 4;
    rt.frameLoop.fastStepCallback();
    t.ok(steps >= 4);
    t.equal(rt.draws, 1);
    rt.quit();
    t.end();
});

test('screen refresh rate mode never gives the sequencer more than a 60 FPS budget', t => {
    const rt = makeRuntime();
    rt.setFramerate(0);
    rt.start();
    rt.frameLoop._lastRefreshTime = 1;
    rt.frameLoop.refreshStepCallback();
    t.ok(rt.currentStepTime <= 1000 / 60);
    t.ok(rt.currentStepTime >= 4);
    rt.quit();
    t.end();
});
