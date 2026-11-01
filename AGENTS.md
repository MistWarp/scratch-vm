# AGENTS.md

scratch-vm runs MistWarp projects: the runtime, the interpreter, the compiler, serialization and the built-in extensions. It is a fork of TurboWarp's VM, written in CommonJS JavaScript. scratch-gui consumes this repo's `src/` directly (`main` is `src/index.js`), pinned to a commit.

## Where code goes

| Path | Holds |
| --- | --- |
| `src/virtual-machine.js` | The facade the GUI talks to. Events it emits itself are in `src/virtual-machine-events.js`. |
| `src/engine/` | `runtime.js` composes the engine. Event names are in `runtime-events.js`, the scheduler is `sequencer.js`, `thread.js` and `execute.js`, and the data model is targets, blocks, variables and the caches. |
| `src/compiler/` | `irgen` turns blocks into IR, then `iroptimizer` and `irfold`, then `jsgen` produces JS source, and `jsexecute` runs it. |
| `src/serialization/` | sb2, sb3, compression, project options (`project-options-comment.js`) and reserved stage comments. |
| `src/extension-support/` | The extension manager, sandboxing, and the toolbox conversion (`scratch-blocks-toolbox.js`). |
| `src/blocks/`, `src/extensions/` | Core block packages and built-in extensions, including the MistWarp ones (`rotur`, `mistwarp_games`). |

`src/` has no require cycles. Keep it that way: put shared constants and helpers in a leaf module rather than requiring back up the tree.

## Things that look safe to change but are not

- **Methods must stay replaceable.** scratch-gui, its addons and unsandboxed extensions call and replace Runtime and VM methods at runtime (`_step`, `greenFlag`, `startHats`, `getBlocksXML`, the `_convert*` toolbox methods, and others). Keep them as ordinary writable prototype methods that internal code calls through `this.` or `runtime.`. Don't use arrow-function class fields, don't freeze objects, and don't rename members the GUI uses (search scratch-gui first).
- **Generated code reads field names.** Compiled scripts refer to `thread.status`, `runtime.ioDevices`, `target.interpolationData` and similar inside JS strings, so renaming those fields breaks compiled projects. Snapshot tests pin the output.
- **Hot paths.** Don't add getters, setters or private fields to `Thread`, `Target` or stack frames, and don't add allocations in `sequencer`, `execute` or `util/cast.js`.
- **Events** use the constants in `runtime-events.js` or `virtual-machine-events.js`, never a bare string.
- **The GUI imports some internal files directly** (`serialization/fractch-context`, `extension-support/argument-type`, `block-type`, `extensions/rotur/core`, `engine/opcodes.generated.json`). Keep their exports stable.

## Checks

- `npm run lint`, but in a worktree under `.claude/` run `npx eslint src`, because ESLint skips dot directories and reports nothing.
- `npm run test:node` runs unit and integration tests with Node's built-in test runner (`node:test` and `node:assert`). `npm run test:unit` and `npm run test:integration` run one half, and `node --test test/unit/<file>.js` runs a single file while you iterate.
- `node test/snapshot` checks the compiler output. Run `node test/snapshot --update` only for an intended change, and review the diff. `node test/integration/execute.js` runs every fixture both interpreted and compiled.
- `npm run check:conventions` rejects code comments and em dashes in the lines you add. Tool directives such as `eslint-disable` are allowed.
- Engine changes must keep the results of the parity project (https://git.rotur.dev/Mist/scratch-parity, built to an sb3 with fractch) identical, and performance at least the same. Measure both with [scratch-bench](https://github.com/gradylink/scratch-bench), and compare against the same run on `develop`. `BENCH_VM_DIR=<this repo> node runtimes/node-vm.mjs mistwarp <project.sb3>` runs headless in Node (tests that need a renderer fail there on both sides). `runtimes/chromium-vm.mjs` runs with the real renderer, given `BENCH_BUNDLE_DIR` pointing at a browser bundle whose `vm/` is this repo's `npm run build` output.

## Working here

- The default branch is `develop`. This repo is a fork, so open PRs with `gh pr create -R MistWarp/scratch-vm --base develop`.
- scratch-gui depends on much of the VM's surface. Before renaming or removing a member, search scratch-gui (including `src/addons`) for its uses.
- A refactor keeps behaviour, so existing tests pass unchanged. New modules come with unit tests in `test/unit/`.
- Never add `Co-Authored-By` or any AI or tool attribution to commits or PRs.
- READMEs are overviews. Documentation goes in MistWarp/docs (https://mistwarp.org/docs/).
