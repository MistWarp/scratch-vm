/**
 * @fileoverview
 * Converts extension metadata into the scratch-blocks JSON and XML used for
 * the toolbox. Each function backs the Runtime method of the same name, which
 * has a leading underscore except for getBlocksXML and getBlocksJSON. Functions
 * that take a runtime call back into it for every step so that Runtime methods
 * replaced by addons are still used.
 */

const ArgumentType = require('./argument-type');
const BlockType = require('./block-type');
const TargetType = require('./target-type');
const ScratchBlocksConstants = require('../engine/scratch-blocks-constants');
const log = require('../util/log');
const maybeFormatMessage = require('../util/maybe-format-message');
const xmlEscape = require('../util/xml-escape');

const defaultExtensionColors = ['#0FBD8C', '#0DA57A', '#0B8E69'];

/**
 * Information used for converting Scratch argument types into scratch-blocks data.
 * @type {object.<ArgumentType, {shadowType: string, fieldType: string}>}
 */
const ArgumentTypeMap = (() => {
    const map = {};
    map[ArgumentType.ANGLE] = {
        shadow: {
            type: 'math_angle',
            // We specify fieldNames here so that we can pick
            // create and populate a field with the defaultValue
            // specified in the extension.
            // When the `fieldName` property is not specified,
            // the <field></field> will be left out of the XML and
            // the scratch-blocks defaults for that field will be
            // used instead (e.g. default of 0 for number fields)
            fieldName: 'NUM'
        }
    };
    map[ArgumentType.COLOR] = {
        shadow: {
            type: 'colour_picker',
            fieldName: 'COLOUR'
        }
    };
    map[ArgumentType.NUMBER] = {
        shadow: {
            type: 'math_number',
            fieldName: 'NUM'
        }
    };
    map[ArgumentType.STRING] = {
        shadow: {
            type: 'text',
            fieldName: 'TEXT'
        }
    };
    map[ArgumentType.BOOLEAN] = {
        check: 'Boolean'
    };
    map[ArgumentType.MATRIX] = {
        shadow: {
            type: 'matrix',
            fieldName: 'MATRIX'
        }
    };
    map[ArgumentType.NOTE] = {
        shadow: {
            type: 'note',
            fieldName: 'NOTE'
        }
    };
    map[ArgumentType.IMAGE] = {
        // Inline images are weird because they're not actually "arguments".
        // They are more analagous to the label on a block.
        fieldType: 'field_image'
    };
    map[ArgumentType.COSTUME] = {
        shadow: {
            type: 'looks_costume',
            fieldName: 'COSTUME'
        }
    };
    map[ArgumentType.SOUND] = {
        shadow: {
            type: 'sound_sounds_menu',
            fieldName: 'SOUND_MENU'
        }
    };
    return map;
})();

const makeExtensionMenuId = function (menuName, extensionId) {
    return `${extensionId}_menu_${menuName}`;
};

const fillExtensionCategoryHeader = function (categoryInfo, extensionInfo) {
    categoryInfo.name = maybeFormatMessage(extensionInfo.name);
    categoryInfo.showStatusButton = extensionInfo.showStatusButton;
    categoryInfo.blockIconURI = extensionInfo.blockIconURI;
    categoryInfo.menuIconURI = extensionInfo.menuIconURI;
    if (extensionInfo.color1) {
        categoryInfo.color1 = extensionInfo.color1;
        categoryInfo.color2 = extensionInfo.color2;
        categoryInfo.color3 = extensionInfo.color3;
    } else {
        categoryInfo.color1 = defaultExtensionColors[0];
        categoryInfo.color2 = defaultExtensionColors[1];
        categoryInfo.color3 = defaultExtensionColors[2];
    }
};

