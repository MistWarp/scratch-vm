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
        `${i.string('C')}.substring(Math.max(0, ${i.number('A')} - 1), ` +
        `Math.min(${i.number('B')}, ${i.string('C')}.length))`),
    starts: c('boolean', ({input: i}) => `${i.string('A')}.startsWith(${i.string('B')})`),
    ends: c('boolean', ({input: i}) => `${i.string('A')}.endsWith(${i.string('B')})`),
    toUnicode: c('number', ({input: i}) => `${i.string('A')}.charCodeAt(0)`),
    replace: c('string', ({input: i}) => `${i.string('A')}.replace(${i.string('C')}, ${i.string('B')})`),
    replaceall: c('string', ({input: i}) => `${i.string('A')}.replaceAll(${i.string('C')}, ${i.string('B')})`),
    alltextAfterString: c('string', ({input: i}) =>
        `${i.string('A')}.substring(${i.string('A')}.indexOf(${i.string('B')}) + 1)`),
    alltextBeforeString: c('string', ({input: i}) => `${i.string('A')}.split(${i.string('B')}, 1)[0]`),
    split: c('string', ({input: i}) => `JSON.stringify(${i.string('A')}.split(${i.string('B')}))`),
    splitarray: c('any', ({input: i}) => `${i.string('A')}.split(${i.string('B')})`),
    length: c('number', ({input: i}) => `${i('A')}.length`),
    item: c('string', ({input: i}) => `${i('A')}.split(${i.string('B')})[${i.number('C')}]`),
    squarebrackets: c('any', ({input: i}) => `${i('A')}[${i.string('B')}]`),
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

module.exports = {mistsUtils, core};
