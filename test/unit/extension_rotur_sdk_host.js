const {test} = require('node:test');
const assert = require('node:assert');

global.window = {};
global.location = {search: ''};

const store = {};
global.localStorage = {
    getItem: key => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, value) => {
        store[key] = String(value);
    },
    removeItem: key => {
        delete store[key];
    }
};

const logins = [];
const transfers = [];
const cancelledKeys = [];
const createdPosts = [];
let authValid = true;

const systems = [];
const modes = [];
const signedOut = [];

class FakeRotur {
    constructor (options) {
        this.token = (options && options.token) || null;
        this.socket = {username: 'sophie', userId: '7'};
        this.me = {
            get: () => Promise.resolve({
                'username': 'sophie',
                'id': '7',
                'sys.currency': 42,
                'key': this.token,
                'email': 'sophie@example.com',
                'sys.reset_token': 'reset-secret-value',
                'sys.logins': [{ip: '1.2.3.4'}],
                'note': `token ${this.token}`
            }),
            abilities: () => (authValid ?
                Promise.resolve({token_type: 'app', permissions: ['account:view']}) :
                Promise.reject(new Error('Unauthorized'))),
            transfer: (...args) => {
                transfers.push(args);
                return Promise.resolve({});
            }
        };
        this.posts = {
            create: (...args) => {
                createdPosts.push(args);
                return Promise.resolve({id: 'p1'});
            }
        };
        this.storage = {
            get: () => Promise.resolve(JSON.parse(
                `{"data": {"__proto__": {"inherited": "yes"}, "${this.token}": 1, "score": 3}}`
            ))
        };
        this.keys = {
            cancel: (...args) => {
                cancelledKeys.push(args);
                return Promise.resolve({});
            }
        };
        // As Rotur answers now: no names, only the count, and none for a private profile.
        this.following = {
            followers: user => Promise.resolve(user === 'private' ?
                {followers: [], hidden: true, deprecated: true} :
                {followers: [], count: 12, deprecated: true}),
            following: () => Promise.resolve({following: [], count: 3, deprecated: true})
        };
        this._http = {getToken: () => this.token};
    }
    signOut () {
        signedOut.push(this.token);
        return Promise.resolve();
    }
    login (options) {
        logins.push(options.requires);
        systems.push(options.system);
        modes.push(options.mode);
        this.token = `token-${logins.length}-session`;
        return Promise.resolve(this);
    }
}

require.cache[require.resolve('rotur-sdk')] = {
    id: require.resolve('rotur-sdk'),
    filename: require.resolve('rotur-sdk'),
    loaded: true,
    exports: {Rotur: FakeRotur}
};

const {RoturAccount, RoturEconomy, RoturKeys, RoturShop, RoturGroups, RoturSocial} = require('../../src/extensions/rotur');

new RoturAccount({}).getInfo();
new RoturEconomy({}).getInfo();
new RoturKeys({}).getInfo();
new RoturSocial({}).getInfo();

const makeRuntime = (opcodes, projectName = 'test') => ({
    projectName,
    targets: [{blocks: {_blocks: Object.fromEntries(opcodes.map((op, i) => [i, {opcode: op}]))}}]
});

test('logs in once with only the scopes the project uses', async () => {
    const runtime = makeRuntime(['rotur_accountField']);
    const account = new RoturAccount(runtime);

    assert.strictEqual(await account.accountField({FIELD: 'username'}), 'sophie');
    assert.strictEqual(await account.accountField({FIELD: 'username'}), 'sophie');
    assert.deepStrictEqual(logins, [['account:view']]);
    assert.deepStrictEqual(systems, ['MistWarp: test']);
    assert.deepStrictEqual(modes, ['popup']);
    assert.deepStrictEqual(JSON.parse(store['mw:rotur-sdk-token']), {
        token: 'token-1-session',
        scopes: ['account:view'],
        system: 'MistWarp: test'
    });
});

