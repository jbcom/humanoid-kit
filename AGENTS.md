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
- This is a pnpm workspace with eight members, seven of them published: `.`
  (the `humanoid-kit` library, plus the playground and its tests), `packs/body`
  (`humanoid-kit-body`), `packs/adult-anatomy` (`humanoid-kit-adult-anatomy`),
  `packs/hair` (`humanoid-kit-hair`), `packs/eyes` (`humanoid-kit-eyes`),
  `packs/animations` (`humanoid-kit-animations`), `packs/clothing`
  (`humanoid-kit-clothing`) and `docs/` (the private Sourcey site). Root scripts operate on the library; `pnpm docs:*` delegate to
  `docs/`.
- `pnpm verify` is the gate CI runs: Biome lint, markdownlint (`pnpm lint:docs`),
  strict TypeScript over `src`, `tests`, `scripts`, `e2e` and `playground`, the
  unit suite with coverage thresholds, the build, and `pnpm package:check`
  (`publint`, Are The Types Wrong with the ESM-only profile, and
  `scripts/verify-package.mjs`). A change is not done while any part of it is red.
- Coverage (thresholds: lines, functions and statements 90, branches 85) is
  measured over the framework-free core listed in `vitest.config.ts`: `src/bake`,
  `src/build`, `src/editor` (not `src/editor/ui`), `src/format`, `src/makehuman`,
  `src/mhclo`, `src/model`, `src/morph`, `src/presence`, `src/recipe`, `src/rig`,
  `src/subdiv` and `src/surface`. `src/react`, `src/render`, `src/editor/ui` and
  `src/worker` need a browser and are proven by the browser project and
  `pnpm test:e2e` (Playwright against the playground).
- `playground/` is the library's own demo, not a consumer. It aliases
  `humanoid-kit` and its subpaths to `../src`, so it needs no build step, and it
  loads the body pack and the hair pack (never the adult pack outside `?adult`
  in development).
- `pnpm pack:clothing <system-assets-dir>` regenerates `packs/clothing` from the
  extracted MakeHuman system assets pack, against the committed body pack.
- `pnpm pack:data <makehuman-data-dir> <system-assets-dir>` regenerates all the
  packs from a checkout of the upstream project and its system assets pack (the
  hair pack last, since it binds to the body pack by hash); `pnpm pack:hair
  <system-assets-dir>` regenerates only the hair against the committed body pack.
  See `NOTICE.md`. The adult pack's community sculpts are fetched at pack time,
  hash-verified against `packs/adult-anatomy/source/PROVENANCE.md` and cut with
  headless Blender into the gitignored `.cache/adult-sculpts/`; never commit them
  (`pnpm pack:adult-sources` warms the cache; the tests that place sculpts need it).
- Every packer sizes its textures by `scripts/lib/textureSizing.ts`: each ships
  at the edge its closest QA framing needs, re-sourced from the original, never
  upscaled (docs/evidence/upscale.md). `node scripts/research/texel-density.ts
  <system-assets-dir>` reports what every texture needs; `pnpm upscale
  <system-assets-dir> <out-dir>` upscales the ones whose original falls short,
  judged by the gates in `scripts/lib/upscale/gates.ts`, outside the
  repository for inspection.

## Core invariants: do not violate these when editing `src/` or `packs/`

Full detail in `docs/ARCHITECTURE.md`.

1. Every figure is the single hm08 base mesh. Do not add a second mesh, a second
   rig or per-species geometry. The adult pack's refined pelvic surface refines
   the base's own faces, keeps the base's vertices and is evaluated only for an
   adult; whether that needs a recorded exception is an open owner question
   (issue 52).
