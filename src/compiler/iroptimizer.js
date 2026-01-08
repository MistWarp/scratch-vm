const {BLOCKS} = require('./enums');

class IROptimizer {
    constructor () {
        /**
         * @type {Object.<string, import('./intermediate').IntermediateScript> | null}
         * @private
         */
        this._procedures = null;

        /**
         * @type {Map<string, {returnValue: node}> | null}
         * @private
         */
        this._inlineableProcedures = null;
    }

    /**
     * Optimize a script.
     * @param {*} script The script to optimize.
      * @param {Object.<string, import('./intermediate').IntermediateScript>=} procedures
      * All known procedures keyed by variant.
     * @returns {*} The optimized script.
     */
    optimizeScript (script, procedures) {
        this._procedures = procedures || null;
        this._inlineableProcedures = this._procedures ? this._computeInlineableProcedures(this._procedures) : null;

        /**
         * @param {node[]} nodes The nodes to optimize.
         * @returns {node[]} The optimized nodes.
         */
        const optimizeStack = nodes => {
            if (!nodes || !nodes.length) return [];
            const out = [];
            let prev = null;
            for (let i = 0; i < nodes.length; i++) {
                const chain = this._tryConvertEqualsIfChain(nodes, i);
                if (chain) {
                    const {converted, count} = chain;
                    for (const nn of converted) {
                        if (!this._isDuplicate(prev, nn)) {
                            out.push(nn);
                            prev = nn;
                        }
                    }
                    i += (count - 1);
                    continue;
                }
                const node = nodes[i];
                const n = this.optimizeNode(node);
                if (!n) continue;
                if (Array.isArray(n)) {
                    for (const nn of n) {
                        if (!nn) continue;
                        if (!this._isDuplicate(prev, nn)) {
                            out.push(nn);
                            prev = nn;
                        }
                    }
                    continue;
                }
                if (!this._isDuplicate(prev, n)) {
                    out.push(n);
                    prev = n;
                }
            }
            return out;
        };
        script.stack = optimizeStack(script.stack);
        return script;
    }

    /**
     * Optimize a node.
     * @param {node} node The node to optimize.
     * @private
     * @returns {node|null} The optimized node, or null if the node should be removed.
     */
    optimizeNode (node) {
        if (!node) return null;
        switch (node.kind) {
        case BLOCKS.NOOP:
            return null;
        case BLOCKS.CONTROL.IF: {
            const cond = node.condition;
            if (cond && cond.kind === BLOCKS.CONSTANT) {
                const stack = cond.value ? node.whenTrue : node.whenFalse;
                node.whenTrue = this._optimizeSubstack(stack);
                node.value = true;
                return node;
            }
            node.whenTrue = this._optimizeSubstack(node.whenTrue);
            if (node.whenFalse) node.whenFalse = this._optimizeSubstack(node.whenFalse);
            return node;
        }
        case BLOCKS.CONTROL.REPEAT: {
            node.times = this.optimizeInput(node.times);
            node.do = this._optimizeSubstack(node.do);
            return node;
        }
        case BLOCKS.CONTROL.WHILE: {
            const cond = node.condition;
            if (cond && cond.kind === BLOCKS.CONSTANT) {
                const v = !!cond.value;
                if (!v) return null;
            }
            node.do = this._optimizeSubstack(node.do);
            return node;
        }
        case BLOCKS.CONTROL.SWITCH:
        case BLOCKS.CONTROL.CASE:
        case BLOCKS.CONTROL.DEFAULT: {
            node.do = this._optimizeSubstack(node.do);
            return node;
        }
        case BLOCKS.VAR.SET: {
            node.value = this.optimizeInput(node.value);
            return node;
        }
        case BLOCKS.LIST.ADD:
        case BLOCKS.LIST.INSERT:
        case BLOCKS.LIST.REPLACE: {
            node.index = this.optimizeInput(node.index);
            node.item = this.optimizeInput(node.item);
            return node;
        }
        default:
            return this.optimizeInputs(node);
        }
    }

    /**
     * Optimize a stack.
     * @param {node[]} stack The stack to optimize.
     * @private
     * @returns {node[]} The optimized stack.
     */
    _optimizeSubstack (stack) {
        if (!stack || !stack.length) return [];
        const out = [];
        let prev = null;
        for (const node of stack) {
            const n = this.optimizeNode(node);
            if (!n) continue;
            if (Array.isArray(n)) {
                for (const nn of n) {
                    if (!nn) continue;
                    if (!this._isDuplicate(prev, nn)) {
                        out.push(nn);
                        prev = nn;
                    }
                }
            } else if (!this._isDuplicate(prev, n)) {
                out.push(n);
                prev = n;
            }
        }
        return out;
    }

