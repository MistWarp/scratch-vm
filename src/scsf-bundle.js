var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/@flufi/scsf/main.js
var main_exports = {};
__export(main_exports, {
  Block: () => Block,
  BlockFlags: () => BlockFlags,
  BooleanElement: () => BooleanElement,
  Comment: () => Comment,
  CommentFlags: () => CommentFlags,
  Costume: () => Costume,
  CostumeFlags: () => CostumeFlags,
  Element: () => Element,
  Extension: () => Extension,
  Field: () => Field,
  Flags: () => Flags,
  FlagsElement: () => FlagsElement,
  Input: () => Input,
  InputFlags: () => InputFlags,
  LabelElement: () => LabelElement,
  List: () => List,
  Monitor: () => Monitor,
  MonitorFlags: () => MonitorFlags,
  NonStageTargetFlags: () => NonStageTargetFlags,
  NumberElement: () => NumberElement,
  Project: () => Project,
  ProjectMeta: () => ProjectMeta,
  Reader: () => Reader,
  Sound: () => Sound,
  SoundFlags: () => SoundFlags,
  StageTargetFlags: () => StageTargetFlags,
  StringElement: () => StringElement,
  Target: () => Target,
  Variable: () => Variable,
  Writer: () => Writer,
  bool: () => bool,
  convert_json_type_to_num: () => convert_json_type_to_num,
  convert_literal_type_to_num: () => convert_literal_type_to_num,
  convert_num_to_json_type: () => convert_num_to_json_type,
  convert_num_to_literal_type: () => convert_num_to_literal_type,
  convert_num_to_rot_style: () => convert_num_to_rot_style,
  convert_num_to_video_state: () => convert_num_to_video_state,
  convert_rot_style_to_num: () => convert_rot_style_to_num,
  convert_video_state_to_num: () => convert_video_state_to_num,
  expectJsonType: () => expectJsonType,
  flags: () => flags,
  format: () => format,
  formatElement: () => formatElement,
  formatElements: () => formatElements,
  jsonTypeof: () => jsonTypeof,
  num: () => num,
  str: () => str
});
module.exports = __toCommonJS(main_exports);

// node_modules/@flufi/scsf/src/utils.js
var jsonTypeof = (val) => val == null ? "null" : typeof val == "boolean" ? "boolean" : typeof val == "number" ? "number" : typeof val == "string" ? "string" : Array.isArray(val) ? "array" : "object";
var expectJsonType = (prop, val, ...types) => {
  if (!types.includes(jsonTypeof(val))) throw `'${prop}' is not ${types.join("or")}`;
};
var convert_video_state_to_num = (state) => state == "on" ? 1 : state == "on-flipped" ? 2 : 0;
var convert_num_to_video_state = (state) => state == 1 ? "on" : state == 2 ? "on-flipped" : "off";
var convert_rot_style_to_num = (state) => state == "all around" ? 1 : state == "left-right" ? 2 : 0;
var convert_num_to_rot_style = (state) => state == 1 ? "all around" : state == 2 ? "left-right" : "don't rotate";
var convert_literal_type_to_num = (type) => type == "number" ? 0 : type == "positive-number" ? 1 : type == "positive-integer" ? 2 : type == "integer" ? 3 : type == "angle" ? 4 : type == "color" ? 5 : 6;
var convert_num_to_literal_type = (type) => type == 0 ? "number" : type == 1 ? "positive-number" : type == 2 ? "positive-integer" : type == 3 ? "integer" : type == 4 ? "angle" : type == 5 ? "color" : "string";
var convert_json_type_to_num = (type) => type == "null" ? 0 : type == "boolean" ? 1 : type == "number" ? 2 : type == "string" ? 3 : type == "array" ? 4 : 5;
var convert_num_to_json_type = (type) => type == 0 ? "null" : type == 1 ? "boolean" : type == 2 ? "number" : type == 3 ? "string" : type == 4 ? "array" : "object";

// node_modules/@flufi/scsf/src/extension.js
var Extension = class _Extension {
  name;
  url;
  constructor(name, url) {
    this.name = name;
    this.url = url;
  }
  static parseExtensions(data) {
    if (jsonTypeof(data) != "object") throw `project is not an object`;
    const extensions = [];
    const sb3_extensions = data.extensions;
    const sb3_extensionUrls = data.extensionURLs;
    expectJsonType("extensions", sb3_extensions, "array");
    if (sb3_extensionUrls != null) expectJsonType("extensionsURLs", sb3_extensionUrls, "object");
    const names = sb3_extensions.map((e) => {
      if (jsonTypeof(e) != "string") throw `extension in extensions array is not a string`;
      return e;
    });
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const url = sb3_extensionUrls?.[name];
      if (url != null) {
        if (jsonTypeof(url) != "string") throw `extension url is not a string`;
      }
      extensions.push(new _Extension(name, url));
    }
    return extensions;
  }
};

