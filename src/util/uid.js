/**
 * @fileoverview UID generator, from Blockly.
 */

/**
 * Legal characters for the unique ID.
 * Should be all on a US keyboard.  No XML special characters or control codes.
 * Removed $ due to issue 251.
 * @private
 */
const soup_ = '!#%()*+,-./:;=?@[]^_`{|}~' +
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const soupLength_ = soup_.length;
const codes_ = [];
for (let i = 0; i < soupLength_; i++) codes_.push(soup_.charCodeAt(i));

const pick_ = () => codes_[(Math.random() * soupLength_) | 0];

/**
 * Generate a unique ID, from Blockly.  This should be globally unique.
 * 87 characters ^ 20 length > 128 bits (better than a UUID).
 * @return {string} A globally unique ID string.
 */
const uid = function () {
    return String.fromCharCode(
        pick_(), pick_(), pick_(), pick_(), pick_(),
        pick_(), pick_(), pick_(), pick_(), pick_(),
        pick_(), pick_(), pick_(), pick_(), pick_(),
        pick_(), pick_(), pick_(), pick_(), pick_()
    );
};

module.exports = uid;
