const makeCostume = (index, assetId) => ({
    name: `costume ${index}`,
    assetId,
    dataFormat: 'png',
    md5ext: `${assetId}.png`,
    rotationCenterX: index,
    rotationCenterY: index + 1
});

const makeSound = (index, assetId) => ({
    name: `sound ${index}`,
    assetId,
    dataFormat: 'wav',
    md5ext: `${assetId}.wav`,
    format: '',
    rate: 44100,
    sampleCount: 1
});

module.exports = () => ({
    targets: [{
        isStage: true,
        name: 'Stage',
        variables: {},
        lists: {},
        broadcasts: {},
        blocks: {},
        comments: {},
        currentCostume: 0,
        costumes: Array.from({length: 60}, (_, index) =>
            makeCostume(index, `image-${index % 2}`)),
        sounds: Array.from({length: 40}, (_, index) =>
            makeSound(index, `sound-${index % 2}`)),
        volume: 100,
        layerOrder: 0,
        tempo: 60,
        videoTransparency: 50,
        videoState: 'on',
        textToSpeechLanguage: null
    }],
    monitors: [],
    extensions: [],
    meta: {semver: '3.0.0', vm: 'test', agent: 'test'}
});