    /**
     * Check if two nodes are duplicates.
     * @param {node} prev The previous node.
     * @param {node} next The next node.
     * @private
     * @returns {boolean} True if the nodes are duplicates.
     */
    _isDuplicate (prev, next) {
        if (!prev || !next) return false;
        if (prev.kind !== next.kind) return false;
        switch (next.kind) {
        case BLOCKS.LIST.DELETE_ALL:
            return prev.list && next.list && prev.list.id === next.list.id;
        case BLOCKS.LIST.SHOW:
        case BLOCKS.LIST.HIDE:
            return prev.list && next.list && prev.list.id === next.list.id;
        case BLOCKS.VAR.SHOW:
        case BLOCKS.VAR.HIDE:
            return prev.variable && next.variable && prev.variable.id === next.variable.id;
        case BLOCKS.LOOKS.CLEAR_EFFECTS:
        case BLOCKS.LOOKS.GOTO_FRONT:
        case BLOCKS.LOOKS.GOTO_BACK:
        case BLOCKS.LOOKS.SHOW:
        case BLOCKS.LOOKS.HIDE:
            return true;
        default:
            return false;
        }
    }

    /**
     * Get a unique key for a node.
     * @param {node} node The node to get a key for.
     * @private
     * @returns {string} The unique key for the node.
     */
    _nodeKey (node) {
        try {
            return JSON.stringify(node);
        } catch (_e) {
            return '';
        }
    }

    /**
     * Optimize the inputs of a node.
     * @param {node} node The node to optimize.
     * @private
     * @returns {node} The optimized node.
     */
    optimizeInputs (node) {
        if (!node) return node;
        for (const k of Object.keys(node)) {
            const v = node[k];
            if (v && typeof v === 'object' && v.kind) {
                node[k] = this.optimizeInput(v);
            }
        }
        return node;
    }

    /**
     * Optimize an input.
     * @param {node} node The input to optimize.
     * @private
     * @returns {node} The optimized input.
     */
    optimizeInput (node) {
        if (!node) return node;
        switch (node.kind) {
        case BLOCKS.OP.ADD:
        case BLOCKS.OP.SUBTRACT:
        case BLOCKS.OP.MULTIPLY:
        case BLOCKS.OP.DIVIDE:
        case BLOCKS.OP.MOD:
            return this._optimizeArithmetic(node);
        case BLOCKS.OP.LENGTH:
            return this._optimizeLength(node);
        case BLOCKS.OP.JOIN:
            return this._optimizeJoin(node);
        case BLOCKS.OP.NOT:
            return this._optimizeNot(node);
        case BLOCKS.PROCEDURES.CALL: {
            // Ensure procedure call arguments get optimized (they live in an array).
            if (Array.isArray(node.arguments)) {
                node.arguments = node.arguments.map(arg => this.optimizeInput(arg));
            }

            const inlined = this._tryInlineProcedureCall(node);
            if (inlined) {
                // The inlined expression may now be optimizable (e.g. constant folding)
                return this.optimizeInput(inlined);
            }
            return node;
        }
        default:
            return this.optimizeInputs(node);
        }
    }

    /**
     * @param {Object.<string, import('./intermediate').IntermediateScript>} procedures
     * @returns {Map<string, {returnValue: node}>}
     * @private
     */
    _computeInlineableProcedures (procedures) {
        const result = new Map();
        for (const variant of Object.keys(procedures)) {
            const proc = procedures[variant];
            const info = this._getReturnOnlyProcedureInfo(proc);
            if (!info) continue;
            result.set(variant, info);
        }
        return result;
    }

    /**
     * A procedure is inlineable if:
     *  - it cannot yield
     *  - its body is exactly `return <expr>` (ignoring NOOPs)
     * @param {import('./intermediate').IntermediateScript} proc
     * @returns {{returnValue: node} | null}
     * @private
     */
    _getReturnOnlyProcedureInfo (proc) {
        if (!proc || !proc.isProcedure) return null;
        if (proc.yields) return null;
        // If there are any arguments, don't inline.
        if (Array.isArray(proc.arguments) && proc.arguments.length > 0) return null;
        if (!Array.isArray(proc.stack)) return null;

        const filtered = proc.stack.filter(n => n && n.kind !== BLOCKS.NOOP);
        if (filtered.length !== 1) return null;
        const only = filtered[0];
        if (!only || only.kind !== BLOCKS.PROCEDURES.RETURN) return null;
        if (!only.value || typeof only.value !== 'object') return null;

        // Don't inline if the returned expression calls another procedure.
        if (this._containsAnyCall(only.value)) return null;

        return {returnValue: only.value};
    }

