# Contributing

Thanks for taking the time to contribute. humanoid-kit is pre-release and its API
is still in development, so open an issue to discuss a larger change before
writing it.

## Getting set up

With [mise](https://mise.jdx.dev) (recommended; it installs the Node and pnpm
toolchain selected in `mise.toml`):

```sh
mise install
pnpm install
pnpm verify   # lint, typecheck, test with coverage, build, package checks
```

Without mise, use `corepack` so pnpm matches the version pinned in
`package.json#packageManager`, on a Node release in the `engines.node` range
(`>=24`; CI verifies 24 and 26):

```sh
corepack enable
pnpm install
pnpm verify
```

To work on the figure visually, start the playground with `pnpm dev`. It imports
the library straight from `src/`, so edits show up immediately. Add `?adult` to
the URL to load the adult anatomy pack while developing; a production build
drops it, so the public demo never carries it, and `pnpm check:pages` fails the
build if it does. `?recipe=<json>` starts from a given figure, and `?scene=walk` (with
`?bg=rrggbb` for a light ground) shows two figures walking, parting and
overlapping, to see the presence-driven stage shadow. `pnpm test:e2e`
runs the Playwright suite against the playground's production build on port
4173 (set `HK_E2E_PORT` when another checkout already holds it, or the run
would test that checkout's build); install the browser once with
`pnpm exec playwright install chromium`. To reproduce a slow CI runner's long
frames, run the presence spec with `HK_GPU=software HK_CPU_THROTTLE=6`: it
throttles only that page's CPU (Chrome's own throttle), so nothing else on the
machine is slowed. Never load the whole machine to do it.

Browser tests (the Vitest browser project and the Playwright suite) run headed
Chromium through [game-harness](https://www.npmjs.com/package/game-harness), on
your native GPU by default, so they test what people see; the playground spec
fails if a run that expects a GPU falls back to software rendering. CI has no
GPU and selects SwiftShader explicitly under `xvfb-run`. Set `HK_GPU` to
`auto`, `software` or `linux-hardware-vulkan` to choose.
`node scripts/contact-sheet.mjs` renders recipes into a sheet for review, and
`node scripts/measure-load.mjs [fast4g|cable]` times a cold load of the built
playground.

## Making a change

1. Branch off `main`.
2. Write the test first. A bug fix should come with a test that fails without it.
3. Run `pnpm verify`. A change is not ready while any part of that is red.
4. Commit with [Conventional Commits](https://www.conventionalcommits.org):
   `fix:`, `feat:`, `docs:`, `refactor:`, `test:`, `chore:`. Release Please uses
   these commits to drive the changelog and next version number.
5. Open a pull request describing what changed and why.

## What gets reviewed

- Does it do what it says, and is there a test proving it?
- Does it keep the public API honest? A breaking change needs a `!` or a
  `BREAKING CHANGE:` footer.
- Does it keep the core pure? Code in `src/format`, `src/makehuman`,
  `src/morph`, `src/subdiv`, `src/build`, `src/mhclo`, `src/recipe`,
  `src/surface`, `src/model` and the headless `src/editor/*.ts` stays free of
  React and the DOM so it can be tested in Node. Code in `src/react`,
  `src/render`, `src/editor/ui` and `src/worker` is proven in the playground
  and the Playwright suite.
- Does it preserve the age policy (`docs/AGE-POLICY.md`) and the independence
  of regional traits described in `docs/ARCHITECTURE.md`?
- Does it look right across the whole range? A change to skin, lighting or
  tone mapping must keep `e2e/colour-parity.spec.ts` green: every skin tone and
  non-human colour renders with the same small error. Screenshot what you
  changed and look at it at both ends of the tone range.
- Are the types right for consumers? CI runs `publint` and `arethetypeswrong`
  because broken types only surface at integration time.

## Asset data

`packs/body/data` and `packs/adult-anatomy/data` are generated from the CC0
MakeHuman assets:

```sh
pnpm pack:data <makehuman-checkout>/makehuman/data <makehuman-system-assets-dir>
```

The first argument is the `makehuman/data` directory of a checkout of
github.com/makehumancommunity/makehuman; the second is the extracted
"MakeHuman system assets" pack (eyes, teeth, tongue). The packer refuses any
file that does not prove CC0 from its own content and writes each pack's
`PROVENANCE.md`. Packing is deterministic, so regenerating unchanged sources
gives byte-identical files. Do not edit the data by hand; change
`scripts/pack-makehuman.ts` and regenerate. See `NOTICE.md` for provenance.

`packs/clothing/data` comes from the same system assets pack, against the body
pack already committed:

```sh
pnpm pack:clothing <makehuman-system-assets-dir>
```

It refuses any garment file that does not prove CC0 from its own header.

## Releases

Releases are automated. Merging a conventional commit to `main` opens a release
pull request; merging that publishes to npm with provenance. Do not hand-edit
versions or the changelog.
