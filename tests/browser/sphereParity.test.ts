/**
 * Stage 1 of colour parity (docs/research/ALGORITHMIC-APPEARANCE.md §5.2):
 * the skin material's diffuse shading, before tone mapping and display
 * encoding, measured on an analytic sphere against its own model.
 *
 * A unit sphere is drawn by an orthographic camera into a float render target
 * (three applies no tone mapping there), lit by one white directional light of
 * intensity π, so Lambert radiance is exactly A · N·L. Each pixel's normal is
 * known analytically from its place on the disc, so every pixel has an exact
 * expectation, binned by N·L: lit, shoulder and terminator.
 *
 * The palette spans the measured human skin range, the ColorChecker and the
 * fur, scale and fantasy colours the library promises, so a shading path that
 * only works for some colours fails here.
 */
import {
  BufferAttribute,
  DirectionalLight,
  FloatType,
  Mesh,
  MeshPhysicalMaterial,
  NoToneMapping,
  OrthographicCamera,
  Scene,
  SphereGeometry,
  Vector2,
  WebGLRenderTarget,
} from "three";
import { afterAll, describe, expect, it } from "vitest";
import {
  deltaE2000,
  type Lab,
  labFromLinear,
  labFromSrgb8,
  neutralToneMap,
  srgb8FromLinear,
} from "../../e2e/lib/colour.ts";
import { STUDIO_EXPOSURE, STUDIO_TONE_MAPPING } from "../../src/react/StudioStage.tsx";
import { CURVATURE_ATTRIBUTE, SkinMaterial } from "../../src/render/skinMaterial.ts";
import { SKIN_SCATTER, scatterDistance, scatterTableDiffuse } from "../../src/surface/scatter.ts";
import type { Rgb, SkinTone } from "../../src/surface/skinTone.ts";
import { createTestRenderer } from "./gl.ts";

interface Swatch {
  name: string;
  tone: SkinTone;
}

const tone = (t: Partial<SkinTone>): SkinTone => ({
  melanin: 0.35,
  haemoglobin: 0.5,
  undertone: 0,
  override: null,
  ...t,
});
const colour = (name: string, override: Rgb): Swatch => ({ name, tone: tone({ override }) });

const PALETTE: Swatch[] = [
  // The 11 measured ISSA anchors (melanin 0, 0.1, ..., 1).
  ...Array.from({ length: 11 }, (_, i) => ({
    name: `skin melanin ${i / 10}`,
    tone: tone({ melanin: i / 10 }),
  })),
  // ColorChecker Classic (post-2014), linear sRGB D65 (§5.1).
  colour("dark skin", [0.174, 0.079, 0.053]),
  colour("light skin", [0.56, 0.277, 0.211]),
  colour("blue sky", [0.104, 0.189, 0.329]),
  colour("foliage", [0.106, 0.151, 0.051]),
  colour("blue flower", [0.227, 0.212, 0.426]),
  colour("bluish green", [0.115, 0.507, 0.411]),
  colour("orange", [0.746, 0.202, 0.03]),
  colour("purplish blue", [0.059, 0.101, 0.388]),
  colour("moderate red", [0.56, 0.08, 0.115]),
  colour("purple", [0.109, 0.042, 0.138]),
  colour("yellow green", [0.333, 0.497, 0.043]),
  colour("orange yellow", [0.771, 0.358, 0.02]),
  colour("blue", [0.021, 0.048, 0.284]),
  colour("green", [0.046, 0.292, 0.061]),
  colour("red", [0.446, 0.036, 0.041]),
  colour("yellow", [0.842, 0.574, 0.005]),
  colour("magenta", [0.522, 0.078, 0.289]),
  colour("cyan", [0, 0.234, 0.377]),
  colour("white 9.5", [0.88, 0.885, 0.834]),
  colour("neutral 8", [0.585, 0.592, 0.584]),
  colour("neutral 6.5", [0.358, 0.367, 0.365]),
  colour("neutral 5", [0.19, 0.191, 0.19]),
  colour("neutral 3.5", [0.086, 0.089, 0.09]),
  colour("black 2", [0.031, 0.031, 0.032]),
  // Fur, scales and fantasy, and the extremes.
  colour("white fur", [0.78, 0.76, 0.72]),
  colour("near-black scales", [0.025, 0.025, 0.03]),
  colour("green scales", [0.07, 0.22, 0.06]),
  colour("blue skin", [0.06, 0.11, 0.36]),
  colour("red fur", [0.42, 0.06, 0.035]),
  colour("violet", [0.2, 0.06, 0.3]),
  colour("golden fur", [0.55, 0.36, 0.1]),
  colour("near-white", [0.9, 0.9, 0.9]),
  colour("velvet black", [0.01, 0.01, 0.01]),
  colour("saturated red", [0.6, 0.02, 0.02]),
  colour("saturated green", [0.02, 0.5, 0.02]),
  colour("saturated blue", [0.02, 0.04, 0.6]),
  colour("cyan fur", [0.02, 0.45, 0.55]),
  colour("yellow scales", [0.75, 0.6, 0.02]),
];

