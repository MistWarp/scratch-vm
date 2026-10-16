const Variable = require('./variable');
const Comment = require('./comment');
const MonitorRecord = require('./monitor-record');
const {isReservedComment, isMapComment, collectSubtree} = require('../serialization/fractch-context');

const hasOwn = (object, key) => Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
const copy = value => JSON.parse(JSON.stringify(value));
const REFERENCE_FIELDS = {
    VARIABLE: Variable.SCALAR_TYPE,
    LIST: Variable.LIST_TYPE,
    BROADCAST_OPTION: Variable.BROADCAST_MESSAGE_TYPE
};
const VARIABLE_TYPES = Object.values(REFERENCE_FIELDS);

class CodeApplyError extends Error {
    constructor (message, details) {
        super(message);
        this.name = 'CodeApplyError';
        this.details = details || null;
    }
}

const blockReferences = block => {
    const refs = [];
    if (block.next) refs.push(block.next);
    for (const name in block.inputs) {
        const input = block.inputs[name];
        if (!input) continue;
        if (input.block) refs.push(input.block);
        if (input.shadow && input.shadow !== input.block) refs.push(input.shadow);
    }
    if (Array.isArray(block.obscuredHeadShadows)) {
        for (const id of block.obscuredHeadShadows) {
            if (id) refs.push(id);
        }
    }
    return refs;
};

const refersTo = (parent, childId) => {
    if (parent.next === childId) return true;
    for (const name in parent.inputs) {
        const input = parent.inputs[name];
        if (input && (input.block === childId || input.shadow === childId)) return true;
    }
    return Array.isArray(parent.obscuredHeadShadows) && parent.obscuredHeadShadows.includes(childId);
};

