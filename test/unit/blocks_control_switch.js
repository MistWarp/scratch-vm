const test = require('tap').test;
const Control = require('../../src/blocks/scratch3_control');
const Runtime = require('../../src/engine/runtime');

const startSwitch = (c, value) => {
    const thread = {stackFrames: []};
    const swFrame = {};
    thread.stackFrames.push(swFrame);
    c.switch({VALUE: value}, {
        stackFrame: swFrame,
        thread,
        startBranch: () => {}
    });
    return thread;
};

const runCase = (c, thread, value) => {
    let ran = false;
    c.case({VALUE: value}, {
        stackFrame: {},
        thread,
        startBranch: () => {
            ran = true;
        }
    });
    return ran;
};

const runFallthrough = (c, thread, value) => {
    c.caseFallthrough({VALUE: value}, {
        stackFrame: {},
        thread
    });
};

const runDefault = (c, thread) => {
    let ran = false;
    c.default({}, {
        stackFrame: {},
        thread,
        startBranch: () => {
            ran = true;
        }
    });
    return ran;
};

test('case matches case-insensitively', t => {
    const c = new Control(new Runtime());

    let thread = startSwitch(c, 'ABC');
    t.ok(runCase(c, thread, 'abc'), 'lowercase case matches uppercase switch value');

    thread = startSwitch(c, 'abc');
    t.ok(runCase(c, thread, 'ABC'), 'uppercase case matches lowercase switch value');

    thread = startSwitch(c, 'abc');
    t.notOk(runCase(c, thread, 'abd'), 'different value does not match');
    t.end();
});

test('values are compared as strings', t => {
    const c = new Control(new Runtime());

    let thread = startSwitch(c, 5);
    t.ok(runCase(c, thread, '5'), 'number switch value matches string case');

    thread = startSwitch(c, '5.0');
    t.notOk(runCase(c, thread, '5'), 'string comparison is exact apart from case');
    t.end();
});

test('first matching case wins and later cases do not run', t => {
    const c = new Control(new Runtime());

    const thread = startSwitch(c, 'x');
    t.notOk(runCase(c, thread, 'y'), 'non-matching case skipped');
    t.ok(runCase(c, thread, 'x'), 'matching case runs');
    t.notOk(runCase(c, thread, 'x'), 'second matching case does not run');
    t.notOk(runDefault(c, thread), 'default does not run after a match');
    t.end();
});

test('default runs only when nothing matched', t => {
    const c = new Control(new Runtime());

    const thread = startSwitch(c, 'nope');
    t.notOk(runCase(c, thread, 'a'));
    t.notOk(runCase(c, thread, 'b'));
    t.ok(runDefault(c, thread), 'default runs when no case matched');
    t.notOk(runCase(c, thread, 'nope'), 'case after default does not run');
    t.end();
});

test('fallthrough labels chain onto the next case', t => {
    const c = new Control(new Runtime());

    let thread = startSwitch(c, 'Apple');
    runFallthrough(c, thread, 'apple');
    t.ok(runCase(c, thread, 'banana'), 'case runs when a fallthrough label matches');

    thread = startSwitch(c, 'kiwi');
    runFallthrough(c, thread, 'apple');
    t.notOk(runCase(c, thread, 'banana'), 'case skipped when neither label nor value matches');
    t.ok(runDefault(c, thread), 'default runs instead');

    thread = startSwitch(c, 'cherry');
    runFallthrough(c, thread, 'apple');
    t.notOk(runCase(c, thread, 'banana'), 'pending labels consumed by next case');
    t.ok(runCase(c, thread, 'cherry'), 'later case still matches its own value');
    t.end();
});