const SIZE = 256;
const ANGLES = [0, 45, 70];
/** Radius of the feature the curvature stands for, metres: about a nose tip. */
const FEATURE_RADIUS = 0.02;
/** An ear rim or nostril: tight enough that scatter changes the shading steeply. */
const TIGHT_RADIUS = 0.003;
const BINS = [
  { name: "lit", lo: 0.7, hi: 1.01 },
  { name: "shoulder", lo: 0.3, hi: 0.7 },
  { name: "terminator", lo: -0.2, hi: 0.3 },
] as const;
type BinName = (typeof BINS)[number]["name"];

const renderer = createTestRenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE, false);
const target = new WebGLRenderTarget(SIZE, SIZE, { type: FloatType });
const TILE_COLUMNS = 4;
const TILE_ROWS = 2;
const TILE_CAPACITY = TILE_COLUMNS * TILE_ROWS;
// Float target + readback + extracted cells: 8 * 256² * RGBA * 4 bytes each.
const tileTarget = new WebGLRenderTarget(SIZE * TILE_COLUMNS, SIZE * TILE_ROWS, {
  type: FloatType,
});
const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.set(0, 0, 5);
camera.lookAt(0, 0, 0);
const geometry = new SphereGeometry(1, 256, 128);
const vertexCount = geometry.getAttribute("position").count;
// No layer atlas is set, so every skin layer is absent and the sphere shows the bare skin.
const curvature = new BufferAttribute(new Float32Array(vertexCount), 1);
geometry.setAttribute(CURVATURE_ATTRIBUTE, curvature);
/** Makes the sphere's curvature attribute stand for a feature of this radius. */
function setFeatureRadius(radius: number): void {
  (curvature.array as Float32Array).fill(1 / radius);
  curvature.needsUpdate = true;
}
setFeatureRadius(FEATURE_RADIUS);
const material = new SkinMaterial();
const scene = new Scene();
const mesh = new Mesh<SphereGeometry, MeshPhysicalMaterial>(geometry, material);
scene.add(mesh);
const light = new DirectionalLight(0xffffff, Math.PI);
scene.add(light, light.target);
const pixels = new Float32Array(SIZE * SIZE * 4);
const bytes = new Uint8Array(SIZE * SIZE * 4);

afterAll(() => {
  geometry.dispose();
  material.dispose();
  target.dispose();
  tileTarget.dispose();
});

type Mode = "lambert" | "scatter" | "specular" | "production";

const PRODUCTION = new SkinMaterial();

/**
 * Puts the material in a measurement mode: everything but the term under test
 * is off, except in `production`, which keeps every setting the creator uses
 * (sheen, specular, the pore normal map) and turns off only the scatter.
 */
