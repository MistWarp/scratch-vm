const c = (type, compile) => Object.freeze({type, compile});

const mistsUtils = Object.freeze({
    notequals: c('boolean', ({input: i}) => `(${i.string('A')} !== ${i.string('B')})`),
    equals: c('boolean', ({input: i}) => `(${i.string('A')} === ${i.string('B')})`),
    greaterorequal: c('boolean', ({input: i}) => `(${i.number('A')} >= ${i.number('B')})`),
    lessthanorequal: c('boolean', ({input: i}) => `(${i.number('A')} <= ${i.number('B')})`),
    compare: c('boolean', ({input: i}) => `(${i.number('A')} ${i.raw('C')} ${i.number('B')})`),
    power: c('number', ({input: i}) => `Math.pow(${i.number('A')}, ${i.number('B')})`),
    round: c('number', ({input: i}) => `(Math.round(${i.number('A')} / ${i.number('B')}) * ${i.number('B')})`),
    clamp: c('number', ({input: i}) => `Math.min(Math.max(${i.number('A')}, ${i.number('B')}), ${i.number('C')})`),
    min: c('number', ({input: i}) => `Math.min(${i.number('A')}, ${i.number('B')})`),
    max: c('number', ({input: i}) => `Math.max(${i.number('A')}, ${i.number('B')})`),
    interpolate: c('number', ({input: i}) =>
        `(${i.number('B')} + ((${i.number('C')} - ${i.number('B')}) / ${i.number('A')}))`),
    ifthen: c('string', ({input: i}) => `(${i.boolean('A')} ? ${i.string('B')} : ${i.string('C')})`),
    letters: c('string', ({input: i}) =>
        `(${i.string('C')}).substring(Math.max(0, ${i.number('A')} - 1), ` +
        `Math.min(${i.number('B')}, (${i.string('C')}).length))`),
    starts: c('boolean', ({input: i}) => `(${i.string('A')}).startsWith(${i.string('B')})`),
    ends: c('boolean', ({input: i}) => `(${i.string('A')}).endsWith(${i.string('B')})`),
    toUnicode: c('number', ({input: i}) => `(${i.string('A')}).charCodeAt(0)`),
    replace: c('string', ({input: i}) => `(${i.string('A')}).replace(${i.string('C')}, ${i.string('B')})`),
    replaceall: c('string', ({input: i}) => `(${i.string('A')}).replaceAll(${i.string('C')}, ${i.string('B')})`),
    alltextAfterString: c('string', ({input: i}) =>
        `(${i.string('A')}).substring((${i.string('A')}).indexOf(${i.string('B')}) + 1)`),
    alltextBeforeString: c('string', ({input: i}) => `(${i.string('A')}).split(${i.string('B')}, 1)[0]`),
    split: c('string', ({input: i}) => `JSON.stringify((${i.string('A')}).split(${i.string('B')}))`),
    splitarray: c('any', ({input: i}) => `(${i.string('A')}).split(${i.string('B')})`),
    length: c('number', ({input: i}) => `(${i('A')}).length`),
    item: c('string', ({input: i}) => `(${i('A')}).split(${i.string('B')})[${i.number('C')}]`),
    squarebrackets: c('any', ({input: i}) => `(${i('A')})[${i.string('B')}]`),
    jsonparse: c('any', ({input: i}) => `JSON.parse(${i.string('A')})`),
    jsonstringify: c('string', ({input: i}) => `JSON.stringify(${i('A')})`),
    isnumber: c('boolean', ({input: i}) => `(Number(${i.string('A')}) == ${i.string('A')})`),
    isstring: c('boolean', ({input: i}) => `(String(${i.string('A')}) == ${i.string('A')})`),
    isboolean: c('boolean', ({input: i}) => `(${i.string('A')} == "true" || ${i.string('A')} == "false")`),
    tostring: c('string', ({input: i}) => i.string('A')),
    tonumber: c('number', ({input: i}) => `(isNaN(Number(${i.string('A')})) ? 0 : Number(${i.string('A')}))`),
    toboolean: c('boolean', ({input: i}) =>
        `(${i.string('A')} == "true" || ${i.string('A')} == "1" || ${i.string('A')} == "yes")`),
    true: c('boolean', () => 'true'),
    false: c('boolean', () => 'false'),
    isPackaged: c('boolean', () => `(typeof window.scaffolding === 'object')`),
    performancenow: c('number', () => 'performance.now()'),
    stagewidth: c('number', ({runtime}) => `${runtime}.stageWidth`),
    stageheight: c('number', ({runtime}) => `${runtime}.stageHeight`),
    newline: c('string', () => '"\\n"'),
    pi: c('number', () => 'Math.PI'),
    e: c('number', () => 'Math.E'),
    infinity: c('number', () => 'Infinity'),
    MaxInt: c('number', () => 'Number.MAX_SAFE_INTEGER')
});

