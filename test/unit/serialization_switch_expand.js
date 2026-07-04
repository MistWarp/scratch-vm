const test = require('tap').test;
const sb3 = require('../../src/serialization/sb3');

const textShadow = (id, value, parent) => ({
    id,
    opcode: 'text',
    next: null,
    parent,
    inputs: {},
    fields: {TEXT: {name: 'TEXT', value}},
    shadow: true,
    topLevel: false
});

const stackBlock = (id, opcode, parent, next) => ({
    id,
    opcode,
    next,
    parent,
    inputs: {},
    fields: {},
    shadow: false,
    topLevel: false
});

const makeFixture = () => {
    const blocks = {
        top: {
            id: 'top',
            opcode: 'event_whenflagclicked',
            next: 'sw',
            parent: null,
            inputs: {},
            fields: {},
            shadow: false,
            topLevel: true,
            x: 10,
            y: 20
        },
        sw: {
            id: 'sw',
            opcode: 'control_switch',
            next: 'after',
            parent: 'top',
            inputs: {
                VALUE: {name: 'VALUE', block: 'var1', shadow: 'valshadow'},
                SUBSTACK: {name: 'SUBSTACK', block: 'ft1', shadow: null}
            },
            fields: {},
            shadow: false,
            topLevel: false
        },
        var1: {
            id: 'var1',
            opcode: 'data_variable',
            next: null,
            parent: 'sw',
            inputs: {},
            fields: {VARIABLE: {name: 'VARIABLE', value: 'my var', id: 'varid'}},
            shadow: false,
            topLevel: false
        },
        valshadow: textShadow('valshadow', 'value', 'sw'),
        ft1: {
            id: 'ft1',
            opcode: 'control_case_fallthrough',
            next: 'case1',
            parent: 'sw',
            inputs: {VALUE: {name: 'VALUE', block: 'ftv', shadow: 'ftv'}},
            fields: {},
            shadow: false,
            topLevel: false
        },
        ftv: textShadow('ftv', 'apple', 'ft1'),
        case1: {
            id: 'case1',
            opcode: 'control_case',
            next: 'case2',
            parent: 'ft1',
            inputs: {
                VALUE: {name: 'VALUE', block: 'c1v', shadow: 'c1v'},
                SUBSTACK: {name: 'SUBSTACK', block: 'body1', shadow: null}
            },
            fields: {},
            shadow: false,
            topLevel: false
        },
        c1v: textShadow('c1v', 'banana', 'case1'),
        body1: stackBlock('body1', 'looks_show', 'case1', 'brk1'),
        brk1: stackBlock('brk1', 'control_break', 'body1', null),
        case2: {
            id: 'case2',
            opcode: 'control_case',
            next: 'def1',
            parent: 'case1',
            inputs: {
                VALUE: {name: 'VALUE', block: 'c2v', shadow: 'c2v'},
                SUBSTACK: {name: 'SUBSTACK', block: 'body2', shadow: null}
            },
            fields: {},
            shadow: false,
            topLevel: false
        },
        c2v: textShadow('c2v', 'cherry', 'case2'),
        body2: stackBlock('body2', 'looks_hide', 'case2', null),
        def1: {
            id: 'def1',
            opcode: 'control_default',
            next: null,
            parent: 'case2',
            inputs: {SUBSTACK: {name: 'SUBSTACK', block: 'body3', shadow: null}},
            fields: {},
            shadow: false,
            topLevel: false
        },
        body3: stackBlock('body3', 'looks_show', 'def1', null),
        after: stackBlock('after', 'looks_hide', 'sw', null)
    };
    return blocks;
};

