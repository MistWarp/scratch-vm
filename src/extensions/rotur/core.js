const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');

const scopeByOpcode = new Map();

const registerScope = (fullOpcode, scope) => {
    if (scope) {
        scopeByOpcode.set(fullOpcode, scope);
    }
};

const argFor = value => {
    if (value && typeof value === 'object') {
        return value;
    }
    return {type: ArgumentType.STRING, defaultValue: typeof value === 'undefined' ? '' : value};
};

const buildBlocks = (extensionId, specs) => specs.map(spec => {
    if (spec === '---') {
        return '---';
    }
    if (typeof spec.label === 'string' && !spec.opcode) {
        return {blockType: BlockType.LABEL, text: spec.label};
    }
    registerScope(`${extensionId}_${spec.opcode}`, spec.scope);
    const block = {
        opcode: spec.opcode,
        blockType: spec.blockType || BlockType.REPORTER,
        text: spec.text,
        arguments: Object.fromEntries(
            Object.entries(spec.args || {}).map(([name, value]) => [name, argFor(value)])
        )
    };
    if (spec.isEdgeActivated) {
        block.isEdgeActivated = true;
    }
    return block;
});

const scopesUsedByProject = runtime => {
    if (!runtime || !runtime.targets) {
        return [];
    }
    if (runtime._roturScopesCache) {
        return runtime._roturScopesCache;
    }
    if (!runtime._roturScopesInvalidator && typeof runtime.on === 'function') {
        runtime._roturScopesInvalidator = true;
        runtime.on('PROJECT_CHANGED', () => {
            runtime._roturScopesCache = null;
        });
    }
    const scopes = new Set();
    for (const target of runtime.targets) {
        const container = target.blocks && target.blocks._blocks;
        if (!container) {
            continue;
        }
        for (const id of Object.keys(container)) {
            const scope = scopeByOpcode.get(container[id].opcode);
            if (scope) {
                scopes.add(scope);
            }
        }
    }
    const result = [...scopes];
    if (runtime._roturScopesInvalidator) {
        runtime._roturScopesCache = result;
    }
    return result;
};

const SDK_TOKEN_KEY = 'mw:rotur-sdk-token';

const sameScopes = (a, b) => Array.isArray(a) && a.length === b.length &&
    [...a].sort().join(',') === [...b].sort().join(',');

const readStoredToken = () => {
    try {
        const stored = JSON.parse(localStorage.getItem(SDK_TOKEN_KEY) || 'null');
        return stored && typeof stored.token === 'string' ? stored : null;
    } catch (_) {
        return null;
    }
};

const writeStoredToken = value => {
    try {
        if (value) {
            localStorage.setItem(SDK_TOKEN_KEY, JSON.stringify(value));
        } else {
            localStorage.removeItem(SDK_TOKEN_KEY);
        }
    } catch (_) {
        // eslint-disable-next-line no-empty
    }
};

const createSdkHost = runtime => {
    let clientPromise = null;
    let extraScopes = [];
    let cachedUser = {loggedIn: false};
    const wantedScopes = () => [...new Set([...scopesUsedByProject(runtime), ...extraScopes])];
    const projectLabel = () => String(
        (runtime && runtime.projectName) ||
        (typeof document !== 'undefined' && document.title) || ''
    ).trim();
    const systemName = () => (projectLabel() ? `MistWarp: ${projectLabel().slice(0, 64)}` : 'MistWarp');
    const getClient = () => {
        if (!clientPromise) {
            clientPromise = (async () => {
                // eslint-disable-next-line global-require
                const {Rotur} = require('rotur-sdk');
                const scopes = wantedScopes();
                const system = systemName();
                const stored = readStoredToken();
                let rotur = null;
                if (stored && stored.system === system && sameScopes(stored.scopes, scopes)) {
                    rotur = new Rotur({token: stored.token});
                    const auth = await rotur.me.checkAuth().catch(() => null);
                    if (!auth || !auth.auth) {
                        writeStoredToken(null);
                        rotur = null;
                    }
                }
                if (!rotur) {
                    rotur = new Rotur();
                    await rotur.login({
                        system,
                        timeout: 120000,
                        requires: scopes
                    });
                    writeStoredToken({token: rotur.token, scopes, system});
                }
                const me = await rotur.me.get().catch(() => null);
                cachedUser = {
                    loggedIn: true,
                    username: (me && me.username) || rotur.socket.username || '',
                    id: (me && me.id) || rotur.socket.userId || ''
                };
                return rotur;
            })();
        }
        return clientPromise;
    };
    const resolveMethod = (rotur, method) => {
        const parts = method.split('.');
        let ctx = rotur;
        let fn = rotur;
        for (const part of parts) {
            ctx = fn;
            fn = fn && fn[part];
        }
        return {fn, ctx};
    };
    const resolveProjectId = () => {
        try {
            const params = new URLSearchParams(location.search);
            return params.get('platform_project') || params.get('project') ||
                (typeof window !== 'undefined' && window.__MW_PROJECT_ID__) || '';
        } catch (_) {
            return '';
        }
    };
    return {
        whenReady () {
            return Promise.resolve();
        },
        getUser () {
            return cachedUser;
        },
        projectId () {
            return resolveProjectId();
        },
        projectName () {
            return projectLabel();
        },
        projectImage () {
            return '';
        },
        async ensureConsent (scopes) {
            const known = wantedScopes();
            const missing = (scopes || []).filter(scope => !known.includes(scope));
            if (missing.length) {
                extraScopes = [...extraScopes, ...missing];
                clientPromise = null;
            }
            await getClient();
            return true;
        },
        async call (method, args) {
            const rotur = await getClient();
            const {fn, ctx} = resolveMethod(rotur, method);
            if (typeof fn !== 'function') {
                throw new Error(`Unknown Rotur method: ${method}`);
            }
            return fn.apply(ctx, args);
        }
    };
};

