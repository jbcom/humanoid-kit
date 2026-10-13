/**
 * The packed asset format written by `scripts/pack-makehuman.ts`.
 *
 * A body pack (`humanoid-kit-body`) has `manifest.json`, `body.bin.gz` (base
 * mesh, UVs, quad faces, skin weights), `attachments.bin.gz`, and its sparse
 * morph targets in files split by what needs them (`BODY_TARGET_FILES`): a
 * small core, the macro targets of each age anchor, and the shape-modifier
 * targets, so a figure can appear once its own have arrived. The adult anatomy pack
 * (`humanoid-kit-adult-anatomy`) has its own manifest and targets, pinned to
 * the body pack it was built against. Binaries are gzipped and, decoded,
 * little-endian; `body.bin` is 4-byte aligned so typed-array views need no
 * copies.
 *
 * Targets are stored for transfer size (`TARGET_ENCODING`): per target, its
 * vertex indices as ascending deltas (u16), then its quantised x, y and z
 * deltas as three planes (i16), the whole file gzipped. That layout
 * compresses about 3.4 times better than interleaved data; `gunzip` and the
 * parser turn it back into ordinary index and xyz arrays.
 */

import { CUSTOM_GROUP } from "../makehuman/customTargets.ts";
import {
  AGE_ANCHORS,
  type AgeAnchor,
  ageAnchorsOf,
  DEFAULT_MACROS,
  type MacroValues,
  upstreamAgeAnchor,
} from "../makehuman/macro.ts";
import type { StateMorph } from "../makehuman/stateMorphs.ts";
import { ADULT_ONLY_MODIFIER, ADULT_ONLY_SIGNALS } from "../recipe/agePolicy.ts";
import type { AnatomyFeature } from "../recipe/anatomy.ts";
import { isBodyPiercingSite } from "../recipe/bodyArt.ts";

const MACRO_KEYS = new Set(Object.keys(DEFAULT_MACROS));

/** The target encoding this runtime reads. */
export const TARGET_ENCODING = "delta-planar-gzip";

