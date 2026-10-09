/**
 * Packs the CC0 MakeHuman hm08 base mesh, its adult morph targets, the default
 * skeleton, skin weights and facial pose units into the binary layout the
 * runtime loads (`src/format/assetFormat.ts`).
 *
 *   node scripts/pack-makehuman.ts <makehuman-data-dir> <system-assets-dir>
 *
 * The first argument is the `makehuman/data` directory of a checkout of
 * github.com/makehumancommunity/makehuman; the second is the extracted
 * "MakeHuman system assets" pack (makehuman_system_assets_cc0.zip), which
 * supplies the eyes, teeth and tongue every figure needs. Only asset files
 * are read (released CC0 in September 2020); no MakeHuman code is used.
 *
 * All of MakeHuman's ages (baby, child, young, old) are packed. Adult-only
 * targets (genitals, bulge, pregnancy) go to a separate `adult-targets.bin`
 * that the runtime loads only on request and only evaluates for adults.
 *
 * Height and proportion targets are kept for average muscle and weight only:
 * the dense per-muscle/weight variants triple the package size for a shape
 * difference the universal muscle/weight targets already carry.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { compileAsset } from "./lib/compileAsset.ts";
import { writeAttachments, writePackEntry } from "./lib/packWriter.ts";

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
/** Compatibility key: every MakeHuman proxy, clothes and target asset binds to this topology. */
const TOPOLOGY = "makehuman-hm08";
/** MakeHuman units are decimetres; the runtime works in metres. */
const UNIT = 0.1;

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
 *  - the remaining kinds (modifier table, pose-unit BVH) have no per-file
 *    statement and are accepted only because the upstream LICENSE.md names
 *    their category under "released under CC0 1.0 Universal". That statement
 *    is checked verbatim below, so a changed upstream licence fails the pack.
 */
const REPO_LICENSE = path.resolve(DATA, "../../LICENSE.md");
const REPO_STATEMENT = "These assets have been released under CC0 1.0 Universal.";
const REPO_CATEGORIES: Record<string, string> = {
  "modifiers/modeling_modifiers.json": "* Targets and modifiers",
  "poseunits/face-poseunits.bvh": "* Poses and expressions",
};
const licenseEvidence: Record<string, string> = {};

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
  return { idx, d };
}

/** Targets that belong to the adult anatomy pack (a separate install). */
const isAdultPackTarget = (name: string) =>
  name.startsWith("genitals/") ||
  name.startsWith("pelvis/bulge-") ||
  name.startsWith("stomach/stomach-pregnant-");

/**
 * Modifiers that are age-gated (rejected below 18): everything in the adult
 * pack, plus the breast and nipple shape group, which stays in the body pack
 * because adult figures need it without installing anatomy.
 */
const isAdultOnlyModifier = (group: string, hi: string) =>
  isAdultPackTarget(hi) || group === "breast";

function listTargets(): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const ent of fs.readdirSync(path.join(DATA, rel), { withFileTypes: true })) {
      const child = `${rel}/${ent.name}`;
      if (ent.isDirectory()) {
        if (ent.name === "images" || ent.name === "expression") continue;
        walk(child);
      } else if (ent.name.endsWith(".target")) {
        if (/^targets\/macrodetails\/(height|proportions)$/.test(rel)) {
          if (!ent.name.includes("-averagemuscle-averageweight-")) continue;
        }
        out.push(child);
      }
    }
  };
  walk("targets");
  return out.sort();
}