function configure(s: Swatch, mode: Mode): void {
  mesh.material = material;
  material.setAppearance({ tone: s.tone, flush: 0, lips: 0, areola: 0 });
  if (mode === "production") {
    material.sheen = PRODUCTION.sheen;
    material.specularIntensity = PRODUCTION.specularIntensity;
    material.normalMap = PRODUCTION.normalMap;
    material.hkUniforms.hkScatterMfp.value = 0;
  } else {
    material.sheen = 0;
    material.normalMap = null;
    material.specularIntensity = mode === "specular" ? 1 : 0;
    material.hkUniforms.hkScatterMfp.value = mode === "lambert" ? 0 : SKIN_SCATTER.mfp;
    if (mode === "specular") material.color.setRGB(0, 0, 0);
  }
  material.clearcoat = 0;
  material.needsUpdate = true;
}

/** three's own physical material with every setting of the skin material. */
function threeReference(): MeshPhysicalMaterial {
  const m = new MeshPhysicalMaterial();
  for (const key of [
    "roughness",
    "metalness",
    "ior",
    "sheen",
    "sheenRoughness",
    "specularIntensity",
    "clearcoat",
  ] as const)
    m[key] = material[key];
  m.color.copy(material.color);
  m.sheenColor.copy(material.sheenColor);
  m.specularColor.copy(material.specularColor);
  m.normalMap = material.normalMap;
  m.normalScale.copy(material.normalScale);
  return m;
}

interface Measured {
  /** Bin means: linear radiance, or 8-bit sRGB values on the display path. */
  rendered: Record<BinName, Rgb>;
  expected: Record<BinName, Rgb>;
  /** Mean rendered value over the whole lit disc. */
  disc: Rgb;
  /** Largest per-pixel, per-channel difference from the expectation over the binned pixels. */
  worst: number;
}

/** What a pixel should be: from its N·L, or from a reference render at the same pixel offset. */
type Expectation = (nDotL: number, offset: number) => Rgb;

/**
 * Where the render is read: `linear` from the float target (shading only), or
 * `display` from the canvas, through the studio's tone mapping and sRGB
 * encoding, with the expectation sent through the same curve in TypeScript.
 */
type Path = "linear" | "display";

interface PhaseMetrics {
  calls: number;
  renderMs: number;
  readbackMs: number;
  cpuBinAndReferenceMs: number;
  referenceReplayMs: number;
  deltaEMs: number;
}

interface PhaseProfile extends PhaseMetrics {
  first: PhaseMetrics | null;
  tile: {
    cells: number;
    fences: number;
    renderMs: number;
    readbackMs: number;
    bufferBytes: number;
  };
}

function phaseProfile(): PhaseProfile {
  return {
    calls: 0,
    renderMs: 0,
    readbackMs: 0,
    cpuBinAndReferenceMs: 0,
    referenceReplayMs: 0,
    deltaEMs: 0,
    first: null,
    tile: { cells: 0, fences: 0, renderMs: 0, readbackMs: 0, bufferBytes: 0 },
  };
}

function phaseSnapshot(profile: PhaseProfile): PhaseMetrics {
  return {
    calls: profile.calls,
    renderMs: profile.renderMs,
    readbackMs: profile.readbackMs,
    cpuBinAndReferenceMs: profile.cpuBinAndReferenceMs,
    referenceReplayMs: profile.referenceReplayMs,
    deltaEMs: profile.deltaEMs,
  };
}

function phaseDelta(after: PhaseMetrics, before: PhaseMetrics): PhaseMetrics {
  return {
    calls: after.calls - before.calls,
    renderMs: after.renderMs - before.renderMs,
    readbackMs: after.readbackMs - before.readbackMs,
    cpuBinAndReferenceMs: after.cpuBinAndReferenceMs - before.cpuBinAndReferenceMs,
    referenceReplayMs: after.referenceReplayMs - before.referenceReplayMs,
    deltaEMs: after.deltaEMs - before.deltaEMs,
  };
}

