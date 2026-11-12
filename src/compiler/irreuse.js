// @ts-check

const {StackOpcode, InputOpcode} = require('./enums.js');
const {IntermediateStackBlock, IntermediateInput, IntermediateStack} = require('./intermediate');
const JSGenerator = require('./jsgen');

const RAW = 'raw';
const REUSABLE_CASTS = new Set([
    InputOpcode.CAST_NUMBER,
    InputOpcode.CAST_NUMBER_OR_NAN,
    InputOpcode.CAST_NUMBER_INDEX,
    InputOpcode.CAST_STRING,
    InputOpcode.CAST_BOOLEAN
]);
const KINDS = [RAW, ...REUSABLE_CASTS];
const SCOPES = ['target', 'stage'];
const MAX_OPAQUE_DEPTH = 4;

const LOOPS = new Set([StackOpcode.CONTROL_REPEAT, StackOpcode.CONTROL_WHILE, StackOpcode.CONTROL_FOR]);
const LIST_WRITES = new Set([
    StackOpcode.LIST_ADD,
    StackOpcode.LIST_INSERT,
    StackOpcode.LIST_REPLACE,
    StackOpcode.LIST_DELETE,
    StackOpcode.LIST_DELETE_ALL
]);
const LIST_ITEM_WRITES = new Set([StackOpcode.LIST_ADD, StackOpcode.LIST_INSERT, StackOpcode.LIST_REPLACE]);
const TRANSPARENT = new Set([
    StackOpcode.NOP,
    StackOpcode.MOTION_X_SET,
    StackOpcode.MOTION_Y_SET,
    StackOpcode.MOTION_XY_SET,
    StackOpcode.MOTION_X_CHANGE,
    StackOpcode.MOTION_Y_CHANGE,
    StackOpcode.MOTION_DIRECTION_SET,
    StackOpcode.MOTION_POINT_TOWARDS_XY,
    StackOpcode.MOTION_POINT_TOWARDS_XY_FROM,
    StackOpcode.MOTION_STEP,
    StackOpcode.LOOKS_SIZE_SET,
    StackOpcode.LOOKS_SIZE_CHANGE,
    StackOpcode.LOOKS_EFFECT_SET,
    StackOpcode.LOOKS_EFFECT_CHANGE,
    StackOpcode.LOOKS_EFFECT_CLEAR,
    StackOpcode.LOOKS_SHOW,
    StackOpcode.LOOKS_HIDE,
    StackOpcode.LOOKS_COSTUME_SET,
    StackOpcode.LOOKS_COSTUME_NEXT,
    StackOpcode.PEN_CLEAR,
    StackOpcode.PEN_DOWN,
    StackOpcode.PEN_UP,
    StackOpcode.PEN_STAMP,
    StackOpcode.PEN_COLOR_SET,
    StackOpcode.PEN_COLOR_PARAM_SET,
    StackOpcode.PEN_COLOR_PARAM_CHANGE,
    StackOpcode.PEN_COLOR_HUE_SET_LEGACY,
    StackOpcode.PEN_COLOR_HUE_CHANGE_LEGACY,
    StackOpcode.PEN_COLOR_SHADE_SET_LEGACY,
    StackOpcode.PEN_COLOR_SHADE_CHANGE_LEGACY,
    StackOpcode.PEN_SIZE_SET,
    StackOpcode.PEN_SIZE_CHANGE,
    StackOpcode.PEN_DRAW_TRIANGLE
]);
const HANDLED = new Set([
    ...TRANSPARENT,
    ...LOOPS,
    ...LIST_WRITES,
    StackOpcode.CONTROL_IF_ELSE,
    StackOpcode.CONTROL_STOP_SCRIPT,
    StackOpcode.VAR_SET,
    StackOpcode.PROCEDURE_CALL,
    StackOpcode.PROCEDURE_RETURN
]);

const KILLS_EVERYTHING = {all: true, ids: new Set()};
const OPAQUE = {block: null, pure: false};
const EVERY_ITERATION = {block: null, pure: true};

const isTracked = variable => variable.type === '' && !variable.isCloud;

const variableKey = (variable, kind) => `${variable.scope}:${kind}:${variable.id}`;

