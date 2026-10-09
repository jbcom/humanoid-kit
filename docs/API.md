---
title: API reference
description: The public surface of every humanoid-kit entry point and data pack that exists today.
---

> **Pre-release, API in development.** This page documents the exports in the
> repository today. Signatures, option names and defaults will change before
> `0.1.0`.

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
  firstFigureAge?: number;      // whose targets a staged load brings first; default 25
}

type PackLocation =
  | string // a directory URL holding manifest.json and the binaries
  | { manifest: string; files: Record<string, string> }; // what the packs export
```

- Rejects with `AssetFormatError` when a request answers with an error status
  (a network failure rejects with the platform's `TypeError`), a buffer range exceeds
  its file, a target is duplicated, or the adult pack was built for a different
  body pack (`topology` or `bodySha256` mismatch).
- Returns `HumanoidAssets`: the `manifest`, typed-array views of `positions`,
  `uvs`, `faceVerts`, `faceUvs`, `skinIndex` and `skinWeight`, a `targets` map
  (`SparseTarget`: `indices`, `deltas`, `scale`), a `modifiers` map
  (`ShapeModifierEntry`), `adultAnatomyLoaded`, `adultAnatomyManifest`,
  `targetFilesPending` (ids of target files not loaded yet) and `targetFileOf`
  (target name to file id). With the adult pack loaded, `targets` and
  `modifiers` include its entries.

```ts
loadHumanoidAssetsStaged(options: LoadOptions): Promise<StagedHumanoidAssets>

interface StagedHumanoidAssets {
  assets: HumanoidAssets;   // body, attachments, core and the first figure's age anchors
  stages: LoadStage[];      // { files: string[]; loaded: Promise<HumanoidAssets> }, in load order
  complete: Promise<HumanoidAssets>;
}
```

Loads in stages over one link, in `targetLoadOrder(firstFigureAge)`: the first
figure's age anchors with the core, then the body's modifier targets, then the
other age anchors, neighbours first, then the adult pack's targets on their
own. All modifiers and sliders are listed from the start. Each later stage is
fetched once the previous one has settled and is added to the same `assets`.
Its `loaded` promise resolves, or rejects with the failure (an
`AssetFormatError` for an HTTP or format error, the platform's `TypeError` for
a network error or corrupt gzip). A failed stage fails only itself: every other
stage still loads, and `complete` rejects with the first failure.
`loadHumanoidAssets` is this with `complete` awaited.

Also exported:

- `parseHumanoidAssets(pack, adultAnatomy?)`: the same parsing from
  already-fetched, decompressed buffers. Pure; usable in workers and tests.
  `pack.targets` maps file ids (`BODY_TARGET_FILES`) to buffers; `core` is
  required and any others may come later.
- `addTargetFiles(assets, files)`: adds target files by id as they arrive (the
  adult pack's under `ADULT_TARGET_FILE`). Throws `AssetFormatError` for a file
  the loaded packs do not have, one already loaded, or one that fails to
  decode, and then leaves `assets` unchanged.
- `pendingTargetFiles(assets, names)`: the files a list of target names still
  needs; `model.pendingTargetFiles(recipe)` does it for a recipe.
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
  skin?: Partial<SkinRecipe>;
  eyes?: Partial<EyesRecipe>;
}): Recipe
```

Builds a recipe over the defaults (`DEFAULT_MACROS`, `DEFAULT_SKIN`,
`DEFAULT_EYES`). It copies its input and does not validate it; validation
happens at evaluation. `RECIPE_VERSION` is `1`.