const createParentBridgeHost = runtime => {
    let nextId = 1;
    let fallback = null;
    const useFallback = () => {
        if (!fallback) {
            fallback = createSdkHost(runtime);
        }
        return fallback;
    };
    const pending = new Map();
    let cachedUser = {loggedIn: false};
    let cachedProjectId = '';
    let cachedProjectName = '';
    let cachedProjectImage = '';
    let markReady;
    let parentAlive = false;
    const ready = new Promise(resolve => {
        markReady = resolve;
    });
    const settleReady = () => {
        if (markReady) {
            markReady();
            markReady = null;
        }
    };
    const post = payload => window.parent.postMessage({type: 'mw:rotur', ...payload}, '*');
    window.addEventListener('message', event => {
        if (event.source !== window.parent) {
            return;
        }
        const data = event.data;
        if (!data) {
            return;
        }
        if (data.type === 'mw:rotur-user') {
            parentAlive = true;
            settleReady();
            cachedUser = data.user || {loggedIn: false};
            if (typeof data.projectId === 'string') {
                cachedProjectId = data.projectId;
            }
            if (typeof data.projectName === 'string') {
                cachedProjectName = data.projectName;
            }
            if (typeof data.projectImage === 'string') {
                cachedProjectImage = data.projectImage;
            }
            return;
        }
        if (data.type !== 'mw:rotur-result') {
            return;
        }
        const entry = pending.get(data.id);
        if (!entry) {
            return;
        }
        pending.delete(data.id);
        if (data.ok) {
            entry.resolve(data.result);
        } else {
            entry.reject(new Error(data.error || 'Rotur request failed'));
        }
    });
    post({kind: 'hello'});
    setTimeout(settleReady, 2000);
    const request = payload => new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, {resolve, reject});
        post({id, ...payload});
    });
    return {
        async whenReady () {
            await ready;
            if (!parentAlive) {
                await useFallback().whenReady();
            }
        },
        getUser () {
            return parentAlive ? cachedUser : useFallback().getUser();
        },
        projectId () {
            return parentAlive ? cachedProjectId : useFallback().projectId();
        },
        projectName () {
            return parentAlive ? cachedProjectName : useFallback().projectName();
        },
        projectImage () {
            return parentAlive ? cachedProjectImage : useFallback().projectImage();
        },
        async ensureConsent (scopes, meta) {
            await ready;
            if (!parentAlive) {
                return useFallback().ensureConsent(scopes, meta);
            }
            return request({kind: 'consent', scopes, meta});
        },
        async call (method, args, opts) {
            await ready;
            if (!parentAlive) {
                return useFallback().call(method, args, opts);
            }
            return request({kind: 'call', method, args, opts});
        }
    };
};

const consentInflight = new WeakMap();
const requestConsent = (host, scopes, meta) => {
    const key = JSON.stringify([...scopes].sort());
    let byScopes = consentInflight.get(host);
    if (!byScopes) {
        byScopes = new Map();
        consentInflight.set(host, byScopes);
    }
    if (byScopes.has(key)) {
        return byScopes.get(key);
    }
    const promise = Promise.resolve().then(() => host.ensureConsent(scopes, meta));
    byScopes.set(key, promise);
    const clear = () => byScopes.delete(key);
    promise.then(clear, clear);
    return promise;
};

const getHost = runtime => {
    if (runtime._roturHostResolved) {
        return runtime._roturHostResolved;
    }
    let host;
    if (runtime.roturHost) {
        host = runtime.roturHost;
    } else if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
        host = createParentBridgeHost(runtime);
    } else {
        host = createSdkHost(runtime);
    }
    runtime._roturHostResolved = host;
    return host;
};