const isPlainObject = value => typeof value === 'object' && value !== null &&
    Object.getPrototypeOf(value) === Object.prototype;

const find = value => {
    while (value.parent) value = value.parent;
    return value;
};

const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) rootB.parent = rootA;
    return rootA;
};

const emptyState = () => ({variables: new Map(), arguments: new Map(), dead: false});

const cloneState = state => ({
    variables: new Map(state.variables),
    arguments: new Map(state.arguments),
    dead: state.dead
});

const joinValues = (a, b) => {
    const joined = new Map();
    for (const [key, value] of a) {
        const other = b.get(key);
        if (other) joined.set(key, union(value, other));
    }
    return joined;
};

const joinStates = (a, b) => {
    if (a.dead) return b;
    if (b.dead) return a;
    return {
        variables: joinValues(a.variables, b.variables),
        arguments: joinValues(a.arguments, b.arguments),
        dead: false
    };
};

const isPure = value => {
    if (value instanceof IntermediateInput) {
        if (!JSGenerator.PROMOTION_SAFE_INPUT.has(value.opcode) || value.yields) return false;
        return Object.values(value.inputs).every(isPure);
    }
    if (Array.isArray(value)) return value.every(isPure);
    return !(value instanceof IntermediateStack || value instanceof IntermediateStackBlock);
};

const ownInputs = block => {
    const node = block.inputs;
    switch (block.opcode) {
    case StackOpcode.CONTROL_IF_ELSE:
    case StackOpcode.CONTROL_WHILE:
        return [node.condition];
    case StackOpcode.CONTROL_REPEAT:
        return [node.times];
    case StackOpcode.CONTROL_FOR:
        return [node.count];
    default:
        return Object.values(node);
    }
};

class ValueReuse {
    constructor (script) {
        this.script = script;
        this.state = emptyState();
        this.loops = [];
        this.values = [];
        this.uses = [];
        this.bindings = [];
        this.stores = [];
        this.seen = new Set();
        this.shared = false;
        this.opaque = new WeakMap();
        this.summaries = new WeakMap();
    }

    mark (node) {
        if (this.seen.has(node)) this.shared = true;
        this.seen.add(node);
    }

    isOpaque (block) {
        let opaque = this.opaque.get(block);
        if (typeof opaque === 'undefined') {
            opaque = !HANDLED.has(block.opcode) ||
                (block.opcode === StackOpcode.PROCEDURE_CALL && this.callYieldsFirst(block)) ||
                !ownInputs(block).every(isPure);
            this.opaque.set(block, opaque);
        }
        return opaque;
    }

    callYieldsFirst (block) {
        return !this.script.isWarp && block.inputs.code === this.script.procedureCode;
    }

    loopYields (block) {
        return !this.script.isWarp || this.script.warpTimer || block.inputs.warpTimer || block.yields;
    }

    summarize (stack) {
        let summary = this.summaries.get(stack);
        if (!summary) {
            summary = {all: false, ids: new Set()};
            for (const block of stack.blocks) {
                this.addKills(block, summary);
                if (summary.all) break;
            }
            this.summaries.set(stack, summary);
        }
        return summary;
    }

    mergeKills (summary, other) {
        if (other.all) summary.all = true;
        for (const id of other.ids) summary.ids.add(id);
    }

    addKills (block, summary) {
        if (this.isOpaque(block)) {
            summary.all = true;
            return;
        }
        const node = block.inputs;
        if (block.opcode === StackOpcode.VAR_SET) {
            summary.ids.add(node.variable.id);
        } else if (LIST_WRITES.has(block.opcode)) {
            summary.ids.add(node.list.id);
        } else if (block.opcode === StackOpcode.PROCEDURE_CALL) {
            summary.all = true;
        } else if (block.opcode === StackOpcode.CONTROL_IF_ELSE) {
            this.mergeKills(summary, this.summarize(node.whenTrue));
            this.mergeKills(summary, this.summarize(node.whenFalse));
        } else if (LOOPS.has(block.opcode)) {
            this.mergeKills(summary, this.loopSummary(block));
        }
    }