test('expandSwitches lowers switch/case to vanilla if/else chain', t => {
    const blocks = makeFixture();
    const before = JSON.stringify(blocks);
    const result = sb3.expandSwitches(blocks).blocks;

    t.equal(JSON.stringify(blocks), before, 'original block map is not mutated');

    const opcodes = Object.values(result).map(b => b.opcode);
    for (const gone of [
        'control_switch', 'control_case', 'control_case_fallthrough', 'control_default', 'control_break'
    ]) {
        t.notOk(opcodes.includes(gone), `${gone} removed`);
    }
    t.equal(opcodes.filter(o => o === 'control_if_else').length, 2, 'two if_else blocks');
    t.equal(opcodes.filter(o => o === 'operator_equals').length, 3, 'three equals blocks');
    t.equal(opcodes.filter(o => o === 'operator_or').length, 1, 'one or block');

    const outerId = result.top.next;
    const outer = result[outerId];
    t.equal(outer.opcode, 'control_if_else', 'outer block is if_else');
    t.equal(outer.parent, 'top', 'outer parented to top block');
    t.equal(outer.next, 'after', 'switch next preserved on outer if');
    t.equal(result.after.parent, outerId, 'after block reparented to outer if');

    const orBlock = result[outer.inputs.CONDITION.block];
    t.equal(orBlock.opcode, 'operator_or', 'fallthrough group condition is an or');
    const eqFt = result[orBlock.inputs.OPERAND1.block];
    const eqC1 = result[orBlock.inputs.OPERAND2.block];
    t.equal(eqFt.opcode, 'operator_equals');
    t.equal(eqC1.opcode, 'operator_equals');
    t.equal(eqFt.inputs.OPERAND2.block, 'ftv', 'fallthrough value moved into equals');
    t.equal(eqC1.inputs.OPERAND2.block, 'c1v', 'case value moved into equals');

    t.equal(outer.inputs.SUBSTACK.block, 'body1', 'case body moved into if');
    t.equal(result.body1.parent, outerId, 'case body reparented');
    t.equal(result.body1.next, null, 'trailing break stripped from body');
    t.notOk(result.brk1, 'break block deleted');

    const innerId = outer.inputs.SUBSTACK2.block;
    const inner = result[innerId];
    t.equal(inner.opcode, 'control_if_else', 'inner block is if_else');
    const eqC2 = result[inner.inputs.CONDITION.block];
    t.equal(eqC2.opcode, 'operator_equals');
    t.equal(eqC2.inputs.OPERAND2.block, 'c2v');
    t.equal(inner.inputs.SUBSTACK.block, 'body2');
    t.equal(inner.inputs.SUBSTACK2.block, 'body3', 'default body becomes final else');
    t.equal(result.body3.parent, innerId, 'default body reparented');

    const operand1Ids = [eqFt, eqC1, eqC2].map(eq => eq.inputs.OPERAND1.block);
    t.equal(operand1Ids.filter(id => id === 'var1').length, 1, 'original switch value used exactly once');
    t.equal(new Set(operand1Ids).size, 3, 'each comparison has its own copy of the switch value');
    for (const id of operand1Ids) {
        t.equal(result[id].opcode, 'data_variable', 'switch value copies are the same reporter');
        t.equal(result[id].fields.VARIABLE.value, 'my var', 'switch value copies keep fields');
    }

    t.end();
});

test('expandSwitches lowers switches with early break using a vanilla guard', t => {
    const blocks = makeFixture();
    blocks.body1.next = 'brk1';
    blocks.brk1.next = 'body1b';
    blocks.body1b = stackBlock('body1b', 'looks_hide', 'brk1', null);
    const {blocks: result, variables} = sb3.expandSwitches(blocks);

    const opcodes = Object.values(result).map(b => b.opcode);
    for (const gone of [
        'control_switch', 'control_case', 'control_case_fallthrough', 'control_default', 'control_break'
    ]) {
        t.notOk(opcodes.includes(gone), `${gone} removed`);
    }

    const breakVarIds = Object.keys(variables).filter(id => variables[id][0] === 'switch broken');
    t.equal(breakVarIds.length, 1, 'one break guard variable created');
    t.same(variables[breakVarIds[0]], ['switch broken', '0'], 'break guard variable serialized form');

    const clearId = result.top.next;
    t.equal(result[clearId].opcode, 'data_setvariableto', 'guard variable is initialized before the if-chain');
    t.equal(result[clearId].fields.VARIABLE.id, breakVarIds[0], 'initializer writes the guard variable');

    const setBreakId = Object.keys(result).find(id =>
        result[id].opcode === 'data_setvariableto' &&
        result[id].fields.VARIABLE.id === breakVarIds[0] &&
        id !== clearId);
    t.ok(setBreakId, 'break block replaced with a set-variable block');

    const guardId = result[setBreakId].next;
    t.equal(result[guardId].opcode, 'control_if', 'blocks after break are guarded');
    t.equal(result[guardId].inputs.SUBSTACK.block, 'body1b', 'post-break stack moved inside guard');
    const notBlock = result[result[guardId].inputs.CONDITION.block];
    t.equal(notBlock.opcode, 'operator_not', 'guard checks that no break happened');
    const guardRead = result[notBlock.inputs.OPERAND.block];
    t.equal(guardRead.opcode, 'data_variable', 'guard reads the break variable');
    t.equal(guardRead.fields.VARIABLE.id, breakVarIds[0], 'guard reads the right variable');
    t.end();
});

