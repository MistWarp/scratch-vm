const unavailableHost = {
    whenReady: () => Promise.resolve(),
    getUser: () => ({loggedIn: false, username: '', id: ''}),
    call: method => Promise.reject(new Error(`MistWarp Games is unavailable here (${method})`))
};

const createParentHost = () => {
    let nextId = 1;
    let readyResolver;
    let parentAlive = false;
    let user = {loggedIn: false, username: '', id: ''};
    const pending = new Map();
    const listeners = new Set();
    const ready = new Promise(resolve => {
        readyResolver = resolve;
    });
    const settleReady = () => {
        if (readyResolver) {
            readyResolver();
            readyResolver = null;
        }
    };
    window.addEventListener('message', event => {
        if (event.source !== window.parent || !event.data) return;
        const data = event.data;
        if (data.type === 'mw:games-user') {
            parentAlive = true;
            user = data.user || user;
            settleReady();
            return;
        }
        if (data.type !== 'mw:games-result') return;
        const request = pending.get(data.id);
        if (!request) return;
        pending.delete(data.id);
        if (data.ok) {
            request.resolve(data.result);
        } else {
            request.reject(new Error(data.error || 'MistWarp Games request failed'));
        }
    });
    window.addEventListener('message', event => {
        if (event.source !== window.parent || !event.data || event.data.type !== 'mw:games-event') return;
        for (const listener of listeners) listener(event.data.event);
    });
    window.parent.postMessage({type: 'mw:games', kind: 'hello'}, '*');
    setTimeout(settleReady, 2000);
    return {
        async whenReady () {
            await ready;
        },
        getUser () {
            return user;
        },
        subscribe (listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        call (method, args) {
            if (!parentAlive && !readyResolver) return unavailableHost.call(method);
            const id = nextId++;
            return new Promise((resolve, reject) => {
                pending.set(id, {resolve, reject});
                window.parent.postMessage({type: 'mw:games', kind: 'call', id, method, args}, '*');
            });
        }
    };
};

const getState = runtime => {
    if (!runtime._mistwarpGamesState) {
        runtime._mistwarpGamesState = {
            save: {},
            saveRevision: 0,
            saveStatus: 'not loaded',
            connected: false,
            self: '',
            players: {},
            knownPlayers: {},
            myState: {},
            changedPlayer: '',
            joinedPlayer: '',
            leftPlayer: '',
            statePlayer: '',
            eventName: '',
            eventValue: '',
            eventSender: '',
            purchaseStatus: '',
            inventory: [],
            inventoryStatus: 'not loaded'
        };
    }
    return runtime._mistwarpGamesState;
};

const stringify = value => {
    if (typeof value === 'undefined' || value === null) return '';
    return typeof value === 'object' ? JSON.stringify(value) : value;
};

const bindHostEvents = (runtime, host) => {
    if (runtime._mistwarpGamesEventsBound || typeof host.subscribe !== 'function') return;
    runtime._mistwarpGamesEventsBound = true;
    host.subscribe(event => {
        if (!event || !event.type) return;
        const state = getState(runtime);
        if (event.type === 'welcome') {
            state.connected = true;
            state.self = event.self || '';
            state.players = Object.fromEntries((event.players || []).map(player => [player.id, player]));
            state.knownPlayers = {...state.knownPlayers, ...state.players};
        } else if (event.type === 'player_joined') {
            state.players[event.player.id] = event.player;
            state.knownPlayers[event.player.id] = event.player;
            state.changedPlayer = event.player.id;
            state.joinedPlayer = event.player.id;
            runtime.startHats('mistwarpMultiplayer_whenJoined');
        } else if (event.type === 'player_state') {
            const player = {
                ...(state.knownPlayers[event.player.id] || {}),
                ...(state.players[event.player.id] || {}),
                ...event.player
            };
            state.players[event.player.id] = player;
            state.knownPlayers[event.player.id] = player;
            state.changedPlayer = event.player.id;
            state.statePlayer = event.player.id;
            runtime.startHats('mistwarpMultiplayer_whenState');
        } else if (event.type === 'player_left') {
            state.knownPlayers[event.player.id] = {
                ...(state.knownPlayers[event.player.id] || {}),
                ...event.player
            };
            delete state.players[event.player.id];
            state.changedPlayer = event.player.id;
            state.leftPlayer = event.player.id;
            runtime.startHats('mistwarpMultiplayer_whenLeft');
        } else if (event.type === 'game_event') {
            state.eventName = event.name || '';
            state.eventValue = stringify(event.value);
            state.eventSender = event.sender && event.sender.id ? event.sender.id : '';
            runtime.startHats('mistwarpMultiplayer_whenEvent', {NAME: state.eventName});
        } else if (event.type === 'disconnected') {
            state.connected = false;
            state.players = {};
        }
    });
};

const getHost = runtime => {
    if (runtime._mistwarpGamesHost) return runtime._mistwarpGamesHost;
    if (runtime.mistwarpGameHost) {
        runtime._mistwarpGamesHost = runtime.mistwarpGameHost;
    } else if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
        runtime._mistwarpGamesHost = createParentHost();
    } else {
        runtime._mistwarpGamesHost = unavailableHost;
    }
    bindHostEvents(runtime, runtime._mistwarpGamesHost);
    return runtime._mistwarpGamesHost;
};

const parseJSON = value => {
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch (e) {
        throw new Error('Value must be valid JSON');
    }
};

const requestId = () => `mw_${Date.now().toString(36)}_${Math.random().toString(36)
    .slice(2)}`;

module.exports = {getHost, getState, parseJSON, stringify, requestId};
