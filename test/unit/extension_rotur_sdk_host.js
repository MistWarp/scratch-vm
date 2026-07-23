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
    const runtime = makeRuntime(['roturEconomy_balance']);
    const economy = new RoturEconomy(runtime);

    t.equal(await economy.balance({}), 42);
    t.equal(await economy.balance({}), 42);
    t.same(logins, [['credits:view']]);
    t.same(systems, ['mistwarp: test']);
    t.same(JSON.parse(store['mw:rotur-sdk-token']), {
        token: 'token-1',
        scopes: ['credits:view'],
        system: 'mistwarp: test'
    });
    t.end();
});

test('reuses a stored token with a matching scope set', async t => {
    const economy = new RoturEconomy(makeRuntime(['roturEconomy_balance']));

    t.equal(await economy.balance({}), 42);
    t.same(logins, [['credits:view']]);
    t.end();
});

test('logs in again when the stored token no longer validates', async t => {
    authValid = false;
    const economy = new RoturEconomy(makeRuntime(['roturEconomy_balance']));

    t.equal(await economy.balance({}), 42);
    t.same(logins, [['credits:view'], ['credits:view']]);
    t.same(JSON.parse(store['mw:rotur-sdk-token']), {
        token: 'token-2',
        scopes: ['credits:view'],
        system: 'mistwarp: test'
    });
    authValid = true;
    t.end();
});

test('does not hand another project on the same origin the stored token', async t => {
    const economy = new RoturEconomy(makeRuntime(['roturEconomy_balance'], 'other'));
    const before = logins.length;

    t.equal(await economy.balance({}), 42);
    t.equal(logins.length, before + 1);
    t.equal(systems[systems.length - 1], 'mistwarp: other');
    t.end();
});

test('the request block widens the token to cover the extra scope', async t => {
    const runtime = makeRuntime(['roturEconomy_balance', 'rotur_request']);
    const account = new RoturAccount(runtime);
    const economy = new RoturEconomy(runtime);

    t.equal(await economy.balance({}), 42);
    const before = logins.length;

    t.equal(await account.request({SCOPES: 'credits:transfer'}), true);
    t.same(logins[before], ['credits:view', 'credits:transfer']);

    t.equal(await account.request({SCOPES: 'credits:transfer'}), true);
    t.equal(logins.length, before + 1);
    t.end();
});
