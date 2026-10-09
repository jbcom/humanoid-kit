import {
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type ContactPoint,
  groundOcclusion,
  sampleGroundOcclusion,
} from "../../src/presence/presence.ts";
import { GroundContactMaterial, MAX_CONTACTS } from "../../src/render/groundContact.ts";

/**
 * The pooled contact shadow is a ground shader, so these tests render it from
 * above onto white and read the pixels back: the shadow at each pixel must be
 * what `sampleGroundOcclusion` says for that ground position. That ties the
 * shader to the framework-free model the rest of the library (and its unit
 * tests) rely on, rather than testing the shader against itself.
 */
const SIZE = 64;
/** The camera sees a square of this many metres, centred on the origin. */
const SPAN = 4;

let renderer: WebGLRenderer;
let target: WebGLRenderTarget;
beforeAll(() => {
  renderer = new WebGLRenderer({ antialias: false });
  renderer.setClearColor(0xffffff, 1);
  target = new WebGLRenderTarget(SIZE, SIZE);
});
afterAll(() => {
  target.dispose();
  renderer.dispose();
});

/** Renders the contacts from above and returns the shadow (0 open … 1 black) per pixel. */
function shadow(points: readonly ContactPoint[]): { at: (x: number, z: number) => number } {
  const material = new GroundContactMaterial();
  material.setContacts(points);
  const ground = new Mesh(new PlaneGeometry(SPAN * 2, SPAN * 2), material);
  ground.rotation.x = -Math.PI / 2;
  const scene = new Scene();
  scene.add(ground);
  const camera = new OrthographicCamera(-SPAN / 2, SPAN / 2, SPAN / 2, -SPAN / 2, 0.1, 10);
  camera.position.set(0, 5, 0);
  // Looking straight down: screen up is world -z, screen right is +x.
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(scene, camera);
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels);
  renderer.setRenderTarget(null);
  ground.geometry.dispose();
  material.dispose();
  return {
    at(x, z) {
      const px = Math.min(SIZE - 1, Math.max(0, Math.floor((x / SPAN + 0.5) * SIZE)));
      // Row 0 is the bottom of the image, which is world +z.
      const py = Math.min(SIZE - 1, Math.max(0, Math.floor((0.5 - z / SPAN) * SIZE)));
      return 1 - (pixels[(py * SIZE + px) * 4] as number) / 255;
    },
  };
}

const feetAt = (x: number, z = 0): ContactPoint[] => [
  { x: x - 0.1, z, radius: 0.6, strength: 0.6 },
  { x: x + 0.1, z, radius: 0.6, strength: 0.6 },
];

describe("the pooled ground contact shadow", () => {
  it("matches sampleGroundOcclusion across the ground", () => {
    const points = [...feetAt(-0.7, 0.2), ...feetAt(0.9, -0.5)];
    const img = shadow(points);
    let darkest = 0;
    // Every third pixel, sampled at its centre in world space.
    for (let px = 1; px < SIZE; px += 3)
      for (let py = 1; py < SIZE; py += 3) {
        const x = ((px + 0.5) / SIZE - 0.5) * SPAN;
        const z = (0.5 - (py + 0.5) / SIZE) * SPAN;
        const expected = sampleGroundOcclusion(points, x, z);
        darkest = Math.max(darkest, expected);
        expect(img.at(x, z)).toBeCloseTo(expected, 1);
      }
    // The comparison covers real shadow, not just open ground.
    expect(darkest).toBeGreaterThan(0.4);
  });

  it("pools overlapping contacts with max: two figures on one spot are as dark as one", () => {
    const both = [...feetAt(0), ...feetAt(0.04)];
    const one = shadow(feetAt(0));
    const two = shadow(both);
    for (const x of [0, 0.1, 0.2, 0.3]) {
      // What the strongest contact there says, never the two shadows added…
      expect(two.at(x, 0)).toBeCloseTo(sampleGroundOcclusion(both, x, 0), 1);
    }
    // …so a second figure on the same spot barely changes the darkest point.
    expect(one.at(0, 0)).toBeCloseTo(0.6, 1);
    expect(two.at(0, 0)).toBeLessThan(0.7);
  });

  it("fills the ground between figures walking together and clears it as they part", () => {
    const together = shadow([...feetAt(-0.3), ...feetAt(0.3)]);
    const apart = shadow([...feetAt(-1.6), ...feetAt(1.6)]);
    expect(together.at(0, 0)).toBeGreaterThan(0.25);
    expect(apart.at(0, 0)).toBeCloseTo(0, 2);
  });

  it("takes figures' footprints straight from groundOcclusion", () => {
    const img = shadow(
      groundOcclusion([
        {
          id: "a",
          position: [0, 0, 0],
          facing: [0, 0, 1],
          bounds: { min: [0, 0, 0], max: [0, 0, 0] },
          anchors: {} as never,
          footprint: { points: [[0.5, 0.5]], radius: 0.2 },
          appearance: { albedo: [0, 0, 0], luminance: 0, specular: 0 },
          faceRadius: 0,
          adult: true,
        },
      ]),
    );
    expect(img.at(0.5, 0.5)).toBeCloseTo(0.6, 1);
    expect(img.at(-1, -1)).toBeCloseTo(0, 2);
  });

  it("keeps the first MAX_CONTACTS contacts and says how many it used", () => {
    const material = new GroundContactMaterial();
    const many = Array.from({ length: MAX_CONTACTS + 5 }, (_, i) => ({
      x: i * 0.01,
      z: 0,
      radius: 0.2,
      strength: 0.5,
    }));
    expect(material.setContacts(many)).toBe(MAX_CONTACTS);
    expect(material.setContacts(many.slice(0, 3))).toBe(3);
    expect(material.setContacts([])).toBe(0);
    material.dispose();
  });
});
