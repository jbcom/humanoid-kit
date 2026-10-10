/**
 * Packs the CC0 MakeHuman hm08 base mesh, its morph targets, modifier tables
 * and slider taxonomy, the default skeleton, skin weights and facial pose
 * units into the binary layout the runtime loads (`src/format/assetFormat.ts`).
 *
 *   node scripts/pack-makehuman.ts <makehuman-data-dir> <system-assets-dir>
 *
 * The first argument is the `makehuman/data` directory of a checkout of
 * github.com/makehumancommunity/makehuman; the second is the extracted
 * "MakeHuman system assets" pack (makehuman_system_assets_cc0.zip), which
 * supplies the eyes, teeth and tongue every figure needs, and the scalp hair
 * that the hair pack (`scripts/lib/packHair.ts`) packs last, since it binds to
 * the body pack by hash. Only asset files are read (released CC0 in September
 * 2020); no MakeHuman code is used.
 *
 * All of MakeHuman's ages (baby, child, young, old) are packed. Adult anatomy
 * targets (genitals, bulge, pregnancy), with their modifiers and sliders, go to
 * the separate humanoid-kit-adult-anatomy pack, which the runtime loads only on
 * request and only evaluates for figures 18 and over.
 *
 * Height and proportion targets are kept for average muscle and weight only:
 * the dense per-muscle/weight variants triple the package size for a shape
 * difference the universal muscle/weight targets already carry.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import {
  type AdultAnatomySpec,
  type AdultReservoirSpec,
  BODY_TARGET_FILES,
  type BodyManifest,
  groupFaces,
  parseHumanoidAssets,
  type ShapeModifierEntry,
  TARGET_ENCODING,
} from "../src/format/assetFormat.ts";
import { macroTargetAgeAnchor, macroTargetNames } from "../src/makehuman/macro.ts";
import { STATE_MORPH_TARGETS } from "../src/makehuman/stateMorphs.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { OCCLUSION_KEYS, occlusionCorners } from "../src/rig/occlusionKeys.ts";
import { uvScale } from "../src/surface/layers.ts";
import { SKIN_LAYER_TARGETS } from "../src/surface/regions/index.ts";
import {
  ADULT_SPEC_TARGETS,
  ADULT_SPEC_UPSTREAM_MODIFIERS,
  adultAnatomySpec,
} from "./lib/adultAnatomySpec.ts";
import {
  AUTHORED_MODIFIERS,
  AUTHORED_PROVENANCE,
  addAuthoredSliders,
  authorControl,
  authorDetail,
} from "./lib/adultAuthored.ts";
import { ISLAND_LAYERS, ISLAND_SIZES, reservoirSpecs } from "./lib/adultReservoirs.ts";
import { authoredPoses } from "./lib/authoredPoses.ts";
import { parseBvh } from "./lib/bvh.ts";
import { compileAsset } from "./lib/compileAsset.ts";
import { AUTHORING_FIGURE } from "./lib/control/mound.ts";
import { reservoirRoot } from "./lib/detail/root.ts";
import { symmetrizeFaceUnits } from "./lib/faceUnits.ts";
import { NAIL_PLATES, VENDOR_BODYPARTS04 } from "./lib/nailPlates.ts";
import { packHair } from "./lib/packHair.ts";
import {
  writeAttachments,
  writeAttachmentTextures,
  writeBodyOcclusion,
  writePackEntry,
} from "./lib/packWriter.ts";
import { buildSliders } from "./lib/sliders.ts";
import { type EncodedTarget, encodeSparseTarget } from "./lib/targetEncoding.ts";
import { type TextureRecord, textureProvenance } from "./lib/textureSizing.ts";
import { bodyCoverage, placeIslands } from "./lib/uvIslands.ts";

const USAGE = "usage: node scripts/pack-makehuman.ts <makehuman-data-dir> <system-assets-dir>";
const DATA: string = (() => {
  const arg = process.argv[2];
  if (!arg) throw new Error(USAGE);
  return path.resolve(arg);
})();
const SYSTEM: string = (() => {
  const arg = process.argv[3];
  if (!arg) throw new Error(USAGE);
  return path.resolve(arg);
})();
/** Assets every figure carries, from the system assets pack: [id, kind, mhclo path, material override]. */
const ESSENTIALS: [string, string, string, string?][] = [
  ["eyes/high-poly", "eyes", "eyes/high-poly/high-poly.mhclo", "eyes/materials/brown.mhmat"],
  ["teeth/base", "teeth", "teeth/teeth_base/teeth_base.mhclo"],
  ["tongue/base", "tongue", "tongue/tongue01/tongue01.mhclo"],
];
const BODY_OUT = path.resolve(import.meta.dirname, "../packs/body/data");
const ADULT_OUT = path.resolve(import.meta.dirname, "../packs/adult-anatomy/data");
const HAIR_OUT = path.resolve(import.meta.dirname, "../packs/hair/data");
/** Compatibility key: every MakeHuman proxy, clothes and target asset binds to this topology. */
const TOPOLOGY = "makehuman-hm08";
/** Every binary ships gzipped: GitHub Pages and many hosts serve .bin uncompressed. */
const BODY_FILE = "body.bin.gz";
const TARGETS_FILE = "targets.bin.gz";
const ATTACHMENTS_FILE = "attachments.bin.gz";
const BODY_OCCLUSION_FILE = "body-occlusion.bin.gz";
/** MakeHuman units are decimetres; the runtime works in metres. */
const UNIT = 0.1;
/** MakeHuman's modifier tables, each with a `_modifiers`, `_sliders` and `_modifiers_desc` file. */
const MODIFIER_TABLES = ["modeling", "measurement", "bodyshapes"] as const;
/** Whole-body poses from MakeHuman's data/poses, each CC0 by its .meta. */
const BODY_POSES = ["tpose", "benchmark"] as const;

