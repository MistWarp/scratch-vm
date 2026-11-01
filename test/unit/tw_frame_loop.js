const {test} = require('node:test');
const assert = require('node:assert');
const Runtime = require('../../src/engine/runtime');

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

test('every step draws exactly once', () => {
    const rt = makeRuntime();
    for (let i = 0; i < 5; i++) {
        rt._step();
    }
    assert.strictEqual(rt.draws, 5);
});

test('steps do not draw while interpolation owns drawing', () => {
    const rt = makeRuntime();
    rt.setInterpolation(true);
    rt.start();
    rt._step();
    assert.strictEqual(rt.draws, 0);
    rt._renderInterpolatedPositions();
    assert.strictEqual(rt.draws, 1);
    rt.quit();
});

test('screenRefreshTime measures the gap between draws', () => {
    const rt = makeRuntime();
    let time = 1000;
    rt.frameLoop.now = () => time;
    rt._step();
    time += 33;
    rt._step();
    assert.strictEqual(rt.screenRefreshTime, 33);
});

test('framerates above 250 run several steps per timer tick and draw once', () => {
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
    assert.ok(steps >= 4);
    assert.strictEqual(rt.draws, 1);
    rt.quit();
});

test('screen refresh rate mode never gives the sequencer more than a 60 FPS budget', () => {
    const rt = makeRuntime();
    rt.setFramerate(0);
    rt.start();
    rt.frameLoop._lastRefreshTime = 1;
    rt.frameLoop.refreshStepCallback();
    assert.ok(rt.currentStepTime <= 1000 / 60);
    assert.ok(rt.currentStepTime >= 4);
    rt.quit();
});
