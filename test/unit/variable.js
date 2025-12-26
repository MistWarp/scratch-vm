const test = require('tap').test;
const Variable = require('../../src/engine/variable');

test('Variable scalar default initialization and XML escape', t => {
    const v = new Variable('id1', 'my & <var>"', Variable.SCALAR_TYPE, false);
    t.equal(v.id, 'id1');
    t.equal(v.name, 'my & <var>"');
    t.equal(v.type, Variable.SCALAR_TYPE);
    t.equal(v.isCloud, false);
    t.equal(v.value, 0);
    const xml = v.toXML(true);
    t.match(xml, /<variable/);
    t.match(xml, /islocal="true"/);
    t.match(xml, /iscloud="false"/);
    t.match(xml, /&amp;|&lt;|&gt;|&quot;/);
    t.end();
});

test('Variable list default initialization', t => {
    const v = new Variable('id2', 'myList', Variable.LIST_TYPE, false);
    t.equal(v.id, 'id2');
    t.equal(v.name, 'myList');
    t.equal(v.type, Variable.LIST_TYPE);
    t.ok(Array.isArray(v.value));
    t.same(v.value, []);
    const xml = v.toXML(false);
    t.match(xml, /type="list"/);
    t.match(xml, /islocal="false"/);
    t.end();
});

test('Variable broadcast message initializes to name', t => {
    const v = new Variable('id3', 'MSG', Variable.BROADCAST_MESSAGE_TYPE, false);
    t.equal(v.type, Variable.BROADCAST_MESSAGE_TYPE);
    t.equal(v.value, 'MSG');
    t.end();
});

test('Invalid variable type throws', t => {
    t.throws(() => {
        // eslint-disable-next-line no-new
        new Variable('id4', 'bad', 'not-a-type', false);
    }, /Invalid variable type/);
    t.end();
});
