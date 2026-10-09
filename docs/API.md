---
title: API reference
description: The public surface of every humanoid-kit entry point and data pack that exists today.
---

> **Pre-release, API in development.** This page documents the exports in the
> repository today. Signatures, option names and defaults will change before
> `0.1.0`. `humanoid-kit/editor` is declared in `package.json` but is **not
> implemented**, so it has no API here.

All entry points are ESM-only and ship TypeScript declarations.

## `humanoid-kit`

The core. It imports no React, DOM or three.js; it works with typed arrays.

### Loading assets

```ts
loadHumanoidAssets(options: LoadOptions): Promise<HumanoidAssets>
```

Fetches and parses the packs.

```ts
interface LoadOptions {
  body: PackLocation;           // e.g. bodyPack from humanoid-kit-body
  adultAnatomy?: PackLocation;  // e.g. adultAnatomyPack
}

type PackLocation =
  | string // a directory URL holding manifest.json and the binaries
  | { manifest: string; files: Record<string, string> }; // what the packs export
```

- Rejects with `AssetFormatError` when a request fails, a buffer range exceeds
  its file, a target is duplicated, or the adult pack was built for a different
  body pack (`topology` or `bodySha256` mismatch).
- Returns `HumanoidAssets`: the `manifest`, typed-array views of `positions`,
  `uvs`, `faceVerts`, `faceUvs`, `skinIndex` and `skinWeight`, a `targets` map
  (`SparseTarget`: `indices`, `deltas`, `scale`), a `modifiers` map
  (`ShapeModifierEntry`) and `adultAnatomyLoaded`. With the adult pack loaded,
  `targets` and `modifiers` include its entries.

Also exported:

- `parseHumanoidAssets(manifest, body, targets, adultAnatomy?)`: the same parsing
  from already-fetched buffers. Pure; usable in workers and tests.
- `groupFaces(assets, name): Uint32Array`: face indices of a named face group
  such as `body`. Throws `AssetFormatError` for an unknown group.
- `jointPosition(assets, positions, joint, out, offset?)`: writes a skeleton
  joint's centroid over the given positions.
- Types: `BodyManifest`, `AdultAnatomyManifest`, `AdultAnatomyData`,
  `TargetEntry`, `ShapeModifierEntry`, `BoneEntry`, `BvhJoint`, `FaceGroup`,
  `BufferRange`, `PackSource`.
- `AssetFormatError`.

### Recipes

```ts
createRecipe(init?: {
  macros?: Partial<MacroValues>;
  regionalMacros?: Recipe["regionalMacros"];
  modifiers?: Record<string, number>;
}): Recipe
```

Builds a recipe over the defaults. It copies its input and does not validate it;
validation happens at evaluation. `RECIPE_VERSION` is `1`.

```ts
interface Recipe {
  version: 1;
  macros: MacroValues;
  regionalMacros: Partial<Record<BodyRegion, Partial<RegionalMacroValues>>>;
  modifiers: Record<string, number>; // id -> [-1, 1]; one-sided [0, 1]; missing = 0
}

type RegionalMacroValues = Omit<MacroValues, "age">;
```

A recipe is plain data, so `JSON.stringify` round-trips it.

### Macros

```ts
interface MacroValues {
  gender: number;          // 0 female anchor, 1 male anchor
  age: number;             // years, 1 to 90
  muscle: number;          // 0..1
  weight: number;          // 0..1
  height: number;          // 0..1, 0.5 is the base mesh
  proportions: number;     // 0..1, 0.5 is the base mesh
  african: number;         // ethnic anchors, normalised to sum to 1
  asian: number;
  caucasian: number;
  breastSize: number;      // 0..1; adult-only
  breastFirmness: number;  // 0..1; adult-only
}
```

- `DEFAULT_MACROS`: gender 0.5, age 25, muscle, weight, height, proportions,
  breastSize and breastFirmness 0.5, ethnic anchors 1/3 each.
- `macroTargetWeights(macros): Map<string, number>`: target name to weight, for
  names that exist in the packed data. Never weights breast targets under 18.
