const Variable = require('../engine/variable');

const FRACTCH_MAP_COMMENT_MAGIC = '_fractch_map_';
const RESERVED_COMMENT_MARKERS = Object.freeze({
    projectOptions: ' // _twconfig_',
    workspaceBookmarks: 'WORKSPACE_BOOKMARKS:',
    gamepad: ' // _gamepad_'
});
const KEEP_LIST_MAX_ITEMS = 100;
const KEEP_LIST_MAX_TEXT = 4096;

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const isMapComment = comment => Boolean(comment) && !comment.blockId &&
    typeof comment.text === 'string' && comment.text.startsWith(FRACTCH_MAP_COMMENT_MAGIC);

const isReservedComment = (target, comment) => {
    if (!target || !target.isStage || !comment || comment.blockId || typeof comment.text !== 'string') return false;
    const text = comment.text;
    return text.includes(RESERVED_COMMENT_MARKERS.projectOptions) ||
        text.startsWith(RESERVED_COMMENT_MARKERS.workspaceBookmarks) ||
        text.includes(RESERVED_COMMENT_MARKERS.gamepad);
};

const remapMapCommentText = (text, blockIds, commentIds = {}) => {
    let data;
    try {
        data = JSON.parse(text.slice(FRACTCH_MAP_COMMENT_MAGIC.length));
    } catch (e) {
        return text;
    }
    if (!data || typeof data !== 'object') return text;
    for (const key of ['scripts', 'modules']) {
        const entries = data[key];
        if (!entries || typeof entries !== 'object') continue;
        const remapped = {};
        for (const id of Object.keys(entries)) remapped[hasOwn(blockIds, id) ? blockIds[id] : id] = entries[id];
        data[key] = remapped;
    }
    const comments = data.comments;
    if (comments && typeof comments === 'object' && !Array.isArray(comments)) {
        const remapped = {};
        for (const id of Object.keys(comments)) {
            let entry = comments[id];
            if (entry && typeof entry === 'object' && typeof entry.before === 'string' &&
                hasOwn(blockIds, entry.before)) {
                entry = {...entry, before: blockIds[entry.before]};
            }
            remapped[hasOwn(commentIds, id) ? commentIds[id] : id] = entry;
        }
        data.comments = remapped;
    }
    return FRACTCH_MAP_COMMENT_MAGIC + JSON.stringify(data);
};

const hashStrings = strings => {
    let a = 0x811c9dc5;
    let b = 0x9747b28c;
    for (const string of strings) {
        for (let i = 0; i < string.length; i++) {
            const code = string.charCodeAt(i);
            a = Math.imul(a ^ code, 0x01000193);
            b = Math.imul(b ^ code, 0x5bd1e995);
            b ^= b >>> 13;
        }
        a = Math.imul(a ^ 0xff, 0x01000193);
    }
    return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
};

const hashString = string => hashStrings([string]);

const stableStringify = value => {
    if (value === null || typeof value !== 'object') {
        const json = JSON.stringify(value);
        return typeof json === 'undefined' ? 'null' : json;
    }
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const keys = Object.keys(value).filter(key => typeof value[key] !== 'undefined' &&
        typeof value[key] !== 'function')
        .sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
};

const argumentOrder = (text, args) => {
    const order = [];
    text.replace(/\[([^\]]+)\]/g, (match, name) => {
        if (hasOwn(args, name) && !order.includes(name)) order.push(name);
        return match;
    });
    for (const name of Object.keys(args)) {
        if (!order.includes(name)) order.push(name);
    }
    return order;
};