    /**
     * @param {node} callNode
     * @returns {node|null}
     * @private
     */
    _tryInlineProcedureCall (callNode) {
        if (!this._procedures || !this._inlineableProcedures) return null;
        if (!callNode || callNode.kind !== BLOCKS.PROCEDURES.CALL) return null;
        const variant = callNode.variant;
        if (!variant || typeof variant !== 'string') return null;

        const inlineInfo = this._inlineableProcedures.get(variant);
        if (!inlineInfo) return null;

        // Avoid infinite expansion if the return expression calls itself.
        if (this._containsProcedureVariant(inlineInfo.returnValue, variant)) {
            return null;
        }

        const proc = this._procedures[variant];
        const args = Array.isArray(callNode.arguments) ? callNode.arguments : [];
        const argCount = Array.isArray(proc.arguments) ? proc.arguments.length : 0;
        if (args.length !== argCount) {
            // Shouldn't happen, but avoid mis-substitution.
            return null;
        }

        // Basic safety: don't inline if any argument contains a procedure/addon call.
        for (const arg of args) {
            if (this._containsAnyCall(arg)) return null;
        }

        return this._cloneAndSubstituteArguments(inlineInfo.returnValue, args);
    }

    /**
     * @param {node} node
     * @param {node[]} args
     * @returns {node}
     * @private
     */
    _cloneAndSubstituteArguments (node, args) {
        if (!node || typeof node !== 'object') return node;
        if (node.kind === BLOCKS.PROCEDURES.ARGUMENT) {
            const idx = node.index;
            if (typeof idx === 'number' && idx >= 0 && idx < args.length) {
                return this._deepClone(args[idx]);
            }
            return {kind: BLOCKS.CONSTANT, value: 0};
        }

        if (Array.isArray(node)) {
            // Shouldn't happen for nodes, but handle defensively.
            return /** @type {any} */ (node.map(n => this._cloneAndSubstituteArguments(n, args)));
        }

        const out = {};
        for (const k of Object.keys(node)) {
            const v = node[k];
            if (v && typeof v === 'object') {
                out[k] = this._cloneAndSubstituteArguments(v, args);
            } else {
                out[k] = v;
            }
        }
        return /** @type {any} */ (out);
    }

    /**
     * @param {any} value
     * @returns {any}
     * @private
     */
    _deepClone (value) {
        if (!value || typeof value !== 'object') return value;
        if (Array.isArray(value)) return value.map(v => this._deepClone(v));
        const out = {};
        for (const k of Object.keys(value)) {
            out[k] = this._deepClone(value[k]);
        }
        return out;
    }

    /**
     * @param {node} node
     * @param {string} variant
     * @returns {boolean}
     * @private
     */
    _containsProcedureVariant (node, variant) {
        if (!node || typeof node !== 'object') return false;
        if (node.kind === BLOCKS.PROCEDURES.CALL && node.variant === variant) return true;
        if (Array.isArray(node)) return node.some(n => this._containsProcedureVariant(n, variant));
        for (const v of Object.values(node)) {
            if (v && typeof v === 'object' && this._containsProcedureVariant(v, variant)) return true;
        }
        return false;
    }

    /**
     * @param {node} node
     * @returns {boolean}
     * @private
     */
    _containsAnyCall (node) {
        if (!node || typeof node !== 'object') return false;
        if (node.kind === BLOCKS.PROCEDURES.CALL) return true;
        if (node.kind === BLOCKS.ADDONS.CALL) return true;
        if (Array.isArray(node)) return node.some(n => this._containsAnyCall(n));
        for (const v of Object.values(node)) {
            if (v && typeof v === 'object' && this._containsAnyCall(v)) return true;
        }
        return false;
    }

    /**
     * Optimize an arithmetic node.
     * @param {node} node The arithmetic node to optimize.
     * @private
     * @returns {node} The optimized arithmetic node.
     */
    _optimizeArithmetic (node) {
        const left = this.optimizeInput(node.left);
        const right = this.optimizeInput(node.right);
        node.left = left;
        node.right = right;
        if (left && right && left.kind === BLOCKS.CONSTANT && right.kind === BLOCKS.CONSTANT) {
            const a = +left.value;
            const b = +right.value;
            if (Number.isFinite(a) && Number.isFinite(b)) {
                switch (node.kind) {
                case BLOCKS.OP.ADD:
                    return {kind: BLOCKS.CONSTANT, value: (a + b).toString()};
                case BLOCKS.OP.SUBTRACT:
                    return {kind: BLOCKS.CONSTANT, value: (a - b).toString()};
                case BLOCKS.OP.MULTIPLY:
                    return {kind: BLOCKS.CONSTANT, value: (a * b).toString()};
                case BLOCKS.OP.DIVIDE:
                    return {kind: BLOCKS.CONSTANT, value: (a / b).toString()};
                case BLOCKS.OP.MOD:
                    return {kind: BLOCKS.CONSTANT, value: (a % b).toString()};
                }
            }
        }
        return node;
    }

