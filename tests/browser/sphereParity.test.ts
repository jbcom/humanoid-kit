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
  NoToneMapping,
  OrthographicCamera,
  Scene,
  SphereGeometry,
  WebGLRenderer,
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
import {
  CURVATURE_ATTRIBUTE,
  SKIN_MASK_ATTRIBUTE,
  SkinMaterial,
} from "../../src/render/skinMaterial.ts";
import { SKIN_SCATTER, scatterDistance, scatterTableDiffuse } from "../../src/surface/scatter.ts";
import type { Rgb, SkinTone } from "../../src/surface/skinTone.ts";

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
const BINS = [
  { name: "lit", lo: 0.7, hi: 1.01 },
  { name: "shoulder", lo: 0.3, hi: 0.7 },
  { name: "terminator", lo: -0.2, hi: 0.3 },
] as const;
type BinName = (typeof BINS)[number]["name"];

const canvas = document.createElement("canvas");
const renderer = new WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE, false);
const target = new WebGLRenderTarget(SIZE, SIZE, { type: FloatType });
const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.set(0, 0, 5);
camera.lookAt(0, 0, 0);
const geometry = new SphereGeometry(1, 256, 128);
const vertexCount = geometry.getAttribute("position").count;
geometry.setAttribute(
  SKIN_MASK_ATTRIBUTE,
  new BufferAttribute(new Float32Array(vertexCount * 3), 3),
);
geometry.setAttribute(
  CURVATURE_ATTRIBUTE,
  new BufferAttribute(new Float32Array(vertexCount).fill(1 / FEATURE_RADIUS), 1),
);
const material = new SkinMaterial();
const scene = new Scene();
scene.add(new Mesh(geometry, material));
const light = new DirectionalLight(0xffffff, Math.PI);
scene.add(light, light.target);
const pixels = new Float32Array(SIZE * SIZE * 4);
const bytes = new Uint8Array(SIZE * SIZE * 4);

afterAll(() => {
  geometry.dispose();
  material.dispose();
  target.dispose();
  renderer.dispose();
});

type Mode = "lambert" | "scatter" | "specular";

/** Puts the material in a measurement mode: everything but the term under test is off. */
function configure(s: Swatch, mode: Mode): void {
  material.setAppearance({ tone: s.tone, flush: 0, lips: 0, areola: 0 });
  material.sheen = 0;
  material.clearcoat = 0;
  material.normalMap = null;
  material.specularIntensity = mode === "specular" ? 1 : 0;
  material.hkUniforms.hkScatterMfp.value = mode === "lambert" ? 0 : SKIN_SCATTER.mfp;
  if (mode === "specular") material.color.setRGB(0, 0, 0);
  material.needsUpdate = true;
}

interface Measured {
  /** Bin means: linear radiance, or 8-bit sRGB values on the display path. */
  rendered: Record<BinName, Rgb>;
  expected: Record<BinName, Rgb>;
  /** Mean rendered value over the whole lit disc. */
  disc: Rgb;
}

/**
 * Where the render is read: `linear` from the float target (shading only), or
 * `display` from the canvas, through the studio's tone mapping and sRGB
 * encoding, with the expectation sent through the same curve in TypeScript.
 */
type Path = "linear" | "display";

function render(path: Path): ArrayLike<number> {
  renderer.setClearColor(0x000000, 0);
  if (path === "linear") {
    renderer.toneMapping = NoToneMapping;
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels);
    renderer.setRenderTarget(null);
    return pixels;
  }
  renderer.toneMapping = STUDIO_TONE_MAPPING;
  renderer.toneMappingExposure = STUDIO_EXPOSURE;
  renderer.setRenderTarget(null);
  renderer.clear();
  renderer.render(scene, camera);
  // Read in the same task as the render, before the canvas is composited.
  const gl = renderer.getContext();
  gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  return bytes;
}

/** Renders the sphere lit from `angle` degrees off the view axis and bins it by N·L. */
function measure(angle: number, expect: (nDotL: number) => Rgb, path: Path = "linear"): Measured {
  const a = (angle * Math.PI) / 180;
  const l = [Math.sin(a), 0, Math.cos(a)] as const;
  light.position.set(l[0] * 10, l[1] * 10, l[2] * 10);
  const pixels = render(path);
  const shown = (e: Rgb): Rgb =>
    path === "linear" ? e : (neutralToneMap(e, STUDIO_EXPOSURE).map(srgb8FromLinear) as Rgb);
  const sums = Object.fromEntries(
    BINS.map((b) => [b.name, { r: [0, 0, 0], e: [0, 0, 0], n: 0 }]),
  ) as Record<BinName, { r: number[]; e: number[]; n: number }>;
  const disc = [0, 0, 0];
  let discN = 0;
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
      const e = shown(expect(nDotL));
      for (let k = 0; k < 3; k++) {
        s.r[k] = (s.r[k] as number) + (pixels[o + k] as number);
        s.e[k] = (s.e[k] as number) + (e[k] as number);
      }
      s.n++;
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
  };
}

const lab = (c: Rgb): Lab => labFromLinear(c);
const albedoOf = (): Rgb => [material.color.r, material.color.g, material.color.b];

/** The material's own model for the current swatch: radiance at N·L, per channel. */
function modelRadiance(): (nDotL: number) => Rgb {
  const u = material.hkUniforms;
  const A = albedoOf();
  const d = scatterDistance(
    A,
    u.hkScatterMfp.value,
    u.hkScatterSlope.value,
    u.hkPigmentDepth.value,
    [u.hkSubstrate.value.x, u.hkSubstrate.value.y, u.hkSubstrate.value.z],
  );
  return (n) =>
    A.map((c, k) => c * scatterTableDiffuse(n, (d[k] as number) / FEATURE_RADIUS)) as Rgb;
}

describe("skin material on an analytic sphere", () => {
  it("renders Lambert's A·N·L for every colour when scatter is off", () => {
    const failures: string[] = [];
    for (const s of PALETTE) {
      configure(s, "lambert");
      const A = albedoOf();
      for (const angle of ANGLES) {
        const m = measure(angle, (n) => A.map((c) => c * Math.max(n, 0)) as Rgb);
        for (const bin of ["lit", "shoulder"] as const) {
          const de = deltaE2000(lab(m.rendered[bin]), lab(m.expected[bin]));
          if (!(de <= 0.5)) failures.push(`${s.name} ${angle}° ${bin}: ΔE00 ${de.toFixed(2)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("renders exactly its scatter model, in every bin, for every colour", () => {
    const failures: string[] = [];
    for (const s of PALETTE) {
      configure(s, "scatter");
      const model = modelRadiance();
      for (const angle of ANGLES) {
        const m = measure(angle, model);
        for (const { name: bin } of BINS) {
          const de = deltaE2000(lab(m.rendered[bin]), lab(m.expected[bin]));
          if (!(de <= 0.5)) failures.push(`${s.name} ${angle}° ${bin}: ΔE00 ${de.toFixed(2)}`);
        }
      }
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
    // BabelColor's ColorChecker comparisons flag a CIEDE2000 difference above 1.3.
    expect(lit.filter((x) => x.de > 1.3)).toEqual([]);
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

  it("reflects the same specular from every base colour", () => {
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
