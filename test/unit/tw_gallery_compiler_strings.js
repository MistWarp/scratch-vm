const test = require('tap').test;
const VirtualMachine = require('../../src/virtual-machine');
const Cast = require('../../src/util/cast');

let splitCache;
let matchCache;

const caseInsensitiveRegex = str => new RegExp(str.replaceAll(/[^a-zA-Z0-9]/g, '\\$&'), 'gi');

const refSplit = (string, split) => {
    if (!(splitCache && splitCache.string === string && splitCache.split === split)) {
        splitCache = {string, split, arr: string.split(caseInsensitiveRegex(split))};
    }
    return splitCache.arr;
};

const refMatch = (string, regex, flags) => {
    if (matchCache && matchCache.string === string && matchCache.regex === regex && matchCache.flags === flags) {
        return matchCache.arr;
    }
    try {
        const newFlags = flags.includes('g') ? flags : `${flags}g`;
        const arr = string.match(new RegExp(regex, newFlags)) || [];
        matchCache = {string, regex, flags, arr};
        return arr;
    } catch (e) {
        return null;
    }
};

const refToCase = (string, textCase) => {
    let workingText = '';
    let sentenceCapitalFlag = false;
    switch (textCase) {
    case 'lowercase': return string.toLowerCase();
    case 'uppercase': return string.toUpperCase();
    case 'mixedcase': return Array.from(string)
        .map((char, index) => (index % 2 === 0 ? char.toUpperCase() : char.toLowerCase()))
        .join('');
    case 'titlecase': return string.split(/\b/g)
        .map(word => (word ? word[0].toUpperCase() + word.substring(1) : ''))
        .join('');
    case 'exacttitlecase': return string.split(/\b/g)
        .map(word => (word ? word[0].toUpperCase() + word.substring(1).toLowerCase() : ''))
        .join('');
    case 'sentencecase':
        for (let i = 0; i < string.length; i++) {
            if (/^\s*$/.test(string[i - 1] ?? ' ') && !sentenceCapitalFlag &&
                string[i].toUpperCase() !== string[i].toLowerCase()) {
                workingText += string[i].toUpperCase();
                sentenceCapitalFlag = true;
            } else {
                if (string[i] === '.' || string[i] === '!' || string[i] === '?') {
                    sentenceCapitalFlag = false;
                }
                workingText += string[i].toLowerCase();
            }
        }
        return workingText;
    case 'camelcase':
        for (let i = 0; i < string.length; i++) {
            if (/^\s*$/.test(string[i - 1] ?? 'x')) {
                workingText += string[i].toUpperCase();
            } else {
                workingText += string[i].toLowerCase();
            }
        }
        return workingText.replace(/\s/g, '');
    default: return string;
    }
};

const refIsCase = (string, textCase) => {
    switch (textCase) {
    case 'lowercase': return string.toLowerCase() === string;
    case 'uppercase': return string.toUpperCase() === string;
    case 'mixedcase': return !(string.toUpperCase() === string || string.toLowerCase() === string);
    case 'titlecase': return string.split(/\b/g).every(word => {
        if (!word) return true;
        return word === word[0].toUpperCase() + word.substring(1);
    });
    case 'exacttitlecase': return string.split(/\b/g).every(word => {
        if (!word) return true;
        return word === word[0].toUpperCase() + word.substring(1).toLowerCase();
    });
    case 'camelcase': return /^[^A-Z\s][^\s]*$/.test(string);
    case 'randomcase': return true;
    case 'sentencecase': return /^[A-Z][^?.!]*(?:[?.!]\s+[A-Z][^?.!]*)*$/.test(string);
    default: return false;
    }
};