test('expandSwitches lowers nested case breaks using a vanilla guard', t => {
    const blocks = makeFixture();
    blocks.body1.next = 'if1';
    blocks.if1 = {
        id: 'if1',
        opcode: 'control_if',
        next: 'body1b',
        parent: 'body1',
        inputs: {
            CONDITION: {name: 'CONDITION', block: null, shadow: 'ifCond'},
            SUBSTACK: {name: 'SUBSTACK', block: 'brk1', shadow: null}
        },
        fields: {},
        shadow: false,
        topLevel: false
    };
    blocks.ifCond = textShadow('ifCond', 'true', 'if1');
    blocks.brk1.parent = 'if1';
    blocks.brk1.next = null;
    blocks.body1b = stackBlock('body1b', 'looks_hide', 'if1', null);

    const {blocks: result, variables} = sb3.expandSwitches(blocks);
    const opcodes = Object.values(result).map(b => b.opcode);
    t.notOk(opcodes.includes('control_switch'), 'switch removed');
    t.notOk(opcodes.includes('control_case'), 'case removed');
    t.notOk(opcodes.includes('control_break'), 'break removed');

    const breakVarIds = Object.keys(variables).filter(id => variables[id][0] === 'switch broken');
    t.equal(breakVarIds.length, 1, 'one break guard variable created');

    const nestedSetId = result.if1.inputs.SUBSTACK.block;
    t.equal(result[nestedSetId].opcode, 'data_setvariableto', 'nested break replaced with set-variable');
    t.equal(result[nestedSetId].fields.VARIABLE.id, breakVarIds[0], 'nested set writes guard variable');

    const outerGuardId = result.if1.next;
    t.equal(result[outerGuardId].opcode, 'control_if', 'top-level remainder is guarded after nested break');
    t.equal(result[outerGuardId].inputs.SUBSTACK.block, 'body1b', 'post-if stack moved inside guard');
    const notBlock = result[result[outerGuardId].inputs.CONDITION.block];
    t.equal(notBlock.opcode, 'operator_not', 'guard checks that no break happened');
    t.equal(result[notBlock.inputs.OPERAND.block].fields.VARIABLE.id, breakVarIds[0], 'guard reads break variable');
    t.end();
});

test('expandSwitches leaves switches with foreign top-level blocks untouched', t => {
    const blocks = makeFixture();
    blocks.case2.next = 'stray';
    blocks.stray = stackBlock('stray', 'looks_show', 'case2', 'def1');
    blocks.def1.parent = 'stray';
    const result = sb3.expandSwitches(blocks).blocks;

    t.equal(result.sw.opcode, 'control_switch', 'switch kept');
    t.equal(result.top.next, 'sw', 'script untouched');
    t.end();
});

test('expandSwitches handles switch with only a default', t => {
    const blocks = makeFixture();
    blocks.sw.inputs.SUBSTACK.block = 'def1';
    blocks.def1.parent = 'sw';
    for (const id of ['ft1', 'ftv', 'case1', 'c1v', 'body1', 'brk1', 'case2', 'c2v', 'body2']) {
        delete blocks[id];
    }
    const result = sb3.expandSwitches(blocks).blocks;

    t.equal(result.top.next, 'body3', 'default body spliced in place of switch');
    t.equal(result.body3.parent, 'top');
    t.equal(result.body3.next, 'after');
    t.equal(result.after.parent, 'body3');
    t.notOk(result.sw, 'switch deleted');
    t.notOk(result.def1, 'default deleted');
    t.notOk(result.var1, 'unused switch value deleted');
    t.notOk(result.valshadow, 'unused switch value shadow deleted');
    t.end();
});

const substackOpcodes = (blocks, headId) => {
    const out = [];
    let id = headId;
    while (id) {
        out.push({id, opcode: blocks[id].opcode, block: blocks[id]});
        id = blocks[id].next;
    }
    return out;
};

