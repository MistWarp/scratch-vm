const fs = require('fs');
const os = require('os');
const path = require('path');
const {pathToFileURL} = require('url');
const {test} = require('tap');
const VM = require('../../src/virtual-machine');
const opcodes = require('../../src/engine/opcodes.generated.json');
const {isReservedComment, isMapComment} = require('../../src/serialization/fractch-context');

const fractchDir = path.resolve(__dirname, '../../../../fractch');
const corpusDir = process.env.FRACTCH_CORPUS || path.join(os.homedir(), 'Downloads');
const limit = Number(process.env.FRACTCH_CORPUS_LIMIT || 20);
const maxBytes = process.env.FRACTCH_CORPUS_LIMIT ? Infinity : 3e6;

const corpusFiles = () => {
    if (!fs.existsSync(corpusDir)) return [];
    const files = fs.readdirSync(corpusDir)
        .filter(name => name.endsWith('.sb3'))
        .map(name => path.join(corpusDir, name))
        .filter(file => fs.statSync(file).size <= maxBytes)
        .sort((a, b) => fs.statSync(a).size - fs.statSync(b).size);
    if (limit <= 0 || files.length <= limit) return files;
    return Array.from({length: limit}, (_, i) => files[Math.round((i * (files.length - 1)) / (limit - 1))]);
};

const snapshot = (vm, target) => {
    const comments = {};
    for (const id of Object.keys(target.comments)) {
        const c = target.comments[id];
        comments[id] = JSON.stringify([c.blockId, c.x, c.y, c.width, c.height, c.minimized, c.text]);
    }
    const reserved = Object.keys(target.comments).filter(id => isReservedComment(target, target.comments[id]));
    return {
        blocks: JSON.parse(JSON.stringify(target.blocks._blocks)),
        scripts: target.blocks._scripts.slice(),
        comments,
        reserved: reserved.map(id => [id, target.comments[id]]),
        frames: JSON.stringify(target.frames || {}),
        variables: JSON.stringify(target.variables),
        hash: vm.getCodeStateHash(target.id)
    };
};

const scriptIds = (blocks, topId) => {
    const ids = new Set();
    const pending = [topId];
    while (pending.length) {
        const id = pending.pop();
        if (!id || ids.has(id) || !blocks[id]) continue;
        ids.add(id);
        const block = blocks[id];
        pending.push(block.next);
        for (const name in block.inputs) pending.push(block.inputs[name].block, block.inputs[name].shadow);
        if (Array.isArray(block.obscuredHeadShadows)) pending.push(...block.obscuredHeadShadows);
    }
    return ids;
};

const CORE_NAMESPACES = new Set(['motion', 'looks', 'sound', 'event', 'control', 'sensing', 'operator', 'data',
    'procedures', 'argument']);

const cannotRebuild = (blocks, ids, signatures) => Array.from(ids).some(id => {
    const opcode = blocks[id].opcode;
    const entry = opcodes.opcodes[opcode];
    if (entry) return Boolean(entry.variadic && !entry.variadic.collapsed);
    return !CORE_NAMESPACES.has(opcode.split('_')[0]) && !signatures[opcode.split('_')[0]];
});

const errorsOf = built => built.diagnostics.filter(d => d.severity === 'error')
    .map(d => `${d.code} ${d.message} @${d.line}`);

const roundTrip = (fractch, vm, targetId, edit) => {
    const context = vm.getFractchContext();
    const emitted = fractch.emitTarget(context, targetId, {opcodes});
    const text = edit ? edit(emitted) : emitted.text;
    if (text === null) return null;
    const built = fractch.buildTarget(context, targetId, text, {
        previous: emitted,
        lockedScripts: emitted.lockedScripts,
        opcodes
    });
    const errors = errorsOf(built);
    if (errors.length) return {emitted, built, errors};
    try {
        vm.replaceTargetScripts(targetId, fractch.toReplaceChange(built));
    } catch (e) {
        errors.push(`replaceTargetScripts: ${e.message}`);
    }
    return {emitted, built, errors};
};

const insertStatement = (topId, emitted) => {
    const range = emitted.sourceMap.scripts[topId];
    if (!range) return null;
    const open = emitted.text.indexOf('{\n', range.from);
    if (open < 0 || open > range.to) return null;
    const at = open + 2;
    return `${emitted.text.slice(0, at)}resetTimer;\n${emitted.text.slice(at)}`;
};

const files = corpusFiles();
const totals = {projects: 0, skipped: 0, targets: 0, scripts: 0, locked: 0, edited: 0, gainedMaps: 0};

