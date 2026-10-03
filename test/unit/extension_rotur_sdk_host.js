const test = require('tap').test;

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
let authValid = true;

const systems = [];

class FakeRotur {
    constructor (options) {
        this.token = (options && options.token) || null;
        this.socket = {username: 'sophie', userId: '7'};
        this.me = {
            get: () => Promise.resolve({username: 'sophie', id: '7', 'sys.currency': 42}),
            checkAuth: () => Promise.resolve({auth: authValid, username: 'sophie'}),
            transfer: (...args) => {
                transfers.push(args);
                return Promise.resolve({});
            }
        };
        this.keys = {
            cancel: (...args) => {
                cancelledKeys.push(args);
                return Promise.resolve({});
            }
        };
        this._http = {getToken: () => this.token};
    }
    login (options) {
        logins.push(options.requires);
        systems.push(options.system);
        this.token = `token-${logins.length}`;
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

test('logs in once with only the scopes the project uses', async t => {
    const runtime = makeRuntime(['rotur_accountField']);
    const account = new RoturAccount(runtime);

    t.equal(await account.accountField({FIELD: 'username'}), 'sophie');
    t.equal(await account.accountField({FIELD: 'username'}), 'sophie');
    t.same(logins, [['account:view']]);
    t.same(systems, ['MistWarp: test']);
    t.same(JSON.parse(store['mw:rotur-sdk-token']), {
        token: 'token-1',
        scopes: ['account:view'],
        system: 'MistWarp: test'
    });
    t.end();
});

test('reuses a stored token with a matching scope set', async t => {
    const account = new RoturAccount(makeRuntime(['rotur_accountField']));

    t.equal(await account.accountField({FIELD: 'username'}), 'sophie');
    t.same(logins, [['account:view']]);
    t.end();
});

test('logs in again when the stored token no longer validates', async t => {
    authValid = false;
    const account = new RoturAccount(makeRuntime(['rotur_accountField']));

    t.equal(await account.accountField({FIELD: 'username'}), 'sophie');
    t.same(logins, [['account:view'], ['account:view']]);
    t.same(JSON.parse(store['mw:rotur-sdk-token']), {
        token: 'token-2',
        scopes: ['account:view'],
        system: 'MistWarp: test'
    });
    authValid = true;
    t.end();
});

test('does not hand another project on the same origin the stored token', async t => {
    const account = new RoturAccount(makeRuntime(['rotur_accountField'], 'other'));
    const before = logins.length;

    t.equal(await account.accountField({FIELD: 'username'}), 'sophie');
    t.equal(logins.length, before + 1);
    t.equal(systems[systems.length - 1], 'MistWarp: other');
    t.end();
});

test('the request block widens the token to cover the extra scope', async t => {
    const runtime = makeRuntime(['rotur_accountField', 'rotur_request']);
    const account = new RoturAccount(runtime);

    t.equal(await account.accountField({FIELD: 'username'}), 'sophie');
    const before = logins.length;

    t.equal(await account.request({SCOPES: 'posts:create'}), true);
    t.same(logins[before], ['account:view', 'posts:create']);

    t.equal(await account.request({SCOPES: 'posts:create'}), true);
    t.equal(logins.length, before + 1);
    t.end();
});

test('the removed money blocks load hidden, ask for nothing, and do nothing', async t => {
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
        t.equal(blocks.length, Object.keys(answers).length);
        t.ok(blocks.every(block => block.hideFromPalette === true));
        for (const [opcode, answer] of Object.entries(answers)) {
            t.equal(await extension[opcode]({AMOUNT: 5, USER: 'thief', TAG: 'tag', ID: 'id', PRODUCT: 'id', NAME: 'name'}), answer, opcode);
        }
    }
    t.equal(logins.length, before);
    t.end();
});

test('the fallback host only dispatches the methods the blocks use', async t => {
    const runtime = makeRuntime(['rotur_accountField']);
    await new RoturAccount(runtime).accountField({FIELD: 'username'});
    const host = runtime._roturHostResolved;
    for (const method of ['_http.getToken', 'setToken', 'tokens.create', 'constructor.constructor', 'me.get.call']) {
        await t.rejects(host.call(method, []), /Projects cannot call/, method);
    }
    for (const method of [
        'me.transfer', 'me.currency', 'me.transactions', 'me.dailyWait', 'gifts.create',
        'keys.buy', 'groups.tip', 'groups.buyProduct', 'items.buy', 'cosmetics.buy'
    ]) {
        await t.rejects(host.call(method, ['thief', 500, ''], {sensitive: false}), /Projects cannot call/, method);
    }
    t.same(transfers, []);
    for (const scope of ['tokens:manage', 'credits:view', 'credits:transfer']) {
        await t.rejects(host.ensureConsent([scope]), /cannot ask/, scope);
    }
    t.end();
});

test('the fallback host confirms sensitive methods even when the caller opts out', async t => {
    const runtime = makeRuntime(['rotur_accountField']);
    await new RoturAccount(runtime).accountField({FIELD: 'username'});
    const host = runtime._roturHostResolved;
    const prompts = [];
    global.window.confirm = message => {
        prompts.push(message);
        return prompts.length > 1;
    };
    await t.rejects(host.call('keys.cancel', ['first-key'], {sensitive: false}), /cancelled/);
    t.same(cancelledKeys, []);
    await host.call('keys.cancel', ['second-key'], {});
    t.same(prompts, ['Allow test to cancel this key?', 'Allow test to cancel this key?']);
    t.same(cancelledKeys, [['second-key']]);
    delete global.window.confirm;
    t.end();
});