test('expandSwitches then collapseSwitches round-trips a switch', t => {
    const blocks = makeFixture();
    const expanded = sb3.expandSwitches(blocks).blocks;
    const collapsed = sb3.collapseSwitches(expanded, {});

    const opcodes = Object.values(collapsed).map(b => b.opcode);
    t.equal(opcodes.filter(o => o === 'control_switch').length, 1, 'one switch restored');
    t.notOk(opcodes.includes('control_if_else'), 'no if_else left');
    t.notOk(opcodes.includes('operator_equals'), 'no equals left');
    t.notOk(opcodes.includes('operator_or'), 'no or left');

    const switchId = Object.keys(collapsed).find(id => collapsed[id].opcode === 'control_switch');
    const sw = collapsed[switchId];
    t.equal(sw.parent, 'top', 'switch reparented under top');
    t.equal(sw.next, 'after', 'switch next restored');
    t.equal(collapsed.top.next, switchId, 'top points at switch');
    const valueBlock = collapsed[sw.inputs.VALUE.block];
    t.equal(valueBlock.opcode, 'data_variable', 'value is a variable reporter');
    t.equal(valueBlock.fields.VARIABLE.value, 'my var', 'value reporter references the right variable');
    t.equal(Object.values(collapsed).filter(b => b.opcode === 'data_variable').length, 1,
        'exactly one value reporter remains (no leaked copies)');

    const seq = substackOpcodes(collapsed, sw.inputs.SUBSTACK.block);
    t.same(seq.map(s => s.opcode), [
        'control_case_fallthrough', 'control_case', 'control_case', 'control_default'
    ], 'case sequence rebuilt in order');

    t.equal(seq[0].block.inputs.VALUE.block, 'ftv', 'fallthrough value restored');
    t.equal(seq[1].block.inputs.VALUE.block, 'c1v', 'first case value restored');
    t.equal(seq[2].block.inputs.VALUE.block, 'c2v', 'second case value restored');

    const case1Body = substackOpcodes(collapsed, seq[1].block.inputs.SUBSTACK.block);
    t.equal(case1Body[0].id, 'body1', 'first case body restored');
    // Cases break implicitly, so the redundant trailing break is dropped (not restored).
    t.notOk(case1Body.some(s => s.opcode === 'control_break'), 'redundant trailing break not reintroduced');

    const case2Body = substackOpcodes(collapsed, seq[2].block.inputs.SUBSTACK.block);
    t.same(case2Body.map(s => s.opcode), ['looks_hide'], 'second case body restored');

    t.equal(collapsed[seq[3].block.inputs.SUBSTACK.block].id, 'body3', 'default body restored');
    t.end();
});

const makeComplexFixture = () => ({
    top: {
        id: 'top',
        opcode: 'event_whenflagclicked',
        next: 'sw',
        parent: null,
        inputs: {},
        fields: {},
        shadow: false,
        topLevel: true,
        x: 0,
        y: 0
    },
    sw: {
        id: 'sw',
        opcode: 'control_switch',
        next: null,
        parent: 'top',
        inputs: {
            VALUE: {name: 'VALUE', block: 'join', shadow: null},
            SUBSTACK: {name: 'SUBSTACK', block: 'case1', shadow: null}
        },
        fields: {},
        shadow: false,
        topLevel: false
    },
    join: {
        id: 'join',
        opcode: 'operator_join',
        next: null,
        parent: 'sw',
        inputs: {
            STRING1: {name: 'STRING1', block: null, shadow: 'j1'},
            STRING2: {name: 'STRING2', block: null, shadow: 'j2'}
        },
        fields: {},
        shadow: false,
        topLevel: false
    },
    j1: textShadow('j1', 'a', 'join'),
    j2: textShadow('j2', 'b', 'join'),
    case1: {
        id: 'case1',
        opcode: 'control_case',
        next: 'case2',
        parent: 'sw',
        inputs: {
            VALUE: {name: 'VALUE', block: 'c1v', shadow: 'c1v'},
            SUBSTACK: {name: 'SUBSTACK', block: 'body1', shadow: null}
        },
        fields: {},
        shadow: false,
        topLevel: false
    },
    c1v: textShadow('c1v', 'ab', 'case1'),
    body1: stackBlock('body1', 'looks_show', 'case1', null),
    case2: {
        id: 'case2',
        opcode: 'control_case',
        next: null,
        parent: 'case1',
        inputs: {
            VALUE: {name: 'VALUE', block: 'c2v', shadow: 'c2v'},
            SUBSTACK: {name: 'SUBSTACK', block: 'body2', shadow: null}
        },
        fields: {},
        shadow: false,
        topLevel: false
    },
    c2v: textShadow('c2v', 'cd', 'case2'),
    body2: stackBlock('body2', 'looks_hide', 'case2', null)
});