function reportPhaseProfile(profile: PhaseProfile, phase: "representative" | "progress" | "full") {
  console.info(
    "sphere-parity-phase-profile",
    JSON.stringify({
      phase,
      ...phaseSnapshot(profile),
      first: profile.first,
      tile: profile.tile,
    }),
  );
}

function render(path: Path, profile?: PhaseProfile): ArrayLike<number> {
  renderer.setClearColor(0x000000, 0);
  if (path === "linear") {
    renderer.toneMapping = NoToneMapping;
    renderer.setRenderTarget(target);
    renderer.clear();
    const renderStarted = performance.now();
    renderer.render(scene, camera);
    if (profile) profile.renderMs += performance.now() - renderStarted;
    const readbackStarted = performance.now();
    renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels);
    if (profile) profile.readbackMs += performance.now() - readbackStarted;
    renderer.setRenderTarget(null);
    return pixels;
  }
  renderer.toneMapping = STUDIO_TONE_MAPPING;
  renderer.toneMappingExposure = STUDIO_EXPOSURE;
  renderer.setRenderTarget(null);
  renderer.clear();
  const renderStarted = performance.now();
  renderer.render(scene, camera);
  if (profile) profile.renderMs += performance.now() - renderStarted;
  // Read in the same task as the render, before the canvas is composited.
  const gl = renderer.getContext();
  const readbackStarted = performance.now();
  gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  if (profile) profile.readbackMs += performance.now() - readbackStarted;
  return bytes;
}

/**
 * The linear target is RGBA FloatType. Three supports asynchronous target
 * readback for that type; retain the synchronous path only long enough to
 * make an unsupported implementation fail this diagnostic explicitly.
 */
let asyncReadbackFallbackUsed = false;

async function renderLinearAsync(profile?: PhaseProfile): Promise<Float32Array> {
  renderer.toneMapping = NoToneMapping;
  renderer.setRenderTarget(target);
  renderer.clear();
  const renderStarted = performance.now();
  renderer.render(scene, camera);
  if (profile) profile.renderMs += performance.now() - renderStarted;
  const readbackStarted = performance.now();
  try {
    await renderer.readRenderTargetPixelsAsync(target, 0, 0, SIZE, SIZE, pixels);
  } catch {
    // Keep cleanup/state restoration deterministic, but never mistake this
    // fallback for an asynchronous result: the owning test asserts this flag.
    asyncReadbackFallbackUsed = true;
    renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels);
  }
  if (profile) profile.readbackMs += performance.now() - readbackStarted;
  renderer.setRenderTarget(null);
  return pixels;
}

interface LambertCase {
  swatch: (typeof PALETTE)[number];
  angle: number;
  albedo: Rgb;
}

/**
 * Renders up to eight immutable Lambert cases into fixed-size cells, then makes
 * one Float readback. The canvas/display path intentionally remains separate.
 */
