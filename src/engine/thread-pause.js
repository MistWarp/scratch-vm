const Thread = require('./thread');

const shiftTimer = (timer, elapsed) => {
    if (timer) timer.startTime += elapsed;
};

const holdThread = (pausedThreads, thread, now) => {
    if (thread.updateMonitor || pausedThreads.has(thread)) return;
    pausedThreads.set(thread, {status: thread.status, time: now});
    thread.status = Thread.STATUS_PROMISE_WAIT;
};

const keepThreadsHeld = (pausedThreads, threads) => {
    for (let i = 0; i < threads.length; i++) {
        const thread = threads[i];
        const state = pausedThreads.get(thread);
        if (!state || thread.status === Thread.STATUS_DONE || thread.status === Thread.STATUS_PROMISE_WAIT) continue;
        state.status = thread.status;
        thread.status = Thread.STATUS_PROMISE_WAIT;
    }
};

const releaseThreads = (pausedThreads, threads, now) => {
    for (let i = 0; i < threads.length; i++) {
        const thread = threads[i];
        const state = pausedThreads.get(thread);
        if (!state || thread.status === Thread.STATUS_DONE) continue;
        const elapsed = now - state.time;
        shiftTimer(thread.timer, elapsed);
        if (thread.compatibilityStackFrame) shiftTimer(thread.compatibilityStackFrame.timer, elapsed);
        const stackFrame = thread.peekStackFrame();
        if (stackFrame && stackFrame.executionContext) shiftTimer(stackFrame.executionContext.timer, elapsed);
        thread.status = state.status;
    }
};

const countHeldThreads = (pausedThreads, threads) => {
    let count = 0;
    for (let i = 0; i < threads.length; i++) {
        if (pausedThreads.has(threads[i])) count++;
    }
    return count;
};

module.exports = {
    holdThread,
    keepThreadsHeld,
    releaseThreads,
    countHeldThreads
};