const getExtensionSignatures = runtime => {
    const signatures = {};
    for (const category of runtime._blockInfo || []) {
        const blocks = [];
        for (const block of category.blocks || []) {
            const info = block && block.info;
            if (!info || !info.opcode || !block.json) continue;
            const text = Array.isArray(info.text) ? info.text.join('\n') : String(info.text || '');
            const args = info.arguments || {};
            blocks.push({
                opcode: info.opcode,
                blockType: info.blockType,
                text,
                branchCount: info.branchCount || 0,
                isTerminal: Boolean(info.isTerminal),
                arguments: argumentOrder(text, args).map(name => ({
                    name,
                    type: args[name] && args[name].type,
                    menu: (args[name] && args[name].menu) || null
                }))
            });
        }
        const menus = {};
        for (const name of Object.keys(category.menuInfo || {})) {
            const menu = category.menuInfo[name];
            const items = menu && typeof menu === 'object' && !Array.isArray(menu) ? menu.items : menu;
            menus[name] = {
                acceptReporters: Boolean(menu && menu.acceptReporters),
                items: Array.isArray(items) ?
                    items.map(item => String(item && typeof item === 'object' ? item.value : item)) :
                    null
            };
        }
        signatures[category.id] = {blocks, menus};
    }
    return signatures;
};

const getExtensionSignatureHash = runtime => hashString(stableStringify(getExtensionSignatures(runtime)));

const getChangeKey = (runtime, target, signatureHash = getExtensionSignatureHash(runtime)) => {
    const stage = runtime.getTargetForStage();
    const parts = [target.blocks.revision, target.declRevision];
    if (!target.isStage && stage) parts.push(stage.declRevision);
    parts.push(signatureHash);
    return parts.join(':');
};

const collectSubtree = (blocks, rootId, into) => {
    const pending = [rootId];
    while (pending.length) {
        const id = pending.pop();
        if (!id || hasOwn(into, id) || !hasOwn(blocks, id)) continue;
        const block = blocks[id];
        into[id] = block;
        if (block.next) pending.push(block.next);
        for (const name in block.inputs) {
            pending.push(block.inputs[name].block, block.inputs[name].shadow);
        }
        if (Array.isArray(block.obscuredHeadShadows)) pending.push(...block.obscuredHeadShadows);
    }
    return into;
};

const copyBlock = block => JSON.parse(JSON.stringify(block));

const serializeComment = comment => ({
    blockId: comment.blockId || null,
    x: comment.x,
    y: comment.y,
    width: comment.width,
    height: comment.height,
    minimized: comment.minimized,
    text: comment.text
});

const listText = items => {
    let size = 0;
    for (const item of items) {
        size += String(item).length + 1;
        if (size > KEEP_LIST_MAX_TEXT) return false;
    }
    return true;
};

const serializeDeclarations = (sb3, target) => {
    const declarations = sb3.serializeVariables(target.variables);
    const keptLists = {};
    for (const id of Object.keys(declarations.lists)) {
        const items = declarations.lists[id][1];
        if (!Array.isArray(items) || items.length > KEEP_LIST_MAX_ITEMS || !listText(items)) {
            keptLists[id] = {length: Array.isArray(items) ? items.length : 0};
            declarations.lists[id] = [declarations.lists[id][0], null];
        } else {
            declarations.lists[id] = [declarations.lists[id][0], items.slice()];
        }
    }
    return {declarations, keptLists};
};

