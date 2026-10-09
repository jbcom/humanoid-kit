/**
 * The nail plate's material in a real WebGL context (src/render/attachmentLook.ts):
 * clear over the bed, nearly opaque along the free edge, by its `nailEdge`.
 */
import {
  AmbientLight,
  BufferAttribute,
  FloatType,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { afterAll, describe, expect, it } from "vitest";
import { NAIL_EDGE_ATTRIBUTE, NailPlateMaterial } from "../../src/render/attachmentLook.ts";
import { setOcclusionAttributes } from "../../src/render/occlusion.ts";
import { OCCLUSION_KEYS, occlusionCorners } from "../../src/rig/occlusionKeys.ts";
import { NAIL_KERATIN } from "../../src/surface/handTone.ts";
import {
  NAIL_FREE_EDGE_OPACITY,
  NAIL_PLATE_OPACITY,
} from "../../src/surface/regions/hands/index.ts";

const renderer = new WebGLRenderer({ canvas: document.createElement("canvas"), antialias: false });
afterAll(() => renderer.dispose());

describe("a nail plate", () => {
  it("lets the bed show through and covers it along the free edge", () => {
    // A plate whose left half is over the bed (edge 0) and right half free edge (1), over black.
    const plane = new PlaneGeometry(2, 2, 1, 1);
    plane.setAttribute(NAIL_EDGE_ATTRIBUTE, new BufferAttribute(new Float32Array([0, 1, 0, 1]), 1));
    // Open to the light at every corner of the occlusion cube, as a nail is.
    setOcclusionAttributes(
      plane,
      new Float32Array(4 * occlusionCorners(OCCLUSION_KEYS.length)).fill(1),
    );
    const material = new NailPlateMaterial();
    const scene = new Scene().add(new Mesh(plane, material), new AmbientLight(0xffffff, Math.PI));
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.set(0, 0, 5);
    const target = new WebGLRenderTarget(16, 1, { type: FloatType });
    renderer.setClearColor(0x000000, 1);
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const px = new Float32Array(16 * 4);
    renderer.readRenderTargetPixels(target, 0, 0, 16, 1, px);
    renderer.setRenderTarget(null);
    target.dispose();
    material.dispose();
    plane.dispose();
    // Under ambient light the plate's colour is its keratin; over black it shows by its opacity.
    const red = (x: number) => px[x * 4] as number;
    const keratin = NAIL_KERATIN[0];
    // The edge runs linearly across the plane: at pixel x it is (x + 0.5) / 16,
    // and the opacity follows it from the plate's to the free edge's. One
    // factor scales them all: the light keratin's surface reflects (F0 about
    // 0.04) does not reach its diffuse.
    const ratios = [0, 4, 8, 12, 15].map((x) => {
      const edge = (x + 0.5) / 16;
      const want = NAIL_PLATE_OPACITY + (NAIL_FREE_EDGE_OPACITY - NAIL_PLATE_OPACITY) * edge;
      return red(x) / keratin / want;
    });
    for (const r of ratios) {
      expect(r).toBeGreaterThan(0.92);
      expect(r).toBeLessThan(1.01);
      expect(Math.abs(r - (ratios[0] as number))).toBeLessThan(0.02);
    }
    expect(red(15)).toBeGreaterThan(red(0) * 3);
  });
});