// node_modules/@flufi/scsf/src/flags.js
var Flags = class {
  flags;
  constructor(flags2) {
    this.flags = flags2;
  }
};
var NonStageTargetFlags = class _NonStageTargetFlags extends Flags {
  isStage;
  visible;
  draggable;
  diffVolume;
  diffCurrentCostume;
  diffRotationStyle;
  diffSize;
  hasTTSLanguage;
  static defaults = {
    volume: 100,
    current_costume: 0,
    rot_style: "all around",
    size: 100
  };
  static read_defaults = {
    volume: 100,
    current_costume: 0,
    rot_style: 1,
    size: 100
  };
  constructor(isStage, visible, draggable, diffVolume, diffCurrentCostume, diffRotationStyle, diffSize, hasTTSLanguage) {
    super([
      isStage,
      visible,
      draggable,
      diffVolume,
      diffCurrentCostume,
      diffRotationStyle,
      diffSize,
      hasTTSLanguage
    ]), this.isStage = isStage, this.visible = visible, this.draggable = draggable, this.diffVolume = diffVolume, this.diffCurrentCostume = diffCurrentCostume, this.diffRotationStyle = diffRotationStyle, this.diffSize = diffSize, this.hasTTSLanguage = hasTTSLanguage;
  }
  static parseJson(data) {
    if (jsonTypeof(data) != "object") throw `target is not an object`;
    const is_stage = data.isStage;
    const visible = data.visible;
    const draggable = data.draggable;
    const volume = data.volume;
    const current_costume = data.currentCostume;
    const rot_style = data.rotationStyle;
    const size = data.size;
    const tts_language = data.textToSpeechLanguage;
    expectJsonType("isStage", is_stage, "boolean");
    expectJsonType("visible", visible, "boolean");
    expectJsonType("draggable", draggable, "boolean");
    expectJsonType("volume", volume, "number");
    expectJsonType("currentCostume", current_costume, "number");
    expectJsonType("rotationStyle", rot_style, "string");
    if (![
      "all around",
      "left-right",
      "don't rotate"
    ].includes(rot_style)) throw `'rotationStyle' is neither "all around", "left-right" or "don't rotate"`;
    expectJsonType("size", size, "number");
    expectJsonType("textToSpeechLanguage", tts_language, "null", "string");
    return new _NonStageTargetFlags(is_stage, visible, draggable, volume != this.defaults.volume, current_costume != this.defaults.current_costume, rot_style != this.defaults.rot_style, size != this.defaults.size, tts_language != null);
  }
};
var StageTargetFlags = class _StageTargetFlags extends Flags {
  isStage;
  diffVolume;
  diffCurrentCostume;
  diffTempo;
  diffVideoTransparency;
  diffVideoState;
  hasTTSLanguage;
  static defaults = {
    volume: 100,
    current_costume: 0,
    tempo: 60,
    video_transparency: 50,
    video_state: "on"
  };
  static read_defaults = {
    volume: 100,
    current_costume: 0,
    tempo: 60,
    video_transparency: 50,
    video_state: 1
  };
  constructor(isStage, diffVolume, diffCurrentCostume, diffTempo, diffVideoTransparency, diffVideoState, hasTTSLanguage) {
    super([
      isStage,
      diffVolume,
      diffCurrentCostume,
      diffTempo,
      diffVideoTransparency,
      diffVideoState,
      hasTTSLanguage
    ]), this.isStage = isStage, this.diffVolume = diffVolume, this.diffCurrentCostume = diffCurrentCostume, this.diffTempo = diffTempo, this.diffVideoTransparency = diffVideoTransparency, this.diffVideoState = diffVideoState, this.hasTTSLanguage = hasTTSLanguage;
  }
  static parseJson(data) {
    if (jsonTypeof(data) != "object") throw `target is not an object`;
    const is_stage = data.isStage;
    const volume = data.volume;
    const current_costume = data.currentCostume;
    const tempo = data.tempo;
    const video_transparency = data.videoTransparency;
    const video_state = data.videoState;
    const tts_language = data.textToSpeechLanguage;
    expectJsonType("isStage", is_stage, "boolean");
    expectJsonType("volume", volume, "number");
    expectJsonType("currentCostume", current_costume, "number");
    expectJsonType("tempo", tempo, "number", "null");
    expectJsonType("videoTransparency", video_transparency, "number");
    expectJsonType("videoState", video_state, "string");
    if (![
      "on",
      "on-flipped",
      "off"
    ].includes(video_state)) throw `'videoState' is neither "on", "on-flipped" or "off"`;
    expectJsonType("textToSpeechLanguage", tts_language, "null", "string");
    return new _StageTargetFlags(is_stage, volume != this.defaults.volume, current_costume != this.defaults.current_costume, tempo != this.defaults.tempo, video_transparency != this.defaults.video_transparency, video_state != this.defaults.video_state, tts_language != null);
  }
};
var CostumeFlags = class _CostumeFlags extends Flags {
  dataFormat;
  customMd5Ext;
  constructor(dataFormat, customMd5Ext) {
    super([
      dataFormat,
      customMd5Ext
    ]), this.dataFormat = dataFormat, this.customMd5Ext = customMd5Ext;
  }
  static parseJson(data) {
    if (jsonTypeof(data) != "object") throw `costume is not an object`;
    const asset_id = data.assetId;
    expectJsonType("assetId", asset_id, "string");
    const path = data.md5ext;
    expectJsonType("md5ext", path, "string");
    const format2 = data.dataFormat;
    expectJsonType("dataFormat", format2, "string");
    return new _CostumeFlags(format2 == "png", path != `${asset_id}.${format2}`);
  }
};
var SoundFlags = class _SoundFlags extends Flags {
  dataFormat;
  customMd5Ext;
  constructor(dataFormat, customMd5Ext) {
    super([
      dataFormat,
      customMd5Ext
    ]), this.dataFormat = dataFormat, this.customMd5Ext = customMd5Ext;
  }
  static parseJson(data) {
    if (jsonTypeof(data) != "object") throw `sound is not an object`;
    const asset_id = data.assetId;
    expectJsonType("assetId", asset_id, "string");
    const path = data.md5ext;
    expectJsonType("md5ext", path, "string");
    const format2 = data.dataFormat;
    expectJsonType("dataFormat", format2, "string");
    return new _SoundFlags(format2 == "wav", path != `${asset_id}.${format2}`);
  }
};
var InputFlags = class extends Flags {
  isLiteral;
  hasShadow;
  isPocket;
  constructor(isLiteral, hasShadow, isPocket) {
    super([
      isLiteral,
      hasShadow,
      isPocket
    ]), this.isLiteral = isLiteral, this.hasShadow = hasShadow, this.isPocket = isPocket;
  }
};
var BlockFlags = class extends Flags {
  hasNext;
  hasParent;
  isToplevel;
  isShadow;
  constructor(hasNext, hasParent, isToplevel, isShadow) {
    super([
      hasNext,
      hasParent,
      isToplevel,
      isShadow
    ]), this.hasNext = hasNext, this.hasParent = hasParent, this.isToplevel = isToplevel, this.isShadow = isShadow;
  }
};
var CommentFlags = class _CommentFlags extends Flags {
  hasBlock;
  minimised;
  constructor(hasBlock, minimised) {
    super([
      hasBlock,
      minimised
    ]), this.hasBlock = hasBlock, this.minimised = minimised;
  }
  static parseJson(data) {
    if (jsonTypeof(data) != "object") throw `comment is not an object`;
    const block_id = data.blockId;
    expectJsonType("blockId", block_id, "string", "null");
    const minimised = data.minimized;
    expectJsonType("minimized", minimised, "boolean");
    return new _CommentFlags(block_id != null, minimised);
  }
};
var MonitorFlags = class _MonitorFlags extends Flags {
  hasSpriteName;
  isSlider;
  constructor(hasSpriteName, isSlider) {
    super([
      hasSpriteName,
      isSlider
    ]), this.hasSpriteName = hasSpriteName, this.isSlider = isSlider;
  }
  static parseJson(data) {
    if (jsonTypeof(data) != "object") throw `monitor is not an object`;
    const sprite_name = data.spriteName;
    expectJsonType("spriteName", sprite_name, "string", "null");
    const mode = data.mode;
    expectJsonType("mode", mode, "string");
    return new _MonitorFlags(sprite_name != null, mode == "slider");
  }
};

// node_modules/@flufi/scsf/src/monitor.js
var Monitor = class _Monitor {
  id;
  mode;
  opcode;
  paramName;
  spriteName;
  value;
  x;
  y;
  visible;
  width;
  height;
  sliderMin;
  sliderMax;
  isDiscrete;
  flags;
  constructor(id, mode, opcode, paramName, spriteName, value, x, y, visible, width, height, sliderMin, sliderMax, isDiscrete, flags2) {
    this.id = id;
    this.mode = mode;
    this.opcode = opcode;
    this.paramName = paramName;
    this.spriteName = spriteName;
    this.value = value;
    this.x = x;
    this.y = y;
    this.visible = visible;
    this.width = width;
    this.height = height;
    this.sliderMin = sliderMin;
    this.sliderMax = sliderMax;
    this.isDiscrete = isDiscrete;
    this.flags = flags2;
  }
  static parseJson(data) {
    if (jsonTypeof(data) != "object") throw `monitor is not an object`;
    const id = data.id;
    expectJsonType("id", id, "string");
    const mode = data.mode;
    expectJsonType("mode", mode, "string");
    const opcode = data.opcode;
    expectJsonType("opcode", opcode, "string");
    const params = data.params;
    expectJsonType("params", params, "object");
    const param_values = Object.values(params);
    const param_name = param_values.length > 0 ? String(param_values[0]) : id;
    const sprite_name = data.spriteName;
    expectJsonType("spriteName", sprite_name, "string", "null");
    const value = data.value;
    const x = data.x;
    expectJsonType("x", x, "number");
    const y = data.y;
    expectJsonType("y", y, "number");
    const visible = data.visible;
    expectJsonType("visible", visible, "boolean");
    const width = data.width;
    expectJsonType("width", width, "number");
    const height = data.height;
    expectJsonType("height", height, "number");
    let slider_min, slider_max, is_discrete;
    if (mode == "slider") {
      slider_min = data.sliderMin;
      expectJsonType("sliderMin", slider_min, "number");
      slider_max = data.sliderMax;
      expectJsonType("sliderMax", slider_max, "number");
      is_discrete = data.isDiscrete;
      expectJsonType("isDiscrete", is_discrete, "boolean");
    }
    return new _Monitor(id, mode, opcode, param_name, sprite_name, value, x, y, visible, width, height, slider_min, slider_max, is_discrete, MonitorFlags.parseJson(data));
  }
  outputJson() {
    const obj = {
      id: this.id,
      mode: this.mode,
      opcode: this.opcode,
      params: this.opcode == "data_variable" ? {
        VARIABLE: this.paramName
      } : {
        LIST: this.paramName
      },
      spriteName: this.spriteName ?? null,
      value: this.value,
      width: this.width,
      height: this.height,
      x: this.x,
      y: this.y,
      visible: this.visible
    };
    if (this.mode == "slider") {
      obj.sliderMin = this.sliderMin;
      obj.sliderMax = this.sliderMax;
      obj.isDiscrete = this.isDiscrete;
    }
    return obj;
  }
  static parseMonitors(data) {
    if (jsonTypeof(data) != "array") throw `monitors is not an array`;
    return data.map((m) => _Monitor.parseJson(m));
  }
};

