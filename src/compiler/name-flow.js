const NAME_INPUTS = new Map([
    ['looks_switchcostumeto', 'COSTUME'],
    ['looks_switchbackdropto', 'BACKDROP'],
    ['looks_switchbackdroptoandwait', 'BACKDROP'],
    ['sound_play', 'SOUND_MENU'],
    ['sound_playuntildone', 'SOUND_MENU'],
    ['sensing_keypressed', 'KEY_OPTION']
]);

const STORES = new Map([
    ['data_setvariableto', ['VARIABLE', 'VALUE', '']],
    ['data_addtolist', ['LIST', 'ITEM', 'list']],
    ['data_insertatlist', ['LIST', 'ITEM', 'list']],
    ['data_replaceitemoflist', ['LIST', 'ITEM', 'list']]
]);

const CONSTANT_FIELDS = new Map([
    ['text', 'TEXT'],
    ['math_number', 'NUM'],
    ['math_integer', 'NUM'],
    ['math_whole_number', 'NUM'],
    ['math_positive_number', 'NUM'],
    ['math_angle', 'NUM']
]);

const PLAIN_OPCODES = new Set([
    'motion_movesteps', 'motion_turnright', 'motion_turnleft', 'motion_goto', 'motion_goto_menu',
    'motion_gotoxy', 'motion_glideto', 'motion_glideto_menu', 'motion_glidesecstoxy',
    'motion_pointindirection', 'motion_pointtowards', 'motion_pointtowards_menu', 'motion_changexby',
    'motion_setx', 'motion_changeyby', 'motion_sety', 'motion_ifonedgebounce', 'motion_setrotationstyle',
    'motion_xposition', 'motion_yposition', 'motion_direction', 'motion_scroll_right', 'motion_scroll_up',
    'motion_align_scene', 'motion_xscroll', 'motion_yscroll',
    'looks_sayforsecs', 'looks_say', 'looks_thinkforsecs', 'looks_think', 'looks_show', 'looks_hide',
    'looks_nextcostume', 'looks_nextbackdrop', 'looks_changeeffectby', 'looks_seteffectto',
    'looks_cleargraphiceffects', 'looks_changesizeby', 'looks_setsizeto', 'looks_gotofrontback',
    'looks_goforwardbackwardlayers', 'looks_costumenumbername', 'looks_backdropnumbername', 'looks_size',
    'looks_costume', 'looks_backdrops', 'looks_hideallsprites', 'looks_changestretchby', 'looks_setstretchto',
    'sound_stopallsounds', 'sound_changeeffectby', 'sound_seteffectto', 'sound_cleareffects',
    'sound_changevolumeby', 'sound_setvolumeto', 'sound_volume', 'sound_sounds_menu',
    'event_whenflagclicked', 'event_whenkeypressed', 'event_whenthisspriteclicked', 'event_whenstageclicked',
    'event_whenbackdropswitchesto', 'event_whengreaterthan', 'event_whenbroadcastreceived', 'event_broadcast',
    'event_broadcastandwait', 'event_broadcast_menu', 'event_whentouchingobject', 'event_touchingobjectmenu',
    'control_wait', 'control_repeat', 'control_forever', 'control_if', 'control_if_else', 'control_wait_until',
    'control_repeat_until', 'control_while', 'control_for_each', 'control_stop', 'control_start_as_clone',
    'control_create_clone_of', 'control_create_clone_of_menu', 'control_delete_this_clone',
    'control_all_at_once', 'control_get_counter', 'control_incr_counter', 'control_clear_counter',
    'sensing_touchingobject', 'sensing_touchingobjectmenu', 'sensing_touchingcolor',
    'sensing_coloristouchingcolor', 'sensing_distanceto', 'sensing_distancetomenu', 'sensing_askandwait',
    'sensing_answer', 'sensing_keyoptions', 'sensing_mousedown', 'sensing_mousex', 'sensing_mousey',
    'sensing_setdragmode', 'sensing_loudness', 'sensing_loud', 'sensing_timer', 'sensing_resettimer',
    'sensing_of', 'sensing_of_object_menu', 'sensing_current', 'sensing_dayssince2000', 'sensing_username',
    'sensing_userid', 'sensing_online',
    'operator_add', 'operator_subtract', 'operator_multiply', 'operator_divide', 'operator_random',
    'operator_gt', 'operator_lt', 'operator_equals', 'operator_and', 'operator_or', 'operator_not',
    'operator_join', 'operator_letter_of', 'operator_length', 'operator_contains', 'operator_mod',
    'operator_round', 'operator_mathop',
    'data_variable', 'data_changevariableby', 'data_showvariable', 'data_hidevariable', 'data_listcontents',
    'data_deleteoflist', 'data_deletealloflist', 'data_itemoflist', 'data_itemnumoflist',
    'data_lengthoflist', 'data_listcontainsitem', 'data_showlist', 'data_hidelist', 'data_listindexall',
    'data_listindexrandom',
    'procedures_definition', 'procedures_prototype', 'argument_reporter_string_number',
    'argument_reporter_boolean',
    'pen_clear', 'pen_stamp', 'pen_penDown', 'pen_penUp', 'pen_setPenColorToColor',
    'pen_changePenColorParamBy', 'pen_setPenColorParamTo', 'pen_changePenSizeBy', 'pen_setPenSizeTo',
    'pen_setPenShadeToNumber', 'pen_changePenShadeBy', 'pen_setPenHueToNumber', 'pen_changePenHueBy',
    'pen_menu_colorParam',
    'text', 'math_number', 'math_integer', 'math_whole_number', 'math_positive_number', 'math_angle',
    'colour_picker', 'note', 'matrix'
]);

