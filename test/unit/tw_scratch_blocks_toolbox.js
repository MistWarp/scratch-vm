const fs = require('fs');
const path = require('path');
const tap = require('tap');
const Runtime = require('../../src/engine/runtime');
const ArgumentType = require('../../src/extension-support/argument-type');
const BlockType = require('../../src/extension-support/block-type');
const TargetType = require('../../src/extension-support/target-type');

const SNAPSHOT_PATH = path.join(__dirname, '../fixtures/toolbox/scratch-blocks-toolbox.json');

const makeInfos = () => [
    {
        id: 'toolboxtest',
        name: 'Toolbox Test',
        blockIconURI: 'data:image/png;base64,AAAA',
        menuIconURI: 'data:image/png;base64,BBBB',
        showStatusButton: true,
        docsURI: 'https://example.com/docs?a=1&b=2',
        menus: {
            staticMenu: {items: ['one', {text: 'Two', value: '2'}]},
            reporterMenu: {acceptReporters: true, items: ['a', 'b']},
            dynamicMenu: {items: () => [['x', 'x']]}
        },
        customFieldTypes: {
            fancy: {output: 'String', outputShape: 2, implementation: {fromJson: () => null}}
        },
        blocks: [
            {
                opcode: 'command',
                blockType: BlockType.COMMAND,
                text: 'move [STEPS] steps to [WHERE] & [MENU]',
                arguments: {
                    STEPS: {type: ArgumentType.NUMBER, defaultValue: 10},
                    WHERE: {type: ArgumentType.STRING, menu: 'reporterMenu', defaultValue: 'a'},
                    MENU: {type: ArgumentType.STRING, menu: 'staticMenu', defaultValue: 'one'}
                }
            },
            '---',
            {
                opcode: 'reporter',
                blockType: BlockType.REPORTER,
                text: 'value of [COLOR] [ANGLE] [NOTE] [MATRIX]',
                arguments: {
                    COLOR: {type: ArgumentType.COLOR, defaultValue: '#ff0000'},
                    ANGLE: {type: ArgumentType.ANGLE, defaultValue: 90},
                    NOTE: {type: ArgumentType.NOTE, defaultValue: 60},
                    MATRIX: {type: ArgumentType.MATRIX, defaultValue: '1010101010101010101010101'}
                }
            },
            {
                opcode: 'plainReporter',
                blockType: BlockType.REPORTER,
                text: 'plain',
                allowDropAnywhere: true,
                filter: [TargetType.SPRITE]
            },
            {
                opcode: 'bool',
                blockType: BlockType.BOOLEAN,
                text: 'is [B] and [FANCY]',
                arguments: {
                    B: {type: ArgumentType.BOOLEAN},
                    FANCY: {type: 'fancy', defaultValue: 'f'}
                },
                disableMonitor: true
            },
            {
                opcode: 'hat',
                blockType: BlockType.HAT,
                text: 'when [IMG] happens',
                arguments: {
                    IMG: {type: ArgumentType.IMAGE, dataURI: 'data:image/png;base64,CCCC', flipRTL: true}
                }
            },
            {
                opcode: 'event',
                blockType: BlockType.EVENT,
                text: 'when event',
                isEdgeActivated: false,
                shouldRestartExistingThreads: true
            },
            {
                opcode: 'ifElse',
                blockType: BlockType.CONDITIONAL,
                text: ['if [C] then', 'else'],
                branchCount: 2,
                arguments: {C: {type: ArgumentType.BOOLEAN}}
            },
            {
                opcode: 'forever',
                blockType: BlockType.LOOP,
                text: 'forever',
                isTerminal: true
            },
            {
                opcode: 'loopWithIcon',
                blockType: BlockType.LOOP,
                text: 'loop',
                branchIconURI: 'data:image/svg+xml;base64,DDDD'
            },
            {
                opcode: 'dynamic',
                blockType: BlockType.COMMAND,
                text: 'dynamic [X]',
                isDynamic: true,
                arguments: {X: {type: ArgumentType.STRING, defaultValue: {id: 'test.default', default: 'hi'}}},
                extensions: ['custom_extension', 'from_extension'],
                blockShape: 3,
                color1: '#111111',
                color2: '#222222',
                color3: '#333333',
                blockIconURI: 'data:image/png;base64,EEEE'
            },
            {
                opcode: 'hidden',
                blockType: BlockType.COMMAND,
                text: 'hidden',
                hideFromPalette: true
            },
            {
                opcode: 'stageOnly',
                blockType: BlockType.COMMAND,
                text: 'stage only',
                filter: [TargetType.STAGE],
                isTerminal: true
            },
            {blockType: BlockType.LABEL, text: 'A <label> & more'},
            {blockType: BlockType.BUTTON, text: 'Make a Variable', func: 'MAKE_A_VARIABLE'},
            {blockType: BlockType.BUTTON, text: 'Press me', func: 'press', callFunc: () => {}},
            {blockType: BlockType.XML, xml: '<sep gap="10"/>'}
        ]
    },
    {
        id: 'plaincolors',
        name: {id: 'plaincolors.name', default: 'Plain Colors'},
        color1: '#abcdef',
        color2: '#123456',
        color3: '#654321',
        blocks: [
            {
                opcode: 'say',
                blockType: BlockType.COMMAND,
                text: 'say [MESSAGE]',
                arguments: {MESSAGE: {type: ArgumentType.STRING, defaultValue: 'Hello <world> & "you"'}}
            }
        ]
    }
];

