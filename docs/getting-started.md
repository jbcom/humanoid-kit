---
title: Getting started
description: Install humanoid-kit and the body pack, describe a figure with a recipe and render it in React Three Fiber or evaluate it directly.
---

This page walks through what the code does today. The package is pre-release, so
treat names and defaults as subject to change before `0.1.0`.

## Install

```sh
pnpm add humanoid-kit humanoid-kit-body three
```

For React Three Fiber, add the optional peers:

```sh
pnpm add react @react-three/fiber @react-three/drei
```

The packages are ESM-only. `humanoid-kit-body` exports the URLs of its data
files as literal `new URL(..., import.meta.url)` expressions, which Vite,
webpack 5 and Rspack resolve to emitted assets. Use one of those toolchains, or
one that implements the same pattern. The worker client starts the built
`humanoid-kit/worker` module the same way unless you pass your own `Worker`.

## 1. Describe a figure with a recipe

A recipe is plain, serializable data: MakeHuman's macro variables, optional
per-region overrides of those macros, and fine shape modifiers by id.

```ts
import { createRecipe } from "humanoid-kit";

const recipe = createRecipe({
  macros: { gender: 0.2, age: 34, height: 0.7 },
  regionalMacros: { head: { gender: 0.8 } },
  modifiers: { "nose/nose-scale-horiz-decr|incr": 0.4 },
});

// A recipe is data: store it, send it, diff it.
const saved = JSON.stringify(recipe);
```

