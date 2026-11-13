const MAX_SHIFT = 64;

class ArrayUtil {
    static removeAt (array, index) {
        const last = array.length - 1;
        if (!Number.isInteger(index) || index < 0 || index > last || last - index > MAX_SHIFT) {
            array.splice(index, 1);
            return;
        }
        for (let i = index; i < last; i++) {
            array[i] = array[i + 1];
        }
        array.pop();
    }

    static move (array, from, to) {
        const item = array[from];
        const last = array.length - 1;
        if (
            !Number.isInteger(from) || !Number.isInteger(to) ||
            from < 0 || from > last || to < 0 || to > last ||
            from - to > MAX_SHIFT || to - from > MAX_SHIFT
        ) {
            array.splice(from, 1);
            array.splice(to, 0, item);
            return;
        }
        if (to < from) {
            for (let i = from; i > to; i--) {
                array[i] = array[i - 1];
            }
        } else {
            for (let i = from; i < to; i++) {
                array[i] = array[i + 1];
            }
        }
        array[to] = item;
    }
}

module.exports = ArrayUtil;
