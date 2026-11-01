const tap = require('tap');
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

tap.test('marker is the TurboWarp config marker', t => {
    t.equal(PROJECT_OPTIONS_MARKER, ' // _twconfig_');
    t.ok(isProjectOptionsText('Configuration\n{} // _twconfig_'));
    t.notOk(isProjectOptionsText('just a comment'));
    t.end();
});

tap.test('options round trip through the comment text', t => {
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
    t.equal(text, 'Configuration for https://turbowarp.org/\nYou can move, resize, and minimize this comment, ' +
        'but don\'t edit it by hand. This comment can be deleted to remove the stored settings.\n' +
        '{"framerate":60,"runtimeOptions":{"maxClones":Infinity,"miscLimits":false,"fencing":false},' +
        '"interpolation":true,"turbo":true,"hq":true,"width":640,"height":360,"products":[{"id":"p","price":1}],' +
        '"categoryOrder":["motion","pen"],"mistwarpTheme":{"accent":"#ff0000"}} // _twconfig_');
    t.ok(isProjectOptionsText(text));
    t.same(parseProjectOptionsText(text), {options});
    t.end();
});

tap.test('parse reports why options could not be read', t => {
    t.same(parseProjectOptionsText('mentions // _twconfig_ in the middle'), {error: NO_OPTIONS_LINE});
    const invalid = parseProjectOptionsText('{oops // _twconfig_');
    t.equal(invalid.error, INVALID_OPTIONS_JSON);
    t.type(invalid.cause, Error);
    const notObject = parseProjectOptionsText('5 // _twconfig_');
    t.equal(notObject.error, INVALID_OPTIONS_JSON);
    t.equal(notObject.cause.message, 'Invalid object');
    t.equal(parseProjectOptionsText('null // _twconfig_').error, INVALID_OPTIONS_JSON);
    t.same(parseProjectOptionsText('first line\n{"turbo":true} // _twconfig_\nlast line'), {options: {turbo: true}});
    t.end();
});

tap.test('differing options only keep changed values', t => {
    t.same(differingProjectOptions(
        {framerate: 30, turbo: false, runtimeOptions: {maxClones: 300, fencing: true}, width: 480},
        {framerate: 60, turbo: false, runtimeOptions: {maxClones: 300, fencing: false}, width: 480}
    ), {framerate: 60, runtimeOptions: {fencing: false}});
    t.same(differingProjectOptions({a: {b: 1}}, {a: {b: 1}}), {});
    t.end();
});

tap.test('Runtime stores and reads options through the comment', t => {
    const runtime = new Runtime();
    const sprite = new Sprite(null, runtime);
    const stage = new RenderedTarget(sprite, runtime);
    stage.isStage = true;
    runtime.addTarget(stage);
    runtime.setFramerate(60);
    runtime.setStageSize(640, 400);
    runtime.storeProjectOptions({mistwarpTheme: {accent: '#00ff00'}});

    const comment = runtime.findProjectOptionsComment();
    t.ok(comment);
    t.same(parseProjectOptionsText(comment.text), {
        options: {framerate: 60, width: 640, height: 400, mistwarpTheme: {accent: '#00ff00'}}
    });

    const other = new Runtime();
    const otherSprite = new Sprite(null, other);
    const otherStage = new RenderedTarget(otherSprite, other);
    otherStage.isStage = true;
    other.addTarget(otherStage);
    otherStage.createComment('c', null, comment.text, 0, 0, 100, 100, false);
    other.parseProjectOptions();
    t.equal(other.frameLoop.framerate, 60);
    t.equal(other.stageWidth, 640);
    t.equal(other.stageHeight, 400);
    t.same(other.getStoredProjectOptions().mistwarpTheme, {accent: '#00ff00'});
    t.end();
});
