const test = require('tap').test;

const Cast = require('../../src/util/cast');
const Color = require('../../src/util/color');
const Timer = require('../../src/util/timer');

test('Cast.toNumber and toBoolean basics', t => {
    t.equal(Cast.toNumber(5), 5);
    t.equal(Cast.toNumber('10'), 10);
    t.equal(Cast.toNumber('not a number'), 0);
    t.equal(Cast.toNumber(NaN), 0);

    t.equal(Cast.toBoolean(true), true);
    t.equal(Cast.toBoolean(false), false);
    t.equal(Cast.toBoolean(''), false);
    t.equal(Cast.toBoolean('0'), false);
    t.equal(Cast.toBoolean('FALSE'), false);
    t.equal(Cast.toBoolean('hello'), true);
    t.end();
});

test('Cast string/whitespace and isInt', t => {
    t.equal(Cast.isWhiteSpace(null), true);
    t.equal(Cast.isWhiteSpace('   '), true);
    t.equal(Cast.isWhiteSpace('a'), false);

    t.equal(Cast.isInt(2.0), true);
    t.equal(Cast.isInt(2.5), false);
    t.equal(Cast.isInt(true), true);
    t.equal(Cast.isInt('3'), true);
    t.equal(Cast.isInt('3.1'), false);
    t.end();
});

test('Cast.toRgbColorObject with hex and decimal', t => {
    const fromHex = Cast.toRgbColorObject('#FF0000');
    t.equal(fromHex.r, 255);
    t.equal(fromHex.g, 0);
    t.equal(fromHex.b, 0);

    const fromShortHex = Cast.toRgbColorObject('#0F0');
    t.equal(fromShortHex.r, 0);
    t.equal(fromShortHex.g, 255);

    const fromDecimal = Cast.toRgbColorObject(0x0000FF);
    t.equal(fromDecimal.b, 255);
    t.end();
});

test('Cast.toListIndex special cases', t => {
    t.equal(Cast.toListIndex('all', 3, true), Cast.LIST_ALL);
    t.equal(Cast.toListIndex('all', 3, false), Cast.LIST_INVALID);
    t.equal(Cast.toListIndex('last', 2, false), 2);
    t.equal(Cast.toListIndex('last', 0, false), Cast.LIST_INVALID);
    // random/any with length 0 -> invalid
    t.equal(Cast.toListIndex('random', 0, false), Cast.LIST_INVALID);
    // numeric out of range
    t.equal(Cast.toListIndex(100, 3, false), Cast.LIST_INVALID);
    t.equal(Cast.toListIndex(2, 3, false), 2);
    t.end();
});

test('Color conversions', t => {
    t.equal(Color.decimalToHex(0x112233), '#112233');
    t.equal(Color.decimalToHex(-1), '#ffffff');

    const rgb = Color.decimalToRgb(0x00FF00);
    t.equal(rgb.g, 255);

    t.same(Color.hexToRgb('#0033FF'), {r:0,g:51,b:255});
    t.same(Color.hexToRgb('03F'), {r:0,g:51,b:255});
    t.equal(Color.hexToRgb('zzz'), null);

    const dec = Color.rgbToDecimal({r:1,g:2,b:3});
    t.equal(dec, 0x010203);

    t.equal(Color.rgbToHex({r:255,g:0,b:0}), '#ff0000');

    // hsv <-> rgb roundtrip for a sample
    const hsv = {h: 120, s: 1, v: 1};
    const rgbFromH = Color.hsvToRgb(hsv);
    const hsvBack = Color.rgbToHsv(rgbFromH);
    t.ok(Math.abs(hsvBack.v - 1) < 1e-6);

    // mixRgb boundaries
    const a = {r:0,g:0,b:0};
    const b = {r:255,g:255,b:255};
    t.same(Color.mixRgb(a, b, 0), a);
    t.same(Color.mixRgb(a, b, 1), b);
    const mid = Color.mixRgb(a, b, 0.5);
    t.equal(mid.r, 127.5);
    t.end();
});

test('Timer start and timeElapsed with mock nowObj', t => {
    let now = 1000;
    const nowObj = { now: () => now };
    const timer = new Timer(nowObj);
    timer.start();
    now += 50;
    t.equal(timer.timeElapsed(), 50);
    t.equal(timer.time(), now);

    const id = timer.setTimeout(() => {}, 1);
    t.ok(id);
    timer.clearTimeout(id);
    t.end();
});
