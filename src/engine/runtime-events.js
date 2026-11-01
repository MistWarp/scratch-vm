const RuntimeEvents = {
    /**
     * Event name for glowing a script.
     * @const {string}
     */
    SCRIPT_GLOW_ON: 'SCRIPT_GLOW_ON',

    /**
     * Event name for unglowing a script.
     * @const {string}
     */
    SCRIPT_GLOW_OFF: 'SCRIPT_GLOW_OFF',

    /**
     * Event name for glowing a block.
     * @const {string}
     */
    BLOCK_GLOW_ON: 'BLOCK_GLOW_ON',

    /**
     * Event name for unglowing a block.
     * @const {string}
     */
    BLOCK_GLOW_OFF: 'BLOCK_GLOW_OFF',

    /**
     * Event name for a cloud data update
     * to this project.
     * @const {string}
     */
    HAS_CLOUD_DATA_UPDATE: 'HAS_CLOUD_DATA_UPDATE',

    /**
     * Event name for turning on turbo mode.
     * @const {string}
     */
    TURBO_MODE_ON: 'TURBO_MODE_ON',

    /**
     * Event name for turning off turbo mode.
     * @const {string}
     */
    TURBO_MODE_OFF: 'TURBO_MODE_OFF',

    /**
     * Event name for runtime options changing.
     * @const {string}
     */
    RUNTIME_OPTIONS_CHANGED: 'RUNTIME_OPTIONS_CHANGED',

    /**
     * Event name for compiler options changing.
     * @const {string}
     */
    COMPILER_OPTIONS_CHANGED: 'COMPILER_OPTIONS_CHANGED',

    /**
     * Event name for framerate changing.
     * @const {string}
     */
    FRAMERATE_CHANGED: 'FRAMERATE_CHANGED',

    /**
     * Event name for interpolation changing.
     * @const {string}
     */
    INTERPOLATION_CHANGED: 'INTERPOLATION_CHANGED',

    /**
     * Event name for stage size changing.
     * @const {string}
     */
    STAGE_SIZE_CHANGED: 'STAGE_SIZE_CHANGED',

    /**
     * Event name for compiler errors.
     * @const {string}
     */
    COMPILE_ERROR: 'COMPILE_ERROR',

    /**
     * Event called before any block is executed.
     */
    BEFORE_EXECUTE: 'BEFORE_EXECUTE',

    RUNTIME_PAUSED: 'RUNTIME_PAUSED',

    RUNTIME_UNPAUSED: 'RUNTIME_UNPAUSED',

    /**
     * Event called after every block in the project has been executed.
     */
    AFTER_EXECUTE: 'AFTER_EXECUTE',

    ASSET_PROGRESS: 'ASSET_PROGRESS',

    /**
     * Event name when the project is started (threads may not necessarily be
     * running).
     * @const {string}
     */
    PROJECT_START: 'PROJECT_START',

    /**
     * Event name when threads start running.
     * Used by the UI to indicate running status.
     * @const {string}
     */
    PROJECT_RUN_START: 'PROJECT_RUN_START',

    /**
     * Event name when threads stop running
     * Used by the UI to indicate not-running status.
     * @const {string}
     */
    PROJECT_RUN_STOP: 'PROJECT_RUN_STOP',

    /**
     * Event name for project being stopped or restarted by the user.
     * Used by blocks that need to reset state.
     * @const {string}
     */
    PROJECT_STOP_ALL: 'PROJECT_STOP_ALL',

    /**
     * Event name for target being stopped by a stop for target call.
     * Used by blocks that need to stop individual targets.
     * @const {string}
     */
    STOP_FOR_TARGET: 'STOP_FOR_TARGET',

    /**
     * Event name for visual value report.
     * @const {string}
     */
    VISUAL_REPORT: 'VISUAL_REPORT',

    /**
     * Event name for project loaded report.
     * @const {string}
     */
    PROJECT_LOADED: 'PROJECT_LOADED',

    /**
     * Event name for report that a change was made that can be saved
     * @const {string}
     */
    PROJECT_CHANGED: 'PROJECT_CHANGED',

    /**
     * Event name for report that a change was made to an extension in the toolbox.
     * @const {string}
     */
    TOOLBOX_EXTENSIONS_NEED_UPDATE: 'TOOLBOX_EXTENSIONS_NEED_UPDATE',

    /**
     * Event name for targets update report.
     * @const {string}
     */
    TARGETS_UPDATE: 'TARGETS_UPDATE',

    /**
     * Event name for sprite info changed (from sprite data panel).
     * @const {string}
     */
    SPRITE_INFO_CHANGED: 'SPRITE_INFO_CHANGED',

    /**
     * Event name for monitors update.
     * @const {string}
     */
    MONITORS_UPDATE: 'MONITORS_UPDATE',

    /**
     * Event name for block drag update.
     * @const {string}
     */
    BLOCK_DRAG_UPDATE: 'BLOCK_DRAG_UPDATE',

    /**
     * Event name for block drag end.
     * @const {string}
     */
    BLOCK_DRAG_END: 'BLOCK_DRAG_END',

    /**
     * Event name for reporting that an extension was added.
     * @const {string}
     */
    EXTENSION_ADDED: 'EXTENSION_ADDED',

    /**
     * Event name for reporting that an extension was removed.
     * @const {string}
     */
    EXTENSION_REMOVED: 'EXTENSION_REMOVED',

    /**
     * Event name for reporting that extensions were reordered.
     * @const {string}
     */
    EXTENSIONS_REORDERED: 'EXTENSIONS_REORDERED',

    /**
     * Event name for reporting that an extension as asked for a custom field to be added
     * @const {string}
     */
    EXTENSION_FIELD_ADDED: 'EXTENSION_FIELD_ADDED',

    /**
     * Event name for updating the available set of peripheral devices.
     * This causes the peripheral connection modal to update a list of
     * available peripherals.
     * @const {string}
     */
    PERIPHERAL_LIST_UPDATE: 'PERIPHERAL_LIST_UPDATE',

    /**
     * Event name for when the user picks a bluetooth device to connect to
     * via Companion Device Manager (CDM)
     * @const {string}
     */
    USER_PICKED_PERIPHERAL: 'USER_PICKED_PERIPHERAL',

    /**
     * Event name for reporting that a peripheral has connected.
     * This causes the status button in the blocks menu to indicate 'connected'.
     * @const {string}
     */
    PERIPHERAL_CONNECTED: 'PERIPHERAL_CONNECTED',

    /**
     * Event name for reporting that a peripheral has been intentionally disconnected.
     * This causes the status button in the blocks menu to indicate 'disconnected'.
     * @const {string}
     */
    PERIPHERAL_DISCONNECTED: 'PERIPHERAL_DISCONNECTED',

    /**
     * Event name for reporting that a peripheral has encountered a request error.
     * This causes the peripheral connection modal to switch to an error state.
     * @const {string}
     */
    PERIPHERAL_REQUEST_ERROR: 'PERIPHERAL_REQUEST_ERROR',

    /**
     * Event name for reporting that a peripheral connection has been lost.
     * This causes a 'peripheral connection lost' error alert to display.
     * @const {string}
     */
    PERIPHERAL_CONNECTION_LOST_ERROR: 'PERIPHERAL_CONNECTION_LOST_ERROR',

    /**
     * Event name for reporting that a peripheral has not been discovered.
     * This causes the peripheral connection modal to show a timeout state.
     * @const {string}
     */
    PERIPHERAL_SCAN_TIMEOUT: 'PERIPHERAL_SCAN_TIMEOUT',

    /**
     * Event name to indicate that the microphone is being used to stream audio.
     * @const {string}
     */
    MIC_LISTENING: 'MIC_LISTENING',

    /**
     * Event name for reporting that blocksInfo was updated.
     * @const {string}
     */
    BLOCKSINFO_UPDATE: 'BLOCKSINFO_UPDATE',

    /**
     * Event name when the runtime tick loop has been started.
     * @const {string}
     */
    RUNTIME_STARTED: 'RUNTIME_STARTED',

    /**
     * Event name when the runtime tick loop has been stopped.
     * @const {string}
     */
    RUNTIME_STOPPED: 'RUNTIME_STOPPED',

    /**
     * Event name when the runtime dispose has been called.
     * @const {string}
     */
    RUNTIME_DISPOSED: 'RUNTIME_DISPOSED',

    /**
     * Event name for reporting that a block was updated and needs to be rerendered.
     * @const {string}
     */
    BLOCKS_NEED_UPDATE: 'BLOCKS_NEED_UPDATE',

    /**
     * Event name when platform name inside a project does not match the runtime.
     */
    PLATFORM_MISMATCH: 'PLATFORM_MISMATCH',

    THREAD_ERROR: 'THREAD_ERROR',

    THREAD_STARTED: 'THREAD_STARTED',

    HATS_STARTED: 'HATS_STARTED',

    CLONE_LIMIT_REACHED: 'CLONE_LIMIT_REACHED',

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

    TARGET_WAS_CREATED: 'targetWasCreated',

    TARGET_WAS_REMOVED: 'targetWasRemoved'
};

module.exports = RuntimeEvents;
