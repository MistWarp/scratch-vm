const path = require('path');
const VirtualMachine = require('../src/index');
const makeTestStorage = require('../test/fixtures/make-test-storage');
const readFileToBuffer = require('../test/fixtures/readProjectFile').readFileToBuffer;

if (process.argv.length < 3) {
    console.error('Usage: node tools/debug-say.js <sb3-file>');
    process.exit(2);
}
const uri = process.argv[2];
const compiled = process.argv[3] !== 'false';
const vm = new VirtualMachine();
vm.attachStorage(makeTestStorage());
vm.start();
vm.clear();
vm.setCompilerOptions({enabled: compiled});
vm.setCompatibilityMode(false);
vm.setTurboMode(false);
vm.on('COMPILE_ERROR', (target, error) => {
    console.error('COMPILE_ERROR', target && target.getName(), error);
});
vm.runtime.on('SAY', (target, type, text) => {
    console.log('SAY:', text);
});
const project = readFileToBuffer(path.resolve(__dirname, '..', 'test', 'fixtures', 'execute', uri));
vm.loadProject(project)
    .then(() => vm.greenFlag())
    .catch(e => console.error(e));