test('reuses a stored token with a matching scope set', async () => {
    const account = new RoturAccount(makeRuntime(['rotur_accountField']));

    assert.strictEqual(await account.accountField({FIELD: 'username'}), 'sophie');
    assert.deepStrictEqual(logins, [['account:view']]);
});

test('logs in again when the stored token no longer validates', async () => {
    authValid = false;
    const account = new RoturAccount(makeRuntime(['rotur_accountField']));

    assert.strictEqual(await account.accountField({FIELD: 'username'}), 'sophie');
    assert.deepStrictEqual(logins, [['account:view'], ['account:view']]);
    assert.deepStrictEqual(signedOut, ['token-1-session']);
    assert.deepStrictEqual(JSON.parse(store['mw:rotur-sdk-token']), {
        token: 'token-2-session',
        scopes: ['account:view'],
        system: 'MistWarp: test'
    });
    authValid = true;
});

test('does not hand another project on the same origin the stored token', async () => {
    const account = new RoturAccount(makeRuntime(['rotur_accountField'], 'other'));
    const before = logins.length;

    assert.strictEqual(await account.accountField({FIELD: 'username'}), 'sophie');
    assert.strictEqual(logins.length, before + 1);
    assert.strictEqual(systems[systems.length - 1], 'MistWarp: other');
});

test('the request block widens the token to cover the extra scope', async () => {
    const runtime = makeRuntime(['rotur_accountField', 'rotur_request']);
    const account = new RoturAccount(runtime);

    assert.strictEqual(await account.accountField({FIELD: 'username'}), 'sophie');
    const before = logins.length;

    assert.strictEqual(await account.request({SCOPES: 'posts:create'}), true);
    assert.deepStrictEqual(logins[before], ['account:view', 'posts:create']);

    assert.strictEqual(await account.request({SCOPES: 'posts:create'}), true);
    assert.strictEqual(logins.length, before + 1);
});

test('the removed money blocks load hidden, ask for nothing, and do nothing', async () => {
    const runtime = makeRuntime([
        'roturEconomy_balance', 'roturEconomy_pay', 'roturEconomy_dailyWait', 'roturEconomy_transactions',
        'roturEconomy_createGift', 'roturKeys_buyKey', 'roturGroups_tipGroup', 'roturGroups_buyGroupProduct',
        'roturShop_buyItem', 'roturShop_buyCosmetic'
    ]);
    const removed = [
        [new RoturEconomy(runtime), {balance: 0, pay: '', dailyWait: 0, transactions: '', createGift: ''}],
        [new RoturKeys(runtime), {buyKey: ''}],
        [new RoturGroups(runtime), {tipGroup: '', buyGroupProduct: ''}],
        [new RoturShop(runtime), {buyItem: '', buyCosmetic: ''}]
    ];
    const before = logins.length;
    for (const [extension, answers] of removed) {
        const blocks = extension.getInfo().blocks.filter(block => block.opcode in answers);
        assert.strictEqual(blocks.length, Object.keys(answers).length);
        assert.ok(blocks.every(block => block.hideFromPalette === true));
        for (const [opcode, answer] of Object.entries(answers)) {
            assert.strictEqual(
                await extension[opcode]({AMOUNT: 5, USER: 'thief', TAG: 'tag', ID: 'id', PRODUCT: 'id', NAME: 'name'}),
                answer,
                opcode
            );
        }
    }
    assert.strictEqual(logins.length, before);
});

test('follower blocks give counts, and the old list blocks load hidden with an empty list', async () => {
    const social = new RoturSocial(makeRuntime(['roturSocial_followersOf', 'roturSocial_followerCount']));
    const blocks = Object.fromEntries(social.getInfo().blocks.map(block => [block.opcode, block]));
    assert.strictEqual(await social.followerCount({USER: 'mist'}), 12);
    assert.strictEqual(await social.followingCount({USER: 'mist'}), 3);
    assert.strictEqual(await social.followerCount({USER: 'private'}), '');
    assert.ok(!blocks.followerCount.hideFromPalette);
    assert.ok(!blocks.followingCount.hideFromPalette);

    assert.ok(blocks.followersOf.hideFromPalette);
    assert.ok(blocks.followingOf.hideFromPalette);
    assert.deepStrictEqual(JSON.parse(await social.followersOf({USER: 'mist'})), {followers: [], count: 12});
    assert.deepStrictEqual(JSON.parse(await social.followingOf({USER: 'mist'})), {following: [], count: 3});
    assert.deepStrictEqual(JSON.parse(await social.followersOf({USER: 'private'})), {followers: []});
});