// node_modules/@flufi/scsf/src/block.js
var Block = class _Block {
  id;
  opcode;
  next;
  parent;
  inputs;
  fields;
  shadow;
  top_level;
  x;
  y;
  constructor(id, opcode, next, parent, inputs, fields, shadow, top_level, x, y) {
    this.id = id;
    this.opcode = opcode;
    this.next = next;
    this.parent = parent;
    this.inputs = inputs;
    this.fields = fields;
    this.shadow = shadow;
    this.top_level = top_level;
    this.x = x;
    this.y = y;
  }
  getFlags() {
    return new BlockFlags(this.next != null, this.parent != null, this.top_level, this.shadow);
  }
  static parseJson(data, id) {
    if (jsonTypeof(data) != "object") throw `block is not an object`;
    const opcode = data.opcode;
    expectJsonType("opcode", opcode, "string");
    const next = data.next;
    expectJsonType("next", next, "string", "null");
    const parent = data.parent;
    expectJsonType("parent", parent, "string", "null");
    const inputs = data.inputs;
    expectJsonType("inputs", inputs, "object");
    const converted_inputs = Input.parseInputs(inputs);
    const fields = data.fields;
    expectJsonType("fields", fields, "object");
    const converted_fields = Field.parseFields(fields);
    const shadow = data.shadow;
    expectJsonType("shadow", shadow, "boolean");
    const top_level = data.topLevel;
    expectJsonType("topLevel", top_level, "boolean");
    const x = data.x;
    if (x !== void 0) expectJsonType("x", x, "number");
    const y = data.y;
    if (x !== void 0) expectJsonType("y", y, "number");
    return new _Block(id, opcode, next, parent, converted_inputs, converted_fields, shadow, top_level, x, y);
  }
  static parseBlocks(data) {
    if (jsonTypeof(data) != "object") throw `blocks object is not an object`;
    const blocks = {};
    const entries = Object.entries(data);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const id = entry[0];
      const block = entry[1];
      blocks[id] = _Block.parseJson(block, id);
    }
    return blocks;
  }
  outputJson() {
    return {
      opcode: this.opcode,
      next: this.next ?? null,
      parent: this.parent ?? null,
      inputs: Object.fromEntries(this.inputs.map((i) => [
        i.id,
        i.outputJson()
      ])),
      fields: Object.fromEntries(this.fields.map((f) => [
        f.name,
        f.outputJson()
      ])),
      shadow: this.shadow,
      topLevel: this.top_level,
      x: this.x,
      y: this.y
    };
  }
};
var Field = class _Field {
  name;
  value;
  optional_id;
  constructor(name, value, optional_id) {
    this.name = name;
    this.value = value;
    this.optional_id = optional_id;
  }
  static parseJson(name, data) {
    const value = data[0];
    const optional_id = data[1];
    if (optional_id != null) expectJsonType("optional id", optional_id, "string");
    return new _Field(name, value, optional_id);
  }
  static parseFields(data) {
    if (jsonTypeof(data) != "object") throw `fields is not an object`;
    const fields = [];
    const entries = Object.entries(data);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      fields.push(this.parseJson(entry[0], entry[1]));
    }
    return fields;
  }
  outputJson() {
    return [
      this.value,
      this.optional_id
    ];
  }
};
var literal_type_map = {
  4: "number",
  5: "positive-number",
  6: "positive-integer",
  7: "integer",
  8: "angle",
  9: "color",
  10: "string"
};
var literal_type_map_reverse = {
  "number": 4,
  "positive-number": 5,
  "positive-integer": 6,
  "integer": 7,
  "angle": 8,
  "color": 9,
  "string": 10
};
var Input = class _Input {
  id;
  data;
  constructor(id, data) {
    this.id = id;
    this.data = data;
  }
  getFlags() {
    return new InputFlags(this.data.type == "literal", this.data.type == "shadow", this.data.type == "pocket");
  }
  static parseJson(data, id) {
    if (jsonTypeof(data) != "array") throw `input is not an array`;
    if (jsonTypeof(data[0]) != "number") throw `input type isnt a number`;
    if (![
      1,
      2,
      3
    ].includes(data[0])) throw `input type is not 1, 2 or 3`;
    switch (data[0]) {
      case 1: {
        if (Array.isArray(data[1])) {
          const kind = literal_type_map[data[1][0]];
          const val = data[1][1];
          return new _Input(id, {
            type: "literal",
            kind,
            val
          });
        }
        return new _Input(id, {
          type: "pocket",
          block_id: data[1]
        });
      }
      case 2: {
        return new _Input(id, {
          type: "block",
          block_id: data[1]
        });
      }
      case 3: {
        return new _Input(id, {
          type: "shadow",
          shadow_id: data[2],
          block_id: data[1]
        });
      }
    }
  }
  static parseInputs(data) {
    if (jsonTypeof(data) != "object") throw `inputs is not an object`;
    const inputs = [];
    const entries = Object.entries(data);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const id = entry[0];
      const input = entry[1];
      inputs.push(_Input.parseJson(input, id));
    }
    return inputs;
  }
  outputJson() {
    switch (this.data.type) {
      case "literal": {
        return [
          1,
          [
            literal_type_map_reverse[this.data.kind],
            this.data.val
          ]
        ];
      }
      case "shadow": {
        return [
          3,
          this.data.block_id,
          this.data.shadow_id
        ];
      }
      case "block": {
        return [
          2,
          this.data.block_id
        ];
      }
      case "pocket": {
        return [
          1,
          this.data.block_id
        ];
      }
    }
  }
};

// node_modules/@flufi/scsf/src/broadcasts.js
function parseBroadcasts(data) {
  if (jsonTypeof(data) != "object") throw `broadcasts object is not an object`;
  const broadcasts = {};
  const entries = Object.entries(data);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    expectJsonType("value", entry[1], "string");
    broadcasts[entry[0]] = entry[1];
  }
  return broadcasts;
}

// node_modules/@flufi/scsf/src/comment.js
var Comment = class _Comment {
  id;
  block_id;
  x;
  y;
  width;
  height;
  minimised;
  text;
  flags;
  constructor(id, block_id, x, y, width, height, minimised, text, flags2) {
    this.id = id;
    this.block_id = block_id;
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.minimised = minimised;
    this.text = text;
    this.flags = flags2;
  }
  static parseJson(id, data) {
    if (jsonTypeof(data) != "object") throw `comment not an object`;
    const block_id = data.blockId;
    const x = data.x;
    const y = data.y;
    const width = data.width;
    const height = data.height;
    const minimised = data.minimized;
    const text = data.text;
    expectJsonType("blockId", block_id, "string", "null");
    expectJsonType("x", x, "number");
    expectJsonType("y", y, "number");
    expectJsonType("width", width, "number");
    expectJsonType("height", height, "number");
    expectJsonType("minimized", minimised, "boolean");
    expectJsonType("text", text, "string");
    return new _Comment(id, block_id ?? null, x, y, width, height, minimised, text, CommentFlags.parseJson(data));
  }
  static parseComments(data) {
    if (jsonTypeof(data) != "object") throw `comments object is not an object`;
    const comments = [];
    const entries = Object.entries(data);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      comments.push(this.parseJson(...entry));
    }
    return comments;
  }
  outputJson() {
    return {
      blockId: this.block_id ?? null,
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      minimized: this.minimised,
      text: this.text
    };
  }
};