const serializeTargetForFractch = (runtime, target, signatureHash) => {
    const sb3 = require('./sb3');
    const live = target.blocks._blocks;
    const obscuredShadows = {};
    const obscuredIds = new Set();
    for (const id in live) {
        const heads = live[id].obscuredHeadShadows;
        if (!heads || heads.length === 0) continue;
        obscuredShadows[id] = heads.map(shadowId => {
            if (!shadowId || !hasOwn(live, shadowId)) return null;
            const subtree = collectSubtree(live, shadowId, {});
            const blocks = {};
            for (const subId of Object.keys(subtree)) {
                obscuredIds.add(subId);
                blocks[subId] = copyBlock(subtree[subId]);
            }
            return {id: shadowId, blocks};
        });
    }
    let visible = live;
    if (obscuredIds.size) {
        visible = {};
        for (const id in live) {
            if (!obscuredIds.has(id)) visible[id] = live[id];
        }
    }
    const [blocks] = sb3.serializeBlocks(visible);
    const primitiveIds = {};
    for (const id in visible) {
        const inputs = visible[id].inputs;
        for (const name in inputs) {
            const input = inputs[name];
            const compressed = (input.block && !hasOwn(blocks, input.block)) ||
                (input.shadow && !hasOwn(blocks, input.shadow));
            if (!compressed) continue;
            if (!hasOwn(primitiveIds, id)) primitiveIds[id] = {};
            primitiveIds[id][name] = {block: input.block, shadow: input.shadow};
        }
    }
    const comments = {};
    for (const id of Object.keys(target.comments)) comments[id] = serializeComment(target.comments[id]);
    const {declarations, keptLists} = serializeDeclarations(sb3, target);
    const ownMonitors = runtime.getMonitorState().values()
        .filter(monitor => (target.isStage ? !monitor.targetId : monitor.targetId === target.id));
    const monitors = sb3.serializeMonitors({valueSeq: () => ownMonitors}, runtime, new Set());
    return {
        id: target.id,
        name: target.isStage ? 'Stage' : target.getName(),
        isStage: target.isStage,
        changeKey: getChangeKey(runtime, target, signatureHash),
        blocksRevision: target.blocks.revision,
        declRevision: target.declRevision,
        variables: declarations.variables,
        lists: declarations.lists,
        broadcasts: declarations.broadcasts,
        keptLists,
        blocks,
        comments,
        primitiveIds,
        obscuredShadows,
        monitors,
        costumes: target.getCostumes().map(costume => ({name: costume.name})),
        sounds: target.getSounds().map(sound => ({name: sound.name}))
    };
};

const getFractchContext = (vm, targetId) => {
    const runtime = vm.runtime;
    const extensionSignatures = getExtensionSignatures(runtime);
    const extensionSignatureHash = hashString(stableStringify(extensionSignatures));
    let targets;
    if (typeof targetId === 'string') {
        const target = runtime.getTargetById(targetId);
        if (!target || !target.isOriginal) throw new Error(`No target with id ${targetId}`);
        targets = [target];
    } else {
        targets = runtime.targets.filter(target => target.isOriginal);
    }
    return {
        generation: vm._projectLoadGeneration || 0,
        extensionSignatureHash,
        extensionSignatures,
        targets: targets.map(target => serializeTargetForFractch(runtime, target, extensionSignatureHash))
    };
};

const referencedDeclarationIds = blocks => {
    const ids = new Set();
    for (const id in blocks) {
        const fields = blocks[id].fields;
        for (const name of ['VARIABLE', 'LIST', 'BROADCAST_OPTION']) {
            if (fields && fields[name] && typeof fields[name].id === 'string') ids.add(fields[name].id);
        }
    }
    return ids;
};

const declarationSummary = variable => ({
    id: variable.id,
    name: variable.name,
    type: variable.type,
    isCloud: Boolean(variable.isCloud)
});

const getCodeStateHash = (runtime, target) => {
    const live = target.blocks._blocks;
    const blocks = Object.keys(live).sort()
        .map(id => JSON.stringify(live[id]));
    const comments = Object.keys(target.comments).sort()
        .filter(id => !isReservedComment(target, target.comments[id]) && !isMapComment(target.comments[id]))
        .map(id => [id, serializeComment(target.comments[id])]);
    const variables = Object.keys(target.variables).sort()
        .map(id => declarationSummary(target.variables[id]));
    const stageReferences = [];
    const stage = runtime.getTargetForStage();
    if (!target.isStage && stage) {
        for (const id of Array.from(referencedDeclarationIds(live)).sort()) {
            const variable = stage.variables[id];
            if (variable && variable.type !== Variable.BROADCAST_MESSAGE_TYPE) {
                stageReferences.push(declarationSummary(variable));
            }
        }
    }
    blocks.push(stableStringify({comments, variables, stageReferences}));
    return hashStrings(blocks);
};

module.exports = {
    FRACTCH_MAP_COMMENT_MAGIC,
    RESERVED_COMMENT_MARKERS,
    isMapComment,
    isReservedComment,
    remapMapCommentText,
    hashString,
    stableStringify,
    collectSubtree,
    getExtensionSignatures,
    getExtensionSignatureHash,
    getChangeKey,
    getFractchContext,
    getCodeStateHash,
    referencedDeclarationIds
};