const validateBlockIntegrity = (blocks, checkIds, comments) => {
    const errors = [];
    const fail = (blockId, message) => errors.push({blockId, message});
    const ids = checkIds ? Array.from(checkIds) : Object.keys(blocks);
    const referenceCounts = new Map();
    for (const id of Object.keys(blocks)) {
        const block = blocks[id];
        if (!block || typeof block !== 'object') continue;
        for (const ref of blockReferences(block)) referenceCounts.set(ref, (referenceCounts.get(ref) || 0) + 1);
    }
    const limit = Object.keys(blocks).length + 1;
    for (const id of ids) {
        const block = blocks[id];
        if (!block || typeof block !== 'object') {
            fail(id, `Block ${id} is missing`);
            continue;
        }
        if (block.id !== id) fail(id, `Block ${id} is stored under the wrong id`);
        if (typeof block.opcode !== 'string' || !block.opcode) fail(id, `Block ${id} has no opcode`);
        if (!block.inputs || typeof block.inputs !== 'object') fail(id, `Block ${id} has no inputs object`);
        if (!block.fields || typeof block.fields !== 'object') fail(id, `Block ${id} has no fields object`);
        const parentId = typeof block.parent === 'undefined' ? null : block.parent;
        const references = referenceCounts.get(id) || 0;
        if (parentId === null) {
            if (!block.topLevel) fail(id, `Block ${id} has no parent but is not top level`);
            if (block.shadow) fail(id, `Shadow block ${id} is top level`);
            if (references) fail(id, `Top level block ${id} is referenced by another block`);
        } else {
            if (block.topLevel) fail(id, `Block ${id} has a parent but is marked top level`);
            if (!hasOwn(blocks, parentId)) {
                fail(id, `Block ${id} has missing parent ${parentId}`);
            } else if (!refersTo(blocks[parentId], id)) {
                fail(id, `Parent ${parentId} does not refer to block ${id}`);
            }
            if (references !== 1) fail(id, `Block ${id} is referenced ${references} times`);
        }
        if (block.next) {
            const next = blocks[block.next];
            if (next) {
                if (next.parent !== id) fail(id, `Next block ${block.next} does not have ${id} as its parent`);
                if (next.shadow) fail(id, `Next block ${block.next} is a shadow`);
            } else {
                fail(id, `Block ${id} has missing next block ${block.next}`);
            }
        }
        for (const name in block.inputs || {}) {
            const input = block.inputs[name];
            if (!input || typeof input !== 'object') {
                fail(id, `Input ${name} of block ${id} is invalid`);
                continue;
            }
            if (input.name !== name) fail(id, `Input ${name} of block ${id} has the name ${input.name}`);
            for (const kind of ['block', 'shadow']) {
                const childId = input[kind];
                if (childId === null || typeof childId === 'undefined') continue;
                const child = blocks[childId];
                if (!child) {
                    fail(id, `Input ${name} of block ${id} refers to missing ${kind} ${childId}`);
                    continue;
                }
                if (child.parent !== id) fail(id, `Input ${name} of block ${id} holds ${childId} with another parent`);
                if (kind === 'shadow' && !child.shadow && input.shadow !== input.block) {
                    fail(id, `Input ${name} of block ${id} has non-shadow ${childId} as its shadow`);
                }
                if (kind === 'block' && input.shadow && input.block !== input.shadow && child.shadow) {
                    fail(id, `Input ${name} of block ${id} covers a shadow with shadow ${childId}`);
                }
            }
        }
        if (typeof block.obscuredHeadShadows !== 'undefined') {
            if (Array.isArray(block.obscuredHeadShadows)) {
                for (const shadowId of block.obscuredHeadShadows) {
                    if (shadowId === null) continue;
                    const shadow = blocks[shadowId];
                    if (!shadow) {
                        fail(id, `Obscured shadow ${shadowId} of block ${id} is missing`);
                    } else if (!shadow.shadow || shadow.parent !== id) {
                        fail(id, `Obscured shadow ${shadowId} of block ${id} is not a shadow of it`);
                    }
                }
            } else {
                fail(id, `Block ${id} has invalid obscured shadows`);
            }
        }
        const seen = new Set();
        let cursor = id;
        let steps = 0;
        while (cursor !== null && typeof cursor !== 'undefined' && hasOwn(blocks, cursor)) {
            if (seen.has(cursor) || ++steps > limit) {
                fail(id, `Block ${id} is part of a cycle`);
                break;
            }
            seen.add(cursor);
            cursor = blocks[cursor].parent;
        }
        if (comments && block.comment) {
            const comment = comments[block.comment];
            if (!comment) {
                fail(id, `Block ${id} refers to missing comment ${block.comment}`);
            } else if (comment.blockId !== id) {
                fail(id, `Comment ${block.comment} of block ${id} is attached elsewhere`);
            }
        }
    }
    return errors;
};

const vmBlocksFromChange = change => {
    const sb3 = require('../serialization/sb3');
    const format = change.format || 'sb3';
    if (format !== 'sb3' && format !== 'vm') throw new CodeApplyError(`Unknown block format ${format}`);
    const blocks = copy(change.blocks || {});
    if (format === 'vm') return blocks;
    sb3.deserializeBlocks(blocks, change.primitiveIds || {});
    for (const operatorId of Object.keys(change.obscuredShadows || {})) {
        const entries = change.obscuredShadows[operatorId];
        const operator = blocks[operatorId];
        if (!operator || !Array.isArray(entries)) continue;
        operator.obscuredHeadShadows = entries.map(entry => (entry ? entry.id : null));
        for (const entry of entries) {
            if (!entry) continue;
            for (const id of Object.keys(entry.blocks || {})) {
                if (hasOwn(blocks, id)) throw new CodeApplyError(`Obscured shadow ${id} collides with another block`);
                blocks[id] = copy(entry.blocks[id]);
            }
        }
    }
    return blocks;
};

