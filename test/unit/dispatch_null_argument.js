const {test} = require('node:test');
const assert = require('node:assert');
const dispatch = require('../../src/dispatch/central-dispatch');

// A sandboxed extension that fails before registering reports it with
// onWorkerInit(id, message, null) when the error has no line. That call must
// still be sent, or the editor waits for the extension forever.
test('a call whose last argument is null is still posted', () => {
    const posted = [];
    const provider = {postMessage: message => posted.push(message)};
    dispatch._remoteTransferCall(provider, 'extensions', 'onWorkerInit', null, 3, 'Error: Script error.', null);
    assert.strictEqual(posted.length, 1);
    assert.deepStrictEqual(posted[0].args, [3, 'Error: Script error.', null]);
});
