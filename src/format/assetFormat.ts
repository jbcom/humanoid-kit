/**
 * The packed asset format written by `scripts/pack-makehuman.ts`.
 *
 * A body pack (`humanoid-kit-body`) has `manifest.json`, `body.bin.gz` (base
 * mesh, UVs, quad faces, skin weights), `attachments.bin.gz`, and its sparse
 * morph targets in two files: `targets.bin.gz` with what a first figure needs
 * (the macro and skin-mask targets) and `modifier-targets.bin.gz` with the
 * rest, which can arrive later. The adult anatomy pack
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
import { DEFAULT_MACROS } from "../makehuman/macro.ts";

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

export interface TargetFile {
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
  /** The targets a first figure needs: every macro target and the skin-mask targets. */
  targets: TargetFile;
  /** The remaining shape-modifier targets, loaded after the first figure. */
  modifierTargets: TargetFile;
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
    "refVerts" | "weights" | "offsets" | "faceVerts" | "faceUvs" | "uvs" | "deleteVerts",
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
  /**
   * Loaded targets: the body pack's first-figure targets, and once
   * `modifierTargetsLoaded`, its modifier targets and the adult pack's.
   */
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
  /** Whether the modifier targets (the body's and the adult pack's) are in `targets`. */
  modifierTargetsLoaded: boolean;
}

export class AssetFormatError extends Error {
  override name = "AssetFormatError";
}

function view<T extends Float32Array | Uint32Array | Uint8Array>(
  Ctor: { new (buffer: ArrayBuffer, offset: number, length: number): T; BYTES_PER_ELEMENT: number },
  buffer: ArrayBuffer,
  range: BufferRange,
): T {
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
   * The targets file, decompressed (`gunzip`). All of them are modifier
   * targets, so they arrive with the body's (see `addModifierTargets`).
   */
  targets?: ArrayBuffer;
}

export interface BodyPackData {
  manifest: BodyManifest;
  body: ArrayBuffer;
  /** The first-figure targets file, decompressed (`gunzip`). */
  targets: ArrayBuffer;
  /**
   * The modifier targets file, decompressed. Leave it out to build a figure
   * first and add it with `addModifierTargets` when it arrives.
   */
  modifierTargets?: ArrayBuffer;
  attachments: ArrayBuffer;
  /** URL of each pack file by name, when known (needed to load textures). */
  fileUrls?: Map<string, string>;
}

