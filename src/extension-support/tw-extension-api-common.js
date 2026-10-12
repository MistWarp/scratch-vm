const ArgumentType = require('./argument-type');
const BlockType = require('./block-type');
const BlockShape = require('./tw-block-shape');
const TargetType = require('./target-type');
const {ReturnType} = require('../compiler/enums.js');
const Cast = require('../util/cast');
const external = require('./tw-external');

const Scratch = {
    ArgumentType,
    BlockType,
    BlockShape,
    TargetType,
    // The type a compiled block reports, declared with `returnType`.
    ReturnType,
    Cast,
    external
};

module.exports = Scratch;
