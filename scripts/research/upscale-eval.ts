/**
 * Evaluates the upscale methods on held-out originals: the numbers behind
 * docs/evidence/upscale.md, "Which upscaler, and does it beat the GPU".
 *
 *   node scripts/research/upscale-eval.ts <system-assets-dir> <work-dir> [--realesrgan <dir>] [--json out.json]
 *
 * An upscale is only worth shipping if it is closer to what a larger original
 * would have shown than the GPU's own linear magnification of the small one.
 * That can be measured wherever a larger original exists, so each method is run
 * on originals shrunk to a quarter or a half, and judged against the original:
 *
 * - albedo: the 22 MakeHuman skin images (2048²), area-downsampled to 512² and
 *   upscaled ×4 by the GPU's bilinear (in linear light, as an sRGB texture is
 *   filtered), by `upscaleAlbedo`, and, given `--realesrgan` (an unpacked
 *   realesrgan-ncnn-vulkan release), by Real-ESRGAN x4plus; CIEDE2000 to the
 *   original per skin-tone bucket, and the gates against the 512² input;
 * - normals: the garments' 4096² normal maps, reduced (by their slopes) to
 *   1024² and upscaled ×2 by the GPU's bilinear and by `upscaleNormal`; the
 *   angle to the original reduced to 2048², and the gates.
 *
 * The skins are not packed (the kit computes skin colour): they are the
 * largest set of real albedo with known originals, across every tone.
 * Images go to `<work-dir>`, never into the repository.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { deltaE2000 } from "../../e2e/lib/colour.ts";
import { labFromLinear } from "../../src/surface/cielab.ts";
import {
  albedoSpace,
  BUCKET_MIN_TEXELS,
  COLOUR_RANGE,
  newDetail,
  normalInterior,
  roundTripAlbedo,
  roundTripNormal,
  type Stat,
  slopeSpace,
  TONE_BUCKETS,
  type ToneBucket,
  toneBucket,
} from "../lib/upscale/gates.ts";
import {
  areaResizeNormal,
  slopesOf,
  upscaleAlbedo,
  upscaleNormal,
} from "../lib/upscale/methods.ts";
import {
  areaResize,
  bilinearResize,
  linearFromSrgb,
  type Raster,
  raster,
  readRaster,
  srgbFromLinear,
  writeRaster,
} from "../lib/upscale/raster.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const esrganDir = flag("--realesrgan");
const jsonOut = flag("--json");
const [systemDir, workDir] = args;
if (!systemDir || !workDir)
  throw new Error(
    "usage: upscale-eval.ts <system-assets-dir> <work-dir> [--realesrgan <dir>] [--json out]",
  );
fs.mkdirSync(path.join(workDir, "low"), { recursive: true });
fs.mkdirSync(path.join(workDir, "esrgan"), { recursive: true });

const sha = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const r3 = (x: number) => Number(x.toFixed(3));
const median = (v: readonly number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? (s[Math.floor(s.length / 2)] as number) : 0;
};
function stat(values: number[]): Stat {
  const s = Float64Array.from(values).sort();
  return {
    n: s.length,
    mean: s.reduce((a, b) => a + b, 0) / Math.max(1, s.length),
    p99: (s[Math.floor(s.length * 0.99)] as number) ?? 0,
  };
}
const rgb = (r: Raster): Raster => {
  const out = raster(r.width, r.height, 3);
  for (let i = 0; i < r.width * r.height; i++)
    for (let k = 0; k < 3; k++) out.data[i * 3 + k] = r.data[i * r.channels + k] as number;
  return out;
};
/** Quantised to 8 bits, as a shipped source is. */
const eightBit = (r: Raster): Raster =>
  raster(
    r.width,
    r.height,
    r.channels,
    Float32Array.from(r.data, (v) => Math.round(v * 255) / 255),
  );

// ---------------------------------------------------------------- albedo

const LOW = 512;
const SCALE = 4;

/** The GPU's magnification of an sRGB texture: decoded to linear, filtered, encoded. */
function gpuBilinear(r: Raster, width: number, height: number): Raster {
  const lin = raster(r.width, r.height, r.channels, Float32Array.from(r.data, linearFromSrgb));
  const up = bilinearResize(lin, width, height);
  return raster(width, height, r.channels, Float32Array.from(up.data, srgbFromLinear));
}