const fillExtensionCategory = function (runtime, categoryInfo, extensionInfo) {
    categoryInfo.blocks = [];
    categoryInfo.customFieldTypes = {};
    categoryInfo.menus = [];
    categoryInfo.menuInfo = {};

    for (const menuName in extensionInfo.menus) {
        if (Object.prototype.hasOwnProperty.call(extensionInfo.menus, menuName)) {
            const menuInfo = extensionInfo.menus[menuName];
            const convertedMenu = runtime._buildMenuForScratchBlocks(menuName, menuInfo, categoryInfo);
            categoryInfo.menus.push(convertedMenu);
            categoryInfo.menuInfo[menuName] = menuInfo;
        }
    }
    for (const fieldTypeName in extensionInfo.customFieldTypes) {
        if (Object.prototype.hasOwnProperty.call(extensionInfo.customFieldTypes, fieldTypeName)) {
            const fieldType = extensionInfo.customFieldTypes[fieldTypeName];
            const fieldTypeInfo = runtime._buildCustomFieldInfo(
                fieldTypeName,
                fieldType,
                extensionInfo.id,
                categoryInfo
            );

            categoryInfo.customFieldTypes[fieldTypeName] = fieldTypeInfo;
        }
    }

    if (extensionInfo.docsURI) {
        const xml = '<button ' +
            `text="${xmlEscape(maybeFormatMessage({
                id: 'tw.blocks.openDocs',
                default: 'Open Documentation',
                description: 'Button that opens site with more documentation about an extension'
            }))}" ` +
            'callbackKey="OPEN_EXTENSION_DOCS" ' +
            `callbackData="${xmlEscape(extensionInfo.docsURI)}"></button>`;
        const block = {
            info: {},
            xml
        };
        categoryInfo.blocks.push(block);
    }

    for (const blockInfo of extensionInfo.blocks) {
        try {
            const convertedBlock = runtime._convertForScratchBlocks(blockInfo, categoryInfo);
            categoryInfo.blocks.push(convertedBlock);
            if (convertedBlock.json) {
                const opcode = convertedBlock.json.type;
                if (blockInfo.blockType !== BlockType.EVENT) {
                    runtime._primitives[opcode] = convertedBlock.info.func;
                }
                if (blockInfo.blockType === BlockType.EVENT || blockInfo.blockType === BlockType.HAT) {
                    runtime._hats[opcode] = {
                        edgeActivated: blockInfo.isEdgeActivated,
                        restartExistingThreads: blockInfo.shouldRestartExistingThreads
                    };
                } else if (blockInfo.blockType === BlockType.CONDITIONAL) {
                    runtime._flowing[opcode] = {
                        conditional: true,
                        loop: false
                    };
                } else if (blockInfo.blockType === BlockType.LOOP) {
                    runtime._flowing[opcode] = {
                        conditional: false,
                        loop: true
                    };
                }
            }
        } catch (e) {
            log.error('Error parsing block: ', {block: blockInfo, error: e});
        }
    }
};

const convertMenuItems = function (runtime, menuItems) {
    if (typeof menuItems !== 'function') {
        const extensionMessageContext = runtime.makeMessageContextForTarget();
        return menuItems.map(item => {
            const formattedItem = maybeFormatMessage(item, extensionMessageContext);
            switch (typeof formattedItem) {
            case 'string':
                return [formattedItem, formattedItem];
            case 'object':
                return [maybeFormatMessage(item.text, extensionMessageContext), item.value];
            default:
                throw new Error(`Can't interpret menu item: ${JSON.stringify(item)}`);
            }
        });
    }
    return menuItems;
};

const buildMenuForScratchBlocks = function (runtime, menuName, menuInfo, categoryInfo) {
    const menuId = runtime._makeExtensionMenuId(menuName, categoryInfo.id);
    const menuItems = runtime._convertMenuItems(menuInfo.items);
    return {
        json: {
            message0: '%1',
            type: menuId,
            inputsInline: true,
            output: 'String',
            colour: categoryInfo.color1,
            colourSecondary: categoryInfo.color2,
            colourTertiary: categoryInfo.color3,
            outputShape: menuInfo.acceptReporters ?
                ScratchBlocksConstants.OUTPUT_SHAPE_ROUND : ScratchBlocksConstants.OUTPUT_SHAPE_SQUARE,
            args0: [
                {
                    type: 'field_dropdown',
                    name: menuName,
                    options: menuItems
                }
            ]
        }
    };
};

const buildCustomFieldInfo = function (runtime, fieldName, fieldInfo, extensionId, categoryInfo) {
    const extendedName = `${extensionId}_${fieldName}`;
    return {
        fieldName: fieldName,
        extendedName: extendedName,
        argumentTypeInfo: {
            shadow: {
                type: extendedName,
                fieldName: `field_${extendedName}`
            }
        },
        scratchBlocksDefinition: runtime._buildCustomFieldTypeForScratchBlocks(
            extendedName,
            fieldInfo.output,
            fieldInfo.outputShape,
            categoryInfo
        ),
        fieldImplementation: fieldInfo.implementation
    };
};

