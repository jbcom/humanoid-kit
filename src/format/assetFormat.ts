/**
 * The packed asset format written by `scripts/pack-makehuman.ts`.
 *
 * A body pack (`humanoid-kit-body`) has `manifest.json`, `body.bin` (base mesh,
 * UVs, quad faces, skin weights) and `targets.bin` (sparse morph targets). The
 * adult anatomy pack (`humanoid-kit-adult-anatomy`) has its own manifest and
 * targets, pinned to the body pack it was built against. Binaries are
 * little-endian and 4-byte aligned so typed-array views need no copies.
 */
import { DEFAULT_MACROS } from "../makehuman/macro.ts";

const MACRO_KEYS = new Set(Object.keys(DEFAULT_MACROS));

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
  offset: number;
  count: number;
  /** Metres per int16 step. */
  scale: number;
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
  targets: { file: string; sha256: string; entries: TargetEntry[] };
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
  targets: { file: string; sha256: string; entries: TargetEntry[] };
  modifiers: ShapeModifierEntry[];
  /** This pack's sliders, placed into the body pack's tasks and groups by id. */
  sliders: SliderTask[];
}

/** A sparse target as typed-array views into a targets binary. */
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
  /** Body targets, plus adult anatomy targets when that pack was loaded. */
  targets: Map<string, SparseTarget>;
  modifiers: Map<string, ShapeModifierEntry>;
  /** The slider taxonomy of every loaded pack, merged in MakeHuman's order. */
  sliders: SliderTask[];
  attachments: Map<string, BoundAsset>;
  /** URL of each pack file by name (textures included); empty when parsed without URLs. */
  fileUrls: Map<string, string>;
  adultAnatomyLoaded: boolean;
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

function addTargets(
  map: Map<string, SparseTarget>,
  entries: readonly TargetEntry[],
  bin: ArrayBuffer,
  what: string,
): void {
  for (const e of entries) {
    const idxBytes = Math.ceil((e.count * 2) / 4) * 4;
    if (e.offset + idxBytes + e.count * 6 > bin.byteLength)
      throw new AssetFormatError(`target ${e.name} exceeds ${what}`);
    if (map.has(e.name)) throw new AssetFormatError(`duplicate target ${e.name} in ${what}`);
    map.set(e.name, {
      name: e.name,
      indices: new Uint16Array(bin, e.offset, e.count),
      deltas: new Int16Array(bin, e.offset + idxBytes, e.count * 3),
      scale: e.scale,
    });
  }
}

export interface AdultAnatomyData {
  manifest: AdultAnatomyManifest;
  targets: ArrayBuffer;
}

export interface BodyPackData {
  manifest: BodyManifest;
  body: ArrayBuffer;
  targets: ArrayBuffer;
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

/** Builds typed views over already-fetched packs. Pure; usable in workers and tests. */
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
  addTargets(map, manifest.targets.entries, targets, "the body pack");
  const modifiers = new Map(manifest.modifiers.map((m) => [m.id, m] as const));
  if (adultAnatomy) {
    const a = adultAnatomy.manifest;
    if (a.format !== 1 || a.kind !== "adult-anatomy")
      throw new AssetFormatError("not a format-1 adult anatomy manifest");
    if (a.topology !== manifest.topology || a.bodySha256 !== manifest.body.sha256) {
      throw new AssetFormatError("the adult anatomy pack was built for a different body pack");
    }
    addTargets(map, a.targets.entries, adultAnatomy.targets, "the adult anatomy pack");
    for (const m of a.modifiers) modifiers.set(m.id, m);
  }
  const sliders = adultAnatomy
    ? mergeSliderTasks(manifest.sliders, adultAnatomy.manifest.sliders)
    : structuredClone(manifest.sliders);
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
  for (const t of map.values()) expectIndices(t.indices, manifest.vertexCount, `target ${t.name}`);
  return {
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
  };
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

/** Fetches and parses the packs. */
export async function loadHumanoidAssets(options: LoadOptions): Promise<HumanoidAssets> {
  const body = packResolver(options.body);
  const manifest = (await (await fetchOk(body.manifest)).json()) as BodyManifest;
  const bin = (url: string) => fetchOk(url).then((r) => r.arrayBuffer());
  const adult = options.adultAnatomy === undefined ? undefined : packResolver(options.adultAnatomy);
  const [bodyBin, targets, attachments, adultData] = await Promise.all([
    bin(body.file(manifest.body.file)),
    bin(body.file(manifest.targets.file)),
    bin(body.file(manifest.attachments.file)),
    adult === undefined
      ? Promise.resolve(undefined)
      : fetchOk(adult.manifest)
          .then((r) => r.json() as Promise<AdultAnatomyManifest>)
          .then(async (m) => ({ manifest: m, targets: await bin(adult.file(m.targets.file)) })),
  ]);
  const fileUrls = new Map<string, string>();
  for (const a of manifest.attachments.entries) {
    if (a.material.texture) fileUrls.set(a.material.texture, body.file(a.material.texture));
  }
  return parseHumanoidAssets(
    { manifest, body: bodyBin, targets, attachments, fileUrls },
    adultData,
  );
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
