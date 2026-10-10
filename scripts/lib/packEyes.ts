/**
 * The MakeHuman community's eye materials, as the eye pack's textures
 * (`packs/eyes`): the 32 materials of `system_eye_materials01` and `02` whose asset
 * pages say CC0 (docs/licence-history.md, §4.3). `system_eye_materials03` is CC-BY
 * and not used.
 *
 * Each material passes the licence rule (`judgeAsset`, clause B, the page's licence
 * governing: the packs' own JSON record of the asset page is the page) before it is
 * packed. Only the diffuse texture is packed, as WebP like the built-in eye's, and
 * what the texture says is *measured*, not authored: where the iris ends, how bright
 * the iris and the sclera are against the built-in texture's, and the sclera's
 * colour against its. The eye shader (`src/render/eyeMaterial.ts`) uses them so
 * that a material supplies pattern and detail on the recipe's own colours, which
 * are the measured colour model.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { EyeManifest, EyeMaterialEntry } from "../../src/eyes/library.ts";
import type { Rgb } from "../../src/surface/skinTone.ts";
import { type CommunityPage, judgeAsset, type SourceFile } from "./licenceRule.ts";
import { sha256, writePackEntry } from "./packWriter.ts";
import { readZip } from "./zip.ts";

/** The two packs of CC0 eye materials, pinned. */
export const EYE_PACKS = [
  {
    id: "system_eye_materials01",
    sha256: "acad4636c08ff96ac8a27775cfa071052c8cba9b21e0029b649bdd6ec7aeb332",
    url: "https://files.makehumancommunity.org/asset_packs/system_eye_materials01/system_eye_materials01_cc0.zip",
    page: "https://static.makehumancommunity.org/assets/assetpacks/system_eye_materials01.html",
  },
  {
    id: "system_eye_materials02",
    sha256: "239e6565e56011da6298953a110e5cdca231ab98d96fda49616096df33112d11",
    url: "https://files.makehumancommunity.org/asset_packs/system_eye_materials02/system_eye_materials02_cc0.zip",
    page: "https://static.makehumancommunity.org/assets/assetpacks/system_eye_materials02.html",
  },
] as const;

/** The date the asset pages were read (docs/licence-history.md, §4.3). */
const RETRIEVED = "2026-10-09";

/** Longest texture edge shipped, as for the built-in eye. */
const TEXTURE_MAX = 1024;
/** Samples the measuring works on: every texture is brought to this many pixels a side. */
const SIDE = 512;
/** Where each eye's iris is in the texture, in `SIDE` pixels (y down), taken from the built-in texture. */
const CENTRES_PX: readonly [number, number][] = [
  [362, 152],
  [148, 364],
];
/** The iris's radius in `SIDE` pixels where a texture shows none to measure, and the plausible range of one that does. */
const DEFAULT_RADIUS = 58;
const RADIUS_RANGE: [number, number] = [48, 76];
/** An iris must differ from the ring around it by this fraction of the brighter to count. */
const IRIS_CONTRAST = 0.3;

const srgbToLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** A texture's pixels at `SIDE` squared, linear colour and alpha. */
export interface Samples {
  rgb: Float32Array;
  alpha: Float32Array;
}

