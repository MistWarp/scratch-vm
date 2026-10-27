const {test} = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const unpack = require('scratch-parser/lib/unpack');
const {SCHEMAS, prepareAjv} = require('../../src/serialization/validator-schemas');

// The precompiled validators (tools/generate-validators.js) must judge projects exactly as ajv does at runtime.

const EXTENSIONS = {'.sb3': 'sb3', '.sprite3': 'sprite3', '.sb2': 'sb2', '.sprite2': 'sprite2'};

const fixtures = [];
const walk = dir => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (EXTENSIONS[path.extname(entry.name)]) fixtures.push(file);
    }
};
walk(path.join(__dirname, '../fixtures'));
walk(path.join(__dirname, '../snapshot'));

const runtimeValidators = {};
const runtimeValidator = name => {
    if (!runtimeValidators[name]) {
        const ajv = prepareAjv(new Ajv({meta: false, validateSchema: false}), SCHEMAS[name].sb2);
        runtimeValidators[name] = ajv.compile(SCHEMAS[name].schema());
    }
    return runtimeValidators[name];
};

const judge = (validate, project) => {
    const valid = validate(project);
    return {valid, errors: validate.errors};
};

const unpackJSON = file => new Promise((resolve, reject) => {
    const isSprite = file.endsWith('sprite3') || file.endsWith('sprite2');
    unpack(fs.readFileSync(file), isSprite, (error, result) => {
        if (error) reject(error);
        else resolve(JSON.parse(result[0]));
    });
});

test('precompiled validators agree with ajv on every fixture', async () => {
    assert.ok(fixtures.length > 100, `found ${fixtures.length} fixtures`);
    let compared = 0;
    for (const file of fixtures) {
        let project;
        try {
            project = await unpackJSON(file);
        } catch (e) {
            continue; // deliberately corrupt fixtures
        }
        const name = EXTENSIONS[path.extname(file)];
        const generated = require(`../../src/serialization/validators/${name}.generated.js`);
        assert.deepStrictEqual(judge(generated, project), judge(runtimeValidator(name), project), file);
        compared++;
    }
    assert.ok(compared > 100, `compared ${compared} fixtures`);
});

test('precompiled validators report the same errors for invalid projects', async () => {
    const sb3 = require('../../src/serialization/validators/sb3.generated.js');
    const project = await unpackJSON(fixtures.find(file => file.endsWith('.sb3')));
    const broken = [
        {...project, targets: 'not a list'},
        {...project, meta: {...project.meta, semver: 3}},
        {...project, targets: project.targets.map(t => ({...t, isStage: 'yes'}))},
        {monitors: []}
    ];
    for (const value of broken) {
        const result = judge(sb3, value);
        assert.strictEqual(result.valid, false);
        assert.deepStrictEqual(result, judge(runtimeValidator('sb3'), value));
    }
});