function renderLambertTile(cases: readonly LambertCase[], profile?: PhaseProfile): Float32Array[] {
  if (cases.length === 0 || cases.length > TILE_CAPACITY) throw new Error("invalid tile size");
  const packed = new Float32Array(tileTarget.width * tileTarget.height * 4);
  renderer.toneMapping = NoToneMapping;
  renderer.initRenderTarget(tileTarget);
  const renderStarted = performance.now();
  try {
    for (const [index, entry] of cases.entries()) {
      configure(entry.swatch, "lambert");
      const column = index % TILE_COLUMNS;
      const row = Math.floor(index / TILE_COLUMNS);
      const x = column * SIZE;
      const y = row * SIZE;
      light.position.set(
        Math.sin((entry.angle * Math.PI) / 180) * 10,
        0,
        Math.cos((entry.angle * Math.PI) / 180) * 10,
      );
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.copyTextureToTexture(target.texture, tileTarget.texture, null, new Vector2(x, y));
    }
    const renderMs = performance.now() - renderStarted;
    const readbackStarted = performance.now();
    renderer.readRenderTargetPixels(tileTarget, 0, 0, tileTarget.width, tileTarget.height, packed);
    if (profile) {
      profile.renderMs += renderMs;
      profile.readbackMs += performance.now() - readbackStarted;
      profile.tile.cells += cases.length;
      profile.tile.fences++;
      profile.tile.renderMs += renderMs;
      profile.tile.readbackMs += performance.now() - readbackStarted;
      profile.tile.bufferBytes += packed.byteLength;
    }
  } finally {
    renderer.setViewport(0, 0, SIZE, SIZE);
    renderer.setScissor(0, 0, SIZE, SIZE);
    renderer.setRenderTarget(null);
  }
  return cases.map((_, index) => {
    const cell = new Float32Array(SIZE * SIZE * 4);
    const column = index % TILE_COLUMNS;
    const row = Math.floor(index / TILE_COLUMNS);
    for (let py = 0; py < SIZE; py++) {
      const from = ((row * SIZE + py) * tileTarget.width + column * SIZE) * 4;
      cell.set(packed.subarray(from, from + SIZE * 4), py * SIZE * 4);
    }
    return cell;
  });
}

/** Measures the same analytic expectation calls without changing the assertion's result. */
function replayReference(angle: number, expect: Expectation, path: Path): number {
  const started = performance.now();
  const a = (angle * Math.PI) / 180;
  const l = [Math.sin(a), 0, Math.cos(a)] as const;
  const shown = (e: Rgb): Rgb =>
    path === "linear" ? e : (neutralToneMap(e, STUDIO_EXPOSURE).map(srgb8FromLinear) as Rgb);
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const x = ((px + 0.5) / SIZE) * 2 - 1;
      const y = ((py + 0.5) / SIZE) * 2 - 1;
      const r2 = x * x + y * y;
      if (r2 > 0.96 * 0.96) continue;
      const nDotL = x * l[0] + y * l[1] + Math.sqrt(1 - r2) * l[2];
      if (!BINS.some((bin) => nDotL >= bin.lo && nDotL < bin.hi)) continue;
      const offset = (py * SIZE + px) * 4;
      void shown(expect(nDotL, offset));
    }
  }
  return performance.now() - started;
}

