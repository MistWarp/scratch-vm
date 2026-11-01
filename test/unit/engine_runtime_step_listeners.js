const {test} = require('node:test');
const assert = require('node:assert');
const Runtime = require('../../src/engine/runtime');

test('step listeners run before and after each step until removed', () => {
    const rt = new Runtime();
    const calls = [];
    rt.sequencer.stepThreads = () => {
        calls.push('threads');
        return [];
    };
    const remove = rt.addStepListener({
        before: () => calls.push('before'),
        after: () => calls.push('after')
    });
    rt._step();
    assert.deepStrictEqual(calls, ['before', 'threads', 'after']);
    remove();
    remove();
    calls.length = 0;
    rt._step();
    assert.deepStrictEqual(calls, ['threads']);
    assert.strictEqual(rt._beforeStepListeners, null);
    assert.strictEqual(rt._afterStepListeners, null);
});

test('step listeners can be added with only one side', () => {
    const rt = new Runtime();
    const calls = [];
    const removeAfter = rt.addStepListener({after: () => calls.push('after')});
    rt.addStepListener({before: () => calls.push('before')});
    rt._step();
    removeAfter();
    rt._step();
    assert.deepStrictEqual(calls, ['before', 'after', 'before']);
    assert.throws(() => rt.addStepListener({}), TypeError);
});

test('removing one step listener keeps another that uses the same function', () => {
    const rt = new Runtime();
    let count = 0;
    const after = () => {
        count++;
    };
    const removeFirst = rt.addStepListener({after});
    rt.addStepListener({after});
    removeFirst();
    rt._step();
    assert.strictEqual(count, 1);
});

test('a step listener that removes itself does not skip the others', () => {
    const rt = new Runtime();
    const calls = [];
    const removeFirst = rt.addStepListener({
        after: () => {
            calls.push('first');
            removeFirst();
        }
    });
    rt.addStepListener({after: () => calls.push('second')});
    rt._step();
    rt._step();
    assert.deepStrictEqual(calls, ['first', 'second', 'second']);
});

test('_step stays a writable prototype method that wrappers still reach', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Runtime.prototype, '_step');
    assert.ok(descriptor.writable);
    const rt = new Runtime();
    const calls = [];
    rt.addStepListener({after: () => calls.push('listener')});
    const original = rt._step;
    rt._step = function () {
        original.call(this);
        calls.push('wrapper');
    };
    rt._step();
    assert.deepStrictEqual(calls, ['listener', 'wrapper']);
});