const buildCustomFieldTypeForScratchBlocks = function (fieldName, output, outputShape, categoryInfo) {
    return {
        json: {
            type: fieldName,
            message0: '%1',
            inputsInline: true,
            output: output,
            colour: categoryInfo.color1,
            colourSecondary: categoryInfo.color2,
            colourTertiary: categoryInfo.color3,
            outputShape: outputShape,
            args0: [
                {
                    name: `field_${fieldName}`,
                    type: `field_${fieldName}`
                }
            ]
        }
    };
};

const convertForScratchBlocks = function (runtime, blockInfo, categoryInfo) {
    if (blockInfo === '---') {
        return runtime._convertSeparatorForScratchBlocks(blockInfo);
    }

    if (blockInfo.blockType === BlockType.LABEL) {
        return runtime._convertLabelForScratchBlocks(blockInfo);
    }

    if (blockInfo.blockType === BlockType.BUTTON) {
        return runtime._convertButtonForScratchBlocks(blockInfo, categoryInfo);
    }

    if (blockInfo.blockType === BlockType.XML) {
        return runtime._convertXmlForScratchBlocks(blockInfo);
    }

    return runtime._convertBlockForScratchBlocks(blockInfo, categoryInfo);
};

const convertBlockForScratchBlocks = function (runtime, blockInfo, categoryInfo) {
    const extendedOpcode = `${categoryInfo.id}_${blockInfo.opcode}`;

    if (!blockInfo.color1) blockInfo.color1 = categoryInfo.color1;
    if (!blockInfo.color2) blockInfo.color2 = categoryInfo.color2;
    if (!blockInfo.color3) blockInfo.color3 = categoryInfo.color3;

    const blockJSON = {
        type: extendedOpcode,
        inputsInline: true,
        category: categoryInfo.name,
        extensions: [],
        colour: blockInfo.color1,
        colourSecondary: blockInfo.color2,
        colourTertiary: blockInfo.color3
    };

    if (blockInfo.code) {
        blockJSON.code = blockInfo.code;
    }

    const context = {
        // TODO: store this somewhere so that we can map args appropriately after translation.
        // This maps an arg name to its relative position in the original (usually English) block text.
        // When displaying a block in another language we'll need to run a `replace` action similar to the one
        // below, but each `[ARG]` will need to be replaced with the number in this map.
        argsMap: {},
        blockJSON,
        categoryInfo,
        blockInfo,
        inputList: []
    };

    // If an icon for the extension exists, prepend it to each block, with a vertical separator.
    // We can overspecify an icon for each block, but if no icon exists on a block, fall back to
    // the category block icon.
    const iconURI = blockInfo.blockIconURI || categoryInfo.blockIconURI;

    // All extension blocks have from_extension
    blockJSON.extensions.push('from_extension');

    // Allow easily detecting which blocks use default colors
    if (
        blockJSON.colour === defaultExtensionColors[0] &&
        blockJSON.colourSecondary === defaultExtensionColors[1] &&
        blockJSON.colourTertiary === defaultExtensionColors[2]
    ) {
        blockJSON.extensions.push('default_extension_colors');
    }

    if (iconURI) {
        // scratch_extension is a misleading name - this is for fixing the icon rendering
        blockJSON.extensions.push('scratch_extension');
        blockJSON.message0 = '%1 %2';
        const iconJSON = {
            type: 'field_image',
            src: iconURI,
            width: 40,
            height: 40
        };
        const separatorJSON = {
            type: 'field_vertical_separator'
        };
        blockJSON.args0 = [
            iconJSON,
            separatorJSON
        ];
    }

    switch (blockInfo.blockType) {
    case BlockType.COMMAND:
        blockJSON.outputShape = ScratchBlocksConstants.OUTPUT_SHAPE_SQUARE;
        blockJSON.previousStatement = null; // null = available connection; undefined = hat
        if (!blockInfo.isTerminal) {
            blockJSON.nextStatement = null; // null = available connection; undefined = terminal
        }
        break;
    case BlockType.REPORTER:
        blockJSON.output = blockInfo.allowDropAnywhere ? null : 'String'; // TODO: distinguish number & string here?
        blockJSON.outputShape = ScratchBlocksConstants.OUTPUT_SHAPE_ROUND;
        break;
    case BlockType.BOOLEAN:
        blockJSON.output = 'Boolean';
        blockJSON.outputShape = ScratchBlocksConstants.OUTPUT_SHAPE_HEXAGONAL;
        break;
    case BlockType.HAT:
    case BlockType.EVENT:
        if (!Object.prototype.hasOwnProperty.call(blockInfo, 'isEdgeActivated')) {
            // if absent, this property defaults to true
            blockInfo.isEdgeActivated = true;
        }
        blockJSON.outputShape = ScratchBlocksConstants.OUTPUT_SHAPE_SQUARE;
        blockJSON.nextStatement = null; // null = available connection; undefined = terminal
        break;
    case BlockType.CONDITIONAL:
    case BlockType.LOOP:
        blockInfo.branchCount = blockInfo.branchCount || 1;
        blockJSON.outputShape = ScratchBlocksConstants.OUTPUT_SHAPE_SQUARE;
        blockJSON.previousStatement = null; // null = available connection; undefined = hat
        if (!blockInfo.isTerminal) {
            blockJSON.nextStatement = null; // null = available connection; undefined = terminal
        }
        break;
    }

    // Allow extensiosn to override outputShape
    if (blockInfo.blockShape) {
        blockJSON.outputShape = blockInfo.blockShape;
    }

    const blockText = Array.isArray(blockInfo.text) ? blockInfo.text : [blockInfo.text];
    let inTextNum = 0; // text for the next block "arm" is blockText[inTextNum]
    let inBranchNum = 0; // how many branches have we placed into the JSON so far?
    let outLineNum = 0; // used for scratch-blocks `message${outLineNum}` and `args${outLineNum}`
    const convertPlaceholders = runtime._convertPlaceholders.bind(runtime, context);
    const extensionMessageContext = runtime.makeMessageContextForTarget();

    // alternate between a block "arm" with text on it and an open slot for a substack
    while (inTextNum < blockText.length || inBranchNum < blockInfo.branchCount) {
        if (inTextNum < blockText.length) {
            context.outLineNum = outLineNum;
            const lineText = maybeFormatMessage(blockText[inTextNum], extensionMessageContext);
            const convertedText = lineText.replace(/\[(.+?)]/g, convertPlaceholders);
            if (blockJSON[`message${outLineNum}`]) {
                blockJSON[`message${outLineNum}`] += convertedText;
            } else {
                blockJSON[`message${outLineNum}`] = convertedText;
            }
            ++inTextNum;
            ++outLineNum;
        }
        if (inBranchNum < blockInfo.branchCount) {
            blockJSON[`message${outLineNum}`] = '%1';
            blockJSON[`args${outLineNum}`] = [{
                type: 'input_statement',
                name: `SUBSTACK${inBranchNum > 0 ? inBranchNum + 1 : ''}`
            }];
            ++inBranchNum;
            ++outLineNum;
        }
    }

    if (blockInfo.blockType === BlockType.REPORTER || blockInfo.blockType === BlockType.BOOLEAN) {
        if (!blockInfo.disableMonitor && context.inputList.length === 0) {
            blockJSON.checkboxInFlyout = true;
        }
    } else if (
        blockInfo.branchIconURI || (
            blockInfo.blockType === BlockType.LOOP &&
            !Object.prototype.hasOwnProperty.call(blockInfo, 'branchIconURI')
        )
    ) {
        // Add icon to the bottom right of a loop block

        if (!blockInfo.branchIconURI) blockInfo.branchIconURI = 'media://repeat.svg';

        blockJSON[`lastDummyAlign${outLineNum}`] = 'RIGHT';
        blockJSON[`message${outLineNum}`] = '%1';
        blockJSON[`args${outLineNum}`] = [{
            type: 'field_image',
            src: blockInfo.branchIconURI,
            width: 24,
            height: 24,
            alt: '*', // TODO remove this since we don't use collapsed blocks in scratch
            flip_rtl: true
        }];
        ++outLineNum;
    }

    const mutation = blockInfo.isDynamic ? `<mutation blockInfo="${xmlEscape(JSON.stringify(blockInfo))}"/>` : '';
    const inputs = context.inputList.join('');
    const blockXML = `<block type="${xmlEscape(extendedOpcode)}">${mutation}${inputs}</block>`;

    if (blockInfo.extensions) {
        for (const extension of blockInfo.extensions) {
            if (!blockJSON.extensions.includes(extension)) {
                blockJSON.extensions.push(extension);
            }
        }
    }

    return {
        info: context.blockInfo,
        json: context.blockJSON,
        xml: blockXML
    };
};

