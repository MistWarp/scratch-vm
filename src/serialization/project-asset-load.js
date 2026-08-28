/**
 * Project-scoped asset caches and progress accounting for SB3 loading.
 * Raw assets and decoded data may be shared. Costume and sound objects are not.
 */
class ProjectAssetLoad {
    constructor (runtime) {
        this.runtime = runtime;
        this.assetPromises = new Map();
        this.soundBufferPromises = new Map();
        this.imagePromises = new Map();
        this.downloadPromises = [];
        this.downloadCompleted = 0;
        this.preparationTotal = 0;
        this.preparationCompleted = 0;
        this.started = false;
        this.preparationBarrier = new Promise(resolve => {
            this.resolvePreparationBarrier = resolve;
        });
    }

    static key (assetType, assetId, dataFormat) {
        const type = assetType && assetType.name ? assetType.name : String(assetType);
        return `${type}\0${assetId || ''}\0${String(dataFormat || '').toLowerCase()}`;
    }

    loadAsset (assetType, assetId, dataFormat, loader) {
        const key = ProjectAssetLoad.key(assetType, assetId, dataFormat);
        let promise = this.assetPromises.get(key);
        if (!promise) {
            promise = Promise.resolve().then(loader);
            this.assetPromises.set(key, promise);
            this.downloadPromises.push(promise.then(
                result => {
                    this.downloadCompleted++;
                    this._emit('download');
                    return result;
                },
                error => {
                    this.downloadCompleted++;
                    this._emit('download');
                    if (this.assetPromises.get(key) === promise) this.assetPromises.delete(key);
                    throw error;
                }
            ));
        }
        return promise;
    }

    prepareReference (assetPromise, prepare) {
        this.preparationTotal++;
        return this.preparationBarrier
            .then(() => prepare(assetPromise))
            .finally(() => {
                this.preparationCompleted++;
                this._emit('prepare');
            });
    }

    cacheSoundBuffer (assetType, assetId, dataFormat, decode) {
        return this._cachePromise(this.soundBufferPromises,
            ProjectAssetLoad.key(assetType, assetId, dataFormat), decode);
    }

    cacheImage (asset, decode) {
        const key = ProjectAssetLoad.key(asset.assetType, asset.assetId, asset.dataFormat);
        return this._cachePromise(this.imagePromises, key, decode);
    }

    _cachePromise (cache, key, create) {
        let promise = cache.get(key);
        if (!promise) {
            promise = Promise.resolve().then(create);
            cache.set(key, promise);
            promise.catch(() => {
                if (cache.get(key) === promise) cache.delete(key);
            });
        }
        return promise;
    }

    finishDiscovery () {
        this.started = true;
        this._emit('download');
        Promise.all(this.downloadPromises.map(promise => promise.catch(() => null)))
            .then(() => {
                this._emit('prepare');
                this.resolvePreparationBarrier();
            });
    }

    _emit (phase) {
        if (!this.started) return;
        const downloadTotal = this.downloadPromises.length;
        const overallTotal = downloadTotal + this.preparationTotal;
        const overallCompleted = this.downloadCompleted + this.preparationCompleted;
        const completed = phase === 'download' ? this.downloadCompleted : this.preparationCompleted;
        const total = phase === 'download' ? downloadTotal : this.preparationTotal;
        this.runtime.finishedAssetRequests = overallCompleted;
        this.runtime.totalAssetRequests = overallTotal;
        this.runtime.emitAssetProgress({
            phase,
            completed,
            total,
            overallCompleted,
            overallTotal
        });
    }
}

module.exports = ProjectAssetLoad;
