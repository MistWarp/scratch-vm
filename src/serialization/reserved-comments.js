const FRACTCH_MAP_COMMENT_MAGIC = '_fractch_map_';
const RESERVED_COMMENT_MARKERS = Object.freeze({
    projectOptions: ' // _twconfig_',
    workspaceBookmarks: 'WORKSPACE_BOOKMARKS:',
    gamepad: ' // _gamepad_'
});

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

module.exports = {
    FRACTCH_MAP_COMMENT_MAGIC,
    RESERVED_COMMENT_MARKERS,
    isMapComment,
    isReservedComment,
    remapMapCommentText
};
