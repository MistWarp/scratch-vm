const {test} = require('node:test');
const assert = require('node:assert');
const {CORE_OPCODE_PREFIXES, CORE_EXTENSION_IDS} = require('../../src/extension-support/core-extensions');
const ExtensionManager = require('../../src/extension-support/extension-manager');
const sb2SpecMap = require('../../src/serialization/sb2_specmap');
const sb3 = require('../../src/serialization/sb3');

test('core opcode prefixes are not treated as extensions by sb3', () => {
    for (const prefix of CORE_OPCODE_PREFIXES) {
        assert.strictEqual(sb3.getExtensionIdForOpcode(`${prefix}_test`), undefined, prefix);
    }
    assert.strictEqual(sb3.getExtensionIdForOpcode('pen_clear'), 'pen');
});

test('every sb2 core opcode prefix is a core opcode prefix', () => {
    const extensionPrefixes = new Set(['music', 'pen', 'videoSensing', 'wedo2']);
    for (const sb2Opcode of Object.keys(sb2SpecMap)) {
        const opcode = sb2SpecMap[sb2Opcode].opcode;
        if (typeof opcode !== 'string') continue;
        const prefix = opcode.substring(0, opcode.indexOf('_'));
        if (!extensionPrefixes.has(prefix)) {
            assert.ok(CORE_OPCODE_PREFIXES.includes(prefix), `${sb2Opcode} -> ${opcode}`);
        }
    }
});

test('ExtensionManager reports the core extension IDs as core', () => {
    const manager = Object.create(ExtensionManager.prototype);
    manager.coreExtensions = CORE_EXTENSION_IDS;
    for (const id of CORE_EXTENSION_IDS) {
        assert.ok(manager.isCoreExtension(id), id);
    }
    assert.ok(!manager.isCoreExtension('pen'));
});
