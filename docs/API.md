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
  hair?: PackLocation;          // e.g. hairPack from humanoid-kit-hair; only its manifest loads up front
  clothing?: PackLocation;      // e.g. clothingPack from humanoid-kit-clothing
  firstFigureAge?: number;      // whose targets a staged load brings first; default 25
}

type PackLocation =
  | string // a directory URL holding manifest.json and the binaries
  | { manifest: string; files: Record<string, string> }; // what the packs export
```

- Rejects with `AssetFormatError` when a request answers with an error status
  (a network failure rejects with the platform's `TypeError`), a buffer range exceeds
  its file, a target is duplicated, or the adult pack was built for a different
  body pack (`topology` or `bodySha256` mismatch), as are the hair pack and the
  clothing pack, or when a garment shares an id with an attachment.
- Returns `HumanoidAssets`: the `manifest`, typed-array views of `positions`,
  `uvs`, `faceVerts`, `faceUvs`, `skinIndex` and `skinWeight`, a `targets` map
  (`SparseTarget`: `indices`, `deltas`, `scale`), a `modifiers` map
  (`ShapeModifierEntry`), `adultAnatomyLoaded`, `adultAnatomyManifest`,
  `targetFilesPending` (ids of target files not loaded yet) and `targetFileOf`
  (target name to file id). With the adult pack loaded, `targets` and
  `modifiers` include its entries. `hair` is the hair pack (`HairAssets`) or
  null: `styles` (every `HairStyleEntry` of the manifest, by id), `bound` (the
  styles whose geometry has arrived) and `load(id)`, which resolves with a
  style's geometry, fetching its binary the first time and sharing a fetch that
  is already running (a failed fetch is forgotten, so the next wearer retries).
  A `HairStyleEntry` is an attachment entry (no `deleteVerts`,
  one occlusion value per vertex) with a `label`, `tags` (`short`, `bob`,
  `curly`...), its `kind` (`scalp`, or `brows` or `lashes`, which share the pack's
  loader; `recipe.hair.style` wears scalp hair only and `ReadyInfo.hair.styles`
  carries each entry's kind), its `file` and `sha256`, and the `strand` direction and
  `coherence` measured from its strand map. With the clothing pack loaded,
  `clothingManifest` lists its garments from the start; `garments` (a map of
  `BoundGarment` by id) fills once the garments binary has arrived, and
  `garmentsPending` is true until then.

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
clothing pack's garments (`GARMENTS_FILE`, only with a clothing pack), then the
other age anchors, neighbours first, then the adult pack's targets on their
own. All modifiers and sliders are listed from the start. Each later stage is
fetched once the previous one has settled and is added to the same `assets`.
Its `loaded` promise resolves, or rejects with the failure (an
`AssetFormatError` for an HTTP or format error, the platform's `TypeError` for
a network error or corrupt gzip). A failed stage fails only itself: every other
stage still loads, and `complete` rejects with the first failure.
`loadHumanoidAssets` is this with `complete` awaited.

Also exported:

- `parseHumanoidAssets(pack, adultAnatomy?, clothing?, hair?)`: the same parsing
  from already-fetched, decompressed buffers. Pure; usable in workers and tests.
  `pack.targets` maps file ids (`BODY_TARGET_FILES`) to buffers; `core` is
  required and any others may come later. `clothing` is `{ manifest, garments? }`;
  without `garments` they are pending. `hair` is `{ manifest }`: the styles
  are known, their geometry comes with `addHairStyle`.
- `addGarments(assets, bin)`: adds the clothing pack's decompressed garments
  binary. Throws `AssetFormatError` when no clothing pack is loaded, the
  garments are already loaded, or one fails to check, and then leaves `assets`
  unchanged.
- `addHairStyle(assets, id, bin)`: adds one hair style's decompressed binary.
  Throws `AssetFormatError` for a style the hair pack does not have or bytes
  that do not parse, and then leaves `assets` unchanged.
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
  `HairManifest`, `HairStyleEntry`, `HairAssets`, `HairPackData`,
  `ClothingManifest`, `ClothingPackData`, `GarmentEntry`, `BoundGarment`,
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
  hair?: {
    style?: string | null;
    colour?: Partial<HairColour>;
    brows?: string; // a brows style id of the hair pack (`eyebrow001`…); absent = none
    lashes?: string; // a lashes style id (`eyelashes01`…); absent = none
  };
  bodyHair?: BodyHairRecipe;
  outfit?: readonly string[];
  bodyArt?: BodyArtInit;
}): Recipe
```

