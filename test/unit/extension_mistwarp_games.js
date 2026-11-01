const {test} = require('node:test');
const assert = require('node:assert');
const VirtualMachine = require('../../src/virtual-machine');

const {
    MistWarpPlayers,
    MistWarpMultiplayer,
    MistWarpData,
    MistWarpMarketplace,
    MistWarpInventory
} = require('../../src/extensions/mistwarp_games');

const makeRuntime = () => {
    const calls = [];
    const hats = [];
    let gameListener = null;
    const host = {
        whenReady: () => Promise.resolve(),
        getUser: () => ({loggedIn: true, username: 'player', id: '42'}),
        subscribe: listener => {
            gameListener = listener;
            return () => {
                gameListener = null;
            };
        },
        call: (method, args) => {
            calls.push({method, args});
            if (method === 'data.load') {
                return Promise.resolve({revision: 3, value: {coins: 12}});
            }
            if (method === 'data.save') {
                return Promise.resolve({revision: 4, value: args[0].value});
            }
            if (method === 'inventory.load' || method === 'inventory.grant') {
                return Promise.resolve({
                    revision: 2,
                    items: [{
                        id: 'origin:hat',
                        name: 'Hat',
                        quantity: 2,
                        visual: {type: 'image', url: 'https://assets.example/hat.png'}
                    }]
                });
            }
            if (method === 'inventory.configureItem') {
                return Promise.resolve({status: 'closed'});
            }
            if (method === 'multiplayer.connect') {
                return Promise.resolve({
                    connected: true,
                    self: '42',
                    players: [{id: '42', userId: 'account-42', username: 'player', state: {x: 1, score: 2}}]
                });
            }
            if (method === 'multiplayer.setState' || method === 'multiplayer.sendEvent') {
                return Promise.resolve(true);
            }
            return Promise.reject(new Error(`unexpected method: ${method}`));
        }
    };
    return {
        calls,
        hats,
        emitGameEvent: event => gameListener(event),
        mistwarpGameHost: host,
        startHats: opcode => hats.push(opcode)
    };
};

test('MistWarp Players reads trusted host identity', async () => {
    const runtime = makeRuntime();
    const players = new MistWarpPlayers(runtime);

    assert.strictEqual(await players.loggedIn(), true);
    assert.strictEqual(await players.username(), 'player');
    assert.strictEqual(await players.userId(), '42');
});

test('MistWarp Multiplayer tracks presence, state, and game events', async () => {
    const runtime = makeRuntime();
    const multiplayer = new MistWarpMultiplayer(runtime);

    await multiplayer.connect({ROOM: 'main'});
    assert.strictEqual(multiplayer.myPlayer(), '42');
    assert.strictEqual(multiplayer.playerInRoom({PLAYER: '42'}), true);
    assert.strictEqual(multiplayer.playerUsername({PLAYER: '42'}), 'player');
    assert.strictEqual(multiplayer.playerAccount({PLAYER: '42'}), 'account-42');
    assert.deepStrictEqual(JSON.parse(multiplayer.playerIds()), ['42']);

    runtime.emitGameEvent({
        type: 'player_joined',
        player: {id: '84', userId: 'account-84', username: 'friend', state: {}}
    });
    assert.strictEqual(multiplayer.joinedPlayer(), '84');
    assert.strictEqual(multiplayer.playerInRoom({PLAYER: '84'}), true);

    runtime.emitGameEvent({type: 'player_state', player: {id: '84', username: 'friend', state: {x: 8, score: 5}}});
    assert.strictEqual(multiplayer.statePlayer(), '84');
    assert.strictEqual(multiplayer.playerValue({PLAYER: '84', KEY: 'score'}), 5);

    runtime.emitGameEvent({type: 'player_left', player: {id: '84', username: 'friend'}});
    assert.strictEqual(multiplayer.leftPlayer(), '84');
    assert.strictEqual(multiplayer.playerInRoom({PLAYER: '84'}), false);
    assert.strictEqual(multiplayer.playerUsername({PLAYER: '84'}), 'friend');
    assert.strictEqual(multiplayer.playerAccount({PLAYER: '84'}), 'account-84');

    runtime.emitGameEvent({
        type: 'game_event',
        name: 'round.started',
        value: {round: 2},
        sender: {id: '42', username: 'player'}
    });
    assert.strictEqual(multiplayer.eventName(), 'round.started');
    assert.deepStrictEqual(JSON.parse(multiplayer.eventValue()), {round: 2});
    assert.strictEqual(multiplayer.eventSender(), '42');
    assert.deepStrictEqual(runtime.hats, [
        'mistwarpMultiplayer_whenJoined',
        'mistwarpMultiplayer_whenState',
        'mistwarpMultiplayer_whenLeft',
        'mistwarpMultiplayer_whenEvent'
    ]);
});

