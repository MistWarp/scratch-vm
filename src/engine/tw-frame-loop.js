// Due to the existence of features such as interpolation and "0 FPS" being treated as "screen refresh rate",
// The VM loop logic has become much more complex

/**
 * Numeric ID for RenderWebGL.draw in Profiler instances.
 * @type {number}
 */
let rendererDrawProfilerId = -1;

// Use setTimeout to polyfill requestAnimationFrame in Node.js environments
const _requestAnimationFrame =
    typeof requestAnimationFrame === 'function' ?
        requestAnimationFrame :
        f => setTimeout(f, 1000 / 60);
const _cancelAnimationFrame =
    typeof requestAnimationFrame === 'function' ?
        cancelAnimationFrame :
        clearTimeout;

const taskWrapper = (callback, requestFn, cancelFn) => {
    let id;
    let cancelled = false;
    const handle = () => {
        id = requestFn(handle);
        callback();
    };
    const cancel = () => {
        if (!cancelled) cancelFn(id);
        cancelled = true;
    };
    id = requestFn(handle);
    return {
        cancel
    };
};
// const animationFrameWrapper = callback => {
//     let id;
//     const handle = () => {
//         id = _requestAnimationFrame(handle);
//         callback();
//     };
//     const cancel = () => _cancelAnimationFrame(id);
//     id = _requestAnimationFrame(handle);
//     return {
//         cancel
//     };
// };

class FrameLoop {
    constructor (runtime) {
        this.runtime = runtime;
        this.running = false;
        this.setFramerate(30);
        this.setInterpolation(false);
        this._lastRenderTime = 0;

        this._stepInterval = null;
        // this._interpolationAnimation = null;
        this._renderInterval = null;
    }

    _updateRenderTime () {
        this._lastRenderTime = this._getRenderTime();
    }

    _getRenderTime () {
        return (global.performance || Date).now();
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
    }

    renderCallback () {
        if (this.runtime.renderer) {
            if (this.interpolation && this.framerate !== 0) {
                if (!document.hidden) {
                    this.runtime._renderInterpolatedPositions();
                }
            } else if (
                this._getRenderTime() - this._lastRenderTime >=
                this.runtime.currentStepTime
            ) {
                // @todo: Only render when this.redrawRequested or clones rendered.
                if (this.runtime.profiler !== null) {
                    if (rendererDrawProfilerId === -1) {
                        rendererDrawProfilerId =
                            this.profiler.idByName('RenderWebGL.draw');
                    }
                    this.runtime.profiler.start(rendererDrawProfilerId);
                }
                // tw: do not draw if document is hidden or a rAF loop is running
                // Checking for the animation frame loop is more reliable than using
                // interpolationEnabled in some edge cases
                if (!document.hidden) {
                    this.runtime.renderer.draw();
                }
                if (this.runtime.profiler !== null) {
                    this.runtime.profiler.stop();
                }
            }
            if (this.framerate === 0) {
                this.runtime.currentStepTime =
                    this._getRenderTime() - this._lastRenderTime;
            }
            this._updateRenderTime();
        }
    }

    _restart () {
        if (this.running) {
            this.stop();
            this.start();
        }
    }

    start () {
        this.running = true;
        if (this.framerate === 0) {
            this._stepInterval = this.renderInterval = taskWrapper(
                () => {
                    this.stepCallback();
                    this.renderCallback();
                },
                _requestAnimationFrame,
                _cancelAnimationFrame
            );
        } else {
            // Interpolation should never be enabled when framerate === 0 as that's just redundant
            this._renderInterval = taskWrapper(
                () => this.renderCallback(),
                _requestAnimationFrame,
                _cancelAnimationFrame
            );
            this._stepInterval = taskWrapper(
                this.stepCallback,
                fn => setInterval(fn, 1000 / this.framerate),
                clearInterval
            );
            this.runtime.currentStepTime = 1000 / this.framerate;
        }
    }

    stop () {
        this.running = false;
        clearInterval(this._stepInterval);
        if (this._interpolationAnimation) {
            this._interpolationAnimation.cancel();
        }
        if (this._stepAnimation) {
            this._stepAnimation.cancel();
        }
        this._interpolationAnimation = null;
        this._stepAnimation = null;
    }
}

module.exports = FrameLoop;
