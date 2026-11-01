const tap = require('tap');
const VirtualMachine = require('../../src/virtual-machine');

const test = tap.test;

const makeVM = () => {
    const vm = new VirtualMachine();
    const loads = [];
    vm._loadProjectDirectly = (input, options) => {
        loads.push([input, options]);
        return Promise.resolve('loaded');
    };
    return {vm, loads};
};

test('loadProject without interceptors loads directly', async t => {
    const {vm, loads} = makeVM();
    t.equal(await vm.loadProject('a'), 'loaded');
    t.same(loads, [['a', {}]]);
    t.end();
});

test('interceptors wrap the load, the last added outermost', async t => {
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
    t.equal(await vm.loadProject('a', {flag: 1}), 'loaded');
    t.same(calls, ['outer a 1', 'inner b', 'inner done']);
    t.same(loads, [['b', {flag: 2}]]);
    t.end();
});

test('an interceptor can refuse a load by throwing', async t => {
    const {vm, loads} = makeVM();
    vm.addLoadProjectInterceptor(() => {
        throw new Error('no');
    });
    let returned = null;
    t.doesNotThrow(() => {
        returned = vm.loadProject('a');
    });
    await t.rejects(returned, /no/);
    t.same(loads, []);
    t.end();
});

test('removing an interceptor leaves the others in any order', async t => {
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
    t.same(calls, ['second']);
    t.throws(() => vm.addLoadProjectInterceptor(null), TypeError);
    t.end();
});

test('patches of loadProject still wrap the interceptors', async t => {
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
    t.same(calls, ['patch', 'interceptor']);
    t.end();
});