interface TargetEntry {
  name: string;
  offset: number;
  count: number;
  scale: number;
}

// ---------------------------------------------------------------- licence gate
/**
 * Every packed source file must prove it is CC0, from its own bytes:
 *  - text assets (`.obj`, `.target`) carry MakeHuman's "released as CC0" header;
 *  - JSON assets carry `"license": "CC0"`;
 *  - a pose BVH carries its licence in the `.meta` file beside it
 *    (`license CC0`);
 *  - the remaining kinds (modifier table, pose-unit BVH) have no per-file
 *    statement and are accepted only because the upstream LICENSE.md names
 *    their category under "released under CC0 1.0 Universal". That statement
 *    is checked verbatim below, so a changed upstream licence fails the pack.
 */
const REPO_LICENSE = path.resolve(DATA, "../../LICENSE.md");
const REPO_STATEMENT = "These assets have been released under CC0 1.0 Universal.";
const REPO_CATEGORIES: Record<string, string> = {
  ...Object.fromEntries(
    MODIFIER_TABLES.flatMap((t) => [
      [`modifiers/${t}_modifiers.json`, "* Targets and modifiers"],
      [`modifiers/${t}_sliders.json`, "* Targets and modifiers"],
      [`modifiers/${t}_modifiers_desc.json`, "* Targets and modifiers"],
    ]),
  ),
  "poseunits/face-poseunits.bvh": "* Poses and expressions",
};
const licenseEvidence: Record<string, string> = {};

/** An anatomy spec without its defaults (`AdultAnatomySpec.defaults`). */
function withoutDefaults(spec: AdultAnatomySpec): AdultAnatomySpec {
  const { defaults: _, ...rest } = spec;
  return rest;
}

function requireCc0(rel: string, text: string): void {
  if (/released as CC0/.test(text.slice(0, 2000))) {
    licenseEvidence[rel] ??= 'file header: "This asset was explicitly released as CC0"';
    return;
  }
  if (rel.endsWith(".json") || rel.endsWith(".mhskel") || rel.endsWith(".mhw")) {
    try {
      if ((JSON.parse(text) as { license?: string }).license === "CC0") {
        licenseEvidence[rel] = 'file metadata: "license": "CC0"';
        return;
      }
    } catch {
      // fall through to the repository statement
    }
  }
  if (rel.endsWith(".bvh")) {
    const meta = path.join(DATA, rel.replace(/\.bvh$/, ".meta"));
    if (fs.existsSync(meta) && /^license\s+CC0\s*$/m.test(fs.readFileSync(meta, "utf8"))) {
      licenseEvidence[rel] = 'sibling .meta: "license CC0"';
      return;
    }
  }
  const category = REPO_CATEGORIES[rel];
  if (category) {
    const repo = fs.readFileSync(REPO_LICENSE, "utf8").replace(/\s+/g, " ");
    if (repo.includes(category) && repo.includes(REPO_STATEMENT)) {
      licenseEvidence[rel] =
        `upstream LICENSE.md: "${category.slice(2)}" listed under "${REPO_STATEMENT}"`;
      return;
    }
  }
  throw new Error(`licence gate: ${rel} does not prove CC0`);
}

const read = (rel: string) => {
  const text = fs.readFileSync(path.join(DATA, rel), "utf8");
  requireCc0(rel, text);
  return text;
};

// ---------------------------------------------------------------- base mesh
function parseObj(text: string) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const faceVerts: number[] = [];
  const faceUvs: number[] = [];
  const groups: { name: string; faceStart: number; faceCount: number }[] = [];
  let current: { name: string; faceStart: number; faceCount: number } | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("v ")) {
      const [, x, y, z] = line.split(/\s+/);
      positions.push(Number(x) * UNIT, Number(y) * UNIT, Number(z) * UNIT);
    } else if (line.startsWith("vt ")) {
      const [, u, v] = line.split(/\s+/);
      uvs.push(Number(u), Number(v));
    } else if (line.startsWith("g ")) {
      current = { name: line.slice(2).trim(), faceStart: faceVerts.length / 4, faceCount: 0 };
      groups.push(current);
    } else if (line.startsWith("f ")) {
      const corners = line.split(/\s+/).slice(1);
      if (corners.length !== 4) throw new Error(`non-quad face: ${line}`);
      if (!current) throw new Error("face before any group");
      for (const c of corners) {
        const [vi, ti] = c.split("/");
        faceVerts.push(Number(vi) - 1);
        faceUvs.push(Number(ti) - 1);
      }
      current.faceCount++;
    }
  }
  return { positions, uvs, faceVerts, faceUvs, groups };
}

