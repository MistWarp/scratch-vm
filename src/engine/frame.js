/**
 * @fileoverview
 * Object representing a Frame: a labelled box that visually groups scripts
 * in the block workspace.
 */

const uid = require('../util/uid');
const xmlEscape = require('../util/xml-escape');

class Frame {
    /**
     * @param {string} id Id of the frame.
     * @param {string} title Text shown in the frame's title bar.
     * @param {number} x X position of the frame on the workspace.
     * @param {number} y Y position of the frame on the workspace.
     * @param {number} width The width of the frame when it is expanded.
     * @param {number} height The height of the frame when it is expanded.
     * @param {boolean} collapsed Whether the frame is collapsed.
     * @param {Array.<string>} blocks Ids of the blocks the frame swallowed when it was
     *     collapsed. Collapsing pulls the scripts below the frame up into the space it
     *     was taking, so a collapsed frame can no longer tell which blocks are its own
     *     from their positions and has to remember them. Empty unless collapsed.
     * @constructor
     */
    constructor (id, title, x, y, width, height, collapsed, blocks) {
        this.id = id || uid();
        this.title = typeof title === 'string' ? title : '';
        this.x = x;
        this.y = y;
        this.width = Math.max(Number(width), Frame.MIN_WIDTH);
        this.height = Math.max(Number(height), Frame.MIN_HEIGHT);
        this.collapsed = collapsed || false;
        this.blocks = Array.isArray(blocks) ? blocks : [];
    }

    toXML () {
        const blocks = this.collapsed && this.blocks.length ?
            ` blocks="${xmlEscape(this.blocks.join(','))}"` : '';
        return `<frame id="${this.id}" x="${this.x}" y="${this.y}" w="${
            this.width}" h="${this.height}" collapsed="${
            this.collapsed}"${blocks}>${xmlEscape(this.title)}</frame>`;
    }

    static get MIN_WIDTH () {
        return 100;
    }

    static get MIN_HEIGHT () {
        return 54;
    }

    static get DEFAULT_WIDTH () {
        return 320;
    }

    static get DEFAULT_HEIGHT () {
        return 200;
    }
}

module.exports = Frame;
