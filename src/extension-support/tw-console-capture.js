const CONSOLE_LEVELS = ['log', 'info', 'warn', 'error', 'debug'];

const MAX_CONSOLE_TEXT = 4000;

const formatValue = value => {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
    if (typeof value === 'object' && value !== null) {
        try {
            const text = JSON.stringify(value);
            if (typeof text === 'string') return text;
        } catch (e) {
            return Object.prototype.toString.call(value);
        }
    }
    return String(value);
};

const formatConsoleArgs = args => {
    const text = Array.from(args, formatValue).join(' ');
    return text.length > MAX_CONSOLE_TEXT ? `${text.slice(0, MAX_CONSOLE_TEXT)}...` : text;
};

const locateInStack = (stack, names, lineOffset = 0) => {
    if (!stack || !names) return null;
    for (const frame of String(stack).split('\n')) {
        for (const name of names) {
            if (!name) continue;
            const index = frame.indexOf(`${name}:`);
            if (index === -1) continue;
            const match = /^(\d+):(\d+)/.exec(frame.slice(index + name.length + 1));
            if (match) return {line: Math.max(1, +match[1] - lineOffset), column: +match[2]};
        }
    }
    return null;
};

module.exports = {
    CONSOLE_LEVELS,
    MAX_CONSOLE_TEXT,
    formatConsoleArgs,
    locateInStack
};