const convertSeparatorForScratchBlocks = function (blockInfo) {
    return {
        info: blockInfo,
        xml: '<sep gap="36"/>'
    };
};

const convertLabelForScratchBlocks = function (blockInfo) {
    return {
        info: blockInfo,
        xml: `<label text="${xmlEscape(blockInfo.text)}"></label>`
    };
};

const convertButtonForScratchBlocks = function (runtime, buttonInfo, categoryInfo) {
    const extensionMessageContext = runtime.makeMessageContextForTarget();
    const buttonText = maybeFormatMessage(buttonInfo.text, extensionMessageContext);
    const nativeCallbackKeys = ['MAKE_A_LIST', 'MAKE_A_PROCEDURE', 'MAKE_A_VARIABLE'];
    if (nativeCallbackKeys.includes(buttonInfo.func)) {
        return {
            info: buttonInfo,
            xml: `<button text="${xmlEscape(buttonText)}" callbackKey="${xmlEscape(buttonInfo.func)}"></button>`
        };
    }
    // Callbacks with data will be forwarded from GUI
    const id = `${categoryInfo.id}_${buttonInfo.func}`;
    // callFunc is set by extension manager
    runtime.extensionButtons.set(id, buttonInfo.callFunc);
    return {
        info: buttonInfo,
        xml: `<button text="${xmlEscape(buttonText)}"` +
            ' callbackKey="EXTENSION_CALLBACK"' +
            ` callbackData="${xmlEscape(id)}"></button>`
    };
};

