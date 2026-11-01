const {test} = require('node:test');
const assert = require('node:assert');
const VirtualMachine = require('../../src/virtual-machine');

const makeVM = () => {
    const vm = new VirtualMachine();
    const loads = [];
    vm._loadProjectDirectly = (input, options) => {
        loads.push([input, options]);
        return Promise.resolve('loaded');
    };
    return {vm, loads};
};

test('loadProject without interceptors loads directly', async () => {
    const {vm, loads} = makeVM();
    assert.strictEqual(await vm.loadProject('a'), 'loaded');
    assert.deepStrictEqual(loads, [['a', {}]]);
});

test('interceptors wrap the load, the last added outermost', async () => {
    const {vm, loads} = makeVM();
    const calls = [];
    vm.addLoadProjectInterceptor(async (input, options, next) => {
        calls.push(`inner ${input}`);
        const result = await next();
        calls.push('inner done');
        return result;
    });
    vm.addLoadProjectInterceptor((input, options, next) => {
        calls.push(`outer ${input} ${options.flag}`);
        return next('b', {flag: 2});
    });
    assert.strictEqual(await vm.loadProject('a', {flag: 1}), 'loaded');
    assert.deepStrictEqual(calls, ['outer a 1', 'inner b', 'inner done']);
    assert.deepStrictEqual(loads, [['b', {flag: 2}]]);
});

test('an interceptor can refuse a load by throwing', async () => {
    const {vm, loads} = makeVM();
    vm.addLoadProjectInterceptor(() => {
        throw new Error('no');
    });
    let returned = null;
    assert.doesNotThrow(() => {
        returned = vm.loadProject('a');
    });
    await assert.rejects(returned, /no/);
    assert.deepStrictEqual(loads, []);
});

test('removing an interceptor leaves the others in any order', async () => {
    const {vm} = makeVM();
    const calls = [];
    const removeFirst = vm.addLoadProjectInterceptor((input, options, next) => {
        calls.push('first');
        return next();
    });
    vm.addLoadProjectInterceptor((input, options, next) => {
        calls.push('second');
        return next();
    });
    removeFirst();
    removeFirst();
    await vm.loadProject('a');
    assert.deepStrictEqual(calls, ['second']);
    assert.throws(() => vm.addLoadProjectInterceptor(null), TypeError);
});

test('patches of loadProject still wrap the interceptors', async () => {
    const {vm} = makeVM();
    const calls = [];
    vm.addLoadProjectInterceptor((input, options, next) => {
        calls.push('interceptor');
        return next();
    });
    const original = vm.loadProject;
    vm.loadProject = function (...args) {
        calls.push('patch');
        return original.apply(this, args);
    };
    await vm.loadProject('a');
    assert.deepStrictEqual(calls, ['patch', 'interceptor']);
});