test('MistWarp Data loads, edits, and revision-saves JSON', async () => {
    const runtime = makeRuntime();
    const data = new MistWarpData(runtime);

    await data.load();
    assert.strictEqual(data.status(), 'loaded');
    assert.strictEqual(await data.get({KEY: 'coins'}), 12);
    assert.deepStrictEqual(runtime.hats, ['mistwarpData_whenLoaded']);

    data.set({KEY: 'position', VALUE: '{"x":10,"y":-4}'});
    await data.save();

    assert.strictEqual(data.status(), 'saved');
    assert.deepStrictEqual(JSON.parse(await data.all()), {coins: 12, position: {x: 10, y: -4}});
    assert.strictEqual(runtime.calls[1].method, 'data.save');
    assert.strictEqual(runtime.calls[1].args[0].revision, 3);
    assert.match(runtime.calls[1].args[0].requestId, /^mw_[a-z0-9]+_[a-z0-9]+$/);
    assert.deepStrictEqual(runtime.hats, ['mistwarpData_whenLoaded', 'mistwarpData_whenSaved']);
});

test('MistWarp Data accepts plain text and still rejects unsafe keys', async () => {
    const data = new MistWarpData(makeRuntime());

    assert.throws(() => data.set({KEY: '$internal', VALUE: '1'}), /Save key/);
    await data.load();
    data.set({KEY: 'greeting', VALUE: 'hello player'});
    data.set({KEY: 'coins', VALUE: '12'});
    assert.strictEqual(await data.get({KEY: 'greeting'}), 'hello player');
    assert.strictEqual(await data.get({KEY: 'coins'}), 12);
});

test('MistWarp Data loads on initialization and makes reads wait for it', async () => {
    const runtime = makeRuntime();
    let finishLoad;
    runtime.mistwarpGameHost.call = (method, args) => {
        runtime.calls.push({method, args});
        if (method === 'data.load') {
            return new Promise(resolve => {
                finishLoad = resolve;
            });
        }
        return Promise.reject(new Error(`unexpected method: ${method}`));
    };
    const data = new MistWarpData(runtime);

    assert.strictEqual(data.status(), 'loading');
    assert.strictEqual(runtime.calls.filter(call => call.method === 'data.load').length, 1);

    const coins = data.get({KEY: 'coins'});
    const all = data.all();
    const manualLoad = data.load();

    assert.strictEqual(runtime.calls.filter(call => call.method === 'data.load').length, 1);

    finishLoad({revision: 3, value: {coins: 12}});
    assert.strictEqual(await coins, 12);
    assert.deepStrictEqual(JSON.parse(await all), {coins: 12});
    await manualLoad;

    await data.load();
    assert.strictEqual(await data.get({KEY: 'coins'}), 12);
    assert.strictEqual(runtime.calls.filter(call => call.method === 'data.load').length, 1);
    assert.deepStrictEqual(runtime.hats, ['mistwarpData_whenLoaded']);
});

test('MistWarp Games palettes lead with common blocks and use distinct colors', () => {
    const runtime = makeRuntime();
    const info = [
        new MistWarpPlayers(runtime).getInfo(),
        new MistWarpMultiplayer(runtime).getInfo(),
        new MistWarpData(runtime).getInfo(),
        new MistWarpMarketplace(runtime).getInfo(),
        new MistWarpInventory(runtime).getInfo()
    ];

    assert.strictEqual(new Set(info.map(extension => extension.color1)).size, info.length);
    assert.deepStrictEqual(info.map(extension => extension.blocks.find(block => block && block.opcode).opcode), [
        'loggedIn',
        'connect',
        'load',
        'purchase',
        'load'
    ]);
    const names = info.map(extension => extension.name);
    [
        /Players/,
        /Multiplayer/,
        /Game Data/,
        /Game Shop/,
        /Player Items/
    ].forEach((pattern, index) => assert.match(names[index], pattern));
    const eventBlocks = info.flatMap(extension => extension.blocks)
        .filter(block => block && block.blockType === 'event');
    assert.strictEqual(eventBlocks.length, 8);
    assert.strictEqual(eventBlocks.every(block => block.isEdgeActivated === false), true);
});

test('MistWarp event hats register as externally triggered hats', () => {
    const vm = new VirtualMachine();
    vm.extensionManager.addBuiltinExtension('mistwarpMultiplayer', MistWarpMultiplayer);
    vm.extensionManager.addBuiltinExtension('mistwarpData', MistWarpData);
    vm.extensionManager.addBuiltinExtension('mistwarpInventory', MistWarpInventory);
    vm.extensionManager.addBuiltinExtension('mistwarpMarketplace', MistWarpMarketplace);
    vm.extensionManager.loadExtensionIdSync('mistwarpMultiplayer');
    vm.extensionManager.loadExtensionIdSync('mistwarpData');
    vm.extensionManager.loadExtensionIdSync('mistwarpInventory');
    vm.extensionManager.loadExtensionIdSync('mistwarpMarketplace');

    const hats = [
        'mistwarpMultiplayer_whenJoined',
        'mistwarpMultiplayer_whenLeft',
        'mistwarpMultiplayer_whenState',
        'mistwarpMultiplayer_whenEvent',
        'mistwarpData_whenLoaded',
        'mistwarpData_whenSaved',
        'mistwarpInventory_whenLoaded',
        'mistwarpMarketplace_whenPurchased'
    ];
    for (const opcode of hats) {
        assert.strictEqual(vm.runtime._hats[opcode].edgeActivated, false, `${opcode} is not a predicate hat`);
        assert.strictEqual(vm.runtime.getOpcodeFunction(opcode), undefined, `${opcode} does not need a block function`);
    }
    vm.quit();
});