const procedureCode = (blocks, block) => {
    if (block.opcode === 'procedures_prototype' && block.mutation) return block.mutation.proccode;
    if (block.opcode === 'procedures_definition' && block.inputs.custom_block) {
        const prototype = blocks[block.inputs.custom_block.block];
        if (prototype && prototype.mutation) return prototype.mutation.proccode;
    }
    return null;
};

const ownedSubtree = (blocks, topId) => {
    const into = {};
    const pending = [topId];
    while (pending.length) {
        const id = pending.pop();
        if (hasOwn(into, id)) continue;
        const block = blocks[id];
        into[id] = block;
        for (const ref of blockReferences(block)) {
            if (!hasOwn(blocks, ref)) continue;
            const child = blocks[ref];
            if (child.parent === id || (!child.parent && !child.topLevel)) pending.push(ref);
        }
    }
    return into;
};

const scriptsOf = (blocks, topIds) => {
    const result = {};
    for (const topId of topIds) result[topId] = ownedSubtree(blocks, topId);
    return result;
};

const copyComment = comment => ({
    id: comment.id,
    blockId: comment.blockId || null,
    x: comment.x,
    y: comment.y,
    width: comment.width,
    height: comment.height,
    minimized: comment.minimized,
    text: comment.text
});

const makeComment = (id, desc) => {
    const text = `${desc.text || ''}${typeof desc.extraText === 'string' ? desc.extraText : ''}`;
    const comment = new Comment(id, text, desc.x, desc.y, desc.width, desc.height, desc.minimized);
    comment.blockId = desc.blockId || null;
    return comment;
};

const monitorSnapshot = (runtime, id) => {
    const record = runtime.getMonitorState().get(id);
    const block = runtime.monitorBlocks.getBlock(id);
    if (!record && !block) return null;
    return {
        record: record ? new MonitorRecord(record) : null,
        block: block ? copy(block) : null
    };
};

const restoreMonitor = (runtime, monitor) => {
    if (!monitor) return;
    if (monitor.block && !runtime.monitorBlocks.getBlock(monitor.block.id)) {
        runtime.monitorBlocks.createBlock(copy(monitor.block));
    }
    if (monitor.record) runtime.requestAddMonitor(new MonitorRecord(monitor.record));
};

const changeFromRestore = (target, restore) => {
    const replaced = new Set([...(restore.createdTopIds || []), ...Object.keys(restore.scripts || {})]);
    const keepScripts = target.blocks._scripts.filter(id => !replaced.has(id));
    const blocks = {};
    for (const script of Object.values(restore.scripts || {})) Object.assign(blocks, script);
    const createdComments = new Set(restore.createdCommentIds || []);
    const comments = {};
    for (const id of Object.keys(target.comments)) {
        const comment = target.comments[id];
        if (comment.blockId || createdComments.has(id) || isReservedComment(target, comment) ||
            isMapComment(comment)) {
            continue;
        }
        comments[id] = copyComment(comment);
    }
    for (const comment of Object.values(restore.comments || {})) comments[comment.id] = copy(comment);
    if (restore.mapComment) comments[restore.mapComment.id] = copy(restore.mapComment);
    const declarations = restore.declarations || [];
    return {
        format: 'vm',
        keepScripts,
        blocks,
        comments,
        frames: restore.frames || null,
        variables: {
            create: declarations.map(entry => ({
                id: entry.id,
                scope: entry.scope,
                variable: entry.variable,
                monitor: entry.monitor,
                ifMissing: true
            })),
            set: restore.values || {},
            delete: restore.createdLocalIds || [],
            restoring: true
        }
    };
};

const addReferences = (block, into, value) => {
    const fields = block && block.fields;
    if (!fields) return;
    for (const name in REFERENCE_FIELDS) {
        const field = fields[name];
        if (field && typeof field.id === 'string' && !into.has(field.id)) into.set(field.id, value);
    }
};

