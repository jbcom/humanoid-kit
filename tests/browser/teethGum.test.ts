/**
 * The teeth's gum recolour on the GPU (src/render/attachmentLook.ts): a texture
 * of tooth texels and gum texels, rendered with the teeth material, shows the
 * teeth at enamel and the gum at the pink the skin tone gives it.
 */
import {
  AmbientLight,
  DataTexture,
  FloatType,
  Mesh,
  NearestFilter,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { afterAll, describe, expect, it } from "vitest";
import type { AttachmentMaterial } from "../../src/format/assetFormat.ts";
import {
  createAttachmentMaterial,
  ENAMEL_LAB,
  TEETH_EXPOSURE,
  TEETH_TEXTURE_MEAN,
  TeethMaterial,
} from "../../src/render/attachmentLook.ts";
import { OCCLUSION_FLOOR, setOcclusionAttributes } from "../../src/render/occlusion.ts";
import { OCCLUSION_KEYS, occlusionCorners } from "../../src/rig/occlusionKeys.ts";
import { linearFromLab } from "../../src/surface/cielab.ts";
import { GUM_LAB, GUM_TEXTURE_MEAN_LUMINANCE } from "../../src/surface/gumTone.ts";
import { luminance, type Rgb } from "../../src/surface/skinTone.ts";

const SIZE = 16;
const renderer = new WebGLRenderer({ canvas: document.createElement("canvas"), antialias: false });
renderer.setSize(SIZE, SIZE, false);
const target = new WebGLRenderTarget(SIZE, SIZE, { type: FloatType });
const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.set(0, 0, 5);
afterAll(() => {
  target.dispose();
  renderer.dispose();
});

const described: AttachmentMaterial = {
  color: [0.64, 0.64, 0.64],
  roughness: 1,
  texture: null,
  transparent: false,
  alphaToCoverage: false,
  backfaceCull: true,
};

/** A plane no cavity shades: an attachment whose occlusion attributes are unset reads enclosed. */
function openPlane(openness = 1): PlaneGeometry {
  const plane = new PlaneGeometry(2, 2);
  const corners = occlusionCorners(OCCLUSION_KEYS.length);
  setOcclusionAttributes(
    plane,
    new Float32Array(plane.getAttribute("position").count * corners).fill(openness),
  );
  return plane;
}

/** The mean linear colour of the left (tooth) and right (gum) halves, not yet divided by the white reference. */
function halves(texels: [Readonly<Rgb>, Readonly<Rgb>], melanin: number, openness = 1): [Rgb, Rgb] {
  const data = new Float32Array(2 * 4);
  texels.forEach((t, i) => {
    data.set([t[0], t[1], t[2], 1], i * 4);
  });
  const map = new DataTexture(data, 2, 1, RGBAFormat, FloatType);
  map.colorSpace = NoColorSpace;
  map.magFilter = NearestFilter;
  map.minFilter = NearestFilter;
  map.needsUpdate = true;
  const material = createAttachmentMaterial("teeth", described);
  material.map = map;
  expect(material).toBeInstanceOf(TeethMaterial);
  (material as TeethMaterial).setSkin({ melanin });
  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, Math.PI));
  const plane = openPlane(openness);
  scene.add(new Mesh(plane, material));
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  const px = new Float32Array(SIZE * SIZE * 4);
  renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, px);
  renderer.setRenderTarget(null);
  material.dispose();
  plane.dispose();
  map.dispose();
  const mean = (x0: number, x1: number): Rgb => {
    const sum: Rgb = [0, 0, 0];
    let n = 0;
    for (let y = 0; y < SIZE; y++)
      for (let x = x0; x < x1; x++) {
        for (let c = 0; c < 3; c++)
          sum[c] = (sum[c] as number) + (px[(y * SIZE + x) * 4 + c] as number);
        n++;
      }
    return [sum[0] / n, sum[1] / n, sum[2] / n];
  };
  return [mean(1, SIZE / 2 - 1), mean(SIZE / 2 + 1, SIZE - 1)];
}