// node_modules/@flufi/scsf/src/costumes.js
var Costume = class _Costume {
  name;
  flags;
  bitmap_res;
  data_format;
  asset_id;
  path;
  anchor_x;
  anchor_y;
  constructor(name, flags2, bitmap_res, data_format, asset_id, path, anchor_x, anchor_y) {
    this.name = name;
    this.flags = flags2;
    this.bitmap_res = bitmap_res;
    this.data_format = data_format;
    this.asset_id = asset_id;
    this.path = path;
    this.anchor_x = anchor_x;
    this.anchor_y = anchor_y;
  }
  static parseJson(data) {
    if (jsonTypeof(data) != "object") throw `costume is not an object`;
    const flags2 = CostumeFlags.parseJson(data);
    const name = data.name;
    expectJsonType("name", name, "string");
    const bitmap_res = data.bitmapResolution;
    if (bitmap_res !== void 0) expectJsonType("bitmapResolution", bitmap_res, "number");
    const data_format = data.dataFormat;
    expectJsonType("dataFormat", data_format, "string");
    if (![
      "svg",
      "png"
    ].includes(data_format)) throw `'dataFormat' is neither png or svg`;
    const asset_id = data.assetId;
    expectJsonType("assetId", asset_id, "string");
    const path = data.md5ext;
    expectJsonType("md5ext", path, "string");
    const anchor_x = data.rotationCenterX;
    expectJsonType("rotationCenterX", anchor_x, "number");
    const anchor_y = data.rotationCenterY;
    expectJsonType("rotationCenterY", anchor_y, "number");
    return new _Costume(name, flags2, bitmap_res, data_format, asset_id, path, anchor_x, anchor_y);
  }
  outputJson() {
    return {
      name: this.name,
      dataFormat: this.data_format,
      assetId: this.asset_id,
      md5ext: this.path,
      rotationCenterX: this.anchor_x,
      rotationCenterY: this.anchor_y
    };
  }
};

// node_modules/@flufi/scsf/src/list.js
var List = class _List {
  id;
  name;
  items;
  constructor(id, name, items) {
    this.id = id;
    this.name = name;
    this.items = items;
  }
  static parseLists(lists) {
    if (jsonTypeof(lists) != "object") throw `lists object is not an object`;
    const converted_lists = [];
    const entries = Object.entries(lists);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const name = entry[1][0];
      if (jsonTypeof(name) != "string") throw `list name isnt a string`;
      const value = entry[1][1];
      converted_lists.push(new _List(entry[0], name, value));
    }
    return converted_lists;
  }
  outputJson() {
    return [
      this.name,
      this.items
    ];
  }
};

// node_modules/@flufi/scsf/src/sounds.js
var Sound = class _Sound {
  name;
  flags;
  rate;
  sampleCount;
  data_format;
  asset_id;
  path;
  constructor(name, flags2, rate, sampleCount, data_format, asset_id, path) {
    this.name = name;
    this.flags = flags2;
    this.rate = rate;
    this.sampleCount = sampleCount;
    this.data_format = data_format;
    this.asset_id = asset_id;
    this.path = path;
  }
  static parseJson(data) {
    if (jsonTypeof(data) != "object") throw `sound is not an object`;
    const flags2 = SoundFlags.parseJson(data);
    const name = data.name;
    expectJsonType("name", name, "string");
    const rate = data.rate;
    expectJsonType("rate", rate, "number");
    const sample_count = data.sampleCount;
    expectJsonType("sampleCount", sample_count, "number");
    const data_format = data.dataFormat;
    expectJsonType("dataFormat", data_format, "string");
    if (![
      "mp3",
      "wav"
    ].includes(data_format)) throw `'dataFormat' is neither mp3 or wav`;
    const asset_id = data.assetId;
    expectJsonType("assetId", asset_id, "string");
    const path = data.md5ext;
    expectJsonType("md5ext", path, "string");
    return new _Sound(name, flags2, rate, sample_count, data_format, asset_id, path);
  }
  outputJson() {
    return {
      name: this.name,
      dataFormat: this.data_format,
      assetId: this.asset_id,
      md5ext: this.path,
      rate: this.rate,
      sampleCount: this.sampleCount
    };
  }
};

// node_modules/@flufi/scsf/src/variable.js
var Variable = class _Variable {
  id;
  name;
  value;
  constructor(id, name, value) {
    this.id = id;
    this.name = name;
    this.value = value;
  }
  static parseVariables(variables) {
    if (jsonTypeof(variables) != "object") throw `variables object is not an object`;
    const converted_variables = [];
    const entries = Object.entries(variables);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const name = entry[1][0];
      if (jsonTypeof(name) != "string") throw `variable name isnt a string`;
      const value = entry[1][1];
      converted_variables.push(new _Variable(entry[0], name, value));
    }
    return converted_variables;
  }
  outputJson() {
    return [
      this.name,
      this.value
    ];
  }
};

// node_modules/@flufi/scsf/src/target.js
var Target = class _Target {
  name;
  is_stage;
  costumes;
  sounds;
  blocks;
  variables;
  lists;
  broadcasts;
  comments;
  current_costume;
  rot_style;
  layer;
  x;
  y;
  size;
  volume;
  tempo;
  video_transparency;
  video_state;
  tts_language;
  flags;
  constructor(name, is_stage, costumes, sounds, blocks, variables, lists, broadcasts, comments, current_costume, rot_style, layer, x, y, size, volume, tempo, video_transparency, video_state, tts_language, flags2) {
    this.name = name;
    this.is_stage = is_stage;
    this.costumes = costumes;
    this.sounds = sounds;
    this.blocks = blocks;
    this.variables = variables;
    this.lists = lists;
    this.broadcasts = broadcasts;
    this.comments = comments;
    this.current_costume = current_costume;
    this.rot_style = rot_style;
    this.layer = layer;
    this.x = x;
    this.y = y;
    this.size = size;
    this.volume = volume;
    this.tempo = tempo;
    this.video_transparency = video_transparency;
    this.video_state = video_state;
    this.tts_language = tts_language;
    this.flags = flags2;
  }
  static parseJson(data) {
    if (jsonTypeof(data) != "object") throw `target is not an object`;
    const is_stage = data.isStage;
    expectJsonType("isStage", is_stage, "boolean");
    let flags2;
    if (is_stage) flags2 = StageTargetFlags.parseJson(data);
    else flags2 = NonStageTargetFlags.parseJson(data);
    const costumes = data.costumes;
    expectJsonType("costumes", costumes, "array");
    const sounds = data.sounds;
    expectJsonType("sounds", sounds, "array");
    const blocks = data.blocks;
    expectJsonType("blocks", blocks, "object");
    const broadcasts = data.broadcasts;
    expectJsonType("broadcasts", broadcasts, "object");
    const comments = data.comments;
    expectJsonType("comments", comments, "object");
    const { name, current_costume, rot_style, layer, x, y, size, volume, tempo, video_transparency, video_state, tts_language } = this.parseJsonProps(data);
    return new _Target(name, is_stage, costumes.map((c) => Costume.parseJson(c)), sounds.map((s) => Sound.parseJson(s)), Block.parseBlocks(blocks), Variable.parseVariables(data.variables), List.parseLists(data.lists), parseBroadcasts(data.broadcasts), Comment.parseComments(data.comments), current_costume, rot_style, layer, x, y, size, volume, tempo, video_transparency, video_state, tts_language, flags2);
  }
  static parseJsonProps(data) {
    const name = data.name;
    expectJsonType("name", name, "string");
    const is_stage = data.isStage;
    expectJsonType("isStage", is_stage, "boolean");
    const current_costume = data.currentCostume;
    const rot_style = data.rotationStyle;
    const volume = data.volume;
    const layer = data.layerOrder;
    const tts_language = data.textToSpeechLanguage;
    let video_transparency, video_state, tempo;
    if (is_stage) {
      video_transparency = data.videoTransparency;
      video_state = data.videoState;
      tempo = data.tempo;
    }
    let x, y, size;
    if (!is_stage) {
      x = data.x;
      y = data.y;
      size = data.size;
    }
    expectJsonType("currentCostume", current_costume, "number");
    expectJsonType("volume", volume, "number");
    expectJsonType("layerOrder", layer, "number");
    expectJsonType("textToSpeechLanguage", tts_language, "string", "null");
    if (is_stage) {
      expectJsonType("videoTransparency", video_transparency, "number");
      expectJsonType("videoState", video_state, "string");
      if (![
        "on",
        "on-flipped",
        "off"
      ].includes(video_state)) throw `'videoState' is neither "on", "on-flipped" or "off"`;
      expectJsonType("tempo", tempo, "number");
    } else {
      expectJsonType("rotationStyle", rot_style, "string");
      if (![
        "all around",
        "left-right",
        "don't rotate"
      ].includes(rot_style)) throw `'rotationStyle' is neither "all around", "left-right" or "don't rotate"`;
      expectJsonType("x", x, "number");
      expectJsonType("y", y, "number");
      expectJsonType("size", size, "number");
    }
    return {
      name,
      is_stage,
      current_costume,
      rot_style,
      layer,
      x,
      y,
      size,
      volume,
      tempo,
      video_transparency,
      video_state,
      tts_language
    };
  }
  outputJson() {
    return {
      isStage: this.is_stage,
      name: this.name,
      variables: Object.fromEntries(this.variables.map((v) => [
        v.id,
        v.outputJson()
      ])),
      lists: Object.fromEntries(this.lists.map((v) => [
        v.id,
        v.outputJson()
      ])),
      broadcasts: this.broadcasts,
      blocks: Object.fromEntries(Object.values(this.blocks).map((b) => [
        b.id,
        b.outputJson()
      ])),
      comments: Object.fromEntries(this.comments.map((c) => [
        c.id,
        c.outputJson()
      ])),
      costumes: this.costumes.map((c) => c.outputJson()),
      sounds: this.sounds.map((s) => s.outputJson()),
      currentCostume: this.current_costume,
      rotationStyle: this.rot_style,
      layerOrder: this.layer,
      x: this.x,
      y: this.y,
      size: this.size,
      volume: this.volume,
      tempo: this.tempo,
      videoTransparency: this.video_transparency,
      videoState: this.video_state,
      textToSpeechLanguage: this.tts_language
    };
  }
};