const WHOLE_NUMBER = /^-?\d+$/;

const ANYTHING = '*';

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const variableKeyOf = id => `i:${id}`;

const nameKeyOf = name => `n:${name}`;

const storeKeyOf = (field, variable) => (variable.id === field.id ? variableKeyOf(field.id) : true);

const argumentKeyOf = (procedureCode, name) => `a:${procedureCode}\n${name}`;

const returnKeyOf = procedureCode => `r:${procedureCode}`;

const findVariableByName = (variables, name, type) => {
    for (const id in variables) {
        if (!hasOwn(variables, id)) continue;
        const variable = variables[id];
        if (variable.name === name && variable.type === type) return variable;
    }
    return null;
};

const findVariable = (target, stage, field, type) => {
    const id = field.id;
    if (hasOwn(target.variables, id)) return target.variables[String(id)];
    const otherStage = stage && stage !== target ? stage : null;
    if (otherStage && hasOwn(otherStage.variables, id)) return otherStage.variables[String(id)];
    return findVariableByName(target.variables, field.value, type) ||
        (otherStage && findVariableByName(otherStage.variables, field.value, type));
};

const addFieldKeys = (target, stage, field, type, out) => {
    if (!field) return null;
    const variable = findVariable(target, stage, field, type);
    out.push(variableKeyOf(field.id));
    if (variable && variable.id !== field.id) out.push(variableKeyOf(variable.id));
    return variable;
};

const addSources = (target, stage, block, procedureCode, out) => {
    switch (block.opcode) {
    case 'data_variable':
        addFieldKeys(target, stage, block.fields.VARIABLE, '', out);
        break;
    case 'data_itemoflist':
        addFieldKeys(target, stage, block.fields.LIST, 'list', out);
        break;
    case 'argument_reporter_string_number':
        if (procedureCode !== null && block.fields.VALUE) {
            out.push(argumentKeyOf(procedureCode, block.fields.VALUE.value));
        }
        break;
    case 'procedures_call':
        if (block.mutation) out.push(returnKeyOf(block.mutation.proccode));
        break;
    case 'sensing_of':
        if (block.fields.PROPERTY) out.push(nameKeyOf(block.fields.PROPERTY.value));
        break;
    default:
        if (!block.shadow && !PLAIN_OPCODES.has(block.opcode) && !NAME_INPUTS.has(block.opcode)) out.push(ANYTHING);
    }
};