const convertXmlForScratchBlocks = function (xmlInfo) {
    return {
        info: xmlInfo,
        xml: xmlInfo.xml
    };
};

const constructInlineImageJson = function (argInfo) {
    if (!argInfo.dataURI) {
        log.warn('Missing data URI in extension block with argument type IMAGE');
    }
    return {
        type: 'field_image',
        src: argInfo.dataURI || '',
        // TODO these probably shouldn't be hardcoded...?
        width: 24,
        height: 24,
        // Whether or not the inline image should be flipped horizontally
        // in RTL languages. Defaults to false, indicating that the
        // image will not be flipped.
        flip_rtl: argInfo.flipRTL || false
    };
};

const convertPlaceholders = function (runtime, context, match, placeholder) {
    // Determine whether the argument type is one of the known standard field types
    const argInfo = context.blockInfo.arguments[placeholder] || {};
    let argTypeInfo = ArgumentTypeMap[argInfo.type] || {};

    // Field type not a standard field type, see if extension has registered custom field type
    if (!ArgumentTypeMap[argInfo.type] && context.categoryInfo.customFieldTypes[argInfo.type]) {
        argTypeInfo = context.categoryInfo.customFieldTypes[argInfo.type].argumentTypeInfo;
    }

    // Start to construct the scratch-blocks style JSON defining how the block should be
    // laid out
    let argJSON;

    // Most field types are inputs (slots on the block that can have other blocks plugged into them)
    // check if this is not one of those cases. E.g. an inline image on a block.
    if (argTypeInfo.fieldType === 'field_image') {
        argJSON = runtime._constructInlineImageJson(argInfo);
    } else {
        // Construct input value

        // Layout a block argument (e.g. an input slot on the block)
        argJSON = {
            type: 'input_value',
            name: placeholder
        };

        const defaultValue =
            typeof argInfo.defaultValue === 'undefined' ? null :
                maybeFormatMessage(argInfo.defaultValue, runtime.makeMessageContextForTarget()).toString();

        if (argTypeInfo.check) {
            // Right now the only type of 'check' we have specifies that the
            // input slot on the block accepts Boolean reporters, so it should be
            // shaped like a hexagon
            argJSON.check = argTypeInfo.check;
        }

        let valueName;
        let shadowType;
        let fieldName;
        if (argInfo.menu) {
            const menuInfo = context.categoryInfo.menuInfo[argInfo.menu];
            if (menuInfo.acceptReporters) {
                valueName = placeholder;
                shadowType = runtime._makeExtensionMenuId(argInfo.menu, context.categoryInfo.id);
                fieldName = argInfo.menu;
            } else {
                argJSON.type = 'field_dropdown';
                argJSON.options = runtime._convertMenuItems(menuInfo.items);
                valueName = null;
                shadowType = null;
                fieldName = placeholder;
            }
        } else {
            valueName = placeholder;
            shadowType = (argTypeInfo.shadow && argTypeInfo.shadow.type) || null;
            fieldName = (argTypeInfo.shadow && argTypeInfo.shadow.fieldName) || null;
        }

        // <value> is the ScratchBlocks name for a block input.
        if (valueName) {
            context.inputList.push(`<value name="${xmlEscape(placeholder)}">`);
        }

        // The <shadow> is a placeholder for a reporter and is visible when there's no reporter in this input.
        // Boolean inputs don't need to specify a shadow in the XML.
        if (shadowType) {
            context.inputList.push(`<shadow type="${xmlEscape(shadowType)}">`);
        }

        // A <field> displays a dynamic value: a user-editable text field, a drop-down menu, etc.
        // Leave out the field if defaultValue or fieldName are not specified
        if (defaultValue !== null && fieldName) {
            context.inputList.push(`<field name="${xmlEscape(fieldName)}">${xmlEscape(defaultValue)}</field>`);
        }

        if (shadowType) {
            context.inputList.push('</shadow>');
        }

        if (valueName) {
            context.inputList.push('</value>');
        }
    }

    const argsName = `args${context.outLineNum}`;
    const blockArgs = (context.blockJSON[argsName] = context.blockJSON[argsName] || []);
    if (argJSON) blockArgs.push(argJSON);
    const argNum = blockArgs.length;
    context.argsMap[placeholder] = argNum;

    return `%${argNum}`;
};