const capture = () => {
    const runtime = new Runtime();
    const events = [];
    for (const name of ['EXTENSION_ADDED', 'EXTENSION_FIELD_ADDED', 'BLOCKSINFO_UPDATE']) {
        runtime.on(Runtime[name], data => events.push([name, JSON.parse(JSON.stringify(data))]));
    }
    const [first, second] = makeInfos();
    runtime._registerExtensionPrimitives(first);
    runtime._registerExtensionPrimitives(second);
    const refreshed = makeInfos()[1];
    refreshed.name = 'Renamed';
    runtime._refreshExtensionPrimitives(refreshed);
    runtime._refreshExtensionPrimitives(makeInfos()[1], true);
    const pick = (object, prefix) => Object.keys(object).filter(key => key.startsWith(prefix))
        .reduce((result, key) => {
            result[key] = object[key];
            return result;
        }, {});
    return JSON.parse(JSON.stringify({
        xml: runtime.getBlocksXML(),
        xmlForStage: runtime.getBlocksXML({isStage: true}),
        xmlForSprite: runtime.getBlocksXML({isStage: false}),
        json: runtime.getBlocksJSON(),
        hats: pick(runtime._hats, 'toolboxtest_'),
        flowing: pick(runtime._flowing, 'toolboxtest_'),
        primitives: Object.keys(runtime._primitives).filter(key => key.startsWith('toolboxtest_')),
        extensionButtons: Array.from(runtime.extensionButtons.keys()),
        menuId: runtime._makeExtensionMenuId('menu', 'ext'),
        inlineImage: runtime._constructInlineImageJson({}),
        customFieldType: runtime._buildCustomFieldTypeForScratchBlocks('ext_field', 'Number', 1, {
            color1: '#1', color2: '#2', color3: '#3'
        }),
        menuItems: runtime._convertMenuItems(['a', {text: 'B', value: 'b'}]),
        events
    }));
};

tap.test('extension metadata converts to the same scratch-blocks XML and JSON', t => {
    const actual = capture();
    if (process.env.UPDATE_TOOLBOX_SNAPSHOT) {
        fs.writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(actual, null, 2)}\n`);
    }
    const expected = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
    t.same(actual, expected);
    t.end();
});

tap.test('conversion goes through Runtime methods that can be replaced', t => {
    const runtime = new Runtime();
    const calls = [];
    const originalBlock = runtime._convertBlockForScratchBlocks;
    runtime._convertBlockForScratchBlocks = function (blockInfo, categoryInfo) {
        calls.push(`block:${blockInfo.opcode}`);
        return originalBlock.call(this, blockInfo, categoryInfo);
    };
    const originalPlaceholders = runtime._convertPlaceholders;
    runtime._convertPlaceholders = function (context, match, placeholder) {
        calls.push(`arg:${placeholder}`);
        return originalPlaceholders.call(this, context, match, placeholder);
    };
    runtime._makeExtensionMenuId = (menuName, extensionId) => `${extensionId}__${menuName}`;
    runtime.makeMessageContextForTarget = () => ({targetType: 'custom'});
    let category = null;
    runtime.on(Runtime.EXTENSION_ADDED, data => {
        category = data;
    });
    runtime._registerExtensionPrimitives(makeInfos()[0]);
    t.ok(calls.includes('block:command'));
    t.ok(calls.includes('arg:STEPS'));
    t.ok(runtime.getBlocksXML()[0].xml.includes('<shadow type="toolboxtest__reporterMenu">'));
    t.ok(category.menus.some(menu => menu.json.type === 'toolboxtest__staticMenu'));
    t.end();
});

tap.test('toolbox methods stay writable prototype methods', t => {
    for (const name of [
        '_makeExtensionMenuId', '_fillExtensionCategoryHeader', '_fillExtensionCategory', '_convertMenuItems',
        '_buildMenuForScratchBlocks', '_buildCustomFieldInfo', '_buildCustomFieldTypeForScratchBlocks',
        '_convertForScratchBlocks', '_convertBlockForScratchBlocks', '_convertSeparatorForScratchBlocks',
        '_convertLabelForScratchBlocks', '_convertButtonForScratchBlocks', '_convertXmlForScratchBlocks',
        '_constructInlineImageJson', '_convertPlaceholders', 'getBlocksXML', 'getBlocksJSON'
    ]) {
        const descriptor = Object.getOwnPropertyDescriptor(Runtime.prototype, name);
        t.type(descriptor.value, 'function', name);
        t.ok(descriptor.writable, `${name} is writable`);
    }
    t.end();
});