```ts
interface Recipe {
  version: 1;
  macros: MacroValues;
  regionalMacros: Partial<Record<BodyRegion, Partial<RegionalMacroValues>>>;
  modifiers: Record<string, number>; // id -> [-1, 1]; one-sided [0, 1]; missing = 0
  skin: SkinRecipe;
  eyes: EyesRecipe;
}

type RegionalMacroValues = Omit<MacroValues, "age">;

interface SkinRecipe {
  melanin: number;      // 0 very fair .. 1 very deep
  haemoglobin: number;  // 0 pale, 0.5 typical, 1 ruddy
  undertone: number;    // -1 cool/pink .. 0 neutral .. 1 warm/golden
  override: Rgb | null; // linear-RGB albedo replacing the natural model (fur, scales, fantasy)
  flush: number;        // 0..1 on cheeks, nose and ears
  lips: number;         // 0..1 lip colour depth
  areola: number;       // 0..1 areola and nipple colour depth
}

interface EyesRecipe {
  iris: Rgb;            // linear RGB
  scleraWarmth: number; // 0 clinical white .. 1 warm ivory
}
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
- `macroTargetNames(): Set<string>`: every name `macroTargetWeights` can
  produce; the body pack's first targets file holds exactly these plus
  `SKIN_LAYER_TARGETS`.
- Axis functions returning `AxisWeights`: `genderAxis`, `ageAxis`, `muscleAxis`,
  `weightAxis`, `heightAxis`, `proportionAxis`, `cupAxis`, `firmnessAxis` and
  `ethnicAxis`; `combine(prefix, axes)` takes their Cartesian product.
- Constants: `AGE_ANCHORS` (baby 1, child 11, young 25, old 90), `MIN_AGE` 1,
  `MAX_AGE` 90, `ADULT_AGE` 18.
- `isEmptyUpstreamCombination(name)`: true for combinations upstream ships no
  file for.

Axis inputs are clamped to their range, and the age axis clamps to 1 to 90. The
ethnic anchors are floored at 0 and normalised.

### Features

`buildFeatureMap(assets): FeatureMap` finds which slider group shapes each
base vertex, from the groups' own modifier targets: the group that moves a
vertex most relative to its own peak, the most local one when several move it
comparably. `FeatureMap` is `{ features: FeatureRef[], vertexFeature }`, a
`FeatureRef` being `{ task, group, label }` in the merged slider taxonomy and
`vertexFeature` a `Uint8Array` of indices (`NO_FEATURE` where no group reaches
a vertex by a fifth of its peak). Adult-only modifiers and whole-figure
archetypes (`ARCHETYPE_MODIFIER_GROUPS`, MakeHuman's body shapes) never place a
feature. It needs the modifier targets. `model.renderFeatures(vertexFeature)`
carries it to the body's and the attachments' render vertices.

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
- `appliedAnatomy(recipe, features): Record<string, number>`: which adult
  anatomy the recipe applies, by feature id with its presence 0..1. `features`
  is the adult pack's list (`ReadyInfo.anatomy.features`, from the manifest's
  `anatomy`: today `penis`, `testes`, `mound`, each tied to its own modifiers);
  the core names no adult modifier, so without the pack it is empty and so is
  the result. A feature is present
  once any of its modifiers is non-zero, in either direction; features are
  independent, and the sculpt's vulva and clitoris will be further features
  rather than a point on one axis. Always `{}` under 18. Skin layers take it as
  `SkinPaintInput.anatomy`.

Under 18, a recipe is invalid if `breastSize` or `breastFirmness` differs from
its default, if any region override contains either key, or if an adult-only
modifier is non-zero.

### Evaluation

```ts
new HumanoidModel(assets: HumanoidAssets, options?: { subdivision?: 0 | 1 | 2 })
```

The framework-free pipeline for one loaded body pack. `subdivision` defaults to 1
and throws `RangeError` for anything else.

- `model.evaluate(recipe, signals?): Evaluation`: `signals` (0..1 each) set the
  skin's state; those with a state morph add their targets: `cold` (the nipple
  rises and the areola contracts; `STATE_MORPHS`) and `arousal` (engorgement:
  the shaft's circumference +25% and length +43% at full arousal, the measured
  erect against flaccid; the adult pack's own, from its manifest's
  `anatomy.stateMorphs`), each calibrated to its measured response.
  `stateContributions(signals, morphs?, exists?)` gives those target weights for
  the morphs in force, limited to targets `exists` accepts; the model passes
  the body's and the adult pack's morphs and the loaded packs' targets, so a
  state of the adult anatomy does nothing, rather than fails, without the adult
  pack. `ADULT_ONLY_SIGNALS` (`arousal`) throw `AgePolicyError` under 18
  (`assertSignalPolicy`), before any target is named. Today the penis targets
  deform `helper-genital`, which the surface does not draw, so engorgement
  moves `Evaluation.control` and no drawn vertex until the sculpt phase.
- `model.topology(): SurfaceTopology`: the static render data, sent once. A
  worn attachment set the body pack did not bake gets its occlusion at rest
  only (every pose corner holding the rest value).
- `model.bakePosedOcclusion(): Generator<void, Float32Array[] | null>` bakes
  that set's pose corners, yielding before each one so a caller can let other
  work in between; it returns per-render-vertex arrays shaped like
  `AttachmentTopology.occlusion`, or null for the pack's own set.
  `model.bakeAttachmentOcclusion()` is the whole bake at once, per control
  vertex (what the packer stores).
- `model.regions` and `model.body` (`SurfaceMesh`).

```ts
interface Evaluation {
  positions: Float32Array;  // render vertices, xyz, metres
  normals: Float32Array;    // smooth, shared across UV seams
  groundOffset: number;     // lift that puts the lowest body point on y = 0
  control: Float32Array;    // morphed positions in the base topology
  curvature: Float32Array;  // per body render vertex, mean curvature (1/m)
  boneHeads: Float32Array;  // the skeleton fitted to this figure: each bone's rest head, xyz
}

