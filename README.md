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
- **Validated regional-contact evidence.** `RegionalContact` records a known
  surface or aperture-entry sample and rejects a topology mismatch. It does not
  trigger animation, physiology, injury or visual response. The planned,
  neutral injury-state boundary and its renderer proof gates are in
  [Regional contact and injury contract](./docs/REGIONAL-CONTACTS.md).
- **Rig, poses and expressions.** The body pack carries the 163-bone default
  skeleton, skin weights and 60 facial pose units. The kit fits the skeleton to
  every morphed body, poses it, and plays named expressions over it (see
  [Rig and poses](./docs/API.md#rig-and-poses)).
- **Animation, as an optional pack.** `humanoid-kit-animations` plays clips on
  any figure whatever its size, shape or age, with its planted feet held in
  place.
- **Body hair, eyebrows, eyelashes and facial hair.** Body hair follows the
  figure's age and recipe, and the hair pack carries eyebrows, eyelashes and
  authored beard and moustache assets beside the scalp styles. A recipe selects
  zero or more facial assets through `recipe.facialHair`; they share the hair
  colour and can be removed independently. A selected source beard may opt
  into `facialHairLength` or `facialHairGrowth`; the latter hides the
  attachment at zero, reproduces the packed source at its midpoint, and grows
  from measured source-card roots to an inspectable rest-floor bound. The
  remaining beard-style, streaking and miniature requirements are tracked in
  issue 14.
- **A tap-to-edit creator.** `humanoid-kit/editor` is a React creator over the
  recipe, with undo, randomisation, regional overrides and a wardrobe.
- **Presence and interactions.** A figure publishes what the scene around it
  needs (anchors, footprint, reach, whether it is an adult), and the framework-free
  interaction core lets figures and objects agree and play shared interactions
  under the age policy (see [Interactions](./docs/INTERACTIONS.md)).

## Packages

This repository is a pnpm workspace that publishes seven packages: the
library and six data packs.

| Package | Directory | Licence | Contents |
| --- | --- | --- | --- |
| `humanoid-kit` | `.` | MIT | The code: asset loading, recipes, evaluation, subdivision, rig and poses, animation playback, presence, interactions, the worker client, the React bindings and the creator |
| `humanoid-kit-body` | `packs/body` | CC0 1.0 | The base mesh, shape targets for ages 1 to 90, the 163-bone skeleton and skin weights, facial pose units, eyes, teeth and tongue, and 275 shape modifiers (modelling, measurement and body shapes) with their sliders |
| `humanoid-kit-adult-anatomy` | `packs/adult-anatomy` | CC0 1.0 | 96 adult-only targets and 12 modifiers (9 with sliders; 3 retained legacy ids, hidden from the sliders and still accepted in saved recipes). A separate install; refused unless built against the exact body pack |
| `humanoid-kit-hair` | `packs/hair` | Per-asset licences; see attribution | 41 hair entries: 16 scalp styles, 12 eyebrows, 4 eyelashes and 9 authored facial-hair assets bound to the base body, all tintable from black to platinum. A separate install; an entry's files load when a figure first wears it. The explicit CC0-only profile excludes attributed assets |
| `humanoid-kit-eyes` | `packs/eyes` | CC0 1.0 | 32 eye materials (human irises, cats' slit pupils, toon and creature eyes) that add iris pattern and sclera detail to the eye shader's own colours. A separate install; a material's texture loads when a figure first wears it |
| `humanoid-kit-animations` | `packs/animations` | CC0 1.0 | 98 clips (walks, a jog, idles, swims, crouches, combat, sitting, 1860s drill and prayer) on MakeHuman's default skeleton, played on any figure whatever its size, shape or age, its planted feet held in place. A separate install; a clip's file loads when a figure first plays it |
| `humanoid-kit-clothing` | `packs/clothing` | CC0 1.0 | 87 garments (suits, shoes, hats, gloves, glasses, masks, held items and more) bound to the base mesh, with the skin each hides: 19 from MakeHuman's system assets and 68 from the community's clothing packs. A separate install; refused unless built against the exact body pack |

The body pack and the adult anatomy pack together account for 287 shape
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
`humanoid-kit-hair` only if your figures wear hair, `humanoid-kit-eyes` only if you want eye variety, and `humanoid-kit-animations` only if they move.

Requirements:

- Node.js 24 or newer for tooling; a browser with WebGL 2 and module workers at
  runtime
- `three` 0.186 or newer (the skin material rewrites the physical lighting
  chunk's direct-diffuse line, which takes its 0.186 form, and the kit's
  materials swap the percentage-closer shadow read in their own shaders; nothing
  else in three is changed)
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
`loadHumanoidAssets` and `HumanoidModel`. In Node the packs' `file:` URLs are read
from disk; pass `fetch` to `loadHumanoidAssets` (or `loadAnimationLibrary`) to supply
your own:

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
- Under 18 the policy also refuses pubic body hair, any piercing at a site that
  is not one of the body's own, and the `arousal` skin-state signal. Axillary,
  facial and limb hair follow puberty and are not restricted.
- `withAge(recipe, age)` returns a copy at a new age. Moving below 18 removes the
  adult anatomy values, pubic hair and adult piercing sites explicitly; the
  original is untouched.
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
| `humanoid-kit/react` | `HumanoidProvider`, `Humanoid`, `useHumanoidClient`, `useHumanoidReady`, `PresenceProvider`, `usePresence`, `usePresenceRegistry`, `useProximity`, `Miniatures`, `StudioStage`, `HumanoidAffordances` | yes |
| `humanoid-kit/editor` | `HumanoidCreator`, `useHumanoidEditor`, `SliderRow` | yes |
| `humanoid-kit/worker` | The worker module that `HumanoidWorkerClient` starts by default | no |

See the [API reference](https://jbcom.github.io/humanoid-kit/api/) and the
[architecture notes](https://jbcom.github.io/humanoid-kit/architecture/).

## Roadmap

Status per milestone. The architecture notes carry the detail
([Roadmap](./docs/ARCHITECTURE.md#roadmap)).

| Milestone | Status |
| --- | --- |
| Editor shell (`humanoid-kit/editor`) | Done. A doll form is planned (issue 98) |
| Rig, poses and expressions | Done: fitted skeleton, posing, named expressions |
| Adult anatomy sculpting | In progress: the layers, state plumbing and a refined adult surface ship; the own-sculpt phase is planned |
| Scalp hair | Done: `humanoid-kit-hair` |
| Body and facial hair | Body hair, eyebrows, eyelashes and nine authored facial assets ship. The ten `bodyHair.beard` style controls currently drive the short coat only; selected source beards have opt-in offset length and rest-floor growth. Miniature bakes can opt into the exact selected source alpha cards with embedded RGBA maps; solid miniature styling, alpha-style choices and streaking remain open in issue 14. |
| Clothing | Done: `humanoid-kit-clothing`, bound `.mhclo` layers including `delete_verts` |
| Anthro traits | Planned (issue 97). The shared coat module for body hair and fur is built |
| Fur, scales and feathers as layers | Planned (issue 99) |
| Animation | `humanoid-kit-animations` is done; `humanoid-kit-adult-animations` waits on an owner ruling on its scope (issue 105) |
| Interactions and spatial awareness | In progress: presence ships; the interaction core ships its first two slices and the rest are tracked (issues 100 to 104) |

## Compatibility

| Dependency | Supported |
| --- | --- |
| three | `>=0.186` |
| react | `>=19` (optional) |
| @react-three/fiber | `>=9` (optional) |
| @react-three/drei | `>=10` (optional) |
| Module format | ESM only |

Sources import with `.ts` specifiers. `tsconfig.json` sets
`allowImportingTsExtensions` and `rewriteRelativeImportExtensions`, so the
emitted JavaScript imports `.js`.

## Data and licensing

The code is MIT licensed. The data packs are CC0 1.0 and derived from the
MakeHuman project's assets, which were released under CC0 1.0 in September 2020,
and from community assets whose pages state CC0. The skin colour anchors in
the code derive from a CC BY 4.0 dataset, with its attribution (see
`NOTICE.md`).
Only asset data is used, never MakeHuman program code. The packer refuses any
source file that does not prove CC0 from its own content, and each pack's
`data/PROVENANCE.md` records the upstream commit, the licence evidence and the
SHA-256 of every output. `NOTICE.md` has the details. "MakeHuman" is the upstream
project's name; humanoid-kit is not affiliated with it.

The public demo ships the body pack and the hair pack. `pnpm check:pages` fails if any
adult anatomy data file appears anywhere in the built site, or if the demo app's
build names the pack's package, targets or modifiers.

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) and [AGENTS.md](./AGENTS.md). The
maintainers' standing rulings, which a change must not contradict, are in
[docs/DECISIONS.md](./docs/DECISIONS.md). Security issues go through
[SECURITY.md](./SECURITY.md).