const getBlocksXML = function (categories, target) {
    return categories.map(categoryInfo => {
        const {name, color1, color2} = categoryInfo;
        // Filter out blocks that aren't supposed to be shown on this target, as determined by the block info's
        // `hideFromPalette` and `filter` properties.
        const paletteBlocks = categoryInfo.blocks.filter(block => {
            let blockFilterIncludesTarget = true;
            // If an editing target is not passed, include all blocks
            // If the block info doesn't include a `filter` property, always include it
            if (target && block.info.filter) {
                blockFilterIncludesTarget = block.info.filter.includes(
                    target.isStage ? TargetType.STAGE : TargetType.SPRITE
                );
            }
            // If the block info's `hideFromPalette` is true, then filter out this block
            return blockFilterIncludesTarget && !block.info.hideFromPalette;
        });

        const colorXML = `colour="${xmlEscape(color1)}" secondaryColour="${xmlEscape(color2)}"`;

        // Use a menu icon if there is one. Otherwise, use the block icon. If there's no icon,
        // the category menu will show its default colored circle.
        let menuIconURI = '';
        if (categoryInfo.menuIconURI) {
            menuIconURI = categoryInfo.menuIconURI;
        } else if (categoryInfo.blockIconURI) {
            menuIconURI = categoryInfo.blockIconURI;
        }
        const menuIconXML = menuIconURI ?
            `iconURI="${xmlEscape(menuIconURI)}"` : '';

        let statusButtonXML = '';
        if (categoryInfo.showStatusButton) {
            statusButtonXML = 'showStatusButton="true"';
        }

        let xml = `<category name="${xmlEscape(name)}"`;
        xml += ` id="${xmlEscape(categoryInfo.id)}"`;
        xml += ` ${statusButtonXML}`;
        xml += ` ${colorXML}`;
        xml += ` ${menuIconXML}>`;
        xml += paletteBlocks.map(block => block.xml).join('');
        xml += '</category>';

        return {
            id: categoryInfo.id,
            xml
        };
    });
};

const getBlocksJSON = function (categories) {
    return categories.reduce(
        (result, categoryInfo) => result.concat(categoryInfo.blocks.map(blockInfo => blockInfo.json)), []);
};

module.exports = {
    defaultExtensionColors,
    ArgumentTypeMap,
    makeExtensionMenuId,
    fillExtensionCategoryHeader,
    fillExtensionCategory,
    convertMenuItems,
    buildMenuForScratchBlocks,
    buildCustomFieldInfo,
    buildCustomFieldTypeForScratchBlocks,
    convertForScratchBlocks,
    convertBlockForScratchBlocks,
    convertSeparatorForScratchBlocks,
    convertLabelForScratchBlocks,
    convertButtonForScratchBlocks,
    convertXmlForScratchBlocks,
    constructInlineImageJson,
    convertPlaceholders,
    getBlocksXML,
    getBlocksJSON
};