2. The age policy lives in `src/recipe/agePolicy.ts` and is enforced inside
   `recipeContributions`, so no caller can evaluate an invalid recipe. The body
   follows MakeHuman at every age it models, breast development and nipples
   included. The one gate is the adult pack: under 18, adult-only modifiers throw
   `AgePolicyError`; they are never clamped. `withAge` strips adult-only values
   explicitly. Compare an age to the line only through `isAdultAge`
   (`tests/ageGateSource.test.ts` fails on a raw comparison). Keep
   `ADULT_ONLY_MODIFIER` in step with the packer's
   `isAdultPackTarget`; `tests/agePolicy.test.ts` checks they agree. The same
   policy also refuses, under 18, pubic body hair, any piercing site that is not
   one of the body's own, and the `arousal` skin-state signal. See
   `docs/DECISIONS.md` rulings 3 and 4.
3. Adult-only targets and modifiers ship only in `humanoid-kit-adult-anatomy`,
   never in the body pack. The loader refuses an adult pack whose `topology` or
   `bodySha256` does not match the body pack it is loaded with. The public demo
   must never include the adult pack; `pnpm check:pages` scans built output for
   its files, package name, target names and modifier names.
4. Regional traits stay independent. A regional macro override changes only its
   region's weights; no trait may lock, clamp or rescale another. This is
   currently violated by the breast weighting (`1 - gender` in
   `macroTargetWeights`) and by gender-scaled areola and nipple sizes; issue 27
   tracks it, and `docs/DECISIONS.md` ruling 1 says to remove them.
5. The core (`src/format`, `src/morph`, `src/subdiv`, `src/recipe`,
   `src/makehuman`, `src/model`, `src/build`) imports no React, no DOM and no
   WebGL, so it stays unit-testable in Node.
6. Catmull-Clark subdivision runs from precomputed stencils (`src/subdiv`,
   `src/build`). `HumanoidModel` is framework-free and can run anywhere, but the
   React bindings evaluate through `HumanoidWorkerClient`; do not move
   evaluation onto the render path.
7. Data files are generated, never hand-edited. Change the packer and rerun
   `pnpm pack:data`. The licence gate must require verified commercial-use and
   redistribution permission from the asset's release header or captured
   official licence page. CC0 and attributed assets such as CC-BY are accepted
   under decision 9 (owner, 2026-10-13). Preserve each asset's actual licence,
   source, author, attribution and modification records; never relabel it CC0.
   Keep binding provenance separate and rebuild any binding whose licence does
   not permit its redistribution (`scripts/lib/licenceRule.ts`,
   `docs/licence-history.md`).
8. Use licensed asset data; never copy, port or translate MakeHuman program
   code. Keep `NOTICE.md` and per-asset provenance accurate, including required
   attribution. Procedural geometry remains governed by decision 8.
9. Public names, docs, examples and fixtures are neutral. Do not put the name of
   any game, studio or host app in code, comments, docs, tests or fixtures.

## Keeping docs and tests in sync

A change to a public export needs matching updates in `tests/` (or `e2e/` for
`src/react` and `src/worker`), `docs/API.md`, `docs/ARCHITECTURE.md` when a
boundary or invariant moves, and the README and `llms.txt` when the quick start
or the roadmap changes. Document only what the code does: planned work belongs in
the roadmap, labelled as planned. A status note ("canonical", "current", "done")
names the ref and the date it was checked against.

## Known gaps

None recorded. The earlier list (a stale `scripts/verify-package.mjs`, an
unwired `pnpm check:pages`, an out-of-date packer comment) was checked on
2026-10-13 against `integration` at c6167468: `pnpm build` and
`pnpm package:check` pass on the current seven packages, `pnpm check:pages` runs
in `.github/workflows/cd.yml`, and the packer comment names the real files. Add
a gap here with the ref and date you found it at.

## Commits and releases

- `integration` is the shared development branch: lanes and pull requests target it.
  A release milestone advances `main` with a normal merge commit from `integration`
  only after CI, the root-read visual defect register and the #22 licence audit pass.
  CI runs on both branches. Pages, Release Please and CD run from `main`, which
  publishes the seven public workspaces with npm provenance; issue #69 remains the
  public-release gate. Never enable release automation, publish manually or move a
  release outside that milestone path.
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
