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
let authValid = true;

const systems = [];

class FakeRotur {
    constructor (options) {
        this.token = (options && options.token) || null;
        this.socket = {username: 'sophie', userId: '7'};
        this.me = {
            get: () => Promise.resolve({username: 'sophie', id: '7', 'sys.currency': 42}),
            checkAuth: () => Promise.resolve({auth: authValid, username: 'sophie'})
        };
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

const {RoturAccount, RoturEconomy} = require('../../src/extensions/rotur');

new RoturAccount({}).getInfo();
new RoturEconomy({}).getInfo();

const makeRuntime = (opcodes, projectName = 'test') => ({
    projectName,
    targets: [{blocks: {_blocks: Object.fromEntries(opcodes.map((op, i) => [i, {opcode: op}]))}}]
});

test('logs in once with only the scopes the project uses', async t => {
    const runtime = makeRuntime(['rotur_accountField']);
    const account = new RoturAccount(runtime);

    t.equal(await account.accountField({FIELD: 'sys.currency'}), 42);
    t.equal(await account.accountField({FIELD: 'sys.currency'}), 42);
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

    t.equal(await account.accountField({FIELD: 'sys.currency'}), 42);
    t.same(logins, [['account:view']]);
    t.end();
});

test('logs in again when the stored token no longer validates', async t => {
    authValid = false;
    const account = new RoturAccount(makeRuntime(['rotur_accountField']));

    t.equal(await account.accountField({FIELD: 'sys.currency'}), 42);
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

    t.equal(await account.accountField({FIELD: 'sys.currency'}), 42);
    t.equal(logins.length, before + 1);
    t.equal(systems[systems.length - 1], 'MistWarp: other');
    t.end();
});

test('the request block widens the token to cover the extra scope', async t => {
    const runtime = makeRuntime(['rotur_accountField', 'rotur_request']);
    const account = new RoturAccount(runtime);

    t.equal(await account.accountField({FIELD: 'sys.currency'}), 42);
    const before = logins.length;

    t.equal(await account.request({SCOPES: 'posts:create'}), true);
    t.same(logins[before], ['account:view', 'posts:create']);

    t.equal(await account.request({SCOPES: 'posts:create'}), true);
    t.equal(logins.length, before + 1);
    t.end();
});

test('the removed money blocks load hidden, ask for nothing, and do nothing', async t => {
    const runtime = makeRuntime(['roturEconomy_balance', 'roturEconomy_pay', 'roturEconomy_dailyWait', 'roturEconomy_transactions']);
    const economy = new RoturEconomy(runtime);
    const blocks = economy.getInfo().blocks.filter(block => ['balance', 'pay', 'dailyWait', 'transactions'].includes(block.opcode));
    t.equal(blocks.length, 4);
    t.ok(blocks.every(block => block.hideFromPalette === true));
    const before = logins.length;
    t.equal(await economy.balance({}), 0);
    t.equal(await economy.pay({AMOUNT: 5, USER: 'thief', NOTE: ''}), '');
    t.equal(await economy.dailyWait({}), 0);
    t.equal(await economy.transactions({}), '');
    t.equal(logins.length, before);
    t.end();
});
