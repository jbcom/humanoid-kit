# Agent notes

This file is for an autonomous coding agent working in this repository. It
covers what isn't obvious from reading the code alone.

## Toolchain

- Node 26 and pnpm 12 to build (`.nvmrc`, `mise.toml`, `package.json#packageManager`),
  TypeScript 7 to compile. `engines.node` is `>=24`; do not use an API Node 24 lacks.
- The package is ESM-only. Source files import each other with `.ts` specifiers
  (`allowImportingTsExtensions`); `rewriteRelativeImportExtensions` makes
  `tsc -p tsconfig.build.json` emit `.js` specifiers into `dist/`. The published
  `files` of the root package are `dist`, `README.md`, `LICENSE` and `NOTICE.md`.
- This is a pnpm workspace with five members: `.` (the `humanoid-kit` library,
  plus the playground and its tests), `packs/body` (`humanoid-kit-body`),
  `packs/adult-anatomy` (`humanoid-kit-adult-anatomy`), `packs/hair`
  (`humanoid-kit-hair`) and `docs/` (the private
  Sourcey site). Root scripts operate on the library; `pnpm docs:*` delegate to
  `docs/`.
- `pnpm verify` is the gate CI runs: Biome lint, markdownlint (`pnpm lint:docs`),
  strict TypeScript over `src`, `tests`, `scripts`, `e2e` and `playground`, the
  unit suite with coverage thresholds, the build, and `pnpm package:check`
  (`publint`, Are The Types Wrong with the ESM-only profile, and
  `scripts/verify-package.mjs`). A change is not done while any part of it is red.
- Coverage thresholds apply to `src/format`, `src/morph`, `src/subdiv` and
  `src/recipe` (`src/rig` is listed in `vitest.config.ts` but does not exist yet).
  `src/makehuman`, `src/model` and `src/build` are exercised by `tests/` but are
  not in the threshold set. `src/react` and `src/worker` need a browser and are
  proven by `pnpm test:e2e` (Playwright against the playground).
- `playground/` is the library's own demo, not a consumer. It aliases
  `humanoid-kit` and its subpaths to `../src`, so it needs no build step, and it
  loads the body pack only.
- `pnpm pack:data <makehuman-data-dir> <system-assets-dir>` regenerates all three
  packs from a checkout of the upstream project and its system assets pack (the
  hair pack last, since it binds to the body pack by hash); `pnpm pack:hair
  <system-assets-dir>` regenerates only the hair against the committed body pack.
  See `NOTICE.md`.

## Core invariants: do not violate these when editing `src/` or `packs/`

Full detail in `docs/ARCHITECTURE.md`.

1. Every figure is the single hm08 base mesh. Do not add a second mesh, a second
   rig or per-species geometry.
2. The age policy lives in `src/recipe/agePolicy.ts` and is enforced inside
   `recipeContributions`, so no caller can evaluate an invalid recipe. Under 18,
   breast size and firmness, regional breast values and adult-only modifiers
   throw `AgePolicyError`; they are never clamped. `macroTargetWeights` never
   weights a breast macro target under 18. `withAge` strips adult-only values
   explicitly. Keep `ADULT_ONLY_MODIFIER` in step with the packer's
   `isAdultOnlyTarget`; `tests/agePolicy.test.ts` checks they agree.
3. Adult-only targets and modifiers ship only in `humanoid-kit-adult-anatomy`,
   never in the body pack. The loader refuses an adult pack whose `topology` or
   `bodySha256` does not match the body pack it is loaded with. The public demo
   must never include the adult pack; `pnpm check:pages` scans built output for
   its files, package name, target names and modifier names.
4. Regional traits stay independent. A regional macro override changes only its
   region's weights; no trait may lock, clamp or rescale another.
5. The core (`src/format`, `src/morph`, `src/subdiv`, `src/recipe`,
   `src/makehuman`, `src/model`, `src/build`) imports no React, no DOM and no
   WebGL, so it stays unit-testable in Node.
6. Catmull-Clark subdivision runs from precomputed stencils (`src/subdiv`,
   `src/build`). `HumanoidModel` is framework-free and can run anywhere, but the
   React bindings evaluate through `HumanoidWorkerClient`; do not move
   evaluation onto the render path.
7. Data files are generated, never hand-edited. Change the packer and rerun
   `pnpm pack:data`. The packer's licence gate must keep refusing any source file
   that does not prove CC0 from its own content.
8. Only MakeHuman asset data (CC0) is used. Never copy, port or translate
   MakeHuman program code, and keep `NOTICE.md` accurate.
9. Public names, docs, examples and fixtures are neutral. Do not put the name of
   any game, studio or host app in code, comments, docs, tests or fixtures.

## Keeping docs and tests in sync

A change to a public export needs matching updates in `tests/` (or `e2e/` for
`src/react` and `src/worker`), `docs/API.md`, `docs/ARCHITECTURE.md` when a
boundary or invariant moves, and the README and `llms.txt` when the quick start
or the roadmap changes. Document only what the code does: planned work belongs in
the roadmap, labelled as planned. `humanoid-kit/editor` is declared in
`package.json` but `src/editor` does not exist yet.

## Known gaps

- `scripts/verify-package.mjs` still describes the earlier single-package layout
  (`data/hm08`, a `HumanoidEvaluator` export, a `humanoid-kit/editor` build and a
  baby/child target scan), so `pnpm package:check` cannot pass until it is
  updated to the current packages.
- `pnpm check:pages` is not wired into any workflow; run it after
  `pnpm build:playground` and `pnpm docs:build`.
- The comment at the top of `scripts/pack-makehuman.ts` mentions an
  `adult-targets.bin`; the packer actually writes
  `packs/adult-anatomy/data/targets.bin`.

## Commits and releases

- `scripts/apply-branch-ruleset.mjs` is the canonical OSS ruleset installer. Run
  it only with explicit authorization.
- Conventional Commits only. Release Please owns `CHANGELOG.md` and versions;
  never hand-edit either.
- `pre-commit`, `simple-git-hooks`, `lint-staged` and `commitlint` run locally
  after `pnpm install`; never bypass them with `--no-verify`.

## Files most likely to surprise you

- `pnpm-workspace.yaml`'s `allowBuilds` controls which install scripts run.
- The data packs are binary (`packs/*/data/*.bin` is marked `binary` in
  `.gitattributes`) and are committed to the repository, not stored in LFS.
- Sourcey paths in `docs/sourcey.config.ts` resolve relative to `docs/`. The CD
  workflow copies the built playground into `docs/dist/playground`, so Pages
  serves docs at the root and the playground under `/playground/`.
- `pnpm build:playground` sets the Vite base to `/humanoid-kit/playground/` to
  match that layout.