/** Bins a completed sphere readback by N·L. */
function measurePixels(
  angle: number,
  expect: Expectation,
  path: Path,
  pixels: ArrayLike<number>,
  profile?: PhaseProfile,
  before?: PhaseMetrics | null,
): Measured {
  const a = (angle * Math.PI) / 180;
  const l = [Math.sin(a), 0, Math.cos(a)] as const;
  let worst = 0;
  const shown = (e: Rgb): Rgb =>
    path === "linear" ? e : (neutralToneMap(e, STUDIO_EXPOSURE).map(srgb8FromLinear) as Rgb);
  const sums = Object.fromEntries(
    BINS.map((b) => [b.name, { r: [0, 0, 0], e: [0, 0, 0], n: 0 }]),
  ) as Record<BinName, { r: number[]; e: number[]; n: number }>;
  const disc = [0, 0, 0];
  let discN = 0;
  const binsStarted = performance.now();
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const x = ((px + 0.5) / SIZE) * 2 - 1;
      const y = ((py + 0.5) / SIZE) * 2 - 1;
      const r2 = x * x + y * y;
      // Stay off the silhouette, where the tessellated sphere departs from the disc.
      if (r2 > 0.96 * 0.96) continue;
      const nDotL = x * l[0] + y * l[1] + Math.sqrt(1 - r2) * l[2];
      const o = (py * SIZE + px) * 4;
      for (let k = 0; k < 3; k++) disc[k] = (disc[k] as number) + (pixels[o + k] as number);
      discN++;
      const bin = BINS.find((b) => nDotL >= b.lo && nDotL < b.hi);
      if (!bin) continue;
      const s = sums[bin.name];
      const e = shown(expect(nDotL, o));
      for (let k = 0; k < 3; k++) {
        s.r[k] = (s.r[k] as number) + (pixels[o + k] as number);
        s.e[k] = (s.e[k] as number) + (e[k] as number);
        worst = Math.max(worst, Math.abs((pixels[o + k] as number) - (e[k] as number)));
      }
      s.n++;
    }
  }
  if (profile) {
    profile.cpuBinAndReferenceMs += performance.now() - binsStarted;
    profile.calls++;
    if (!profile.first && before) {
      profile.referenceReplayMs += replayReference(angle, expect, path);
      profile.first = phaseDelta(phaseSnapshot(profile), before);
      reportPhaseProfile(profile, "representative");
    } else if (profile.calls === 16 || profile.calls === 64 || profile.calls === 128) {
      reportPhaseProfile(profile, "progress");
    }
  }
  const mean = (v: number[], n: number) => v.map((c) => c / Math.max(1, n)) as Rgb;
  return {
    rendered: Object.fromEntries(
      BINS.map((b) => [b.name, mean(sums[b.name].r, sums[b.name].n)]),
    ) as Record<BinName, Rgb>,
    expected: Object.fromEntries(
      BINS.map((b) => [b.name, mean(sums[b.name].e, sums[b.name].n)]),
    ) as Record<BinName, Rgb>,
    disc: mean(disc, discN),
    worst,
  };
}

/** Renders the sphere lit from `angle` degrees off the view axis and bins it by N·L. */
function measure(
  angle: number,
  expect: Expectation,
  path: Path = "linear",
  profile?: PhaseProfile,
): Measured {
  const before = profile ? phaseSnapshot(profile) : null;
  return measurePixels(angle, expect, path, renderAt(angle, path, profile), profile, before);
}

/** Lights the sphere from `angle` degrees off the view axis and renders it. */
function renderAt(angle: number, path: Path, profile?: PhaseProfile): ArrayLike<number> {
  const a = (angle * Math.PI) / 180;
  light.position.set(Math.sin(a) * 10, 0, Math.cos(a) * 10);
  return render(path, profile);
}

const lab = (c: Rgb): Lab => labFromLinear(c);
const albedoOf = (): Rgb => [material.color.r, material.color.g, material.color.b];

function measuredDeltaE(a: Lab, b: Lab, profile?: PhaseProfile): number {
  const started = performance.now();
  const result = deltaE2000(a, b);
  if (profile) profile.deltaEMs += performance.now() - started;
  return result;
}

/** The material's own model for the current swatch on a feature of `radius`: radiance at N·L, per channel. */
function modelRadiance(radius = FEATURE_RADIUS): (nDotL: number) => Rgb {
  const u = material.hkUniforms;
  const A = albedoOf();
  const d = scatterDistance(
    A,
    u.hkScatterMfp.value,
    u.hkScatterSlope.value,
    u.hkPigmentDepth.value,
    [u.hkSubstrate.value.x, u.hkSubstrate.value.y, u.hkSubstrate.value.z],
  );
  return (n) => A.map((c, k) => c * scatterTableDiffuse(n, (d[k] as number) / radius)) as Rgb;
}

