const crypto = require('crypto');
const path = require('path');
const AdmZip = require('adm-zip');

const outputPath = process.argv[2] || path.resolve(__dirname, '../../MistWarp Multiplayer Demo.sb3');

const asset = (name, source, centerX, centerY) => {
    const assetId = crypto.createHash('md5')
        .update(source)
        .digest('hex');
    return {
        file: `${assetId}.svg`,
        source,
        costume: {
            name,
            bitmapResolution: 1,
            dataFormat: 'svg',
            assetId,
            md5ext: `${assetId}.svg`,
            rotationCenterX: centerX,
            rotationCenterY: centerY
        }
    };
};

const backdrop = asset('Multiplayer room', `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360">
    <rect width="480" height="360" fill="#f2f6ff"/>
    <path d="M0 300h480" stroke="#b9c8e8" stroke-width="3"/>
    <text x="240" y="42" text-anchor="middle" font-family="sans-serif" font-size="22"
        font-weight="700" fill="#273552">Multiplayer movement demo</text>
    <text x="240" y="70" text-anchor="middle" font-family="sans-serif" font-size="14"
        fill="#52617e">Use the arrow keys. Share the project link with another player.</text>
    <text x="240" y="92" text-anchor="middle" font-family="sans-serif" font-size="12"
        fill="#71809c">Blue is you. Orange is the other player.</text>
</svg>`, 240, 180);

const localCostume = asset('You', `<svg xmlns="http://www.w3.org/2000/svg" width="54" height="54" viewBox="0 0 54 54">
    <circle cx="27" cy="27" r="23" fill="#3373c4" stroke="#fff" stroke-width="4"/>
    <circle cx="19" cy="23" r="3" fill="#fff"/><circle cx="35" cy="23" r="3" fill="#fff"/>
    <path d="M18 34q9 8 18 0" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
</svg>`, 27, 27);

const remoteCostume = asset('Other player', `<svg xmlns="http://www.w3.org/2000/svg" width="54" height="54" viewBox="0 0 54 54">
    <circle cx="27" cy="27" r="23" fill="#e56f24" stroke="#fff" stroke-width="4"/>
    <circle cx="19" cy="23" r="3" fill="#fff"/><circle cx="35" cy="23" r="3" fill="#fff"/>
    <path d="M18 34q9 8 18 0" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
</svg>`, 27, 27);

const text = value => [1, [10, String(value)]];
const number = value => [1, [4, String(value)]];
const reporter = (id, fallback = '') => [3, id, [10, fallback]];
const condition = id => [2, id];
const substack = id => [2, id];
const field = (value, id = null) => [value, id];
const block = (opcode, next, parent, inputs = {}, fields = {}, topLevel = false, x = 0, y = 0) => ({
    opcode,
    next,
    parent,
    inputs,
    fields,
    shadow: false,
    topLevel,
    ...(topLevel ? {x, y} : {})
});

const localBlocks = {
    green: block('event_whenflagclicked', 'join', null, {}, {}, true, 50, 65),
    join: block('mistwarpMultiplayer_connect', 'waitConnected', 'green', {ROOM: text('movement-demo')}),
    waitConnected: block('control_wait', 'loop', 'join', {DURATION: number(1)}),
    loop: block('control_forever', null, 'waitConnected', {SUBSTACK: substack('sendPosition')}),

    rightHat: block('event_whenkeypressed', 'moveRight', null, {}, {
        KEY_OPTION: field('right arrow')
    }, true, 420, 65),
    moveRight: block('motion_changexby', null, 'rightHat', {DX: number(5)}),

    leftHat: block('event_whenkeypressed', 'moveLeft', null, {}, {
        KEY_OPTION: field('left arrow')
    }, true, 420, 175),
    moveLeft: block('motion_changexby', null, 'leftHat', {DX: number(-5)}),

    upHat: block('event_whenkeypressed', 'moveUp', null, {}, {
        KEY_OPTION: field('up arrow')
    }, true, 420, 285),
    moveUp: block('motion_changeyby', null, 'upHat', {DY: number(5)}),

    downHat: block('event_whenkeypressed', 'moveDown', null, {}, {
        KEY_OPTION: field('down arrow')
    }, true, 420, 395),
    moveDown: block('motion_changeyby', null, 'downHat', {DY: number(-5)}),

    sendPosition: block('mistwarpMultiplayer_setPosition', 'tick', 'loop', {
        X: reporter('myX', '0'),
        Y: reporter('myY', '0')
    }),
    myX: block('motion_xposition', null, 'sendPosition'),
    myY: block('motion_yposition', null, 'sendPosition'),
    tick: block('control_wait', null, 'loop', {DURATION: number(0.05)})
};