// ---------------------------------------------------------------- targets
function parseTarget(text: string) {
  const idx: number[] = [];
  const d: number[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [i, x, y, z] = line.split(/\s+/).map(Number);
    if (i === undefined || x === undefined || y === undefined || z === undefined)
      throw new Error(`bad target line: ${line}`);
    idx.push(i);
    d.push(x * UNIT, y * UNIT, z * UNIT);
  }
  // Ascending vertex order, so the packed index deltas stay small and non-negative.
  const order = idx.map((_, k) => k).sort((a, b) => (idx[a] as number) - (idx[b] as number));
  for (let k = 1; k < order.length; k++)
    if (idx[order[k] as number] === idx[order[k - 1] as number])
      throw new Error(`bad target: vertex ${idx[order[k] as number]} listed twice`);
  return {
    idx: order.map((k) => idx[k] as number),
    d: order.flatMap((k) => [d[k * 3] as number, d[k * 3 + 1] as number, d[k * 3 + 2] as number]),
  };
}

/** Targets that belong to the adult anatomy pack (a separate install). */
const isAdultPackTarget = (name: string) =>
  name.startsWith("genitals/") ||
  name.startsWith("pelvis/bulge-") ||
  name.startsWith("pelvis/mound-") ||
  name.startsWith("stomach/stomach-pregnant-");

/**
 * Modifiers that are age-gated (rejected below 18): exactly the adult pack's.
 * Everything in the body pack follows MakeHuman, which offers it at every age.
 */
const isAdultOnlyModifier = (hi: string) => isAdultPackTarget(hi);

/** Every target upstream ships, by name (path below `targets/` without extension). */
function listTargets(): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const ent of fs.readdirSync(path.join(DATA, rel), { withFileTypes: true })) {
      const child = `${rel}/${ent.name}`;
      if (ent.isDirectory()) {
        if (ent.name === "images" || ent.name === "expression") continue;
        walk(child);
      } else if (ent.name.endsWith(".target")) {
        out.push(child.replace(/^targets\//, "").replace(/\.target$/, ""));
      }
    }
  };
  walk("targets");
  return out.sort();
}

/**
 * Encodes targets by name. Upstream ships some targets that move nothing;
 * those are counted and left out.
 */
function encodeTargets(names: Iterable<string>) {
  const out = new Map<string, EncodedTarget>();
  let empty = 0;
  for (const name of names) {
    const { idx, d } = parseTarget(read(`targets/${name}.target`));
    if (idx.length === 0) {
      empty++;
      continue;
    }
    out.set(name, encodeSparseTarget(name, idx, d));
  }
  return { targets: out, empty };
}

/** Concatenates encoded targets, in name order, into one gzipped targets file. */
function writeTargetFile(targets: EncodedTarget[]) {
  const sorted = [...targets].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const entries: TargetEntry[] = [];
  const raw = new Uint8Array(sorted.reduce((n, t) => n + t.chunk.byteLength, 0));
  let offset = 0;
  for (const t of sorted) {
    entries.push({ name: t.name, offset, count: t.count, scale: t.scale });
    raw.set(t.chunk, offset);
    offset += t.chunk.byteLength;
  }
  // gzip output is deterministic here (zlib writes no timestamp), so packs are reproducible.
  return { bin: new Uint8Array(gzipSync(raw, { level: 9 })), raw, entries };
}

// ---------------------------------------------------------------- rig
interface MhSkel {
  bones: Record<
    string,
    { head: string; tail: string; parent: string | null; rotation_plane: string }
  >;
  joints: Record<string, number[]>;
  planes: Record<string, string[]>;
}

function packWeights(
  vertexCount: number,
  weights: Record<string, [number, number][]>,
  boneNames: string[],
) {
  const per: [number, number][][] = Array.from({ length: vertexCount }, () => []);
  for (const [bone, list] of Object.entries(weights)) {
    const bi = boneNames.indexOf(bone);
    if (bi < 0) throw new Error(`weight for unknown bone ${bone}`);
    for (const [v, w] of list) per[v]?.push([bi, w]);
  }
  const index = new Uint8Array(vertexCount * 4);
  const weight = new Float32Array(vertexCount * 4);
  for (let v = 0; v < vertexCount; v++) {
    const top = (per[v] ?? []).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((s, e) => s + e[1], 0);
    top.forEach(([b, w], k) => {
      index[v * 4 + k] = b;
      weight[v * 4 + k] = sum > 0 ? w / sum : 0;
    });
  }
  return { index, weight };
}