- Axis functions returning `AxisWeights`: `genderAxis`, `ageAxis`, `muscleAxis`,
  `weightAxis`, `heightAxis`, `proportionAxis`, `cupAxis`, `firmnessAxis` and
  `ethnicAxis`; `combine(prefix, axes)` takes their Cartesian product.
- Constants: `AGE_ANCHORS` (baby 1, child 11, young 25, old 90), `MIN_AGE` 1,
  `MAX_AGE` 90, `ADULT_AGE` 18.
- `isEmptyUpstreamCombination(name)`: true for combinations upstream ships no
  file for.

Axis inputs are clamped to their range, and the age axis clamps to 1 to 90. The
ethnic anchors are floored at 0 and normalised.

### Regions

```ts
const BODY_REGIONS = ["head", "neck", "chest", "breastL", "breastR",
  "arms", "hands", "abdomen", "pelvis", "legs", "feet"] as const;
type BodyRegion = (typeof BODY_REGIONS)[number];
```

- `regionOfBone(boneName): BodyRegion`: which region a bone's skin weight counts
  towards.
- `buildRegionField(assets, smoothing = 6): RegionField`: soft per-vertex masks
  that sum to 1 at every vertex. `RegionField` is `{ names, masks }`.
- `vertexAdjacency(vertexCount, faceVerts)`: CSR vertex adjacency from quads.

### Age policy

- `ADULT_AGE` (18) and `isAdult(recipe)`.
- `agePolicyViolations(recipe): string[]`: every reason the recipe breaks the
  policy; empty when valid.
- `assertAgePolicy(recipe)`: throws `AgePolicyError` listing the violations.
- `withAge(recipe, age): Recipe`: a copy at a new age. Moving below 18 resets
  `breastSize` and `breastFirmness` to their defaults, deletes regional breast
  values and deletes adult-only modifiers. The input is not modified.
- `ADULT_ONLY_MODIFIER(id): boolean`: true for ids starting `genitals/`,
  `pelvis/bulge` or `stomach/stomach-pregnant`.
- `AgePolicyError`.

Under 18, a recipe is invalid if `breastSize` or `breastFirmness` differs from
its default, if any region override contains either key, or if an adult-only
modifier is non-zero.

### Evaluation

```ts
new HumanoidModel(assets: HumanoidAssets, options?: { subdivision?: 0 | 1 | 2 })
```

The framework-free pipeline for one loaded body pack. `subdivision` defaults to 1
and throws `RangeError` for anything else.

- `model.evaluate(recipe): Evaluation`
- `model.topology(): SurfaceTopology`: the static render data, sent once.
- `model.regions` and `model.body` (`SurfaceMesh`).

```ts
interface Evaluation {
  positions: Float32Array;  // render vertices, xyz, metres
  normals: Float32Array;    // smooth, shared across UV seams
  groundOffset: number;     // lift that puts the lowest body point on y = 0
  control: Float32Array;    // morphed positions in the base topology
}

interface SurfaceTopology {
  index: Uint32Array;       // triangles
  uvs: Float32Array;
  skinIndex: Uint16Array;   // four bone indices per render vertex
  skinWeight: Float32Array; // four normalised weights per render vertex
  vertexCount: number;
}
```

`evaluate` throws `AgePolicyError` for a recipe that violates the age policy,
`RecipeError` for an unknown modifier id (adult-only ids need the adult pack),
an adult-only modifier on a minor, or a negative value on a one-sided modifier,
and `MorphError` for an unknown target. Modifier values are clamped to `[-1, 1]`.

Lower-level pieces, also exported:

- `recipeContributions(recipe, modifiers): Contribution[]`: the age check, the
  per-region macro model and the modifiers, as target weights.
- `evaluateMorph(base, targets, contributions, out, regions?)` and
  `mergeRegionalWeights(perRegion)`; `MorphError`; types `Contribution` and
  `RegionField`.
- `buildSurfaceMesh(assets, faces, levels): SurfaceMesh` and
  `evaluateSurface(mesh, control, outPositions, outNormals, scratch?)`.
