const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const {loadCostumeFromAsset} = require('../../import/load-costume');
const {getHost, getState, parseJSON, stringify, requestId} = require('./core');

const COLORS = {
    players: {color1: '#3373c4', color2: '#285fa5', color3: '#214e88'},
    multiplayer: {color1: '#6654d1', color2: '#5343b6', color3: '#443692'},
    data: {color1: '#277a59', color2: '#20664a', color3: '#1a523c'},
    marketplace: {color1: '#b85c18', color2: '#984b14', color3: '#7b3d11'},
    inventory: {color1: '#247e8b', color2: '#1d6873', color3: '#18555e'}
};

const label = text => ({blockType: BlockType.LABEL, text});
const eventBlock = (opcode, text) => ({
    opcode,
    blockType: BlockType.EVENT,
    text,
    isEdgeActivated: false
});

const parseSaveValue = value => {
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch (e) {
        return value;
    }
};

const showImageOnTarget = async (runtime, util, url, name) => {
    const existing = util.target.getCostumeIndexByName(name);
    if (existing !== -1) {
        util.target.setCostume(existing);
        return;
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error('Could not load item image');
    const contentType = response.headers.get('Content-Type') || '';
    const storage = runtime.storage;
    const isSvg = contentType.includes('svg');
    const dataFormat = isSvg ? storage.DataFormat.SVG :
        contentType.includes('jpeg') ? storage.DataFormat.JPG : storage.DataFormat.PNG;
    const assetType = isSvg ? storage.AssetType.ImageVector : storage.AssetType.ImageBitmap;
    const data = new Uint8Array(await response.arrayBuffer());
    const asset = storage.createAsset(assetType, dataFormat, data, null, true);
    const costume = {
        name,
        asset,
        assetId: asset.assetId,
        md5: `${asset.assetId}.${dataFormat}`,
        dataFormat,
        bitmapResolution: 1
    };
    await loadCostumeFromAsset(costume, runtime);
    util.target.addCostume(costume);
    util.target.setCostume(util.target.getCostumes().length - 1);
};

class MistWarpPlayers {
    constructor (runtime) {
        this.runtime = runtime;
    }

    getInfo () {
        return {
            id: 'mistwarpPlayers',
            name: 'Players',
            ...COLORS.players,
            blocks: [
                {opcode: 'loggedIn', blockType: BlockType.BOOLEAN, text: 'signed in to MistWarp?'},
                {opcode: 'username', blockType: BlockType.REPORTER, text: 'my MistWarp username'},
                {opcode: 'avatar',
                    blockType: BlockType.REPORTER,
                    text: 'avatar URL for [USER]',
                    arguments: {
                        USER: {type: ArgumentType.STRING, defaultValue: 'username'}
                    }},
                {opcode: 'banner',
                    blockType: BlockType.REPORTER,
                    text: 'banner URL for [USER]',
                    arguments: {
                        USER: {type: ArgumentType.STRING, defaultValue: 'username'}
                    }},
                {opcode: 'showProfileImage',
                    blockType: BlockType.COMMAND,
                    text: 'use [USER] [KIND] on this sprite',
                    arguments: {
                        KIND: {type: ArgumentType.STRING, menu: 'profileImageKind'},
                        USER: {type: ArgumentType.STRING, defaultValue: 'username'}
                    }},
                {opcode: 'userId', blockType: BlockType.REPORTER, text: 'my MistWarp user ID'},
                {opcode: 'globalData',
                    blockType: BlockType.REPORTER,
                    text: 'account game data [KEY]',
                    hideFromPalette: true,
                    arguments: {
                        KEY: {type: ArgumentType.STRING, defaultValue: 'key'}
                    }}
            ],
            menus: {
                profileImageKind: {acceptReporters: true, items: ['avatar', 'banner']}
            }
        };
    }

    async _user () {
        const host = getHost(this.runtime);
        await host.whenReady();
        return host.getUser();
    }

    async loggedIn () {
        return Boolean((await this._user()).loggedIn);
    }

    async username () {
        return (await this._user()).username || '';
    }

    async userId () {
        return (await this._user()).id || '';
    }

    avatar (args) {
        return `https://avatars.rotur.dev/${encodeURIComponent(String(args.USER || '').toLowerCase())}`;
    }

    banner (args) {
        return `https://avatars.rotur.dev/.banners/${encodeURIComponent(String(args.USER || '').toLowerCase())}`;
    }

    async showProfileImage (args, util) {
        const kind = String(args.KIND || 'avatar');
        const username = String(args.USER || '').toLowerCase();
        const url = kind === 'banner' ? this.banner({USER: username}) : this.avatar({USER: username});
        const name = `MistWarp ${kind} ${username}`;
        const existing = util.target.getCostumeIndexByName(name);
        if (existing !== -1) {
            util.target.setCostume(existing);
            return;
        }
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Could not load ${kind}`);
        const contentType = response.headers.get('Content-Type') || '';
        const storage = this.runtime.storage;
        const isSvg = contentType.includes('svg');
        const dataFormat = isSvg ? storage.DataFormat.SVG :
            contentType.includes('jpeg') ? storage.DataFormat.JPG : storage.DataFormat.PNG;
        const assetType = isSvg ? storage.AssetType.ImageVector : storage.AssetType.ImageBitmap;
        const data = new Uint8Array(await response.arrayBuffer());
        const asset = storage.createAsset(assetType, dataFormat, data, null, true);
        const costume = {
            name,
            asset,
            assetId: asset.assetId,
            md5: `${asset.assetId}.${dataFormat}`,
            dataFormat,
            bitmapResolution: 1
        };
        await loadCostumeFromAsset(costume, this.runtime);
        util.target.addCostume(costume);
        util.target.setCostume(util.target.getCostumes().length - 1);
    }

    async globalData (args) {
        const result = await getHost(this.runtime).call('data.global', []);
        const value = result && result.value ? result.value[args.KEY] : null;
        return stringify(value);
    }

}

class MistWarpData {
    constructor (runtime) {
        this.runtime = runtime;
    }

    getInfo () {
        return {
            id: 'mistwarpData',
            name: 'Game Data',
            ...COLORS.data,
            blocks: [
                {opcode: 'load', blockType: BlockType.COMMAND, text: 'load my save'},
                eventBlock('whenLoaded', 'when my save loads'),
                {opcode: 'get',
                    blockType: BlockType.REPORTER,
                    text: 'saved [KEY]',
                    arguments: {
                        KEY: {type: ArgumentType.STRING, defaultValue: 'key'}
                    }},
                {opcode: 'set',
                    blockType: BlockType.COMMAND,
                    text: 'set saved [KEY] to [VALUE]',
                    arguments: {
                        KEY: {type: ArgumentType.STRING, defaultValue: 'key'},
                        VALUE: {type: ArgumentType.STRING, defaultValue: 'value'}
                    }},
                {opcode: 'save', blockType: BlockType.COMMAND, text: 'save now'},
                eventBlock('whenSaved', 'when my save finishes'),
                {opcode: 'status', blockType: BlockType.REPORTER, text: 'save status'},
                '---',
                {opcode: 'all', blockType: BlockType.REPORTER, text: 'all saved data as JSON'}
            ]
        };
    }

    async load () {
        const state = getState(this.runtime);
        state.saveStatus = 'loading';
        try {
            const result = await getHost(this.runtime).call('data.load', []);
            state.save = result && result.value && typeof result.value === 'object' ? result.value : {};
            state.saveRevision = Number(result && result.revision) || 0;
            state.saveStatus = 'loaded';
            this.runtime.startHats('mistwarpData_whenLoaded');
        } catch (e) {
            state.saveStatus = `error: ${e.message}`;
            throw e;
        }
    }

    get (args) {
        return stringify(getState(this.runtime).save[args.KEY]);
    }

    set (args) {
        const key = String(args.KEY || '').trim();
        if (!key || key.length > 64 || key.startsWith('$')) {
            throw new Error('Save key must be 1 to 64 characters and cannot start with $');
        }
        getState(this.runtime).save[key] = parseSaveValue(args.VALUE);
    }

    async save () {
        const state = getState(this.runtime);
        state.saveStatus = 'saving';
        try {
            const result = await getHost(this.runtime).call('data.save', [{
                revision: state.saveRevision,
                value: state.save,
                requestId: requestId()
            }]);
            state.save = result.value || {};
            state.saveRevision = Number(result.revision) || state.saveRevision;
            state.saveStatus = 'saved';
            this.runtime.startHats('mistwarpData_whenSaved');
        } catch (e) {
            state.saveStatus = `error: ${e.message}`;
            throw e;
        }
    }

    status () {
        return getState(this.runtime).saveStatus;
    }

    all () {
        return JSON.stringify(getState(this.runtime).save);
    }
}

class MistWarpMultiplayer {
    constructor (runtime) {
        this.runtime = runtime;
    }

    getInfo () {
        return {
            id: 'mistwarpMultiplayer',
            name: 'Multiplayer',
            ...COLORS.multiplayer,
            blocks: [
                label('Room'),
                {opcode: 'connect',
                    blockType: BlockType.COMMAND,
                    text: 'join room [ROOM]',
                    arguments: {ROOM: {type: ArgumentType.STRING, defaultValue: 'main'}}},
                {opcode: 'connected', blockType: BlockType.BOOLEAN, text: 'in a room?'},
                {opcode: 'disconnect', blockType: BlockType.COMMAND, text: 'leave room'},
                {opcode: 'myPlayer', blockType: BlockType.REPORTER, text: 'my player ID'},
                {opcode: 'playerCount', blockType: BlockType.REPORTER, text: 'player count'},
                {opcode: 'playerIds', blockType: BlockType.REPORTER, text: 'player IDs as JSON'},
                '---',
                label('Players joining and leaving'),
                eventBlock('whenJoined', 'when a player joins'),
                {opcode: 'joinedPlayer', blockType: BlockType.REPORTER, text: 'player who joined'},
                eventBlock('whenLeft', 'when a player leaves'),
                {opcode: 'leftPlayer', blockType: BlockType.REPORTER, text: 'player who left'},
                {opcode: 'playerInRoom',
                    blockType: BlockType.BOOLEAN,
                    text: 'is [PLAYER] still in the room?',
                    arguments: {PLAYER: {type: ArgumentType.STRING, defaultValue: 'player ID'}}},
                {opcode: 'playerUsername',
                    blockType: BlockType.REPORTER,
                    text: 'username of [PLAYER]',
                    arguments: {PLAYER: {type: ArgumentType.STRING, defaultValue: 'player ID'}}},
                {opcode: 'playerAccount',
                    blockType: BlockType.REPORTER,
                    text: 'account ID of [PLAYER]',
                    arguments: {PLAYER: {type: ArgumentType.STRING, defaultValue: 'player ID'}}},
                '---',
                label('Player state'),
                {opcode: 'setPosition',
                    blockType: BlockType.COMMAND,
                    text: 'send my position x [X] y [Y]',
                    arguments: {
                        X: {type: ArgumentType.NUMBER, defaultValue: 0},
                        Y: {type: ArgumentType.NUMBER, defaultValue: 0}
                    }},
                {opcode: 'setValue',
                    blockType: BlockType.COMMAND,
                    text: 'set my online [KEY] to [VALUE]',
                    arguments: {
                        KEY: {type: ArgumentType.STRING, defaultValue: 'score'},
                        VALUE: {type: ArgumentType.STRING, defaultValue: '0'}
                    }},
                eventBlock('whenState', 'when a player moves or changes'),
                {opcode: 'statePlayer', blockType: BlockType.REPORTER, text: 'player whose state changed'},
                {opcode: 'playerX',
                    blockType: BlockType.REPORTER,
                    text: 'x position of [PLAYER]',
                    arguments: {PLAYER: {type: ArgumentType.STRING, defaultValue: 'player ID'}}},
                {opcode: 'playerY',
                    blockType: BlockType.REPORTER,
                    text: 'y position of [PLAYER]',
                    arguments: {PLAYER: {type: ArgumentType.STRING, defaultValue: 'player ID'}}},
                {opcode: 'playerValue',
                    blockType: BlockType.REPORTER,
                    text: '[KEY] of [PLAYER]',
                    arguments: {
                        KEY: {type: ArgumentType.STRING, defaultValue: 'score'},
                        PLAYER: {type: ArgumentType.STRING, defaultValue: 'player ID'}
                    }},
                '---',
                label('Game events'),
                {opcode: 'sendEvent',
                    blockType: BlockType.COMMAND,
                    text: 'send event [NAME] with [VALUE]',
                    arguments: {
                        NAME: {type: ArgumentType.STRING, defaultValue: 'round-started'},
                        VALUE: {type: ArgumentType.STRING, defaultValue: 'value'}
                    }},
                {opcode: 'sendEventTo',
                    blockType: BlockType.COMMAND,
                    text: 'send event [NAME] with [VALUE] to [PLAYER]',
                    arguments: {
                        NAME: {type: ArgumentType.STRING, defaultValue: 'your-turn'},
                        VALUE: {type: ArgumentType.STRING, defaultValue: 'value'},
                        PLAYER: {type: ArgumentType.STRING, defaultValue: 'player ID'}
                    }},
                eventBlock('whenEvent', 'when a game event arrives'),
                {opcode: 'eventName', blockType: BlockType.REPORTER, text: 'event name'},
                {opcode: 'eventValue', blockType: BlockType.REPORTER, text: 'event value'},
                {opcode: 'eventSender', blockType: BlockType.REPORTER, text: 'event sender'},
                '---',
                label('JSON'),
                {opcode: 'setState',
                    blockType: BlockType.COMMAND,
                    text: 'send my state JSON [VALUE]',
                    arguments: {VALUE: {type: ArgumentType.STRING, defaultValue: '{"score":0}'}}},
                {opcode: 'playerState',
                    blockType: BlockType.REPORTER,
                    text: 'state JSON for [PLAYER]',
                    arguments: {PLAYER: {type: ArgumentType.STRING, defaultValue: 'player ID'}}},
                {opcode: 'players', blockType: BlockType.REPORTER, text: 'all players as JSON'},
                {opcode: 'changedPlayer',
                    blockType: BlockType.REPORTER,
                    text: 'player who changed',
                    hideFromPalette: true}
            ]
        };
    }

    async connect (args) {
        const result = await getHost(this.runtime).call('multiplayer.connect', [String(args.ROOM || 'main')]);
        getState(this.runtime).connected = Boolean(result && result.connected);
        getState(this.runtime).self = result && result.self ? result.self : '';
        getState(this.runtime).players = Object.fromEntries(((result && result.players) || []).map(player =>
            [player.id, player]));
        getState(this.runtime).knownPlayers = {
            ...getState(this.runtime).knownPlayers,
            ...getState(this.runtime).players
        };
    }

    async disconnect () {
        await getHost(this.runtime).call('multiplayer.disconnect', []);
        getState(this.runtime).connected = false;
    }

    connected () {
        return getState(this.runtime).connected;
    }

    myPlayer () {
        return getState(this.runtime).self;
    }

    joinedPlayer () {
        return getState(this.runtime).joinedPlayer;
    }

    leftPlayer () {
        return getState(this.runtime).leftPlayer;
    }

    statePlayer () {
        return getState(this.runtime).statePlayer;
    }

    playerInRoom (args) {
        return Object.prototype.hasOwnProperty.call(getState(this.runtime).players, String(args.PLAYER || ''));
    }

    playerUsername (args) {
        const id = String(args.PLAYER || '');
        const state = getState(this.runtime);
        const player = state.players[id] || state.knownPlayers[id];
        return player && player.username ? player.username : '';
    }

    playerAccount (args) {
        const id = String(args.PLAYER || '');
        const state = getState(this.runtime);
        const player = state.players[id] || state.knownPlayers[id];
        return player && player.userId ? player.userId : id;
    }

    setState (args) {
        const value = parseJSON(args.VALUE);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('State must be a JSON object');
        getState(this.runtime).myState = value;
        return getHost(this.runtime).call('multiplayer.setState', [value]);
    }

    setPosition (args) {
        const state = getState(this.runtime);
        state.myState = {...state.myState, x: Number(args.X) || 0, y: Number(args.Y) || 0};
        return getHost(this.runtime).call('multiplayer.setState', [state.myState]);
    }

    setValue (args) {
        const key = String(args.KEY || '').trim();
        if (!key || key.length > 64 || key.startsWith('$')) {
            throw new Error('State key must be 1 to 64 characters and cannot start with $');
        }
        const state = getState(this.runtime);
        state.myState = {...state.myState, [key]: parseSaveValue(args.VALUE)};
        return getHost(this.runtime).call('multiplayer.setState', [state.myState]);
    }

    changedPlayer () {
        return getState(this.runtime).changedPlayer;
    }

    playerState (args) {
        const player = getState(this.runtime).players[String(args.PLAYER || '')];
        return player ? JSON.stringify(player.state || {}) : '';
    }

    playerValue (args) {
        const player = getState(this.runtime).players[String(args.PLAYER || '')];
        return player ? stringify((player.state || {})[String(args.KEY || '')]) : '';
    }

    playerX (args) {
        const player = getState(this.runtime).players[String(args.PLAYER || '')];
        return Number(player && player.state && player.state.x) || 0;
    }

    playerY (args) {
        const player = getState(this.runtime).players[String(args.PLAYER || '')];
        return Number(player && player.state && player.state.y) || 0;
    }

    playerCount () {
        return Object.keys(getState(this.runtime).players).length;
    }

    playerIds () {
        return JSON.stringify(Object.keys(getState(this.runtime).players));
    }

    sendEvent (args) {
        return getHost(this.runtime).call('multiplayer.sendEvent', [{
            name: String(args.NAME || ''),
            value: parseSaveValue(args.VALUE)
        }]);
    }

    sendEventTo (args) {
        return getHost(this.runtime).call('multiplayer.sendEvent', [{
            name: String(args.NAME || ''),
            value: parseSaveValue(args.VALUE),
            to: String(args.PLAYER || '')
        }]);
    }

    eventName () {
        return getState(this.runtime).eventName;
    }

    eventValue () {
        return getState(this.runtime).eventValue;
    }

    eventSender () {
        return getState(this.runtime).eventSender;
    }

    players () {
        return JSON.stringify(Object.values(getState(this.runtime).players));
    }
}

class MistWarpMarketplace {
    constructor (runtime) {
        this.runtime = runtime;
    }

    getInfo () {
        return {
            id: 'mistwarpMarketplace',
            name: 'Game Shop',
            ...COLORS.marketplace,
            blocks: [
                {opcode: 'open', blockType: BlockType.COMMAND, text: 'open shop'},
                {opcode: 'purchase',
                    blockType: BlockType.COMMAND,
                    text: 'buy [PRODUCT]',
                    arguments: {
                        PRODUCT: {type: ArgumentType.STRING, defaultValue: 'product ID'}
                    }},
                {opcode: 'owns',
                    blockType: BlockType.BOOLEAN,
                    text: 'owns product [PRODUCT]?',
                    arguments: {
                        PRODUCT: {type: ArgumentType.STRING, defaultValue: 'product ID'}
                    }},
                {opcode: 'status', blockType: BlockType.REPORTER, text: 'last purchase status'},
                '---',
                label('Project setup'),
                {opcode: 'defineProduct',
                    blockType: BlockType.COMMAND,
                    text: 'create product [PRODUCT] named [NAME] price [PRICE] item [ITEM]',
                    arguments: {
                        PRODUCT: {type: ArgumentType.STRING, defaultValue: 'product ID'},
                        NAME: {type: ArgumentType.STRING, defaultValue: 'VIP pass'},
                        PRICE: {type: ArgumentType.NUMBER, defaultValue: 10},
                        ITEM: {type: ArgumentType.STRING, defaultValue: 'item ID or blank'}
                    }}
            ]
        };
    }

    open () {
        return getHost(this.runtime).call('marketplace.open', []);
    }

    defineProduct (args) {
        return getHost(this.runtime).call('marketplace.configure', [{
            id: String(args.PRODUCT || ''),
            name: String(args.NAME || ''),
            description: '',
            price: Number(args.PRICE) || 0,
            grantsItem: String(args.ITEM || '')
        }]);
    }

    async purchase (args) {
        const result = await getHost(this.runtime).call('marketplace.purchase', [args.PRODUCT]);
        getState(this.runtime).purchaseStatus = result && result.status ? result.status : 'complete';
    }

    owns (args) {
        return getHost(this.runtime).call('marketplace.owns', [args.PRODUCT]);
    }

    status () {
        return getState(this.runtime).purchaseStatus;
    }
}

class MistWarpInventory {
    constructor (runtime) {
        this.runtime = runtime;
    }

    getInfo () {
        return {
            id: 'mistwarpInventory',
            name: 'Player Items',
            ...COLORS.inventory,
            blocks: [
                {opcode: 'load', blockType: BlockType.COMMAND, text: 'load my items'},
                eventBlock('whenLoaded', 'when my items load'),
                {opcode: 'owns',
                    blockType: BlockType.BOOLEAN,
                    text: 'owns item [ITEM]?',
                    arguments: {ITEM: {type: ArgumentType.STRING, defaultValue: 'project:item ID'}}},
                {opcode: 'quantity',
                    blockType: BlockType.REPORTER,
                    text: 'quantity of item [ITEM]',
                    arguments: {ITEM: {type: ArgumentType.STRING, defaultValue: 'project:item ID'}}},
                {opcode: 'showItem',
                    blockType: BlockType.COMMAND,
                    text: 'use item [ITEM] on this sprite',
                    arguments: {ITEM: {type: ArgumentType.STRING, defaultValue: 'project:item ID'}}},
                {opcode: 'status', blockType: BlockType.REPORTER, text: 'item load status'},
                '---',
                label('Project items'),
                {opcode: 'award',
                    blockType: BlockType.COMMAND,
                    text: 'give player item [ITEM]',
                    arguments: {ITEM: {type: ArgumentType.STRING, defaultValue: 'item ID'}}},
                {opcode: 'defineItem',
                    blockType: BlockType.COMMAND,
                    text: 'create item [ITEM] named [NAME] image [IMAGE]',
                    arguments: {
                        ITEM: {type: ArgumentType.STRING, defaultValue: 'item ID'},
                        NAME: {type: ArgumentType.STRING, defaultValue: 'Collectible'},
                        IMAGE: {type: ArgumentType.STRING, defaultValue: 'image URL'}
                    }},
                {opcode: 'defineCostumeItem',
                    blockType: BlockType.COMMAND,
                    text: 'create item [ITEM] named [NAME] from this costume',
                    arguments: {
                        ITEM: {type: ArgumentType.STRING, defaultValue: 'item ID'},
                        NAME: {type: ArgumentType.STRING, defaultValue: 'Collectible'}
                    }},
                '---',
                label('Outside items'),
                {opcode: 'setPolicy',
                    blockType: BlockType.COMMAND,
                    text: 'use outside items [MODE]',
                    arguments: {MODE: {type: ArgumentType.STRING, menu: 'policyMode'}}},
                {opcode: 'allowItem',
                    blockType: BlockType.COMMAND,
                    text: 'accept item [ITEM]',
                    arguments: {ITEM: {type: ArgumentType.STRING, defaultValue: 'project:item ID'}}},
                {opcode: 'allowProject',
                    blockType: BlockType.COMMAND,
                    text: 'accept items from project [PROJECT]',
                    arguments: {PROJECT: {type: ArgumentType.STRING, defaultValue: 'project ID'}}},
                '---',
                label('Advanced'),
                {opcode: 'itemImage',
                    blockType: BlockType.REPORTER,
                    text: 'image URL for item [ITEM]',
                    arguments: {ITEM: {type: ArgumentType.STRING, defaultValue: 'project:item ID'}}},
                {opcode: 'itemJSON',
                    blockType: BlockType.REPORTER,
                    text: 'item [ITEM] as JSON',
                    arguments: {ITEM: {type: ArgumentType.STRING, defaultValue: 'project:item ID'}}},
                {opcode: 'all', blockType: BlockType.REPORTER, text: 'all loaded items as JSON'}
            ],
            menus: {
                policyMode: {
                    acceptReporters: true,
                    items: [
                        {text: 'never', value: 'none'},
                        {text: 'when approved', value: 'allowlist'},
                        {text: 'from any project', value: 'all'}
                    ]
                }
            }
        };
    }

    _setInventory (result) {
        const state = getState(this.runtime);
        state.inventory = result && Array.isArray(result.items) ? result.items : [];
        state.inventoryStatus = 'loaded';
        this.runtime.startHats('mistwarpInventory_whenLoaded');
    }

    async load () {
        const state = getState(this.runtime);
        state.inventoryStatus = 'loading';
        try {
            this._setInventory(await getHost(this.runtime).call('inventory.load', []));
        } catch (e) {
            state.inventoryStatus = `error: ${e.message}`;
            throw e;
        }
    }

    all () {
        return JSON.stringify(getState(this.runtime).inventory);
    }

    _item (id) {
        return getState(this.runtime).inventory.find(item => item.id === String(id || ''));
    }

    owns (args) {
        return Boolean(this._item(args.ITEM));
    }

    quantity (args) {
        const item = this._item(args.ITEM);
        return item ? Number(item.quantity) || 0 : 0;
    }

    itemJSON (args) {
        const item = this._item(args.ITEM);
        return item ? JSON.stringify(item) : '';
    }

    itemImage (args) {
        const item = this._item(args.ITEM);
        return item && item.visual && item.visual.url ? item.visual.url : '';
    }

    async showItem (args, util) {
        const item = this._item(args.ITEM);
        if (!item || !item.visual || !item.visual.url) {
            throw new Error('Load the inventory and choose an owned item first');
        }
        await showImageOnTarget(this.runtime, util, item.visual.url, `MistWarp item ${item.id}`);
    }

    async award (args) {
        this._setInventory(await getHost(this.runtime).call('inventory.grant', [{
            item: String(args.ITEM || ''),
            requestId: requestId()
        }]));
    }

    defineItem (args) {
        return getHost(this.runtime).call('inventory.configureItem', [{
            id: String(args.ITEM || ''),
            name: String(args.NAME || ''),
            visual: {type: 'image', url: String(args.IMAGE || '')},
            gameAwardable: true
        }]);
    }

    defineCostumeItem (args, util) {
        const costume = util.target.getCostumes()[util.target.currentCostume];
        if (!costume || !costume.assetId || !costume.dataFormat) throw new Error('This sprite has no current costume');
        return getHost(this.runtime).call('inventory.configureItem', [{
            id: String(args.ITEM || ''),
            name: String(args.NAME || ''),
            visual: {type: 'costume', assetId: costume.assetId, dataFormat: costume.dataFormat},
            gameAwardable: true
        }]);
    }

    setPolicy (args) {
        return getHost(this.runtime).call('inventory.setPolicy', [String(args.MODE || 'none')]);
    }

    allowItem (args) {
        return getHost(this.runtime).call('inventory.allowItem', [String(args.ITEM || '')]);
    }

    allowProject (args) {
        return getHost(this.runtime).call('inventory.allowProject', [String(args.PROJECT || '')]);
    }

    status () {
        return getState(this.runtime).inventoryStatus;
    }
}

module.exports = {
    MistWarpPlayers,
    MistWarpMultiplayer,
    MistWarpData,
    MistWarpMarketplace,
    MistWarpInventory
};
