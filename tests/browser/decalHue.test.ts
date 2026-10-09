/**
 * A brow is the hair's colour on a face: the same recipe colour must give a brow
 * and a scalp card the same hue under the same light, whichever material draws
 * it (src/render/decalMaterial.ts, src/render/hairMaterial.ts).
 */
import {
  AmbientLight,
  DataTexture,
  DirectionalLight,
  FloatType,
  Mesh,
  type MeshStandardMaterial,
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
import { DecalMaterial } from "../../src/render/decalMaterial.ts";
import {
  HairMaterial,
  setHairOcclusionAttribute,
  setHairStrandAttributes,
} from "../../src/render/hairMaterial.ts";
import { browColour } from "../../src/surface/decalTone.ts";
import { HAIR_COLOURS, HAIR_STRAND_MEAN } from "../../src/surface/hairTone.ts";

const SIZE = 12;
const renderer = new WebGLRenderer({ canvas: document.createElement("canvas"), antialias: false });
renderer.setSize(SIZE, SIZE, false);
renderer.setClearColor(0x000000, 0);
const target = new WebGLRenderTarget(SIZE, SIZE, { type: FloatType });
const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.set(0, 0, 5);
afterAll(() => {
  target.dispose();
  renderer.dispose();
});

/** A one-texel texture: a grey of `level` (linear) at full alpha. */
function flat(level: number): DataTexture {
  const map = new DataTexture(Float32Array.of(level, level, level, 1), 1, 1, RGBAFormat, FloatType);
  map.colorSpace = NoColorSpace;
  map.magFilter = NearestFilter;
  map.minFilter = NearestFilter;
  map.needsUpdate = true;
  return map;
}

/** The centre pixel of `material` on a plane facing the camera, lit from the front and the side. */
function centre(material: MeshStandardMaterial, hair: boolean): [number, number, number] {
  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, 1.2));
  const key = new DirectionalLight(0xffffff, 2);
  key.position.set(0.5, 0.6, 1);
  scene.add(key);
  const plane = new PlaneGeometry(2, 2);
  if (hair) {
    const n = plane.getAttribute("position").count;
    setHairOcclusionAttribute(plane, new Float32Array(n).fill(1));
    setHairStrandAttributes(
      plane,
      new Float32Array(n).fill(1),
      new Float32Array(n),
      new Float32Array(n),
      new Float32Array(n),
    );
  }
  scene.add(new Mesh(plane, material));
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(scene, camera);
  const px = new Float32Array(SIZE * SIZE * 4);
  renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, px);
  renderer.setRenderTarget(null);
  plane.dispose();
  const i = ((SIZE >> 1) * SIZE + (SIZE >> 1)) * 4;
  return [px[i] as number, px[i + 1] as number, px[i + 2] as number];
}

const chroma = ([r, g, b]: [number, number, number]) => {
  const s = r + g + b || 1;
  return [r / s, g / s];
};

describe("a brow against the scalp hair of the same colour", () => {
  for (const name of ["brown", "red", "blonde", "light-blonde", "grey"]) {
    it(`${name}: the same chromaticity and brightness under the same light`, () => {
      const colour = HAIR_COLOURS[name] as (typeof HAIR_COLOURS)[string] & object;
      const scalp = new HairMaterial();
      scalp.setMultisampled(false);
      scalp.map = flat(HAIR_STRAND_MEAN);
      scalp.setColour(colour);
      const brow = new DecalMaterial();
      brow.map = flat(1);
      brow.setColour(browColour(colour));
      const hair = centre(scalp, true);
      const decal = centre(brow, false);
      const [hr, hg] = chroma(hair) as [number, number];
      const [dr, dg] = chroma(decal) as [number, number];
      // Within 0.02 in r and g shares: no hue the scalp lacks, whatever the thin strokes' path.
      expect(
        Math.abs(hr - dr),
        `${name} red share hair ${hair.map((x) => x.toFixed(4))} decal ${decal.map((x) => x.toFixed(4))}`,
      ).toBeLessThan(0.02);
      expect(Math.abs(hg - dg), `${name} green share`).toBeLessThan(0.02);
      // And as light: the same colour is as bright on a brow as on the scalp, to a third either way.
      expect(decal[1] / hair[1], `${name} brightness`).toBeGreaterThan(0.67);
      expect(decal[1] / hair[1], `${name} brightness`).toBeLessThan(1.5);
      scalp.dispose();
      brow.dispose();
    });
  }
});
