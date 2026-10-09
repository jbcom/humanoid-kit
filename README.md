# humanoid-kit

[![CI](https://github.com/jbcom/humanoid-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/jbcom/humanoid-kit/actions/workflows/ci.yml)
[![MIT license](https://img.shields.io/badge/license-MIT-17324d.svg)](./LICENSE)

Parametric human figures for [three.js](https://threejs.org) and
[React Three Fiber](https://github.com/pmndrs/react-three-fiber). One CC0 base
mesh, deformed by a small serializable recipe, subdivided in a Web Worker.

> **Pre-release, API in development.** Nothing is published yet. The surface
> documented here is what exists in the repository today; names, defaults and
> file layouts will change before `0.1.0`. Pin an exact version once one
> exists, and read the changelog before upgrading.

Documentation: **[jbcom.github.io/humanoid-kit](https://jbcom.github.io/humanoid-kit/)**
· Playground: **[jbcom.github.io/humanoid-kit/playground](https://jbcom.github.io/humanoid-kit/playground/)**

## What works today

- **One base mesh, every age.** The CC0 MakeHuman hm08 mesh (19,158 vertices,
  18,486 quads) with shape targets for every age MakeHuman models, 1 to 90
  years, repacked into compact binary files.
- **A recipe is the figure.** A recipe holds MakeHuman's macro variables
  (gender, age, muscle, weight, height, proportions, three ethnic anchors, breast
  size and firmness), optional per-region overrides of those macros, and fine
  shape modifiers by id. It is plain JSON, so saving, sharing and diffing a
  figure are operations on that value.
- **Independent regional traits.** Region masks derived from the skeleton's skin
  weights (head, neck, chest, left and right breast, arms, hands, abdomen,
  pelvis, legs, feet) let any macro except age take a different value in one
  region, for example a different gender anchor for the face than for the hips.
  Regions blend smoothly across joints.
- **A clear age policy.** All ages are supported, and the body follows
  MakeHuman at every age. Genital anatomy lives in a separate package that
  refuses any figure under 18 with `AgePolicyError`, never silently clamped. See
  [Age policy](#age-policy).
- **MakeHuman's own slider taxonomy.** The packs carry MakeHuman's modelling
  tabs, groups, labels, camera hints and descriptions for every macro and
  modifier, ready for an editor to render.
- **Subdivision off the main thread.** Catmull-Clark subdivision (levels 0 to
  2) is precomputed as sparse stencils. A Web Worker evaluates the recipe, and
  the client keeps only the latest request, so dragging a slider never builds a
  backlog.
- **React Three Fiber bindings.** `humanoid-kit/react` provides
  `HumanoidProvider`, `Humanoid`, `useHumanoidClient` and `useHumanoidReady`,
  and the presence bindings (`PresenceProvider`, `usePresence`, `useProximity`).
- **Clothing, as an optional pack.** `humanoid-kit-clothing` carries MakeHuman
  garments bound to the base mesh, so they follow every shape and pose. A recipe
  names what a figure wears (`outfit`); garments layer, hide the skin they cover
  without a gap at the cuff or neckline, and change without rebuilding the body.
  See [Clothing](./docs/ARCHITECTURE.md#clothing-milestone-7).
- **Skeleton and facial pose data ship, ready for later work.** The packs carry
  the 163-bone default skeleton, skin weights and 60 facial pose units. Skin
  weights are interpolated onto the render surface. Posing, rigging and
  expressions are not implemented yet; see the [roadmap](#roadmap).

## Packages

This repository is a pnpm workspace that publishes four packages.

| Package | Directory | Licence | Contents |
| --- | --- | --- | --- |
| `humanoid-kit` | `.` | MIT | The code: asset loading, recipes, evaluation, subdivision, the worker client and the React bindings |
| `humanoid-kit-body` | `packs/body` | CC0 1.0 | The base mesh, shape targets for ages 1 to 90, the 163-bone skeleton and skin weights, facial pose units, eyes, teeth and tongue, and 275 shape modifiers (modelling, measurement and body shapes) with their sliders |
| `humanoid-kit-adult-anatomy` | `packs/adult-anatomy` | CC0 1.0 | Adult-only targets and 5 modifiers with their sliders. A separate install; refused unless built against the exact body pack |
| `humanoid-kit-hair` | `packs/hair` | CC0 1.0 | Ten scalp hair styles (short, bob, long, afro, ponytail, braid) as alpha cards bound to the base body, any colour from black to platinum. A separate install; a style's files load when a figure first wears it |
| `humanoid-kit-animations` | `packs/animations` | CC0 1.0 | 90 clips (walks, a jog, idles, swims, crouches, combat, sitting) on MakeHuman's default skeleton, played on any figure whatever its size, shape or age, its planted feet held in place. A separate install; a clip's file loads when a figure first plays it |
| `humanoid-kit-clothing` | `packs/clothing` | CC0 1.0 | 19 MakeHuman garments (suits, shoes, a hat) bound to the base mesh, with the skin each hides. A separate install; refused unless built against the exact body pack |

The body pack and the adult anatomy pack together account for 280 shape
modifiers. The data packs are generated from MakeHuman's CC0 assets by
`pnpm pack:data`; see [Data and licensing](#data-and-licensing).

## Install

```sh
pnpm add humanoid-kit humanoid-kit-body three
```

For React Three Fiber, add the optional peers as well:

```sh
pnpm add react @react-three/fiber @react-three/drei
```

Add `humanoid-kit-adult-anatomy` only if your application needs adult anatomy,
`humanoid-kit-hair` only if your figures wear hair, and `humanoid-kit-animations` only if they move.

Requirements:

- Node.js 24 or newer for tooling; a browser with WebGL 2 and module workers at
  runtime
- `three` 0.180 or newer
- `react` 19, `@react-three/fiber` 9 and `@react-three/drei` 10 for
  `humanoid-kit/react` (optional; the core works without React)

The packages are ESM-only and ship TypeScript declarations. Each data pack
exports its file URLs as literal `new URL(..., import.meta.url)` expressions, so
a bundler that understands that pattern (Vite, webpack 5, Rspack) emits the data
files automatically. The worker client defaults to the built
`humanoid-kit/worker` module the same way.

## Quick start

```tsx
import { Canvas } from "@react-three/fiber";
import { createRecipe, HumanoidWorkerClient } from "humanoid-kit";
import { Humanoid, HumanoidProvider } from "humanoid-kit/react";
import { bodyPack } from "humanoid-kit-body";

// One worker per app. It loads the body pack and builds the model once.
const client = new HumanoidWorkerClient({ body: bodyPack }, { subdivision: 1 });

// A recipe is plain data: store it, send it, replay it.
const recipe = createRecipe({ macros: { gender: 0.2, age: 34, height: 0.7 } });

export function Scene() {
  return (
    <Canvas>
      <HumanoidProvider client={client}>
        <Humanoid recipe={recipe} />
      </HumanoidProvider>
    </Canvas>
  );
}
```

Without React, use the client directly and build your own geometry from the
result:

```ts
const info = await client.ready; // topology, modifiers, sliders, bones, adult pack flag
const { positions, normals, groundOffset } = await client.evaluate(recipe);
```

To run the same evaluation on the calling thread, or in Node, use
`loadHumanoidAssets` and `HumanoidModel`:

```ts
import { createRecipe, HumanoidModel, loadHumanoidAssets } from "humanoid-kit";
import { bodyPack } from "humanoid-kit-body";

const assets = await loadHumanoidAssets({ body: bodyPack });
const model = new HumanoidModel(assets, { subdivision: 1 });
const evaluation = model.evaluate(createRecipe());
```

## Regional traits

```ts
const recipe = createRecipe({
  macros: { gender: 0.2, age: 34 },
  // A different gender anchor for the head and the pelvis than for the body.
  regionalMacros: {
    head: { gender: 0.8 },
    pelvis: { gender: 0.6 },
  },
  // Fine shape modifiers by id, in [-1, 1] (one-sided modifiers: [0, 1]).
  modifiers: { "nose/nose-scale-horiz-decr|incr": 0.4 },
});
```

Each region evaluates MakeHuman's macro model with the recipe's macros overlaid
by that region's overrides; the region masks then blend the results.

## Age policy

humanoid-kit is a system for using MakeHuman, and its body follows MakeHuman at
every age, including breast development through adolescence. What it adds is
enforced in code:

- Genital, bulge and pregnancy targets are not in the body pack. They live in
  `humanoid-kit-adult-anatomy`, mirroring MakeHuman's separation of genital
  assets from its core.
- A recipe under 18 that sets any adult anatomy modifier throws
  `AgePolicyError` when it is evaluated. It is never silently clamped.
- `withAge(recipe, age)` returns a copy at a new age. Moving below 18 removes the
  adult anatomy values explicitly; the original is untouched.
- The loader refuses an adult anatomy pack unless it records the SHA-256 of the
  exact body pack it is loaded with (`bodySha256`).

[docs/AGE-POLICY.md](./docs/AGE-POLICY.md) sets out the US federal law and
GitHub policy behind these rules, and what remains each application's
responsibility.

```ts
import { adultAnatomyPack } from "humanoid-kit-adult-anatomy";

const assets = await loadHumanoidAssets({ body: bodyPack, adultAnatomy: adultAnatomyPack });
```

## Entry points

| Entry point | Contents | Needs React |
| --- | --- | --- |
| `humanoid-kit` | Asset loading and parsing, recipes, the age policy, macro and region model, `HumanoidModel`, subdivision, the surface builder and `HumanoidWorkerClient` | no |
| `humanoid-kit/react` | `HumanoidProvider`, `Humanoid`, `useHumanoidClient`, `useHumanoidReady`, `PresenceProvider`, `usePresence`, `usePresenceRegistry`, `useProximity` | yes |
| `humanoid-kit/worker` | The worker module that `HumanoidWorkerClient` starts by default | no |

See the [API reference](https://jbcom.github.io/humanoid-kit/API/) and the
[architecture notes](https://jbcom.github.io/humanoid-kit/ARCHITECTURE/).

## Roadmap

Planned, in order. None of this exists in the code yet.

1. Doll form and an editor shell (`humanoid-kit/editor`)
2. Rig, poses and expressions from the shipped skeleton and facial pose units
3. Adult anatomy sculpting
4. Scalp hair (implemented as the `humanoid-kit-hair` pack)
5. Body and facial hair
6. Anthro traits
7. Clothing and surface layers: bound `.mhclo` layers including `delete_verts`;
   fur, scales and feathers as layers
8. Animation packs: `humanoid-kit-animations`, and a separate
   `humanoid-kit-adult-animations` that refuses any participant under 18; spatial
   awareness for multi-person interactions

## Compatibility

| Dependency | Supported |
| --- | --- |
| three | `>=0.180` |
| react | `>=19` (optional) |
| @react-three/fiber | `>=9` (optional) |
| @react-three/drei | `>=10` (optional) |
| Module format | ESM only |

Sources import with `.ts` specifiers. `tsconfig.json` sets
`allowImportingTsExtensions` and `rewriteRelativeImportExtensions`, so the
emitted JavaScript imports `.js`.

## Data and licensing

The code is MIT licensed. The data packs are CC0 1.0 and derived from the
MakeHuman project's assets, which were released under CC0 1.0 in September 2020.
Only asset data is used, never MakeHuman program code. The packer refuses any
source file that does not prove CC0 from its own content, and each pack's
`data/PROVENANCE.md` records the upstream commit, the licence evidence and the
SHA-256 of every output. `NOTICE.md` has the details. "MakeHuman" is the upstream
project's name; humanoid-kit is not affiliated with it.

The public demo ships the body pack and the hair pack. `pnpm check:pages` fails if any
adult anatomy data file appears anywhere in the built site, or if the demo app's
build names the pack's package, targets or modifiers.

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) and [AGENTS.md](./AGENTS.md). Security
issues go through [SECURITY.md](./SECURITY.md).