/** Decompresses a gzip file with the platform's own decoder (browsers, workers, Node). */
export async function gunzip(data: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

export interface BufferRange {
  offset: number;
  byteLength: number;
}

export interface FaceGroup {
  name: string;
  faceStart: number;
  faceCount: number;
}

export interface TargetEntry {
  /** Path below `targets/` without extension, e.g. `nose/nose-scale-horiz-incr`. */
  name: string;
  /** Byte offset of this target in the decompressed targets file. */
  offset: number;
  count: number;
  /** Metres per int16 step. */
  scale: number;
}

/**
 * The body pack's target files, by id: `core` (anchor-free macro targets and
 * the skin-mask targets), one per age anchor, and `modifiers`.
 */
export const BODY_TARGET_FILES = ["core", "baby", "child", "young", "old", "modifiers"] as const;
export type BodyTargetFileId = (typeof BODY_TARGET_FILES)[number];
/** The adult anatomy pack's one target file. */
export const ADULT_TARGET_FILE = "adult";
/**
 * The id of clothing pack `pack`'s garments binary among a staged load's files
 * (`garments` for the first, `garments.1` for the second, ...).
 */
export function garmentsFile(pack: number): string {
  return pack === 0 ? "garments" : `garments.${pack}`;
}

export interface TargetFile {
  /** A `BodyTargetFileId` in a body pack, `ADULT_TARGET_FILE` in the adult pack. */
  id: string;
  file: string;
  encoding: typeof TARGET_ENCODING;
  /** SHA-256 of the file as shipped (compressed). */
  sha256: string;
  entries: TargetEntry[];
}

/**
 * A shape modifier from MakeHuman's modifier table: `id` is
 * `group/target-lo|hi` for two-sided modifiers (value in [-1, 1]) and
 * `group/target` for one-sided ones (value in [0, 1]).
 */
export interface ShapeModifierEntry {
  id: string;
  group: string;
  lo: string | null;
  hi: string;
  adultOnly: boolean;
}

/** One control in MakeHuman's modelling taxonomy. */
export interface SliderEntry {
  /** A macro variable (a `MacroValues` key) or a shape modifier id. */
  kind: "macro" | "modifier";
  id: string;
  label: string;
  /** MakeHuman's camera hint for this slider (`frontView`, `leftView`, ...). */
  camera: string | null;
  description: string | null;
  /** Position in MakeHuman's full taxonomy, so sliders from several packs merge in upstream order. */
  order: number;
}

export interface SliderGroup {
  id: string;
  label: string;
  sliders: SliderEntry[];
}

/** A tab of MakeHuman's modelling UI (Main, Gender, Face, Torso, ..., Measure, Body shapes). */
export interface SliderTask {
  id: string;
  label: string;
  sortOrder: number;
  /** Camera hint for the whole task (`faceCamera`), if any. */
  camera: string | null;
  groups: SliderGroup[];
}

export interface BoneEntry {
  name: string;
  parent: string | null;
  /** Joint names; each joint is the centroid of a vertex list in `joints`. */
  head: string;
  tail: string;
  /** Three joint names defining the bone's roll plane, when the rig specifies one. */
  plane: string[] | null;
}

export interface BvhJoint {
  name: string;
  channels: string[];
}

export interface BodyPoseEntry {
  /** Id, the source file's name (`tpose`, `benchmark`, or an authored pose such as `relaxed`). */
  name: string;
  title: string;
  description: string;
  joints: BvhJoint[];
  /** One value per channel of `joints`, in order. */
  frame: number[];
}

export interface PackSource {
  project: string;
  commit: string;
  license: string;
  note: string;
}

export interface BodyManifest {
  format: 1;
  kind: "body";
  /** Compatibility key for assets that bind to this base mesh. */
  topology: string;
  source: PackSource;
  unit: "metre";
  vertexCount: number;
  uvCount: number;
  faceCount: number;
  groups: FaceGroup[];
  body: {
    file: string;
    sha256: string;
    layout: Record<
      "positions" | "uvs" | "faceVerts" | "faceUvs" | "skinIndex" | "skinWeight",
      BufferRange
    >;
  };
  /** The target files, one per `BODY_TARGET_FILES` id, in that order. */
  targets: TargetFile[];
  modifiers: ShapeModifierEntry[];
  sliders: SliderTask[];
  attachments: {
    file: string;
    sha256: string;
    /**
     * The key poses attachment occlusion was baked at (`OCCLUSION_KEYS` ids, in
     * order); each attachment's `occlusion` holds one bake per corner of their
     * cube.
     */
    occlusionKeys: string[];
    entries: AttachmentEntry[];
  };
  /**
   * The body's own occlusion, baked at pack time (`HumanoidModel.bakeBodyOcclusion`).
   * Absent from packs that predate it, whose body is then never darkened.
   */
  bodyOcclusion?: BodyOcclusionEntry;
  /**
   * The age surface map (`src/surface/ageSurface.ts`), a texture in the body's
   * UV space fetched only for a figure old enough to show it. Absent from packs
   * that predate it, whose figures then age in shape alone.
   */
  ageSurface?: { file: string; sha256: string; size: number };
  /**
   * MakeHuman's low-poly proxy bodies (`proxy741`, `male1591`, `female1605`):
   * other topologies for the body, bound to the base mesh like garments
   * (docs/MINIATURES.md). Absent from packs that predate them.
   */
  proxies?: {
    file: string;
    sha256: string;
    entries: ProxyEntry[];
  };
  skeleton: { bones: BoneEntry[]; joints: Record<string, number[]> };
  faceUnits: { names: string[]; joints: BvhJoint[]; frames: number[][] };
  /** Whole-body poses (one BVH frame each, MakeHuman's Z-up axes; see src/rig/pose.ts). */
  poses: BodyPoseEntry[];
}

/**
 * The body's cavity occlusion file: `count` ascending base-vertex indices
 * (u32), then one byte per vertex for each corner of the cube of `keys` (the
 * `OCCLUSION_KEYS` ids it was baked at; corner 0 is rest), corner by corner.
 */
export interface BodyOcclusionEntry {
  file: string;
  /** SHA-256 of the file as shipped (compressed). */
  sha256: string;
  keys: string[];
  /** How many vertices it stores. */
  count: number;
}

/**
 * Occlusion for the few body vertices that are ever enclosed (the mouth's
 * inside, the nostrils, the ear canals, the eye sockets); every other vertex is
 * open at every pose. 255 = open, 0 = fully enclosed
 * (docs/ARCHITECTURE.md, "Body occlusion").
 */
export interface BodyOcclusion {
  /** Ascending base-vertex indices. */
  vertices: Uint32Array;
  /** One byte per vertex for each corner of the key cube: corner 0 (rest) first, each `vertices.length` long. */
  values: Uint8Array;
}

export interface AttachmentMaterial {
  color: [number, number, number];
  roughness: number;
  /** File name of the diffuse texture within the pack, if any. */
  texture: string | null;
  /** File name of the tangent-space normal map within the pack, if the pack ships one. */
  normalTexture?: string | null;
  transparent: boolean;
  alphaToCoverage: boolean;
  backfaceCull: boolean;
}

/** A mesh bound to the base mesh in MakeHuman's MHCLO manner (eyes, teeth, hair, clothes...). */
export interface AttachmentEntry {
  id: string;
  kind: string;
  name: string;
  zDepth: number;
  vertexCount: number;
  faceCount: number;
  /** Per-axis offset scaling: [base vertex, base vertex, reference distance in metres]. */
  scale: {
    x: [number, number, number];
    y: [number, number, number];
    z: [number, number, number];
  } | null;
  material: AttachmentMaterial;
  layout: Record<
    | "refVerts"
    | "weights"
    | "offsets"
    | "faceVerts"
    | "faceUvs"
    | "uvs"
    | "deleteVerts"
    | "occlusion",
    BufferRange
  >;
}

export interface BoundAsset {
  entry: AttachmentEntry;
  /** Three base vertex indices per attachment vertex. */
  refVerts: Uint32Array;
  weights: Float32Array;
  /** Offsets in metres before per-axis scaling. */
  offsets: Float32Array;
  faceVerts: Uint32Array;
  faceUvs: Uint32Array;
  uvs: Float32Array;
  /** Base vertices this attachment hides while worn. */
  deleteVerts: Uint32Array;
  /**
   * Per vertex, how open it is to light (255) or enclosed by the figure (0),
   * baked at pack time with every body-pack attachment worn
   * (`HumanoidModel.bakeAttachmentOcclusion`): `vertexCount` values for each
   * corner of the cube of the manifest's `attachments.occlusionKeys` (corner
   * m has key i at full weight when bit i of m is set; corner 0 is rest).
   */
  occlusion: Uint8Array;
  /** A hair style's measured fields (`HairFieldData`); absent on every other attachment. */
  hair?: HairFieldData;
}

/**
 * The kinds of entry the hair pack lists: scalp hair, the brows and lashes
 * (decals), and generated body hair cards (`beard`: a grown beard's length,
 * over the coat's dense base; docs/ARCHITECTURE.md, "Body hair"), and authored
 * facial hair (`facial`: a beard or a moustache from CC0 assets, bound like scalp hair).
 */
export const HAIR_KINDS = ["scalp", "brows", "lashes", "beard", "facial"] as const;
export type HairKind = (typeof HAIR_KINDS)[number];

/** Kinds whose entries carry the measured strand fields (`HAIR_FIELD_KEYS`). */
export const STRAND_KINDS: readonly HairKind[] = ["scalp", "beard", "facial"];

/**
 * The buffer a body hair card entry carries beyond a scalp style's: per card
 * vertex, its card's rank (0..255). A card is drawn while its rank is under the
 * figure's coverage, so density follows age, sex and the recipe with the same
 * geometry.
 */
export const CARD_FIELD_KEYS = ["rank"] as const;

/** The buffers a hair style's binary carries beyond an attachment's (`src/surface/hairFields.ts`). */
export const HAIR_FIELD_KEYS = [
  "growth",
  "uvScale",
  "fade",
  "fin",
  "scalpVerts",
  "scalpWeights",
] as const;

/**
 * What the packer measured of a hair style against the body at rest: per card
 * vertex its growth (distance from the root, 1e-4 m steps), fade (255 = all
 * there, 0 = dithered away, at a hairline) and fin (255 = stands out of the scalp), and the body vertices the style
 * grows from with their density (1..255).
 */
export interface HairFieldData {
  growth: Uint16Array;
  /** Texture units per metre across each card, in 1/16 (`UV_SCALE_STEPS`). */
  uvScale: Uint16Array;
  fade: Uint8Array;
  fin: Uint8Array;
  scalpVerts: Uint16Array;
  scalpWeights: Uint8Array;
  /** A body hair card entry's ranks (`CARD_FIELD_KEYS`); absent on scalp hair. */
  rank?: Uint8Array;
}

/**
 * One scalp hair style of the hair pack: an attachment bound to the base mesh
 * (`kind` is `"hair"`, `deleteVerts` is empty, since MakeHuman's hair hides no
 * body face) with its own binary, so a figure loads only the style it wears.
 * The `material.texture` is a strand map (docs/ARCHITECTURE.md, "Hair"), and
 * `occlusion` is one baked value per control vertex, at rest.
 */
export interface HairStyleEntry extends Omit<AttachmentEntry, "layout" | "kind"> {
  /**
   * What the entry is: `scalp` (head hair, what `recipe.hair.style` wears) or the
   * `brows` or `lashes` that share the pack's loader, binding and colour model.
   */
  kind: HairKind;
  /**
   * A scalp style's layout holds every `HAIR_FIELD_KEYS` buffer; a beard's
   * cards hold those and `CARD_FIELD_KEYS`; a decal's (`brows`, `lashes`) holds
   * none, since it has no hairline, growth or scalp.
   */
  layout: AttachmentEntry["layout"] &
    Partial<
      Record<(typeof HAIR_FIELD_KEYS)[number] | (typeof CARD_FIELD_KEYS)[number], BufferRange>
    >;
  /** What a picker shows. */
  label: string;
  /** What the style is: length, texture, shape (`short`, `curly`, `ponytail`...). */
  tags: string[];
  /** The style's binary, gzipped, within the hair pack. */
  file: string;
  /** SHA-256 of `file` as shipped (compressed). */
  sha256: string;
  /**
   * Which way the strands run in the strand map's texture space, measured when
   * packed: `angle` in radians from U toward V, `coherence` 0 (fluffy, curly)
   * to 1 (parallel strands).
   */
  strand: { angle: number; coherence: number };
}

/** The hair pack's manifest. Styles are listed in the order a picker offers them. */
export interface HairManifest {
  format: 1;
  kind: "hair";
  topology: string;
  /** `body.sha256` of the body pack this pack was built against. */
  bodySha256: string;
  source: PackSource;
  styles: HairStyleEntry[];
}

/** The loaded hair pack: every style is known from the manifest, its geometry arrives on demand. */
export interface HairAssets {
  manifest: HairManifest;
  /** Every style of the manifest, by id. */
  styles: Map<string, HairStyleEntry>;
  /** The styles whose geometry has arrived. */
  bound: Map<string, BoundAsset>;
  /**
   * Resolves with a style's geometry, fetching it if it has not arrived. Styles
   * loaded without URLs (parsed from buffers) only resolve once added
   * (`addHairStyle`).
   */
  load(id: string): Promise<BoundAsset>;
}

export interface HairPackData {
  manifest: HairManifest;
}

/**
 * A garment of the clothing pack: a mesh bound to the base mesh like an
 * attachment, worn by choice rather than with every figure, and without baked
 * occlusion.
 */
export interface GarmentEntry extends Omit<AttachmentEntry, "layout"> {
  /**
   * The category it stacks as among garments of equal `zDepth` (`GARMENT_LAYERS`: `clothes`, `jacket`, `shoes`,
   * `hat`, ...), in place of an attachment's kind.
   */
  kind: string;
  /**
   * What a person would call it ("Brown oxfords"), for browsing; the asset's
   * own name (`name`) is a file name that also says whom it was drawn for.
   */
  label: string;
  /** The asset's own tags (`Casual`, `Male`, ...). */
  tags: string[];
  /**
   * True for a piece that must not bend (a canteen, a cartridge box): it is
   * bound as usual, then moved as one piece to where the binding put it, and
   * skinned to one bone (`placeRigid`, `rigidSkin`). Absent is false.
   */
  rigid?: boolean;
  layout: Omit<AttachmentEntry["layout"], "occlusion">;
}

export interface BoundGarment extends Omit<BoundAsset, "entry" | "occlusion"> {
  entry: GarmentEntry;
}

/**
 * A MakeHuman proxy body: another topology for the whole body, bound to the
 * base mesh vertex by vertex like a garment (each vertex three base vertices,
 * weights and a scaled offset), so it follows every morph. It carries no
 * occlusion and no material: it is drawn as the body.
 */
export interface ProxyEntry extends Omit<AttachmentEntry, "layout"> {
  layout: Omit<AttachmentEntry["layout"], "occlusion">;
}

export interface BoundProxy extends Omit<BoundAsset, "entry" | "occlusion"> {
  entry: ProxyEntry;
}

/** The clothing pack (`humanoid-kit-clothing`): garments bound to the body pack's base mesh. */
export interface ClothingManifest {
  format: 1;
  kind: "clothing";
  topology: string;
  /** `body.sha256` of the body pack this pack was built against. */
  bodySha256: string;
  source: PackSource;
  garments: {
    file: string;
    sha256: string;
    entries: GarmentEntry[];
  };
}

/**
 * What the core needs to know about the adult anatomy that names its targets
 * and modifiers. It is the pack's data, so the core, which ships in the public
 * build, names none of them (`pnpm check:pages`): the code of the adult skin
 * layers is in the core, and this says which targets their fields are
 * measured from.
 */
export interface AdultAnatomySpec {
  /** The anatomy features and the modifiers that apply each (`appliedAnatomy`). */
  features: AnatomyFeature[];
  /** How each adult skin layer's fields are measured, by the layer's id. */
  skinLayers: AdultSkinLayerSpec[];
  /** Shape states of the adult anatomy (arousal), added to the body's `STATE_MORPHS`. */
  stateMorphs: StateMorph[];
  /**
   * The body's pelvic faces to refine for an adult figure (`refineGraded`):
   * the adult surface has finer geometry there than the base body, for the
   * anatomy to be shaped in. Absent, an adult figure keeps the base surface.
   */
  surface?: AdultSurfaceSpec;
  /**
   * Targets on the adult surface's own vertices (docs/research/ADULT-SCULPT-PLAN.md,
   * section 6a). Absent, the pack has only control targets.
   */
  detail?: AdultDetailSpec;
  /**
   * Collapsed strips on the adult surface that detail extrudes (docs/research/
   * ADULT-SCULPT-PLAN.md, section 6b). Needs `surface`; absent, there are none.
   */
  reservoirs?: AdultReservoirSpec[];
  /**
   * The areas of the coat regions only an adult grows (pubic hair), as data:
   * the core holds their code and paint, the pack where they grow. Absent,
   * they grow nowhere.
   */
  coatRegions?: AdultCoatRegionSpec[];
  /**
   * The piercing sites of the adult anatomy, as data: the core holds the
   * jewellery and its placement, the pack where the holes are. A recipe names
   * one by `name` (`Piercing.site`); the age policy refuses any of them under
   * 18. Their vertices are the detail lattice's (`detail`), which they need.
   * Absent, the adult anatomy has none.
   */
  piercingSites?: AdultPiercingSiteSpec[];
  /**
   * What an adult figure's anatomy is when its recipe sets none of it: per
   * adult-only modifier, its value as a piecewise-linear function of the gender
   * macro, written `x,w;x,w;…` (`withAnatomyDefaults`). With the pack loaded an
   * adult is anatomically complete by default; a recipe's own value always wins.
   * Absent, unset modifiers stay at 0.
   */
  defaults?: Record<string, string>;
}

/**
 * A piercing site on the adult anatomy (`AdultAnatomySpec.piercingSites`).
 * Its hole is where the figure's evaluated adult surface carries detail-lattice
 * vertex `vertex` (the vertices `AdultDetailSpec`'s targets address: the
 * refined region's, then each reservoir's rings), so it follows the detail
 * that shapes the anatomy.
 */
export interface AdultPiercingSiteSpec {
  /** The site's name in a recipe: not one of the body's own (`PIERCING_SITES`). */
  name: string;
  /** The detail-lattice vertex the hole meets the skin at. */
  vertex: number;
  /** How the hole runs through the tissue (`PiercingChannel`). */
  channel: "normal" | "across" | "vertical";
  /** The tissue the hole crosses, metres: more than 0, at most `PIERCING_DEPTH_MAX`. */
  depth: number;
}

/** The thickest tissue a declared piercing site may say its hole crosses, metres. */
export const PIERCING_DEPTH_MAX = 0.03;

/** The ids of the core's coat regions whose area an adult anatomy pack gives. */
export const ADULT_COAT_REGION_IDS = ["hair-pubic"] as const;

/** A coat region's area: its mask, sparse over base vertices (0 elsewhere). */
export interface AdultCoatRegionSpec {
  /** The core's coat region it is the area of (`ADULT_COAT_REGION_IDS`). */
  id: string;
  /** Base vertices in the region, ascending. */
  vertices: number[];
  /** Each vertex's mask, 0..1. */
  mask: number[];
}

/** A reservoir (`Reservoir` in src/build/reservoir.ts) with the id detail refers to it by. */
/**
 * A canal's opening closed at the skin, evaluated on each figure
 * (`src/model/canalClosure.ts`): its loop moved onto the closed shape, the skin
 * round it by fixed weights on the loop's displacements, and any radial folds.
 */
export interface CanalClosureSpec {
  /** The detail target of the canal: its weight is how far the opening is closed (`closureShare`). */
  target: string;
  /** What is left open across the slit it closes to, metres. */
  gap: number;
  /** The slit's length front to back, metres; absent, the loop's own (`closedLoop`). */
  length?: number;
  /** The skin's outward normal over the opening on the authoring figure: the closure's frame. */
  normal: [number, number, number];
  /** The loop's region (detail) indices, in the spec's loop order. */
  loopRegion: number[];
  /** The zone round the loop, region indices; each one's weights on the loop's places, CSR (`zoneStart`, `zoneLoop`, `zoneWeight`). */
  zone: number[];
  zoneStart: number[];
  zoneLoop: number[];
  zoneWeight: number[];
  /** Radial folds round the opening (the anus's): a displacement of region vertices, metres, at full closure. */
  folds?: { indices: number[]; xyz: number[] };
}

export interface AdultReservoirSpec {
  id: string;
  /** Vertices of the refinement mesh round the cap, in order. */
  loop: number[];
  /** Polygons of the refinement mesh that make the cap. */
  cap: number[];
  /** Collapsed rings between the loop and the cap. */
  rings: number;
  /**
   * Where its skin lies in UV space (`ReservoirIsland`): a grid for the wall and a
   * disc for the cap, in free space of the body's UV layout, so a skin layer can
   * colour the tube and tell it from the skin round its root. Absent, the wall is
   * collapsed in UV and the cap keeps the UVs of the skin it replaced.
   */
  island?: {
    origin: [number, number];
    across: [number, number];
    along: [number, number];
    cap: { centre: [number, number]; radius: number };
  };
  /**
   * The adult skin layer (`AdultSkinLayerSpec.id`) that colours its island: mask 1
   * over all of it, and the layer's coordinate running from the loop (0) to the tip (1).
   */
  layer?: string;
  /**
   * A canal, drawn into the body, not an organ drawn out of it: `opening`, metres
   * along it, is how far in its opening closes into its lumen. Its vertices take
   * their root's weights over that length (`rootShares`), not over an organ's band.
   * `gap`, metres, is its closed lumen's: its walls that close lie in contact, not
   * in each other (the invariants' lumen self-contact). `closure` closes its opening
   * at the skin on each figure; the pack's generator adds it once the detail lattice
   * is known, and an opening without one is left open.
   */
  canal?: { opening: number; gap: number; closure?: CanalClosureSpec };
}

/**
 * Detail targets: entries of the adult target file whose indices name vertices
 * of the refined surface's region (`HumanoidModel.adultDetailLattice`), not of
 * the base body. They are driven by modifiers like any target, and added to the
 * adult surface after it is evaluated, so no figure under 18 reaches them.
 */
export interface AdultDetailSpec {
  /** Names of the adult file's targets that are detail targets. */
  targets: string[];
  /**
   * The lattice these targets were authored on (`AdultDetailLattice.key`); the
   * model refuses them against any other refinement.
   */
  surfaceKey: string;
  /**
   * The figure's scale for a detail: two control vertices and their distance
   * (metres) on the figure the targets were authored against. A detail is
   * scaled by the ratio of the figure's own distance to `rest`. Absent: none.
   */
  scale?: { a: number; b: number; rest: number };
  /**
   * The figure the targets were authored on, by its macros (`createRecipe` input).
   * With it, a reservoir's organ is placed as that figure's skin under it plus the
   * displacement, carried rigidly from that figure's loop to the evaluated one's,
   * as far as it is pushed out of the skin (`src/model/detailCarry.ts`). Absent: the
   * displacement is added to the evaluated figure's own skin.
   */
  authoredOn?: { macros: Partial<MacroValues> };
  /**
   * Targets that shape the skin itself (the vulva's folds), not an organ drawn out of
   * it: added first, to the figure's own skin, never carried (`authoredOn`), and no
   * push of a reservoir out of the skin, so they leave its skinning as it was. A ring
   * of a reservoir lying in that skin takes its loop vertex's displacement. Absent: none.
   */
  skin?: string[];
  /**
   * Targets whose weight is multiplied by other values: `gates[target]` lists
   * factors (`src/model/detailFactors.ts`): `mod:<id>` (that modifier's positive
   * part: how much of a feature there is), `mod-:<id>` (its negative part),
   * `signal:<name>` (a skin-state signal, 0..1), `ramp:<id>:<x>,<w>;…` (a
   * piecewise-linear function of a modifier's positive part) or `sramp:<name>:<x>,<w>;…`
   * (the same of a signal).
   * A girth change of a shaft is worth nothing without a shaft: its target is
   * gated by the length modifier, so the two combine as a product and not as a
   * sum of two independent displacements. A factor that is zero drops the target.
   */
  gates?: Record<string, string[]>;
  /**
   * Targets whose weight is derived from factors alone, with no modifier of their
   * own: `drives[target]` lists factors as in `gates`, and the target is worth
   * their product. A small organ is not a scaled-down large one, so size is a
   * blend of baked shape keys, each driven by a `ramp` of one size modifier.
   * Derived weights reach adults only, and a drive may name a modifier that has
   * no target of its own (`ShapeModifierEntry` with an empty `hi`).
   */
  drives?: Record<string, string[]>;
}

/**
 * Faces of the base body to refine and by how much: `levels[i]` for face `faces[i]`;
 * then, optionally, patches that replace some of the refined polygons with a mesh of
 * the pack's own (`SurfacePatch`, src/build/patches.ts): a reservoir's smooth loop.
 * A pack without them is refined as it always was.
 */
export interface AdultSurfaceSpec {
  faces: number[];
  levels: number[];
  patches?: AdultSurfacePatch[];
}

/** One patch of the refined surface: see `SurfacePatch` (src/build/patches.ts). */
export interface AdultSurfacePatch {
  remove: number[];
  vertices: { from: number[]; weights: number[] }[];
  uvs: { from: number[]; weights: number[] }[];
  polygons: { vertices: number[]; uvs: number[]; of: number }[];
}

/** A skin layer's mask is the union of these targets' footprints (`targetMask`). */
export interface AdultSkinLayerSpec {
  /** Id of the adult layer in the core's stack (`ADULT_SKIN_LAYERS`). */
  id: string;
  masks: string[];
  /** The mask's easing between a vertex's displacement relative to the peak (`targetMask`'s lo and hi). */
  lo: number;
  hi: number;
  /** The target the layer's 0..1 coordinate is measured from (`targetCoordinate`), if it has one. */
  coordinate?: string;
  /**
   * A mask the pack authors per base vertex (0..1 each), joined with the targets'
   * (the larger wins): for a feature whose form is a detail target, which moves the
   * adult surface's lattice and so has no footprint on the base to measure.
   */
  vertexMask?: { indices: number[]; weights: number[] };
}

export interface AdultAnatomyManifest {
  format: 1;
  kind: "adult-anatomy";
  topology: string;
  /** `body.sha256` of the body pack this pack was built against. */
  bodySha256: string;
  source: PackSource;
  targets: TargetFile;
  modifiers: ShapeModifierEntry[];
  /** This pack's sliders, placed into the body pack's tasks and groups by id. */
  sliders: SliderTask[];
  /** The anatomy's features, skin layers and states; a pack without it adds none of them. */
  anatomy?: AdultAnatomySpec;
}

/** A sparse target: ascending base-vertex indices and their quantised xyz deltas. */
export interface SparseTarget {
  name: string;
  indices: Uint16Array;
  /** Quantised xyz deltas; multiply by `scale` for metres. */
  deltas: Int16Array;
  scale: number;
}

/**
 * The bone influences a skinned vertex carries: its `skinIndex` and `skinWeight`
 * hold this many places each, heaviest first, unused places weight 0.
 * MakeHuman skins a vertex with every weight its rig gives it, up to 12 on the
 * shoulder; 3,665 of the base mesh's vertices have more than four, and only 51
 * more than eight. Cut to four, a shoulder vertex can lose a fifth of its weight
 * on the upper arm, and stays behind while its neighbours follow a raised arm
 * (issue #67), so the rig keeps eight: the visible difference from MakeHuman's
 * skinning ends there (docs/ARCHITECTURE.md, "Skinning artefacts").
 */
export const SKIN_INFLUENCES = 8;

export interface HumanoidAssets {
  manifest: BodyManifest;
  /** Base positions in metres, `vertexCount * 3`. */
  positions: Float32Array;
  uvs: Float32Array;
  /** Quad corner vertex indices, `faceCount * 4`. */
  faceVerts: Uint32Array;
  /** Quad corner UV indices, `faceCount * 4`. */
  faceUvs: Uint32Array;
  /** `SKIN_INFLUENCES` bone indices per vertex. */
  skinIndex: Uint8Array;
  /** Normalised weights matching `skinIndex`. */
  skinWeight: Float32Array;
  /** The targets of every loaded target file (`targetFilesLoaded`). */
  targets: Map<string, SparseTarget>;
  /** Every shape modifier of the loaded packs, known before their targets arrive. */
  modifiers: Map<string, ShapeModifierEntry>;
  /** The slider taxonomy of every loaded pack, merged in MakeHuman's order. */
  sliders: SliderTask[];
  attachments: Map<string, BoundAsset>;
  /** The hair pack, when one was loaded. */
  hair: HairAssets | null;
  /**
   * Every loaded clothing pack's garments by id, ids unique across the packs.
   * A pack's garments arrive with its binary (`pendingGarmentPacks`); its
   * manifest lists them earlier.
   */
  garments: Map<string, BoundGarment>;
  /** The loaded clothing packs' manifests, in load order; empty without one. */
  clothingManifests: readonly ClothingManifest[];
  /** The indices into `clothingManifests` of the packs whose garments binary has not arrived. */
  pendingGarmentPacks: Set<number>;
  /**
   * The body pack's proxy bodies by id (`BodyManifest.proxies`); empty until
   * their binary is added (`addProxies`, or `loadProxies` after a load).
   */
  proxies: Map<string, BoundProxy>;
  /**
   * Fetches and adds the proxy binary once (a failed fetch is forgotten, so a
   * later call retries); null when the assets were parsed without pack URLs or
   * the pack has no proxies.
   */
  loadProxies: (() => Promise<Map<string, BoundProxy>>) | null;
  /** The body's own cavity occlusion; null for a pack that predates it. */
  bodyOcclusion: BodyOcclusion | null;
  /** URL of each pack file by name (textures included); empty when parsed without URLs. */
  fileUrls: Map<string, string>;
  adultAnatomyLoaded: boolean;
  /** The adult anatomy pack's manifest, when that pack was loaded. */
  adultAnatomyManifest: AdultAnatomyManifest | null;
  /**
   * Ids of the loaded packs' target files that are not in `targets` yet
   * (`BODY_TARGET_FILES`, and `ADULT_TARGET_FILE`); empty once all have arrived.
   */
  targetFilesPending: Set<string>;
  /** The target file each packed target name is in, loaded or not. */
  targetFileOf: Map<string, string>;
}

export class AssetFormatError extends Error {
  override name = "AssetFormatError";
}

function view<T extends Float32Array | Uint32Array | Uint16Array | Uint8Array>(
  Ctor: { new (buffer: ArrayBuffer, offset: number, length: number): T; BYTES_PER_ELEMENT: number },
  buffer: ArrayBuffer,
  range: BufferRange | undefined,
  what: string,
): T {
  if (!range) throw new AssetFormatError(`${what}: the pack has no buffer range for it`);
  if (range.offset + range.byteLength > buffer.byteLength) {
    throw new AssetFormatError(
      `buffer range ${range.offset}+${range.byteLength} exceeds ${buffer.byteLength}`,
    );
  }
  if (
    range.byteLength % Ctor.BYTES_PER_ELEMENT !== 0 ||
    range.offset % Ctor.BYTES_PER_ELEMENT !== 0
  ) {
    throw new AssetFormatError(
      `buffer range ${range.offset}+${range.byteLength} is misaligned for its element type`,
    );
  }
  return new Ctor(buffer, range.offset, range.byteLength / Ctor.BYTES_PER_ELEMENT);
}

function fail(message: string): never {
  throw new AssetFormatError(message);
}

function expectLength(arr: ArrayLike<number>, expected: number, what: string): void {
  if (arr.length !== expected)
    throw new AssetFormatError(`${what}: expected ${expected} values, got ${arr.length}`);
}

function expectIndices(arr: ArrayLike<number>, limit: number, what: string): void {
  for (let i = 0; i < arr.length; i++) {
    if ((arr[i] as number) >= limit)
      throw new AssetFormatError(`${what}: index ${arr[i]} is out of range (< ${limit})`);
  }
}

/** Refuses an adult pack's coat regions unless each is a known region's well-formed area, once. */
function checkAdultCoatRegions(regions: readonly AdultCoatRegionSpec[], vertexCount: number): void {
  const known = new Set<string>(ADULT_COAT_REGION_IDS);
  const seen = new Set<string>();
  for (const r of regions) {
    const what = `adult coat region ${r.id}`;
    if (!known.has(r.id)) throw new AssetFormatError(`${what}: the core has no such region`);
    if (seen.has(r.id)) throw new AssetFormatError(`${what}: given twice`);
    seen.add(r.id);
    expectLength(r.mask, r.vertices.length, what);
    for (let i = 0; i < r.vertices.length; i++) {
      const v = r.vertices[i] as number;
      const m = r.mask[i] as number;
      if (
        !Number.isInteger(v) ||
        v < 0 ||
        v >= vertexCount ||
        (i > 0 && v <= (r.vertices[i - 1] as number))
      )
        throw new AssetFormatError(`${what}: vertex ${v} is not ascending within the body`);
      if (!(m >= 0 && m <= 1)) throw new AssetFormatError(`${what}: mask ${m} is outside 0..1`);
    }
  }
}

/**
 * Refuses anatomy defaults the core could not apply: one for a modifier the
 * pack does not declare or that is not adult-only (a default must never shape a
 * minor's figure), or a curve that is not ascending `x,w` points within the
 * modifier's range.
 */
function checkAnatomyDefaults(
  anatomy: AdultAnatomySpec | undefined,
  modifiers: readonly ShapeModifierEntry[],
): void {
  for (const [id, curve] of Object.entries(anatomy?.defaults ?? {})) {
    const what = `adult anatomy default for ${id}`;
    const m = modifiers.find((x) => x.id === id);
    if (!m) throw new AssetFormatError(`${what}: the pack declares no such modifier`);
    if (!m.adultOnly) throw new AssetFormatError(`${what}: the modifier is not adult-only`);
    const lo = m.lo === null ? 0 : -1;
    try {
      for (const [, w] of parseCurve(curve))
        if (!(w >= lo && w <= 1)) throw new Error(`value ${w} is outside ${lo}..1`);
    } catch (e) {
      throw new AssetFormatError(`${what}: ${(e as Error).message}`);
    }
  }
}

/** Ascending `x,w;x,w;…` points, at least two; throws a plain Error naming what is wrong. */
export function parseCurve(text: string): [number, number][] {
  const points = text.split(";").map((p) => p.split(",").map(Number) as [number, number]);
  if (points.length < 2 || points.some((p) => p.length !== 2 || p.some((x) => !Number.isFinite(x))))
    throw new Error("needs at least two numeric x,w points");
  for (let i = 1; i < points.length; i++)
    if ((points[i] as [number, number])[0] <= (points[i - 1] as [number, number])[0])
      throw new Error("has points that do not ascend in x");
  return points;
}

/** The piecewise-linear function through `points`, holding its end values outside them. */
export function curveAt(points: readonly (readonly [number, number])[], v: number): number {
  const first = points[0] as readonly [number, number];
  const last = points[points.length - 1] as readonly [number, number];
  if (v <= first[0]) return first[1];
  if (v >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    const b = points[i] as readonly [number, number];
    if (v <= b[0]) {
      const a = points[i - 1] as readonly [number, number];
      return a[1] + ((v - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
    }
  }
  return last[1];
}

/**
 * The loader does not trust the adult pack's own flags: every route its content
 * can reach a figure by must already be one the age policy gates, or the pack is
 * refused (docs/AGE-POLICY.md).
 *
 * - Each of the pack's modifiers is flagged adult-only and is one the policy
 *   gates by id (`ADULT_ONLY_MODIFIER`, which `withAge` strips and the
 *   violations list names), takes no id of a body modifier and is not in the
 *   custom group, whose modifiers `addCustomTargets` replaces.
 * - No body modifier drives a target of the adult pack's file.
 * - Each state morph the pack adds runs on an adult-only signal
 *   (`ADULT_ONLY_SIGNALS`), so no signal a figure under 18 may have drives it.
 */
function checkAdultGates(adult: AdultAnatomyManifest, body: BodyManifest): void {
  const bodyIds = new Set(body.modifiers.map((m) => m.id));
  const adultTargets = new Set(adult.targets.entries.map((e) => e.name));
  for (const m of adult.modifiers) {
    const what = `adult pack modifier ${m.id}`;
    if (bodyIds.has(m.id)) throw new AssetFormatError(`${what} has the id of a body pack modifier`);
    if (m.adultOnly !== true) throw new AssetFormatError(`${what} is not marked adult-only`);
    if (!ADULT_ONLY_MODIFIER(m.id))
      throw new AssetFormatError(`${what} is not an id the age policy treats as adult-only`);
    if (m.group === CUSTOM_GROUP)
      throw new AssetFormatError(`${what} is in the ${CUSTOM_GROUP} group, which is the host's`);
  }
  for (const m of body.modifiers)
    for (const t of [m.lo, m.hi])
      if (t && adultTargets.has(t))
        throw new AssetFormatError(
          `body pack modifier ${m.id} drives ${t}, a target of the adult pack`,
        );
  for (const s of adult.anatomy?.stateMorphs ?? [])
    if (!ADULT_ONLY_SIGNALS.includes(s.signal))
      throw new AssetFormatError(
        `adult pack state morph on ${s.signal}: only an adult-only signal may drive the adult pack`,
      );
}

/**
 * Refuses a declared piercing site the core could not place: one without the
 * detail lattice its vertex is numbered in, a name given twice or that is the
 * body's own, a channel it does not know, a vertex that is not an index, or a
 * depth outside (0, `PIERCING_DEPTH_MAX`]. Whether the vertex is in the lattice
 * is checked once the adult surface is built.
 */
function checkAdultPiercingSites(anatomy: AdultAnatomySpec | undefined): void {
  const sites = anatomy?.piercingSites ?? [];
  if (sites.length && !anatomy?.detail)
    throw new AssetFormatError(
      "adult piercing sites are numbered in the detail lattice, and the pack has no detail spec",
    );
  const channels = new Set(["normal", "across", "vertical"]);
  const seen = new Set<string>();
  for (const s of sites) {
    const what = `adult piercing site ${String(s.name)}`;
    if (typeof s.name !== "string" || s.name === "")
      throw new AssetFormatError("an adult piercing site has no name");
    if (isBodyPiercingSite(s.name))
      throw new AssetFormatError(`${what}: the name is one of the body's own sites`);
    if (seen.has(s.name)) throw new AssetFormatError(`${what}: given twice`);
    seen.add(s.name);
    if (!channels.has(s.channel))
      throw new AssetFormatError(`${what}: channel ${String(s.channel)} is not one the core knows`);
    if (!Number.isInteger(s.vertex) || s.vertex < 0)
      throw new AssetFormatError(`${what}: vertex ${String(s.vertex)} is not an index`);
    if (!(s.depth > 0 && s.depth <= PIERCING_DEPTH_MAX))
      throw new AssetFormatError(
        `${what}: depth ${String(s.depth)} is outside (0, ${PIERCING_DEPTH_MAX}]`,
      );
  }
}

/**
 * Decodes targets from a decompressed `TARGET_ENCODING` file (see the header)
 * into `map`. `existing` holds targets already loaded, which may not repeat.
 */
function addTargets(
  map: Map<string, SparseTarget>,
  file: TargetFile,
  bin: ArrayBuffer,
  what: string,
  vertexCount: number,
  existing: ReadonlyMap<string, SparseTarget> = map,
  /** Detail targets, whose indices are the adult surface's, checked when that is built. */
  detail: ReadonlySet<string> = new Set(),
): void {
  if (file.encoding !== TARGET_ENCODING)
    throw new AssetFormatError(`${what}: unsupported target encoding ${String(file.encoding)}`);
  const view = new DataView(bin);
  for (const e of file.entries) {
    const n = e.count;
    if (!Number.isInteger(n) || n < 0 || e.offset < 0 || e.offset + n * 8 > bin.byteLength)
      throw new AssetFormatError(`target ${e.name} exceeds ${what}`);
    if (map.has(e.name) || existing.has(e.name))
      throw new AssetFormatError(`duplicate target ${e.name} in ${what}`);
    const indices = new Uint16Array(n);
    const deltas = new Int16Array(n * 3);
    let v = 0;
    for (let i = 0; i < n; i++) {
      v += view.getUint16(e.offset + i * 2, true);
      if (v > 0xffff) throw new AssetFormatError(`target ${e.name} indexes past 65535 in ${what}`);
      indices[i] = v;
      for (let k = 0; k < 3; k++)
        deltas[i * 3 + k] = view.getInt16(e.offset + n * 2 + (k * n + i) * 2, true);
    }
    if (!detail.has(e.name)) expectIndices(indices, vertexCount, `target ${e.name}`);
    map.set(e.name, { name: e.name, indices, deltas, scale: e.scale });
  }
}

export interface AdultAnatomyData {
  manifest: AdultAnatomyManifest;
  /**
   * The targets file, decompressed (`gunzip`). Leave it out to add it later
   * with `addTargetFiles` under `ADULT_TARGET_FILE`.
   */
  targets?: ArrayBuffer;
}

export interface ClothingPackData {
  manifest: ClothingManifest;
  /**
   * The garments binary, decompressed (`gunzip`). Leave it out to add it later
   * with `addGarments`; the garments are pending until then.
   */
  garments?: ArrayBuffer;
}

/** Decompressed target files by id (`BODY_TARGET_FILES`, `ADULT_TARGET_FILE`). */
export type TargetFileData = Partial<Record<string, ArrayBuffer>>;

export interface BodyPackData {
  manifest: BodyManifest;
  body: ArrayBuffer;
  /**
   * Decompressed target files by id. `core` is required; any others left out
   * can be added later with `addTargetFiles` as they arrive.
   */
  targets: TargetFileData;
  attachments: ArrayBuffer;
  /** The decompressed body occlusion file; needed when the manifest has an entry for it. */
  bodyOcclusion?: ArrayBuffer;
  /** The decompressed proxy file (`BodyManifest.proxies`); leave it out to add it later with `addProxies`. */
  proxies?: ArrayBuffer;
  /** URL of each pack file by name, when known (needed to load textures). */
  fileUrls?: Map<string, string>;
}

/**
 * The binding arrays every bound mesh has, read and checked against the base
 * mesh it binds to (`baseVertices` vertices).
 */
function readBinding(
  entry: GarmentEntry | AttachmentEntry | ProxyEntry,
  bin: ArrayBuffer,
  baseVertices: number,
  what: (field: string) => string,
): Omit<BoundGarment, "entry"> {
  const l = entry.layout;
  const bound = {
    refVerts: view(Uint32Array, bin, l.refVerts, what("refVerts")),
    weights: view(Float32Array, bin, l.weights, what("weights")),
    offsets: view(Float32Array, bin, l.offsets, what("offsets")),
    faceVerts: view(Uint32Array, bin, l.faceVerts, what("faceVerts")),
    faceUvs: view(Uint32Array, bin, l.faceUvs, what("faceUvs")),
    uvs: view(Float32Array, bin, l.uvs, what("uvs")),
    deleteVerts: view(Uint32Array, bin, l.deleteVerts, what("deleteVerts")),
  };
  expectLength(bound.refVerts, entry.vertexCount * 3, what("refVerts"));
  expectLength(bound.weights, entry.vertexCount * 3, what("weights"));
  expectLength(bound.offsets, entry.vertexCount * 3, what("offsets"));
  expectLength(bound.faceVerts, entry.faceCount * 4, what("faceVerts"));
  expectLength(bound.faceUvs, entry.faceCount * 4, what("faceUvs"));
  if (bound.uvs.length % 2 !== 0) throw new AssetFormatError(`${what("uvs")}: odd length`);
  expectIndices(bound.refVerts, baseVertices, what("refVerts"));
  expectIndices(bound.faceVerts, entry.vertexCount, what("faceVerts"));
  expectIndices(bound.faceUvs, bound.uvs.length / 2, what("faceUvs"));
  expectIndices(bound.deleteVerts, baseVertices, what("deleteVerts"));
  if (entry.scale) {
    for (const axis of ["x", "y", "z"] as const)
      expectIndices(entry.scale[axis].slice(0, 2), baseVertices, what(`${axis}_scale`));
  }
  return bound;
}

/**
 * Reads a body occlusion file (`BodyOcclusionEntry`) for a mesh of
 * `vertexCount` base vertices as views, with no copy.
 */
export function parseBodyOcclusion(
  entry: Pick<BodyOcclusionEntry, "keys" | "count">,
  bin: ArrayBuffer,
  vertexCount: number,
): BodyOcclusion {
  const corners = 2 ** entry.keys.length;
  const expected = entry.count * (4 + corners);
  if (!Number.isInteger(entry.count) || entry.count < 0 || bin.byteLength !== expected)
    throw new AssetFormatError(
      `body occlusion: ${bin.byteLength} bytes cannot hold ${entry.count} vertices baked at ` +
        `${entry.keys.length} keys (${expected} bytes)`,
    );
  const vertices = new Uint32Array(bin, 0, entry.count);
  for (let i = 1; i < vertices.length; i++)
    if ((vertices[i] as number) <= (vertices[i - 1] as number))
      throw new AssetFormatError("body occlusion: vertex indices are not ascending");
  expectIndices(vertices, vertexCount, "body occlusion vertices");
  return { vertices, values: new Uint8Array(bin, entry.count * 4, entry.count * corners) };
}

function parseAttachments(manifest: BodyManifest, bin: ArrayBuffer): Map<string, BoundAsset> {
  const out = new Map<string, BoundAsset>();
  for (const entry of manifest.attachments.entries) {
    const what = (field: string) => `attachment ${entry.id} ${field}`;
    const occlusion = view(Uint8Array, bin, entry.layout.occlusion, what("occlusion"));
    expectLength(
      occlusion,
      entry.vertexCount * 2 ** manifest.attachments.occlusionKeys.length,
      what("occlusion"),
    );
    out.set(entry.id, {
      entry,
      ...readBinding(entry, bin, manifest.vertexCount, what),
      occlusion,
    });
  }
  return out;
}

function parseGarments(
  clothing: ClothingManifest,
  baseVertices: number,
  bin: ArrayBuffer,
): Map<string, BoundGarment> {
  const out = new Map<string, BoundGarment>();
  for (const entry of clothing.garments.entries) {
    if (out.has(entry.id)) throw new AssetFormatError(`duplicate garment ${entry.id}`);
    out.set(entry.id, {
      entry,
      ...readBinding(entry, bin, baseVertices, (field) => `garment ${entry.id} ${field}`),
    });
  }
  return out;
}

/** The hair pack beside its body pack: every style is known, none has its geometry yet. */
function parseHairPack(body: BodyManifest, pack: HairPackData): HairAssets {
  const m = pack.manifest;
  if (m.format !== 1 || m.kind !== "hair")
    throw new AssetFormatError("not a format-1 hair manifest");
  if (m.topology !== body.topology || m.bodySha256 !== body.body.sha256)
    throw new AssetFormatError("the hair pack was built for a different body pack");
  const styles = new Map<string, HairStyleEntry>();
  for (const s of m.styles) {
    if (styles.has(s.id)) throw new AssetFormatError(`duplicate hair style ${s.id}`);
    if (!HAIR_KINDS.includes(s.kind))
      throw new AssetFormatError(`hair style ${s.id}: unknown hair kind ${JSON.stringify(s.kind)}`);
    styles.set(s.id, s);
  }
  const hair: HairAssets = {
    manifest: m,
    styles,
    bound: new Map(),
    load: (id) => {
      const have = hair.bound.get(id);
      if (have) return Promise.resolve(have);
      return Promise.reject(
        new AssetFormatError(
          styles.has(id)
            ? `hair style ${id} was loaded without a way to fetch it (addHairStyle adds its bytes)`
            : `no hair style ${id}`,
        ),
      );
    },
  };
  return hair;
}

/**
 * Adds one hair style's geometry (its binary, decompressed) to assets that
 * have a hair pack. The assets change only if the bytes parse, so a failed add
 * can be retried.
 */
export function addHairStyle(assets: HumanoidAssets, id: string, bin: ArrayBuffer): BoundAsset {
  const entry = assets.hair?.styles.get(id);
  if (!assets.hair || !entry) throw new AssetFormatError(`no hair style ${id} in the loaded packs`);
  const have = assets.hair.bound.get(id);
  if (have) return have;
  const what = (field: string) => `hair style ${id} ${field}`;
  const l = entry.layout;
  // One occlusion value per control vertex, at rest, rather than a body attachment's eight corners.
  const occlusion = view(Uint8Array, bin, l.occlusion, what("occlusion"));
  expectLength(occlusion, entry.vertexCount, what("occlusion"));
  const base: BoundAsset = {
    entry,
    ...readBinding(entry, bin, assets.manifest.vertexCount, what),
    occlusion,
  };
  // Brows and lashes are decals: nothing measured of strands or a scalp.
  if (!STRAND_KINDS.includes(entry.kind)) {
    for (const key of [...HAIR_FIELD_KEYS, ...CARD_FIELD_KEYS])
      if (l[key])
        throw new AssetFormatError(what(`${key}: a ${entry.kind} style has no scalp fields`));
    assets.hair.bound.set(id, base);
    return base;
  }
  // Only body hair cards carry ranks.
  const cards = entry.kind === "beard";
  if (!cards && l.rank) throw new AssetFormatError(what("rank: only body hair cards have ranks"));
  if (cards && !l.rank) throw new AssetFormatError(what("rank is missing"));
  const field = (key: (typeof HAIR_FIELD_KEYS)[number]): BufferRange => {
    const range = l[key];
    if (!range) throw new AssetFormatError(what(`${key} is missing`));
    return range;
  };
  const hair: HairFieldData = {
    growth: view(Uint16Array, bin, field("growth"), what("growth")),
    uvScale: view(Uint16Array, bin, field("uvScale"), what("uvScale")),
    fade: view(Uint8Array, bin, field("fade"), what("fade")),
    fin: view(Uint8Array, bin, field("fin"), what("fin")),
    scalpVerts: view(Uint16Array, bin, field("scalpVerts"), what("scalpVerts")),
    scalpWeights: view(Uint8Array, bin, field("scalpWeights"), what("scalpWeights")),
    ...(l.rank && { rank: view(Uint8Array, bin, l.rank, what("rank")) }),
  };
  if (hair.rank) expectLength(hair.rank, entry.vertexCount, what("rank"));
  expectLength(hair.growth, entry.vertexCount, what("growth"));
  expectLength(hair.uvScale, entry.vertexCount, what("uvScale"));
  expectLength(hair.fade, entry.vertexCount, what("fade"));
  expectLength(hair.fin, entry.vertexCount, what("fin"));
  expectLength(hair.scalpWeights, hair.scalpVerts.length, what("scalpWeights"));
  expectIndices(hair.scalpVerts, assets.manifest.vertexCount, what("scalpVerts"));
  const asset: BoundAsset = { ...base, hair };
  assets.hair.bound.set(id, asset);
  return asset;
}

/**
 * Merges slider taxonomies: tasks and groups are matched by id, and every
 * group's sliders, every task's groups and the tasks themselves end up in
 * MakeHuman's order. Inputs are not modified.
 */
export function mergeSliderTasks(...sources: SliderTask[][]): SliderTask[] {
  const tasks = new Map<string, SliderTask>();
  for (const source of sources) {
    for (const t of source) {
      let task = tasks.get(t.id);
      if (!task) {
        task = { ...t, groups: [] };
        tasks.set(t.id, task);
      }
      for (const g of t.groups) {
        const group = task.groups.find((x) => x.id === g.id);
        if (group) group.sliders.push(...g.sliders.map((s) => ({ ...s })));
        else task.groups.push({ ...g, sliders: g.sliders.map((s) => ({ ...s })) });
      }
    }
  }
  const first = (g: SliderGroup) => Math.min(...g.sliders.map((s) => s.order));
  for (const task of tasks.values()) {
    for (const g of task.groups) g.sliders.sort((a, b) => a.order - b.order);
    task.groups.sort((a, b) => first(a) - first(b));
  }
  return [...tasks.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Builds typed views over already-fetched packs. Pure; usable in workers and
 * tests. Target files left out of `pack.targets` (and the adult pack's, if
 * its `targets` is left out) are pending, and `addTargetFiles` adds them later.
 * `clothing` is one clothing pack or a list of them; a pack whose `garments`
 * is left out stays pending until `addGarments` adds them.
 */
export function parseHumanoidAssets(
  pack: BodyPackData,
  adultAnatomy?: AdultAnatomyData,
  clothing?: ClothingPackData | readonly ClothingPackData[],
  hair?: HairPackData,
): HumanoidAssets {
  const { manifest, body, targets } = pack;
  if (manifest.format !== 1 || manifest.kind !== "body")
    throw new AssetFormatError("not a format-1 body pack manifest");
  const clothingPacks: readonly ClothingPackData[] =
    clothing === undefined ? [] : "manifest" in clothing ? [clothing] : clothing;
  checkClothingPacks(
    manifest,
    clothingPacks.map((c) => c.manifest),
  );
  const { layout } = manifest.body;
  const positions = view(Float32Array, body, layout.positions, "body positions");
  if (positions.length !== manifest.vertexCount * 3) {
    throw new AssetFormatError(
      `expected ${manifest.vertexCount * 3} position floats, got ${positions.length}`,
    );
  }
  const map = new Map<string, SparseTarget>();
  const modifiers = new Map(manifest.modifiers.map((m) => [m.id, m] as const));
  if (adultAnatomy) {
    const a = adultAnatomy.manifest;
    if (a.format !== 1 || a.kind !== "adult-anatomy")
      throw new AssetFormatError("not a format-1 adult anatomy manifest");
    if (a.topology !== manifest.topology || a.bodySha256 !== manifest.body.sha256) {
      throw new AssetFormatError("the adult anatomy pack was built for a different body pack");
    }
    checkAdultCoatRegions(a.anatomy?.coatRegions ?? [], manifest.vertexCount);
    checkAdultPiercingSites(a.anatomy);
    checkAdultGates(a, manifest);
    checkAnatomyDefaults(a.anatomy, a.modifiers);
    for (const m of a.modifiers) modifiers.set(m.id, m);
  }
  // Merging also orders tasks by sortOrder; the manifest keeps upstream's file order.
  const sliders = adultAnatomy
    ? mergeSliderTasks(manifest.sliders, adultAnatomy.manifest.sliders)
    : mergeSliderTasks(manifest.sliders);
  for (const t of sliders)
    for (const g of t.groups)
      for (const s of g.sliders)
        if (s.kind === "modifier" ? !modifiers.has(s.id) : !MACRO_KEYS.has(s.id))
          throw new AssetFormatError(`slider ${s.id} drives nothing in the loaded packs`);
  const uvs = view(Float32Array, body, layout.uvs, "body uvs");
  const faceVerts = view(Uint32Array, body, layout.faceVerts, "body faceVerts");
  const faceUvs = view(Uint32Array, body, layout.faceUvs, "body faceUvs");
  const skinIndex = view(Uint8Array, body, layout.skinIndex, "body skinIndex");
  const skinWeight = view(Float32Array, body, layout.skinWeight, "body skinWeight");
  expectLength(uvs, manifest.uvCount * 2, "body uvs");
  expectLength(faceVerts, manifest.faceCount * 4, "body faceVerts");
  expectLength(faceUvs, manifest.faceCount * 4, "body faceUvs");
  expectLength(skinIndex, manifest.vertexCount * SKIN_INFLUENCES, "body skinIndex");
  expectLength(skinWeight, manifest.vertexCount * SKIN_INFLUENCES, "body skinWeight");
  expectIndices(faceVerts, manifest.vertexCount, "body faceVerts");
  expectIndices(faceUvs, manifest.uvCount, "body faceUvs");
  expectIndices(skinIndex, manifest.skeleton.bones.length, "body skinIndex");
  const assets: HumanoidAssets = {
    manifest,
    positions,
    uvs,
    faceVerts,
    faceUvs,
    skinIndex,
    skinWeight,
    targets: map,
    modifiers,
    sliders,
    attachments: parseAttachments(manifest, pack.attachments),
    hair: hair ? parseHairPack(manifest, hair) : null,
    garments: new Map(),
    clothingManifests: clothingPacks.map((c) => c.manifest),
    pendingGarmentPacks: new Set(clothingPacks.keys()),
    proxies: new Map(),
    loadProxies: null,
    bodyOcclusion: manifest.bodyOcclusion
      ? parseBodyOcclusion(
          manifest.bodyOcclusion,
          pack.bodyOcclusion ??
            fail(
              `the manifest lists ${manifest.bodyOcclusion.file} but the pack data has no bytes for it`,
            ),
          manifest.vertexCount,
        )
      : null,
    fileUrls: pack.fileUrls ?? new Map(),
    adultAnatomyLoaded: adultAnatomy !== undefined,
    adultAnatomyManifest: adultAnatomy?.manifest ?? null,
    targetFilesPending: new Set(targetFiles(manifest, adultAnatomy?.manifest).map((f) => f.id)),
    targetFileOf: new Map(
      targetFiles(manifest, adultAnatomy?.manifest).flatMap((f) =>
        f.entries.map((e) => [e.name, f.id] as const),
      ),
    ),
  };
  if (!targets.core) throw new AssetFormatError("the body pack's core targets are required");
  addTargetFiles(assets, {
    ...targets,
    ...(adultAnatomy?.targets && { [ADULT_TARGET_FILE]: adultAnatomy.targets }),
  });
  clothingPacks.forEach((c, i) => {
    if (c.garments) addGarments(assets, i, c.garments);
  });
  if (pack.proxies) addProxies(assets, pack.proxies);
  return assets;
}

/**
 * Adds the body pack's proxy bodies (its decompressed proxy file) to the
 * assets. The assets change only if every proxy checks, so a failed add can be
 * retried; adding them again is an error.
 */
export function addProxies(assets: HumanoidAssets, bin: ArrayBuffer): Map<string, BoundProxy> {
  const listed = assets.manifest.proxies;
  if (!listed) throw new AssetFormatError("the body pack has no proxies");
  if (assets.proxies.size) throw new AssetFormatError("the proxies are already loaded");
  const out = new Map<string, BoundProxy>();
  for (const entry of listed.entries) {
    if (out.has(entry.id)) throw new AssetFormatError(`duplicate proxy ${entry.id}`);
    out.set(entry.id, {
      entry,
      ...readBinding(entry, bin, assets.manifest.vertexCount, (f) => `proxy ${entry.id} ${f}`),
    });
  }
  for (const [id, p] of out) assets.proxies.set(id, p);
  return assets.proxies;
}

/**
 * Checks clothing manifests against their body pack and each other: each is a
 * format-1 clothing pack built for this body, and no garment id is taken by an
 * attachment or by a garment of another pack.
 */
function checkClothingPacks(body: BodyManifest, packs: readonly ClothingManifest[]): void {
  const attachments = new Set(body.attachments.entries.map((a) => a.id));
  const packOf = new Map<string, number>();
  packs.forEach((c, i) => {
    const which = packs.length === 1 ? "the clothing pack" : `clothing pack ${i}`;
    if (c.format !== 1 || c.kind !== "clothing")
      throw new AssetFormatError(`${which} is not a format-1 clothing manifest`);
    if (c.topology !== body.topology || c.bodySha256 !== body.body.sha256)
      throw new AssetFormatError(`${which} was built for a different body pack`);
    for (const g of c.garments.entries) {
      if (attachments.has(g.id))
        throw new AssetFormatError(`garment ${g.id} is also an attachment`);
      if (g.rigid !== undefined && typeof g.rigid !== "boolean")
        throw new AssetFormatError(`garment ${g.id}: rigid must be true or false`);
      const other = packOf.get(g.id);
      if (other !== undefined && other !== i)
        throw new AssetFormatError(`garment ${g.id} is in clothing packs ${other} and ${i}`);
      packOf.set(g.id, i);
    }
  });
}

/**
 * Adds clothing pack `pack`'s garments (its decompressed binary) to assets
 * parsed with its manifest. The assets change only if every garment checks, so
 * a failed add can be retried.
 */
export function addGarments(assets: HumanoidAssets, pack: number, bin: ArrayBuffer): void {
  const manifest = assets.clothingManifests[pack];
  if (!manifest)
    throw new AssetFormatError(
      assets.clothingManifests.length === 0
        ? "no clothing pack is loaded"
        : `there is no clothing pack ${pack}`,
    );
  if (!assets.pendingGarmentPacks.has(pack))
    throw new AssetFormatError(`clothing pack ${pack}'s garments are already loaded`);
  for (const [id, g] of parseGarments(manifest, assets.manifest.vertexCount, bin))
    assets.garments.set(id, g);
  assets.pendingGarmentPacks.delete(pack);
}

/** Every target file of a body pack and, if given, an adult anatomy pack. */
function targetFiles(body: BodyManifest, adult?: AdultAnatomyManifest): TargetFile[] {
  const ids = body.targets.map((f) => f.id).join(",");
  if (ids !== BODY_TARGET_FILES.join(","))
    throw new AssetFormatError(`body target files are ${ids}, expected ${BODY_TARGET_FILES}`);
  return adult ? [...body.targets, adult.targets] : body.targets;
}

/**
 * Adds target files (decompressed, by id) to parsed assets as they arrive.
 * Each id must be a pending file of the loaded packs. The assets change only
 * if every target decodes, so a failed add can be retried.
 */
export function addTargetFiles(assets: HumanoidAssets, files: TargetFileData): void {
  const { manifest, targets } = assets;
  const all = targetFiles(manifest, assets.adultAnatomyManifest ?? undefined);
  const added = new Map<string, SparseTarget>();
  const ids: string[] = [];
  const detail = new Set(assets.adultAnatomyManifest?.anatomy?.detail?.targets);
  for (const [id, bin] of Object.entries(files)) {
    if (!bin) continue;
    const file = all.find((f) => f.id === id);
    if (!file) throw new AssetFormatError(`no target file ${id} in the loaded packs`);
    if (!assets.targetFilesPending.has(id))
      throw new AssetFormatError(`target file ${id} is already loaded`);
    addTargets(added, file, bin, `target file ${id}`, manifest.vertexCount, targets, detail);
    ids.push(id);
  }
  for (const [name, t] of added) targets.set(name, t);
  for (const id of ids) assets.targetFilesPending.delete(id);
}

/**
 * The targets a list of target names needs that have not arrived, by the
 * file each is in; a name in no loaded pack's files is reported under "".
 */
export function pendingTargetFiles(assets: HumanoidAssets, names: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const name of names) {
    if (assets.targets.has(name)) continue;
    out.add(assets.targetFileOf.get(name) ?? "");
  }
  return out;
}

/** How a loader requests a file: the platform's `fetch` fits, and so does a host's own. */
export type FetchLike = (url: string) => Promise<Response>;

/** The part of `node:fs/promises` the `file:` reading uses. */
interface NodeFileSystem {
  readFile(url: URL): Promise<BodyInit>;
}

const isNode = (): boolean =>
  (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node !==
  undefined;

/**
 * Reads a `file:` URL from disk as a `Response` (a missing file answers 404).
 * Node's `fetch` does not implement the scheme, and a pack package imported in
 * Node exports exactly such URLs. The module is imported by a name no bundler
 * can see, so a browser build never resolves it and nothing here is reachable
 * there: `fetchOk` only comes here when running in Node.
 */
async function readFileUrl(url: string): Promise<Response> {
  const specifier = "node:fs/promises";
  const { readFile } = (await import(
    /* @vite-ignore */ /* webpackIgnore: true */ specifier
  )) as NodeFileSystem;
  try {
    return new Response(await readFile(new URL(url)));
  } catch (e) {
    if ((e as { code?: string }).code === "ENOENT")
      return new Response(null, { status: 404, statusText: "Not Found" });
    throw e;
  }
}

/**
 * Requests `url` with `fetcher` when the host gave one. Otherwise the platform's
 * `fetch`, except a `file:` URL in Node, which is read from disk.
 */
export async function fetchOk(url: string, fetcher?: FetchLike): Promise<Response> {
  const res = await (
    fetcher ?? (url.startsWith("file:") && isNode() ? readFileUrl : (u: string) => fetch(u))
  )(url);
  if (!res.ok)
    throw new AssetFormatError(`fetching ${url} failed: ${res.status} ${res.statusText}`);
  return res;
}

/**
 * Where a pack's files are served from: either a directory URL holding
 * `manifest.json` and the binaries, or the explicit per-file URLs that the
 * pack packages export (which bundlers emit automatically).
 */
export type PackLocation =
  | string
  | { readonly manifest: string; readonly files: Readonly<Record<string, string>> };

export function packResolver(pack: PackLocation): {
  manifest: string;
  file: (name: string) => string;
} {
  if (typeof pack === "string") {
    const base = pack.endsWith("/") ? pack : `${pack}/`;
    return { manifest: `${base}manifest.json`, file: (name) => base + name };
  }
  return {
    manifest: pack.manifest,
    file: (name) => {
      const url = pack.files[name];
      if (!url) throw new AssetFormatError(`pack has no URL for ${name}`);
      return url;
    },
  };
}

/**
 * Which packs to load, as plain data (it crosses to the worker, which cannot
 * be sent a function); `LoadOptions` adds how to fetch them.
 */
export interface LoadPacks {
  /** The body pack, e.g. `bodyPack` from `humanoid-kit-body`. */
  body: PackLocation;
  /** The adult anatomy pack. Its targets only evaluate for figures aged 18+. */
  adultAnatomy?: PackLocation;
  /**
   * The clothing pack (`humanoid-kit-clothing`), or a list of clothing packs
   * (the kit's and a consumer's own). Their manifests load with the first
   * stage and their garments binaries together in a later one
   * (`garmentsFile(i)` for pack `i`), so a figure that wears nothing is never
   * held up by them. Garment ids must be unique across the packs, and two
   * packs must not name one texture file at different URLs.
   */
  clothing?: PackLocation | readonly PackLocation[];
  /**
   * The hair pack. Only its manifest loads up front; each style's geometry and
   * texture are fetched when a figure first wears it (`HairAssets.load`).
   */
  hair?: PackLocation;
  /**
   * The age of the first figure to show, so a staged load brings its targets
   * first (`targetLoadOrder`). Default: the default figure's.
   */
  firstFigureAge?: number;
}

export interface LoadOptions extends LoadPacks {
  /**
   * How every file is requested. Default: the platform's `fetch`, and in Node a
   * `file:` URL (what a pack package exports there) read from disk, which
   * Node's `fetch` cannot do. Supplied, it is used for every request.
   */
  fetch?: FetchLike;
}

/** A later stage of a staged load: target files that arrive after the first figure. */
export interface LoadStage {
  /** Target file ids this stage adds. */
  files: string[];
  /** Resolves with the same assets once they are added, or rejects with why they failed. */
  loaded: Promise<HumanoidAssets>;
}

export interface StagedHumanoidAssets {
  /** The first stage: the body, attachments, core targets and the first figure's age anchors. */
  assets: HumanoidAssets;
  /** The rest, in load order (`targetLoadOrder`); a failed stage fails only itself. */
  stages: LoadStage[];
  /** Resolves once every stage has loaded, or rejects with the first failure. */
  complete: Promise<HumanoidAssets>;
}

/** Some hosts serve `.gz` files with `Content-Encoding: gzip`, so the browser has
 * already decompressed them; only data that still starts with gzip's magic is decoded. */
export const fetchGzip = (url: string, fetcher?: FetchLike) =>
  fetchOk(url, fetcher)
    .then((r) => r.arrayBuffer())
    .then((b) => {
      const head = new Uint8Array(b, 0, Math.min(2, b.byteLength));
      return head[0] === 0x1f && head[1] === 0x8b ? gunzip(b) : b;
    });

/**
 * The order target files load in for a first figure of `age` years: its own
 * age anchors with the core; then the body's modifier targets, which every
 * shape slider, randomised or saved figure needs; then the other age anchors,
 * neighbours first; then the adult pack's targets, last and alone, so a
 * failure there never costs the body anything.
 */
export function targetLoadOrder(age: number): string[][] {
  const own = ageAnchorsOf(age);
  const anchors = AGE_ANCHORS.map((a) => a.anchor as AgeAnchor);
  const ownIndex = own.map((a) => anchors.indexOf(a));
  // Neighbouring anchors first: any drag of the age slider past the figure's
  // own anchors needs a neighbour, and the far ones only after a long drag.
  // Equal steps away, the anchor nearer in years goes first.
  const steps = (a: AgeAnchor) =>
    Math.min(...ownIndex.map((i) => Math.abs(anchors.indexOf(a) - i)));
  const years = (a: AgeAnchor) =>
    Math.abs(age - (AGE_ANCHORS[anchors.indexOf(a)] as (typeof AGE_ANCHORS)[number]).years);
  const rest = anchors
    .filter((a) => !own.includes(a))
    .sort((p, q) => steps(p) - steps(q) || years(p) - years(q));
  // Pack files keep MakeHuman's names for the age bodies (`targets-young`).
  const file = upstreamAgeAnchor;
  return [
    ["core", ...own.map(file)],
    ["modifiers"],
    ...rest.map((a) => [file(a)]),
    [ADULT_TARGET_FILE],
  ];
}

/**
 * Fetches and parses the packs in stages over one link (`targetLoadOrder`).
 * It resolves with the first stage, which holds everything a figure of
 * `options.firstFigureAge` needs; each later stage starts fetching when the
 * previous one's bytes have arrived, so none competes with the stage before it.
 */
export async function loadHumanoidAssetsStaged(
  options: LoadOptions,
): Promise<StagedHumanoidAssets> {
  const hostFetch = options.fetch;
  const body = packResolver(options.body);
  const adult = options.adultAnatomy === undefined ? undefined : packResolver(options.adultAnatomy);
  const clothing = (
    options.clothing === undefined
      ? []
      : typeof options.clothing === "string" || "manifest" in options.clothing
        ? [options.clothing]
        : options.clothing
  ).map(packResolver);
  const hairPack = options.hair === undefined ? undefined : packResolver(options.hair);
  const [manifest, adultManifest, clothingManifests, hairManifest] = await Promise.all([
    fetchOk(body.manifest, hostFetch).then((r) => r.json() as Promise<BodyManifest>),
    adult &&
      fetchOk(adult.manifest, hostFetch).then((r) => r.json() as Promise<AdultAnatomyManifest>),
    Promise.all(
      clothing.map((c) =>
        fetchOk(c.manifest, hostFetch).then((r) => r.json() as Promise<ClothingManifest>),
      ),
    ),
    hairPack &&
      fetchOk(hairPack.manifest, hostFetch).then((r) => r.json() as Promise<HairManifest>),
  ]);
  const garmentFiles = clothing.map((_, i) => garmentsFile(i));
  const urlOf = (id: string): string | null => {
    const garmentPack = garmentFiles.indexOf(id);
    if (garmentPack >= 0) {
      const m = clothingManifests[garmentPack] as ClothingManifest;
      return (clothing[garmentPack] as ReturnType<typeof packResolver>).file(m.garments.file);
    }
    if (id === ADULT_TARGET_FILE)
      return adult && adultManifest ? adult.file(adultManifest.targets.file) : null;
    const f = manifest.targets.find((t) => t.id === id);
    if (!f) throw new AssetFormatError(`the body pack has no target file ${id}`);
    return body.file(f.file);
  };
  /** Fetches a stage's files (skipping the adult file without an adult pack). */
  const fetchFiles = async (ids: string[]): Promise<TargetFileData> => {
    const present = ids.flatMap((id) => {
      const url = urlOf(id);
      return url ? [[id, url] as const] : [];
    });
    const bins = await Promise.all(present.map(([, url]) => fetchGzip(url, hostFetch)));
    return Object.fromEntries(present.map(([id], i) => [id, bins[i]]));
  };
  const [first, ...order] = targetLoadOrder(options.firstFigureAge ?? DEFAULT_MACROS.age);
  // The garments follow the body's modifier targets: every figure that is shaped
  // needs those, and a figure that wears nothing never waits for the garments.
  const later =
    garmentFiles.length > 0 ? [order[0] as string[], garmentFiles, ...order.slice(1)] : order;
  const [bodyBin, attachments, bodyOcclusion, firstTargets] = await Promise.all([
    fetchGzip(body.file(manifest.body.file), hostFetch),
    fetchGzip(body.file(manifest.attachments.file), hostFetch),
    manifest.bodyOcclusion
      ? fetchGzip(body.file(manifest.bodyOcclusion.file), hostFetch)
      : undefined,
    fetchFiles(first as string[]),
  ]);
  const fileUrls = new Map<string, string>();
  for (const a of manifest.attachments.entries) {
    if (a.material.texture) fileUrls.set(a.material.texture, body.file(a.material.texture));
  }
  if (manifest.ageSurface)
    fileUrls.set(manifest.ageSurface.file, body.file(manifest.ageSurface.file));
  clothingManifests.forEach((m, i) => {
    const pack = clothing[i] as ReturnType<typeof packResolver>;
    for (const g of m.garments.entries) {
      for (const t of [g.material.texture, g.material.normalTexture]) {
        if (!t) continue;
        const url = pack.file(t);
        const had = fileUrls.get(t);
        // Textures are found by file name, so two packs must not name one file two ways.
        if (had !== undefined && had !== url)
          throw new AssetFormatError(`texture ${t} is at both ${had} and ${url}`);
        fileUrls.set(t, url);
      }
    }
  });
  if (hairPack && hairManifest) {
    for (const s of hairManifest.styles)
      if (s.material.texture) fileUrls.set(s.material.texture, hairPack.file(s.material.texture));
  }
  const assets = parseHumanoidAssets(
    {
      manifest,
      body: bodyBin,
      targets: firstTargets,
      attachments,
      ...(bodyOcclusion && { bodyOcclusion }),
      fileUrls,
    },
    adultManifest && { manifest: adultManifest },
    clothingManifests.map((m) => ({ manifest: m })),
    hairManifest && { manifest: hairManifest },
  );
  if (assets.hair && hairPack) {
    const hair = assets.hair;
    const fetching = new Map<string, Promise<BoundAsset>>();
    // Each style is fetched once; a failed fetch is forgotten, so a later wearer retries.
    hair.load = (id) => {
      const have = hair.bound.get(id);
      if (have) return Promise.resolve(have);
      const entry = hair.styles.get(id);
      if (!entry) return Promise.reject(new AssetFormatError(`no hair style ${id}`));
      let p = fetching.get(id);
      if (!p) {
        p = fetchGzip(hairPack.file(entry.file), hostFetch).then((bin) =>
          addHairStyle(assets, id, bin),
        );
        fetching.set(id, p);
        p.catch(() => fetching.delete(id));
      }
      return p;
    };
  }
  const proxyFile = manifest.proxies?.file;
  if (proxyFile) {
    let fetching: Promise<Map<string, BoundProxy>> | null = null;
    // Fetched on first use only: no figure on the live path needs a proxy.
    assets.loadProxies = () => {
      if (assets.proxies.size) return Promise.resolve(assets.proxies);
      if (!fetching) {
        fetching = fetchGzip(body.file(proxyFile)).then((bin) => addProxies(assets, bin));
        fetching.catch(() => {
          fetching = null;
        });
      }
      return fetching;
    };
  }
  // Each stage's bytes are fetched after the previous stage's settled; each is
  // added to the assets as soon as its own bytes are in. A failed stage fails
  // only itself: the next one still fetches. In the garments stage each
  // clothing pack also fails only itself: the packs that arrived and check are
  // added, and the stage rejects with the first failure.
  let bytesBefore: Promise<unknown> = Promise.resolve();
  const stages = later.map((files) => {
    const garmentIds = files.filter((id) => garmentFiles.includes(id));
    const targetIds = files.filter((id) => !garmentFiles.includes(id));
    const bytes = bytesBefore.then(() =>
      Promise.allSettled([fetchFiles(targetIds), ...garmentIds.map((id) => fetchFiles([id]))]),
    );
    bytesBefore = bytes;
    const loaded = bytes.then(([targets, ...garments]) => {
      const failures: unknown[] = [];
      garments.forEach((r, i) => {
        const id = garmentIds[i] as string;
        const bin = r.status === "fulfilled" ? r.value[id] : undefined;
        if (r.status === "rejected") failures.push(r.reason);
        else if (bin) {
          try {
            addGarments(assets, garmentFiles.indexOf(id), bin);
          } catch (e) {
            failures.push(e);
          }
        }
      });
      if (targets?.status === "rejected") failures.unshift(targets.reason);
      else if (targets) addTargetFiles(assets, targets.value);
      if (failures.length) throw failures[0];
      return assets;
    });
    // Observed here; callers that need a stage await it and see the failure.
    loaded.catch(() => {});
    return { files, loaded };
  });
  const complete = Promise.all(stages.map((s) => s.loaded)).then(() => assets);
  complete.catch(() => {});
  return { assets, stages, complete };
}

/** Fetches and parses the packs, every target file included. */
export async function loadHumanoidAssets(options: LoadOptions): Promise<HumanoidAssets> {
  return (await loadHumanoidAssetsStaged(options)).complete;
}

/**
 * Face indices of a named group from the base mesh (e.g. `body`, `helper-tights`).
 * Some group names repeat (eyelashes interleave), so ranges are merged.
 */
export function groupFaces(assets: HumanoidAssets, name: string): Uint32Array {
  const ranges = assets.manifest.groups.filter((x) => x.name === name);
  if (ranges.length === 0) throw new AssetFormatError(`no face group ${name}`);
  const out = new Uint32Array(ranges.reduce((n, r) => n + r.faceCount, 0));
  let k = 0;
  for (const r of ranges) for (let f = 0; f < r.faceCount; f++) out[k++] = r.faceStart + f;
  return out;
}

/** Centroid of a skeleton joint's vertex list over the given positions. */
export function jointPosition(
  assets: HumanoidAssets,
  positions: Float32Array,
  joint: string,
  out: Float32Array,
  o = 0,
): void {
  const verts = assets.manifest.skeleton.joints[joint];
  if (!verts || verts.length === 0) throw new AssetFormatError(`no joint ${joint}`);
  let x = 0;
  let y = 0;
  let z = 0;
  for (const v of verts) {
    x += positions[v * 3] ?? 0;
    y += positions[v * 3 + 1] ?? 0;
    z += positions[v * 3 + 2] ?? 0;
  }
  out[o] = x / verts.length;
  out[o + 1] = y / verts.length;
  out[o + 2] = z / verts.length;
}
