const SharedDispatch = require('./shared-dispatch');

const log = require('../util/log');

/**
 * This class serves as the central broker for message dispatch. It expects to operate on the main thread / Window and
 * it must be informed of any Worker threads which will participate in the messaging system. From any context in the
 * messaging system, the dispatcher's "call" method can call any method on any "service" provided in any participating
 * context. The dispatch system will forward function arguments and return values across worker boundaries as needed.
 * @see {WorkerDispatch}
 */
class CentralDispatch extends SharedDispatch {
    constructor () {
        super();

        /**
         * Map of channel name to worker or local service provider.
         * If the entry is a Worker, the service is provided by an object on that worker.
         * Otherwise, the service is provided locally and methods on the service will be called directly.
         * @see {setService}
         * @type {object.<Worker|object>}
         */
        this.services = {};

        /**
         * The constructor we will use to recognize workers.
         * @type {Function}
         */
        this.workerClass = (typeof Worker === 'undefined' ? null : Worker);

        /**
         * List of workers attached to this dispatcher.
         * @type {Array}
         */
        this.workers = [];

        this.workerGuards = new Map();

        this.WORKER_REMOVED_ERROR = 'The extension was unloaded.';
    }

    /**
     * Synchronously call a particular method on a particular service provided locally.
     * Calling this function on a remote service will fail.
     * @param {string} service - the name of the service.
     * @param {string} method - the name of the method.
     * @param {*} [args] - the arguments to be copied to the method, if any.
     * @returns {*} - the return value of the service method.
     */
    callSync (service, method, ...args) {
        const {provider, isRemote} = this._getServiceProvider(service);
        if (provider) {
            if (isRemote) {
                throw new Error(`Cannot use 'callSync' on remote provider for service ${service}.`);
            }

            // TODO: verify correct `this` after switching from apply to spread
            // eslint-disable-next-line prefer-spread
            return provider[method].apply(provider, args);
        }
        throw new Error(`Provider not found for service: ${service}`);
    }

    /**
     * Synchronously set a local object as the global provider of the specified service.
     * WARNING: Any method on the provider can be called from any worker within the dispatch system.
     * @param {string} service - a globally unique string identifying this service. Examples: 'vm', 'gui', 'extension9'.
     * @param {object} provider - a local object which provides this service.
     */
    setServiceSync (service, provider) {
        if (Object.prototype.hasOwnProperty.call(this.services, service)) {
            log.warn(`Central dispatch replacing existing service provider for ${service}`);
        }
        this.services[service] = provider;
    }

    /**
     * Set a local object as the global provider of the specified service.
     * WARNING: Any method on the provider can be called from any worker within the dispatch system.
     * @param {string} service - a globally unique string identifying this service. Examples: 'vm', 'gui', 'extension9'.
     * @param {object} provider - a local object which provides this service.
     * @returns {Promise} - a promise which will resolve once the service is registered.
     */
    setService (service, provider) {
        /** Return a promise for consistency with {@link WorkerDispatch#setService} */
        try {
            this.setServiceSync(service, provider);
            return Promise.resolve();
        } catch (e) {
            return Promise.reject(e);
        }
    }

    /**
     * Add a worker to the message dispatch system. The worker must implement a compatible message dispatch framework.
     * The dispatcher will immediately attempt to "handshake" with the worker.
     * @param {Worker} worker - the worker to add into the dispatch system.
     * @param {{call: Function, setService: Function}} [guard] - limits what the worker may call and register.
     */
    addWorker (worker, guard) {
        if (this.workers.indexOf(worker) === -1) {
            this.workers.push(worker);
            if (guard) this.workerGuards.set(worker, guard);
            worker.onmessage = this._onMessage.bind(this, worker);
            this._remoteCall(worker, 'dispatch', 'handshake').catch(e => {
                if (e === this.WORKER_REMOVED_ERROR) return;
                log.error(`Could not handshake with worker: ${e}`);
            });
        } else {
            log.warn('Central dispatch ignoring attempt to add duplicate worker');
        }
    }

    removeWorker (worker) {
        const index = this.workers.indexOf(worker);
        if (index !== -1) this.workers.splice(index, 1);
        this.workerGuards.delete(worker);
        for (const service of Object.keys(this.services)) {
            if (this.services[service] === worker) delete this.services[service];
        }
        for (const responseId of Object.keys(this.callbacks)) {
            const callback = this.callbacks[responseId];
            if (callback && callback[2] === worker) {
                delete this.callbacks[responseId];
                callback[1](this.WORKER_REMOVED_ERROR);
            }
        }
        worker.onmessage = null;
        if (typeof worker.terminate === 'function') worker.terminate();
    }

    /**
     * Fetch the service provider object for a particular service name.
     * @override
     * @param {string} service - the name of the service to look up
     * @returns {{provider:(object|Worker), isRemote:boolean}} - the means to contact the service, if found
     * @protected
     */
    _getServiceProvider (service) {
        const provider = this.services[service];
        return provider && {
            provider,
            isRemote: Boolean((this.workerClass && provider instanceof this.workerClass) || provider.isRemote)
        };
    }

    /**
     * Handle a call message sent to the dispatch service itself
     * @override
     * @param {Worker} worker - the worker which sent the message.
     * @param {DispatchCallMessage} message - the message to be handled.
     * @returns {Promise|undefined} - a promise for the results of this operation, if appropriate
     * @protected
     */
    _onDispatchMessage (worker, message) {
        let promise;
        switch (message.method) {
        case 'setService': {
            const guard = this.workerGuards.get(worker);
            const service = message.args[0];
            if (guard && (
                !guard.setService(service) ||
                (Object.prototype.hasOwnProperty.call(this.services, service) && this.services[service] !== worker)
            )) {
                promise = Promise.reject(new Error(`Not allowed to register service ${service}`));
                break;
            }
            promise = this.setService(service, worker);
            break;
        }
        default:
            log.error(`Central dispatch received message for unknown method: ${message.method}`);
        }
        return promise;
    }

    _onWorkerCall (worker, message) {
        const guard = this.workerGuards.get(worker);
        if (!guard) return super._onWorkerCall(worker, message);
        try {
            return Promise.resolve(guard.call(message.service, message.method, message.args));
        } catch (e) {
            return Promise.reject(e);
        }
    }

    _deliverResponse (responseId, message, worker) {
        const callback = this.callbacks[responseId];
        if (callback && callback[2] && worker && callback[2] !== worker) {
            log.warn('Central dispatch ignoring a response from a worker the call was not sent to');
            return;
        }
        super._deliverResponse(responseId, message);
    }
}

module.exports = new CentralDispatch();
