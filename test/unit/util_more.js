const {test} = require('node:test');
const assert = require('node:assert');

const Cast = require('../../src/util/cast');
const Color = require('../../src/util/color');
const Timer = require('../../src/util/timer');

test('Cast.toNumber and toBoolean basics', () => {
    assert.strictEqual(Cast.toNumber(5), 5);
    assert.strictEqual(Cast.toNumber('10'), 10);
    assert.strictEqual(Cast.toNumber('not a number'), 0);
    assert.strictEqual(Cast.toNumber(NaN), 0);

    assert.strictEqual(Cast.toBoolean(true), true);
    assert.strictEqual(Cast.toBoolean(false), false);
    assert.strictEqual(Cast.toBoolean(''), false);
    assert.strictEqual(Cast.toBoolean('0'), false);
    assert.strictEqual(Cast.toBoolean('FALSE'), false);
    assert.strictEqual(Cast.toBoolean('hello'), true);
});

test('Cast string/whitespace and isInt', () => {
    assert.strictEqual(Cast.isWhiteSpace(null), true);
    assert.strictEqual(Cast.isWhiteSpace('   '), true);
    assert.strictEqual(Cast.isWhiteSpace('a'), false);

    assert.strictEqual(Cast.isInt(2.0), true);
    assert.strictEqual(Cast.isInt(2.5), false);
    assert.strictEqual(Cast.isInt(true), true);
    assert.strictEqual(Cast.isInt('3'), true);
    assert.strictEqual(Cast.isInt('3.1'), false);
});

test('Cast.toRgbColorObject with hex and decimal', () => {
    const fromHex = Cast.toRgbColorObject('#FF0000');
    assert.strictEqual(fromHex.r, 255);
    assert.strictEqual(fromHex.g, 0);
    assert.strictEqual(fromHex.b, 0);

    const fromShortHex = Cast.toRgbColorObject('#0F0');
    assert.strictEqual(fromShortHex.r, 0);
    assert.strictEqual(fromShortHex.g, 255);

    const fromDecimal = Cast.toRgbColorObject(0x0000FF);
    assert.strictEqual(fromDecimal.b, 255);
});

test('Cast.toListIndex special cases', () => {
    assert.strictEqual(Cast.toListIndex('all', 3, true), Cast.LIST_ALL);
    assert.strictEqual(Cast.toListIndex('all', 3, false), Cast.LIST_INVALID);
    assert.strictEqual(Cast.toListIndex('last', 2, false), 2);
    assert.strictEqual(Cast.toListIndex('last', 0, false), Cast.LIST_INVALID);
    // random/any with length 0 -> invalid
    assert.strictEqual(Cast.toListIndex('random', 0, false), Cast.LIST_INVALID);
    // numeric out of range
    assert.strictEqual(Cast.toListIndex(100, 3, false), Cast.LIST_INVALID);
    assert.strictEqual(Cast.toListIndex(2, 3, false), 2);
});

test('Color conversions', () => {
    assert.strictEqual(Color.decimalToHex(0x112233), '#112233');
    assert.strictEqual(Color.decimalToHex(-1), '#ffffff');

    const rgb = Color.decimalToRgb(0x00FF00);
    assert.strictEqual(rgb.g, 255);

    assert.deepStrictEqual(Color.hexToRgb('#0033FF'), {r:0,g:51,b:255});
    assert.deepStrictEqual(Color.hexToRgb('03F'), {r:0,g:51,b:255});
    assert.strictEqual(Color.hexToRgb('zzz'), null);

    const dec = Color.rgbToDecimal({r:1,g:2,b:3});
    assert.strictEqual(dec, 0x010203);

    assert.strictEqual(Color.rgbToHex({r:255,g:0,b:0}), '#ff0000');

    // hsv <-> rgb roundtrip for a sample
    const hsv = {h: 120, s: 1, v: 1};
    const rgbFromH = Color.hsvToRgb(hsv);
    const hsvBack = Color.rgbToHsv(rgbFromH);
    assert.ok(Math.abs(hsvBack.v - 1) < 1e-6);

    // mixRgb boundaries
    const a = {r:0,g:0,b:0};
    const b = {r:255,g:255,b:255};
    assert.deepStrictEqual(Color.mixRgb(a, b, 0), a);
    assert.deepStrictEqual(Color.mixRgb(a, b, 1), b);
    const mid = Color.mixRgb(a, b, 0.5);
    assert.strictEqual(mid.r, 127.5);
});

test('Timer start and timeElapsed with mock nowObj', () => {
    let now = 1000;
    const nowObj = { now: () => now };
    const timer = new Timer(nowObj);
    timer.start();
    now += 50;
    assert.strictEqual(timer.timeElapsed(), 50);
    assert.strictEqual(timer.time(), now);

    const id = timer.setTimeout(() => {}, 1);
    assert.ok(id);
    timer.clearTimeout(id);
});
