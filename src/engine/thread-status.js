/**
 * @fileoverview
 * Thread status values. Thread exposes each one as a static getter with the
 * same name, for example Thread.STATUS_YIELD. The compiler emits these values
 * as numbers, so they must not change.
 */

const ThreadStatus = {
    /**
     * Thread status for initialized or running thread.
     * This is the default state for a thread - execution should run normally,
     * stepping from block to block.
     * @const {number}
     */
    STATUS_RUNNING: 0,

    /**
     * Threads are in this state when a primitive is waiting on a promise;
     * execution is paused until the promise changes thread status.
     * @const {number}
     */
    STATUS_PROMISE_WAIT: 1,

    /**
     * Thread status for yield.
     * @const {number}
     */
    STATUS_YIELD: 2,

    /**
     * Thread status for a single-tick yield. This will be cleared when the
     * thread is resumed.
     * @const {number}
     */
    STATUS_YIELD_TICK: 3,

    /**
     * Thread status for a finished/done thread.
     * Thread is in this state when there are no more blocks to execute.
     * @const {number}
     */
    STATUS_DONE: 4
};

module.exports = ThreadStatus;