const reference = {
    letters_of: v => Cast.toString(v.s).substring(Cast.toNumber(v.num) - 1, Cast.toNumber(v.num2)),
    split: v => refSplit(Cast.toString(v.s), Cast.toString(v.sub))[Cast.toNumber(v.num) - 1] || '',
    count: v => refSplit(Cast.toString(v.s), Cast.toString(v.sub)).length - 1 || 0,
    indexof: v => Cast.toString(v.s).toLowerCase()
        .indexOf(Cast.toString(v.sub).toLowerCase()) + 1,
    replace: v => Cast.toString(v.s).replace(caseInsensitiveRegex(Cast.toString(v.sub)), Cast.toString(v.rep)),
    repeat: v => {
        const repeat = Math.floor(Cast.toNumber(v.num));
        const s = Cast.toString(v.s);
        if (repeat < 0 || !Number.isFinite(repeat) || s.length * repeat > 1e7) return '';
        return s.repeat(repeat);
    },
    unicodeof: v => Array.from(Cast.toString(v.s)).map(char => char.charCodeAt(0))
        .join(' '),
    unicodefrom: v => String.fromCharCode(Cast.toNumber(v.num)),
    replaceRegex: v => {
        try {
            return Cast.toString(v.s).replace(new RegExp(Cast.toString(v.re), Cast.toString(v.fl)), Cast.toString(v.rep));
        } catch (e) {
            return '';
        }
    },
    matchRegex: v => {
        const arr = refMatch(Cast.toString(v.s), Cast.toString(v.re), Cast.toString(v.fl));
        return arr === null ? '' : arr[Cast.toNumber(v.num) - 1] || '';
    },
    matchRegexJSON: v => {
        const arr = refMatch(Cast.toString(v.s), Cast.toString(v.re), Cast.toString(v.fl));
        return arr === null ? '' : JSON.stringify(arr) || '[]';
    },
    testRegex: v => {
        try {
            return new RegExp(Cast.toString(v.re), Cast.toString(v.fl)).test(Cast.toString(v.s));
        } catch (e) {
            return false;
        }
    },
    countRegex: v => {
        const arr = refMatch(Cast.toString(v.s), Cast.toString(v.re), Cast.toString(v.fl));
        return arr === null ? 0 : arr.length || 0;
    },
    identical: v => v.op1 === v.op2,
    isCase: v => refIsCase(Cast.toString(v.s), Cast.toString(v.tcase)),
    toCase: v => refToCase(Cast.toString(v.s), Cast.toString(v.tcase)),
    posWith: v => {
        const string = Cast.toString(v.s);
        const sub = Cast.toString(v.sub);
        return Cast.toString(v.tcase) === 'starts' ? string.startsWith(sub) : string.endsWith(sub);
    },
    reverse: v => Array.from(Cast.toString(v.s)).reverse()
        .join(''),
    trim: v => {
        const string = Cast.toString(v.s);
        switch (Cast.toString(v.tcase)) {
        case 'start': return string.trimStart();
        case 'end': return string.trimEnd();
        default: return string.trim();
        }
    }
};

const INPUT_MAP = {
    letters_of: {STRING: 's', LETTER1: 'num', LETTER2: 'num2'},
    split: {STRING: 's', SPLIT: 'sub', ITEM: 'num'},
    count: {STRING: 's', SUBSTRING: 'sub'},
    indexof: {STRING: 's', SUBSTRING: 'sub'},
    replace: {STRING: 's', SUBSTRING: 'sub', REPLACE: 'rep'},
    repeat: {STRING: 's', REPEAT: 'num'},
    unicodeof: {STRING: 's'},
    unicodefrom: {NUM: 'num'},
    replaceRegex: {STRING: 's', REPLACE: 'rep', REGEX: 're', FLAGS: 'fl'},
    matchRegex: {STRING: 's', REGEX: 're', FLAGS: 'fl', ITEM: 'num'},
    matchRegexJSON: {STRING: 's', REGEX: 're', FLAGS: 'fl'},
    testRegex: {STRING: 's', REGEX: 're', FLAGS: 'fl'},
    countRegex: {STRING: 's', REGEX: 're', FLAGS: 'fl'},
    identical: {OPERAND1: 'op1', OPERAND2: 'op2'},
    isCase: {STRING: 's', TEXTCASE: 'tcase'},
    toCase: {STRING: 's', TEXTCASE: 'tcase'},
    posWith: {STRING: 's', SUBSTRING: 'sub', POSITION: 'tcase'},
    reverse: {STRING: 's'},
    trim: {STRING: 's', METHOD: 'tcase'}
};

const VAR_NAMES = ['s', 'sub', 'rep', 'num', 'num2', 're', 'fl', 'tcase', 'op1', 'op2'];