/** CIEDE2000 of `output` against the original `truth`, overall and per tone bucket of the truth. */
function fidelity(truth: Raster, output: Raster) {
  const lab = (r: Raster, i: number) =>
    labFromLinear(
      [0, 1, 2].map((k) => linearFromSrgb(r.data[i * r.channels + k] as number)) as [
        number,
        number,
        number,
      ],
    );
  const all: number[] = [];
  const by = new Map<ToneBucket, number[]>(TONE_BUCKETS.map((t) => [t.name, []]));
  for (let i = 0; i < truth.width * truth.height; i++) {
    const t = lab(truth, i);
    const d = deltaE2000(t, lab(output, i));
    all.push(d);
    by.get(toneBucket(t))?.push(d);
  }
  return {
    ...stat(all),
    buckets: Object.fromEntries([...by].map(([k, v]) => [k, stat(v)])) as Record<ToneBucket, Stat>,
  };
}

const skinsDir = path.join(systemDir, "skins");
const skins = fs
  .readdirSync(skinsDir, { recursive: true, encoding: "utf8" })
  .filter((f) => /\.(png|jpe?g)$/i.test(f))
  .sort();

// The low-resolution inputs, written once as 8-bit PNGs (what an upscaler is
// given in practice), so every method reads the same pixels.
const truths = new Map<string, Raster>();
for (const f of skins) {
  const id = path.basename(path.dirname(f));
  const truth = rgb(await readRaster(path.join(skinsDir, f)));
  truths.set(id, truth);
  await writeRaster(areaResize(truth, LOW, LOW), path.join(workDir, "low", `${id}.png`), 8);
}

let esrgan: { tool: string; weights: string; weightsSha256: string; binarySha256: string } | null =
  null;
if (esrganDir) {
  const binary = path.join(esrganDir, "realesrgan-ncnn-vulkan");
  const weights = path.join(esrganDir, "models", "realesrgan-x4plus.bin");
  // One image a run (the 20220424 macOS build crashes when given a directory), and
  // its models named outright: it otherwise looks for them in the working directory.
  for (const id of truths.keys())
    execFileSync(
      binary,
      [
        "-i",
        path.join(workDir, "low", `${id}.png`),
        "-o",
        path.join(workDir, "esrgan", `${id}.png`),
        "-m",
        path.join(esrganDir, "models"),
        "-n",
        "realesrgan-x4plus",
        "-s",
        String(SCALE),
        "-f",
        "png",
      ],
      { stdio: "ignore" },
    );
  esrgan = {
    tool: "realesrgan-ncnn-vulkan 20220424 (MIT; ncnn BSD-3-Clause)",
    weights: "realesrgan-x4plus (BSD-3-Clause, xinntao/Real-ESRGAN)",
    weightsSha256: sha(weights),
    binarySha256: sha(binary),
  };
}

const albedo = [];
for (const [id, truth] of truths) {
  const low = await readRaster(path.join(workDir, "low", `${id}.png`));
  const size = LOW * SCALE;
  const methods: [string, Raster][] = [
    ["GPU bilinear", gpuBilinear(low, size, size)],
    ["lanczos3 back-projected", upscaleAlbedo(low, size, size, false)],
  ];
  if (esrgan)
    methods.push([
      "Real-ESRGAN x4plus",
      rgb(await readRaster(path.join(workDir, "esrgan", `${id}.png`))),
    ]);
  for (const [method, output] of methods) {
    const roundTrip = roundTripAlbedo(low, output);
    const detail = newDetail(low, output, albedoSpace, undefined, COLOUR_RANGE);
    const fid = fidelity(truth, output);
    albedo.push({
      skin: id,
      method,
      roundTrip,
      detail,
      fidelity: fid,
      pass: roundTrip.pass && detail.pass,
    });
    console.log(
      `${id.padEnd(36)} ${method.padEnd(24)} to original ${fid.mean.toFixed(3)}/${fid.p99.toFixed(2)}  ` +
        `round trip ${roundTrip.mean.toFixed(3)}/${roundTrip.p99.toFixed(3)} new detail ` +
        `+${(detail.excess * 100).toFixed(2)}pp (tile p99 +${(detail.localP99 * 100).toFixed(1)}pp) ` +
        `${roundTrip.pass && detail.pass ? "PASS" : "FAIL"}`,
    );
  }
}

