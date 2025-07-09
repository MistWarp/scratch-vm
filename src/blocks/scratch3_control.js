const Cast = require('../util/cast');

class Scratch3ControlBlocks {
    constructor (runtime) {
        /**
         * The runtime instantiating this block package.
         * @type {Runtime}
         */
        this.runtime = runtime;

        /**
         * The "counter" block value. For compatibility with 2.0.
         * @type {number}
         */
        this._counter = 0; // used by compiler

        this.runtime.on('RUNTIME_DISPOSED', this.clearCounter.bind(this));
    }

    /**
     * Retrieve the block primitives implemented by this package.
     * @return {object.<string, Function>} Mapping of opcode to Function.
     */
    getPrimitives () {
        return {
            control_repeat: this.repeat,
            control_repeat_until: this.repeatUntil,
            control_while: this.repeatWhile,
            control_for_each: this.forEach,
            control_forever: this.forever,
            control_wait: this.wait,
            control_wait_until: this.waitUntil,
            control_if: this.if,
            control_if_else: this.ifElse,
            control_stop: this.stop,
            control_create_clone_of: this.createClone,
            control_delete_this_clone: this.deleteClone,
            control_get_counter: this.getCounter,
            control_incr_counter: this.incrCounter,
            control_clear_counter: this.clearCounter,
            control_all_at_once: this.allAtOnce,
            control_switch: this.switch,
            control_case: this.case,
            control_default: this.default,
            control_break: this.break,
            control_case_fallthrough: this.caseFallthrough
        };
    }

    getHats () {
        return {
            control_start_as_clone: {
                restartExistingThreads: false
            }
        };
    }

    repeat (args, util) {
        const times = Math.round(Cast.toNumber(args.TIMES));
        // Initialize loop
        if (typeof util.stackFrame.loopCounter === 'undefined') {
            util.stackFrame.loopCounter = times;
        }
        // Only execute once per frame.
        // When the branch finishes, `repeat` will be executed again and
        // the second branch will be taken, yielding for the rest of the frame.
        // Decrease counter
        util.stackFrame.loopCounter--;
        // If we still have some left, start the branch.
        if (util.stackFrame.loopCounter >= 0) {
            util.startBranch(1, true);
        }
    }

    repeatUntil (args, util) {
        const condition = Cast.toBoolean(args.CONDITION);
        // If the condition is false (repeat UNTIL), start the branch.
        if (!condition) {
            util.startBranch(1, true);
        }
    }

    repeatWhile (args, util) {
        const condition = Cast.toBoolean(args.CONDITION);
        // If the condition is true (repeat WHILE), start the branch.
        if (condition) {
            util.startBranch(1, true);
        }
    }

    forEach (args, util) {
        const variable = util.target.lookupOrCreateVariable(
            args.VARIABLE.id, args.VARIABLE.name);

        if (typeof util.stackFrame.index === 'undefined') {
            util.stackFrame.index = 0;
        }

        if (util.stackFrame.index < Number(args.VALUE)) {
            util.stackFrame.index++;
            variable.value = util.stackFrame.index;
            util.startBranch(1, true);
        }
    }

    waitUntil (args, util) {
        const condition = Cast.toBoolean(args.CONDITION);
        if (!condition) {
            util.yield();
        }
    }

    forever (args, util) {
        util.startBranch(1, true);
    }

    wait (args, util) {
        if (util.stackTimerNeedsInit()) {
            const duration = Math.max(0, 1000 * Cast.toNumber(args.DURATION));

            util.startStackTimer(duration);
            this.runtime.requestRedraw();
            util.yield();
        } else if (!util.stackTimerFinished()) {
            util.yield();
        }
    }

    if (args, util) {
        const condition = Cast.toBoolean(args.CONDITION);
        if (condition) {
            util.startBranch(1, false);
        }
    }

    ifElse (args, util) {
        const condition = Cast.toBoolean(args.CONDITION);
        if (condition) {
            util.startBranch(1, false);
        } else {
            util.startBranch(2, false);
        }
    }