describe("skin material on an analytic sphere", () => {
  it("matches synchronous, asynchronous, and every 4×2 tile Float cell before checking Lambert's A·N·L", async () => {
    const firstSwatch = PALETTE[0];
    const parityAngle = ANGLES[1];
    if (!firstSwatch || parityAngle === undefined)
      throw new Error("sphere parity constants are empty");
    const parityCases = PALETTE.slice(0, TILE_CAPACITY).map((swatch, index) => {
      configure(swatch, "lambert");
      return { swatch, angle: ANGLES[index % ANGLES.length] as number, albedo: albedoOf() };
    });
    configure(firstSwatch, "lambert");
    const sync = Float32Array.from(renderAt(parityAngle, "linear"));
    const a = (parityAngle * Math.PI) / 180;
    light.position.set(Math.sin(a) * 10, 0, Math.cos(a) * 10);
    const asynchronous = Float32Array.from(await renderLinearAsync());
    expect(asyncReadbackFallbackUsed).toBe(false);
    expect(asynchronous).toEqual(sync);
    const individual = parityCases.map((entry) => {
      configure(entry.swatch, "lambert");
      return Float32Array.from(renderAt(entry.angle, "linear"));
    });
    expect(renderLambertTile(parityCases)).toEqual(individual);
    expect(renderLambertTile(parityCases.slice(0, 3))).toEqual(individual.slice(0, 3));

    const failures: string[] = [];
    const profile = phaseProfile();
    const cases = PALETTE.flatMap((swatch) => {
      configure(swatch, "lambert");
      const albedo = albedoOf();
      return ANGLES.map((angle) => ({ swatch, angle, albedo }));
    });
    for (let first = 0; first < cases.length; first += TILE_CAPACITY) {
      const tile = cases.slice(first, first + TILE_CAPACITY);
      const before = phaseSnapshot(profile);
      const readings = renderLambertTile(tile, profile);
      for (const [index, entry] of tile.entries()) {
        const m = measurePixels(
          entry.angle,
          (n) => entry.albedo.map((c) => c * Math.max(n, 0)) as Rgb,
          "linear",
          readings[index] as Float32Array,
          profile,
          before,
        );
        for (const bin of ["lit", "shoulder"] as const) {
          const de = measuredDeltaE(lab(m.rendered[bin]), lab(m.expected[bin]), profile);
          if (!(de <= 0.5))
            failures.push(`${entry.swatch.name} ${entry.angle}° ${bin}: ΔE00 ${de.toFixed(2)}`);
        }
      }
    }
    reportPhaseProfile(profile, "full");
    expect(asyncReadbackFallbackUsed).toBe(false);
    expect(failures).toEqual([]);
  });

  it("renders exactly its scatter model, in every bin, for every colour, on broad and tight curves", () => {
    const failures: string[] = [];
    for (const radius of [FEATURE_RADIUS, TIGHT_RADIUS]) {
      setFeatureRadius(radius);
      for (const s of PALETTE) {
        configure(s, "scatter");
        const model = modelRadiance(radius);
        const peak = Math.max(...albedoOf(), 1e-3);
        for (const angle of ANGLES) {
          const m = measure(angle, model);
          for (const { name: bin } of BINS) {
            const de = deltaE2000(lab(m.rendered[bin]), lab(m.expected[bin]));
            if (!(de <= 0.5))
              failures.push(`${s.name} r ${radius} ${angle}° ${bin}: ΔE00 ${de.toFixed(2)}`);
          }
          // Bin means can hide a small systematic error (half a texel, say); no
          // single pixel may stray by more than 0.3% of the swatch's peak albedo.
          if (!(m.worst / peak <= 3e-3))
            failures.push(
              `${s.name} r ${radius} ${angle}°: a pixel is off by ${(m.worst / peak).toExponential(1)}`,
            );
        }
      }
    }
    setFeatureRadius(FEATURE_RADIUS);
    expect(failures).toEqual([]);
  });

  // The skin material changes one term of three's physical material, the direct
  // diffuse; with scatter off it must be that material exactly, sheen, specular
  // and the pore normal map included, so three's energy accounting (the sheen
  // layer taking its share of the light, the specular its Fresnel share) is kept.
  it("with scatter off, renders exactly as three's physical material with the creator's settings", () => {
    const failures: string[] = [];
    for (const s of PALETTE) {
      configure(s, "production");
      expect(material.sheen).toBeGreaterThan(0.1);
      const reference = threeReference();
      for (const angle of [0, 45, 70]) {
        mesh.material = reference;
        const ref = Float32Array.from(renderAt(angle, "linear"));
        mesh.material = material;
        const m = measure(angle, (_n, o) => [ref[o], ref[o + 1], ref[o + 2]] as Rgb);
        for (const { name: bin } of BINS) {
          const de = deltaE2000(lab(m.rendered[bin]), lab(m.expected[bin]));
          if (!(de <= 0.2)) failures.push(`${s.name} ${angle}° ${bin}: ΔE00 ${de.toFixed(2)}`);
        }
        if (!(m.worst <= 2e-3)) failures.push(`${s.name} ${angle}°: a pixel is off by ${m.worst}`);
      }
      reference.dispose();
    }
    expect(failures).toEqual([]);
  });

  // Scatter takes light from the lit side round to the terminator, and how far a
  // colour carries it follows from its albedo: light colours further than dark
  // ones, by design (§2). So the lit colour changes more for white (ΔE00 1.0 at
  // this curvature) than for black (0.01), and "the same ΔE for every colour"
  // would contradict the model. What must hold is that no colour visibly
  // changes at its lit peak. How the model treats skin tones is a property of
  // the model, tested on it directly (tests/scatter.test.ts).
  it("changes no colour visibly at its lit peak", () => {
    const lit: { name: string; de: number }[] = [];
    for (const s of PALETTE) {
      configure(s, "scatter");
      const A = albedoOf();
      const m = measure(45, (n) => A.map((c) => c * Math.max(n, 0)) as Rgb);
      lit.push({ name: s.name, de: deltaE2000(lab(m.rendered.lit), lab(m.expected.lit)) });
    }
    // BabelColor's ColorChecker comparisons flag a CIEDE2000 difference above 1.3. Written as
    // "not within" so a NaN (a lost context reads as one) fails, which `de > 1.3` lets through.
    expect(lit.filter((x) => !(x.de <= 1.3))).toEqual([]);
  });

  // Stage 2 (§5.3): given correct shading, the display path. The canvas is read
  // as shown (tone mapped, sRGB encoded, 8 bits) and the expectation is the
  // model's radiance sent through three's curve ported to TypeScript, so dark
  // swatches are not penalised for what the curve does on purpose. A failure
  // means the shader and the expected curve disagree, as after a three upgrade
  // that changes its tone mapping.
  it("shows every colour through the studio's tone mapping as the curve predicts", () => {
    const failures: string[] = [];
    for (const s of PALETTE) {
      configure(s, "scatter");
      const model = modelRadiance();
      for (const angle of ANGLES) {
        const m = measure(angle, model, "display");
        for (const bin of ["lit", "shoulder"] as const) {
          const de = deltaE2000(labFromSrgb8(...m.rendered[bin]), labFromSrgb8(...m.expected[bin]));
          if (!(de <= 1)) failures.push(`${s.name} ${angle}° ${bin}: ΔE00 ${de.toFixed(2)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  // With the base colour black and everything else left as each swatch sets it,
  // nothing the swatch configured may reach the specular: a specular or sheen
  // colour derived from the albedo in setAppearance fails here. (A shader that
  // read the albedo into its specular would not; the reference test above holds
  // the shader to three's own physical material for that.)
  it("derives no specular tint from the base colour", () => {
    const labs: { name: string; lab: Lab }[] = [];
    for (const s of PALETTE) {
      configure(s, "specular");
      const m = measure(45, () => [0, 0, 0]);
      labs.push({ name: s.name, lab: lab(m.disc) });
    }
    const first = labs[0] as { lab: Lab };
    const worst = Math.max(...labs.map((x) => deltaE2000(x.lab, first.lab)));
    expect(first.lab[0]).toBeGreaterThan(1); // there is a highlight to compare
    expect(worst).toBeLessThanOrEqual(0.5);
  });
});