- `catmullClarkLevel(topology)`, `composeStencils(a, b)`,
  `applyStencil(stencil, input, out)`, `selectionStencil(inputCount, vertices)`
  and `subdivideUvLinear(uvs, faceUvs)`; types `QuadTopology`, `Stencil` and
  `SubdivisionLevel`.

### Worker client

```ts
new HumanoidWorkerClient(load: LoadOptions, model?: ModelOptions, worker?: Worker)
```

The main-thread handle to an evaluation worker.

- `client.ready: Promise<ReadyInfo>` resolves when the worker has loaded its
  packs. `ReadyInfo` is `{ topology, modifiers, sliders, bones,
  adultAnatomyLoaded }`: the render topology, every drivable shape modifier, the
  merged slider taxonomy, the skeleton's bone names (the topology's skin indices
  refer to them) and whether the adult anatomy pack is loaded.
- `client.evaluate(recipe): Promise<Evaluation>` is latest-wins: a request
  replaced by a newer one before it starts rejects with an error named
  `AbortError`. Buffers are transferred from the worker.
- `client.dispose()` terminates the worker and rejects pending requests.
- Errors from the worker arrive as `HumanoidWorkerError` with `name` set to the
  original error's name (for example `AgePolicyError`).
- Without `worker`, the client starts the built worker module next to it
  (`dist/worker/index.js`). Pass your own `Worker` when bundling from source.

## `humanoid-kit/react`

Requires `react`, `@react-three/fiber` and `three`.

### `<HumanoidProvider client>`

Provides one `HumanoidWorkerClient` to the components below it.

### `useHumanoidClient(): HumanoidWorkerClient`

Returns the provided client. Throws outside a `HumanoidProvider`.

### `useHumanoidReady(): ReadyInfo | null`

Returns `null` until the worker has loaded its packs, then its `ReadyInfo`.

### `<Humanoid recipe />`

Renders a recipe as a mesh inside a React Three Fiber canvas.

| Prop | Meaning |
| --- | --- |
| `recipe` | The `Recipe` to render |
| `material?` | A three.js `Material`; defaults to neutral clay |
| `onEvaluated?` | Called with each `Evaluation` |
| `onError?` | Called with evaluation errors other than a superseded request |
| other props | Passed to the wrapping `<group>` |

- Hidden until the first evaluation arrives.
- Updates the geometry in place when `recipe` changes.
- Stores the latest `groundOffset` on the group's `userData`.
- Disposes its geometry and default material on unmount.
- Renders a static mesh; it does not build a skeleton or play animation.

## `humanoid-kit/worker`

The worker module that `HumanoidWorkerClient` starts by default. It owns one
`HumanoidModel`, answers `init` and `evaluate` messages, and transfers its
result buffers. Applications use it through the client, not directly.

## `humanoid-kit-body`

```ts
import { bodyPack } from "humanoid-kit-body";
```

`bodyPack` is `{ manifest, files: { "body.bin.gz", "targets.bin.gz",
"attachments.bin.gz", ...WebP textures } }`, with each value a URL string. Pass it as `body` to `loadHumanoidAssets` or to the worker
client. The package also exposes its files under `humanoid-kit-body/data/*`.

## `humanoid-kit-adult-anatomy`

```ts
import { adultAnatomyPack } from "humanoid-kit-adult-anatomy";
```

`adultAnatomyPack` is `{ manifest, files: { "targets.bin.gz" } }`. Pass it as
`adultAnatomy`. Its targets and modifiers evaluate only for figures aged 18 or
over, and loading it fails unless it was built against the exact body pack.

## Errors

| Error | Thrown when |
| --- | --- |
| `AgePolicyError` | A recipe under 18 sets an adult-only value |
| `RecipeError` | A modifier id is unknown, adult-only for a minor, or one-sided and given a negative value |
| `MorphError` | A contribution names an unknown target or has mismatched region weights |
| `AssetFormatError` | A pack is malformed, incomplete, mismatched or fails to load |
| `HumanoidWorkerError` | The worker fails or the client is disposed |
| `RangeError` | `subdivision` is not 0, 1 or 2 |

Invalid input fails before any geometry is produced.
