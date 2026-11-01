const tap = require('tap');
const Runtime = require('../../src/engine/runtime');
const RuntimeEvents = require('../../src/engine/runtime-events');
const VirtualMachineEvents = require('../../src/virtual-machine-events');

const ORIGINAL_EVENT_NAMES = [
    'SCRIPT_GLOW_ON',
    'SCRIPT_GLOW_OFF',
    'BLOCK_GLOW_ON',
    'BLOCK_GLOW_OFF',
    'HAS_CLOUD_DATA_UPDATE',
    'TURBO_MODE_ON',
    'TURBO_MODE_OFF',
    'RUNTIME_OPTIONS_CHANGED',
    'COMPILER_OPTIONS_CHANGED',
    'FRAMERATE_CHANGED',
    'INTERPOLATION_CHANGED',
    'STAGE_SIZE_CHANGED',
    'COMPILE_ERROR',
    'BEFORE_EXECUTE',
    'AFTER_EXECUTE',
    'ASSET_PROGRESS',
    'PROJECT_START',
    'PROJECT_RUN_START',
    'PROJECT_RUN_STOP',
    'PROJECT_STOP_ALL',
    'STOP_FOR_TARGET',
    'VISUAL_REPORT',
    'PROJECT_LOADED',
    'PROJECT_CHANGED',
    'TOOLBOX_EXTENSIONS_NEED_UPDATE',
    'TARGETS_UPDATE',
    'SPRITE_INFO_CHANGED',
    'MONITORS_UPDATE',
    'BLOCK_DRAG_UPDATE',
    'BLOCK_DRAG_END',
    'EXTENSION_ADDED',
    'EXTENSION_REMOVED',
    'EXTENSIONS_REORDERED',
    'EXTENSION_FIELD_ADDED',
    'PERIPHERAL_LIST_UPDATE',
    'USER_PICKED_PERIPHERAL',
    'PERIPHERAL_CONNECTED',
    'PERIPHERAL_DISCONNECTED',
    'PERIPHERAL_REQUEST_ERROR',
    'PERIPHERAL_CONNECTION_LOST_ERROR',
    'PERIPHERAL_SCAN_TIMEOUT',
    'MIC_LISTENING',
    'BLOCKSINFO_UPDATE',
    'RUNTIME_STARTED',
    'RUNTIME_STOPPED',
    'RUNTIME_DISPOSED',
    'BLOCKS_NEED_UPDATE',
    'PLATFORM_MISMATCH'
];

tap.test('every original Runtime event getter keeps its name as its value', t => {
    for (const name of ORIGINAL_EVENT_NAMES) {
        t.equal(Runtime[name], name, name);
        t.equal(RuntimeEvents[name], name, `RuntimeEvents.${name}`);
    }
    t.end();
});

tap.test('every RuntimeEvents entry is a static getter on Runtime', t => {
    for (const name of Object.keys(RuntimeEvents)) {
        const descriptor = Object.getOwnPropertyDescriptor(Runtime, name);
        t.type(descriptor.get, 'function', `${name} is a getter`);
        t.equal(descriptor.set, undefined, `${name} has no setter`);
        t.equal(descriptor.enumerable, false, `${name} is not enumerable`);
        t.equal(descriptor.configurable, true, `${name} is configurable`);
        t.equal(Runtime[name], RuntimeEvents[name], `Runtime.${name}`);
    }
    t.end();
});

tap.test('event values are unique strings', t => {
    for (const events of [RuntimeEvents, VirtualMachineEvents]) {
        const values = Object.values(events);
        t.ok(values.every(value => typeof value === 'string'));
        t.equal(new Set(values).size, values.length);
    }
    t.end();
});

tap.test('event values that were string literals are unchanged', t => {
    t.same({
        THREAD_ERROR: RuntimeEvents.THREAD_ERROR,
        THREAD_STARTED: RuntimeEvents.THREAD_STARTED,
        BREAKPOINT_HIT: RuntimeEvents.BREAKPOINT_HIT,
        PRODUCTS_CHANGED: RuntimeEvents.PRODUCTS_CHANGED,
        ITEMS_CHANGED: RuntimeEvents.ITEMS_CHANGED,
        ENTITLEMENTS_CHANGED: RuntimeEvents.ENTITLEMENTS_CHANGED,
        EXTENSION_CONSOLE: RuntimeEvents.EXTENSION_CONSOLE,
        EXTENSION_ERROR: RuntimeEvents.EXTENSION_ERROR,
        EXTENSION_RELOADED: RuntimeEvents.EXTENSION_RELOADED,
        TARGET_SCRIPTS_REPLACED: RuntimeEvents.TARGET_SCRIPTS_REPLACED,
        KEY_PRESSED: RuntimeEvents.KEY_PRESSED,
        SAY: RuntimeEvents.SAY,
        QUESTION: RuntimeEvents.QUESTION,
        ANSWER: RuntimeEvents.ANSWER,
        PLAY_NOTE: RuntimeEvents.PLAY_NOTE,
        targetWasCreated: RuntimeEvents.TARGET_WAS_CREATED,
        targetWasRemoved: RuntimeEvents.TARGET_WAS_REMOVED
    }, {
        THREAD_ERROR: 'THREAD_ERROR',
        THREAD_STARTED: 'THREAD_STARTED',
        BREAKPOINT_HIT: 'BREAKPOINT_HIT',
        PRODUCTS_CHANGED: 'PRODUCTS_CHANGED',
        ITEMS_CHANGED: 'ITEMS_CHANGED',
        ENTITLEMENTS_CHANGED: 'ENTITLEMENTS_CHANGED',
        EXTENSION_CONSOLE: 'EXTENSION_CONSOLE',
        EXTENSION_ERROR: 'EXTENSION_ERROR',
        EXTENSION_RELOADED: 'EXTENSION_RELOADED',
        TARGET_SCRIPTS_REPLACED: 'TARGET_SCRIPTS_REPLACED',
        KEY_PRESSED: 'KEY_PRESSED',
        SAY: 'SAY',
        QUESTION: 'QUESTION',
        ANSWER: 'ANSWER',
        PLAY_NOTE: 'PLAY_NOTE',
        targetWasCreated: 'targetWasCreated',
        targetWasRemoved: 'targetWasRemoved'
    });
    t.same(VirtualMachineEvents, {
        LOAD_PROGRESS: 'LOAD_PROGRESS',
        EXTENSION_LOAD_ERROR: 'EXTENSION_LOAD_ERROR',
        LOCALE_CHANGED: 'LOCALE_CHANGED',
        LEGACY_EXTENSION_API: 'LEGACY_EXTENSION_API',
        CREATE_UNSANDBOXED_EXTENSION_API: 'CREATE_UNSANDBOXED_EXTENSION_API',
        EDIT_COMMAND_ERROR: 'EDIT_COMMAND_ERROR',
        TARGETS_UPDATE: 'targetsUpdate',
        WORKSPACE_UPDATE: 'workspaceUpdate',
        PLAYGROUND_DATA: 'playgroundData'
    });
    t.end();
});

tap.test('non-event static constants are unchanged', t => {
    t.equal(Runtime.STAGE_WIDTH, 480);
    t.equal(Runtime.STAGE_HEIGHT, 360);
    t.equal(Runtime.MAX_CLONES, 300);
    t.equal(Runtime.THREAD_STEP_INTERVAL, 1000 / 60);
    t.equal(Runtime.THREAD_STEP_INTERVAL_COMPATIBILITY, 1000 / 30);
    t.end();
});