test('code mode corpus identity', {skip: !fs.existsSync(fractchDir) || files.length === 0}, async t => {
    const fractch = await import(pathToFileURL(path.join(fractchDir, 'src/index.js')).href);
    const membership = await import(pathToFileURL(path.join(fractchDir, 'src/membership.js')).href);

    for (const file of files) {
        const name = path.basename(file);
        const vm = new VM();
        try {
            await vm.loadProject(fs.readFileSync(file));
        } catch (e) {
            totals.skipped++;
            t.comment(`skipped ${name}: ${e.message}`);
            continue;
        }
        totals.projects++;
        await t.test(name, async tt => {
            for (const target of vm.runtime.targets.filter(x => x.isOriginal)) {
                const where = `${name} / ${target.getName()}`;
                const before = snapshot(vm, target);
                const legacy = membership.readMembership(vm.getFractchContext(target.id).targets[0]);
                const result = roundTrip(fractch, vm, target.id);
                tt.same(result.errors, [], `${where}: no build errors`);
                if (result.errors.length) continue;
                const {built, emitted} = result;
                tt.same(built.changed, [], `${where}: no scripts changed`);
                tt.same(built.created.scripts, [], `${where}: no scripts created`);
                tt.same(built.removed.scripts, [], `${where}: no scripts removed`);
                const after = snapshot(vm, target);
                tt.same(after.blocks, before.blocks, `${where}: blocks and ids`);
                tt.same(after.scripts, before.scripts, `${where}: script order`);
                tt.equal(after.frames, before.frames, `${where}: frames`);
                tt.equal(after.variables, before.variables, `${where}: variables`);
                tt.equal(after.hash, before.hash, `${where}: code state hash`);
                tt.equal(after.reserved.length, before.reserved.length, `${where}: reserved comment count`);
                for (const [id, comment] of before.reserved) {
                    tt.equal(target.comments[id], comment, `${where}: reserved comment ${id} kept`);
                }
                const gained = Object.keys(after.comments).filter(id => !(id in before.comments));
                for (const id of gained) {
                    tt.ok(isMapComment(target.comments[id]), `${where}: only a map comment is gained (${id})`);
                    totals.gainedMaps++;
                    const map = membership.readMembership(vm.getFractchContext(target.id).targets[0]);
                    for (const topId of after.scripts) {
                        tt.same(map.entryFor(topId), legacy.entryFor(topId), `${where}: map entry ${topId}`);
                    }
                }
                for (const id of Object.keys(before.comments)) {
                    if (isMapComment(target.comments[id])) continue;
                    tt.equal(after.comments[id], before.comments[id], `${where}: comment ${id}`);
                }
                totals.targets++;
                totals.scripts += Object.keys(emitted.sourceMap.scripts).length;
                totals.locked += emitted.lockedScripts.length;

                const lockedIds = new Set(emitted.lockedScripts.map(l => l.topId));
                const signatures = vm.getFractchContext(target.id).extensionSignatures;
                const editable = after.scripts.find(id => !lockedIds.has(id) && insertStatement(id, emitted) &&
                    !cannotRebuild(after.blocks, scriptIds(after.blocks, id), signatures));
                if (!editable) continue;
                const editedIds = scriptIds(after.blocks, editable);
                const edit = roundTrip(fractch, vm, target.id, e => insertStatement(editable, e));
                tt.same(edit.errors, [], `${where}: edit builds`);
                if (edit.errors.length) continue;
                tt.equal(edit.built.changed.length, 1, `${where}: one script changed`);
                const changedTop = edit.built.changed.length ? edit.built.changed[0].newTopId : editable;
                const live = target.blocks._blocks;
                const newScript = scriptIds(live, changedTop);
                tt.same(Object.keys(after.blocks).filter(id => !editedIds.has(id) &&
                    JSON.stringify(live[id]) !== JSON.stringify(after.blocks[id])), [],
                `${where}: blocks outside the edit are untouched`);
                tt.same(Object.keys(live).filter(id => !(id in after.blocks) && !newScript.has(id)), [],
                    `${where}: new ids are only in the edited script`);
                tt.equal(JSON.stringify(target.variables), after.variables, `${where}: edit leaves variables alone`);
                totals.edited++;
            }
        });
        vm.quit();
    }
    t.comment(`${totals.projects} projects (${totals.skipped} skipped), ${totals.targets} targets, ` +
        `${totals.scripts} scripts, ${totals.locked} locked, ${totals.edited} edited, ` +
        `${totals.gainedMaps} map comments gained`);
});