/** Packs targets as: u16 indices (padded to 4 bytes), then i16 xyz deltas. */
function packTargets(files: string[]) {
  const chunks: Uint8Array[] = [];
  const entries: TargetEntry[] = [];
  let offset = 0;
  let empty = 0;
  for (const rel of files) {
    const { idx, d } = parseTarget(read(rel));
    if (idx.length === 0) {
      empty++;
      continue;
    }
    let max = 0;
    for (const q of d) max = Math.max(max, Math.abs(q));
    const scale = max / 32767 || 1;
    const idxBytes = Math.ceil((idx.length * 2) / 4) * 4;
    const chunk = new Uint8Array(idxBytes + Math.ceil((idx.length * 6) / 4) * 4);
    const view = new DataView(chunk.buffer);
    idx.forEach((v, k) => {
      view.setUint16(k * 2, v, true);
    });
    d.forEach((q, k) => {
      view.setInt16(idxBytes + k * 2, Math.round(q / scale), true);
    });
    entries.push({
      name: rel.replace(/^targets\//, "").replace(/\.target$/, ""),
      offset,
      count: idx.length,
      scale,
    });
    chunks.push(chunk);
    offset += chunk.byteLength;
  }
  const bin = new Uint8Array(offset);
  let o = 0;
  for (const c of chunks) {
    bin.set(c, o);
    o += c.byteLength;
  }
  return { bin, entries, empty };
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

/** Parses a BVH into per-frame, per-joint local Euler rotations (degrees, ZXY order as written). */
function parseBvh(text: string) {
  const tokens = text.split(/\s+/).filter(Boolean);
  const joints: { name: string; channels: string[] }[] = [];
  let i = 0;
  while (tokens[i] !== "MOTION") {
    const t = tokens[i++];
    if (t === "ROOT" || t === "JOINT") joints.push({ name: tokens[i++] ?? "", channels: [] });
    else if (t === "End") i += 1;
    else if (t === "CHANNELS") {
      const n = Number(tokens[i++]);
      const j = joints[joints.length - 1];
      if (!j) throw new Error("CHANNELS before joint");
      j.channels = tokens.slice(i, i + n);
      i += n;
    }
  }
  i++; // MOTION
  i++; // Frames:
  const frames = Number(tokens[i++]);
  i += 3; // Frame Time: x
  const data: number[][] = [];
  for (let f = 0; f < frames; f++) {
    const row: number[] = [];
    for (const j of joints)
      for (let c = 0; c < j.channels.length; c++) row.push(Number(tokens[i++]));
    data.push(row);
  }
  return { joints, frames: data };
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
    "",
    "| Output | SHA-256 |",
    "| --- | --- |",
    ...outputs.map(([f, h]) => `| ${f} | \`${h}\` |`),
    "",
  ];
  fs.writeFileSync(path.join(dir, "PROVENANCE.md"), lines.join("\n"));
}

// ---------------------------------------------------------------- main
function main() {
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
  const body = new Uint8Array(size);
  for (const p of parts) body.set(p.bytes, layout[p.key]?.offset ?? 0);
  fs.writeFileSync(path.join(BODY_OUT, "body.bin"), body);

  const files = listTargets();
  const core = packTargets(files.filter((f) => !isAdultPackTarget(f.replace(/^targets\//, ""))));
  const adult = packTargets(files.filter((f) => isAdultPackTarget(f.replace(/^targets\//, ""))));
  fs.writeFileSync(path.join(BODY_OUT, "targets.bin"), core.bin);
  fs.writeFileSync(path.join(ADULT_OUT, "targets.bin"), adult.bin);
  const targets = [...core.entries, ...adult.entries];

  // Face pose units: BVH frames named by face-poseunits.json framemapping.
  const faceUnits = JSON.parse(read("poseunits/face-poseunits.json")) as { framemapping: string[] };
  const faceBvh = parseBvh(read("poseunits/face-poseunits.bvh"));

  // Shape modifiers: MakeHuman's modeling modifier table, resolved to packed target names.
  const packedNames = new Set(targets.map((t) => t.name));
  const modifierGroups = JSON.parse(read("modifiers/modeling_modifiers.json")) as {
    group: string;
    modifiers: { target?: string; min?: string; max?: string }[];
  }[];
  const modifiers: {
    id: string;
    group: string;
    lo: string | null;
    hi: string;
    adultOnly: boolean;
  }[] = [];
  const unresolved: string[] = [];
  for (const g of modifierGroups) {
    for (const m of g.modifiers) {
      if (!m.target) continue; // macro variables are handled by the macro model
      const dir = g.group;
      const lo = m.min ? `${dir}/${m.target}-${m.min}` : null;
      const hi = m.max ? `${dir}/${m.target}-${m.max}` : `${dir}/${m.target}`;
      const id = m.min ? `${dir}/${m.target}-${m.min}|${m.max}` : `${dir}/${m.target}`;
      if (!packedNames.has(hi) || (lo && !packedNames.has(lo))) {
        unresolved.push(id);
        continue;
      }
      modifiers.push({ id, group: dir, lo, hi, adultOnly: isAdultOnlyModifier(dir, hi) });
    }
  }
  if (unresolved.length)
    console.warn(`unresolved modifiers (no packed target): ${unresolved.join(", ")}`);

  const joints: Record<string, number[]> = {};
  for (const [k, verts] of Object.entries(skel.joints)) joints[k] = verts;

  // Essential attachments (eyes, teeth, tongue) from the system assets pack.
  const compiled = ESSENTIALS.map(([id, kind, mhclo, mat]) =>
    compileAsset(path.join(SYSTEM, mhclo), id, kind, mat ? path.join(SYSTEM, mat) : undefined),
  );
  const attachments = writeAttachments(BODY_OUT, "attachments.bin", compiled);
  const systemEvidence: Record<string, string> = {};
  for (const c of compiled) {
    for (const [file, ev] of Object.entries(c.evidence))
      systemEvidence[path.relative(SYSTEM, file)] = ev;
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
  const manifest = {
    format: 1,
    kind: "body",
    topology: TOPOLOGY,
    source,
    unit: "metre",
    vertexCount,
    uvCount: obj.uvs.length / 2,
    faceCount: obj.faceVerts.length / 4,
    groups: obj.groups,
    body: { file: "body.bin", sha256: bodySha, layout },
    targets: { file: "targets.bin", sha256: sha(core.bin), entries: core.entries },
    modifiers: modifiers.filter((m) => !isAdultPackTarget(m.hi)),
    attachments: {
      file: "attachments.bin",
      sha256: attachments.sha256,
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
      frames: faceBvh.frames.map((row) => row.map((x) => Math.round(x * 1000) / 1000)),
    },
  };
  fs.writeFileSync(path.join(BODY_OUT, "manifest.json"), `${JSON.stringify(manifest)}\n`);

  const adultManifest = {
    format: 1,
    kind: "adult-anatomy",
    topology: TOPOLOGY,
    /** The body pack this pack was built against; the loader refuses any other. */
    bodySha256: bodySha,
    source,
    targets: { file: "targets.bin", sha256: sha(adult.bin), entries: adult.entries },
    modifiers: modifiers.filter((m) => isAdultPackTarget(m.hi)),
  };
  fs.writeFileSync(path.join(ADULT_OUT, "manifest.json"), `${JSON.stringify(adultManifest)}\n`);

  const adultFiles = new Set(adult.entries.map((e) => `targets/${e.name}.target`));
  writeProvenance(
    BODY_OUT,
    "humanoid-kit-body",
    upstreamCommit,
    (f) => !adultFiles.has(f),
    [
      ["body.bin", bodySha],
      ["targets.bin", sha(core.bin)],
      ["attachments.bin", attachments.sha256],
    ],
    systemEvidence,
  );
  writeProvenance(
    ADULT_OUT,
    "humanoid-kit-adult-anatomy",
    upstreamCommit,
    (f) => adultFiles.has(f),
    [["targets.bin", sha(adult.bin)]],
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
  console.log(
    `packed ${vertexCount} verts, ${manifest.faceCount} quads, ${core.entries.length} core + ${adult.entries.length} adult targets ` +
      `(${core.empty + adult.empty} empty skipped), body ${(body.byteLength / 1e6).toFixed(2)} MB, ` +
      `targets ${(core.bin.byteLength / 1e6).toFixed(2)} MB, adult ${(adult.bin.byteLength / 1e6).toFixed(2)} MB`,
  );
}

main();