const albedoSummary: Record<string, unknown> = {};
for (const method of [...new Set(albedo.map((r) => r.method))]) {
  const of = albedo.filter((r) => r.method === method);
  const buckets = Object.fromEntries(
    TONE_BUCKETS.map(({ name }) => {
      const gated = of.filter((r) => r.roundTrip.buckets[name].n >= BUCKET_MIN_TEXELS);
      const rt = gated.map((r) => r.roundTrip.buckets[name]);
      return [
        name,
        {
          skins: gated.length,
          roundTripMeanMax: r3(Math.max(0, ...rt.map((b) => b.mean))),
          roundTripP99Max: r3(Math.max(0, ...rt.map((b) => b.p99))),
          luminanceBiasMax: r3(Math.max(0, ...rt.map((b) => Math.abs(b.luminanceBias)))),
          toOriginalMedian: r3(median(gated.map((r) => r.fidelity.buckets[name].mean))),
        },
      ];
    }),
  );
  albedoSummary[method] = {
    passed: `${of.filter((r) => r.pass).length}/${of.length}`,
    toOriginalMedian: r3(median(of.map((r) => r.fidelity.mean))),
    newDetailExcessMax: r3(Math.max(...of.map((r) => r.detail.excess))),
    newDetailTileP99Max: r3(Math.max(...of.map((r) => r.detail.localP99))),
    buckets,
  };
  console.log(
    `\n${method}: ${of.filter((r) => r.pass).length}/${of.length} skins pass the gates; ` +
      `median CIEDE2000 to the original ${median(of.map((r) => r.fidelity.mean)).toFixed(3)}`,
  );
  console.table(buckets);
}

// ---------------------------------------------------------------- normals

/** The angle, in degrees, between two encoded normals. */
const angle = (a: Raster, i: number, b: Raster) => {
  const v = [0, 1, 2].map((k) => (a.data[i * a.channels + k] as number) * 2 - 1);
  const u = [0, 1, 2].map((k) => (b.data[i * b.channels + k] as number) * 2 - 1);
  const dot =
    v.reduce((s, x, k) => s + x * (u[k] as number), 0) / (Math.hypot(...v) * Math.hypot(...u));
  return (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
};

const normalFiles = fs
  .readdirSync(path.join(systemDir, "clothes"), { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith("_normal.png"))
  .sort();
const normals: {
  map: string;
  method: string;
  toOriginal: Stat;
  roundTrip: ReturnType<typeof roundTripNormal>;
  detail: ReturnType<typeof newDetail>;
  pass: boolean;
}[] = [];
for (const f of normalFiles) {
  const original = await readRaster(path.join(systemDir, "clothes", f));
  if (original.width < 4096) continue;
  const truth = areaResizeNormal(original, 2048, 2048);
  const low = eightBit(areaResizeNormal(original, 1024, 1024));
  const interior = normalInterior(low, 2048, 2048);
  const truthValid = slopesOf(truth).valid;
  for (const [method, output] of [
    ["GPU bilinear", bilinearResize(low, 2048, 2048)],
    ["height, re-derived", upscaleNormal(low, 2048, 2048)],
  ] as const) {
    const d: number[] = [];
    for (let i = 0; i < 2048 * 2048; i++)
      if (truthValid.data[i] && (interior[i] as number) >= 1) d.push(angle(output, i, truth));
    const toOriginal = stat(d);
    const roundTrip = roundTripNormal(low, output);
    const detail = newDetail(low, output, slopeSpace, interior);
    normals.push({
      map: f,
      method,
      toOriginal,
      roundTrip,
      detail,
      pass: roundTrip.pass && detail.pass,
    });
    console.log(
      `${f.padEnd(52)} ${method.padEnd(20)} to original ${toOriginal.mean.toFixed(3)}°/${toOriginal.p99.toFixed(2)}°  ` +
        `round trip ${roundTrip.mean.toFixed(3)}°/${roundTrip.p99.toFixed(3)}° new detail ` +
        `+${(detail.excess * 100).toFixed(2)}pp (tile p99 +${(detail.localP99 * 100).toFixed(1)}pp) ` +
        `${roundTrip.pass && detail.pass ? "PASS" : "FAIL"}`,
    );
  }
}
const normalSummary = Object.fromEntries(
  [...new Set(normals.map((r) => r.method))].map((method) => {
    const of = normals.filter((r) => r.method === method);
    return [
      method,
      {
        passed: `${of.filter((r) => r.pass).length}/${of.length}`,
        toOriginalMeanMedian: r3(median(of.map((r) => r.toOriginal.mean))),
        toOriginalP99Median: r3(median(of.map((r) => r.toOriginal.p99))),
      },
    ];
  }),
);
console.log("\nnormals ×2 from 1024² to the 4096² original at 2048²:");
console.table(normalSummary);

if (jsonOut)
  fs.writeFileSync(
    jsonOut,
    JSON.stringify(
      {
        esrgan,
        albedo: { low: LOW, scale: SCALE, summary: albedoSummary, results: albedo },
        normals: { summary: normalSummary, results: normals },
      },
      null,
      1,
    ),
  );