`createRecipe` merges your input over the defaults (gender 0.5, age 25, muscle,
weight, height and proportions 0.5, equal ethnic anchors, breast size and
firmness 0.5) and does not validate. Validation happens when the recipe is
evaluated; see the [age policy](./ARCHITECTURE/#age-policy).

## 2. Render it in React Three Fiber

```tsx
import { Canvas } from "@react-three/fiber";
import { HumanoidWorkerClient } from "humanoid-kit";
import { Humanoid, HumanoidProvider } from "humanoid-kit/react";
import { bodyPack } from "humanoid-kit-body";

// One client per app. It owns the worker, which loads the pack once.
const client = new HumanoidWorkerClient({ body: bodyPack }, { subdivision: 1 });

export function Scene({ recipe }) {
  return (
    <Canvas>
      <HumanoidProvider client={client}>
        <Humanoid recipe={recipe} />
      </HumanoidProvider>
    </Canvas>
  );
}
```

`<Humanoid>` updates its geometry in place when `recipe` changes, so dragging a
slider does not remount anything. Pass `material` to replace the default clay
material, `onEvaluated` to receive each `Evaluation`, and `onError` to receive
failures; an age policy violation arrives as an error whose `name` is
`AgePolicyError` (see [Errors](./API/#errors)). Any other props go to the wrapping
`<group>`.

Create the client in an effect, or once at module scope, and call
`client.dispose()` when you are done with it; it terminates the worker.

## 3. Or evaluate without React

```ts
const info = await client.ready; // { topology, modifiers, sliders, bones, presenceJoints, adultAnatomyLoaded }
const { positions, normals, groundOffset } = await client.evaluate(recipe);
```

`positions` and `normals` are `Float32Array`s over the render vertices described
by `info.topology` (index buffer, UVs, skin indices and weights). `groundOffset`
is the lift in metres that puts the lowest body point on `y = 0`. Results are
transferred from the worker, not copied.

Evaluations are latest-wins: a request replaced by a newer one before it starts
rejects with an `AbortError`.

To evaluate on the calling thread, or in Node, skip the client:

```ts
import { createRecipe, HumanoidModel, loadHumanoidAssets } from "humanoid-kit";
import { bodyPack } from "humanoid-kit-body";

const assets = await loadHumanoidAssets({ body: bodyPack });
const model = new HumanoidModel(assets, { subdivision: 1 });
const evaluation = model.evaluate(createRecipe());
```

Evaluating the same recipe against the same assets always produces the same
geometry. `subdivision` is 0, 1 or 2 and defaults to 1.

## 4. Adult anatomy (optional)

Install `humanoid-kit-adult-anatomy` only if your application needs adult
anatomy, and load it with the body pack:

```ts
import { adultAnatomyPack } from "humanoid-kit-adult-anatomy";

const client = new HumanoidWorkerClient(
  { body: bodyPack, adultAnatomy: adultAnatomyPack },
  { subdivision: 1 },
);
```

Its targets and modifiers evaluate only for figures aged 18 or over. Loading
fails with an `AssetFormatError` if the pack was built against a different body
pack.

## 4b. Animation (optional)

Install `humanoid-kit-animations` only if your figures move. Load its manifest once and
hand the library to a figure; a clip's file loads the first time a figure plays it.

```tsx
import { loadAnimationLibrary } from "humanoid-kit";
import { animationsPack } from "humanoid-kit-animations";

const animations = await loadAnimationLibrary(animationsPack);
// walk_normal, walk_female, idle1, idle2, idlehips, swimcrawlstroke
<Humanoid recipe={recipe} animation={{ library: animations, clip: "walk_normal" }} />;
```

A walk carries the figure forward on its own feet (a child's stride is a child's), its
planted feet held in place; `rootMotion: false` keeps it on the spot, and a new `clip`
fades from the one playing.

## 5. Hair (optional)

Install `humanoid-kit-hair` only if your figures wear hair, and load it with the
body pack. Only its small manifest loads up front; a style's files load the first
time a figure wears it.

```ts
import { hairPack } from "humanoid-kit-hair";

const client = new HumanoidWorkerClient({ body: bodyPack, hair: hairPack });
const { hair } = await client.ready; // { styles: [{ id, label, tags }, ...] } for a picker
const recipe = createRecipe({ hair: { style: "bob02", colour: { eumelanin: 0.2 } } });
```

`recipe.hair.colour` is two pigments and a grey fraction, each 0 to 1
(`HAIR_COLOURS` names twelve natural colours from `black` to `white`, and
`override` takes any linear-RGB colour for dyed hair). `<Humanoid recipe>` draws
the hair; with `client.evaluate` you get `evaluation.hair` and
`client.hairTopology(evaluation.hair.id)`. Hair never changes the body.

## 6. Clothing (optional)

Install `humanoid-kit-clothing` to dress figures, and load it with the body
pack:

```ts
import { clothingPack } from "humanoid-kit-clothing";

const client = new HumanoidWorkerClient({ body: bodyPack, clothing: clothingPack });
const recipe = createRecipe({ outfit: ["suits/male_casualsuit01", "shoes/shoes03"] });
```

A recipe names what a figure wears by garment id, in any order; the garments
stack by themselves (trousers over shoes, a jacket over a suit), hide the skin
they cover, and follow the figure's shape and pose. `ready.wardrobe` lists the
ids on offer. The garments load after the body's shape targets, so a figure that
wears nothing never waits for them, and changing the outfit does not rebuild the
body. Loading fails with an `AssetFormatError` if the pack was built against a
different body pack.

## Serving packs from a directory

`body`, `adultAnatomy`, `hair` and `clothing` also accept a string directory URL. The directory must
hold the pack's `manifest.json` and its binary files under the names the
manifest lists:

```ts
const client = new HumanoidWorkerClient({ body: "/assets/body" });
```

## Try the playground

The repository includes a playground, the library's own demo, at
[jbcom.github.io/humanoid-kit/playground](https://jbcom.github.io/humanoid-kit/playground/).
It loads the body and hair packs and offers sliders for gender, age, muscle,
weight and height, skin, eyes, and a choice of hair style and colour. To run it
locally:

```sh
pnpm install
pnpm dev
```

The playground also accepts a `recipe` query parameter holding recipe JSON, and
`view=front|side|back|face`. Add `clothing` to load the clothing pack (a recipe's
`outfit` then dresses the figure, and the creator gains a Wardrobe tab).