const planVariables = (runtime, target, spec, forEachFinalBlock) => {
    const stage = runtime.getTargetForStage();
    const isOwnedBy = (owner, id) => hasOwn(owner.variables, id);
    const owners = runtime.targets.filter(t => t.isOriginal);
    const deletes = [];
    const deleteIds = new Set();
    let users = null;
    const userOf = (id, owner) => {
        if (!users) {
            users = new Map();
            forEachFinalBlock(block => addReferences(block, users, target));
            for (const other of owners) {
                if (other === target) continue;
                for (const blockId in other.blocks._blocks) addReferences(other.blocks._blocks[blockId], users, other);
            }
        }
        const user = users.get(id) || null;
        return user === target || owner.isStage ? user : null;
    };
    const skippedDeletes = [];
    for (const id of spec.delete || []) {
        const owner = isOwnedBy(target, id) ? target : (stage && isOwnedBy(stage, id) ? stage : null);
        if (!owner || deleteIds.has(id)) continue;
        const variable = owner.variables[id];
        const user = userOf(id, owner);
        if (user) {
            if (spec.restoring) {
                skippedDeletes.push(id);
                continue;
            }
            throw new CodeApplyError(`${variable.name} is used by ${user.isStage ? 'the Stage' : user.getName()}`,
                {variableId: id});
        }
        deleteIds.add(id);
        deletes.push({owner, id, variable});
    }

    const creates = [];
    const pendingNames = [];
    for (const entry of spec.create || []) {
        const source = entry.variable || null;
        const id = source ? source.id : entry.id;
        const name = source ? source.name : entry.name;
        const type = source ? source.type : (entry.type || Variable.SCALAR_TYPE);
        if (typeof id !== 'string' || !id || typeof name !== 'string') {
            throw new CodeApplyError('A created variable needs an id and a name');
        }
        if (!VARIABLE_TYPES.includes(type)) throw new CodeApplyError(`Unknown variable type ${type}`);
        const toStage = target.isStage || type === Variable.BROADCAST_MESSAGE_TYPE || entry.scope === 'stage';
        const owner = toStage ? stage : target;
        const existing = owners.find(t => isOwnedBy(t, id) && !deleteIds.has(id));
        if (existing) {
            if (entry.ifMissing && existing === owner) continue;
            throw new CodeApplyError(`The variable id ${id} is already used in ${existing.getName()}`,
                {variableId: id});
        }
        if (creates.some(create => create.id === id)) {
            throw new CodeApplyError(`The variable id ${id} is created twice`);
        }
        if (!name.startsWith('!local_')) {
            const sameName = variable => !deleteIds.has(variable.id) && variable.type === type && (
                type === Variable.BROADCAST_MESSAGE_TYPE ?
                    variable.name.toLowerCase() === name.toLowerCase() :
                    variable.name === name
            );
            const scopes = toStage ? owners : [target, stage];
            for (const scope of scopes) {
                if (!scope) continue;
                if (Object.values(scope.variables).some(sameName) ||
                    pendingNames.some(pending => pending.owner === scope && sameName(pending))) {
                    throw new CodeApplyError(
                        `${name} now names a different variable in ${scope.isStage ? 'the Stage' : scope.getName()}`,
                        {variableId: id}
                    );
                }
            }
        }
        const variable = source || Variable.create(id, name, type, false);
        if (!source && hasOwn(entry, 'value')) {
            variable.value = Array.isArray(entry.value) ? entry.value.slice() : entry.value;
        }
        const wantsCloud = source ? Boolean(source.isCloud) : Boolean(entry.isCloud);
        creates.push({owner, id, name, type, variable, wantsCloud, monitor: entry.monitor || null});
        pendingNames.push({owner, id, name, type});
    }

    const findFuture = id => {
        const created = creates.find(create => create.id === id);
        if (created) return created.variable;
        if (deleteIds.has(id)) return null;
        return target.lookupVariableById(id) || null;
    };
    const sets = [];
    for (const id of Object.keys(spec.set || {})) {
        const variable = findFuture(id);
        if (!variable && spec.restoring) continue;
        if (!variable) throw new CodeApplyError(`Cannot set missing variable ${id}`, {variableId: id});
        if (variable.type === Variable.BROADCAST_MESSAGE_TYPE) continue;
        const value = spec.set[id];
        if (variable.type === Variable.LIST_TYPE && !Array.isArray(value)) {
            throw new CodeApplyError(`${variable.name} needs a list value`, {variableId: id});
        }
        const created = creates.some(create => create.variable === variable);
        sets.push({variable, created, value: Array.isArray(value) ? value.slice() : value});
    }
    return {deletes, creates, sets, findFuture, skippedDeletes};
};

