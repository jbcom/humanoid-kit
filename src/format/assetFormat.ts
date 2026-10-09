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
import { AGE_ANCHORS, ageAnchorsOf, DEFAULT_MACROS } from "../makehuman/macro.ts";
import type { StateMorph } from "../makehuman/stateMorphs.ts";
import type { AnatomyFeature } from "../recipe/anatomy.ts";

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
/** The id of the clothing pack's garments binary among a staged load's files. */
export const GARMENTS_FILE = "garments";

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

/** The kinds of entry the hair pack lists. */
export const HAIR_KINDS = ["scalp", "brows", "lashes"] as const;
export type HairKind = (typeof HAIR_KINDS)[number];

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
   * A scalp style's layout holds every `HAIR_FIELD_KEYS` buffer; a decal's
   * (`brows`, `lashes`) holds none, since it has no hairline, growth or scalp.
   */
  layout: AttachmentEntry["layout"] &
    Partial<Record<(typeof HAIR_FIELD_KEYS)[number], BufferRange>>;
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
  layout: Omit<AttachmentEntry["layout"], "occlusion">;
}

export interface BoundGarment extends Omit<BoundAsset, "entry" | "occlusion"> {
  entry: GarmentEntry;
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
}

/** A reservoir (`Reservoir` in src/build/reservoir.ts) with the id detail refers to it by. */
export interface AdultReservoirSpec {
  id: string;
  /** Vertices of the refinement mesh round the cap, in order. */
  loop: number[];
  /** Polygons of the refinement mesh that make the cap. */
  cap: number[];
  /** Collapsed rings between the loop and the cap. */
  rings: number;
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

/** Faces of the base body to refine and by how much: `levels[i]` for face `faces[i]`. */
export interface AdultSurfaceSpec {
  faces: number[];
  levels: number[];
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

export interface HumanoidAssets {
  manifest: BodyManifest;
  /** Base positions in metres, `vertexCount * 3`. */
  positions: Float32Array;
  uvs: Float32Array;
  /** Quad corner vertex indices, `faceCount * 4`. */
  faceVerts: Uint32Array;
  /** Quad corner UV indices, `faceCount * 4`. */
  faceUvs: Uint32Array;
  /** Up to four bone indices per vertex. */
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
   * The clothing pack's garments by id; empty without that pack and until its
   * binary has arrived (`garmentsPending`). The manifest lists them earlier.
   */
  garments: Map<string, BoundGarment>;
  /** The clothing pack's manifest, when that pack was loaded. */
  clothingManifest: ClothingManifest | null;
  /** True while the clothing pack is loaded but its garments binary has not arrived. */
  garmentsPending: boolean;
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
  /** URL of each pack file by name, when known (needed to load textures). */
  fileUrls?: Map<string, string>;
}

/**
 * The binding arrays every bound mesh has, read and checked against the base
 * mesh it binds to (`baseVertices` vertices).
 */
function readBinding(
  entry: GarmentEntry | AttachmentEntry,
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
  if (entry.kind !== "scalp") {
    for (const key of HAIR_FIELD_KEYS)
      if (l[key])
        throw new AssetFormatError(what(`${key}: a ${entry.kind} style has no scalp fields`));
    assets.hair.bound.set(id, base);
    return base;
  }
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
  };
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
 */
export function parseHumanoidAssets(
  pack: BodyPackData,
  adultAnatomy?: AdultAnatomyData,
  clothing?: ClothingPackData,
  hair?: HairPackData,
): HumanoidAssets {
  const { manifest, body, targets } = pack;
  if (manifest.format !== 1 || manifest.kind !== "body")
    throw new AssetFormatError("not a format-1 body pack manifest");
  if (clothing) {
    const c = clothing.manifest;
    if (c.format !== 1 || c.kind !== "clothing")
      throw new AssetFormatError("not a format-1 clothing manifest");
    if (c.topology !== manifest.topology || c.bodySha256 !== manifest.body.sha256) {
      throw new AssetFormatError("the clothing pack was built for a different body pack");
    }
    const taken = new Set(manifest.attachments.entries.map((a) => a.id));
    for (const g of c.garments.entries)
      if (taken.has(g.id)) throw new AssetFormatError(`garment ${g.id} is also an attachment`);
  }
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
  expectLength(skinIndex, manifest.vertexCount * 4, "body skinIndex");
  expectLength(skinWeight, manifest.vertexCount * 4, "body skinWeight");
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
    clothingManifest: clothing?.manifest ?? null,
    garmentsPending: clothing !== undefined,
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
  if (clothing?.garments) addGarments(assets, clothing.garments);
  return assets;
}

/**
 * Adds the clothing pack's garments (its decompressed binary) to assets parsed
 * with a clothing manifest. The assets change only if every garment checks, so
 * a failed add can be retried.
 */
export function addGarments(assets: HumanoidAssets, bin: ArrayBuffer): void {
  const manifest = assets.clothingManifest;
  if (!manifest) throw new AssetFormatError("no clothing pack is loaded");
  if (!assets.garmentsPending) throw new AssetFormatError("the garments are already loaded");
  for (const [id, g] of parseGarments(manifest, assets.manifest.vertexCount, bin))
    assets.garments.set(id, g);
  assets.garmentsPending = false;
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

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url);
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

function packResolver(pack: PackLocation): { manifest: string; file: (name: string) => string } {
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

export interface LoadOptions {
  /** The body pack, e.g. `bodyPack` from `humanoid-kit-body`. */
  body: PackLocation;
  /** The adult anatomy pack. Its targets only evaluate for figures aged 18+. */
  adultAnatomy?: PackLocation;
  /**
   * The clothing pack (`humanoid-kit-clothing`). Its manifest loads with the
   * first stage, its garments binary in a later one (`GARMENTS_FILE`), so a
   * figure that wears nothing is never held up by it.
   */
  clothing?: PackLocation;
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
const fetchGzip = (url: string) =>
  fetchOk(url)
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
  const anchors = AGE_ANCHORS.map(([a]) => a as string);
  const ownIndex = own.map((a) => anchors.indexOf(a));
  // Neighbouring anchors first: any drag of the age slider past the figure's
  // own anchors needs a neighbour, and the far ones only after a long drag.
  // Equal steps away, the anchor nearer in years goes first.
  const steps = (a: string) => Math.min(...ownIndex.map((i) => Math.abs(anchors.indexOf(a) - i)));
  const years = (a: string) => Math.abs((AGE_ANCHORS.find(([x]) => x === a)?.[1] ?? 0) - age);
  const rest = anchors
    .filter((a) => !own.includes(a as never))
    .sort((p, q) => steps(p) - steps(q) || years(p) - years(q));
  return [["core", ...own], ["modifiers"], ...rest.map((a) => [a]), [ADULT_TARGET_FILE]];
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
  const body = packResolver(options.body);
  const adult = options.adultAnatomy === undefined ? undefined : packResolver(options.adultAnatomy);
  const clothing = options.clothing === undefined ? undefined : packResolver(options.clothing);
  const hairPack = options.hair === undefined ? undefined : packResolver(options.hair);
  const [manifest, adultManifest, clothingManifest, hairManifest] = await Promise.all([
    fetchOk(body.manifest).then((r) => r.json() as Promise<BodyManifest>),
    adult && fetchOk(adult.manifest).then((r) => r.json() as Promise<AdultAnatomyManifest>),
    clothing && fetchOk(clothing.manifest).then((r) => r.json() as Promise<ClothingManifest>),
    hairPack && fetchOk(hairPack.manifest).then((r) => r.json() as Promise<HairManifest>),
  ]);
  const urlOf = (id: string): string | null => {
    if (id === GARMENTS_FILE)
      return clothing && clothingManifest ? clothing.file(clothingManifest.garments.file) : null;
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
    const bins = await Promise.all(present.map(([, url]) => fetchGzip(url)));
    return Object.fromEntries(present.map(([id], i) => [id, bins[i]]));
  };
  const [first, ...order] = targetLoadOrder(options.firstFigureAge ?? DEFAULT_MACROS.age);
  // The garments follow the body's modifier targets: every figure that is shaped
  // needs those, and a figure that wears nothing never waits for the garments.
  const later = clothingManifest
    ? [order[0] as string[], [GARMENTS_FILE], ...order.slice(1)]
    : order;
  const [bodyBin, attachments, bodyOcclusion, firstTargets] = await Promise.all([
    fetchGzip(body.file(manifest.body.file)),
    fetchGzip(body.file(manifest.attachments.file)),
    manifest.bodyOcclusion ? fetchGzip(body.file(manifest.bodyOcclusion.file)) : undefined,
    fetchFiles(first as string[]),
  ]);
  const fileUrls = new Map<string, string>();
  for (const a of manifest.attachments.entries) {
    if (a.material.texture) fileUrls.set(a.material.texture, body.file(a.material.texture));
  }
  for (const g of clothingManifest?.garments.entries ?? []) {
    for (const t of [g.material.texture, g.material.normalTexture])
      if (t) fileUrls.set(t, (clothing as ReturnType<typeof packResolver>).file(t));
  }
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
    clothingManifest && { manifest: clothingManifest },
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
        p = fetchGzip(hairPack.file(entry.file)).then((bin) => addHairStyle(assets, id, bin));
        fetching.set(id, p);
        p.catch(() => fetching.delete(id));
      }
      return p;
    };
  }
  // Each stage's bytes are fetched after the previous stage's settled; each is
  // added to the assets as soon as its own bytes are in. A failed stage fails
  // only itself: the next one still fetches.
  let bytesBefore: Promise<unknown> = Promise.resolve();
  const stages = later.map((files) => {
    const bytes = bytesBefore.then(() => fetchFiles(files));
    bytesBefore = bytes.catch(() => {});
    const loaded = bytes.then(({ [GARMENTS_FILE]: garments, ...targets }) => {
      addTargetFiles(assets, targets);
      if (garments) addGarments(assets, garments);
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