const summarize = (runtime, target, stage) => {
    const container = target.blocks;
    const blocks = container._blocks;
    const sinks = [];
    const flows = [];
    let procedureCode = null;

    const sourcesOf = (block, inputName) => {
        const out = [];
        const input = block.inputs[inputName];
        const child = input && blocks[input.block];
        if (child) addSources(target, stage, child, procedureCode, out);
        return out;
    };

    const flowInto = (key, block, inputName) => {
        for (const source of sourcesOf(block, inputName)) flows.push(key, source);
    };

    const storeInto = (block, fieldName, inputName, type) => {
        const field = block.fields[fieldName];
        const keys = [];
        const variable = addFieldKeys(target, stage, field, type, keys);
        if (keys.length === 0) return;
        const nameKey = nameKeyOf(variable ? variable.name : field.value);
        const sources = sourcesOf(block, inputName);
        for (const key of keys) {
            flows.push(nameKey, key);
            if (variable && variable.isCloud) sinks.push(key);
            for (const source of sources) flows.push(key, source);
        }
    };

    const sinkEverything = block => {
        for (const inputName in block.inputs) {
            if (!hasOwn(block.inputs, inputName)) continue;
            for (const source of sourcesOf(block, inputName)) {
                if (source !== ANYTHING) sinks.push(source);
            }
            const child = blocks[block.inputs[inputName].block];
            const constantField = child && CONSTANT_FIELDS.get(child.opcode);
            if (constantField && child.fields[constantField]) {
                sinks.push(nameKeyOf(child.fields[constantField].value));
            }
        }
        for (const fieldName in block.fields) {
            if (!hasOwn(block.fields, fieldName)) continue;
            const field = block.fields[fieldName];
            sinks.push(nameKeyOf(field.value));
            if (field.id) {
                addFieldKeys(target, stage, field, '', sinks);
                addFieldKeys(target, stage, field, 'list', sinks);
            }
        }
    };

    const visit = block => {
        const opcode = block.opcode;

        const store = STORES.get(opcode);
        if (store) {
            storeInto(block, store[0], store[1], store[2]);
            return;
        }

        const nameInput = NAME_INPUTS.get(opcode);
        if (nameInput) {
            for (const source of sourcesOf(block, nameInput)) sinks.push(source);
            return;
        }

        if (opcode === 'procedures_call') {
            const calledCode = block.mutation && block.mutation.proccode;
            const parameters = container.getProcedureParamNamesIdsAndDefaults(calledCode);
            if (!parameters) return;
            if (runtime.getAddonBlock(calledCode)) {
                sinkEverything(block);
                return;
            }
            const [names, ids] = parameters;
            for (let i = 0; i < ids.length; i++) {
                flowInto(argumentKeyOf(calledCode, names[i]), block, ids[i]);
            }
            return;
        }

        if (opcode === 'procedures_return') {
            if (procedureCode !== null) flowInto(returnKeyOf(procedureCode), block, 'VALUE');
            return;
        }

        if (!PLAIN_OPCODES.has(opcode)) sinkEverything(block);
    };

    container.populateProcedureCache();

    const visited = new Set();
    const pending = [];
    const walk = topId => {
        const top = blocks[topId];
        if (!top || visited.has(topId)) return;
        procedureCode = null;
        if (top.opcode === 'procedures_definition' && top.inputs.custom_block) {
            const prototype = blocks[top.inputs.custom_block.block];
            if (prototype && prototype.mutation) procedureCode = prototype.mutation.proccode;
        }
        pending.push(topId);
        while (pending.length > 0) {
            const id = pending.pop();
            const block = blocks[id];
            if (!block || visited.has(id)) continue;
            visited.add(id);
            visit(block);
            if (block.next) pending.push(block.next);
            for (const inputName in block.inputs) {
                if (!hasOwn(block.inputs, inputName)) continue;
                const childId = block.inputs[inputName].block;
                if (childId) pending.push(childId);
            }
        }
    };

    for (const topId of container._scripts) walk(topId);
    for (const id in blocks) {
        if (hasOwn(blocks, id) && blocks[id].opcode === 'procedures_definition') walk(id);
    }
    for (const id in blocks) {
        if (hasOwn(blocks, id)) walk(id);
    }

    return {sinks, flows, declarations: target.declRevision, stageDeclarations: stage ? stage.declRevision : 0};
};

const solve = summaries => {
    const incoming = new Map();
    const pending = [];
    for (const {sinks, flows} of summaries) {
        for (const key of sinks) pending.push(key);
        for (let i = 0; i < flows.length; i += 2) {
            const sources = incoming.get(flows[i]);
            if (sources) {
                sources.push(flows[i + 1]);
            } else {
                incoming.set(flows[i], [flows[i + 1]]);
            }
        }
    }

    const reached = new Set();
    while (pending.length > 0) {
        const key = pending.pop();
        if (reached.has(key)) continue;
        reached.add(key);
        const sources = incoming.get(key);
        if (sources) {
            for (const source of sources) pending.push(source);
        }
    }
    return reached;
};

const sameKeys = (a, b) => {
    if (a.size !== b.size) return false;
    for (const key of a) {
        if (!b.has(key)) return false;
    }
    return true;
};

const states = new WeakMap();

const namesReachingLookups = runtime => {
    runtime.nameFlowStale = false;
    const stage = runtime.getTargetForStage();
    const stageDeclarations = stage ? stage.declRevision : 0;
    const previous = states.get(runtime);
    const summaries = [];
    let unchanged = !!previous;
    for (const target of runtime.targets) {
        if (!target.isOriginal) continue;
        const cache = target.blocks._cache;
        const cached = cache.nameFlow;
        if (
            !cached ||
            cached.declarations !== target.declRevision ||
            cached.stageDeclarations !== stageDeclarations
        ) {
            cache.nameFlow = summarize(runtime, target, stage);
        }
        if (unchanged && previous.summaries[summaries.length] !== cache.nameFlow) unchanged = false;
        summaries.push(cache.nameFlow);
    }
    if (unchanged && previous.summaries.length === summaries.length) return previous.usable;

    const reached = solve(summaries);
    if (previous && !sameKeys(previous.reached, reached)) {
        for (const target of runtime.targets) {
            if (target.isOriginal) target.blocks.forgetCompiledScripts();
        }
    }
    const usable = reached.has(ANYTHING) ? null : reached;
    states.set(runtime, {summaries, reached, usable});
    return usable;
};

const refreshNameFlow = runtime => {
    if (states.has(runtime)) {
        namesReachingLookups(runtime);
    } else {
        runtime.nameFlowStale = false;
    }
};

module.exports = {
    WHOLE_NUMBER,
    storeKeyOf,
    argumentKeyOf,
    namesReachingLookups,
    refreshNameFlow
};