test('expandSwitches uses a temp variable when the switch input has inputs', t => {
    const blocks = makeComplexFixture();
    const {blocks: result, variables} = sb3.expandSwitches(blocks);

    const varIds = Object.keys(variables);
    t.equal(varIds.length, 1, 'one temp variable created');
    t.same(variables[varIds[0]], ['switch value', ''], 'temp variable serialized form');

    const setId = Object.keys(result).find(id => result[id].opcode === 'data_setvariableto');
    t.ok(setId, 'a set-variable block was emitted');
    t.equal(result[setId].inputs.VALUE.block, 'join', 'switch input expression moved into the set block');
    t.equal(result[setId].fields.VARIABLE.id, varIds[0], 'set block writes the temp variable');
    t.equal(result.top.next, setId, 'set block runs before the if-chain');

    const equalsId = Object.keys(result).find(id => result[id].opcode === 'operator_equals');
    const operand1 = result[result[equalsId].inputs.OPERAND1.block];
    t.equal(operand1.opcode, 'data_variable', 'comparison reads the temp variable');
    t.equal(operand1.fields.VARIABLE.id, varIds[0], 'comparison reads the right temp variable');

    // The join expression must appear only once (not duplicated per comparison).
    t.equal(Object.values(result).filter(b => b.opcode === 'operator_join').length, 1, 'input expression evaluated once');
    t.end();
});

test('collapseSwitches restores a temp-variable switch input and removes the temp var', t => {
    const blocks = makeComplexFixture();
    const {blocks: expanded, variables} = sb3.expandSwitches(blocks);
    const collapsed = sb3.collapseSwitches(expanded, variables);

    t.equal(Object.keys(variables).length, 0, 'temp variable removed on collapse');
    t.notOk(Object.values(collapsed).some(b => b.opcode === 'data_setvariableto'), 'set block removed');

    const switchId = Object.keys(collapsed).find(id => collapsed[id].opcode === 'control_switch');
    const sw = collapsed[switchId];
    t.equal(sw.inputs.VALUE.block, 'join', 'original input expression restored to the switch');
    t.equal(collapsed.join.parent, switchId, 'input expression reparented under switch');
    t.equal(collapsed.top.next, switchId, 'switch spliced back in place of the set block');
    t.end();
});

test('expandSwitches lowers nested switches innermost-first', t => {
    const blocks = makeFixture();
    // Put a second switch inside the first case body.
    blocks.body1.next = 'innerSw';
    blocks.innerSw = {
        id: 'innerSw',
        opcode: 'control_switch',
        next: null,
        parent: 'body1',
        inputs: {
            VALUE: {name: 'VALUE', block: null, shadow: 'innerVal'},
            SUBSTACK: {name: 'SUBSTACK', block: 'innerCase', shadow: null}
        },
        fields: {},
        shadow: false,
        topLevel: false
    };
    blocks.innerVal = textShadow('innerVal', 'z', 'innerSw');
    blocks.innerCase = {
        id: 'innerCase',
        opcode: 'control_case',
        next: null,
        parent: 'innerSw',
        inputs: {
            VALUE: {name: 'VALUE', block: null, shadow: 'innerCaseVal'},
            SUBSTACK: {name: 'SUBSTACK', block: 'innerBody', shadow: null}
        },
        fields: {},
        shadow: false,
        topLevel: false
    };
    blocks.innerCaseVal = textShadow('innerCaseVal', 'z', 'innerCase');
    blocks.innerBody = stackBlock('innerBody', 'looks_show', 'innerCase', null);

    const result = sb3.expandSwitches(blocks).blocks;
    const opcodes = Object.values(result).map(b => b.opcode);
    t.notOk(opcodes.includes('control_switch'), 'both switches lowered');
    t.notOk(opcodes.includes('control_case'), 'no cases left');
    t.end();
});
