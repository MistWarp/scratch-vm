/* eslint-disable no-undefined, prefer-template, no-self-compare */

const isNotActuallyZero = val => {
    if (typeof val !== 'string') return false;
    for (let i = 0; i < val.length; i++) {
        const code = val.charCodeAt(i);
        if ((code >= 48 && code <= 57) || code === 9) {
            return false;
        }
    }
    return true;
};

const listScanGeneric = (list, item, start) => {
    const itemNumber = +item;
    const itemString = ('' + item).toLowerCase();
    if (itemNumber !== itemNumber || (itemNumber === 0 && isNotActuallyZero(item))) {
        for (let i = start; i < list.length; i++) {
            const value = list[i];
            if (value === item || ('' + value).toLowerCase() === itemString) {
                return i;
            }
        }
        return -1;
    }
    for (let i = start; i < list.length; i++) {
        const value = list[i];
        if (typeof value === 'number') {
            if (value === itemNumber) {
                return i;
            }
            continue;
        }
        const n = +value;
        if (n !== n || (n === 0 && isNotActuallyZero(value))) {
            if (('' + value).toLowerCase() === itemString) {
                return i;
            }
        } else if (n === itemNumber) {
            return i;
        }
    }
    return -1;
};
const listScanText = (list, item, start) => {
    const itemString = ('' + item).toLowerCase();
    const first = itemString.charCodeAt(0);
    for (let i = start; i < list.length; i++) {
        const value = list[i];
        if (typeof value === 'string') {
            if (value === item) {
                return i;
            }
            const code = value.charCodeAt(0);
            if (code < 128 && (code > 64 && code < 91 ? code + 32 : code) !== first) {
                continue;
            }
            if (value.toLowerCase() === itemString) {
                return i;
            }
        } else if (typeof value === 'number') {
            if (value - value !== 0 && ('' + value).toLowerCase() === itemString) {
                return i;
            }
        } else if (value === item || ('' + value).toLowerCase() === itemString) {
            return i;
        }
    }
    return -1;
};
const listScanNumber = (list, itemNumber, start) => {
    for (let i = start; i < list.length; i++) {
        const value = list[i];
        if (typeof value === 'number') {
            if (value === itemNumber) {
                return i;
            }
        } else if (typeof value === 'string') {
            const code = value.charCodeAt(0);
            if (code > 57 && code < 128) {
                continue;
            }
            if (+value === itemNumber && (itemNumber !== 0 || !isNotActuallyZero(value))) {
                return i;
            }
        } else if (+value === itemNumber) {
            return i;
        }
    }
    return -1;
};
const listScan = (list, item, start) => {
    if (typeof item === 'number') {
        if (item - item === 0) {
            return listScanNumber(list, item, start);
        }
        if (item !== item) {
            return listScanText(list, item, start);
        }
    } else if (typeof item === 'string') {
        const itemNumber = +item;
        if (itemNumber !== itemNumber || (itemNumber === 0 && isNotActuallyZero(item))) {
            return listScanText(list, item, start);
        }
        if (itemNumber - itemNumber === 0) {
            return listScanNumber(list, itemNumber, start);
        }
    }
    return listScanGeneric(list, item, start);
};
const listIndexExtend = (index, array) => {
    const numbers = index.numbers;
    const strings = index.strings;
    for (let i = index.indexed; i < array.length; i++) {
        const value = array[i];
        if (typeof value === 'number') {
            if (value - value === 0) {
                if (numbers.get(value) === undefined) {
                    numbers.set(value, i);
                }
                continue;
            }
            const key = ('' + value).toLowerCase();
            if (strings.get(key) === undefined) {
                strings.set(key, i);
            }
            if (value === value && numbers.get(value) === undefined) {
                numbers.set(value, i);
            }
        } else if (typeof value === 'string') {
            const key = value.toLowerCase();
            if (strings.get(key) === undefined) {
                strings.set(key, i);
            }
            const code = value.charCodeAt(0);
            if (code > 57 && code < 128 && code !== 73) {
                continue;
            }
            const n = +value;
            if (n === n && !(n === 0 && isNotActuallyZero(value)) && numbers.get(n) === undefined) {
                numbers.set(n, i);
            }
        } else if (typeof value === 'boolean') {
            const key = value ? 'true' : 'false';
            if (strings.get(key) === undefined) {
                strings.set(key, i);
            }
            if (numbers.get(+value) === undefined) {
                numbers.set(+value, i);
            }
        } else {
            return false;
        }
    }
    index.indexed = array.length;
    return true;
};
const listIndexLookup = (index, item) => {
    if (typeof item === 'number') {
        if (item - item === 0) {
            const found = index.numbers.get(item);
            return found === undefined ? -1 : found;
        }
        if (item !== item) {
            const found = index.strings.get('nan');
            return found === undefined ? -1 : found;
        }
    }
    const itemNumber = +item;
    if (itemNumber !== itemNumber || (itemNumber === 0 && isNotActuallyZero(item))) {
        const found = index.strings.get(item.toLowerCase());
        return found === undefined ? -1 : found;
    }
    const byNumber = index.numbers.get(itemNumber);
    if (itemNumber - itemNumber === 0) {
        return byNumber === undefined ? -1 : byNumber;
    }
    const byString = index.strings.get(('' + item).toLowerCase());
    if (byNumber === undefined) {
        return byString === undefined ? -1 : byString;
    }
    return byString === undefined || byNumber < byString ? byNumber : byString;
};
const listFind = (list, item) => {
    const array = list.value;
    const length = array.length;
    if (length < 32 || (typeof item !== 'number' && typeof item !== 'string')) {
        return listScan(array, item, 0);
    }
    let index = list._searchIndex;
    const state = list._monitorUpToDate;
    if (!index) {
        index = list._searchIndex = {
            array: null,
            length: 0,
            indexed: 0,
            scanned: 0,
            patience: 16,
            hits: 0,
            numbers: null,
            strings: null
        };
    }
    if (!(state > 1) || index.array !== array || index.length > length) {
        if (index.numbers !== null) {
            index.patience = index.hits < index.patience * 4 ? Math.min(index.patience * 4, 4096) : 16;
        }
        index.array = array;
        index.indexed = 0;
        index.scanned = 0;
        index.hits = 0;
        index.numbers = null;
        index.strings = null;
        list._monitorUpToDate = state === true || state === 3 ? 3 : 2;
    }
    index.length = length;
    if (index.numbers !== null) {
        if (index.indexed === length || listIndexExtend(index, array)) {
            index.hits++;
            return listIndexLookup(index, item);
        }
        index.numbers = null;
        index.strings = null;
        index.scanned = -Infinity;
        return listScan(array, item, 0);
    }
    const found = listScan(array, item, 0);
    index.scanned += found === -1 ? length : found + 1;
    if (index.scanned >= index.patience * length) {
        index.numbers = new Map();
        index.strings = new Map();
        index.indexed = 0;
        if (!listIndexExtend(index, array)) {
            index.numbers = null;
            index.strings = null;
            index.scanned = -Infinity;
        }
    }
    return found;
};

module.exports = {
    listFind,
    listScan,
    listScanGeneric
};