/** What a texel of albedo 1 renders as under the same light, to normalise the rest by. */
function white(): number {
  const data = Float32Array.of(1, 1, 1, 1);
  const map = new DataTexture(data, 1, 1, RGBAFormat, FloatType);
  map.colorSpace = NoColorSpace;
  map.needsUpdate = true;
  const material = createAttachmentMaterial("body", { ...described, color: [1, 1, 1] });
  material.map = map;
  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, Math.PI));
  const plane = openPlane();
  scene.add(new Mesh(plane, material));
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  const px = new Float32Array(SIZE * SIZE * 4);
  renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, px);
  renderer.setRenderTarget(null);
  material.dispose();
  plane.dispose();
  map.dispose();
  return px[(8 * SIZE + 8) * 4] as number;
}

const GUM_TEXEL: Rgb = [0.195, 0.039, 0.045];

describe("the teeth's gums on the GPU", () => {
  it("leaves tooth texels at enamel and turns gum texels pale coral on light skin", () => {
    const unit = white();
    expect(unit).toBeGreaterThan(0.5);
    const [tooth, gum] = halves([TEETH_TEXTURE_MEAN, GUM_TEXEL], 0);
    const enamel = linearFromLab(ENAMEL_LAB);
    tooth.forEach((v, k) => {
      expect(v / unit).toBeCloseTo(enamel[k] as number, 2);
    });
    // The texel is the texture's mean gum luminance times the tint: exactly the gum's albedo.
    const want = linearFromLab(GUM_LAB);
    const lumRatio = luminance(GUM_TEXEL) / GUM_TEXTURE_MEAN_LUMINANCE;
    gum.forEach((v, k) => {
      expect(v / unit / lumRatio, `channel ${k}`).toBeCloseTo(want[k] as number, 2);
    });
  });

  it("leaves a bright, slightly reddish tooth texel as the enamel's shading, not as gum", () => {
    const unit = white();
    // Brighter than the mean tooth and a little warm: one fifth of its red is not green.
    const stained: Rgb = [0.6, 0.48, 0.46];
    const [tooth] = halves([stained, GUM_TEXEL], 1);
    const enamel = linearFromLab(ENAMEL_LAB);
    tooth.forEach((v, k) => {
      expect(v / unit, `channel ${k}`).toBeCloseTo(
        (stained[k] as number) * ((enamel[k] as number) / (TEETH_TEXTURE_MEAN[k] as number)),
        2,
      );
    });
  });

  it("is not the saturated red the unrecoloured texture gave", () => {
    const unit = white();
    const [, gum] = halves([TEETH_TEXTURE_MEAN, GUM_TEXEL], 0);
    const r = gum[0] / unit;
    const g = gum[1] / unit;
    // A pale coral keeps a third or more of its red in green; the old red kept a fifth.
    expect(g / r).toBeGreaterThan(0.28);
  });

  it("darkens the gum on deep skin and not the teeth", () => {
    const unit = white();
    const [toothLight, gumLight] = halves([TEETH_TEXTURE_MEAN, GUM_TEXEL], 0);
    const [toothDeep, gumDeep] = halves([TEETH_TEXTURE_MEAN, GUM_TEXEL], 1);
    expect(luminance(gumDeep) / unit).toBeLessThan((luminance(gumLight) / unit) * 0.85);
    expect(luminance(gumDeep)).toBeGreaterThan(luminance(gumLight) * 0.3);
    toothLight.forEach((v, k) => {
      expect(toothDeep[k]).toBeCloseTo(v, 3);
    });
  });

  it("brighten teeth that are a little exposed faster than the baked occlusion alone, and keep a covered tooth dark", () => {
    const unit = white();
    const tooth: [Readonly<Rgb>, Readonly<Rgb>] = [TEETH_TEXTURE_MEAN, TEETH_TEXTURE_MEAN];
    const lit = (openness: number) => (halves(tooth, 0, openness)[0][1] as number) / unit;
    const shut = lit(0);
    const full = lit(1);
    // What the light on a tooth is, against a fully open tooth: the floor and the exposure curve.
    for (const o of [0, 0.1, 0.3, 0.7, 1]) {
      const want = OCCLUSION_FLOOR + (1 - OCCLUSION_FLOOR) * o ** TEETH_EXPOSURE;
      expect(lit(o) / full, `openness ${o}`).toBeCloseTo(want, 2);
    }
    // Covered stays at the floor; a tooth a tenth open is already well past where the linear curve puts it.
    expect(shut / full).toBeCloseTo(OCCLUSION_FLOOR, 2);
    expect(lit(0.1) / full).toBeGreaterThan(OCCLUSION_FLOOR + (1 - OCCLUSION_FLOOR) * 0.1 * 1.5);
  });
});
