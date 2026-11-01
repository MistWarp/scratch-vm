const {test} = require('node:test');
const assert = require('node:assert');
const Variable = require('../../src/engine/variable');

test('Variable scalar default initialization and XML escape', () => {
    const v = new Variable('id1', 'my & <var>"', Variable.SCALAR_TYPE, false);
    assert.strictEqual(v.id, 'id1');
    assert.strictEqual(v.name, 'my & <var>"');
    assert.strictEqual(v.type, Variable.SCALAR_TYPE);
    assert.strictEqual(v.isCloud, false);
    assert.strictEqual(v.value, 0);
    const xml = v.toXML(true);
    assert.match(xml, /<variable/);
    assert.match(xml, /islocal="true"/);
    assert.match(xml, /iscloud="false"/);
    assert.match(xml, /&amp;|&lt;|&gt;|&quot;/);
});

test('Variable list default initialization', () => {
    const v = new Variable('id2', 'myList', Variable.LIST_TYPE, false);
    assert.strictEqual(v.id, 'id2');
    assert.strictEqual(v.name, 'myList');
    assert.strictEqual(v.type, Variable.LIST_TYPE);
    assert.ok(Array.isArray(v.value));
    assert.deepStrictEqual(v.value, []);
    const xml = v.toXML(false);
    assert.match(xml, /type="list"/);
    assert.match(xml, /islocal="false"/);
});

test('Variable broadcast message initializes to name', () => {
    const v = new Variable('id3', 'MSG', Variable.BROADCAST_MESSAGE_TYPE, false);
    assert.strictEqual(v.type, Variable.BROADCAST_MESSAGE_TYPE);
    assert.strictEqual(v.value, 'MSG');
});

test('Invalid variable type throws', () => {
    assert.throws(() => {
        // eslint-disable-next-line no-new
        new Variable('id4', 'bad', 'not-a-type', false);
    }, /Invalid variable type/);
});