// ---------------------------------------------------------------- provenance
/** One line per licence-evidence kind with its file count; repo-level evidence names its files. */
function writeProvenance(
  dir: string,
  pack: string,
  commit: string,
  include: (file: string) => boolean,
  outputs: [string, string][],
  systemEvidence: Record<string, string> = {},
  vendorEvidence: Record<string, string> = {},
  authored: readonly string[] = [],
  textures: readonly TextureRecord[] = [],
): void {
  const group = (evidence: Record<string, string>, keep: (f: string) => boolean) => {
    const byKind = new Map<string, string[]>();
    for (const [file, ev] of Object.entries(evidence)) {
      if (!keep(file)) continue;
      byKind.set(ev, [...(byKind.get(ev) ?? []), file]);
    }
    return [...byKind].map(
      ([ev, files]) =>
        `- ${files.length} file(s) — ${ev}${files.length <= 4 ? `: ${files.join(", ")}` : ""}`,
    );
  };
  const system = Object.keys(systemEvidence).length
    ? [
        "",
        "Attachments come from the MakeHuman system assets pack (makehuman_system_assets_cc0.zip, listed as",
        '"System assets, shared under CC0" on the MakeHuman community asset packs page). Each file was checked the same way:',
        "",
        ...group(systemEvidence, () => true),
      ]
    : [];
  const vendor = Object.keys(vendorEvidence).length
    ? [
        "",
        "The nail plates are CC0 community meshes from MakeHuman's bodyparts04 pack, vendored in",
        "`vendor/makehuman-bodyparts04/` (see its PROVENANCE.md); each passed the licence rule's clause B with its",
        "captured asset page:",
        "",
        ...group(vendorEvidence, () => true),
      ]
    : [];
  const lines = [
    `# ${pack} data provenance`,
    "",
    "Generated by `scripts/pack-makehuman.ts`; do not edit.",
    "",
    `Source: github.com/makehumancommunity/makehuman at commit \`${commit}\`, directory \`makehuman/data\`.`,
    'Only asset data is used; no MakeHuman code. "MakeHuman" is the upstream project\'s name; this package is not',
    "affiliated with it, and CC0 does not license trademarks (CC0 1.0 §4a).",
    "",
    "Every packed source file was checked for CC0 from its own content before packing:",
    "",
    ...group(licenseEvidence, include),
    ...system,
    ...vendor,
    ...(authored.length
      ? [
          "",
          "Authored for this pack by code from the base mesh and published measurements, not read from any source file;",
          "dedicated to the public domain under CC0 1.0 with the rest of the pack. No third-party model, image,",
          "texture or target was opened, traced or copied for any of it:",
          "",
          ...authored,
        ]
      : []),
    "",
    ...(textures.length ? [...textureProvenance(textures), "## Outputs", ""] : []),
    "| Output | SHA-256 |",
    "| --- | --- |",
    ...outputs.map(([f, h]) => `| ${f} | \`${h}\` |`),
    "",
  ];
  fs.writeFileSync(path.join(dir, "PROVENANCE.md"), lines.join("\n"));
}