    loopSummary (block) {
        if (this.loopYields(block)) return KILLS_EVERYTHING;
        const body = this.summarize(block.inputs.do);
        if (block.opcode !== StackOpcode.CONTROL_FOR) return body;
        const summary = {all: body.all, ids: new Set(body.ids)};
        summary.ids.add(block.inputs.variable.id);
        return summary;
    }

    kill (id) {
        for (const scope of SCOPES) {
            for (const kind of KINDS) {
                this.state.variables.delete(`${scope}:${kind}:${id}`);
            }
        }
    }

    applyKills (summary) {
        if (summary.all) {
            this.state.variables.clear();
            return;
        }
        for (const id of summary.ids) this.kill(id);
    }

    lookup (map, key) {
        const value = this.state[map].get(key);
        if (value) return value;
        for (const loop of this.loops) {
            const hoisted = loop[map].get(key);
            if (hoisted) return hoisted;
        }
        return null;
    }

    siteFor (variable, context) {
        for (const loop of this.loops) {
            if (!variable || (!loop.summary.all && !loop.summary.ids.has(variable.id))) {
                return {block: loop.block, loop};
            }
        }
        return context.block ? {block: context.block, loop: null} : null;
    }

    define (site, map, key, node, kind, variable) {
        const value = {parent: null, reads: 0, kind, variable};
        this.values.push(value);
        (site.loop || this.state)[map].set(key, value);
        this.bindings.push({block: site.block, value, node});
        return value;
    }

    useArgumentCast (node, context) {
        const key = `${node.opcode}:${node.inputs.target.inputs.index}`;
        let value = this.lookup('arguments', key);
        if (value) {
            value.reads++;
        } else {
            const site = this.siteFor(null, context);
            if (!site) return;
            value = this.define(site, 'arguments', key, node, node.opcode, null);
            if (site.loop) value.reads++;
        }
        this.uses.push({node, value});
    }

    useRaw (node, context, insideBinding) {
        const variable = node.inputs.variable;
        const key = variableKey(variable, RAW);
        let value = this.lookup('variables', key);
        if (value) {
            value.reads++;
        } else {
            const site = this.siteFor(variable, context);
            if (!site) return;
            value = this.define(site, 'variables', key, node, RAW, variable);
            if (site.loop && !insideBinding) value.reads++;
        }
        this.uses.push({node, value});
    }

    useCast (node, context) {
        const target = node.inputs.target;
        const variable = target.inputs.variable;
        const key = variableKey(variable, node.opcode);
        let value = this.lookup('variables', key);
        if (value) {
            value.reads++;
        } else {
            const site = this.siteFor(variable, context);
            this.useRaw(target, context, site !== null);
            if (!site) return;
            value = this.define(site, 'variables', key, node, node.opcode, variable);
            if (site.loop) value.reads++;
        }
        this.uses.push({node, value});
    }

    visitInput (node, context, isStoredItem) {
        this.mark(node);
        if (!isStoredItem) {
            if (REUSABLE_CASTS.has(node.opcode)) {
                const target = node.inputs.target;
                if (target.opcode === InputOpcode.PROCEDURE_ARGUMENT) {
                    this.mark(target);
                    this.useArgumentCast(node, context);
                    return;
                }
                if (context.pure && target.opcode === InputOpcode.VAR_GET && isTracked(target.inputs.variable)) {
                    this.mark(target);
                    this.useCast(node, context);
                    return;
                }
            } else if (context.pure && node.opcode === InputOpcode.VAR_GET && isTracked(node.inputs.variable)) {
                this.useRaw(node, context, false);
                return;
            }
        }
        for (const value of Object.values(node.inputs)) this.visitValue(value, context, 1);
    }

    visitValue (value, context, depth) {
        if (value instanceof IntermediateInput) {
            this.visitInput(value, context, false);
        } else if (Array.isArray(value)) {
            for (const item of value) this.visitValue(item, context, depth);
        } else if (context.pure) {
            return;
        } else if (value instanceof IntermediateStack) {
            this.walkNested(value);
        } else if (isPlainObject(value) && depth < MAX_OPAQUE_DEPTH) {
            for (const item of Object.values(value)) this.visitValue(item, context, depth + 1);
        }
    }