// node_modules/@flufi/scsf/src/project.js
var Project = class _Project {
  meta;
  targets;
  extensions;
  monitors;
  constructor(meta, targets, extensions, monitors) {
    this.meta = meta;
    this.targets = targets;
    this.extensions = extensions;
    this.monitors = monitors;
  }
  static parseJson(data) {
    if (jsonTypeof(data) != "object") throw `project.json is not an object`;
    const meta = ProjectMeta.parseJson(data);
    const targets = data.targets;
    expectJsonType("targets", targets, "array");
    const monitors = data.monitors ?? [];
    expectJsonType("monitors", monitors, "array");
    return new _Project(meta, targets.map((t) => Target.parseJson(t)), Extension.parseExtensions(data), Monitor.parseMonitors(monitors));
  }
  outputJson() {
    return {
      meta: this.meta.outputJson(),
      monitors: this.monitors.map((m) => m.outputJson()),
      targets: this.targets.map((t) => t.outputJson()),
      extensions: this.extensions.map((e) => e.name),
      extensionURLs: Object.fromEntries(this.extensions.map((e) => [
        e.name,
        e.url
      ]))
    };
  }
};
var ProjectMeta = class _ProjectMeta {
  semver;
  vm;
  agent;
  platform_name;
  platform_url;
  constructor(semver, vm, agent, platform_name, platform_url) {
    this.semver = semver;
    this.vm = vm;
    this.agent = agent;
    this.platform_name = platform_name;
    this.platform_url = platform_url;
  }
  static parseJson(data) {
    if (jsonTypeof(data) != "object") throw `project is not an object`;
    const meta = data.meta;
    expectJsonType("meta", meta, "object");
    const meta_semver = meta.semver;
    expectJsonType("semver", meta_semver, "string");
    const meta_vm = meta.vm;
    expectJsonType("vm", meta_vm, "string");
    const meta_agent = meta.agent;
    expectJsonType("agent", meta_agent, "string");
    const platform = meta.platform;
    expectJsonType("platform", platform, "object");
    const platform_name = platform.name;
    expectJsonType("name", platform_name, "string");
    const platform_url = platform.url;
    expectJsonType("url", platform_url, "string");
    return new _ProjectMeta(meta_semver, meta_vm, meta_agent, platform_name, platform_url);
  }
  outputJson() {
    return {
      semver: this.semver,
      vm: this.vm,
      agent: this.agent,
      platform: {
        name: this.platform_name,
        url: this.platform_url
      }
    };
  }
};

// node_modules/@flufi/scsf/src/element.js
var Element = class {
  constructor(comment) {
    if (comment)
      this.comment = comment;
  }
};
var LabelElement = class extends Element {
  label;
  contents;
  constructor(label, contents) {
    super(), this.label = label, this.contents = contents;
  }
  flatten() {
    return this.contents.map((e) => e.flatten()).flat(1);
  }
};
var StringElement = class extends Element {
  data;
  constructor(data, comment) {
    super(comment), this.data = data;
  }
  flatten() {
    return [
      this.data
    ];
  }
};
var NumberElement = class extends Element {
  data;
  constructor(data, comment) {
    super(comment), this.data = data;
  }
  flatten() {
    return [
      this.data
    ];
  }
};
var BooleanElement = class extends Element {
  data;
  constructor(data, comment) {
    super(comment), this.data = data;
  }
  flatten() {
    return [
      this.data
    ];
  }
};
var FlagsElement = class extends Element {
  data;
  constructor(data, comment) {
    super(comment), this.data = data;
  }
  flatten() {
    let num2 = 0;
    for (let i = 0; i < this.data.length; i++) {
      num2 += 1 * Number(this.data[i]) << i;
    }
    return [
      num2
    ];
  }
};
var str = (data, comment) => new StringElement(data, comment);
var num = (data, comment) => new NumberElement(data, comment);
var bool = (data, comment) => new BooleanElement(data, comment);
var flags = (data, comment) => new FlagsElement(data.flags, comment);

// node_modules/@flufi/scsf/src/formatter.js
var indent = 0;
var lines = [];
function write(...text) {
  lines[lines.length - 1] += text.join(" ");
}
function newline() {
  lines.push("    ".repeat(indent));
}
function writeln(...text) {
  newline();
  write(...text);
}
function format(raw_data) {
  if (Array.isArray(raw_data) && typeof raw_data[0] == "string") raw_data = raw_data[1];
  if (!Array.isArray(raw_data)) raw_data = [
    raw_data
  ];
  indent = 0;
  lines = [];
  const data = raw_data;
  formatElements(data);
  return lines.join("\n");
}
function formatElements(elements) {
  for (let i = 0; i < elements.length; i++) {
    formatElement(elements[i]);
  }
}
function formatElement(element) {
  newline();
  formatElementRaw(element);
  if (element.comment)
    write("      //", element.comment);
}
function formatElementRaw(element) {
  if (element instanceof LabelElement) {
    write(`#${element.label} {`);
    indent++;
    formatElements(element.contents);
    indent--;
    writeln(`}`);
    return;
  }
  if (element instanceof StringElement) {
    write("str", JSON.stringify(element.data));
    return;
  }
  if (element instanceof NumberElement) {
    write("num", JSON.stringify(element.data));
    return;
  }
  if (element instanceof BooleanElement) {
    write("bool", JSON.stringify(element.data));
    return;
  }
  if (element instanceof FlagsElement) {
    write("flags", element.data.map((f) => Number(f)).join(" "));
    return;
  }
  console.warn(element);
}