    stop (args, util) {
        const option = args.STOP_OPTION;
        if (option === 'all') {
            util.stopAll();
        } else if (option === 'other scripts in sprite' ||
            option === 'other scripts in stage') {
            util.stopOtherTargetThreads();
        } else if (option === 'this script') {
            util.stopThisScript();
        }
    }

    createClone (args, util) {
        this._createClone(Cast.toString(args.CLONE_OPTION), util.target);
    }
    _createClone (cloneOption, target) { // used by compiler
        // Set clone target
        let cloneTarget;
        if (cloneOption === '_myself_') {
            cloneTarget = target;
        } else {
            cloneTarget = this.runtime.getSpriteTargetByName(cloneOption);
        }

        // If clone target is not found, return
        if (!cloneTarget) return;

        // Create clone
        const newClone = cloneTarget.makeClone();
        if (newClone) {
            this.runtime.addTarget(newClone);

            // Place behind the original target.
            newClone.goBehindOther(cloneTarget);
        }
    }

    deleteClone (args, util) {
        if (util.target.isOriginal) return;
        this.runtime.disposeTarget(util.target);
        this.runtime.stopForTarget(util.target);
    }

    getCounter () {
        return this._counter;
    }

    clearCounter () {
        this._counter = 0;
    }

    incrCounter () {
        this._counter++;
    }

    allAtOnce (args, util) {
        // Since the "all at once" block is implemented for compatiblity with
        // Scratch 2.0 projects, it behaves the same way it did in 2.0, which
        // is to simply run the contained script (like "if 1 = 1").
        // (In early versions of Scratch 2.0, it would work the same way as
        // "run without screen refresh" custom blocks do now, but this was
        // removed before the release of 2.0.)
        util.startBranch(1, false);
    }

    /**
     * The "switch" block begins a switch-case construct.
     * @param {object} args - the block arguments.
     * @param {object} util - utility object provided by the runtime.
     */
    switch (args, util) {
        const frame = util.stackFrame;
        if (!frame.switchExecuted) {
            frame.switchExecuted = true;
            frame.switchValue = Cast.toString(args.VALUE);
            frame.isSwitch = true;
            frame.isBreakable = true;
            frame.caseMatched = false;
            frame.hasDefaultRun = false;
            util.startBranch(1, false);
        }
    }

    /**
     * The "case" block compares a value to the switch value.
     * @param {object} args - the block arguments.
     * @param {object} util - utility object provided by the runtime.
     */
    case (args, util) {
        const frame = util.stackFrame;
        const parentFrame = this._getParentSwitchFrame(util.thread);
        
        if (!parentFrame || !parentFrame.isSwitch) return;
        
        if (!frame.caseExecuted) {
            frame.caseExecuted = true;
            frame.isBreakable = true;
            frame.caseValue = Cast.toString(args.VALUE);
            
            // Check if this case matches or if we're falling through
            const shouldExecute = (parentFrame.switchValue === frame.caseValue) || parentFrame.caseMatched;
            
            if (shouldExecute) {
                parentFrame.caseMatched = true;
                util.startBranch(1, false);
            }
        }
    }

    /**
     * The "default" block runs when no case has matched.
     * @param {object} args - the block arguments.
     * @param {object} util - utility object provided by the runtime.
     */
    default (args, util) {
        const frame = util.stackFrame;
        const parentFrame = this._getParentSwitchFrame(util.thread);
        
        if (!parentFrame || !parentFrame.isSwitch) return;
        
        if (!frame.defaultExecuted) {
            frame.defaultExecuted = true;
            frame.isBreakable = true;
            
            // Execute default only if no case has matched and we haven't run it yet
            if (!parentFrame.caseMatched && !parentFrame.hasDefaultRun) {
                parentFrame.hasDefaultRun = true;
                parentFrame.caseMatched = true;
                util.startBranch(1, false);
            }
        }
    }

    /**
     * The "break" block exits the current breakable construct.
     * @param {object} args - the block arguments.
     * @param {object} util - utility object provided by the runtime.
     */
    break (args, util) {
        this._breakCurrentLoop(util.thread);
    }

    /**
     * The "continue" block continues to the next iteration of a loop.
     * @param {object} args - the block arguments.
     * @param {object} util - utility object provided by the runtime.
     */
    continue (args, util) {
        this._continueCurrentLoop(util.thread);
    }