const threadsToStop = (runtime, target, liveBlocks, removedIds, changedProcedures) => {
    const container = target.blocks;
    const callMemo = new Map();
    const callsChanged = (topId, visiting = new Set()) => {
        if (callMemo.has(topId)) return callMemo.get(topId);
        if (visiting.has(topId)) return false;
        visiting.add(topId);
        let result = false;
        const pending = [topId];
        const seen = new Set();
        while (pending.length && !result) {
            const id = pending.pop();
            if (!id || seen.has(id) || !hasOwn(liveBlocks, id)) continue;
            seen.add(id);
            const block = liveBlocks[id];
            if (block.opcode === 'procedures_call' && block.mutation) {
                const code = block.mutation.proccode;
                if (changedProcedures.has(code)) {
                    result = true;
                    break;
                }
                const definition = container.getProcedureDefinition(code);
                if (definition && callsChanged(definition, visiting)) {
                    result = true;
                    break;
                }
            }
            pending.push(...blockReferences(block));
        }
        callMemo.set(topId, result);
        return result;
    };
    return runtime.threads.filter(thread => {
        if (thread.isKilled || thread.blockContainer !== container) return false;
        if (!thread.target || (thread.target !== target && thread.target.sprite !== target.sprite)) return false;
        if (removedIds.has(thread.topBlock)) return true;
        if (thread.stack.some(id => removedIds.has(id))) return true;
        return callsChanged(thread.topBlock);
    });
};

const renameFieldsToLive = (blocks, findFuture) => {
    for (const id of Object.keys(blocks)) {
        const fields = blocks[id].fields || {};
        for (const name in REFERENCE_FIELDS) {
            const field = fields[name];
            if (!field || typeof field.id !== 'string') continue;
            const variable = findFuture(field.id);
            if (variable && variable.type === REFERENCE_FIELDS[name]) field.value = variable.name;
        }
    }
};