const variadic = (name, input, mutation) => {
    const count = Math.max(2, parseInt(mutation.itemcount, 10) || 2);
    return `Math.${name}(${Array.from({length: count}, (_, index) => input.number(`NUM${index + 1}`)).join(',')})`;
};

const core = Object.freeze({
    sensing_stagewidth: c('number', ({runtime}) => `${runtime}.stageWidth`),
    sensing_stageheight: c('number', ({runtime}) => `${runtime}.stageHeight`),
    operator_clamp: c('number', ({input: i}) =>
        `Math.min(Math.max(${i.number('NUM')}, ${i.number('MIN')}), ${i.number('MAX')})`),
    operator_min: c('number', ({input, mutation}) => variadic('min', input, mutation)),
    operator_max: c('number', ({input, mutation}) => variadic('max', input, mutation))
});

const int32Binary = op => c('number', ({input: i}) => `(${i.numberOrNaN('LEFT')} ${op} ${i.numberOrNaN('RIGHT')})`);

const gallery = Object.freeze({
    Bitwise_bitwiseAnd: int32Binary('&'),
    Bitwise_bitwiseOr: int32Binary('|'),
    Bitwise_bitwiseXor: int32Binary('^'),
    Bitwise_bitwiseRightShift: int32Binary('>>'),
    Bitwise_bitwiseLeftShift: int32Binary('<<'),
    Bitwise_bitwiseLogicalRightShift: int32Binary('>>>'),
    Bitwise_bitwiseNot: c('number', ({input: i}) => `(~${i.numberOrNaN('CENTRAL')})`),
    Bitwise_bitwiseCircularRightShift: c('number', ({input: i}) =>
        `((l, r) => (l >>> r) | (l << (32 - r)))(${i.numberOrNaN('LEFT')}, ${i.numberOrNaN('RIGHT')})`),
    Bitwise_bitwiseCircularLeftShift: c('number', ({input: i}) =>
        `((l, r) => (l << r) | (l >>> (32 - r)))(${i.numberOrNaN('LEFT')}, ${i.numberOrNaN('RIGHT')})`),
    Bitwise_isNumberBits: c('boolean', ({input: i}) => `/^-?[01]+$/.test(${i.string('CENTRAL')})`),
    Bitwise_toNumberBits: c('string', ({input: i}) => `(${i.number('CENTRAL')}).toString(2)`),
    Bitwise_ofNumberBits: c('number', ({input: i}) =>
        `(s => /^-?[01]+$/.test(s) ? parseInt(s, 2) || 0 : 0)(${i.string('CENTRAL')})`),

    strings_letters_of: c('string', ({input: i}) =>
        `(${i.string('STRING')}).substring(${i.number('LETTER1')} - 1, ${i.number('LETTER2')})`),
    strings_split: c('string', ({input: i}) =>
        `(txtSplit(${i.string('STRING')}, ${i.string('SPLIT')})[(${i.number('ITEM')}) - 1] || "")`),
    strings_count: c('number', ({input: i}) =>
        `(txtSplit(${i.string('STRING')}, ${i.string('SUBSTRING')}).length - 1 || 0)`),
    strings_indexof: c('number', ({input: i}) =>
        `((${i.string('STRING')}).toLowerCase().indexOf((${i.string('SUBSTRING')}).toLowerCase()) + 1)`),
    strings_replace: c('string', ({input: i}) =>
        `(${i.string('STRING')}).replace(txtCiRegex(${i.string('SUBSTRING')}), ${i.string('REPLACE')})`),
    strings_repeat: c('string', ({input: i}) =>
        `((s, r) => (r < 0 || !Number.isFinite(r) || s.length * r > 1e7 ? "" : s.repeat(r)))` +
        `(${i.string('STRING')}, Math.floor(${i.number('REPEAT')}))`),
    strings_unicodeof: c('string', ({input: i}) =>
        `Array.from(${i.string('STRING')}).map(char => char.charCodeAt(0)).join(" ")`),
    strings_unicodefrom: c('string', ({input: i}) => `String.fromCharCode(${i.number('NUM')})`),
    strings_replaceRegex: c('string', ({input: i}) =>
        '((s, rp, re, f) => { try { return s.replace(new RegExp(re, f), rp); } ' +
        'catch (e) { console.error(e); return ""; } })' +
        `(${i.string('STRING')}, ${i.string('REPLACE')}, ${i.string('REGEX')}, ${i.string('FLAGS')})`),
    strings_matchRegex: c('string', ({input: i}) =>
        `(a => (a === null ? "" : a[(${i.number('ITEM')}) - 1] || ""))` +
        `(txtMatch(${i.string('STRING')}, ${i.string('REGEX')}, ${i.string('FLAGS')}))`),
    strings_matchRegexJSON: c('string', ({input: i}) =>
        '(a => (a === null ? "" : JSON.stringify(a) || "[]"))' +
        `(txtMatch(${i.string('STRING')}, ${i.string('REGEX')}, ${i.string('FLAGS')}))`),
    strings_testRegex: c('boolean', ({input: i}) =>
        `((s, re, f) => { try { return new RegExp(re, f).test(s); } catch (e) { console.error(e); return false; } })` +
        `(${i.string('STRING')}, ${i.string('REGEX')}, ${i.string('FLAGS')})`),
    strings_countRegex: c('number', ({input: i}) =>
        '(a => (a === null ? 0 : a.length || 0))' +
        `(txtMatch(${i.string('STRING')}, ${i.string('REGEX')}, ${i.string('FLAGS')}))`),
    strings_identical: c('boolean', ({input: i}) => `(${i('OPERAND1')} === ${i('OPERAND2')})`),
    strings_isCase: c('boolean', ({input: i}) => `txtIsCase(${i.string('STRING')}, ${i.string('TEXTCASE')})`),
    strings_toCase: c('string', ({input: i}) => `txtToCase(${i.string('STRING')}, ${i.string('TEXTCASE')})`),
    strings_posWith: c('boolean', ({input: i}) =>
        `(${i.string('POSITION')} === "starts" ? ` +
        `(${i.string('STRING')}).startsWith(${i.string('SUBSTRING')}) : ` +
        `(${i.string('STRING')}).endsWith(${i.string('SUBSTRING')}))`),
    strings_reverse: c('string', ({input: i}) => `Array.from(${i.string('STRING')}).reverse().join("")`),
    strings_trim: c('string', ({input: i}) =>
        '((s, m) => (m === "start" ? s.trimStart() : m === "end" ? s.trimEnd() : s.trim()))' +
        `(${i.string('STRING')}, ${i.string('METHOD')})`),

    truefantombase_is_base_block: c('boolean', ({input: i}) => `tfBaseIs(${i.string('A')}, ${i.string('B')})`),
    truefantombase_base_block: c('string', ({input: i}) =>
        `tfBase(${i.string('A')}, ${i.string('B')}, ${i.string('C')})`)
});

module.exports = {mistsUtils, core, gallery};
