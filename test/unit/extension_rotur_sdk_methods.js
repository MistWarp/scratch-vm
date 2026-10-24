const test = require('tap').test;
const {METHOD_PERMISSIONS, Rotur} = require('rotur-sdk');
const roturExtensions = require('../../src/extensions/rotur');
const {scopeByOpcode} = require('../../src/extensions/rotur/core');

// Methods that build a URL and make no request, so the SDK lists no permission for them.
const NO_REQUEST = new Set(['avatars.url']);
const SOCKET_SCOPE = 'status:update';

// Run every block against a host that records the SDK methods it is asked to call.
const recordCalls = async () => {
    const records = [];
    for (const Extension of Object.values(roturExtensions)) {
        let calls = [];
        const host = {
            whenReady: () => Promise.resolve(),
            getUser: () => ({loggedIn: true}),
            projectId: () => 'project',
            projectName: () => 'Project',
            projectImage: () => '',
            ensureConsent: () => Promise.resolve(true),
            call: method => {
                calls.push(method);
                return Promise.resolve({});
            }
        };
        const extension = new Extension({roturHost: host, targets: []});
        const info = extension.getInfo();
        for (const block of info.blocks.filter(item => item.opcode)) {
            calls = [];
            const args = Object.fromEntries(Object.entries(block.arguments)
                .map(([name, value]) => [name, value.defaultValue]));
            await extension[block.opcode](args);
            const scope = scopeByOpcode.get(`${info.id}_${block.opcode}`) || null;
            for (const method of calls) {
                records.push({block: `${info.id}_${block.opcode}`, method, scope});
            }
        }
    }
    return records;
};

test('every Rotur block calls an SDK method its scope covers', async t => {
    const client = new Rotur();
    const records = await recordCalls();
    t.ok(records.length > 80, 'every block was run');
    for (const {block, method, scope} of records) {
        const label = `${block} calls ${method}`;
        const [namespace, name] = method.split('.');
        if (namespace === 'socket') {
            t.equal(typeof client.socket[name], 'function', `${label}, which exists`);
            t.equal(scope, SOCKET_SCOPE, `${label} with ${SOCKET_SCOPE}`);
            continue;
        }
        if (NO_REQUEST.has(method)) {
            t.equal(typeof client[namespace][name], 'function', `${label}, which exists`);
            continue;
        }
        t.ok(Object.prototype.hasOwnProperty.call(METHOD_PERMISSIONS, method), `${label}, which the SDK has`);
        const needed = METHOD_PERMISSIONS[method];
        t.not(needed, 'full', `${label} without the account's own token`);
        if (needed && method !== 'me.abilities') {
            t.equal(scope, needed, `${label} with ${needed}`);
        }
    }
    t.end();
});

test('the methods the fallback host always allows are in the SDK', t => {
    const client = new Rotur();
    for (const method of ['me.abilities', 'storage.get', 'storage.set', 'storage.delete',
        'socket.addActivity', 'socket.removeActivity', 'socket.setStatus']) {
        const [namespace, name] = method.split('.');
        t.equal(typeof client[namespace][name], 'function', method);
    }
    t.end();
});

const runWith = (Extension, opcode, args, answer) => {
    const host = {
        whenReady: () => Promise.resolve(),
        getUser: () => ({loggedIn: true}),
        projectId: () => 'project',
        projectName: () => 'Project',
        projectImage: () => '',
        ensureConsent: () => Promise.resolve(true),
        call: () => Promise.resolve(answer)
    };
    return new Extension({roturHost: host, targets: []})[opcode](args);
};

test('blocks report what they did on rotur-sdk 2.5.2 from the answers 3.x gives', async t => {
    const {RoturAccount, RoturSocial, RoturFiles} = roturExtensions;
    const badges = {badges: [{name: 'early', icon: ''}, {name: 'dev', icon: ''}], all_badges: [], preferences: {}};
    t.equal(await runWith(RoturAccount, 'myBadges', {}, badges), '["early","dev"]');
    t.equal(await runWith(RoturAccount, 'myBadges', {}, {badge_names: ['early', 'dev']}), '["early","dev"]');
    t.equal(await runWith(RoturAccount, 'myBadges', {}, null), '[]');

    t.equal(await runWith(RoturAccount, 'isBanned', {USER: 'Spammer'}, {banned: ['spammer']}), true);
    t.equal(await runWith(RoturAccount, 'isBanned', {USER: 'mist'}, {banned: ['spammer']}), false);
    t.equal(await runWith(RoturAccount, 'isBanned', {USER: 'mist'}, {banned: []}), false);

    t.equal(await runWith(RoturAccount, 'blockedUsers', {}, ['kit', 'sam']), '["kit","sam"]');
    t.equal(await runWith(RoturAccount, 'blockedUsers', {}, {blocked: ['kit']}), '["kit"]');
    t.equal(await runWith(RoturSocial, 'friendRequests', {}, ['kit']), '["kit"]');
    t.equal(await runWith(RoturSocial, 'friendRequests', {}, {requests: ['sam']}), '["sam"]');
    t.equal(await runWith(RoturSocial, 'friendRequests', {}, []), '[]');

    const entry = n => Array.from({length: 14}, (_, i) => `${n}-${i}`);
    const flat = [...entry('a'), ...entry('b')];
    t.same(JSON.parse(await runWith(RoturFiles, 'myFiles', {}, [entry('a'), entry('b')])), flat);
    t.same(JSON.parse(await runWith(RoturFiles, 'myFiles', {}, flat)), flat);
    t.equal(await runWith(RoturFiles, 'myFiles', {}, []), '[]');

    t.equal(await runWith(RoturAccount, 'avatarOf', {USER: 'mist'}, 'https://avatars.rotur.dev/mist?v='),
        'https://avatars.rotur.dev/mist?v=');
    t.end();
});
