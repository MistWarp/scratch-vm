/**
 * @fileoverview
 * Names of the events emitted on a VirtualMachine that do not come from the
 * Runtime. Runtime events are forwarded with the names in engine/runtime-events.
 */

const VirtualMachineEvents = {
    /**
     * Event name for project loading progress. The event data has stage, loaded and total.
     * @const {string}
     */
    LOAD_PROGRESS: 'LOAD_PROGRESS',

    /**
     * Event name when a project extension fails to load. The event data has extensionID, url and error.
     * @const {string}
     */
    EXTENSION_LOAD_ERROR: 'EXTENSION_LOAD_ERROR',

    /**
     * Event name when the VM locale changes. The event data is the new locale.
     * @const {string}
     */
    LOCALE_CHANGED: 'LOCALE_CHANGED',

    /**
     * Event name when the legacy extension API is first used.
     * @const {string}
     */
    LEGACY_EXTENSION_API: 'LEGACY_EXTENSION_API',

    /**
     * Event name when the Scratch object for an unsandboxed extension is created.
     * @const {string}
     */
    CREATE_UNSANDBOXED_EXTENSION_API: 'CREATE_UNSANDBOXED_EXTENSION_API',

    /**
     * Event name when an editing command fails asynchronously.
     * @const {string}
     */
    EDIT_COMMAND_ERROR: 'EDIT_COMMAND_ERROR',

    /**
     * Event name when the list of targets or the editing target changes.
     * @const {string}
     */
    TARGETS_UPDATE: 'targetsUpdate',

    /**
     * Event name when the editing target's workspace XML should be reloaded.
     * @const {string}
     */
    WORKSPACE_UPDATE: 'workspaceUpdate',

    /**
     * Event name for the playground's project data.
     * @const {string}
     */
    PLAYGROUND_DATA: 'playgroundData'
};

module.exports = VirtualMachineEvents;