function parseAttachments(manifest: BodyManifest, bin: ArrayBuffer): Map<string, BoundAsset> {
  const out = new Map<string, BoundAsset>();
  for (const entry of manifest.attachments.entries) {
    const l = entry.layout;
    const asset: BoundAsset = {
      entry,
      refVerts: view(Uint32Array, bin, l.refVerts),
      weights: view(Float32Array, bin, l.weights),
      offsets: view(Float32Array, bin, l.offsets),
      faceVerts: view(Uint32Array, bin, l.faceVerts),
      faceUvs: view(Uint32Array, bin, l.faceUvs),
      uvs: view(Float32Array, bin, l.uvs),
      deleteVerts: view(Uint32Array, bin, l.deleteVerts),
    };
    const what = (field: string) => `attachment ${entry.id} ${field}`;
    expectLength(asset.refVerts, entry.vertexCount * 3, what("refVerts"));
    expectLength(asset.weights, entry.vertexCount * 3, what("weights"));
    expectLength(asset.offsets, entry.vertexCount * 3, what("offsets"));
    expectLength(asset.faceVerts, entry.faceCount * 4, what("faceVerts"));
    expectLength(asset.faceUvs, entry.faceCount * 4, what("faceUvs"));
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
 * tests. With `pack.modifierTargets` (and the adult pack's `targets`, when that
 * pack is given) the result is complete; without them it holds a figure's
 * first-stage targets, and `addModifierTargets` completes it later.
 */
export function parseHumanoidAssets(
  pack: BodyPackData,
  adultAnatomy?: AdultAnatomyData,
): HumanoidAssets {
  const { manifest, body, targets } = pack;
  if (manifest.format !== 1 || manifest.kind !== "body")
    throw new AssetFormatError("not a format-1 body pack manifest");
  const { layout } = manifest.body;
  const positions = view(Float32Array, body, layout.positions);
  if (positions.length !== manifest.vertexCount * 3) {
    throw new AssetFormatError(
      `expected ${manifest.vertexCount * 3} position floats, got ${positions.length}`,
    );
  }
  const map = new Map<string, SparseTarget>();
  addTargets(map, manifest.targets, targets, "the body pack", manifest.vertexCount);
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
  const uvs = view(Float32Array, body, layout.uvs);
  const faceVerts = view(Uint32Array, body, layout.faceVerts);
  const faceUvs = view(Uint32Array, body, layout.faceUvs);
  const skinIndex = view(Uint8Array, body, layout.skinIndex);
  const skinWeight = view(Float32Array, body, layout.skinWeight);
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
    modifierTargetsLoaded: false,
  };
  if (pack.modifierTargets) {
    addModifierTargets(assets, {
      body: pack.modifierTargets,
      ...(adultAnatomy?.targets && { adultAnatomy: adultAnatomy.targets }),
    });
  } else if (adultAnatomy?.targets) {
    throw new AssetFormatError(
      "the adult anatomy pack's targets are modifier targets; give them with the body's",
    );
  }
  return assets;
}

/**
 * Adds the modifier targets to assets parsed without them: the body pack's
 * `modifierTargets` file and, when the adult anatomy pack is loaded, its
 * targets file (both decompressed). The assets are changed only if every
 * target decodes, so a failed add can be retried.
 */
export function addModifierTargets(
  assets: HumanoidAssets,
  files: { body: ArrayBuffer; adultAnatomy?: ArrayBuffer },
): void {
  if (assets.modifierTargetsLoaded)
    throw new AssetFormatError("the modifier targets are already loaded");
  const adult = assets.adultAnatomyManifest;
  if (adult && !files.adultAnatomy)
    throw new AssetFormatError("the adult anatomy pack's targets must arrive with the body's");
  if (!adult && files.adultAnatomy)
    throw new AssetFormatError("there is no adult anatomy pack for these targets");
  const { manifest, targets } = assets;
  const added = new Map<string, SparseTarget>();
  addTargets(
    added,
    manifest.modifierTargets,
    files.body,
    "the body pack's modifier targets",
    manifest.vertexCount,
    targets,
  );
  if (adult && files.adultAnatomy)
    addTargets(
      added,
      adult.targets,
      files.adultAnatomy,
      "the adult anatomy pack",
      manifest.vertexCount,
      targets,
    );
  for (const [name, t] of added) targets.set(name, t);
  assets.modifierTargetsLoaded = true;
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
}

export interface StagedHumanoidAssets {
  /** A figure's worth of assets: every macro target, without the modifier targets. */
  assets: HumanoidAssets;
  /**
   * Resolves with the same `assets` once the modifier targets are added, or
   * rejects if they fail to load (the first stage stays usable).
   */
  modifierTargets: Promise<HumanoidAssets>;
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
 * Fetches and parses the packs in two stages. The first resolves with what a
 * figure built from macros needs; the modifier targets (about a fifth of the
 * bytes) are fetched only after the first stage's files have arrived, so they
 * never compete with it for bandwidth.
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
  const [bodyBin, targets, attachments] = await Promise.all([
    fetchGzip(body.file(manifest.body.file)),
    fetchGzip(body.file(manifest.targets.file)),
    fetchGzip(body.file(manifest.attachments.file)),
  ]);
  const later = Promise.all([
    fetchGzip(body.file(manifest.modifierTargets.file)),
    adult && adultManifest && fetchGzip(adult.file(adultManifest.targets.file)),
  ]);
  // Handled below; this keeps a first-stage failure from leaving it unobserved.
  later.catch(() => {});
  const fileUrls = new Map<string, string>();
  for (const a of manifest.attachments.entries) {
    if (a.material.texture) fileUrls.set(a.material.texture, body.file(a.material.texture));
  }
  const assets = parseHumanoidAssets(
    { manifest, body: bodyBin, targets, attachments, fileUrls },
    adultManifest && { manifest: adultManifest },
  );
  const modifierTargets = later.then(([bodyTargets, adultTargets]) => {
    addModifierTargets(assets, {
      body: bodyTargets,
      ...(adultTargets && { adultAnatomy: adultTargets }),
    });
    return assets;
  });
  return { assets, modifierTargets };
}

/** Fetches and parses the packs, modifier targets included. */
export async function loadHumanoidAssets(options: LoadOptions): Promise<HumanoidAssets> {
  return (await loadHumanoidAssetsStaged(options)).modifierTargets;
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