// ---------------------------------------------------------------- main
async function main() {
  fs.mkdirSync(BODY_OUT, { recursive: true });
  fs.mkdirSync(ADULT_OUT, { recursive: true });
  const obj = parseObj(read("3dobjs/base.obj"));
  const vertexCount = obj.positions.length / 3;
  if (vertexCount > 65535) throw new Error("vertex indices no longer fit uint16");

  // Body buffer: positions f32, uvs f32, faceVerts u32, faceUvs u32, skin index u8, skin weight f32.
  const skel = JSON.parse(read("rigs/default.mhskel")) as MhSkel;
  const boneNames = Object.keys(skel.bones);
  const mhw = JSON.parse(read("rigs/default_weights.mhw")) as {
    weights: Record<string, [number, number][]>;
  };
  const skin = packWeights(vertexCount, mhw.weights, boneNames);

  const parts: { key: string; bytes: Uint8Array }[] = [
    { key: "positions", bytes: new Uint8Array(new Float32Array(obj.positions).buffer) },
    { key: "uvs", bytes: new Uint8Array(new Float32Array(obj.uvs).buffer) },
    { key: "faceVerts", bytes: new Uint8Array(new Uint32Array(obj.faceVerts).buffer) },
    { key: "faceUvs", bytes: new Uint8Array(new Uint32Array(obj.faceUvs).buffer) },
    { key: "skinIndex", bytes: skin.index },
    { key: "skinWeight", bytes: new Uint8Array(skin.weight.buffer) },
  ];
  const layout: Record<string, { offset: number; byteLength: number }> = {};
  let size = 0;
  for (const p of parts) {
    size = Math.ceil(size / 4) * 4;
    layout[p.key] = { offset: size, byteLength: p.bytes.byteLength };
    size += p.bytes.byteLength;
  }
  const bodyRaw = new Uint8Array(size);
  for (const p of parts) bodyRaw.set(p.bytes, layout[p.key]?.offset ?? 0);
  // Gzipped for transfer (Pages serves .bin uncompressed); the layout is the decoded file's.
  fs.rmSync(path.join(BODY_OUT, "body.bin"), { force: true });
  const body = new Uint8Array(gzipSync(bodyRaw, { level: 9 }));
  fs.writeFileSync(path.join(BODY_OUT, BODY_FILE), body);

  // Shape modifiers: MakeHuman's modifier tables, by target name.
  const declared: ShapeModifierEntry[] = [];
  for (const table of MODIFIER_TABLES) {
    const groups = JSON.parse(read(`modifiers/${table}_modifiers.json`)) as {
      group: string;
      modifiers: { target?: string; min?: string; max?: string }[];
    }[];
    for (const g of groups) {
      for (const m of g.modifiers) {
        if (!m.target) continue; // macro variables are handled by the macro model
        const dir = g.group;
        const lo = m.min ? `${dir}/${m.target}-${m.min}` : null;
        const hi = m.max ? `${dir}/${m.target}-${m.max}` : `${dir}/${m.target}`;
        const id = m.min ? `${dir}/${m.target}-${m.min}|${m.max}` : `${dir}/${m.target}`;
        // A modifier lives in one pack; both of its targets must be in that pack.
        if (lo && isAdultPackTarget(lo) !== isAdultPackTarget(hi))
          throw new Error(`modifier ${id} spans the body and adult anatomy packs`);
        declared.push({ id, group: dir, lo, hi, adultOnly: isAdultOnlyModifier(hi) });
      }
    }
  }

  // Only targets something drives are packed: the macro combinations and the
  // modifiers' targets. Upstream ships others that nothing in MakeHuman applies.
  const macroNames = macroTargetNames();
  const upstream = listTargets();
  const wanted = new Set([
    ...macroNames,
    ...declared.flatMap((m) => (m.lo ? [m.lo, m.hi] : [m.hi])),
  ]);
  const undriven = upstream.filter((n) => !wanted.has(n));
  const encoded = encodeTargets(upstream.filter((n) => wanted.has(n)));
  const packed = encoded.targets;
  const modifiers = declared.filter((m) => packed.has(m.hi) && (!m.lo || packed.has(m.lo)));
  const unresolved = declared.filter((m) => !modifiers.includes(m)).map((m) => m.id);
  if (unresolved.length)
    console.warn(`unresolved modifiers (no packed target): ${unresolved.join(", ")}`);
  const driven = new Set([
    ...macroNames,
    ...modifiers.flatMap((m) => (m.lo ? [m.lo, m.hi] : [m.hi])),
  ]);
  const missingMasks = SKIN_LAYER_TARGETS.filter((n) => !driven.has(n) || !packed.has(n));
  if (missingMasks.length)
    throw new Error(`skin-layer targets not packed: ${missingMasks.join(", ")}`);
  // A body layer must not pull adult data into the body pack's core file, and
  // every target and modifier the adult anatomy spec names (written into the
  // adult manifest) must be one the adult pack ships.
  const adultInCore = SKIN_LAYER_TARGETS.filter(isAdultPackTarget);
  if (adultInCore.length)
    throw new Error(`body skin layers measure adult targets: ${adultInCore.join(", ")}`);
  const missingAdultTargets = ADULT_SPEC_TARGETS.filter(
    (n) => !isAdultPackTarget(n) || !driven.has(n) || !packed.has(n),
  );
  if (missingAdultTargets.length)
    throw new Error(
      `adult anatomy targets not in the adult pack: ${missingAdultTargets.join(", ")}`,
    );
  const adultModifierIds = new Set(
    modifiers.filter((m) => isAdultPackTarget(m.hi)).map((m) => m.id),
  );
  const missingAdultModifiers = ADULT_SPEC_UPSTREAM_MODIFIERS.filter(
    (id) => !adultModifierIds.has(id),
  );
  if (missingAdultModifiers.length)
    throw new Error(
      `adult anatomy modifiers not in the adult pack: ${missingAdultModifiers.join(", ")}`,
    );
  const missingStates = STATE_MORPH_TARGETS.filter((n) => !driven.has(n) || !packed.has(n));
  if (missingStates.length)
    throw new Error(`state-morph targets not packed: ${missingStates.join(", ")}`);

  // The body's targets split into files by what needs them (docs/ARCHITECTURE.md):
  // macro targets by age anchor, with the anchor-free ones and the skin-layer
  // targets in a small core file, and the other modifier targets last.
  const inPack = [...packed.values()].filter((t) => driven.has(t.name));
  const fileOf = (name: string): string => {
    if (macroNames.has(name)) return macroTargetAgeAnchor(name) ?? "core";
    return SKIN_LAYER_TARGETS.includes(name) ? "core" : "modifiers";
  };
  const bodyFiles = BODY_TARGET_FILES.map((id) => ({
    id,
    file: `targets-${id}.bin.gz`,
    ...writeTargetFile(inPack.filter((t) => !isAdultPackTarget(t.name) && fileOf(t.name) === id)),
  }));
  // The adult file is written once the figure it is authored against exists: the
  // targets the pack generates (scripts/lib/adultAuthored.ts) are placed on that
  // figure's mesh, which needs a model of the body and the control targets.
  const adultControl = inPack.filter((t) => isAdultPackTarget(t.name));
  for (const f of fs.readdirSync(BODY_OUT))
    if (/^(modifier-)?targets(-[a-z]+)?\.bin(\.gz)?$/.test(f)) fs.rmSync(path.join(BODY_OUT, f));
  fs.rmSync(path.join(ADULT_OUT, "targets.bin"), { force: true });
  for (const f of bodyFiles) fs.writeFileSync(path.join(BODY_OUT, f.file), f.bin);

  // Face pose units: BVH frames named by face-poseunits.json framemapping.
  const faceUnits = JSON.parse(read("poseunits/face-poseunits.json")) as { framemapping: string[] };
  const faceBvh = parseBvh(read("poseunits/face-poseunits.bvh"));
  // Whole-body poses MakeHuman ships as CC0 (each proven by its .meta): the
  // T-pose, and the rigging benchmark, which bends every joint to an extreme.
  const shipped = BODY_POSES.map((name) => {
    const bvh = parseBvh(read(`poses/${name}.bvh`));
    const meta = fs.readFileSync(path.join(DATA, `poses/${name}.meta`), "utf8");
    const field = (key: string) =>
      meta.match(new RegExp(`^${key}\\s+(.+)$`, "m"))?.[1]?.trim() ?? "";
    return {
      name,
      title: field("name"),
      description: field("description"),
      joints: bvh.joints,
      frame: (bvh.frames[0] ?? []).map((x) => Math.round(x * 1000) / 1000),
    };
  });
  // Poses authored here (scripts/lib/authoredPoses.ts), CC0 like the data they pose.
  const authored = authoredPoses(shipped, boneNames);
  for (const { file } of authored)
    licenseEvidence[`humanoid-kit:scripts/poses/${file}`] =
      "authored for humanoid-kit and dedicated to the public domain under CC0 1.0";
  const poses = [...shipped, ...authored.map((a) => a.pose)];
  const sliders = buildSliders(
    MODIFIER_TABLES.map((table) => ({
      table,
      sliders: JSON.parse(read(`modifiers/${table}_sliders.json`)),
      descriptions: JSON.parse(read(`modifiers/${table}_modifiers_desc.json`)),
    })),
    new Map(modifiers.map((m) => [m.id, m])),
  );
  const slid = new Set(
    [...sliders.body, ...sliders.adult].flatMap((t) =>
      t.groups.flatMap((g) => g.sliders.map((s) => s.id)),
    ),
  );
  const unslid = modifiers.filter((m) => !slid.has(m.id)).map((m) => m.id);
  if (unslid.length) console.warn(`modifiers without an upstream slider: ${unslid.join(", ")}`);

  const joints: Record<string, number[]> = {};
  for (const [k, verts] of Object.entries(skel.joints)) joints[k] = verts;

  // Essential attachments (eyes, teeth, tongue) from the system assets pack,
  // then the nail plates, vendored CC0 community meshes (geometry only: the
  // kit draws them with its own plate material).
  const essentials = ESSENTIALS.map(([id, kind, mhclo, mat]) =>
    compileAsset(path.join(SYSTEM, mhclo), id, kind, {
      ...(mat && { materialFile: path.join(SYSTEM, mat) }),
    }),
  );
  const plates = NAIL_PLATES.map(([id, kind, mhclo, page]) =>
    compileAsset(path.join(VENDOR_BODYPARTS04, mhclo), id, kind, { page, geometryOnly: true }),
  );
  const compiled = [...essentials, ...plates];
  fs.rmSync(path.join(BODY_OUT, "attachments.bin"), { force: true });
  const textures = await writeAttachmentTextures(BODY_OUT, compiled, {
    base: Float32Array.from(obj.positions),
    systemDir: SYSTEM,
  });
  // Written with every vertex open first; the bake below needs the packed figure.
  const occlusionBakes = occlusionCorners(OCCLUSION_KEYS.length);
  let attachments = writeAttachments(BODY_OUT, ATTACHMENTS_FILE, compiled, null, occlusionBakes);
  const systemEvidence: Record<string, string> = {};
  for (const c of essentials) {
    for (const [file, ev] of Object.entries(c.evidence))
      systemEvidence[path.relative(SYSTEM, file)] = ev;
  }
  const vendorEvidence: Record<string, string> = {};
  for (const c of plates) {
    for (const [file, ev] of Object.entries(c.evidence))
      vendorEvidence[path.relative(VENDOR_BODYPARTS04, file)] = ev;
  }

  const sha = (buf: Uint8Array) => createHash("sha256").update(buf).digest("hex");
  const upstreamCommit = execFileSync("git", ["-C", DATA, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const source = {
    project: "MakeHuman assets (github.com/makehumancommunity/makehuman)",
    commit: upstreamCommit,
    license: "CC0-1.0",
    note: "Asset data only; no MakeHuman code.",
  };
  const bodySha = sha(body);
  const manifest: BodyManifest = {
    format: 1,
    kind: "body",
    topology: TOPOLOGY,
    source,
    unit: "metre",
    vertexCount,
    uvCount: obj.uvs.length / 2,
    faceCount: obj.faceVerts.length / 4,
    groups: obj.groups,
    body: { file: BODY_FILE, sha256: bodySha, layout },
    targets: bodyFiles.map((f) => ({
      id: f.id,
      file: f.file,
      encoding: TARGET_ENCODING,
      sha256: sha(f.bin),
      entries: f.entries,
    })),
    modifiers: modifiers.filter((m) => !isAdultPackTarget(m.hi)),
    sliders: sliders.body,
    attachments: {
      file: ATTACHMENTS_FILE,
      sha256: attachments.sha256,
      occlusionKeys: OCCLUSION_KEYS.map((k) => k.id),
      entries: attachments.entries,
    },
    skeleton: {
      bones: boneNames.map((name) => {
        const b = skel.bones[name];
        if (!b) throw new Error(name);
        return {
          name,
          parent: b.parent,
          head: b.head,
          tail: b.tail,
          plane: skel.planes[b.rotation_plane] ?? null,
        };
      }),
      joints,
    },
    faceUnits: {
      names: faceUnits.framemapping,
      joints: faceBvh.joints,
      // MakeHuman's units are not all the mirror of their partners (a smile and the
      // nasolabial fold come out uneven): packed symmetric, scripts/lib/faceUnits.ts.
      frames: symmetrizeFaceUnits(faceUnits.framemapping, faceBvh.joints, faceBvh.frames).map(
        (row) => row.map((x) => Math.round(x * 1000) / 1000),
      ),
    },
    poses,
  };

  // Attachment occlusion is geometry of the default figure, so it is baked here,
  // from the packed data exactly as a loader reads it, and loading casts no rays.
  const buffer = (b: Uint8Array) =>
    b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  const packedFigure = parseHumanoidAssets({
    manifest,
    body: buffer(bodyRaw),
    targets: Object.fromEntries(bodyFiles.map((f) => [f.id, buffer(f.raw)])),
    attachments: buffer(attachments.raw),
  });
  const packedModel = new HumanoidModel(packedFigure);

  // What the adult pack authors itself (scripts/lib/adultAuthored.ts, adultReservoirs.ts)
  // is generated on a model of this body with the pack's control targets and the
  // surface spec, before its own targets exist.
  const controlFile = writeTargetFile(adultControl);
  /** A model of this body with the control targets and a surface spec with the given reservoirs. */
  const interim = (given?: AdultReservoirSpec[]) =>
    new HumanoidModel(
      parseHumanoidAssets(
        {
          manifest,
          body: buffer(bodyRaw),
          targets: Object.fromEntries(bodyFiles.map((f) => [f.id, buffer(f.raw)])),
          attachments: buffer(attachments.raw),
        },
        {
          manifest: {
            format: 1 as const,
            kind: "adult-anatomy" as const,
            topology: TOPOLOGY,
            bodySha256: bodySha,
            source,
            targets: {
              id: "adult",
              file: TARGETS_FILE,
              encoding: TARGET_ENCODING as typeof TARGET_ENCODING,
              sha256: sha(controlFile.bin),
              entries: controlFile.entries,
            },
            modifiers: modifiers.filter((m) => isAdultPackTarget(m.hi)),
            sliders: [],
            // No defaults: the interim model has none of the authored modifiers they name, and
            // the shapes are authored on the figure as its recipe says, with nothing filled in.
            anatomy: withoutDefaults(adultAnatomySpec(packedFigure, undefined, given)),
          },
          targets: buffer(controlFile.raw),
        },
      ),
    );
  // Reservoirs are placed on the surface as it is without them.
  const plain = interim();
  const surfaceOnly = plain.adultDetailLattice(AUTHORING_FIGURE);
  if (!surfaceOnly) throw new Error("the adult pack has no refined surface to place reservoirs on");
  const reservoirs = reservoirSpecs(surfaceOnly);
  // The control targets the pack authors (the mound) are generated on the
  // authoring figure's control mesh, and its detail targets (the phallic organ) on
  // the lattice of the surface with the reservoirs, then written with the others.
  const withReservoirs = interim(reservoirs);
  const generated = authorControl(withReservoirs.controlShape(AUTHORING_FIGURE));
  const latticeWith = withReservoirs.adultDetailLattice(AUTHORING_FIGURE);
  if (!latticeWith) throw new Error("the adult pack has no refined surface to draw detail on");
  const organ = authorDetail(latticeWith, reservoirs);
  // Each reservoir's skin gets an island of its own in free space of the body's UV layout,
  // at the skin's own scale, so a skin layer can colour a tube and not the skin round its root.
  const bodyTopology = plain.topology().body;
  const metresPerUv = uvScale(packedFigure, groupFaces(packedFigure, "body"));
  const control = withReservoirs.controlShape(AUTHORING_FIGURE);
  const scaleAt = (id: string) => {
    const spec = reservoirs.find((r) => r.id === id) as AdultReservoirSpec;
    const [cx, cy, cz] = reservoirRoot(latticeWith, spec).centre;
    let best = -1;
    let nearest = Number.POSITIVE_INFINITY;
    for (const v of control.body) {
      const d =
        ((control.control[v * 3] as number) - cx) ** 2 +
        ((control.control[v * 3 + 1] as number) - cy) ** 2 +
        ((control.control[v * 3 + 2] as number) - cz) ** 2;
      if (d < nearest) {
        nearest = d;
        best = v;
      }
    }
    return metresPerUv[best] as number;
  };
  const islanded = placeIslands(
    reservoirs,
    ISLAND_SIZES,
    ISLAND_LAYERS,
    Object.fromEntries(reservoirs.map((r) => [r.id, scaleAt(r.id)])),
    bodyCoverage(bodyTopology.uvs, bodyTopology.index),
  );
  const adult = writeTargetFile([...adultControl, ...generated, ...organ.targets]);
  fs.writeFileSync(path.join(ADULT_OUT, TARGETS_FILE), adult.bin);
  addAuthoredSliders(sliders.adult);

  const occlusion = packedModel
    .bakeAttachmentOcclusion()
    .map((o) => Uint8Array.from(o, (v) => Math.round(Math.min(1, Math.max(0, v)) * 255)));
  attachments = writeAttachments(BODY_OUT, ATTACHMENTS_FILE, compiled, occlusion, occlusionBakes);
  manifest.attachments.sha256 = attachments.sha256;
  // The body's own cavities (mouth, nostrils, ear canals, eye sockets) darken the same way.
  const bodyOcclusion = writeBodyOcclusion(
    BODY_OUT,
    BODY_OCCLUSION_FILE,
    packedModel.bakeBodyOcclusion(),
    OCCLUSION_KEYS.map((k) => k.id),
  );
  manifest.bodyOcclusion = bodyOcclusion;
  fs.writeFileSync(path.join(BODY_OUT, "manifest.json"), `${JSON.stringify(manifest)}\n`);

  const adultManifest = {
    format: 1,
    kind: "adult-anatomy",
    topology: TOPOLOGY,
    /** The body pack this pack was built against; the loader refuses any other. */
    bodySha256: bodySha,
    source,
    targets: {
      id: "adult",
      file: TARGETS_FILE,
      encoding: TARGET_ENCODING,
      sha256: sha(adult.bin),
      entries: adult.entries,
    },
    modifiers: [...modifiers.filter((m) => isAdultPackTarget(m.hi)), ...AUTHORED_MODIFIERS],
    sliders: sliders.adult,
    /** Features, skin-layer measurements and shape states: the core names none of these. */
    anatomy: adultAnatomySpec(packedFigure, organ.detail, islanded),
  };
  fs.writeFileSync(path.join(ADULT_OUT, "manifest.json"), `${JSON.stringify(adultManifest)}\n`);

  const adultFiles = new Set(adult.entries.map((e) => `targets/${e.name}.target`));
  writeProvenance(
    BODY_OUT,
    "humanoid-kit-body",
    upstreamCommit,
    (f) => !adultFiles.has(f),
    [
      [BODY_FILE, bodySha],
      ...bodyFiles.map((f): [string, string] => [f.file, sha(f.bin)]),
      [ATTACHMENTS_FILE, attachments.sha256],
      [BODY_OCCLUSION_FILE, bodyOcclusion.sha256],
      ...textures.map((t): [string, string] => [
        t.texture,
        sha(new Uint8Array(fs.readFileSync(path.join(BODY_OUT, t.texture)))),
      ]),
    ],
    systemEvidence,
    vendorEvidence,
    [],
    textures,
  );
  writeProvenance(
    ADULT_OUT,
    "humanoid-kit-adult-anatomy",
    upstreamCommit,
    (f) => adultFiles.has(f),
    [[TARGETS_FILE, sha(adult.bin)]],
    {},
    {},
    AUTHORED_PROVENANCE,
  );
  writePackEntry(
    path.dirname(BODY_OUT),
    "bodyPack",
    "URLs of the humanoid-kit-body pack files. Pass to `loadHumanoidAssets({ body })`.",
  );
  writePackEntry(
    path.dirname(ADULT_OUT),
    "adultAnatomyPack",
    "URLs of the humanoid-kit-adult-anatomy pack files. Pass to `loadHumanoidAssets({ adultAnatomy })`.",
  );
  // The hair pack binds to the body pack by hash, so it is rebuilt with it.
  await packHair({ systemDir: SYSTEM, bodyDir: BODY_OUT, outDir: HAIR_OUT });
  const mb = (n: number) => `${(n / 1e6).toFixed(2)} MB`;
  console.log(
    `packed ${vertexCount} verts, ${manifest.faceCount} quads; targets: ` +
      bodyFiles.map((f) => `${f.id} ${f.entries.length} (${mb(f.bin.byteLength)})`).join(", ") +
      `, adult ${adult.entries.length} (${mb(adult.bin.byteLength)}); ` +
      `${encoded.empty} empty and ${undriven.length} undriven upstream targets left out; ` +
      `body ${mb(body.byteLength)}`,
  );
}

await main();