    /**
     * Optimize a join node.
     * @param {node} node The join node to optimize.
     * @private
     * @returns {node} The optimized join node.
     */
    _optimizeJoin (node) {
        const left = this.optimizeInput(node.left);
        const right = this.optimizeInput(node.right);
        node.left = left;
        node.right = right;
        if (left && right && left.kind === BLOCKS.CONSTANT && right.kind === BLOCKS.CONSTANT) {
            const a = left.value;
            const b = right.value;
            if (a && b) {
                return {kind: BLOCKS.CONSTANT, value: a + b};
            }
        }
        return node;
    }

    /**
     * Optimize a length node.
     * @param {node} node The length node to optimize.
     * @private
     * @returns {node} The optimized length node.
     */
    _optimizeLength (node) {
        const s = this.optimizeInput(node.string);
        node.string = s;
        if (s && s.kind === BLOCKS.CONSTANT) {
            return {kind: BLOCKS.CONSTANT, value: ((`${s.value}`).length).toString()};
        }
        return node;
    }

    /**
     * Optimize a not node.
     * @param {node} node The not node to optimize.
     * @private
     * @returns {node} The optimized not node.
     */
    _optimizeNot (node) {
        const input = this.optimizeInput(node.input);
        node.input = input;
        if (input && input.kind === BLOCKS.CONSTANT) {
            const v = !!input.value;
            return {kind: BLOCKS.CONSTANT, value: (!v).toString()};
        }
        return node;
    }

    /**
     * Try to convert an equals if chain into a switch.
     * @param {node[]} nodes The nodes to convert.
     * @param {number} startIndex The index to start converting from.
     * @private
     * @returns {object|null} The converted node, or null if the conversion failed.
     */
    _tryConvertEqualsIfChain (nodes, startIndex) {
        const first = nodes[startIndex];
        if (!first || first.kind !== BLOCKS.CONTROL.IF) return null;
        const cond = first.condition;
        if (!cond || cond.kind !== BLOCKS.OP.EQUALS) return null;
        if (first.whenFalse && first.whenFalse.length) return null;
        const leftKey = this._nodeKey(cond.left);
        const cases = [];
        let i = startIndex;
        while (i < nodes.length) {
            const n = nodes[i];
            if (!n || n.kind !== BLOCKS.CONTROL.IF) break;
            const c = n.condition;
            if (!c || c.kind !== BLOCKS.OP.EQUALS) break;
            if (this._nodeKey(c.left) !== leftKey) break;
            if (!c.right || c.right.kind !== BLOCKS.CONSTANT) break;
            if (n.whenFalse && n.whenFalse.length) break;
            cases.push({value: c.right, body: this._optimizeSubstack(n.whenTrue)});
            i += 1;
        }
        if (cases.length < 2) return null;
        const switchBody = [];
        let allNumbers = true;
        for (const cs of cases) {
            const cur = cs.value;
            if (cur.kind !== BLOCKS.CONSTANT) {
                return null;
            }
            const asNum = +cur.value;
            if (Number.isNaN(asNum)) {
                allNumbers = false;
            } else {
                cur.value = asNum;
            }
            switchBody.push({
                kind: BLOCKS.CONTROL.CASE,
                value: cur,
                do: cs.body,
                useNumbers: false
            });
            const last = cs.body[cs.body.length - 1];
            if (last && (last.kind !== BLOCKS.CONTROL.BREAK && last.kind !== BLOCKS.CONTROL.STOP_SCRIPT)) {
                // we cant turn this if chain into a switch case if the code doesnt handle fallthrough
                return null;
            }
        }

        for (const cs of switchBody) {
            cs.useNumbers = allNumbers;
        }

        const switchNode = {
            kind: BLOCKS.CONTROL.SWITCH,
            value: JSON.parse(leftKey),
            do: switchBody,
            useNumbers: allNumbers
        };
        return {
            converted: [switchNode],
            count: cases.length
        };
    }

}

module.exports = {
    IROptimizer
};