// node_modules/@flufi/scsf/src/reader.js
var Reader = class {
  pointer = 0;
  src;
  // utils
  readStr() {
    return this.src[this.pointer++];
  }
  readNum() {
    return this.src[this.pointer++];
  }
  readBool() {
    return this.src[this.pointer++];
  }
  readFlags() {
    const data = this.readNum();
    const flags2 = [];
    for (let i = 0; i < 8; i++) {
      flags2.push((data & 1 << i) > 0);
    }
    return flags2;
  }
  // components
  readExtensions() {
    const count = this.readNum();
    const extensions = [];
    for (let i = 0; i < count; i++) {
      extensions.push(this.readExtension());
    }
    return extensions;
  }
  readExtension() {
    const name = this.readStr();
    const hasUrl = this.readBool();
    const url = hasUrl ? this.readStr() : void 0;
    return new Extension(name, url);
  }
  readProject(src) {
    this.src = src;
    const meta = this.readProjectMetadata();
    const targets = this.readTargets();
    const monitors = this.readMonitors();
    const extensions = this.readExtensions();
    return new Project(meta, targets, extensions, monitors);
  }
  readProjectMetadata() {
    const meta_semver = this.readStr();
    const meta_vm = this.readStr();
    const meta_agent = this.readStr();
    const meta_platform_name = this.readStr();
    const meta_platform_url = this.readStr();
    return new ProjectMeta(meta_semver, meta_vm, meta_agent, meta_platform_name, meta_platform_url);
  }
  readTargets() {
    const count = this.readNum();
    const targets = [];
    for (let i = 0; i < count; i++) {
      targets.push(this.readTarget());
    }
    return targets;
  }
  readTarget() {
    const flags2 = this.readFlags();
    const name = this.readStr();
    if (flags2[0]) {
      let volume, current_costume, tempo, video_transparency, video_state, tts_language;
      volume = flags2[1] ? this.readNum() : StageTargetFlags.read_defaults.volume;
      current_costume = flags2[2] ? this.readNum() : StageTargetFlags.read_defaults.current_costume;
      tempo = flags2[3] ? this.readNum() : StageTargetFlags.read_defaults.tempo;
      video_transparency = flags2[4] ? this.readNum() : StageTargetFlags.read_defaults.video_transparency;
      video_state = flags2[5] ? this.readNum() : StageTargetFlags.read_defaults.video_state;
      tts_language = flags2[6] ? this.readStr() : null;
      const broadcasts = this.readBroadcasts();
      const costumes = this.readCostumes();
      const sounds = this.readSounds();
      const blocks = this.readBlocks();
      const variables = this.readVariables();
      const lists = this.readLists();
      const comments = this.readComments();
      return new Target(name, true, costumes, sounds, blocks, variables, lists, broadcasts, comments, current_costume, void 0, void 0, void 0, void 0, void 0, volume, tempo, video_transparency, convert_num_to_video_state(video_state), tts_language, new StageTargetFlags(true, volume != StageTargetFlags.read_defaults.volume, current_costume != StageTargetFlags.read_defaults.current_costume, tempo != StageTargetFlags.read_defaults.tempo, video_transparency != StageTargetFlags.read_defaults.video_transparency, video_state != StageTargetFlags.read_defaults.video_state, tts_language != null));
    } else {
      let current_costume, rot_style, layer, x, y, size, volume, tts_language;
      current_costume = flags2[4] ? this.readNum() : NonStageTargetFlags.read_defaults.current_costume;
      rot_style = flags2[5] ? this.readNum() : NonStageTargetFlags.read_defaults.rot_style;
      layer = this.readNum();
      x = this.readNum();
      y = this.readNum();
      size = flags2[6] ? this.readNum() : NonStageTargetFlags.read_defaults.size;
      volume = flags2[3] ? this.readNum() : NonStageTargetFlags.read_defaults.volume;
      tts_language = flags2[7] ? this.readStr() : null;
      const costumes = this.readCostumes();
      const sounds = this.readSounds();
      const blocks = this.readBlocks();
      const variables = this.readVariables();
      const lists = this.readLists();
      const comments = this.readComments();
      return new Target(name, false, costumes, sounds, blocks, variables, lists, void 0, comments, current_costume, convert_num_to_rot_style(rot_style), layer, x, y, size, volume, void 0, void 0, void 0, tts_language, new NonStageTargetFlags(false, flags2[1], flags2[2], flags2[3], flags2[4], flags2[5], flags2[6], flags2[7]));
    }
  }
  readCostumes() {
    const count = this.readNum();
    const costumes = [];
    for (let i = 0; i < count; i++) {
      costumes.push(this.readCostume());
    }
    return costumes;
  }
  readCostume() {
    const flags2 = this.readFlags();
    const format2 = flags2[0] ? "png" : "svg";
    const name = this.readStr();
    const asset_id = this.readStr();
    const anchor_x = this.readNum();
    const anchor_y = this.readNum();
    let path = flags2[1] ? this.readStr() : `${asset_id}.${format2}`;
    let bitmap_res = flags2[0] ? this.readNum() : void 0;
    return new Costume(name, new CostumeFlags(flags2[0], flags2[1]), bitmap_res, format2, asset_id, path, anchor_x, anchor_y);
  }
  readSounds() {
    const count = this.readNum();
    const sounds = [];
    for (let i = 0; i < count; i++) {
      sounds.push(this.readSound());
    }
    return sounds;
  }
  readSound() {
    const flags2 = this.readFlags();
    const format2 = flags2[0] ? "wav" : "mp3";
    const name = this.readStr();
    const asset_id = this.readStr();
    const rate = this.readNum();
    const sample_count = this.readNum();
    let path = flags2[1] ? this.readStr() : `${asset_id}.${format2}`;
    return new Sound(name, new SoundFlags(flags2[0], flags2[1]), rate, sample_count, format2, asset_id, path);
  }
  readVariables() {
    const count = this.readNum();
    const variables = [];
    for (let i = 0; i < count; i++) {
      variables.push(this.readVariable());
    }
    return variables;
  }
  readVariable() {
    const id = this.readStr();
    const name = this.readStr();
    const type = this.readNum();
    const value = this.readVariableValue(convert_num_to_json_type(type));
    return new Variable(id, name, value);
  }
  readVariableValue(type) {
    switch (type) {
      case "string":
        return this.readStr();
      case "number":
        return this.readNum();
      case "array": {
        const length = this.readNum();
        const arr = [];
        for (let i = 0; i < length; i++) {
          const item_type = this.readNum();
          arr.push(this.readVariableValue(convert_num_to_json_type(item_type)));
        }
        return arr;
      }
    }
  }
  readLists() {
    const count = this.readNum();
    const lists = [];
    for (let i = 0; i < count; i++) {
      lists.push(this.readList());
    }
    return lists;
  }
  readList() {
    const id = this.readStr();
    const name = this.readStr();
    const length = this.readNum();
    const items = [];
    for (let i = 0; i < length; i++) {
      const type = this.readNum();
      const value = this.readListValue(convert_num_to_json_type(type));
      items.push(value);
    }
    return new List(id, name, items);
  }
  readListValue(type) {
    switch (type) {
      case "string":
        return this.readStr();
      case "number":
        return this.readNum();
    }
  }
  readBlocks() {
    const blocks = {};
    const count = this.readNum();
    for (let i = 0; i < count; i++) {
      const block = this.readBlock();
      blocks[block.id] = block;
    }
    return blocks;
  }
  readBlock() {
    const flags2 = this.readFlags();
    const block_id = this.readId();
    const block_opcode = this.readOpcode();
    const next = flags2[0] ? this.readId() : null;
    const parent = flags2[1] ? this.readId() : null;
    let x, y;
    if (flags2[2]) {
      x = this.readNum();
      y = this.readNum();
    }
    const inputs = this.readInputs();
    const fields = this.readFields();
    return new Block(block_id, block_opcode, next, parent, inputs, fields, flags2[3], flags2[2], x, y);
  }
  readInputs() {
    const count = this.readNum();
    const inputs = [];
    for (let i = 0; i < count; i++) {
      inputs.push(this.readInput());
    }
    return inputs;
  }
  readInput() {
    const flags2 = this.readFlags();
    const input_id = this.readStr();
    if (flags2[0]) {
      const literal_type = this.readNum();
      const literal_value = this.readLiteralValue();
      return new Input(input_id, {
        type: "literal",
        kind: convert_num_to_literal_type(literal_type),
        val: literal_value
      });
    }
    const block_id = this.readId();
    if (flags2[2]) {
      return new Input(input_id, {
        type: "pocket",
        block_id
      });
    }
    if (flags2[1]) {
      const shadow_id = this.readId();
      return new Input(input_id, {
        type: "shadow",
        block_id,
        shadow_id
      });
    }
    return new Input(input_id, {
      type: "block",
      block_id
    });
  }
  readLiteralValue() {
    const type = this.readNum();
    switch (convert_num_to_json_type(type)) {
      case "string":
        return this.readStr();
      case "number":
        return this.readNum();
    }
  }
  readFields() {
    const fields = [];
    const count = this.readNum();
    for (let i = 0; i < count; i++) {
      const field = this.readField();
      fields.push(field);
    }
    return fields;
  }
  readField() {
    const name = this.readStr();
    const optional_id = this.readBool() ? this.readStr() : null;
    const type = this.readNum();
    const value = this.readFieldValue(convert_num_to_json_type(type));
    return new Field(name, value, optional_id ?? void 0);
  }
  readFieldValue(type) {
    switch (type) {
      case "string":
        return this.readStr();
      case "number":
        return this.readNum();
    }
  }
  readBroadcasts() {
    const broadcasts = {};
    const count = this.readNum();
    for (let i = 0; i < count; i++) {
      const id = this.readStr();
      const name = this.readStr();
      broadcasts[id] = name;
    }
    return broadcasts;
  }
  readComments() {
    const comments = [];
    const count = this.readNum();
    for (let i = 0; i < count; i++) {
      const comment = this.readComment();
      comments.push(comment);
    }
    return comments;
  }
  readComment() {
    const flags2 = this.readFlags();
    const id = this.readStr();
    let block_id;
    if (flags2[0]) block_id = this.readStr();
    const x = this.readNum();
    const y = this.readNum();
    const w = this.readNum();
    const h = this.readNum();
    const text = this.readStr();
    return new Comment(id, block_id, x, y, w, h, flags2[1], text, new CommentFlags(flags2[0], flags2[1]));
  }
  readMonitors() {
    const count = this.readNum();
    const monitors = [];
    for (let i = 0; i < count; i++) {
      monitors.push(this.readMonitor());
    }
    return monitors;
  }
  readMonitor() {
    const flags2 = this.readFlags();
    const id = this.readStr();
    const mode = this.readStr();
    const opcode = this.readStr();
    const param_name = this.readStr();
    const type = this.readNum();
    const value = this.readVariableValue(convert_num_to_json_type(type));
    const x = this.readNum();
    const y = this.readNum();
    const visible = this.readBool();
    const width = this.readNum();
    const height = this.readNum();
    let sprite_name = null;
    if (flags2[0]) sprite_name = this.readStr();
    let slider_min, slider_max, is_discrete;
    if (flags2[1]) {
      slider_min = this.readNum();
      slider_max = this.readNum();
      is_discrete = this.readBool();
    }
    return new Monitor(id, mode, opcode, param_name, sprite_name, value, x, y, visible, width, height, slider_min, slider_max, is_discrete, new MonitorFlags(flags2[0], flags2[1]));
  }
  readId() {
    return this.readStr();
  }
  readOpcode() {
    return this.readStr();
  }
};

