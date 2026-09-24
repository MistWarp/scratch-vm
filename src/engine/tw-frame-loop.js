const _requestAnimationFrame = typeof requestAnimationFrame === 'function' ?
    requestAnimationFrame :
    (f => setTimeout(f, 1000 / 60));
const _cancelAnimationFrame = typeof requestAnimationFrame === 'function' ?
    cancelAnimationFrame :
    clearTimeout;

const now = () => (typeof performance === 'object' && performance.now ? performance.now() : Date.now());

const MAX_INTERVAL_FRAMERATE = 250;
const MIN_INTERVAL_MS = 1000 / MAX_INTERVAL_FRAMERATE;
const MAX_REFRESH_STEP_TIME = 1000 / 60;
const MAX_CATCH_UP_TIME = 100;

const animationFrameWrapper = callback => {
    let id;
    const handle = () => {
        id = _requestAnimationFrame(handle);
        callback();
    };
    const cancel = () => _cancelAnimationFrame(id);
    id = _requestAnimationFrame(handle);
    return {
        cancel
    };
};

const shouldUseNoopAnimationFrame = framerate =>
    framerate >= 30 &&
    typeof navigator === 'object' &&
    navigator.userAgent.includes('Chrome') && (
        navigator.userAgent.includes('Windows') ||
        navigator.userAgent.includes('Android')
    );

class FrameLoop {
    constructor (runtime) {
        this.runtime = runtime;
        this.running = false;

        this.stepCallback = this.stepCallback.bind(this);
        this.fastStepCallback = this.fastStepCallback.bind(this);
        this.refreshStepCallback = this.refreshStepCallback.bind(this);
        this.interpolationCallback = this.interpolationCallback.bind(this);

        this._stepInterval = null;
        this._interpolationAnimation = null;
        this._stepAnimation = null;
        this._noopAnimation = null;
        this._lastStepTime = 0;
        this._lastRefreshTime = 0;
        this.deferDraw = false;

        this.setFramerate(30);
        this.setInterpolation(false);
    }

    now () {
        return now();
    }

    setFramerate (fps) {
        this.framerate = fps;
        this._restart();
    }

    setInterpolation (interpolation) {
        this.interpolation = interpolation;
        this._restart();
    }

    stepCallback () {
        this.runtime._step();
        this._lastStepTime = now();
    }

    fastStepCallback () {
        const stepTime = this.runtime.currentStepTime;
        const time = now();
        if (time - this._lastStepTime > MAX_CATCH_UP_TIME) {
            this._lastStepTime = time - stepTime;
        }
        const steps = Math.floor((time - this._lastStepTime) / stepTime);
        if (steps <= 0) return;
        this._lastStepTime += steps * stepTime;
        this.deferDraw = true;
        for (let i = 1; i < steps; i++) {
            this.runtime._step();
        }
        this.deferDraw = false;
        this.runtime._step();
    }

    refreshStepCallback () {
        const time = now();
        if (this._lastRefreshTime !== 0) {
            const elapsed = time - this._lastRefreshTime;
            this.runtime.currentStepTime = Math.min(MAX_REFRESH_STEP_TIME, Math.max(MIN_INTERVAL_MS, elapsed));
        }
        this._lastRefreshTime = time;
        this._lastStepTime = time;
        this.runtime._step();
    }

    interpolationCallback () {
        this.runtime._renderInterpolatedPositions();
    }

    noopCallback () {}

    _restart () {
        if (this.running) {
            this.stop();
            this.start();
        }
    }

    start () {
        this.running = true;
        this._lastStepTime = now();
        this._lastRefreshTime = 0;
        this.deferDraw = false;
        if (this.framerate === 0) {
            this.runtime.currentStepTime = MAX_REFRESH_STEP_TIME;
            this._stepAnimation = animationFrameWrapper(this.refreshStepCallback);
            return;
        }
        this.runtime.currentStepTime = 1000 / this.framerate;
        if (this.interpolation) {
            this._interpolationAnimation = animationFrameWrapper(this.interpolationCallback);
        } else if (shouldUseNoopAnimationFrame(this.framerate)) {
            this._noopAnimation = animationFrameWrapper(this.noopCallback);
        }
        if (this.framerate > MAX_INTERVAL_FRAMERATE) {
            this._stepInterval = setInterval(this.fastStepCallback, MIN_INTERVAL_MS);
        } else {
            this._stepInterval = setInterval(this.stepCallback, 1000 / this.framerate);
        }
    }

    stop () {
        this.running = false;
        clearInterval(this._stepInterval);
        this._stepInterval = null;
        if (this._interpolationAnimation) {
            this._interpolationAnimation.cancel();
            this._interpolationAnimation = null;
        }
        if (this._stepAnimation) {
            this._stepAnimation.cancel();
            this._stepAnimation = null;
        }
        if (this._noopAnimation) {
            this._noopAnimation.cancel();
            this._noopAnimation = null;
        }
    }
}

module.exports = FrameLoop;
