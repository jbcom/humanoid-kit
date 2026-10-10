/**
 * The renderer's clip at an aperture's rim (src/render/channelClip.ts): a
 * clipped material draws nothing that `placeIn` puts inside a channel, and
 * everything else as it was.
 */
import {
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { afterAll, describe, expect, it } from "vitest";
import { type Channel, knotHalfSize, placeIn } from "../../src/affordance/channel.ts";
import { ChannelClip, clipMaterial } from "../../src/render/channelClip.ts";

const SIZE = 128;
const renderer = new WebGLRenderer({ canvas: document.createElement("canvas"), antialias: false });
renderer.setSize(SIZE, SIZE, false);
const target = new WebGLRenderTarget(SIZE, SIZE);
// The square from -1 to 1 in x and y, seen down -z.
const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.set(0, 0, 5);
afterAll(() => {
  target.dispose();
  renderer.dispose();
});

/** A channel lying in the z = 0 plane: in along +y from y = -0.8, wide in x, its cross-section's height along z. */
function channel(): Channel {
  const knots = [
    [0, 0.5, 0.3],
    [0.7, 0.5, 0.3],
    [1.4, 0.2, 0.1],
  ] as const;
  return {
    origin: [0, -0.8, 0],
    inward: [0, 1, 0],
    across: [1, 0, 0],
    up: [0, 0, 1],
    depth: 1.4,
    knots,
    halfSize: (d) => knotHalfSize(knots, d),
  };
}

/** Which pixels of a white quad over the square are drawn (true) with the clip holding `channels`. */
function drawn(channels: Channel[], toWorld?: Matrix4): boolean[] {
  const clip = new ChannelClip();
  clip.set(channels, toWorld);
  const material = clipMaterial(new MeshBasicMaterial({ color: 0xffffff }), clip);
  const scene = new Scene();
  scene.add(new Mesh(new PlaneGeometry(2, 2), material));
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 1);
  renderer.render(scene, camera);
  const px = new Uint8Array(SIZE * SIZE * 4);
  renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, px);
  renderer.setRenderTarget(null);
  material.dispose();
  return Array.from({ length: SIZE * SIZE }, (_, i) => (px[i * 4] as number) > 127);
}

/** Pixel i's centre on the square. */
const at = (i: number): [number, number, number] => [
  ((i % SIZE) + 0.5) / (SIZE / 2) - 1,
  (Math.floor(i / SIZE) + 0.5) / (SIZE / 2) - 1,
  0,
];

describe("the clip at a channel's rim", () => {
  it("discards exactly what lies inside the channel, and draws the rest", () => {
    const c = channel();
    const got = drawn([c]);
    let inside = 0;
    let wrong = 0;
    for (let i = 0; i < got.length; i++) {
      const p = at(i);
      const place = placeIn(c, p);
      if (place.inside) inside++;
      // Pixels within a pixel of the channel's wall or its ends may fall either way.
      const edge = 2 / SIZE;
      const [ha] = c.halfSize(place.depth);
      const near =
        Math.abs(place.depth) < edge ||
        Math.abs(place.depth - c.depth) < edge ||
        (place.depth >= 0 && place.depth <= c.depth && Math.abs(Math.abs(p[0]) - ha) < edge);
      if (!near && got[i] === place.inside) wrong++;
    }
    expect(inside).toBeGreaterThan(SIZE * SIZE * 0.1);
    expect(wrong).toBe(0);
  });

  it("follows the figure's transform into world space, scale included", () => {
    const c = channel();
    // Moved half a unit right and scaled by a half: the hole is narrower and starts at y = -0.4.
    const toWorld = new Matrix4()
      .makeTranslation(0.5, 0, 0)
      .multiply(new Matrix4().makeScale(0.5, 0.5, 0.5));
    const got = drawn([c], toWorld);
    const index = (x: number, y: number) =>
      Math.floor(((y + 1) / 2) * SIZE) * SIZE + Math.floor(((x + 1) / 2) * SIZE);
    expect(got[index(0.5, 0)]).toBe(false);
    expect(got[index(0, 0)]).toBe(true);
    expect(got[index(0.5, -0.6)]).toBe(true);
    expect(got[index(0.5, -0.3)]).toBe(false);
  });

  it("draws everything with no channel, and with a closed one", () => {
    expect(drawn([]).every(Boolean)).toBe(true);
    const shut = channel();
    const knots = shut.knots.map(([d, a]) => [d, a, 0] as const);
    expect(
      drawn([{ ...shut, knots, halfSize: (d) => knotHalfSize(knots, d) }]).every(Boolean),
    ).toBe(true);
  });
});