// node_modules/@flufi/scsf/src/writer.js
var Writer = class {
  element_layers = [
    [
      "root",
      []
    ]
  ];
  push(...elements) {
    const top = this.element_layers[this.element_layers.length - 1];
    top[1].push(...elements);
  }
  new_layer(label) {
    this.element_layers.push([
      label,
      []
    ]);
  }
  pop_layer() {
    const top = this.element_layers.pop();
    const label = top[0];
    this.push(new LabelElement(label, top[1]));
    return top[1];
  }
  getFlattened() {
    const top = this.element_layers[this.element_layers.length - 1];
    return top[1].map((e) => e.flatten()).flat(1);
  }
  // components
  writeProject(project) {
    this.writeProjectMetadata(project.meta);
    this.writeTargets(project.targets);
    this.writeMonitors(project.monitors);
    this.writeExtensions(project.extensions);
  }
  writeProjectMetadata(meta) {
    this.new_layer("metadata");
    {
      this.push(str(meta.semver, "semvar"));
      this.push(str(meta.vm, "vm"));
      this.push(str(meta.agent, "agent"));
      this.push(str(meta.platform_name, "platform name"));
      this.push(str(meta.platform_url, "platform url"));
    }
    this.pop_layer();
  }
  writeMonitors(monitors) {
    this.new_layer("monitors");
    this.push(num(monitors.length, "monitor count"));
    for (let i = 0; i < monitors.length; i++) {
      this.writeMonitor(monitors[i]);
    }
    this.pop_layer();
  }
  writeMonitor(monitor) {
    this.new_layer("monitor");
    this.push(flags(monitor.flags));
    this.push(str(monitor.id, "id"));
    this.push(str(monitor.mode, "mode"));
    this.push(str(monitor.opcode, "opcode"));
    this.push(str(monitor.paramName, "param name"));
    this.writeVariableValue(monitor.value);
    this.push(num(monitor.x, "x"));
    this.push(num(monitor.y, "y"));
    this.push(bool(monitor.visible, "visible"));
    this.push(num(monitor.width, "width"));
    this.push(num(monitor.height, "height"));
    if (monitor.flags.hasSpriteName) this.push(str(monitor.spriteName, "sprite name"));
    if (monitor.flags.isSlider) {
      this.push(num(monitor.sliderMin, "slider min"));
      this.push(num(monitor.sliderMax, "slider max"));
      this.push(bool(monitor.isDiscrete, "is discrete"));
    }
    this.pop_layer();
  }
  writeExtensions(extensions) {
    this.new_layer("extensions");
    this.push(num(extensions.length, "extensions count"));
    for (let i = 0; i < extensions.length; i++) {
      this.writeExtension(extensions[i]);
    }
    this.pop_layer();
  }
  writeExtension(extension) {
    this.new_layer("extension");
    this.push(str(extension.name, "name"));
    this.push(bool(extension.url != null));
    if (extension.url != null) this.push(str(extension.url, "url"));
    this.pop_layer();
  }
  writeTargets(targets) {
    this.new_layer("targets");
    this.push(num(targets.length, "target count"));
    for (let i = 0; i < targets.length; i++) {
      this.writeTarget(targets[i]);
    }
    this.pop_layer();
  }
  writeTarget(target) {
    this.new_layer("target");
    this.push(flags(target.flags));
    this.push(str(target.name, "name"));
    if (target.flags instanceof NonStageTargetFlags) {
      if (target.flags.diffCurrentCostume) this.push(num(target.current_costume, "current costume"));
      if (target.flags.diffRotationStyle) this.push(num(convert_rot_style_to_num(target.rot_style), "rotation style"));
      this.push(num(target.layer, "layer"));
      this.push(num(target.x, "x"));
      this.push(num(target.y, "y"));
      if (target.flags.diffSize) this.push(num(target.size, "size"));
      if (target.flags.diffVolume) this.push(num(target.volume));
      if (target.flags.hasTTSLanguage) this.push(str(target.tts_language));
    }
    if (target.flags instanceof StageTargetFlags) {
      if (target.flags.diffCurrentCostume) this.push(num(target.current_costume, "current costume"));
      if (target.flags.diffVolume) this.push(num(target.volume, "volume"));
      if (target.flags.diffTempo) this.push(num(target.tempo, "tempo"));
      if (target.flags.diffVideoTransparency) this.push(num(target.video_transparency, "video transparency"));
      if (target.flags.diffVideoState) this.push(num(convert_video_state_to_num(target.video_state), "video state"));
      if (target.flags.hasTTSLanguage) this.push(str(target.tts_language, "tts language"));
      this.writeBroadcasts(target.broadcasts);
    }
    this.writeCostumes(target.costumes);
    this.writeSounds(target.sounds);
    this.writeBlocks(target.blocks);
    this.writeVariables(target.variables);
    this.writeLists(target.lists);
    this.writeComments(target.comments);
    this.pop_layer();
  }
  writeCostumes(costumes) {
    this.new_layer("costumes");
    this.push(num(costumes.length, "costume count"));
    for (let i = 0; i < costumes.length; i++) {
      this.writeCostume(costumes[i]);
    }
    this.pop_layer();
  }
  writeCostume(costume) {
    this.new_layer("costume");
    this.push(flags(costume.flags));
    this.push(str(costume.name, "name"));
    this.push(str(costume.asset_id, "asset id"));
    this.push(num(costume.anchor_x, "anchor x"));
    this.push(num(costume.anchor_y, "anchor y"));
    if (costume.flags.customMd5Ext) this.push(str(costume.path, "path / md5ext"));
    if (costume.flags.dataFormat) this.push(num(costume.bitmap_res, "bitmap resolution"));
    this.pop_layer();
  }
  writeSounds(sounds) {
    this.new_layer("sounds");
    this.push(num(sounds.length, "sound count"));
    for (let i = 0; i < sounds.length; i++) {
      this.writeSound(sounds[i]);
    }
    this.pop_layer();
  }
  writeSound(sound) {
    this.new_layer("sound");
    this.push(flags(sound.flags));
    this.push(str(sound.name, "name"));
    this.push(str(sound.asset_id, "asset id"));
    this.push(num(sound.rate, "rate"));
    this.push(num(sound.sampleCount, "sample count"));
    if (sound.flags.customMd5Ext) this.push(str(sound.path, "path / md5ext"));
    this.pop_layer();
  }
  writeVariables(variables) {
    this.new_layer("variables");
    this.push(num(variables.length, "variable count"));
    for (let i = 0; i < variables.length; i++) {
      this.writeVariable(variables[i]);
    }
    this.pop_layer();
  }
  writeVariable(variable) {
    this.new_layer("variable");
    this.push(str(variable.id, "id"));
    this.push(str(variable.name, "name"));
    this.writeVariableValue(variable.value);
    this.pop_layer();
  }
  writeVariableValue(data) {
    this.push(num(convert_json_type_to_num(jsonTypeof(data)), "type"));
    switch (jsonTypeof(data)) {
      case "string": {
        this.push(str(data, "value"));
        break;
      }
      case "number": {
        this.push(num(data, "value"));
        break;
      }
      case "array": {
        this.new_layer("array value");
        this.push(num(data.length, "length"));
        for (let i = 0; i < data.length; i++) {
          this.writeVariableValue(data[i]);
        }
        this.pop_layer();
        break;
      }
    }
  }
  writeLists(lists) {
    this.new_layer("lists");
    this.push(num(lists.length, "list count"));
    for (let i = 0; i < lists.length; i++) {
      this.writeList(lists[i]);
    }
    this.pop_layer();
  }
  writeList(list) {
    this.new_layer("list");
    this.push(str(list.id, "id"));
    this.push(str(list.name, "name"));
    this.push(num(list.items.length, "length"));
    this.new_layer("items");
    for (let i = 0; i < list.items.length; i++) {
      this.writeListValue(list.items[i]);
    }
    this.pop_layer();
    this.pop_layer();
  }
  writeListValue(data) {
    this.new_layer("value");
    this.push(num(convert_json_type_to_num(jsonTypeof(data)), "type"));
    switch (jsonTypeof(data)) {
      case "string": {
        this.push(str(data, "value"));
        break;
      }
      case "number": {
        this.push(num(data, "value"));
        break;
      }
    }
    this.pop_layer();
  }
  // code
  writeBlocks(blocks) {
    this.new_layer("blocks");
    const values = Object.values(blocks);
    this.push(num(values.length, "block count"));
    for (let i = 0; i < values.length; i++) {
      this.writeBlock(values[i]);
    }
    this.pop_layer();
  }
  writeBlock(block) {
    this.new_layer("block");
    const block_flags = block.getFlags();
    this.push(flags(block_flags));
    this.push(str(block.id, "block id"));
    this.writeOpcode(block.opcode);
    if (block_flags.hasNext) this.writeId(block.next, "next");
    if (block_flags.hasParent) this.writeId(block.parent, "parent");
    if (block_flags.isToplevel) {
      this.push(num(block.x, "x"));
      this.push(num(block.y, "y"));
    }
    this.writeInputs(block.inputs);
    this.writeFields(block.fields);
    this.pop_layer();
  }
  writeInputs(inputs) {
    this.new_layer("inputs");
    this.push(num(inputs.length, "input count"));
    for (let i = 0; i < inputs.length; i++) {
      this.writeInput(inputs[i]);
    }
    this.pop_layer();
  }
  writeInput(input) {
    this.new_layer("input");
    const input_flags = input.getFlags();
    this.push(flags(input_flags));
    this.push(str(input.id, "input id"));
    if (input.data.type == "literal") {
      this.push(num(convert_literal_type_to_num(input.data.kind), "literal type"));
      this.writeLiteralValue(input.data.val);
    } else {
      this.writeId(input.data.block_id);
      if (input.data.type == "shadow") this.writeId(input.data.shadow_id, "shadow id");
    }
    this.pop_layer();
  }
  writeLiteralValue(data) {
    this.push(num(convert_json_type_to_num(jsonTypeof(data)), "type"));
    switch (jsonTypeof(data)) {
      case "string": {
        this.push(str(data, "value"));
        break;
      }
      case "number": {
        this.push(num(data, "value"));
        break;
      }
    }
  }
  writeFields(fields) {
    this.new_layer("fields");
    this.push(num(fields.length, "field count"));
    for (let i = 0; i < fields.length; i++) {
      this.writeField(fields[i]);
    }
    this.pop_layer();
  }
  writeField(field) {
    this.new_layer("field");
    this.push(str(field.name, "name"));
    this.push(bool(field.optional_id != null, "has optional id"));
    if (field.optional_id != null) this.push(str(field.optional_id, "optional id"));
    this.writeFieldValue(field.value);
    this.pop_layer();
  }
  writeFieldValue(data) {
    this.push(num(convert_json_type_to_num(jsonTypeof(data)), "type"));
    switch (jsonTypeof(data)) {
      case "string": {
        this.push(str(data, "value"));
        break;
      }
      case "number": {
        this.push(num(data, "value"));
        break;
      }
    }
  }
  writeBroadcasts(broadcasts) {
    const entries = Object.entries(broadcasts);
    this.new_layer("broadcasts");
    this.push(num(entries.length, "broadcast count"));
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      this.writeBroadcast(entry[0], entry[1]);
    }
    this.pop_layer();
  }
  writeBroadcast(broadcast_id, broadcast_name) {
    this.new_layer("broadcast");
    this.push(str(broadcast_id, "id"));
    this.push(str(broadcast_name, "name"));
    this.pop_layer();
  }
  writeComments(comments) {
    this.new_layer("comments");
    this.push(num(comments.length, "comments count"));
    for (let i = 0; i < comments.length; i++) {
      this.writeComment(comments[i]);
    }
    this.pop_layer();
  }
  writeComment(comment) {
    this.new_layer("comment");
    this.push(flags(comment.flags));
    this.push(str(comment.id, "id"));
    if (comment.flags.hasBlock) this.push(str(comment.block_id, "block id"));
    this.push(num(comment.x, "x"));
    this.push(num(comment.y, "y"));
    this.push(num(comment.width, "width"));
    this.push(num(comment.height, "height"));
    this.push(str(comment.text, "text"));
    this.pop_layer();
  }
  // utils
  writeOpcode(opcode) {
    this.push(str(opcode, "block opcode"));
  }
  writeId(id, comment = "block id") {
    this.push(str(id, comment));
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Block,
  BlockFlags,
  BooleanElement,
  Comment,
  CommentFlags,
  Costume,
  CostumeFlags,
  Element,
  Extension,
  Field,
  Flags,
  FlagsElement,
  Input,
  InputFlags,
  LabelElement,
  List,
  Monitor,
  MonitorFlags,
  NonStageTargetFlags,
  NumberElement,
  Project,
  ProjectMeta,
  Reader,
  Sound,
  SoundFlags,
  StageTargetFlags,
  StringElement,
  Target,
  Variable,
  Writer,
  bool,
  convert_json_type_to_num,
  convert_literal_type_to_num,
  convert_num_to_json_type,
  convert_num_to_literal_type,
  convert_num_to_rot_style,
  convert_num_to_video_state,
  convert_rot_style_to_num,
  convert_video_state_to_num,
  expectJsonType,
  flags,
  format,
  formatElement,
  formatElements,
  jsonTypeof,
  num,
  str
});
