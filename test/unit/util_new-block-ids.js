const newBlockIds = require('../../src/util/new-block-ids');
const simpleStack = require('../fixtures/simple-stack');
const tap = require('tap');
const test = tap.test;

let originals;
let newBlocks;

tap.beforeEach(() => {
    originals = simpleStack;
    // Will be mutated so make a copy first
    newBlocks = JSON.parse(JSON.stringify(simpleStack));
    newBlockIds(newBlocks);
});


/**
 * The structure of the simple stack is:
 *      moveTo (looks_size) -> stopAllSounds
 * The list of blocks is
 *      0: moveTo (TO input block: 1, shadow: 2)
 *      1: looks_size (parent: 0)
 *      2: obscured shadow for moveTo input (parent: 0)
 *      3: stopAllSounds (parent: 0)
 * Inspect fixtures/simple-stack for the full object.
 */

test('top-level block IDs have all changed', t => {
    newBlocks.forEach((block, i) => {
        t.notEqual(block.id, originals[i].id);
    });
    t.end();
});

test('input reference is maintained on parent for attached block', t => {
    t.equal(newBlocks[0].inputs.TO.block, newBlocks[1].id);
    t.end();
});

test('input reference is maintained on parent for obscured shadow', t => {
    t.equal(newBlocks[0].inputs.TO.shadow, newBlocks[2].id);
    t.end();
});

test('parent reference is maintained for attached input', t => {
    t.equal(newBlocks[1].parent, newBlocks[0].id);
    t.end();
});

test('parent reference is maintained for obscured shadow', t => {
    t.equal(newBlocks[2].parent, newBlocks[0].id);
    t.end();
});

test('parent reference is maintained for next block', t => {
    t.equal(newBlocks[3].parent, newBlocks[0].id);
    t.end();
});

test('next reference is maintained for previous block', t => {
    t.equal(newBlocks[0].next, newBlocks[3].id);
    t.end();
});

// Collapsed variadic operators (extendable +, join, and/or) carry an obscuredHeadShadows array of
// shadow block ids that expandOperators restores on save. It must be remapped like any other id
// reference, or duplicating/sharing the sprite leaves it pointing at ids that no longer exist and
// the typed values hidden under dropped reporters are lost on the next save.
test('obscuredHeadShadows ids are remapped', t => {
    const blocks = [
        {id: 'op', opcode: 'operator_join', parent: null, next: null,
            inputs: {STRING1: {name: 'STRING1', block: 'shadow', shadow: 'shadow'}},
            obscuredHeadShadows: ['shadow', null]},
        {id: 'shadow', opcode: 'text', parent: 'op', next: null, inputs: {}}
    ];
    newBlockIds(blocks);
    t.equal(blocks[0].obscuredHeadShadows[0], blocks[1].id, 'shadow id remapped to new id');
    t.equal(blocks[0].obscuredHeadShadows[1], null, 'null entries preserved');
    t.end();
});