    walkNested (stack) {
        const outer = this.state;
        this.state = {variables: new Map(), arguments: new Map(outer.arguments), dead: false};
        this.walkStack(stack);
        this.state = outer;
    }

    walkOpaque (block) {
        this.state.variables.clear();
        this.visitValue(block.inputs, OPAQUE, 0);
        this.state.variables.clear();
        this.state.arguments.clear();
    }

    walkLoop (block) {
        const node = block.inputs;
        const context = {block, pure: true};
        if (block.opcode === StackOpcode.CONTROL_REPEAT) this.visitInput(node.times, context, false);
        const loop = {block, summary: this.loopSummary(block), variables: new Map(), arguments: new Map()};
        this.applyKills(loop.summary);
        this.loops.push(loop);
        if (block.opcode === StackOpcode.CONTROL_WHILE) this.visitInput(node.condition, EVERY_ITERATION, false);
        if (block.opcode === StackOpcode.CONTROL_FOR) this.visitInput(node.count, EVERY_ITERATION, false);
        const head = this.state;
        this.state = cloneState(head);
        this.walkStack(node.do);
        this.loops.pop();
        this.state = head;
        for (const map of ['variables', 'arguments']) {
            for (const [key, value] of loop[map]) {
                if (!head[map].has(key)) head[map].set(key, value);
            }
        }
    }

    walkBlock (block) {
        this.mark(block);
        if (this.isOpaque(block)) {
            this.walkOpaque(block);
            return;
        }
        const node = block.inputs;
        const context = {block, pure: true};
        if (LOOPS.has(block.opcode)) {
            this.walkLoop(block);
        } else if (block.opcode === StackOpcode.CONTROL_IF_ELSE) {
            this.visitInput(node.condition, context, false);
            const before = this.state;
            this.state = cloneState(before);
            this.walkStack(node.whenTrue);
            const whenTrue = this.state;
            this.state = before;
            this.walkStack(node.whenFalse);
            this.state = joinStates(whenTrue, this.state);
        } else if (block.opcode === StackOpcode.VAR_SET) {
            this.visitInput(node.value, context, false);
            this.kill(node.variable.id);
            if (isTracked(node.variable)) {
                const value = {parent: null, reads: 0, kind: RAW, variable: node.variable};
                this.values.push(value);
                this.state.variables.set(variableKey(node.variable, RAW), value);
                this.stores.push({block, value});
            }
        } else if (LIST_WRITES.has(block.opcode)) {
            for (const [name, value] of Object.entries(node)) {
                if (name === 'item' && LIST_ITEM_WRITES.has(block.opcode) && value instanceof IntermediateInput) {
                    this.visitInput(value, context, true);
                } else {
                    this.visitValue(value, context, 0);
                }
            }
            this.kill(node.list.id);
        } else {
            this.visitValue(Object.values(node), context, 0);
            if (block.opcode === StackOpcode.PROCEDURE_CALL) {
                this.state.variables.clear();
            } else if (block.opcode === StackOpcode.CONTROL_STOP_SCRIPT ||
                block.opcode === StackOpcode.PROCEDURE_RETURN) {
                this.state = emptyState();
                this.state.dead = true;
            }
        }
    }

    walkStack (stack) {
        for (const block of stack.blocks) this.walkBlock(block);
    }

    annotate () {
        if (this.shared) return;
        for (const value of this.values) {
            if (value.parent) find(value).reads += value.reads;
        }
        for (const {node, value} of this.uses) {
            const root = find(value);
            if (root.reads > 0) node.reuse = root;
        }
        for (const {block, value, node} of this.bindings) {
            const root = find(value);
            if (root.reads === 0) continue;
            if (!block.reuseBindings) block.reuseBindings = [];
            block.reuseBindings.push({value: root, node});
        }
        for (const {block, value} of this.stores) {
            const root = find(value);
            if (root.reads > 0) block.reuseStore = root;
        }
    }
}

const analyzed = new WeakSet();

const reuseValues = script => {
    if (!script.stack || analyzed.has(script)) return;
    analyzed.add(script);
    const pass = new ValueReuse(script);
    pass.walkStack(script.stack);
    pass.annotate();
};

module.exports = reuseValues;