    /**
     * Get the switch value in the current switch construct.
     * @param {object} args - the block arguments.
     * @param {object} util - utility object provided by the runtime.
     * @returns {string} The switch value or empty string if not in a switch.
     */
    switchValue (args, util) {
        const parentFrame = this._getParentSwitchFrame(util.thread);
        return parentFrame && parentFrame.switchValue ? parentFrame.switchValue : '';
    }

    /**
     * Get the case value in the current case construct.
     * @param {object} args - the block arguments.
     * @param {object} util - utility object provided by the runtime.
     * @returns {string} The case value or empty string if not in a case.
     */
    caseValue (args, util) {
        const frame = this._getParentCaseFrame(util.thread);
        return frame && frame.caseValue ? frame.caseValue : '';
    }

    /**
     * Helper method to find the parent switch frame.
     * @param {Thread} thread - the thread to search.
     * @returns {object|null} The switch frame or null if not found.
     * @private
     */
    _getParentSwitchFrame (thread) {
        const frames = thread.stackFrames;
        for (let i = frames.length - 1; i >= 0; i--) {
            if (frames[i].isSwitch) {
                return frames[i];
            }
        }
        return null;
    }

    /**
     * Helper method to find the parent case frame.
     * @param {Thread} thread - the thread to search.
     * @returns {object|null} The case frame or null if not found.
     * @private
     */
    _getParentCaseFrame (thread) {
        const frames = thread.stackFrames;
        for (let i = frames.length - 1; i >= 0; i--) {
            if (frames[i].caseValue) {
                return frames[i];
            }
        }
        return null;
    }

    /**
     * Helper method to break out of the current breakable construct.
     * @param {Thread} thread - the thread to break.
     * @private
     */
    _breakCurrentLoop (thread) {
        const blocks = thread.blockContainer;
        const frames = thread.stackFrames;
        
        // Find the nearest breakable frame
        let loopFrameIndex = -1;
        let loopFrameBlock = null;
        
        for (let i = frames.length - 1; i >= 0; i--) {
            if (frames[i].isLoop || frames[i].isBreakable) {
                loopFrameIndex = i;
                loopFrameBlock = frames[i].op ? frames[i].op.id : null;
                break;
            }
        }
        
        if (loopFrameIndex === -1 || !loopFrameBlock) return;
        
        const afterLoop = blocks.getBlock(loopFrameBlock).next;
        
        // Remove blocks from stack until we reach the breakable block
        while (thread.stack.length > 0 && thread.peekStack() !== loopFrameBlock) {
            if (blocks.getBlock(thread.peekStack()).opcode === 'procedures_call') return;
            thread.popStack();
        }
        
        // Remove the breakable block itself
        if (thread.stack.length > 0) {
            thread.popStack();
        }
        
        // Continue after the breakable block if there's a next block
        if (afterLoop) {
            thread.pushStack(afterLoop);
        }
    }

    caseFallthrough () {
        // This is a marker block for fallthrough cases
        // It doesn't execute anything - just provides the case value
        // The actual logic is handled by the switch block
        return;
    }

    /**
     * Helper method to continue to the next iteration of a loop.
     * @param {Thread} thread - the thread to continue.
     * @private
     */
    _continueCurrentLoop (thread) {
        const blocks = thread.blockContainer;
        const frames = thread.stackFrames;
        
        // Find the nearest loop frame
        let loopFrameBlock = null;
        
        for (let i = frames.length - 1; i >= 0; i--) {
            if (frames[i].isLoop) {
                loopFrameBlock = frames[i].op ? frames[i].op.id : null;
                break;
            }
        }
        
        if (!loopFrameBlock) return;
        
        // Remove blocks from stack until we reach the loop block
        while (thread.stack.length > 0 && thread.peekStack() !== loopFrameBlock) {
            if (blocks.getBlock(thread.peekStack()).opcode === 'procedures_call') return;
            thread.popStack();
        }
        
        // Yield to restart the loop
        thread.status = thread.constructor.STATUS_YIELD;
    }
}

module.exports = Scratch3ControlBlocks;