const SECRET_KEY = /^(password|token|auth|validator)$/i;
const scrub = value => {
    if (typeof value === 'string') {
        return /^rotur_/.test(value) ? '[redacted]' : value;
    }
    if (Array.isArray(value)) {
        return value.map(scrub);
    }
    if (value && typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value)) {
            if (SECRET_KEY.test(key)) {
                continue;
            }
            out[key] = scrub(value[key]);
        }
        return out;
    }
    return value;
};

const run = async (extension, spec, args) => {
    const runtime = extension.runtime;
    const host = getHost(runtime);

    if ((spec.local === 'loggedIn' || spec.local === 'username' || spec.local === 'id') &&
        typeof host.whenReady === 'function') {
        await host.whenReady();
    }

    if (spec.local === 'loggedIn') {
        return Boolean(host.getUser().loggedIn);
    }
    if (spec.local === 'username') {
        return host.getUser().username || '';
    }
    if (spec.local === 'id') {
        return host.getUser().id || '';
    }
    if (spec.local === 'permissions' || spec.local === 'allows') {
        const abilities = await host.call('me.abilities', []);
        const granted = abilities && abilities.token_type === 'main' ?
            ['full'] :
            ((abilities && abilities.permissions) || []);
        if (spec.local === 'permissions') {
            return JSON.stringify(granted);
        }
        return granted.includes('full') || granted.includes(args.SCOPE);
    }
    if (spec.local === 'request') {
        const requested = String(args.SCOPES || '').split(/[\s,]+/)
            .filter(Boolean);
        return Boolean(await requestConsent(host, requested, {name: runtime.projectName || ''}));
    }

    const scopes = scopesUsedByProject(runtime);
    const allowed = await requestConsent(host, scopes, {name: runtime.projectName || ''});
    if (!allowed) {
        throw new Error('Rotur access was not granted for this project');
    }

    if (spec.storage) {
        const pid = (host.projectId && host.projectId()) || 'mistwarp';
        if (spec.storage === 'set') {
            await host.call('storage.set', [pid, args.KEY, args.VALUE], {});
            return '';
        }
        if (spec.storage === 'delete') {
            await host.call('storage.delete', [pid, args.KEY], {});
            return '';
        }
        const bag = await host.call('storage.get', [pid], {});
        const data = (bag && bag.data) || {};
        if (spec.storage === 'has') {
            return Object.prototype.hasOwnProperty.call(data, args.KEY);
        }
        if (spec.storage === 'keys') {
            return JSON.stringify(Object.keys(data));
        }
        const value = data[args.KEY];
        return scrub(typeof value === 'undefined' ? '' :
            (typeof value === 'object' ? JSON.stringify(value) : value));
    }

    if (spec.activity) {
        const pid = (host.projectId && host.projectId()) || '';
        const activityId = pid || 'mistwarp-project';
        if (spec.activity === 'clear') {
            await host.call('socket.removeActivity', [activityId], {});
            return '';
        }
        const projectUrl = pid ?
            `https://warp.mistium.com/project/${encodeURIComponent(pid)}` :
            'https://warp.mistium.com';
        const name = (host.projectName && host.projectName()) ||
            runtime.projectName || 'a MistWarp project';
        const verb = String(args.VERB || 'Playing').trim() || 'Playing';
        const image = args.IMAGE || (host.projectImage && host.projectImage()) || '';
        const activity = {
            id: activityId,
            title: `${verb} on MistWarp`,
            status: args.DETAILS ? `${name} · ${args.DETAILS}` : name,
            url: projectUrl,
            application: {name: 'MistWarp', url: projectUrl},
            start_time: Date.now()
        };
        if (image) {
            activity.image = image;
        }
        await host.call('socket.addActivity', [activity], {});
        return '';
    }

    const mapped = spec.map ? spec.map(args) : Object.values(args);
    const result = await host.call(spec.method, mapped, {
        sensitive: Boolean(spec.sensitive),
        label: spec.confirm || spec.method
    });
    if (result && typeof result === 'object' && result.error) {
        throw new Error(result.error);
    }
    const safe = scrub(spec.result ? spec.result(result, args) : result);
    if (typeof safe === 'undefined' || safe === null) {
        return '';
    }
    if (typeof safe === 'object') {
        return JSON.stringify(safe);
    }
    return safe;
};

const defineExtension = (extensionId, config, specs) => {
    class RoturExtension {
        constructor (runtime) {
            this.runtime = runtime;
            for (const spec of specs) {
                if (spec === '---' || !spec.opcode) {
                    continue;
                }
                this[spec.opcode] = args => run(this, spec, args);
            }
        }
        getInfo () {
            return {
                id: extensionId,
                name: config.name,
                color1: config.color1,
                color2: config.color2,
                color3: config.color3,
                blocks: buildBlocks(extensionId, specs),
                menus: config.menus || {}
            };
        }
    }
    return RoturExtension;
};

module.exports = {
    defineExtension,
    scopesUsedByProject,
    scopeByOpcode,
    BlockType,
    ArgumentType
};
