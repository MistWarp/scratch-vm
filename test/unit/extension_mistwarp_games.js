const test = require('tap').test;
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
            if (method === 'data.global') {
                return Promise.resolve({revision: 1, value: {colour: 'purple'}});
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

test('MistWarp Players reads trusted host identity', async t => {
    const runtime = makeRuntime();
    const players = new MistWarpPlayers(runtime);

    t.equal(await players.loggedIn(), true);
    t.equal(await players.username(), 'player');
    t.equal(await players.userId(), '42');
    t.equal(await players.globalData({KEY: 'colour'}), 'purple');
    t.equal(players.getInfo().blocks.find(block => block.opcode === 'globalData').hideFromPalette, true);
    t.end();
});

test('MistWarp Multiplayer tracks presence, state, and game events', async t => {
    const runtime = makeRuntime();
    const multiplayer = new MistWarpMultiplayer(runtime);

    await multiplayer.connect({ROOM: 'main'});
    t.equal(multiplayer.myPlayer(), '42');
    t.equal(multiplayer.playerInRoom({PLAYER: '42'}), true);
    t.equal(multiplayer.playerUsername({PLAYER: '42'}), 'player');
    t.equal(multiplayer.playerAccount({PLAYER: '42'}), 'account-42');
    t.same(JSON.parse(multiplayer.playerIds()), ['42']);

    runtime.emitGameEvent({
        type: 'player_joined',
        player: {id: '84', userId: 'account-84', username: 'friend', state: {}}
    });
    t.equal(multiplayer.joinedPlayer(), '84');
    t.equal(multiplayer.playerInRoom({PLAYER: '84'}), true);

    runtime.emitGameEvent({type: 'player_state', player: {id: '84', username: 'friend', state: {x: 8, score: 5}}});
    t.equal(multiplayer.statePlayer(), '84');
    t.equal(multiplayer.playerValue({PLAYER: '84', KEY: 'score'}), 5);

    runtime.emitGameEvent({type: 'player_left', player: {id: '84', username: 'friend'}});
    t.equal(multiplayer.leftPlayer(), '84');
    t.equal(multiplayer.playerInRoom({PLAYER: '84'}), false);
    t.equal(multiplayer.playerUsername({PLAYER: '84'}), 'friend');
    t.equal(multiplayer.playerAccount({PLAYER: '84'}), 'account-84');

    runtime.emitGameEvent({
        type: 'game_event',
        name: 'round.started',
        value: {round: 2},
        sender: {id: '42', username: 'player'}
    });
    t.equal(multiplayer.eventName(), 'round.started');
    t.same(JSON.parse(multiplayer.eventValue()), {round: 2});
    t.equal(multiplayer.eventSender(), '42');
    t.same(runtime.hats, [
        'mistwarpMultiplayer_whenJoined',
        'mistwarpMultiplayer_whenState',
        'mistwarpMultiplayer_whenLeft',
        'mistwarpMultiplayer_whenEvent'
    ]);
    t.end();
});

test('MistWarp Data loads, edits, and revision-saves JSON', async t => {
    const runtime = makeRuntime();
    const data = new MistWarpData(runtime);

    await data.load();
    t.equal(data.status(), 'loaded');
    t.equal(data.get({KEY: 'coins'}), 12);
    t.same(runtime.hats, ['mistwarpData_whenLoaded']);

    data.set({KEY: 'position', VALUE: '{"x":10,"y":-4}'});
    await data.save();

    t.equal(data.status(), 'saved');
    t.same(JSON.parse(data.all()), {coins: 12, position: {x: 10, y: -4}});
    t.equal(runtime.calls[1].method, 'data.save');
    t.equal(runtime.calls[1].args[0].revision, 3);
    t.match(runtime.calls[1].args[0].requestId, /^mw_[a-z0-9]+_[a-z0-9]+$/);
    t.same(runtime.hats, ['mistwarpData_whenLoaded', 'mistwarpData_whenSaved']);
    t.end();
});

test('MistWarp Data accepts plain text and still rejects unsafe keys', t => {
    const data = new MistWarpData(makeRuntime());

    t.throws(() => data.set({KEY: '$internal', VALUE: '1'}), /Save key/);
    data.set({KEY: 'greeting', VALUE: 'hello player'});
    data.set({KEY: 'coins', VALUE: '12'});
    t.equal(data.get({KEY: 'greeting'}), 'hello player');
    t.equal(data.get({KEY: 'coins'}), 12);
    t.end();
});

test('MistWarp Games palettes lead with common blocks and use distinct colors', t => {
    const runtime = makeRuntime();
    const info = [
        new MistWarpPlayers(runtime).getInfo(),
        new MistWarpMultiplayer(runtime).getInfo(),
        new MistWarpData(runtime).getInfo(),
        new MistWarpMarketplace(runtime).getInfo(),
        new MistWarpInventory(runtime).getInfo()
    ];

    t.equal(new Set(info.map(extension => extension.color1)).size, info.length);
    t.same(info.map(extension => extension.blocks.find(block => block && block.opcode).opcode), [
        'loggedIn',
        'connect',
        'load',
        'open',
        'load'
    ]);
    t.match(info.map(extension => extension.name), [
        /Players/,
        /Multiplayer/,
        /Game Data/,
        /Game Shop/,
        /Player Items/
    ]);
    const eventBlocks = info.flatMap(extension => extension.blocks)
        .filter(block => block && block.blockType === 'event');
    t.equal(eventBlocks.length, 7);
    t.equal(eventBlocks.every(block => block.isEdgeActivated === false), true);
    t.end();
});

test('MistWarp event hats register as externally triggered hats', t => {
    const vm = new VirtualMachine();
    vm.extensionManager.addBuiltinExtension('mistwarpMultiplayer', MistWarpMultiplayer);
    vm.extensionManager.addBuiltinExtension('mistwarpData', MistWarpData);
    vm.extensionManager.addBuiltinExtension('mistwarpInventory', MistWarpInventory);
    vm.extensionManager.loadExtensionIdSync('mistwarpMultiplayer');
    vm.extensionManager.loadExtensionIdSync('mistwarpData');
    vm.extensionManager.loadExtensionIdSync('mistwarpInventory');

    const hats = [
        'mistwarpMultiplayer_whenJoined',
        'mistwarpMultiplayer_whenLeft',
        'mistwarpMultiplayer_whenState',
        'mistwarpMultiplayer_whenEvent',
        'mistwarpData_whenLoaded',
        'mistwarpData_whenSaved',
        'mistwarpInventory_whenLoaded'
    ];
    for (const opcode of hats) {
        t.equal(vm.runtime._hats[opcode].edgeActivated, false, `${opcode} is not a predicate hat`);
        t.equal(vm.runtime.getOpcodeFunction(opcode), undefined, `${opcode} does not need a block function`);
    }
    vm.quit();
    t.end();
});

test('MistWarp Inventory reads the server-filtered portable item list', async t => {
    const runtime = makeRuntime();
    const inventory = new MistWarpInventory(runtime);

    await inventory.load();
    t.equal(inventory.status(), 'loaded');
    t.equal(inventory.owns({ITEM: 'origin:hat'}), true);
    t.equal(inventory.quantity({ITEM: 'origin:hat'}), 2);
    t.same(JSON.parse(inventory.itemJSON({ITEM: 'origin:hat'})), {
        id: 'origin:hat',
        name: 'Hat',
        quantity: 2,
        visual: {type: 'image', url: 'https://assets.example/hat.png'}
    });
    t.equal(inventory.itemImage({ITEM: 'origin:hat'}), 'https://assets.example/hat.png');
    t.same(runtime.hats, ['mistwarpInventory_whenLoaded']);

    await inventory.award({ITEM: 'hat'});
    t.equal(runtime.calls[1].method, 'inventory.grant');
    t.equal(runtime.calls[1].args[0].item, 'hat');
    t.match(runtime.calls[1].args[0].requestId, /^mw_/);
    t.same(runtime.hats, ['mistwarpInventory_whenLoaded', 'mistwarpInventory_whenLoaded']);
    t.end();
});

test('MistWarp Inventory defines a simple image item', async t => {
    const runtime = makeRuntime();
    const inventory = new MistWarpInventory(runtime);

    await inventory.defineItem({ITEM: 'hat', NAME: 'Hat', IMAGE: 'https://assets.example/hat.png'});
    t.same(runtime.calls[0], {
        method: 'inventory.configureItem',
        args: [{
            id: 'hat',
            name: 'Hat',
            visual: {type: 'image', url: 'https://assets.example/hat.png'},
            gameAwardable: true
        }]
    });

    t.end();
});