export async function sample(file: string | Buffer): Promise<Samples> {
  const { data } = await sharp(file)
    .ensureAlpha()
    .resize(SIDE, SIDE, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgb = new Float32Array(SIDE * SIDE * 3);
  const alpha = new Float32Array(SIDE * SIDE);
  for (let i = 0; i < SIDE * SIDE; i++) {
    rgb[i * 3] = srgbToLinear(data[i * 4] as number);
    rgb[i * 3 + 1] = srgbToLinear(data[i * 4 + 1] as number);
    rgb[i * 3 + 2] = srgbToLinear(data[i * 4 + 2] as number);
    alpha[i] = (data[i * 4 + 3] as number) / 255;
  }
  return { rgb, alpha };
}

/** What a texture says about its eyes. */
export interface EyeMeasure {
  radius: number;
  hasIris: boolean;
  /** Mean linear luminance of the iris (the pupil left out) and the sclera ring, and the rings' mean colours. */
  irisLum: number;
  irisRgb: Rgb;
  scleraLum: number;
  scleraRgb: Rgb;
}

/** Radial mean of luminance around both iris centres. */
function radialProfile(s: Samples, rmax: number): Float64Array {
  const sum = new Float64Array(rmax);
  const n = new Float64Array(rmax);
  for (const [cx, cy] of CENTRES_PX) {
    for (let y = Math.max(0, cy - rmax); y < Math.min(SIDE, cy + rmax); y++)
      for (let x = Math.max(0, cx - rmax); x < Math.min(SIDE, cx + rmax); x++) {
        const r = Math.floor(Math.hypot(x - cx, y - cy));
        if (r >= rmax) continue;
        const i = y * SIDE + x;
        sum[r] = (sum[r] as number) + luminance(...rgbAt(s, i));
        n[r] = (n[r] as number) + 1;
      }
  }
  return Float64Array.from(sum, (v, r) => v / Math.max(1, n[r] as number));
}

const rgbAt = (s: Samples, i: number): [number, number, number] => [
  s.rgb[i * 3] as number,
  s.rgb[i * 3 + 1] as number,
  s.rgb[i * 3 + 2] as number,
];

/** The mean linear colour of the pixels between radii `lo` and `hi` of both eyes that are opaque. */
function ring(s: Samples, lo: number, hi: number): { lum: number; rgb: Rgb } {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (const [cx, cy] of CENTRES_PX)
    for (let y = Math.max(0, Math.floor(cy - hi)); y < Math.min(SIDE, Math.ceil(cy + hi)); y++)
      for (let x = Math.max(0, Math.floor(cx - hi)); x < Math.min(SIDE, Math.ceil(cx + hi)); x++) {
        const d = Math.hypot(x - cx, y - cy);
        const i = y * SIDE + x;
        if (d < lo || d >= hi || (s.alpha[i] as number) < 0.5) continue;
        const c = rgbAt(s, i);
        r += c[0];
        g += c[1];
        b += c[2];
        n++;
      }
  n = Math.max(1, n);
  return { lum: luminance(r / n, g / n, b / n), rgb: [r / n, g / n, b / n] };
}

/** Where the iris ends, how bright it and the sclera are, and their colours. */
export function measureEye(s: Samples): EyeMeasure {
  const profile = radialProfile(s, 100);
  // The iris's edge: the radius at which the disc inside differs most from the ring around it (a
  // plateau test, which a slit pupil or a limbal ring does not upset the way a step test is).
  const mean = (lo: number, hi: number) => {
    let sum = 0;
    for (let r = lo; r < hi; r++) sum += profile[r] as number;
    return sum / Math.max(1, hi - lo);
  };
  let best = 0;
  let edge = DEFAULT_RADIUS;
  for (let r = RADIUS_RANGE[0]; r <= RADIUS_RANGE[1]; r++) {
    const inside = mean(Math.round(0.45 * r), Math.round(0.92 * r));
    const outside = mean(Math.round(1.08 * r), Math.round(1.4 * r));
    const contrast = Math.abs(inside - outside) / Math.max(inside, outside, 1e-6);
    if (contrast > best) {
      best = contrast;
      edge = r;
    }
  }
  const hasIris = best >= IRIS_CONTRAST;
  const radius = hasIris ? edge : DEFAULT_RADIUS;
  const iris = ring(s, 0.45 * radius, 0.92 * radius);
  const sclera = ring(s, 1.25 * radius, 1.9 * radius);
  return {
    radius,
    hasIris,
    irisLum: iris.lum,
    irisRgb: iris.rgb,
    scleraLum: sclera.lum,
    scleraRgb: sclera.rgb,
  };
}

const round = (v: number, places = 5) => Math.round(v * 10 ** places) / 10 ** places;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The eye shader's constant: the built-in iris shows `eyes.iris` at nine times the texture's luminance. */
export const IRIS_LUMINANCE_SCALE = 9;

/** A material's numbers against the built-in texture's. */
export function relativeTo(m: EyeMeasure, ref: EyeMeasure) {
  const tint = (rgb: Rgb, lum: number, refRgb: Rgb, refLum: number): Rgb =>
    [0, 1, 2].map((c) =>
      round(clamp((rgb[c] as number) / lum / ((refRgb[c] as number) / refLum), 0.1, 2)),
    ) as Rgb;
  return {
    irisGain: round(clamp(ref.irisLum / m.irisLum, 0.005, 8)),
    scleraGain: round(clamp(ref.scleraLum / m.scleraLum, 0.5, 2)),
    scleraTint: tint(m.scleraRgb, m.scleraLum, ref.scleraRgb, ref.scleraLum),
    // The recipe colour that shows the texture's own mean iris colour: the shader multiplies it by 9 × luminance.
    paintedIris: m.irisRgb.map((c) =>
      round(clamp(c / (IRIS_LUMINANCE_SCALE * ref.irisLum), 0, 1)),
    ) as Rgb,
  };
}

/** The built-in eye's texture, which the numbers are against. */
export async function referenceEye(bodyDir: string): Promise<EyeMeasure> {
  return measureEye(await sample(path.join(bodyDir, "eyes_high-poly_brown_eye.webp")));
}

/**
 * The built-in texture's alpha at `TEXTURE_MAX` squared: the disc that is transparent is
 * the cornea's place on the eye mesh's UVs, which every material shares.
 */
async function corneaCut(bodyDir: string): Promise<Buffer> {
  return sharp(path.join(bodyDir, "eyes_high-poly_brown_eye.webp"))
    .ensureAlpha()
    .resize(TEXTURE_MAX, TEXTURE_MAX, { fit: "fill" })
    .extractChannel("alpha")
    .raw()
    .toBuffer();
}

/**
 * A material's texture as the pack ships it: WebP, at most `TEXTURE_MAX` a side, with the
 * cornea's cut in its alpha. A texture that is opaque everywhere (the toon eyes) has no cut
 * of its own, and its cornea dome would be drawn over the iris, so it takes the built-in
 * texture's.
 */
async function encode(png: Buffer, cornea: Buffer): Promise<Buffer> {
  const resized = sharp(png)
    .ensureAlpha()
    .resize({ width: TEXTURE_MAX, height: TEXTURE_MAX, fit: "fill" });
  const { data } = await resized
    .clone()
    .extractChannel("alpha")
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (!data.every((a) => a === 255))
    return resized.webp({ quality: 88, alphaQuality: 100, effort: 6 }).toBuffer();
  const { data: raw, info } = await resized.raw().toBuffer({ resolveWithObject: true });
  const stride = info.channels;
  const rgba = Buffer.alloc(TEXTURE_MAX * TEXTURE_MAX * 4);
  for (let i = 0; i < TEXTURE_MAX * TEXTURE_MAX; i++) {
    rgba[i * 4] = raw[i * stride] as number;
    rgba[i * 4 + 1] = raw[i * stride + 1] as number;
    rgba[i * 4 + 2] = raw[i * stride + 2] as number;
    rgba[i * 4 + 3] = cornea[i] as number;
  }
  return sharp(rgba, { raw: { width: TEXTURE_MAX, height: TEXTURE_MAX, channels: 4 } })
    .webp({ quality: 88, alphaQuality: 100, effort: 6 })
    .toBuffer();
}

interface PackRecord {
  author: string;
  created: string;
  license: string;
  source: string;
  description: string;
}

const title = (id: string) =>
  id
    .replace(/_/g, " ")
    .replace(/\b(\d)\b/g, "$1")
    .replace(/^./, (c) => c.toUpperCase());

const tagsOf = (id: string): string[] => {
  const tags: string[] = [];
  if (/cat/.test(id)) tags.push("slit pupil");
  if (/toon|anime/.test(id)) tags.push("toon");
  if (/alien|facette|cross|orc|reptile|dragon|zombie|6_eyes|trans/.test(id)) tags.push("creature");
  if (/white|yellow|blank/.test(id)) tags.push("blank");
  if (/bobby_03_diffuse|mindfront|sapphire_blue/.test(id)) tags.push("human");
  return tags;
};

export interface PackEyesOptions {
  /** The directory holding `system_eye_materials01/` and `02/`, each with its pinned zip. */
  archives: string;
  bodyDir: string;
  outDir: string;
}

/** Judges, measures and packs every material; returns the manifest. */
export async function packEyes(options: PackEyesOptions): Promise<EyeManifest> {
  fs.mkdirSync(options.outDir, { recursive: true });
  for (const f of fs.readdirSync(options.outDir)) fs.rmSync(path.join(options.outDir, f));
  const ref = await referenceEye(options.bodyDir);
  const cornea = await corneaCut(options.bodyDir);
  const materials: EyeMaterialEntry[] = [];
  const evidence: [string, string][] = [];
  const outputs: [string, string][] = [];
  for (const pack of EYE_PACKS) {
    const file = fs.readFileSync(path.join(options.archives, pack.id, `${pack.id}_cc0.zip`));
    const hash = createHash("sha256").update(file).digest("hex");
    if (hash !== pack.sha256)
      throw new Error(`${pack.id} is ${hash}, not the pinned ${pack.sha256}`);
    const zip = readZip(file);
    const records = JSON.parse(zip.read(`packs/${pack.id}.json`).toString("utf8")) as Record<
      string,
      PackRecord
    >;
    for (const [id, rec] of Object.entries(records)) {
      const dir = `eyes/materials/${id}`;
      const mhmat = zip.read(`${dir}/${id}.mhmat`).toString("utf8");
      const texName = /^diffuseTexture\s+(\S+)/m.exec(mhmat)?.[1];
      if (!texName) throw new Error(`${id}: its material names no diffuse texture`);
      const page: CommunityPage = {
        url: rec.source,
        submitter: rec.author,
        submitted: rec.created,
        licence: rec.license,
        retrieved: RETRIEVED,
      };
      const files: SourceFile[] = [
        { name: `${id}.mhmat`, text: mhmat.slice(0, 3000) },
        { name: texName, text: null },
      ];
      const judgement = judgeAsset(files, page);
      if (!judgement.pass) throw new Error(`${id}: licence rule refuses it: ${judgement.reason}`);
      const png = zip.read(`${dir}/${texName}`);
      const out = `${id}.webp`;
      const webp = await encode(png, cornea);
      const measure = measureEye(await sample(webp));
      fs.writeFileSync(path.join(options.outDir, out), webp);
      const rel = relativeTo(measure, ref);
      materials.push({
        id,
        title: title(id),
        author: rec.author,
        created: rec.created,
        tags: tagsOf(id),
        file: out,
        sha256: sha256(webp),
        hasIris: measure.hasIris,
        irisRadius: round(measure.radius / SIDE),
        ...rel,
        source: {
          archive: `${pack.id}_cc0.zip`,
          archiveSha256: pack.sha256,
          file: `${dir}/${texName}`,
          page: rec.source,
          licence: rec.license,
        },
      });
      evidence.push([
        id,
        `clause ${judgement.clause}; ${judgement.evidence[texName]}; the page's record: author ${rec.author}, created ${rec.created}, license ${rec.license}`,
      ]);
      outputs.push([out, sha256(webp)]);
    }
  }
  materials.sort((a, b) => a.id.localeCompare(b.id));
  const ids = materials.map((m) => m.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`two eye materials are called ${dup}`);
  const manifest: EyeManifest = {
    version: 1,
    centres: CENTRES_PX.map(([x, y]) => [round(x / SIDE), round(1 - y / SIDE)]) as [
      [number, number],
      [number, number],
    ],
    materials,
  };
  fs.writeFileSync(path.join(options.outDir, "manifest.json"), `${JSON.stringify(manifest)}\n`);
  writeProvenance(options.outDir, evidence, outputs);
  writePackEntry(
    path.resolve(options.outDir, ".."),
    "eyesPack",
    "URLs of the humanoid-kit-eyes pack files. Pass to `loadEyeLibrary`.",
    "scripts/pack-eyes.ts",
  );
  return manifest;
}

function writeProvenance(dir: string, evidence: [string, string][], outputs: [string, string][]) {
  const lines = [
    "# humanoid-kit-eyes data provenance",
    "",
    "Generated by `scripts/pack-eyes.ts`; do not edit.",
    "",
    "## MakeHuman's eye materials",
    "",
    ...EYE_PACKS.map(
      (p) => `- \`${p.id}_cc0.zip\` (sha256 \`${p.sha256}\`), <${p.url}>, listed at <${p.page}>`,
    ),
    "",
    "Only each material's diffuse texture is used; no MakeHuman code. \"MakeHuman\" is the upstream project's name; this",
    "package is not affiliated with it, and CC0 does not license trademarks (CC0 1.0 §4a). `system_eye_materials03` is CC-BY",
    "and is not used.",
    "",
    `Licence: each asset's page on makehumancommunity.org says CC0 (read ${RETRIEVED}; the packs' own JSON record of the page`,
    "gives the URL, the author and the date), and the page governs (docs/licence-history.md, clause B). Each passed the",
    "repository's licence rule (`scripts/lib/licenceRule.ts`) before packing:",
    "",
    ...evidence.map(([id, ev]) => `- ${id}: ${ev}`),
    "",
    "Each texture is re-encoded as WebP (quality 88, lossless alpha). The numbers in the manifest (the iris's radius, its",
    "and the sclera's brightness against the built-in eye's, the sclera's tint, the iris colour as painted) are measured",
    "from the pixels by `measureEye`; nothing is authored.",
    "",
    "## Outputs",
    "",
    "| Output | SHA-256 |",
    "| --- | --- |",
    ...outputs.map(([f, h]) => `| ${f} | \`${h}\` |`),
    "",
  ];
  fs.writeFileSync(path.join(dir, "PROVENANCE.md"), lines.join("\n"));
}