test('MistWarp Inventory reads the server-filtered portable item list', async () => {
    const runtime = makeRuntime();
    const inventory = new MistWarpInventory(runtime);

    await inventory.load();
    assert.strictEqual(inventory.status(), 'loaded');
    assert.strictEqual(inventory.owns({ITEM: 'origin:hat'}), true);
    assert.strictEqual(inventory.quantity({ITEM: 'origin:hat'}), 2);
    assert.deepStrictEqual(JSON.parse(inventory.itemJSON({ITEM: 'origin:hat'})), {
        id: 'origin:hat',
        name: 'Hat',
        quantity: 2,
        visual: {type: 'image', url: 'https://assets.example/hat.png'}
    });
    assert.strictEqual(inventory.itemImage({ITEM: 'origin:hat'}), 'https://assets.example/hat.png');
    assert.deepStrictEqual(runtime.hats, ['mistwarpInventory_whenLoaded']);

    await inventory.award({ITEM: 'hat'});
    assert.strictEqual(runtime.calls[1].method, 'inventory.grant');
    assert.strictEqual(runtime.calls[1].args[0].item, 'hat');
    assert.match(runtime.calls[1].args[0].requestId, /^mw_/);
    assert.deepStrictEqual(runtime.hats, ['mistwarpInventory_whenLoaded', 'mistwarpInventory_whenLoaded']);
});

test('MistWarp Inventory defines a simple image item', async () => {
    const runtime = makeRuntime();
    const inventory = new MistWarpInventory(runtime);

    await inventory.defineItem({ITEM: 'hat', NAME: 'Hat', IMAGE: 'https://assets.example/hat.png'});
    assert.deepStrictEqual(runtime.calls[0], {
        method: 'inventory.configureItem',
        args: [{
            id: 'hat',
            name: 'Hat',
            visual: {type: 'image', url: 'https://assets.example/hat.png'},
            gameAwardable: true
        }]
    });
});

test('MistWarp Marketplace dynamic menus reflect runtime products', () => {
    const runtime = makeRuntime();
    runtime.getProducts = () => [
        {id: 'speed_boost', name: 'Speed Boost', price: 20},
        {id: 'vip', name: 'VIP Pass', price: 100}
    ];
    const marketplace = new MistWarpMarketplace(runtime);

    const selectMenu = marketplace.getProductSelectMenu();
    assert.deepStrictEqual(selectMenu, [
        {text: 'Speed Boost (speed_boost)', value: 'speed_boost'},
        {text: 'VIP Pass (vip)', value: 'vip'}
    ]);

    const filterMenu = marketplace.getProductsFilterMenu();
    assert.deepStrictEqual(filterMenu, [
        {text: 'any product', value: 'any'},
        {text: 'Speed Boost (speed_boost)', value: 'speed_boost'},
        {text: 'VIP Pass (vip)', value: 'vip'}
    ]);
});

test('MistWarp Marketplace purchase triggers hats and records status', async () => {
    const runtime = makeRuntime();
    const marketplace = new MistWarpMarketplace(runtime);

    runtime.mistwarpGameHost.call = (method, args) => {
        runtime.calls.push({method, args});
        if (method === 'marketplace.purchase') {
            return Promise.resolve({status: 'purchased'});
        }
        return Promise.reject(new Error(`unexpected: ${method}`));
    };

    await marketplace.purchase({PRODUCT: 'vip'});
    assert.strictEqual(runtime.calls[0].method, 'marketplace.purchase');
    assert.deepStrictEqual(runtime.calls[0].args, ['vip']);
    assert.strictEqual(marketplace.status(), 'purchased');
    assert.strictEqual(marketplace.purchasedProduct(), 'vip');
    assert.deepStrictEqual(runtime.hats, [
        'mistwarpMarketplace_whenPurchased',
        'mistwarpMarketplace_whenPurchased',
        'mistwarpMarketplace_whenPurchased'
    ]);
});

test('Runtime manages products and test entitlements', () => {
    const vm = new VirtualMachine();
    assert.deepStrictEqual(vm.getProducts(), []);
    assert.deepStrictEqual(vm.getTestEntitlements(), {});

    const products = [
        {id: 'vip', name: 'VIP Pass', price: 100, icon: 'data:image/webp;base64,123'}
    ];
    vm.setProducts(products);
    assert.deepStrictEqual(vm.getProducts(), products);

    assert.strictEqual(vm.ownsProduct('vip', 'player1'), false);
    assert.strictEqual(vm.grantProduct('vip', 'player1'), true);
    assert.strictEqual(vm.ownsProduct('vip', 'player1'), true);
    assert.strictEqual(vm.ownsProduct('vip', 'other'), false);

    assert.strictEqual(vm.revokeProduct('vip', 'player1'), true);
    assert.strictEqual(vm.ownsProduct('vip', 'player1'), false);

    vm.quit();
});