const makeProject = () => {
    const variables = {};
    for (const name of VAR_NAMES) variables[`v_${name}`] = [name, 0];
    const blocks = {
        hat: {opcode: 'event_whenflagclicked', next: 'set_letters_of', parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true, x: 0, y: 0}
    };
    const ops = Object.keys(INPUT_MAP);
    for (let index = 0; index < ops.length; index++) {
        const op = ops[index];
        const setId = `set_${op}`;
        const opId = `op_${op}`;
        const nextSet = index + 1 < ops.length ? `set_${ops[index + 1]}` : null;
        variables[`vr_${op}`] = [`r_${op}`, 0];
        blocks[setId] = {
            opcode: 'data_setvariableto', next: nextSet, parent: null,
            inputs: {VALUE: [3, opId, [10, '']]},
            fields: {VARIABLE: [`r_${op}`, `vr_${op}`]}, shadow: false, topLevel: false
        };
        const inputs = {};
        for (const [inputName, varName] of Object.entries(INPUT_MAP[op])) {
            inputs[inputName] = [3, [12, varName, `v_${varName}`], [10, '']];
        }
        blocks[opId] = {
            opcode: `strings_${op}`, next: null, parent: setId,
            inputs, fields: {}, shadow: false, topLevel: false
        };
    }
    return {
        targets: [{
            isStage: true, name: 'Stage', variables, lists: {}, broadcasts: {},
            blocks, comments: {}, currentCostume: 0, costumes: [], sounds: [],
            volume: 100, layerOrder: 0, tempo: 60, videoTransparency: 50, videoState: 'off', textToSpeechLanguage: null
        }],
        monitors: [], extensions: [], meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
    };
};

const STRINGS = [
    '', 'abc', 'ABC', 'AbC dEf', 'Hello world. this is a Test! ok?',
    '  padded  ', 'a,b,,c', 'héllo wörld', '123', '-1.5',
    'ONE two Three', 'camelCase', 'Title Case Words', 'aa,AA,aa', 'a.b?c!d'
];
const SUBS = ['', ',', 'l', 'L', '.', ' ', 'aa'];
const REPS = ['x', '$&-'];
const NUMS = [1, 2, 0, -1, 3, 2.5];
const NUMS2 = [3, 100, 1];
const RES = ['[a-z]+', '\\d+', '(.)', 'l', '['];
const FLS = ['', 'gi', 'i', 'x'];
const CASES = [
    'lowercase', 'uppercase', 'mixedcase', 'titlecase', 'exacttitlecase',
    'camelcase', 'sentencecase', 'bogus', 'starts', 'ends', 'start', 'end', 'both'
];
const OPS_VALUES = [1, '1', 'abc', true, 0, ''];

test('gallery strings compiler matches extension semantics', async t => {
    const vm = new VirtualMachine();
    vm.setCompilerOptions({enabled: true, warpTimer: false});
    vm.extensionManager.isExtensionLoaded = () => true;
    for (const op of Object.keys(INPUT_MAP)) {
        vm.runtime._primitives[`strings_${op}`] = () => {
            throw new Error(`compat path used for ${op}`);
        };
    }
    vm.on('COMPILE_ERROR', (target, error) => t.fail(`compile error: ${error}`));

    await vm.loadProject(JSON.stringify(makeProject()));
    vm.runtime.precompile();
    vm.runtime.start = () => {};

    const stage = vm.runtime.getTargetForStage();
    const byName = {};
    for (const id of Object.keys(stage.variables)) {
        byName[stage.variables[id].name] = stage.variables[id];
    }

    let checks = 0;
    let failures = 0;
    for (let iteration = 0; iteration < STRINGS.length * SUBS.length; iteration++) {
        const v = {
            s: STRINGS[iteration % STRINGS.length],
            sub: SUBS[Math.floor(iteration / STRINGS.length) % SUBS.length],
            rep: REPS[iteration % REPS.length],
            num: NUMS[iteration % NUMS.length],
            num2: NUMS2[iteration % NUMS2.length],
            re: RES[iteration % RES.length],
            fl: FLS[iteration % FLS.length],
            tcase: CASES[iteration % CASES.length],
            op1: OPS_VALUES[iteration % OPS_VALUES.length],
            op2: OPS_VALUES[(iteration + 1) % OPS_VALUES.length]
        };
        for (const name of VAR_NAMES) byName[name].value = v[name];
        vm.greenFlag();
        for (let i = 0; i < 100 && vm.runtime.threads.some(thread => !thread.isKilled); i++) {
            vm.runtime._step();
        }
        for (const op of Object.keys(INPUT_MAP)) {
            const expected = reference[op](v);
            const actual = byName[`r_${op}`].value;
            if (!Object.is(actual, expected)) {
                failures++;
                if (failures < 20) {
                    t.fail(`${op} with ${JSON.stringify(v)}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
                }
            }
            checks++;
        }
    }
    t.equal(failures, 0, `no mismatches out of ${checks} checks`);
    t.end();
});