test('the fallback host only dispatches the methods the blocks use', async () => {
    const runtime = makeRuntime(['rotur_accountField']);
    await new RoturAccount(runtime).accountField({FIELD: 'username'});
    const host = runtime._roturHostResolved;
    for (const method of ['_http.getToken', 'setToken', 'tokens.create', 'constructor.constructor', 'me.get.call']) {
        await assert.rejects(host.call(method, []), /Projects cannot call/, method);
    }
    for (const method of [
        'me.transfer', 'me.currency', 'me.transactions', 'me.dailyWait', 'gifts.create',
        'keys.buy', 'groups.tip', 'groups.buyProduct', 'items.buy', 'cosmetics.buy'
    ]) {
        await assert.rejects(host.call(method, ['thief', 500, ''], {sensitive: false}), /Projects cannot call/, method);
    }
    assert.deepStrictEqual(transfers, []);
    for (const scope of ['tokens:manage', 'credits:view', 'credits:transfer']) {
        await assert.rejects(host.ensureConsent([scope]), /cannot ask/, scope);
    }
});

test('the fallback host confirms sensitive methods even when the caller opts out', async () => {
    const runtime = makeRuntime(['rotur_accountField']);
    await new RoturAccount(runtime).accountField({FIELD: 'username'});
    const host = runtime._roturHostResolved;
    const prompts = [];
    global.window.confirm = message => {
        prompts.push(message);
        return prompts.length > 1;
    };
    await assert.rejects(host.call('keys.cancel', ['first-key'], {sensitive: false}), /cancelled/);
    assert.deepStrictEqual(cancelledKeys, []);
    await host.call('keys.cancel', ['second-key'], {});
    assert.deepStrictEqual(prompts, ['Allow test to cancel this key?', 'Allow test to cancel this key?']);
    assert.deepStrictEqual(cancelledKeys, [['second-key']]);
    delete global.window.confirm;
});

test('the post block marks posts as made in MistWarp', async () => {
    const runtime = makeRuntime(['roturSocial_post']);
    await new RoturSocial(runtime).post({CONTENT: 'hello from a project'});
    assert.deepStrictEqual(createdPosts, [['hello from a project', {os: 'MistWarp'}]]);
});

test('the fallback host never hands the project the token or account secrets', async () => {
    const runtime = makeRuntime(['rotur_accountField']);
    await new RoturAccount(runtime).accountField({FIELD: 'username'});
    const host = runtime._roturHostResolved;
    const info = await host.call('me.get', []);
    assert.deepStrictEqual(info, {'username': 'sophie', 'id': '7', 'sys.currency': 42, 'note': null});
    assert.strictEqual(await new RoturAccount(runtime).accountField({FIELD: 'key'}), '');
    assert.strictEqual(await new RoturAccount(runtime).accountField({FIELD: 'sys.currency'}), 42);
});

test('the fallback host drops field names holding the token and keeps __proto__ an ordinary field', async () => {
    const runtime = makeRuntime(['rotur_accountField']);
    await new RoturAccount(runtime).accountField({FIELD: 'username'});
    const bag = await runtime._roturHostResolved.call('storage.get', ['mistwarp']);
    assert.deepStrictEqual(Object.keys(bag.data), ['__proto__', 'score']);
    assert.strictEqual(bag.data.inherited, undefined);
    assert.strictEqual(Object.getPrototypeOf(bag.data), Object.prototype);
});
