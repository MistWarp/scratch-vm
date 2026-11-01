const {test} = require('node:test');
const assert = require('node:assert');
const Runtime = require('../../src/engine/runtime');
const RenderedTarget = require('../../src/sprites/rendered-target');
const Sprite = require('../../src/sprites/sprite');
const {
    PROJECT_OPTIONS_MARKER,
    NO_OPTIONS_LINE,
    INVALID_OPTIONS_JSON,
    isProjectOptionsText,
    parseProjectOptionsText,
    serializeProjectOptionsText,
    differingProjectOptions
} = require('../../src/serialization/project-options-comment');

test('marker is the TurboWarp config marker', () => {
    assert.strictEqual(PROJECT_OPTIONS_MARKER, ' // _twconfig_');
    assert.ok(isProjectOptionsText('Configuration\n{} // _twconfig_'));
    assert.ok(!isProjectOptionsText('just a comment'));
});

test('options round trip through the comment text', () => {
    const options = {
        framerate: 60,
        runtimeOptions: {maxClones: Infinity, miscLimits: false, fencing: false},
        interpolation: true,
        turbo: true,
        hq: true,
        width: 640,
        height: 360,
        products: [{id: 'p', price: 1}],
        categoryOrder: ['motion', 'pen'],
        mistwarpTheme: {accent: '#ff0000'}
    };
    const text = serializeProjectOptionsText(options);
    assert.strictEqual(text, 'Configuration for https://turbowarp.org/\nYou can move, resize, and minimize this comment, ' +
        'but don\'t edit it by hand. This comment can be deleted to remove the stored settings.\n' +
        '{"framerate":60,"runtimeOptions":{"maxClones":Infinity,"miscLimits":false,"fencing":false},' +
        '"interpolation":true,"turbo":true,"hq":true,"width":640,"height":360,"products":[{"id":"p","price":1}],' +
        '"categoryOrder":["motion","pen"],"mistwarpTheme":{"accent":"#ff0000"}} // _twconfig_');
    assert.ok(isProjectOptionsText(text));
    assert.deepStrictEqual(parseProjectOptionsText(text), {options});
});

test('parse reports why options could not be read', () => {
    assert.deepStrictEqual(parseProjectOptionsText('mentions // _twconfig_ in the middle'), {error: NO_OPTIONS_LINE});
    const invalid = parseProjectOptionsText('{oops // _twconfig_');
    assert.strictEqual(invalid.error, INVALID_OPTIONS_JSON);
    assert.ok(invalid.cause instanceof Error);
    const notObject = parseProjectOptionsText('5 // _twconfig_');
    assert.strictEqual(notObject.error, INVALID_OPTIONS_JSON);
    assert.strictEqual(notObject.cause.message, 'Invalid object');
    assert.strictEqual(parseProjectOptionsText('null // _twconfig_').error, INVALID_OPTIONS_JSON);
    assert.deepStrictEqual(parseProjectOptionsText('first line\n{"turbo":true} // _twconfig_\nlast line'),
        {options: {turbo: true}});
});

test('differing options only keep changed values', () => {
    assert.deepStrictEqual(differingProjectOptions(
        {framerate: 30, turbo: false, runtimeOptions: {maxClones: 300, fencing: true}, width: 480},
        {framerate: 60, turbo: false, runtimeOptions: {maxClones: 300, fencing: false}, width: 480}
    ), {framerate: 60, runtimeOptions: {fencing: false}});
    assert.deepStrictEqual(differingProjectOptions({a: {b: 1}}, {a: {b: 1}}), {});
});

test('Runtime stores and reads options through the comment', () => {
    const runtime = new Runtime();
    const sprite = new Sprite(null, runtime);
    const stage = new RenderedTarget(sprite, runtime);
    stage.isStage = true;
    runtime.addTarget(stage);
    runtime.setFramerate(60);
    runtime.setStageSize(640, 400);
    runtime.storeProjectOptions({mistwarpTheme: {accent: '#00ff00'}});

    const comment = runtime.findProjectOptionsComment();
    assert.ok(comment);
    assert.deepStrictEqual(parseProjectOptionsText(comment.text), {
        options: {framerate: 60, width: 640, height: 400, mistwarpTheme: {accent: '#00ff00'}}
    });

    const other = new Runtime();
    const otherSprite = new Sprite(null, other);
    const otherStage = new RenderedTarget(otherSprite, other);
    otherStage.isStage = true;
    other.addTarget(otherStage);
    otherStage.createComment('c', null, comment.text, 0, 0, 100, 100, false);
    other.parseProjectOptions();
    assert.strictEqual(other.frameLoop.framerate, 60);
    assert.strictEqual(other.stageWidth, 640);
    assert.strictEqual(other.stageHeight, 400);
    assert.deepStrictEqual(other.getStoredProjectOptions().mistwarpTheme, {accent: '#00ff00'});
});