const replaceTargetScripts = (vm, targetId, inputChange) => {
    const runtime = vm.runtime;
    if (vm.editingCommands && vm.editingCommands.handler) {
        throw new CodeApplyError('Editing code is unavailable during collaboration');
    }
    const target = runtime.getTargetById(targetId);
    if (!target || !target.isOriginal) throw new CodeApplyError(`No target with id ${targetId}`);
    const stage = runtime.getTargetForStage();
    const change = inputChange && inputChange.restore ?
        changeFromRestore(target, inputChange.restore) :
        (inputChange || {});
    const container = target.blocks;
    const live = container._blocks;

    const liveTops = container._scripts.slice();
    const keepTops = new Set(change.keepScripts || []);
    for (const topId of keepTops) {
        if (!hasOwn(live, topId) || (live[topId].parent && !liveTops.includes(topId))) {
            throw new CodeApplyError(`The kept script ${topId} no longer exists`, {blockId: topId});
        }
    }
    const rootOf = id => {
        const seen = new Set();
        let cursor = id;
        while (hasOwn(live, cursor) && live[cursor].parent && !seen.has(cursor)) {
            seen.add(cursor);
            cursor = live[cursor].parent;
        }
        return cursor;
    };
    for (const id of liveTops) {
        if (hasOwn(live, id) && live[id].parent && keepTops.has(rootOf(id))) keepTops.add(id);
    }
    const removedTopIds = liveTops.filter(id => !keepTops.has(id));
    const removedScripts = scriptsOf(live, removedTopIds);
    const removedIds = new Set();
    for (const topId of removedTopIds) {
        for (const id of Object.keys(removedScripts[topId])) removedIds.add(id);
    }
    const isKept = id => hasOwn(live, id) && !removedIds.has(id);

    const built = vmBlocksFromChange(change);
    for (const id of Object.keys(built)) {
        const block = built[id];
        if (block && !block.parent && keepTops.has(id)) {
            for (const subId of Object.keys(collectSubtree(built, id, {}))) delete built[subId];
        }
    }
    const attachedToScript = {};
    for (const id of Object.keys(built)) {
        if (built[id] && !built[id].parent && built[id].topLevel) collectSubtree(built, id, attachedToScript);
    }
    for (const id of Object.keys(built)) {
        if (!hasOwn(attachedToScript, id) && isKept(id)) delete built[id];
    }
    const builtIds = Object.keys(built);
    for (const id of builtIds) {
        if (isKept(id)) throw new CodeApplyError(`Block id ${id} is used twice`, {blockId: id});
        const block = built[id];
        if (!block || typeof block !== 'object' || Array.isArray(block)) {
            throw new CodeApplyError(`Block ${id} is invalid`, {blockId: id});
        }
        if (typeof block.id === 'undefined') block.id = id;
        if (!block.inputs) block.inputs = {};
        if (!block.fields) block.fields = {};
        if (typeof block.next === 'undefined') block.next = null;
        if (typeof block.parent === 'undefined') block.parent = null;
        if (typeof block.shadow === 'undefined') block.shadow = false;
        if (typeof block.topLevel === 'undefined') block.topLevel = block.parent === null;
        delete block.comment;
    }
    for (const id of builtIds) {
        if (hasOwn(live, id)) continue;
        const owner = runtime.targets.find(other => other.isOriginal && other !== target &&
            hasOwn(other.blocks._blocks, id));
        if (owner) throw new CodeApplyError(`Block id ${id} is already used in ${owner.getName()}`, {blockId: id});
    }

    const forEachFinalBlock = callback => {
        for (const id in live) {
            if (!removedIds.has(id)) callback(live[id]);
        }
        for (const id of builtIds) callback(built[id]);
    };
    const variablePlan = planVariables(runtime, target, change.variables || {}, forEachFinalBlock);
    renameFieldsToLive(built, variablePlan.findFuture);

    const newComments = {};
    const attached = new Map();
    for (const id of Object.keys(target.comments)) {
        const comment = target.comments[id];
        if (isReservedComment(target, comment)) {
            newComments[id] = comment;
        } else if (comment.blockId && isKept(comment.blockId)) {
            newComments[id] = comment;
            attached.set(comment.blockId, id);
        } else if (comment.blockId && !hasOwn(live, comment.blockId)) {
            newComments[id] = comment;
        } else if (!comment.blockId && typeof change.comments === 'undefined') {
            newComments[id] = comment;
        }
    }
    for (const id of Object.keys(change.comments || {})) {
        const desc = change.comments[id];
        if (!desc || typeof desc !== 'object') throw new CodeApplyError(`Comment ${id} is invalid`);
        if (isReservedComment(target, desc)) continue;
        const blockId = desc.blockId || null;
        if (blockId && isKept(blockId)) {
            if (attached.get(blockId) === id) continue;
            throw new CodeApplyError(`Comment ${id} would give block ${blockId} a second comment`, {blockId});
        }
        if (blockId && !hasOwn(live, blockId) && !hasOwn(built, blockId) && hasOwn(newComments, id) &&
            newComments[id].blockId === blockId) {
            continue;
        }
        if (blockId && !hasOwn(built, blockId)) {
            throw new CodeApplyError(`Comment ${id} is attached to missing block ${blockId}`, {blockId});
        }
        if (blockId && attached.has(blockId)) {
            throw new CodeApplyError(`Block ${blockId} would get two comments`, {blockId});
        }
        if (hasOwn(newComments, id)) throw new CodeApplyError(`Comment id ${id} is used twice`);
        newComments[id] = makeComment(id, desc);
        if (blockId) {
            attached.set(blockId, id);
            built[blockId].comment = id;
        }
    }

    const view = Object.assign({}, built);
    for (const id of builtIds) {
        const block = built[id];
        for (const ref of [block.parent, ...blockReferences(block)]) {
            if (typeof ref === 'string' && !hasOwn(view, ref) && isKept(ref)) view[ref] = live[ref];
        }
    }
    const errors = validateBlockIntegrity(view, builtIds, newComments);
    if (errors.length) throw new CodeApplyError(errors[0].message, {errors});

    const builtTops = builtIds.filter(id => built[id].parent === null);
    const newScripts = [];
    const placed = new Set();
    for (const id of liveTops) {
        if ((keepTops.has(id) || (hasOwn(built, id) && built[id].parent === null)) && !placed.has(id)) {
            newScripts.push(id);
            placed.add(id);
        }
    }
    for (const id of builtTops) {
        if (!placed.has(id)) {
            newScripts.push(id);
            placed.add(id);
        }
    }

    const changedProcedures = new Set();
    for (const id of removedIds) {
        const code = procedureCode(live, live[id]);
        if (code) changedProcedures.add(code);
    }
    for (const id of builtIds) {
        const code = procedureCode(built, built[id]);
        if (code) changedProcedures.add(code);
    }
    const stopping = threadsToStop(runtime, target, live, removedIds, changedProcedures);

    const idMap = change.idMap || {};
    const frameUpdates = [];
    for (const frameId of Object.keys(target.frames || {})) {
        const frame = target.frames[frameId];
        if (!Array.isArray(frame.blocks)) continue;
        const source = change.frames && Array.isArray(change.frames[frameId]) ? change.frames[frameId] : frame.blocks;
        const next = source.map(id => (hasOwn(idMap, id) ? idMap[id] : id))
            .filter((id, index, list) => (hasOwn(built, id) || isKept(id)) && list.indexOf(id) === index);
        frameUpdates.push({frame, before: frame.blocks.slice(), next});
    }

    const previous = {
        targetId,
        scripts: removedScripts,
        createdTopIds: builtTops.filter(id => !liveTops.includes(id)),
        comments: {},
        createdCommentIds: [],
        mapComment: null,
        frames: {},
        values: {},
        declarations: [],
        createdLocalIds: [],
        createdStageIds: []
    };
    const removedCopies = {};
    for (const topId of Object.keys(removedScripts)) {
        removedCopies[topId] = {};
        for (const id of Object.keys(removedScripts[topId])) removedCopies[topId][id] = copy(removedScripts[topId][id]);
    }
    previous.scripts = removedCopies;
    for (const id of Object.keys(target.comments)) {
        const comment = target.comments[id];
        if (isReservedComment(target, comment)) continue;
        if (isMapComment(comment)) {
            previous.mapComment = copyComment(comment);
            continue;
        }
        if (newComments[id] === comment) continue;
        previous.comments[id] = copyComment(comment);
    }
    for (const id of Object.keys(newComments)) {
        if (!hasOwn(target.comments, id) && !isMapComment(newComments[id])) previous.createdCommentIds.push(id);
    }
    for (const update of frameUpdates) previous.frames[update.frame.id] = update.before;
    for (const {variable, created} of variablePlan.sets) {
        if (variable.isCloud || created) continue;
        previous.values[variable.id] = Array.isArray(variable.value) ? variable.value.slice() : variable.value;
    }
    const referenced = new Set();
    for (const topId of Object.keys(previous.scripts)) {
        const script = previous.scripts[topId];
        for (const id of Object.keys(script)) {
            const fields = script[id].fields || {};
            for (const name in REFERENCE_FIELDS) {
                if (fields[name] && typeof fields[name].id === 'string') referenced.add(fields[name].id);
            }
        }
    }
    for (const {owner, id, variable} of variablePlan.deletes) {
        previous.declarations.push({
            id,
            scope: owner.isStage ? 'stage' : 'target',
            variable,
            monitor: monitorSnapshot(runtime, id),
            deleted: true
        });
        referenced.delete(id);
    }
    for (const id of referenced) {
        const variable = target.lookupVariableById(id);
        if (!variable) continue;
        const owner = hasOwn(target.variables, id) ? target : stage;
        previous.declarations.push({
            id,
            scope: owner.isStage ? 'stage' : 'target',
            variable,
            monitor: monitorSnapshot(runtime, id),
            deleted: false
        });
    }
    for (const {owner, id} of variablePlan.creates) {
        if (owner === target && !target.isStage) previous.createdLocalIds.push(id);
        else previous.createdStageIds.push(id);
    }

    for (const thread of stopping) runtime._stopThread(thread);
    for (const topId of removedTopIds) {
        if (!hasOwn(built, topId)) runtime.quietGlow(topId);
    }

    let stageChanged = false;
    const clones = target.sprite ? target.sprite.clones.filter(clone => clone !== target) : [];
    for (const {owner, id} of variablePlan.deletes) {
        owner.deleteVariable(id);
        if (owner === target) {
            for (const clone of clones) clone.deleteVariable(id);
        } else {
            stageChanged = true;
        }
    }
    for (const create of variablePlan.creates) {
        const {owner, id, variable, wantsCloud, monitor} = create;
        if (wantsCloud && owner.isStage && variable.type === Variable.SCALAR_TYPE && runtime.canAddCloudVariable()) {
            variable.isCloud = true;
            runtime.addCloudVariable();
            runtime.ioDevices.cloud.requestCreateVariable(variable);
        } else if (variable.isCloud && !(owner.isStage && variable.type === Variable.SCALAR_TYPE)) {
            variable.isCloud = false;
        }
        owner.installVariable(variable, id);
        if (owner === target) {
            for (const clone of clones) {
                const sibling = Variable.createSibling(variable, id, variable.name, variable.type, false);
                sibling.value = Array.isArray(variable.value) ? variable.value.slice() : variable.value;
                clone.installVariable(sibling, id);
            }
        } else {
            stageChanged = true;
        }
        restoreMonitor(runtime, monitor);
    }
    for (const {variable, value} of variablePlan.sets) {
        variable.value = value;
        if (variable.isCloud) runtime.ioDevices.cloud.requestUpdateVariable(variable.name, value);
    }

    for (const id of removedIds) delete live[id];
    Object.assign(live, built);
    container._scripts = newScripts;
    target.comments = newComments;
    for (const {frame, next} of frameUpdates) frame.blocks = next;
    container.resetCache();
    container.revision++;
    target.bumpDeclRevision();
    if (stageChanged) runtime.resetAllCaches();
    vm._broadcastCleanupNeeded = true;
    runtime.emitProjectChanged();

    return {
        createdTopIds: previous.createdTopIds,
        removedTopIds: removedTopIds.filter(id => !hasOwn(built, id)),
        rebuiltTopIds: removedTopIds.filter(id => hasOwn(built, id)),
        stoppedThreads: stopping.length,
        createdVariableIds: variablePlan.creates.map(create => create.id),
        deletedVariableIds: variablePlan.deletes.map(entry => entry.id),
        leftInPlaceVariableIds: variablePlan.skippedDeletes.concat(
            inputChange && inputChange.restore ? inputChange.restore.createdStageIds || [] : []
        ),
        previous
    };
};

module.exports = {
    CodeApplyError,
    validateBlockIntegrity,
    replaceTargetScripts
};