const remoteId = 'remote-player-id';
const remoteBlocks = {
    green: block('event_whenflagclicked', 'hideInitially', null, {}, {}, true, 45, 55),
    hideInitially: block('looks_hide', null, 'green'),

    stateHat: block('mistwarpMultiplayer_whenState', 'rememberPlayer', null, {}, {}, true, 45, 175),
    rememberPlayer: block('data_setvariableto', 'notMeIf', 'stateHat', {
        VALUE: reporter('changedPlayer', '')
    }, {VARIABLE: field('remote player', remoteId)}),
    changedPlayer: block('mistwarpMultiplayer_statePlayer', null, 'rememberPlayer'),
    notMeIf: block('control_if', null, 'stateHat', {
        CONDITION: condition('notMe'),
        SUBSTACK: substack('moveRemote')
    }),
    notMe: block('operator_not', null, 'notMeIf', {OPERAND: condition('sameAsMe')}),
    sameAsMe: block('operator_equals', null, 'notMe', {
        OPERAND1: reporter('remoteForCompare', ''),
        OPERAND2: reporter('myPlayerId', '')
    }),
    remoteForCompare: block('data_variable', null, 'sameAsMe', {}, {VARIABLE: field('remote player', remoteId)}),
    myPlayerId: block('mistwarpMultiplayer_myPlayer', null, 'sameAsMe'),
    moveRemote: block('motion_gotoxy', 'showRemote', 'notMeIf', {
        X: reporter('remoteX', '0'),
        Y: reporter('remoteY', '0')
    }),
    remoteX: block('mistwarpMultiplayer_playerX', null, 'moveRemote', {
        PLAYER: reporter('remoteForX', '')
    }),
    remoteForX: block('data_variable', null, 'remoteX', {}, {VARIABLE: field('remote player', remoteId)}),
    remoteY: block('mistwarpMultiplayer_playerY', null, 'moveRemote', {
        PLAYER: reporter('remoteForY', '')
    }),
    remoteForY: block('data_variable', null, 'remoteY', {}, {VARIABLE: field('remote player', remoteId)}),
    showRemote: block('looks_show', null, 'notMeIf'),

    joinHat: block('mistwarpMultiplayer_whenJoined', 'sayJoined', null, {}, {}, true, 520, 55),
    sayJoined: block('looks_sayforsecs', null, 'joinHat', {
        MESSAGE: reporter('joinMessage', ''),
        SECS: number(2)
    }),
    joinMessage: block('operator_join', null, 'sayJoined', {
        STRING1: text('Joined: '),
        STRING2: reporter('joinedName', '')
    }),
    joinedName: block('mistwarpMultiplayer_playerUsername', null, 'joinMessage', {
        USER: reporter('joinedId', '')
    }),
    joinedId: block('mistwarpMultiplayer_joinedPlayer', null, 'joinedName'),

    leaveHat: block('mistwarpMultiplayer_whenLeft', 'leftIsRemote', null, {}, {}, true, 520, 245),
    leftIsRemote: block('control_if', null, 'leaveHat', {
        CONDITION: condition('leftEqualsRemote'),
        SUBSTACK: substack('hideRemote')
    }),
    leftEqualsRemote: block('operator_equals', null, 'leftIsRemote', {
        OPERAND1: reporter('leftPlayer', ''),
        OPERAND2: reporter('remoteForLeave', '')
    }),
    leftPlayer: block('mistwarpMultiplayer_leftPlayer', null, 'leftEqualsRemote'),
    remoteForLeave: block('data_variable', null, 'leftEqualsRemote', {}, {VARIABLE: field('remote player', remoteId)}),
    hideRemote: block('looks_hide', null, 'leftIsRemote')
};

const target = (name, costume, blocks, layerOrder, extra = {}) => ({
    isStage: false,
    name,
    variables: extra.variables || {},
    lists: {},
    broadcasts: {},
    blocks,
    comments: {},
    currentCostume: 0,
    costumes: [costume],
    sounds: [],
    volume: 100,
    layerOrder,
    visible: extra.visible !== false,
    x: extra.x || 0,
    y: extra.y || 0,
    size: 100,
    direction: 90,
    draggable: false,
    rotationStyle: 'all around'
});

const project = {
    targets: [{
        isStage: true,
        name: 'Stage',
        variables: {},
        lists: {},
        broadcasts: {},
        blocks: {},
        comments: {},
        currentCostume: 0,
        costumes: [backdrop.costume],
        sounds: [],
        volume: 100,
        layerOrder: 0,
        tempo: 60,
        videoTransparency: 50,
        videoState: 'on',
        textToSpeechLanguage: null
    }, target('You', localCostume.costume, localBlocks, 1, {x: -80}), target(
        'Other player',
        remoteCostume.costume,
        remoteBlocks,
        2,
        {visible: false, x: 80, variables: {[remoteId]: ['remote player', '']}}
    )],
    monitors: [],
    extensions: ['mistwarpMultiplayer'],
    meta: {
        semver: '3.0.0',
        vm: '11.3.0-mistwarp',
        agent: 'MistWarp multiplayer demo generator'
    }
};

const zip = new AdmZip();
zip.addFile('project.json', Buffer.from(JSON.stringify(project)));
for (const item of [backdrop, localCostume, remoteCostume]) {
    zip.addFile(item.file, Buffer.from(item.source));
}
zip.writeZip(outputPath);
process.stdout.write(`${outputPath}\n`);
