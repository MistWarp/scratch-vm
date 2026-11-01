/* global SharedArrayBuffer */

class Sampler {
    static IDLE = -1;
    static RUNTIME = -2;
    static RENDERER = -3;
    static WARP_TIMER = -4;

    static LEVEL_BASIC = 1;
    static LEVEL_COMMANDS = 2;

    constructor (runtime) {
        this.runtime = runtime;
        this.pc = null;
        this.enableBasic = false;
        this.enableCommands = false;
        this.locations = [];
        this.blockLocations = new Map();
    }

    isAvailable () {
        return typeof SharedArrayBuffer === 'function';
    }

    setEnabled (level) {
        if (level > 0 && !this.isAvailable()) {
            throw new Error('Sampler is not available');
        }

        if (this.pc === null && level > 0) {
            this.pc = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
        }

        this.enableBasic = level >= Sampler.LEVEL_BASIC;
        this.enableCommands = level >= Sampler.LEVEL_COMMANDS;

        this.runtime.resetAllCaches();
    }

    blockToLocation (spriteId, blockId) {
        let spriteLocations = this.blockLocations.get(spriteId);
        if (!spriteLocations) {
            spriteLocations = new Map();
            this.blockLocations.set(spriteId, spriteLocations);
        }

        let location = spriteLocations.get(blockId);
        if (typeof location === 'undefined') {
            this.locations.push({
                blockId,
                spriteId
            });
            location = this.locations.length - 1;
            spriteLocations.set(blockId, location);
        }
        return location;
    }

    locationToBlock (location) {
        if (location < 0) {
            throw new Error(`Tried to get block from a reserved location ID`);
        }
        return this.locations[location];
    }
}

module.exports = Sampler;
