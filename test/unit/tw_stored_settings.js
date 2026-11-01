const {test} = require('node:test');
const assert = require('node:assert');
const path = require('path');
const readFileToBuffer = require('../fixtures/readProjectFile').readFileToBuffer;
const makeTestStorage = require('../fixtures/make-test-storage');
const VirtualMachine = require('../../src/virtual-machine');

const makeVM = () => {
    const vm = new VirtualMachine();
    vm.attachStorage(makeTestStorage());
    return vm;
};

for (const file of ['empty-comment.sb3', 'no-comment.sb3']) {
    test(`serializes and deserializes settings (${file})`, async () => {
        const project = readFileToBuffer(path.resolve(__dirname, `../fixtures/tw-stored-settings/${file}`));
        const vm = makeVM();
        await vm.loadProject(project);
        vm.setFramerate(45);
        vm.setTurboMode(true);
        vm.setInterpolation(true);
        vm.setRuntimeOptions({
            maxClones: Infinity,
            miscLimits: false,
            fencing: false
        });
        vm.setStageSize(100, 101);
        vm.storeProjectOptions();

        const newVM = makeVM();
        await newVM.loadProject(vm.toJSON());
        assert.strictEqual(newVM.runtime.framerate, vm.runtime.framerate);
        assert.strictEqual(newVM.runtime.turboMode, vm.runtime.turboMode);
        assert.deepEqual(newVM.runtime.runtimeOptions, vm.runtime.runtimeOptions);
        assert.strictEqual(newVM.runtime.interpolationEnabled, vm.runtime.interpolationEnabled);
        assert.strictEqual(newVM.runtime.stageWidth, vm.runtime.stageWidth);
        assert.strictEqual(newVM.runtime.stageHeight, vm.runtime.stageHeight);
    });
}

test('Reuses comment if it already exists', async () => {
    const project = readFileToBuffer(path.resolve(__dirname, `../fixtures/tw-stored-settings/empty-comment.sb3`));
    const vm = makeVM();
    await vm.loadProject(project);
    assert.strictEqual(Object.keys(vm.runtime.getTargetForStage().comments).length, 1);
    vm.setFramerate(99);
    vm.storeProjectOptions();
    assert.strictEqual(Object.keys(vm.runtime.getTargetForStage().comments).length, 1);
});

test('Storing settings emits workspace update only when stage open', async () => {
    const project = readFileToBuffer(path.resolve(__dirname, `../fixtures/tw-stored-settings/sprite.sb3`));
    const vm = makeVM();
    await vm.loadProject(project);
    let didFireUpdate = false;
    vm.on('workspaceUpdate', () => {
        didFireUpdate = true;
    });
    vm.storeProjectOptions();
    assert.strictEqual(didFireUpdate, false);
    vm.setEditingTarget(vm.runtime.getTargetForStage().id);
    vm.storeProjectOptions();
    assert.strictEqual(didFireUpdate, true);
});

test('Storing settings emits project changed', async t => {
    const project = readFileToBuffer(path.resolve(__dirname, `../fixtures/tw-stored-settings/sprite.sb3`));
    const vm = makeVM();
    await vm.loadProject(project);
    t.plan(1);
    vm.on('PROJECT_CHANGED', () => {
        t.assert.ok(true);
    });
    vm.storeProjectOptions();
});

test('Stored turbo mode emits event on VM', async t => {
    const vm = makeVM();
    const project = readFileToBuffer(path.resolve(__dirname, '../fixtures/tw-stored-settings/turbo-mode.sb3'));
    t.plan(1);
    vm.on('TURBO_MODE_ON', () => {
        t.assert.ok(true, 'emitted TURBO_MODE_ON');
    });
    await vm.loadProject(project);
});

test('Can store and load mistwarpTheme', async () => {
    const project = readFileToBuffer(path.resolve(__dirname, '../fixtures/tw-stored-settings/no-comment.sb3'));
    const vm = makeVM();
    await vm.loadProject(project);

    const themePayload = {
        type: 'standard',
        data: {
            accent: 'red',
            gui: 'light',
            blocks: 'three',
            menuBarAlign: 'left'
        }
    };

    vm.storeProjectOptions({
        mistwarpTheme: themePayload
    });

    const newVM = makeVM();
    await newVM.loadProject(vm.toJSON());
    const stored = newVM.runtime.getStoredProjectOptions();
    assert.ok(stored, 'stored options exist');
    assert.deepStrictEqual(stored.mistwarpTheme, themePayload, 'mistwarpTheme payload round-trips');
});

test('Can store and load products and testEntitlements', async () => {
    const project = readFileToBuffer(path.resolve(__dirname, '../fixtures/tw-stored-settings/no-comment.sb3'));
    const vm = makeVM();
    await vm.loadProject(project);

    const products = [
        {id: 'double_jump', name: 'Double Jump', price: 25, icon: 'data:image/webp;base64,abc'}
    ];
    const testEntitlements = {
        double_jump: ['alice', 'bob']
    };

    vm.setProducts(products);
    vm.setTestEntitlements(testEntitlements);

    const newVM = makeVM();
    await newVM.loadProject(vm.toJSON());
    const stored = newVM.runtime.getStoredProjectOptions();
    assert.ok(stored, 'stored options exist');
    assert.deepStrictEqual(stored.products, products, 'products payload round-trips');
    assert.deepStrictEqual(stored.testEntitlements, testEntitlements, 'testEntitlements payload round-trips');
    assert.deepStrictEqual(newVM.getProducts(), products, 'newVM getProducts returns stored products');
    assert.strictEqual(newVM.ownsProduct('double_jump', 'alice'), true, 'newVM ownsProduct works for alice');
    assert.strictEqual(newVM.ownsProduct('double_jump', 'charlie'), false, 'newVM ownsProduct works for charlie');
});


test('category order is stored in the project and survives other settings changes', async () => {
    const project = readFileToBuffer(path.resolve(__dirname, `../fixtures/tw-stored-settings/no-comment.sb3`));
    const vm = makeVM();
    await vm.loadProject(project);
    assert.deepStrictEqual(vm.runtime.getCategoryOrder(), []);
    vm.runtime.setCategoryOrder(['looks', 'motion', 'pen']);
    vm.setFramerate(45);
    vm.storeProjectOptions();

    const newVM = makeVM();
    await newVM.loadProject(vm.toJSON());
    assert.deepStrictEqual(newVM.runtime.getCategoryOrder(), ['looks', 'motion', 'pen']);
    assert.strictEqual(newVM.runtime.frameLoop.framerate, 45);
    newVM.runtime.setCategoryOrder([]);
    assert.deepStrictEqual(newVM.runtime.getCategoryOrder(), []);
    const comment = newVM.runtime.findProjectOptionsComment();
    assert.ok(!comment.text.includes('categoryOrder'));
});