Builds a recipe over the defaults (`DEFAULT_MACROS`, `DEFAULT_SKIN`,
`DEFAULT_EYES`, `DEFAULT_HAIR_COLOUR` when `hair` is given, and
`createBodyArt`'s defaults when `bodyArt` is given). It copies its
input and does not validate it; validation happens at evaluation.
`RECIPE_VERSION` is `1`.

```ts
interface Recipe {
  version: 1;
  macros: MacroValues;
  regionalMacros: Partial<Record<BodyRegion, Partial<RegionalMacroValues>>>;
  modifiers: Record<string, number>; // id -> [-1, 1]; one-sided [0, 1]; missing = 0
  skin: SkinRecipe;
  eyes: EyesRecipe;
  hair?: HairRecipe;    // optional: absent means no hair, as in recipes saved before hair
  bodyHair?: BodyHairRecipe; // optional: absent means the default for age and sex
  outfit?: readonly string[]; // garment ids from the clothing pack, in any order; absent = nothing worn
  bodyArt?: BodyArtRecipe; // optional: absent means none, as in recipes saved before body art
}

interface HairRecipe {
  style: string | null; // a scalp style id of the hair pack, or null for none
  colour: HairColour;   // eumelanin, pheomelanin, grey (each 0..1) and override: Rgb | null
}

interface BodyHairRecipe {
  // per BODY_HAIR_GROUPS entry, a multiplier on the default, 0..2 (1 = default);
  // axillary and pubic are adult-only: any value but 0 under 18 is refused
  density?: Partial<Record<BodyHairGroup, number>>;
  beard?: BeardStyle;   // none | stubble | moustache | goatee | full; absent = stubble where the face carries terminal hair
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
  values and deletes adult-only modifiers and the axillary and pubic body hair
  densities. The input is not modified.
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
its default, if any region override contains either key, if an adult-only
modifier is non-zero, if `bodyHair.density.axillary` or `.pubic` is non-zero
(`ADULT_ONLY_BODY_HAIR`), or if a piercing is at an adult-only site. Refused,
never clamped.

- `ADULT_ONLY_PIERCING(site): boolean`: true for every site that is not one of
  the body's own (`PIERCING_SITES`). Those are the adult anatomy pack's, which
  the core never names, so an unknown site fails closed. `withAge` below 18
  removes those piercings and keeps the rest.

### Body art

The recipe's optional `bodyArt` (ARCHITECTURE.md, "Body art"; sources and
choices in research/BODY-ART.md). Everything is placed by a `BodyAnchor`, a
named site or a base-mesh vertex index, so it follows every shape and pose.
Sizes are metres on the skin, angles degrees counter-clockwise looking at the
skin from the body's up.

```ts
type BodyAnchor = string | number; // a PIERCING_SITES name, or a base-mesh vertex

interface BodyArtRecipe {
  tattoos: Tattoo[];      // { image, at, size, rotation = 0, density = 1 }
  piercings: Piercing[];  // { site, jewellery = "stud", metal = "steel", size = JEWELLERY_SIZE[jewellery] }
  scars: Scar[];          // { at, length, width = SCAR_WIDTH, rotation = 0, maturity = 1, raised = 0 }
  birthmarks: Birthmark[]; // { kind, at, size, rotation = 0, seed = 0 }
  vitiligo?: Vitiligo;    // { extent = 0.3, seed = 0 }; absent means none
}
```

- `createBodyArt(init: BodyArtInit): BodyArtRecipe`: fills each item's
  defaults; `createRecipe` calls it.
- A tattoo's `image` is a key the application resolves to an image when it
  renders, so the recipe stays plain JSON. `density` is how much ink the dermis
  holds (1 fresh, lower faded).
- `PIERCING_SITES`: `ear-lobe.L/R`, `ear-helix.L/R`, `nostril.L/R`, `septum`,
  `brow.L/R`, `lower-lip`, `navel`. A recipe pierces a site at most once.
  `JEWELLERY` (`stud`, `ring`, `barbell`), `METALS` (`steel`, `titanium`,
  `gold`, `rose-gold`, `silver`), `JEWELLERY_SIZE`.
- `BIRTHMARKS`: `cafe-au-lait`, `naevus`, `port-wine`, `dermal-melanocytosis`.
  A scar's `maturity` runs from 0 (fresh: red, raised) to 1 (mature: pale,
  flat); `raised` is how hypertrophic it is.
- `bodySites(assets): Record<PiercingSite, BodySite>`: each site's base-mesh
  vertex, found from the target that shapes its feature (the vertex it moves
  most), and its `channel` (`"normal"`, `"across"` or `"vertical"`): which way a
  piercing runs through the skin there.
- `resolveAnchor(assets, at): number`: the vertex an anchor names. An unknown
  site or a vertex past the mesh throws `RangeError`.
- Validation (`recipeProblems`) checks body art's structure and ranges and
  rejects unknown fields, clamping nothing. Whether an anchor exists is checked
  when the figure is evaluated, against the loaded assets.

### Evaluation

```ts
new HumanoidModel(assets: HumanoidAssets, options?: { subdivision?: 0 | 1 | 2 })
```

The framework-free pipeline for one loaded body pack. `subdivision` defaults to 1
and throws `RangeError` for anything else.

- `model.evaluate(recipe, signals?, haveOutfit?): Evaluation`: `signals` (0..1 each) set the
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
  `recipe.outfit` adds the garments (see "Clothing"); `haveOutfit` is the
  outfit key the caller already holds the masks of.
- `model.adultDetailLattice(recipe): AdultDetailLattice | null`: the vertex
  space the adult pack's detail targets are authored on (`{ key, vertexCount,
  positions, normals }`): the vertices of the refined region, which a detail
  target indexes from 0, with their positions and outward unit normals on this
  figure and the key that names the refinement. Null without an adult surface; throws `AgePolicyError` for a
  figure under 18. The packer uses it to place authored forms.
- `model.topology(): SurfaceTopology`: the static render data, sent once. A
  worn attachment set the body pack did not bake gets its occlusion at rest
  only (every pose corner holding the rest value). `body.occlusion` is the
  body's own cavity occlusion (below), a byte per pose corner per render vertex.
- `model.bakeBodyOcclusion(): BodyOcclusion` is the body's whole cavity bake
  (what the packer stores in `body-occlusion.bin.gz`); it depends on neither
  the worn set nor the subdivision level.
- `model.bakePosedOcclusion(): Generator<void, Float32Array[] | null>` bakes
  that set's pose corners, yielding before each one so a caller can let other
  work in between; it returns per-render-vertex arrays shaped like
  `AttachmentTopology.occlusion`, or null for the pack's own set.
  `model.bakeAttachmentOcclusion()` is the whole bake at once, per control
  vertex (what the packer stores).
- Hair: `model.pendingHair(recipe)` is the style id the recipe wears that has not
  loaded yet (null when it has none or has what it needs; it throws
  `RecipeError` for an id the hair pack lacks, or when no hair pack is loaded),
  `model.hairTopology(id): HairTopology` is a style's static render data (the
  mesh like an attachment's, `label`, `tags`, `material`, `textureUrl`, per
  render vertex its `occlusion`, `fade` (0 where a hairline thins out), `fin` (1
  on a card standing out of the scalp) and `growth` (metres from the root), the
  `scalp` (per body render vertex, how densely the style grows from the skin
  there) and the `strand` coherence), `model.bakeHairOcclusion(asset)` is the
  packer's bake of a style's occlusion at rest, per control vertex, and
  `model.bakeHairFields(asset)` its growth, fade, fin and scalp
  (`hairFields`, `src/surface/hairFields.ts`). `evaluate` fills `Evaluation.hair` from
  `recipe.hair.style` and throws `MorphError` for a style whose geometry has
  not arrived (`assets.hair.load(id)` brings it); the style never changes the
  body, which keeps every face (hair has no `delete_verts`). `Evaluation.brows` and
  `Evaluation.lashes` are the worn `recipe.hair.brows` and `lashes` the same way
  (an id of the wrong kind is a `RecipeError`: `hair.style` wears scalp styles,
  `brows` brows, `lashes` lashes); a brow is lifted `DECAL_LIFT` (2 mm) off the
  skin along its normal, since the smooth body surface can swallow a decal bound to
  the coarse mesh by up to 1.8 mm at the brow ridge (a test holds it clear at ages
  6 to 75). `model.pendingHairStyles(recipe)` lists every worn style not yet loaded,
  and the worker's `evaluated` reply carries `decalTopologies` for the brows' and
  lashes' static data (`HairTopology.kind` is `scalp`, `brows` or `lashes`; a
  decal's fade is all 1, fin and growth 0, scalp none).
- `model.regions` and `model.body` (`SurfaceMesh`).

```ts
interface Evaluation {
  positions: Float32Array;  // render vertices, xyz, metres
  normals: Float32Array;    // smooth, shared across UV seams
  hair: HairEvaluation | null; // the worn style's { id, positions, normals }; null without hair
  groundOffset: number;     // lift that puts the lowest body point on y = 0
  control: Float32Array;    // morphed positions in the base topology
  curvature: Float32Array;  // per body render vertex, mean curvature (1/m)
  boneHeads: Float32Array;  // the skeleton fitted to this figure: each bone's rest head, xyz
  surface: "base" | "adult"; // which topology the render arrays are in
  attachments: SurfaceEvaluation[]; // eyes, teeth, tongue: positions and normals each
  garments: SurfaceEvaluation[];    // the outfit's garments, in outfit.order
  outfit: {
    key: string;                    // the garments in stacking order, joined by "|" ("adult:" first on the adult surface); "" for none
    order: string[];                // garment ids, innermost first
    masks: OutfitMasks | null;      // null when the caller passed this key as haveOutfit
  };
}

interface SurfaceTopology {
  index: Uint32Array;       // triangles
  uvs: Float32Array;
  skinIndex: Uint16Array;   // four bone indices per render vertex
  skinWeight: Float32Array; // four normalised weights per render vertex
  vertexCount: number;
}
```

`surface` says which topology `positions`, `normals` and `curvature` are in: the
base body's (`topology().body`) or, for an adult with the adult pack's refined
pelvic surface loaded and subdivision 1 or more, `adultSurface()`'s. A figure
under 18 is always `"base"`, with exactly the base body's vertices, vertex for
vertex what it is without the adult pack; `control` is the base topology either
way.

`evaluate` throws `MorphError` for a recipe that needs target files not loaded
yet (`model.pendingTargetFiles(recipe)` names them), `AgePolicyError` for a recipe that
violates the age policy,
`RecipeError` for an unknown modifier id (adult-only ids need the adult pack),
an adult-only modifier on a minor, or a negative value on a one-sided modifier,
and `MorphError` for an unknown target. Modifier values are clamped to `[-1, 1]`.

### Clothing

A figure wears the clothing pack's garments by id in `recipe.outfit`. The body
surface is never rebuilt for it: a worn set only changes which triangles of the
body and of each garment are drawn.

- `model.outfit(ids): Outfit`: `{ key, order, masks }` for a set of garment
  ids in any order. `order` is innermost first (by `z_depth`, then category,
  then id) and `masks` is `{ bodyIndex, garmentIndex }`: the triangle indices to
  draw in place of `topology().body.index` and each garment's
  `GarmentTopology.index`. Garments stack as MakeHuman does: processed from the
  outermost in, each is hidden only where the garments over it delete, and a
  face hides only when every corner is hidden. Results are cached by key.
  Throws `OutfitError` for an id the clothing pack lacks, one named twice,
  garments that have not loaded, or no clothing pack.
- `model.garmentTopology(id): GarmentTopology`: a garment's static render data
  (`SurfaceTopology` plus `id`, `kind`, `zDepth`, `tags`, `material`,
  `textureUrl`, `normalTextureUrl`), built once. Its `index` draws every face.
- `GARMENT_LAYERS`: the categories (`kind`) a garment can have and their order:
  `underwear`, `socks`, `clothes`, `sweater`, `jacket`, `shoes`, `coat`, `hat`,
  `backpack`.
- The arithmetic behind it, pure and exported: `layerOrder(entries)`,
  `stackVisibility(vertexCount, garments, visible?)`,
  `transferVisibility(visible, garment)`, `faceVisibility(faceVerts, faces,
  visible)` and `maskIndex(index, faceVisible, trianglesPerFace)`.
- The figure stands on what it wears: `groundOffset` counts the garments'
  lowest point, so a sole that reaches below the foot rests on the ground.

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
- `buildRefinedSurfaceMesh(assets, faces, refinement, levels): SurfaceMesh`:
  the surface with `refinement.faces` (base face indices) refined `refinement.levels`
  extra levels (at most 4), built on the base's own level-1 surface so it keeps
  the same shape: conforming (no cracks), the base's vertices unmoved, UV seams
  kept, normals interpolated from the base's, and at level 2 and above the
  transition polygons smoothed into quads. It throws `RangeError` below level 1.
  `refineGraded(source, faces, {faces, levels})`, `catmullClarkPolygons(topology)`
  and `subdivideUvLinearPolygons` are the pieces (graded local refinement and
  polygon Catmull-Clark; `catmullClarkLevel` is the quad case of the latter).

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
- `hairAlbedo(colour: HairColour): Rgb`: linear-RGB diffuse albedo of hair from
  two pigments (`eumelanin` 0 none .. 1 black, `pheomelanin` 0 none .. 1 most
  red-gold) and the `grey` fraction of unpigmented fibres; `override` returns
  that colour as given. The pigments' per-channel absorption
  (`EUMELANIN_ABSORPTION`, `PHEOMELANIN_ABSORPTION`) is pbrt-v4's, and the
  albedo follows Chiang et al.'s `exp(-g·σ^p)` form with `PATH_GAIN` and
  `PATH_EXPONENT` fitted to measured tresses (research/HAIR-COLOUR.md says which
  colours are measured and which modelled). `HAIR_COLOURS` names twelve natural colours as pigment
  values (`black` to `white`), `DEFAULT_HAIR_COLOUR` is `brown`, and
  `hairTint(colour)` is the material colour that makes a packed strand map
  (mean `HAIR_STRAND_MEAN`) render as that albedo.
- Body hair (research/BODY-HAIR.md): `BODY_HAIR_GROUPS` (`face`, `chest`,
  `abdomen`, `back`, `buttocks`, `arms`, `legs`, and the adult-only `axillary`
  and `pubic`, `ADULT_ONLY_BODY_HAIR`, `isAdultOnlyBodyHair(group)`),
  `BEARD_STYLES` (`none`, `stubble`, `moustache`, `goatee`, `full`).
  `defaultBodyHairCoverage(group, age, gender)` is a group's terminal-hair
  coverage 0..1 (the Ferriman-Gallwey grade over 4) for an age in years and
  the gender macro read as the androgen level: 0 before puberty, rising through
  adolescence (`BODY_HAIR_MATURITY`), thinning in old age
  (`BODY_HAIR_SENESCENCE`), between `BODY_HAIR_COVERAGE`'s female and male
  ends. An adult-only group is 0 under 18 and for an age that is not a number.
  `bodyHairCoverage(group, input: BodyHairInput)` applies the recipe's density
  multiplier (0..`MAX_BODY_HAIR_DENSITY`, clamped to full coverage; it never
  adds hair where the default has none). `beardStyle(input)` is the recipe's
  style, or `stubble` where the face's coverage is a quarter or more and `none`
  elsewhere. `bodyHairColour(group, input)` is the figure's hair pigments
  darker or lighter per group (`BODY_HAIR_FIBRE`, which also holds each group's
  fibre diameter and drawn length) and at least as grey as ageing makes them
  (`ageGrey(age)`, lagged per group); the recipe's grey is kept as a floor and an
  override as given.
- CIELAB conversions: `labFromLinear`, `linearFromLab`, `lchFromLab`,
  `labFromLch` (D65).
- Skin layers (ARCHITECTURE.md, "Parallel work: the base contract"):
  `SkinLayer` (`id`, `blend`, `targets`, `fields(assets)`, `paint(input)`),
  `SKIN_LAYERS` (the stack, in order: flush, lips, areola, the hands' layers
  below, the state layers below, then `ADULT_SKIN_LAYERS`: penis, testes,
  mound), `SKIN_LAYER_TARGETS`
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
  change and a `specular` change). `surfaceChange` and `creaseHeight` (a
  groove, so negative: `size` of them across the coordinate, each the raised
  cosine to the power `CREASE_SHARPNESS`, flat at the coordinate's ends) are the
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
  `SkinPaintInput.age` is the figure's age in years (`recipe.macros.age`;
  `<Humanoid>` sets it), for layers that change with it: a layer that reads it
  must paint sensibly without it, since an input built without one has none.
  The model's topology carries `body.layerFields` and `body.layers`; the
  renderer rasterises them once into a shared field atlas
  (`humanoid-kit/react` does this for `<Humanoid>`).
- `melaninDensityAlbedo(tone, factor, haemoglobin)`: natural skin carrying
  `factor` times the tone's melanin optical density, found on the measured
  melanin axis (extrapolated past the deepest anchor); the same factor darkens
  deep skin far more than fair. `areolaAlbedo` uses it.
- The hands (`src/surface/regions/hands/`, colour in `src/surface/handTone.ts`;
  ARCHITECTURE.md, "Hands"; every magnitude cited, or marked as a choice, in
  research/SKIN-STATES.md C5). `HAND_SKIN_LAYERS`, in stack order after the rest
  layers and before the state layers (so cold pallor and flush act on them).
  Features whose masks never meet share a layer, to hold the hands to one atlas
  page:
  - `PALMOPLANTAR_LAYER` (`"palmoplantar"`): `palmAlbedo(tone)` over
    `skinZones().palm` and `skinZones().sole` (palmoplantar skin; no sole colour
    was found measured), less than `PALMOPLANTAR_FLOOR`, which the 8-bit atlas
    rounds to 0, dropped. `palmLab(tone)` is
    the palm's CIELAB (surface reflection included) from `PALM_BINS`, the
    International Skin Spectra Archive's paired palm and back-of-hand readings
    (777 people) binned by the back of the hand's L\*: on deep skin the palm is
    about 16 L\* lighter and 6 to 8 b\* yellower than the back of the hand, on
    the lightest about the same.
  - `PALM_CREASE_LINE_LAYER` (multiply: `palmCreaseLine(tone)`, the crease's
    shade, and on deep skin a return toward the skin's own colour) and, in
    `HAND_RELIEF_LAYER`, folds `PALM_CREASE_DEPTH` deep: the
    distal and proximal transverse and thenar creases of the palm
    (`palmCreaseCurves(landmarks, joints)`) and each digit's flexion creases
    (`digitCreases(joints, digit)`), placed by the measured `CREASE_TO_JOINT`,
    `MIDDLE_CREASE_TO_JOINT`, `THUMB_CREASE_TO_JOINT` and `FINGER_CREASE_SPANS`.
    Their fields (`palmCreaseLineFields`, `palmCreaseReliefFields`) carry a
    signed distance to the nearest crease (`sampleCreases`), so a line finer
    than the mesh is drawn where the crease is (`creaseLineCoordinate`,
    `creasePhase`, `CREASE_GEOMETRY`).
  - `DIGIT_LAYER` (`"knuckles-nails"`, fields `digitFields(assets)`): the
    knuckles' colour at its coordinate's 0 (`knuckleAlbedo(tone)`:
    `KNUCKLE_MELANIN_FACTOR` times the skin's melanin density and
    `KNUCKLE_HAEMOGLOBIN` more blood), then the nail's along it
    (`nailStops(tone)` after its first, the eight stops a nail coordinate runs
    through, from `nailColours(tone)`: fold, lunula, bed and free edge along each
    nail, the bed from `nailLab(tone)`, measured nail CIELAB at a lightness that
    follows the skin's far less than skin does). It paints within 1 ΔE\*ab of
    the nail layered over the knuckle. `NAIL_GLOSS_LAYER` is the plate
    (`NAIL_ROUGHNESS` and `NAIL_SPECULAR`); fields from `knuckleFields(assets)`
    and `nailFields(assets)`, proportions in `NAIL_LAYOUT`.
  - `HAND_RELIEF_LAYER` (`"hand-relief"`, a `creases` detail layer, fields
    `handReliefFields(assets)`): the palm's crease folds and the knuckles'
    wrinkle arcs (over the back of each finger joint, `KNUCKLE_WRINKLE_SPACING`
    apart, `KNUCKLE_WRINKLE_DEPTH` deep, the depth carried in the mask), on a
    coordinate of `HAND_RELIEF_PHASES` phases.
  - `handFrame(assets)`: each hand vertex's digit, distance along it and across
    it, which way it faces, and its place in the palm's plane, measured from the
    skeleton's finger joints and the vertex normals and cached per set of
    assets; `palmDirection(assets, side)` is the way a palm faces.
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
  - Joint creases (ARCHITECTURE.md, "Joint creases"): `CREASE_LAYERS`, four
    `DetailLayer`s with the `creases` pattern, one for each side of the elbows
    and knees (`creaseLayerId(joint, side)`: `creases.elbow.L`, …),
    which fold the inside of the bend as the joint's `flex.<joint>.<side>`
    signal rises. `CREASE_STRAIN` is the measured skin strain at full flexion
    (forearm 0.25, knee 0.65), `CREASE_ABSORBED` the share of it the creases
    take up, `CREASE_COUNT` the creases across a joint's window,
    `creaseDepth(joint)` the fold's depth in metres that follows from them, and
    `CREASE_HALF_WIDTH` how far either side of the joint each joint's creases
    reach.
  - Expression lines (ARCHITECTURE.md, "Facial wrinkles"):
    `EXPRESSION_LINE_LAYERS`, five `creases` `DetailLayer`s (`lines.forehead`,
    `lines.crows-feet`, `lines.glabella`, `lines.nasolabial`, `lines.nose`) driven
    by the `face.*` signals and the figure's `age`: forehead lines on
    `browRaise`, furrows between the brows on `browFurrow`, crow's feet on
    `squint` (or a smile), the folds on `nasolabial` (or a smile), nose lines on
    `noseWrinkle`. `EXPRESSION_DEPTH` (metres, fractions of a millimetre) and
    `EXPRESSION_COUNT` are art-directed, `expressionAgeFactor(age)` scales the
    depth by age (0.2 at 6, 1 at 40, 1.4 at 70).
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
  `IDENTITY_POSE(bones)` is the rest pose. The pack's units are mirror
  symmetric: each is the reflection of its partner (`mirrorUnit(unit)`: `Left`
  and `Right` swapped, `MouthLeftPullUp` ↔ `MouthRightPullUp`; a central unit
  such as `JawDrop` is its own), so a symmetric expression moves both sides alike.
- `EXPRESSIONS`, `expressionUnits(id, intensity = 1)`: ten named expressions
  (`smile`, `grin`, `frown`, `surprise`, `anger`, `disgust`, `fear`, `sad`,
  `blink`, `squint`) as face unit weights, symmetric, for a pose's `faceUnits`
  (`pose={{ faceUnits: expressionUnits("surprise", 0.7) }}`). `intensity` scales
  the weights (0 to 1; above 1 is held at 1); an unknown id throws. The weights
  are authored choices (ARCHITECTURE.md, "Named expressions").
- `skinPositions(rest, rotations, positions, skinIndex, skinWeight, out, fold?)`:
  the rig's skinning on the CPU, exactly as the renderer skins, for grounding,
  tests, anchors and pose-dependent bakes: linear blend skinning mixed with
  dual quaternion skinning vertex by vertex, by the share each bone asks for
  (ARCHITECTURE.md, "Skinning artefacts"), and, with a `fold`
  (`solveHipFold`, below), the hip fold added to the skinned vertex.
  `posedBoneHeads(rest, rotations)`
  gives every joint's posed position. `skinPositionsLinear` is linear blending
  alone, `skinPositionsDual` dual quaternion skinning alone, and
  `skinPositionsBlended(…, share)` the mix at any share (a number, or one per
  bone); `skinNormalsBlended` and `skinNormalsDual` give the matching normals,
  and `skinPose` / `skinVertex` skin one vertex at a time.
- `SKIN_DUAL_SHARE` is each limb bone's share of dual quaternion skinning (0 is
  linear, 1 dual quaternion), `skinDualShare(bones)` the share of every bone of
  a rig in its order, and `dualBones(rest, rotations)` each bone's pose as a
  unit dual quaternion (what the renderer uploads: `dualBoneTexels`).
  `SKIN_SWING_SHARE` names the bones whose share changes as they swing (the
  thigh's falls from 1 to ¼ over 120°, so a flexed hip does not bulge), and
  `poseShare(rest, rotations, base)` gives every bone's share for a pose: the
  table's, moved by each such bone's swing (its rotation less its twist about
  its own axis). `skinPositions` and `DualBones` use it.
- `solveHipFold(rest, control, skinIndex, skinWeight, triangles)` solves a
  figure's hip fold (ARCHITECTURE.md, "The hip fold"): where a thigh flexed past
  a right angle would pass through the belly, the displacement (per flexion
  from 32.5° to 140° in 2.5° steps, per vertex of the thigh's skin within 0.7
  of its length of the hip) that holds it against the belly's skin instead. `solveHipFoldSteps` is the
  same a flexion at a time (a generator). The result (`HipFold`) is passed to
  `skinPositions` as `fold`; `hipPose(rest, rotations)` reads each hip's flexion
  from a pose, `addFold(fold, vertex, flexion, out, at)` reads a vertex's
  displacement at a flexion, and `HIP_FOLD` holds the fold's terms. It takes one
  to three seconds of one core: in an app it is asked of the worker
  (`client.hipFold`), never solved per frame. The thigh stays under 2 mm behind
  the belly at every flexion solved and halfway between, in the five bodies of the
  bench. `scripts/lib/hipContact.ts` (`HipContact.penetration(positions)`)
  measures how far a posed body's thigh passes through its trunk.
- `bodyPoseRotations(rig, name)`: a whole-body pose from the pack
  (`RigData.poses`: MakeHuman's CC0 `tpose` and `benchmark`, the rigging
  stress pose; and the poses authored here, `relaxed`, standing at ease with the
  arms at the sides, and five for joint extremes, `bent`, every hinge about half
  way (the check for joint creases), `flexed`, every hinge near its limit,
  `twisted`, each limb turned about its own axis, `abducted`, the thighs
  opened 40°, `seated`, the hips and knees at 90° with the soles flat, and `tucked`, the hips at 120° with the knees drawn up, and `bowed`, the trunk folded 60° along the spine);
  `composeRotations(a, b)` layers `b` (an expression) over `a`.
- `restBonesFrom(names, parents, heads)` rebuilds the rest skeleton from an
  evaluation's `boneHeads` without the packs, and
  `posedGroundOffset(rest, rotations, control, skin, worn?)` is the lift that
  puts a posed figure's lowest point on the ground: the body's, or that of the
  garments in `worn` (`SkinnedPoints`: render positions at rest with their skin
  indices and weights; `RigSkin` is the pack's skin and the body's base
  vertices, sent in `ReadyInfo.rig.skin`).
- Joint flexion as skin signals: `FLEXION_JOINTS` (elbows, knees, wrists),
  `flexionRig(rest)` (each joint's hinge, perpendicular to the upper segment
  and its flex direction) and `jointFlexion(rig, rest, rotations)`, giving
  `flex.<joint>.<side>` from 0 (straight) to 1 (the joint's anatomical limit).
  `<Humanoid>` adds them to the skin's signals for every pose. `posedBones` and
  `rotateByBone` expose the posed bone rotations.
- The face as skin signals: `FACE_SIGNAL_KEYS`, `faceSignalBasis(rig)` and
  `faceSignals(basis, rotations)`, giving `face.browRaise`, `face.browFurrow`,
  `face.smile`, `face.squint`, `face.noseWrinkle` and `face.nasolabial`, each 0 to
  1: how much of each expression key the posed bones hold (so an animation that
  never named a face unit still reads), jointly, so overlapping keys do not read
  double. `<Humanoid>` adds them to the skin's signals for every pose, as it does
  `flex.*` (ARCHITECTURE.md, "Facial wrinkles").
- Pose-keyed occlusion (ARCHITECTURE.md, "Attachment occlusion"):
  `OCCLUSION_KEYS` (jaw open, lips apart, smile), `occlusionKeyBasis(rig)` and
  `occlusionKeyWeights(basis, rotations)` (how much of each key a pose holds),
  `occlusionCorners(keys)`, `occlusionCornerUnits(m)` and
  `occlusionCornerWeights(w)` (the multilinear blend of the corner bakes).
  `AttachmentTopology.occlusion` holds `occlusionCorners` values per render
  vertex, rest first. `rotationVectors(rotations)` gives each bone's rotation
  vector.
- Body occlusion (ARCHITECTURE.md, "Body occlusion"): the inside of the mouth,
  the nostrils, the ear canals and the eye sockets are darkened by pose, at the
  same corners. `HumanoidAssets.bodyOcclusion` is `{ vertices, values }`: the
  ascending base-vertex indices of the few vertices ever enclosed and a byte
  per vertex per corner (255 open), or null for a pack that predates it (a
  body never darkened). `ModelTopology.body.occlusion` is the same per render
  vertex, `occlusionCorners` bytes each, 255 off the cavities.
  `cavityCandidates(assets)`, `selectCavity(candidates, bakes)`,
  `cavityOcclusion(visibility)`, `OPEN_VISIBILITY` and
  `expandBodyOcclusion(occlusion, vertexCount, corner)` are the bake's steps;
  `parseBodyOcclusion(entry, bytes, vertexCount)` reads the file.
  `<Humanoid>` puts `body.occlusion` on the body geometry
  (`setBodyOcclusionAttributes`) and shares the pose's key weights with the
  skin material (`SkinMaterial.occlusionKeys`, as with the attachments'
  materials); a body geometry without the attributes renders open.

### Presence

What each figure tells the scene around it (PRESENCE.md). Framework-free.

- `createPresenceRegistry()`: `set(presence)`, `remove(id)`, `get(id)`,
  `all()`, `tick(seconds)` (call it from the render loop; it measures each
  figure's `velocity` and raises proximity events) and
  `onProximity(radius, listener)`, which reports `{ type: "enter" | "leave",
  ids, distance }` for each pair (entering at `radius`, leaving beyond 1.1 ×
  `radius`) and returns its unsubscribe function. The registry keeps the
  objects it is given by reference, `all()` returns the same read-only array
  until a figure joins or leaves, and entries are updated in place as figures
  move, so copy what you keep. `set`, `tick` and `all` allocate nothing once a
  figure has joined.
- `FigurePresence`: `position`, `facing`, `bounds`, `anchors` (head, face,
  chest, hands, feet), `footprint`, `appearance` (measured albedo, luminance,
  specular), `faceRadius`, `adult`.
- `presenceFromEvaluation({ evaluation, recipe, joints, placement })`: a
  figure's presence from its evaluation. Anchors are joint centroids of the
  morphed control mesh lifted onto the ground, the footprint is the extent of
  the body's soles, `bounds` cover every surface point, `appearance` is
  `skinAlbedo` of `recipe.skin` with its luminance and `SKIN_F0`, `faceRadius`
  is 0.75 × the head's length, and `adult` is the age policy's verdict
  (`age >= 18`). `placement` is `{ id, position, facing }`: the ground position
  under the figure and its heading.
- `presenceFromPose({ evaluation, recipe, joints, rig, rotations, placement })`:
  the same presence for a figure in a pose. `rig` is `{ bones, parents, skin }`
  (`ReadyInfo.rig` has them) and `rotations` the pose as the renderer applies it
  (`bodyPoseRotations`, `composeRotations`). Anchors are the joint centroids over
  the posed control mesh, the footprint is whatever of the posed body is within
  3 cm of the floor (a lunge touches with one foot: one contact), and bounds are
  the posed body's box (widened by the rest surface's inset, so an unrotated
  pose reports the rest bounds). Call it when the evaluation or the pose
  changes; re-place the result with `placePresence` as the figure moves.
- `posedControl(rig, evaluation, rotations)` and
  `groundOffsetOf(posed, bodyVertices)`: the evaluation's control mesh in the
  pose (skinned once and cached on the evaluation; a different pose of it
  overwrites the array, so use it before asking again) and the lift that puts
  its lowest body point on the floor. `<Humanoid>` grounds a posed figure and
  derives its presence from the same pass.
- `presenceJoints(assets)`: the joint vertex lists presence reads from a loaded
  body pack (small and static, so it can travel with the worker's topology);
  it throws an `AssetFormatError` naming a missing joint. `tryPresenceJoints`
  returns `null` instead, which is what the worker reports for a pack with
  another skeleton: such a pack still renders, it cannot publish presence.
- `placePresence(presence, placement, out?)`: the same presence turned and
  moved onto a new placement. Re-place a rest presence each frame rather than
  chaining. With `out` (a `clonePresence` of it, or the presence itself) it
  writes in place and allocates nothing. It throws a `RangeError` for a heading
  with no horizontal component (a figure pointing straight up).
- `clonePresence(presence)`: a deep copy, for `placePresence`'s `out`.
- `presenceGroups(presences, distance)`: ids of the figures standing together.
- `groundOcclusion(presences, { strength?, spread?, floorY?, reach? }, into?)`
  and `sampleGroundOcclusion(points, x, z)`: contact shadows pooled with `max`.
  Each `ContactPoint` is `{ x, y, z, radius, strength }`, with `y` the height
  of the figure that casts it. With `floorY`, a figure standing on that floor
  casts at full strength, one more than 2 cm above or below it casts less, and
  none beyond `reach` metres (default 0.3), so a figure on a platform does not
  shadow the floor under it. Pass the array a previous call returned as `into`
  to reuse its contacts (nothing is allocated once it fits).
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
- `ReadyInfo` is `{ topology, modifiers, sliders, rig, presenceJoints,
  adultAnatomyLoaded, anatomy?, wardrobe, hair }`: the render topology, every drivable
  shape modifier, the merged slider taxonomy, the rig (`RigData` plus each
  bone's `parents` index; the topology's skin indices refer to `rig.bones`), the
  joints presence reads (`presenceJoints`), whether the adult anatomy pack is
  loaded and, with it, its `anatomy` (`AdultAnatomySpec`: the features
  `appliedAnatomy` reads and the state morphs the shape signals include), and
  the garments the clothing pack offers (`WardrobeEntry[]`: `id`, `name`,
  `label`, `kind`, `tags`; empty without that pack). `label` is what to call a
  garment in a list ("Brown oxfords"); `name` is the asset's file name, which
  says whom it was drawn for. `hair` is the hair pack's entries (`HairInfo`: `{ styles: { id, label, tags, kind }[] }`, null without a hair pack), known before any style loads.
- `client.hairTopology(id): HairTopology | undefined` is a worn style's static
  render data. The worker sends it with the first evaluation that wears the
  style and the client keeps it, so an `Evaluation` whose `hair.id` you
  receive can always be rendered with `client.hairTopology(hair.id)`. A style's
  files load on that first evaluation, which waits for them; one that fails
  to load rejects that evaluation with the reason, and a later one retries.
- `client.evaluate(recipe, key?, signals?, haveOutfit?): Promise<Evaluation>`
  (signals as for `model.evaluate`) is latest-wins per key:
  each key has at most one evaluation in the worker and one waiting, and a
  waiting request replaced by a newer one rejects with an error named
  `AbortError`. Keys never wait on each other. Buffers are transferred from the
  worker. A recipe with an `outfit` waits for the clothing pack's garments, and
  a figure that wears nothing never does. `haveOutfit` is the
  `Evaluation.outfit.key` the caller already holds the masks of, which then
  come back null instead of copied again.
- `client.garment(id): Promise<GarmentTopology>` resolves with a garment's
  static render data, once the garments have loaded. Requested from the worker
  once per id however many figures wear it; a failed request is forgotten, so
  asking again tries again.
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
- `client.adultSurface(): Promise<AdultSurfaceTopology | null>` resolves with the
  adult pack's refined pelvic surface: the static render data of the whole body
  (`SurfaceTopology` plus `uvScale`) with the pack's `anatomy.surface` faces
  refined (`HumanoidModel.adultSurface`), or null when the pack names no surface
  or the model's subdivision is 0. It is its own request and never part of
  `ready`'s topology, so a minor's session never holds it. `<Humanoid>` asks for
  it once the figure is an adult and draws it, in place of the base body, from
  then on (`Evaluation.surface === "adult"`); the worker builds it once and
  later calls share it.
- `client.hipFold(recipe, signals?): Promise<{ surface, fold }>` resolves with the
  hip fold (ARCHITECTURE.md, "The hip fold") of the figure the recipe makes, on
  the body surface its evaluation draws (`"base"` or `"adult"`): the
  `SurfaceFold` (`slot` per render vertex, `rows`, `data`) for
  `DualBones.setFold` and the geometry's `FOLD_SLOT_ATTRIBUTE`. The worker solves
  it between other requests, so an evaluation is never held up behind it, and
  asking again supersedes a solve still under way, which rejects with an
  `AbortError`. `<Humanoid>` asks once a hip in its pose is flexed past 30°,
  whenever the figure's shape changes, and counts the wait in its settle; a figure
  drawn by other means calls it itself.
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
| `onEvaluated?` | Called with each `Evaluation`, as its geometry is written |
| `onSettled?` | Called with an `Evaluation` once everything the recipe wears is drawn: the geometry is written and the hair style's strand map, the attachments' and garments' textures and the attachments' posed occlusion have loaded (then two frames). Wait for this, not `onEvaluated`, before a screenshot. The playground's `data-figure="ready"` is this |
| `onError?` | Called with evaluation and texture errors other than a superseded request; without it they are logged to the console |
| `pose?` | A `HumanoidPose`: `body`, a whole-body pose from the pack by name (`"tpose"`, `"benchmark"`, `"relaxed"`, `"flexed"`, `"twisted"`, `"bent"`, `"abducted"`, `"seated"`, `"tucked"`, `"bowed"`), and `faceUnits`, MakeHuman's face units by name with weights 0..1 (`{ JawDrop: 1 }` opens the mouth), layered on top. Absent is the rest pose |
| `signals?` | The skin's state, signals 0..1 (`cold`, `heat`, `exertion`, `blush`, `fear`; `arousal` adults only). Every signal reaches the skin layers (`cold` and `fear` raise goosebumps, `blush`, `exertion`, `heat`, `fear` and `cold` flush or blanch the skin, `heat` and `exertion` bring sweat); those with state morphs also reshape the figure (a re-evaluation, rounded to 50 steps). Never part of the recipe. They apply as given: pass `useSkinStateFilter(target)` to ease them at the pace of a body |
| `onGroundOffset?` | Called with the lift (metres) that puts the figure's lowest body point on y = 0 whenever the figure or its pose changes it; place the group at that height so a crouch or kneel rests on the ground |
| `onPick?` | Called when the figure is tapped (pressed and released within 6 px, so an orbit drag is not a tap) with a `HumanoidPick`: `part` (`"body"`, `"adultBody"` for a tap on the adult surface, `"garment"` with the garment's `garment` id, `"hair"`, or an attachment index), the nearest render `vertex` and the world `point`. When set, it handles the group's clicks in place of `onClick` |
| `presence?` | `{ id, position?, facing? }`: publishes the figure into the nearest `PresenceProvider` (see below). Throws without one |
| other props | Passed to the wrapping `<group>` |

- Hidden until the first evaluation arrives.
- Renders the body and the body pack's attachments (eyes with their own eye
  shader following `recipe.eyes`, teeth and tongue), each attachment shaded by
  its baked occlusion, which follows the pose (an open mouth lights the teeth
  it uncovers). The body's own cavities (mouth, nostrils, ear canals, eye
  sockets) are darkened the same way, so a mouth without a tongue is dim inside.
  The mouth's inside is painted as mucosa (`MOUTH_INTERIOR_LAYER`, `mucosaAlbedo`,
  `mouthInteriorMask`; ARCHITECTURE.md, "The mouth's lining"), not as skin.
  Teeth are drawn at the albedo of enamel (ivory, `ENAMEL_LAB`) whatever the
  pack's material colour, since that colour assumed MakeHuman's display-referred
  pipeline and rendered here as grey (`attachmentColour`,
  `createAttachmentMaterial`; `docs/evidence/teeth.md`); other attachments are
  drawn as the pack describes them. The teeth's gums are a pale coral pink
  (`GUM_LAB`), pigmented browner and patchier with `recipe.skin.melanin`
  (`TeethMaterial.setSkin`, `gumAppearance`; ARCHITECTURE.md, "The gums";
  `docs/evidence/gums.md`).
- Renders `recipe.hair.brows` and `recipe.hair.lashes` as decals on the skin
  (`DecalMaterial`, alpha-blended): the hair pack's white alpha masks, in the hair
  colour lifted a little (`browColour`) and, for lashes, darker by `LASH_DARKEN`
  (`lashColour`), thinner on a child (`decalOpacity(kind, age)`: 0.45 for brows and 0.7 for lashes at
  birth, full by 14).
- Renders `recipe.hair` when the client loaded a hair pack: alpha cards
  skinned to the figure and coloured by `recipe.hair.colour` (`HairMaterial`:
  the strand map times the pigment colour's tint, two Kajiya-Kay highlight
  lobes along the strands (their direction read from the baked growth), baked
  occlusion, hairlines dithered away by `fade` and loose fin cards by their
  angle to the eye), with edges drawn by alpha-to-coverage on a multisampled
  canvas and by an alpha test otherwise. The skin under the style takes a
  stubble tint of the hair's colour where it grows (`SkinMaterial.setScalp`, the
  `hkScalp` attribute). Changing the style loads that style's files; changing
  the colour re-evaluates nothing.
- Renders the garments `recipe.outfit` names, once the client loaded a
  clothing pack: skinned to the same skeleton, so they follow the pose, with
  their diffuse and normal maps. The body keeps its geometry whatever is worn;
  only the triangles it draws change, on the adult surface as on the base.
- Updates the geometry in place when `recipe` changes.
- Stores the latest ground offset (posed when posed) on the group's `userData.groundOffset`.
- Disposes its geometries, textures and built-in materials on unmount.
- Skins the body and attachments to the skeleton fitted to each evaluation
  and poses it from `pose`; posing does not re-evaluate the figure. The built-in
  skin material skins by linear blending mixed with dual quaternions, by each
  bone's share (`SKIN_DUAL_SHARE`; ARCHITECTURE.md, "Skinning artefacts"), so a
  twisted forearm or a raised shoulder keeps its volume, and its shadows, bounds
  and picking follow. A `material` of your own skins by three's linear skinning
  alone, and the attachments (eyes, teeth, tongue) follow single bones. With a
  hip flexed past 30° it asks the worker for the figure's hip fold
  (`client.hipFold`) and the skin adds it, so the groin folds against the belly
  and does not pass through it (ARCHITECTURE.md, "The hip fold"); the figure
  settles once it is drawn.
- Stores the figure's bones as dual quaternions on the group's
  `userData.dualBones` (a `DualBones`, null before the first evaluation), so
  clothing and materials of your own can follow its joints as its skin does:
  `applyDualSkinning(material, group.userData.dualBones)`, both exported from
  `humanoid-kit/react`, makes a skinned mesh's material blend dual quaternions
  with three's linear skinning by the same per-bone shares (`SKIN_DUAL_SHARE`),
  so cloth does not part from the skin at a joint. Call it before the material's
  first render; a `DualBones` is the figure's own and is disposed with it.
- With `presence`, the group's origin is the ground under the figure: the
  figure lifts its own meshes onto it, so do not lift the group by
  `groundOffset` (without `presence` the caller does, as before). The ground
  position and heading are read from the group's world transform every frame,
  so moving the group, a parent or a `useFrame` mover moves the presence.
  `position` and `facing` place the group declaratively, replacing its own
  `position` and `rotation`. Assumes an upright figure at unit scale. In a
  `pose` the published anchors, footprint and bounds are the posed body's (see
  `presenceFromPose`), and are derived again when the pose changes; the meshes
  are lifted by the same posed ground offset, so the footprint is on the floor.
- A figure is in the registry only while it is mounted, shown and placed: it
  leaves while the group or any ancestor is not `visible` (a hidden figure is
  not in the world), while it is tipped so far over that it has no heading on
  the ground, and until its first evaluation arrives, and it rejoins when that
  ends. Each frame re-places one presence in place, allocating nothing.
- A body pack that lacks a joint presence reads still renders the figure; asking
  for `presence` then reports an error through `onError` (or the console) and
  publishes nothing.

### `<PresenceProvider registry? />`

Owns a presence registry for everything below it (`createPresenceRegistry()`
unless you pass `registry`, to share one with code outside React) and ticks it
once per frame from `useFrame`, after every figure has published its
placement. Render it inside the `<Canvas>`.

### `usePresence(id?)`

A live accessor, `{ readonly current }`: one figure's `PublishedPresence` (or
`undefined` while it has none) for an `id`, every published figure (a
read-only array that stays the same until a figure joins or leaves) without
one. Read `.current` in `useFrame` or an event handler; it is looked up when
read, so a figure that walks never re-renders its readers. Published objects
are updated in place each frame: copy what you keep.

### `useProximity(radius, listener)`

Calls `listener` with a `ProximityEvent` when two figures come within `radius`
metres on the ground and when they part beyond 1.1 × `radius`. The listener may
change every render without resubscribing.

### `usePresenceRegistry(): PresenceRegistry`

The nearest provider's registry, for `groundOcclusion`, `faceMetering` and
`presenceGroups`. All the presence hooks throw outside a `PresenceProvider`.

### `<StudioStage background? intensity? contactShadowOpacity? />`

A neutral studio for showing figures: a procedural room environment
(three.js `RoomEnvironment`, prefiltered once, no network request), a key light
casting shadows, fill and rim lights, and a soft hemisphere light. Pair it with
the canvas settings it was measured with: `STUDIO_TONE_MAPPING`
(`NeutralToneMapping`) and `STUDIO_EXPOSURE` (1.15). `background` is a CSS
colour (`null` leaves the canvas background alone); `intensity` scales every
light together. It restores the scene environment it replaced on unmount.

The contact shadow under the figures follows presence. Inside a
`PresenceProvider` it is one ground field built from every published figure's
footprint (`groundOcclusion`), drawn by a single shader that takes the
strongest contact at each point: figures walking together share one shadow that
separates as they part, and where they overlap the ground is no darker than
under one figure. `contactShadowOpacity` (0 to 1, default 0.5) is its darkness
at the centre of a contact. Its limits:

- Only figures that publish presence (`<Humanoid presence>`) cast it. Under a
  provider a `<Humanoid>` without `presence` has no contact shadow (drei's
  `ContactShadows` would shadow everything, and so darken the published
  figures twice).
- The floor is the stage's own height (its parent's origin): a figure on it
  casts fully, one raised or sunk casts less and none beyond 0.3 m, so a
  figure on a platform does not shadow the floor below. One horizontal floor
  only.
- It follows the figures wherever they are (the quad is resized to their
  contacts every frame, and hidden when there are none), but the stage may be
  translated, not rotated or scaled.
- It holds up to 128 contacts (64 figures, two feet each); more are ignored.
  Every frame uploads the whole contact array to the GPU (128 × vec4, 2 KiB).

Outside a provider the stage falls back to drei's `ContactShadows` around the
origin.

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
  Appearance (skin, iris, sclera, and hair when the client loaded a hair pack:
  a style from the pack or none, twelve natural colours, a picker for dyed hair
  and the pigment sliders behind the colours) and Regions (per-region macro
  overrides). Tapping the hair opens Appearance.
  Appearance (skin, iris, sclera), Regions (per-region macro overrides) and,
  when the client loaded a clothing pack, a Wardrobe: the garments by kind,
  one worn at a time per kind, layered across kinds.
- Tapping the figure opens the controls that shape the tapped part (its tab,
  with the group opened and scrolled into view) and frames that part from the
  front; see `buildFeatureMap`. Dragging orbits the view instead.
- Focusing a slider frames the body part it shapes, from MakeHuman's camera
  hint for that slider.
- Undo and redo (dragging a slider is one step), random figure, reset, and
  save and load of the recipe as JSON. A loaded recipe is validated and checked
  against the loaded packs (modifiers, and a hair style the hair pack has) and
  the age policy before it replaces the figure.
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
`options.includeAdultAnatomy` is true and the figure is 18 or over. With a hair
pack loaded, a random figure also wears one of its styles (or none, one time
in ten) in a natural colour that runs darker on deeper skin; `randomRecipe`
takes the styles as `options.hairStyles`, and without them keeps the base
recipe's hair. It also draws one of the pack's brows and one of its lashes
(`options.browStyles`, `options.lashStyles`; after the hair, so a seed's hair and
shape are the same without them), and a new head of hair keeps the brows and
lashes the figure had. `withHair(recipe, patch)` changes the scalp style, colour,
brows or lashes of a recipe (`null` takes one away) and keeps whatever the patch
leaves out; the Appearance panel uses it, offering the brows and lashes in
groups of their own, and `load` refuses a saved figure whose brows or lashes the
loaded pack lacks. Every change is undoable.

### Wardrobe helpers

Pure functions behind the Wardrobe tab, also exported from `humanoid-kit`:

- `wardrobeOf(manifest): WardrobeEntry[]`: the garments a `ClothingManifest`
  lists (none for null).
- `wardrobeGroups(wardrobe): WardrobeGroup[]`: by kind, in the order people
  dress, each with a heading.
- `wearGarment(recipe, garment, wardrobe): Recipe`: the recipe wearing the
  garment in place of any other of its kind, or without it when it is worn
  already. An empty outfit is left out of the recipe. The input is not
  modified.
- `wornIn(recipe): readonly string[]`: the garment ids a recipe wears.

### `<SliderRow />`

The creator's slider: label, value readout, a reset button and an accessible
range input sized for touch. `onChange(value, gesture)` fires while dragging and
`onSettle()` when the gesture ends; `disabledReason` disables it and says why;
`track` replaces the fill with a CSS background (the skin-tone ramp uses it).

## `humanoid-kit/worker`

The worker module that `HumanoidWorkerClient` starts by default. It owns one
`HumanoidModel` and answers eight messages: `init` (replied to with `ready`
once the first figure can be evaluated), `complete` (replied to once every
target file has loaded, or with the error that stopped one), `pickMap`
(replied to with the pick map once everything has loaded), `posedOcclusion`
(replied to once the corner bake, made a corner at a time between other
requests, is done), `adultLayers` (replied to with the adult anatomy layers'
fields once the adult pack's stage has loaded, or null without that pack),
`adultSurface` (replied to with the adult pack's refined surface, or null) and
`evaluate`, which
waits for exactly the load stages its recipe needs without holding up other
requests, `garment` (replied to with a garment's static render data once
the garments have loaded) and `hipFold` (replied to with a figure's hip fold,
solved a flexion at a time between other requests). Result buffers are transferred. Applications use it
through the client, not directly.

## `humanoid-kit-body`

```ts
import { bodyPack } from "humanoid-kit-body";
```

`bodyPack` is `{ manifest, files: { "body.bin.gz", "targets-core.bin.gz",
"targets-baby.bin.gz", "targets-child.bin.gz", "targets-young.bin.gz",
"targets-old.bin.gz", "targets-modifiers.bin.gz", "attachments.bin.gz",
"body-occlusion.bin.gz", ...WebP textures } }`, with
each value a URL string. Pass it as `body` to `loadHumanoidAssets` or to the
worker client. The package also exposes its files under
`humanoid-kit-body/data/*`.

## `humanoid-kit-hair`

```ts
import { hairPack } from "humanoid-kit-hair";
```

`hairPack` is `{ manifest, files }` like `bodyPack`: per style, `<id>.bin.gz`
(the binding, geometry, baked occlusion and the measured growth, fade, fin and
scalp) and `<id>.webp` (the strand map).
Pass it as `hair` to `loadHumanoidAssets` or to the worker client. It is an
optional install: only its manifest loads up front, and a style's two files
load when a figure first wears it (about 150 to 700 kB per style). The ten
styles are MakeHuman's own CC0 scalp hair: `short02`, `bob02`, `long01`,
`afro01`, `short04`, `short03`, `ponytail01`, `short01`, `bob01` and `braid01`.
Its manifest records the hash of the body pack it binds to, and the loader
refuses any other.

The pack also lists MakeHuman's twelve eyebrows (`eyebrow001` to `eyebrow012`,
kind `brows`) and four eyelashes (`eyelashes01` to `eyelashes04`, kind `lashes`),
the same CC0 system assets bound to the same body, each one `<id>.bin.gz` and a
`<id>.webp` that is a white alpha mask for the hair colour to tint (14 to 67 kB
the pair). They are decals: no hairline, growth or scalp, so their entries carry
none of those buffers (`HairStyleEntry.layout` has them for `scalp` only), and
`recipe.hair.style` wears only scalp styles.

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
morphs. `anatomy.surface` (`AdultSurfaceSpec`: the base body `faces` to refine
and their `levels`) names the pelvic region the adult surface refines; a pack
without it leaves every figure on the base surface. `anatomy.detail`
(`AdultDetailSpec`) names the pack's *detail targets*: entries of the adult
target file whose indices are vertices of the refined region
(`HumanoidModel.adultDetailLattice`), not of the base body. A modifier of the
adult pack can drive one like any target (`lo` and `hi` name them); the model
keeps them out of the control morph and adds them to the adult surface after it
is evaluated, scaled by the figure (`detail.scale`: two control vertices and
their distance on the authoring figure), so a figure under 18, evaluated on the
base surface, has nowhere to apply one. `detail.surfaceKey` pins the targets to
the refinement they were authored on; the model refuses them against another.

## `humanoid-kit-clothing`

```ts
import { clothingPack } from "humanoid-kit-clothing";
```

`clothingPack` is `{ manifest, files: { "garments.bin.gz", ...WebP textures } }`.
Pass it as `clothing`. It ships nineteen CC0 garments from MakeHuman's system
assets, bound to the base mesh: twelve casual, sport, work and elegant suits
(`suits/…`, category `clothes`; each a complete outfit, so one is worn at a
time), six pairs of shoes (`shoes/shoes01` to `06`, category `shoes`) and a
fedora (`hats/fedora01`, category `hat`). Loading it fails unless
it was built against the exact body pack. A figure wears garments by id in
`recipe.outfit`.

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
