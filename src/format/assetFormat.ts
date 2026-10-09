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
  attachments: { file: string; sha256: string; entries: AttachmentEntry[] };
  skeleton: { bones: BoneEntry[]; joints: Record<string, number[]> };
  faceUnits: { names: string[]; joints: BvhJoint[]; frames: number[][] };
}

export interface AttachmentMaterial {
  color: [number, number, number];
  roughness: number;
  /** File name of the diffuse texture within the pack, if any. */
  texture: string | null;
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
   * (`HumanoidModel.bakeAttachmentOcclusion`).
   */
  occlusion: Uint8Array;
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

function view<T extends Float32Array | Uint32Array | Uint8Array>(
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
    expectIndices(indices, vertexCount, `target ${e.name}`);
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
  /** URL of each pack file by name, when known (needed to load textures). */
  fileUrls?: Map<string, string>;
}

function parseAttachments(manifest: BodyManifest, bin: ArrayBuffer): Map<string, BoundAsset> {
  const out = new Map<string, BoundAsset>();
  for (const entry of manifest.attachments.entries) {
    const l = entry.layout;
    const what = (field: string) => `attachment ${entry.id} ${field}`;
    const asset: BoundAsset = {
      entry,
      refVerts: view(Uint32Array, bin, l.refVerts, what("refVerts")),
      weights: view(Float32Array, bin, l.weights, what("weights")),
      offsets: view(Float32Array, bin, l.offsets, what("offsets")),
      faceVerts: view(Uint32Array, bin, l.faceVerts, what("faceVerts")),
      faceUvs: view(Uint32Array, bin, l.faceUvs, what("faceUvs")),
      uvs: view(Float32Array, bin, l.uvs, what("uvs")),
      deleteVerts: view(Uint32Array, bin, l.deleteVerts, what("deleteVerts")),
      occlusion: view(Uint8Array, bin, l.occlusion, what("occlusion")),
    };
    expectLength(asset.refVerts, entry.vertexCount * 3, what("refVerts"));
    expectLength(asset.weights, entry.vertexCount * 3, what("weights"));
    expectLength(asset.offsets, entry.vertexCount * 3, what("offsets"));
    expectLength(asset.faceVerts, entry.faceCount * 4, what("faceVerts"));
    expectLength(asset.faceUvs, entry.faceCount * 4, what("faceUvs"));
    expectLength(asset.occlusion, entry.vertexCount, what("occlusion"));
    if (asset.uvs.length % 2 !== 0) throw new AssetFormatError(`${what("uvs")}: odd length`);
    expectIndices(asset.refVerts, manifest.vertexCount, what("refVerts"));
    expectIndices(asset.faceVerts, entry.vertexCount, what("faceVerts"));
    expectIndices(asset.faceUvs, asset.uvs.length / 2, what("faceUvs"));
    expectIndices(asset.deleteVerts, manifest.vertexCount, what("deleteVerts"));
    if (entry.scale) {
      for (const axis of ["x", "y", "z"] as const)
        expectIndices(entry.scale[axis].slice(0, 2), manifest.vertexCount, what(`${axis}_scale`));
    }
    out.set(entry.id, asset);
  }
  return out;
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
): HumanoidAssets {
  const { manifest, body, targets } = pack;
  if (manifest.format !== 1 || manifest.kind !== "body")
    throw new AssetFormatError("not a format-1 body pack manifest");
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
  return assets;
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
  for (const [id, bin] of Object.entries(files)) {
    if (!bin) continue;
    const file = all.find((f) => f.id === id);
    if (!file) throw new AssetFormatError(`no target file ${id} in the loaded packs`);
    if (!assets.targetFilesPending.has(id))
      throw new AssetFormatError(`target file ${id} is already loaded`);
    addTargets(added, file, bin, `target file ${id}`, manifest.vertexCount, targets);
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
  const [manifest, adultManifest] = await Promise.all([
    fetchOk(body.manifest).then((r) => r.json() as Promise<BodyManifest>),
    adult && fetchOk(adult.manifest).then((r) => r.json() as Promise<AdultAnatomyManifest>),
  ]);
  const urlOf = (id: string): string | null => {
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
  const [first, ...later] = targetLoadOrder(options.firstFigureAge ?? DEFAULT_MACROS.age);
  const [bodyBin, attachments, firstTargets] = await Promise.all([
    fetchGzip(body.file(manifest.body.file)),
    fetchGzip(body.file(manifest.attachments.file)),
    fetchFiles(first as string[]),
  ]);
  const fileUrls = new Map<string, string>();
  for (const a of manifest.attachments.entries) {
    if (a.material.texture) fileUrls.set(a.material.texture, body.file(a.material.texture));
  }
  const assets = parseHumanoidAssets(
    { manifest, body: bodyBin, targets: firstTargets, attachments, fileUrls },
    adultManifest && { manifest: adultManifest },
  );
  // Each stage's bytes are fetched after the previous stage's settled; each is
  // added to the assets as soon as its own bytes are in. A failed stage fails
  // only itself: the next one still fetches.
  let bytesBefore: Promise<unknown> = Promise.resolve();
  const stages = later.map((files) => {
    const bytes = bytesBefore.then(() => fetchFiles(files));
    bytesBefore = bytes.catch(() => {});
    const loaded = bytes.then((data) => {
      addTargetFiles(assets, data);
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
