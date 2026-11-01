const tap = require('tap');
const Runtime = require('../../src/engine/runtime');

const test = tap.test;

test('step listeners run before and after each step until removed', t => {
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
    t.same(calls, ['before', 'threads', 'after']);
    remove();
    remove();
    calls.length = 0;
    rt._step();
    t.same(calls, ['threads']);
    t.equal(rt._beforeStepListeners, null);
    t.equal(rt._afterStepListeners, null);
    t.end();
});

test('step listeners can be added with only one side', t => {
    const rt = new Runtime();
    const calls = [];
    const removeAfter = rt.addStepListener({after: () => calls.push('after')});
    rt.addStepListener({before: () => calls.push('before')});
    rt._step();
    removeAfter();
    rt._step();
    t.same(calls, ['before', 'after', 'before']);
    t.throws(() => rt.addStepListener({}), TypeError);
    t.end();
});

test('removing one step listener keeps another that uses the same function', t => {
    const rt = new Runtime();
    let count = 0;
    const after = () => {
        count++;
    };
    const removeFirst = rt.addStepListener({after});
    rt.addStepListener({after});
    removeFirst();
    rt._step();
    t.equal(count, 1);
    t.end();
});

test('a step listener that removes itself does not skip the others', t => {
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
    t.same(calls, ['first', 'second', 'second']);
    t.end();
});

test('_step stays a writable prototype method that wrappers still reach', t => {
    const descriptor = Object.getOwnPropertyDescriptor(Runtime.prototype, '_step');
    t.ok(descriptor.writable);
    const rt = new Runtime();
    const calls = [];
    rt.addStepListener({after: () => calls.push('listener')});
    const original = rt._step;
    rt._step = function () {
        original.call(this);
        calls.push('wrapper');
    };
    rt._step();
    t.same(calls, ['listener', 'wrapper']);
    t.end();
});