interface SurfaceTopology {
  index: Uint32Array;       // triangles
  uvs: Float32Array;
  skinIndex: Uint16Array;   // four bone indices per render vertex
  skinWeight: Float32Array; // four normalised weights per render vertex
  vertexCount: number;
}
```

`evaluate` throws `MorphError` for a recipe that needs target files not loaded
yet (`model.pendingTargetFiles(recipe)` names them), `AgePolicyError` for a recipe that
violates the age policy,
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

### Surface appearance

Colour and light transport, framework-free so applications and tests can
compute what the renderer will do.

- `skinAlbedo(tone: SkinTone): Rgb`: linear-RGB diffuse albedo. Natural skin
  interpolates the 11 measured `MELANIN_ANCHORS` (International Skin Spectra
  Archive, ITA 62° to −75°), then shifts hue for `haemoglobin` and `undertone`
  at constant luminance; `override` returns that colour as given. Also
  `DEFAULT_SKIN_TONE`, `luminance`, `srgbToLinear` and `linearToSrgb`.
- `measuredSkinLightness(tone)`: the skin's CIELAB L\* as a spectrophotometer
  reports it (albedo plus `SKIN_F0`, the surface reflection), the scale
  measured skin data uses.
- `lipAlbedo(tone, depth)` and `areolaAlbedo(tone, depth)`: lip colour from
  measured lips paired with measured skin, and areola colour with 1 + 2 × depth
  times the skin's melanin optical density (twice at the default 0.5;
  research/SKIN-RENDERING.md §5.6), `MELANIN_FREE_RED_REFLECTANCE` its baseline.
  `depth` 0..1 is the recipe's slider.
- CIELAB conversions: `labFromLinear`, `linearFromLab`, `lchFromLab`,
  `labFromLch` (D65).
- Skin layers (ARCHITECTURE.md, "Parallel work: the base contract"):
  `SkinLayer` (`id`, `blend`, `targets`, `fields(assets)`, `paint(input)`),
  `SKIN_LAYERS` (the stack, in order: flush, lips, areola, the state layers
  below, then `ADULT_SKIN_LAYERS`: penis, testes, mound), `SKIN_LAYER_TARGETS`
  (the body layers' only: an adult layer names none, the adult pack's manifest
  does),
  `targetMask(assets, targets, lo, hi)` for masks measured from targets,
  `diskMask(assets, targets, soft?)` for a feature the targets outline (filled
  per side of the body),
  `targetCoordinate(assets, target)` for a 0..1 coordinate from one target's
  displacement,
  `buildLayerFields` (a layer that is not `available`, an adult layer whose
  targets have not loaded, stays zero), `paintStopTable(layers, input)` (the figure's stop table,
  `STOP_COUNT` stops in rows of `STOP_TABLE_WIDTH` texels) and
  `applyLayers(base, table, fields)`, the per-pixel blend the shader performs.
  A layer is one of three kinds: a `ColourLayer` (the default: `blend`, and
  `paint` giving `strength` and colour `stops`), a `DetailLayer` (`kind:
  "detail"`, `pattern` `"bumps"` or `"creases"`, `paint` giving `strength`,
  `height` in metres and `size`: bump spacing in metres, or crease count across
  the coordinate) drawn at true scale and faded where finer than a pixel, or a
  `SurfaceLayer` (`kind: "surface"`, `paint` giving `strength`, a `roughness`
  change and a `specular` change). `surfaceChange` and `creaseHeight` are the
  shader's references; `uvScale(assets, faces)` gives metres of skin per UV
  unit, one value for each UV island (carried as `body.uvScale` in the
  topology).
  A layer of the adult anatomy sets `adult: { feature }` (`isAdultLayer`):
  `paintStopTable` paints it only when `SkinPaintInput.adult` is true (from
  `isAdult(recipe)`; absent is false) and `SkinPaintInput.anatomy[feature]` is
  above 0 (from `appliedAnatomy(recipe, features)`), scaling its strength by that
  presence; otherwise its row is zero and its `paint` is never called. The gate
  lives in `paintStopTable` alone, so a layer cannot forget it.
  `genitalAlbedo(tone, site, arousal?)` is the adult layers' colour: modelled
  along the melanin and haemoglobin axes, **uncalibrated** (no measured genital
  colorimetry exists; research/SKIN-STATES.md, A4).
  `model.adultLayerFields(): LayerFieldsUpdate | null` gives the adult layers'
  fields per render vertex once the adult pack's targets have loaded (null
  before, and without the pack); the topology always carries those layers as
  zero.
  The model's topology carries `body.layerFields` and `body.layers`; the
  renderer rasterises them once into a shared field atlas
  (`humanoid-kit/react` does this for `<Humanoid>`).
- Skin-state layers (`src/surface/regions/states.ts`), driven by the signals in
  `SkinPaintInput.signals`; every magnitude is cited, or marked as a choice, in
  research/SKIN-STATES.md Part C:
  - `GOOSEBUMP_LAYER` (`cold`, `fear`: either raises papules, and two triggers
    combine as independent): a `bumps` detail layer on hair-bearing skin only,
    `GOOSEBUMP_HEIGHT` (194 µm at signal 1) tall at `GOOSEBUMP_DENSITY_PER_CM2`
    (21) per cm². Relief is a close-up effect: it fades where a cell is finer
    than about a pixel (a few millimetres), so at full-figure distances the
    skin shows nothing.
  - Flush and pallor, colour layers that multiply the skin by
    `haemoglobinRatio(tone, FLUSH_DELTA[state])` with the signal as strength:
    `HEAT_FLUSH_LAYER` (`heat`, the whole body), `EXERTION_FLUSH_LAYER`
    (`exertion`: face, neck, chest), `BLUSH_LAYER` (`blush`: cheeks, ears,
    forehead, neck, chest), `COLD_PALLOR_LAYER` (`cold`: hands, feet, ears, nose,
    a little forearms, shins and cheeks) and `FEAR_PALLOR_LAYER` (`fear`: face
    and neck), and `LIP_STATE_LAYER` (`cold` turns the lips bluer, `fear` paler:
    `lipStateAlbedo(tone, depth, cold, fear)`). `haemoglobinRatio(tone, delta)`
    is the skin model's own response to `delta` more haemoglobin, in units of the
    measured axis (limited to ±1, so a state moves the skin no further than the
    spread people have); melanin attenuates it as it does the resting spread, and
    a colour that is not human skin (`tone.override`) has none to move. No state
    layer changes lightness.
  - Sweat sheen, two `SurfaceLayer`s over regional sweat maps: `SWEAT_REST_LAYER`
    (`heat`: the passive-heating map) and `SWEAT_EXERCISE_LAYER` (`exertion`: the
    exercise map, wetter and more even). `SWEAT_RATE` is Taylor and
    Machado-Moreira's regional rates (mg/cm²/min, `[rest, exercise]`),
    `wetness(rate)` turns a rate into 0..1 wetness, and `SWEAT_ROUGHNESS` and
    `SWEAT_SPECULAR` are the change at full wetness. The two signals share one
    sweat drive, `1 - (1 - heat)(1 - exertion)`, split between the maps by
    their shares, so both at 1 is half of each map.
  - `skinZones(assets)`, `SKIN_ZONES`, `zoneOfBone(bone)`: the body's zones
    (head, hand, thigh, …) as soft per-vertex masks from the skin weights, plus
    its `front`, `palm`, `sole`, `forehead` and `neck` fields from the vertex
    normals, joints and weights, all
    measured from the base mesh and cached per set of assets.
    `buildBoneField(assets, names, zoneOfBone, fallback, smoothing?)` builds
    such a partition for any grouping of the bones (`buildRegionField` is it
    for the shape traits' regions).
- The scatter model `SkinMaterial` renders (its constants and table come from
  these, and the browser tests hold the shader to them): `scatterDistance(albedo, mfp?, slope?, pigmentDepth?,
  substrate?)` gives each channel's scatter width in metres, and
  `scatterTableDiffuse(nDotL, d · curvature)` the diffuse response relative to
  the albedo, sampled from `SCATTER_TABLE` exactly as the shader samples it.
  `preintegratedDiffuse(nDotL, x)` is the exact integral the table is built
  from (Penner's pre-integration of Burley's profile over a sphere): it dims
  the lit side, carries light past the terminator, and keeps Lambert's
  integral over the sphere. `SKIN_SCATTER` holds natural skin's parameters,
  and `singleScatterAlbedo`, `profileScale` and `WAVELENGTH_RATIO` the steps.
- `bakeOcclusion(occluders, targets, options?)`: per-vertex ambient occlusion
  by cosine-weighted ray casts (`hemisphereDirections(n)`), as used for
  attachments.
- Skin-state time (ARCHITECTURE.md, "Skin states"): `stepSkinState(current,
  target, dt, rates?)`, a pure step of every signal toward its target (0..1
  each; a missing one is 0) by the exact first-order response, with one time
  constant to rise (`attack`) and one to fall (`decay`), in seconds, from
  `STATE_TIME_CONSTANTS` (`cold`, `fear`, `blush`, `exertion`, `heat`; any other
  signal moves at `DEFAULT_STATE_RATE`). `new SkinStateFilter(rates?, initial?)`
  keeps the state between frames: `step(target, dt)` returns the new signals
  (a copy), `value` the current ones, `settled(target)` whether there is
  nothing left to animate, `reset(state?)` jumps. `cold` and `fear` are
  calibrated to the measured goosebump episode (a 3 s trigger shows for 11 to
  12 s); the others are choices (research/SKIN-STATES.md C4).
  `quantiseShapeSignal(s)` and `SHAPE_SIGNAL_STEPS` (50) round the signals
  that reshape the figure, so an easing one does not evaluate every frame.
  `quantisedShapeSignals(recipe, signals, names)` rounds the named ones after
  the age policy has judged them as given: rounding would turn a small or
  negative adult-only signal into 0, so a figure under 18 with any nonzero one
  throws `AgePolicyError` (`<Humanoid>` reports it through `onError` and does
  not evaluate).

### Rig and poses

The skeleton fitted to a figure, and posing (ARCHITECTURE.md, "Skeleton, poses
and expressions"). Framework-free.

- `restBones(assets, control): RestBones`: `names` (skin-weight order),
  `parents` (-1 for the root), `heads` (each bone's head joint over the morphed
  control mesh) and `order` (parents before children).
- `rigData(assets): RigData`: the bone names and facial pose units, small
  enough for the main thread (the worker sends it in `ReadyInfo.rig`).
- `faceUnitRotations(rig, weights): BoneRotations`: an expression from
  MakeHuman's 60 face units (`JawDrop`, `LeftUpperLidClosed`, …), blended in
  log space; a quaternion per bone. Throws for an unknown unit.
  `IDENTITY_POSE(bones)` is the rest pose.
- `skinPositions(rest, rotations, positions, skinIndex, skinWeight, out)`: linear
  blend skinning on the CPU, exactly as the renderer skins, for tests, anchors
  and pose-dependent bakes. `posedBoneHeads(rest, rotations)` gives every
  joint's posed position.
- `bodyPoseRotations(rig, name)`: a whole-body pose from the pack
  (`RigData.poses`: MakeHuman's CC0 `tpose` and `benchmark`, the rigging
  stress pose, and `relaxed`, standing at ease with the arms at the sides); `composeRotations(a, b)` layers `b` (an expression) over `a`.
- `restBonesFrom(names, parents, heads)` rebuilds the rest skeleton from an
  evaluation's `boneHeads` without the packs, and
  `posedGroundOffset(rest, rotations, control, skin)` is the lift that puts a
  posed figure's lowest body point on the ground (`RigSkin`: the pack's skin
  and the visible body's base vertices, sent in `ReadyInfo.rig.skin`).
- Joint flexion as skin signals: `FLEXION_JOINTS` (elbows, knees, wrists),
  `flexionRig(rest)` (each joint's hinge, perpendicular to the upper segment
  and its flex direction) and `jointFlexion(rig, rest, rotations)`, giving
  `flex.<joint>.<side>` from 0 (straight) to 1 (the joint's anatomical limit).
  `<Humanoid>` adds them to the skin's signals for every pose. `posedBones` and
  `rotateByBone` expose the posed bone rotations.
- Pose-keyed occlusion (ARCHITECTURE.md, "Attachment occlusion"):
  `OCCLUSION_KEYS` (jaw open, lips apart, smile), `occlusionKeyBasis(rig)` and
  `occlusionKeyWeights(basis, rotations)` (how much of each key a pose holds),
  `occlusionCorners(keys)`, `occlusionCornerUnits(m)` and
  `occlusionCornerWeights(w)` (the multilinear blend of the corner bakes).
  `AttachmentTopology.occlusion` holds `occlusionCorners` values per render
  vertex, rest first. `rotationVectors(rotations)` gives each bone's rotation
  vector.

### Presence

What each figure tells the scene around it (PRESENCE.md). Framework-free.

- `createPresenceRegistry()`: `set(presence)`, `remove(id)`, `get(id)`,
  `all()`, `tick(seconds)` (call it from the render loop; it measures each
  figure's `velocity` and raises proximity events) and
  `onProximity(radius, listener)`, which reports `{ type: "enter" | "leave",
  ids, distance }` for each pair (entering at `radius`, leaving beyond 1.1 ×
  `radius`) and returns its unsubscribe function.
- `FigurePresence`: `position`, `facing`, `bounds`, `anchors` (head, face,
  chest, hands, feet), `footprint`, `appearance` (measured albedo, luminance,
  specular), `faceRadius`, `adult`.
- `presenceGroups(presences, distance)`: ids of the figures standing together.
- `groundOcclusion(presences, { strength?, spread? })` and
  `sampleGroundOcclusion(points, x, z)`: contact shadows pooled with `max`.
- `faceMetering(presences, { position })`: each face's region, reflectance and
  `skinZoneEV`, heaviest first, and the `deepest` face's id.

### Worker client

```ts
new HumanoidWorkerClient(load: LoadOptions, model?: ModelOptions, worker?: Worker)
```

The main-thread handle to an evaluation worker.

- `client.ready: Promise<ReadyInfo>` resolves when the worker can evaluate the
  first figure (`LoadOptions.firstFigureAge`); later target files may still be
  arriving, and an evaluation that needs one waits in the worker for its stage.
- `client.complete: Promise<void>` resolves when every target file has
  loaded, or rejects with the error that stopped one.
- `ReadyInfo` is `{ topology, modifiers, sliders, rig,
  adultAnatomyLoaded, anatomy? }`: the render topology, every drivable shape
  modifier, the merged slider taxonomy, the rig (`RigData` plus each bone's
  `parents` index; the topology's skin indices refer to `rig.bones`), whether the
  adult anatomy pack is loaded and, with it, its `anatomy` (`AdultAnatomySpec`:
  the features `appliedAnatomy` reads and the state morphs the shape signals
  include).
- `client.evaluate(recipe, key?, signals?): Promise<Evaluation>` (signals as for
  `model.evaluate`) is latest-wins per key:
  each key has at most one evaluation in the worker and one waiting, and a
  waiting request replaced by a newer one rejects with an error named
  `AbortError`. Keys never wait on each other. Buffers are transferred from the
  worker.
- `client.pickMap(): Promise<PickMap>` resolves, once every target file has
  loaded, with which controls shape each rendered vertex:
  `{ features: FeatureRef[], render: { body, attachments } }`, the render
  arrays holding an index into `features` per render vertex (or
  `NO_FEATURE`). The worker builds it on the first call; later calls share it.
  Look up a `<Humanoid onPick>` tap in it to open the tapped part's controls.
- `client.posedOcclusion(): Promise<Float32Array[] | null>` resolves with the
  pose-following occlusion of a worn attachment set the body pack did not bake
  (one array per worn attachment, for `setOcclusionAttributes`), or null when
  `ready`'s topology already follows the pose. The worker bakes it once,
  between evaluations; later calls share it. `<Humanoid>` asks for it itself.
- `client.adultLayers(): Promise<LayerFieldsUpdate | null>` resolves, once the
  adult pack's last load stage has, with the adult anatomy layers' fields per
  render vertex (`{ layers, layerFields }`, `HumanoidModel.adultLayerFields`), or
  null without an adult pack; it rejects with the error that stopped that stage.
  The worker derives it once; later calls share it (treat it as read-only).
  `<Humanoid>` hands it to the shared field atlas itself: `acquireLayerAtlas(
  renderer, topology.body)` returns `{ texture, refresh(update), release() }`,
  and `refresh` re-rasterises only the pages holding those layers, in place
  (`LayerAtlas.refresh`; the texture stays the same object, so the skin shader
  is not recompiled and nothing is re-evaluated). It applies a shared update
  once however many figures pass it.
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

### `useSkinStateFilter(target, options?): Record<string, number>`

Follows `target`, the signals an application wants (each 0..1), at the time
constants of `STATE_TIME_CONSTANTS`, and returns the signals to give
`<Humanoid signals>`: `const signals = useSkinStateFilter({ cold: chilled ? 1 :
0 })`. It starts at the first `target`, so a figure that mounts in a state does
not ease into it (`initial: "rest"` starts at rest instead); `rates` replaces
the time constants (pass a stable object). The component re-renders each frame
while a signal moves and not once they have settled, and a new `target` object
with the same entries changes nothing.

### `<Humanoid recipe />`

Renders a recipe as a mesh inside a React Three Fiber canvas.

| Prop | Meaning |
| --- | --- |
| `recipe` | The `Recipe` to render |
| `material?` | A three.js `Material` replacing the built-in skin material, which follows `recipe.skin` |
| `onEvaluated?` | Called with each `Evaluation` |
| `onError?` | Called with evaluation and texture errors other than a superseded request; without it they are logged to the console |
| `pose?` | A `HumanoidPose`: `body`, a whole-body pose from the pack by name (`"tpose"`, `"benchmark"`, `"relaxed"`), and `faceUnits`, MakeHuman's face units by name with weights 0..1 (`{ JawDrop: 1 }` opens the mouth), layered on top. Absent is the rest pose |
| `signals?` | The skin's state, signals 0..1 (`cold`, `heat`, `exertion`, `blush`, `fear`; `arousal` adults only). Every signal reaches the skin layers (`cold` and `fear` raise goosebumps, `blush`, `exertion`, `heat`, `fear` and `cold` flush or blanch the skin, `heat` and `exertion` bring sweat); those with state morphs also reshape the figure (a re-evaluation, rounded to 50 steps). Never part of the recipe. They apply as given: pass `useSkinStateFilter(target)` to ease them at the pace of a body |
| `onGroundOffset?` | Called with the lift (metres) that puts the figure's lowest body point on y = 0 whenever the figure or its pose changes it; place the group at that height so a crouch or kneel rests on the ground |
| `onPick?` | Called when the figure is tapped (pressed and released within 6 px, so an orbit drag is not a tap) with a `HumanoidPick`: `part` (`"body"` or an attachment index), the nearest render `vertex` and the world `point`. When set, it handles the group's clicks in place of `onClick` |
| other props | Passed to the wrapping `<group>` |

- Hidden until the first evaluation arrives.
- Renders the body and the body pack's attachments (eyes with their own eye
  shader following `recipe.eyes`, teeth and tongue), each attachment shaded by
  its baked occlusion, which follows the pose (an open mouth lights the teeth
  it uncovers).
- Updates the geometry in place when `recipe` changes.
- Stores the latest ground offset (posed when posed) on the group's `userData.groundOffset`.
- Disposes its geometries, textures and built-in materials on unmount.
- Skins the body and attachments to the skeleton fitted to each evaluation
  (linear blend skinning on the GPU) and poses it from `pose`; posing does not
  re-evaluate the figure.

### `<StudioStage background? intensity? />`

A neutral studio for showing figures: a procedural room environment
(three.js `RoomEnvironment`, prefiltered once, no network request), a key light
casting shadows, fill and rim lights, and a soft hemisphere light. Pair it with
the canvas settings it was measured with: `STUDIO_TONE_MAPPING`
(`NeutralToneMapping`) and `STUDIO_EXPOSURE` (1.15). `background` is a CSS
colour (`null` leaves the canvas background alone); `intensity` scales every
light together. It restores the scene environment it replaced on unmount.

## `humanoid-kit/editor`

A complete character creator built on `humanoid-kit/react`, and the hooks it
is made from. Requires the same peers.

### `<HumanoidCreator />`

Render it inside a `HumanoidProvider`; it brings its own canvas, studio stage
and camera.

| Prop | Meaning |
| --- | --- |
| `initialRecipe?` | The figure to start from; defaults to `createRecipe()` |
| `onChange?` | Called with every new recipe, including undo, redo and loads |
| `title?` | Heading shown above the controls |
| `className?` | Added to the root element |
| `children?` | Extra scene content rendered beside the figure |

- One tab per MakeHuman modelling task (Main, Gender, Face, Torso, ...,
  Measure), in upstream order, with MakeHuman's groups and slider labels, plus
  Appearance (skin, iris, sclera) and Regions (per-region macro overrides).
- Tapping the figure opens the controls that shape the tapped part (its tab,
  with the group opened and scrolled into view) and frames that part from the
  front; see `buildFeatureMap`. Dragging orbits the view instead.
- Focusing a slider frames the body part it shapes, from MakeHuman's camera
  hint for that slider.
- Undo and redo (dragging a slider is one step), random figure, reset, and
  save and load of the recipe as JSON. A loaded recipe is validated and checked
  against the loaded packs and the age policy before it replaces the figure.
- Adult-only sliders are disabled, with the reason, under 18.
- On narrow screens the controls become a bottom sheet over the figure.
- Styles are scoped under `.hk-creator` and themed by `--hk-*` CSS variables.

### `useHumanoidEditor(initial?): HumanoidEditor`

The creator's state for the provided client, for building your own editor UI.
`useEditorState(ready, initial?)` is the same over any `ReadyInfo`, without a
worker.

```ts
interface HumanoidEditor {
  ready: ReadyInfo | null;  // null while the packs load
  recipe: Recipe;
  tasks: SliderTask[];      // the slider taxonomy
  modifiers: ModifierTable; // id -> ShapeModifierEntry
  canUndo: boolean;
  canRedo: boolean;
  setSlider(entry: SliderEntry, value: number, gesture?: string): void;
  update(change: (recipe: Recipe) => Recipe, gesture?: string): void;
  settle(): void;           // ends the current gesture
  undo(): void;
  redo(): void;
  randomize(seed: number, options?: RandomizeOptions): void;
  resetAll(): void;
  load(value: unknown): string[]; // problems that stopped it; [] once loaded
}
```

Changes that share a `gesture` key form one undo step. `randomize` is
deterministic for a seed and never sets adult-only modifiers unless
`options.includeAdultAnatomy` is true and the figure is 18 or over. Every
change is undoable.

### `<SliderRow />`

The creator's slider: label, value readout, a reset button and an accessible
range input sized for touch. `onChange(value, gesture)` fires while dragging and
`onSettle()` when the gesture ends; `disabledReason` disables it and says why;
`track` replaces the fill with a CSS background (the skin-tone ramp uses it).

## `humanoid-kit/worker`

The worker module that `HumanoidWorkerClient` starts by default. It owns one
`HumanoidModel` and answers six messages: `init` (replied to with `ready`
once the first figure can be evaluated), `complete` (replied to once every
target file has loaded, or with the error that stopped one), `pickMap`
(replied to with the pick map once everything has loaded), `posedOcclusion`
(replied to once the corner bake, made a corner at a time between other
requests, is done), `adultLayers` (replied to with the adult anatomy layers'
fields once the adult pack's stage has loaded, or null without that pack) and
`evaluate`, which
waits for exactly the load stages its recipe needs without holding up other
requests. Result buffers are transferred. Applications use it through the
client, not directly.

## `humanoid-kit-body`

```ts
import { bodyPack } from "humanoid-kit-body";
```

`bodyPack` is `{ manifest, files: { "body.bin.gz", "targets-core.bin.gz",
"targets-baby.bin.gz", "targets-child.bin.gz", "targets-young.bin.gz",
"targets-old.bin.gz", "targets-modifiers.bin.gz", "attachments.bin.gz",
...WebP textures } }`, with
each value a URL string. Pass it as `body` to `loadHumanoidAssets` or to the
worker client. The package also exposes its files under
`humanoid-kit-body/data/*`.

## `humanoid-kit-adult-anatomy`

```ts
import { adultAnatomyPack } from "humanoid-kit-adult-anatomy";
```

`adultAnatomyPack` is `{ manifest, files: { "targets.bin.gz" } }`. Pass it as
`adultAnatomy`. Its targets and modifiers evaluate only for figures aged 18 or
over, and loading it fails unless it was built against the exact body pack.

Its manifest also carries `anatomy` (`AdultAnatomySpec`): the anatomy features
and the modifiers that apply each, how each adult skin layer's masks are
measured from the pack's targets (`skinLayers`), and the shape states of the
adult anatomy (`stateMorphs`, arousal). This is the pack's data so that the
core, which ships in the public build, names no adult target or modifier
(`pnpm check:pages`); a pack without it adds no adult layers and no state
morphs.

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
