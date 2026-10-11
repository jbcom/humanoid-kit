/**
 * The renderer's clip at an aperture's rim (src/render/channelClip.ts): a
 * clipped material draws nothing that `placeIn` puts inside a channel, along
 * its curved path, and everything else as it was.
 */
import {
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderTarget,
} from "three";
import { afterAll, describe, expect, it } from "vitest";
import {
  type Channel,
  channelKnots,
  channelOf,
  channelThrough,
  headFrameOf,
  placeIn,
} from "../../src/affordance/channel.ts";
import type { Vec3 } from "../../src/foundation/landmarks.ts";
import { ChannelClip, clipMaterial } from "../../src/render/channelClip.ts";
import { createTestRenderer } from "./gl.ts";

const SIZE = 128;
const renderer = createTestRenderer({ antialias: false });
renderer.setSize(SIZE, SIZE, false);
const target = new WebGLRenderTarget(SIZE, SIZE);
// The square from -1 to 1 in x and y, seen down -z.
const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.set(0, 0, 5);
afterAll(() => {
  target.dispose();
});

/** A channel through `points` with half-sizes `halves` (across, up), its `up` out of the z = 0 plane. */
function through(points: readonly Vec3[], halves: readonly (readonly [number, number])[]): Channel {
  const k = channelKnots();
  k.count = points.length;
  points.forEach((p, i) => {
    k.points.set(p, i * 3);
    k.halves.set(halves[i] as readonly [number, number], i * 2);
  });
  return channelThrough(k, [0, 0, 1]);
}

/** A straight channel lying in the z = 0 plane: in along +y from y = -0.8, wide in x, narrowing. */
const straight = () =>
  through(
    [
      [0, -0.8, 0],
      [0, 0.6, 0],
    ],
    [
      [0.5, 0.3],
      [0.2, 0.1],
    ],
  );

/** An S-shaped channel in the z = 0 plane: in along +y from y = -0.9, bending right, then left, then up. */
const curved = () =>
  through(
    [
      [0, -0.9, 0],
      [0, -0.5, 0],
      [0.45, -0.1, 0],
      [-0.2, 0.4, 0],
      [-0.1, 0.85, 0],
    ],
    [
      [0.18, 0.1],
      [0.14, 0.1],
      [0.16, 0.1],
      [0.12, 0.1],
      [0.1, 0.1],
    ],
  );

/** Which pixels of a white quad over the square are drawn (true) with the clip holding `channels`. */
function drawn(channels: Channel[], toWorld?: Matrix4): boolean[] {
  const clip = new ChannelClip();
  clip.set(channels, toWorld);
  const got = drawnBy(clip);
  clip.dispose();
  return got;
}

/** Which pixels of a white quad over the square `clip` lets be drawn. */
function drawnBy(clip: ChannelClip): boolean[] {
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

/** A point of the square at pixel coordinates (column, row), centres at the halves. */
const point = (col: number, row: number): Vec3 => [
  (col + 0.5) / (SIZE / 2) - 1,
  (row + 0.5) / (SIZE / 2) - 1,
  0,
];
const index = (x: number, y: number) =>
  Math.floor(((y + 1) / 2) * SIZE) * SIZE + Math.floor(((x + 1) / 2) * SIZE);

/**
 * How many pixels the clip got wrong against `placeIn`, and how many are
 * inside. A pixel whose neighbours a pixel and a half away fall either side of
 * the channel's wall (or its ends) may fall either way, and is not counted.
 */
function against(c: Channel, got: boolean[]): { inside: number; wrong: number } {
  let inside = 0;
  let wrong = 0;
  const reach = 1.5;
  for (let row = 0; row < SIZE; row++)
    for (let col = 0; col < SIZE; col++) {
      const at = placeIn(c, point(col, row)).inside;
      if (at) inside++;
      let edge = false;
      for (const [dc, dr] of [
        [reach, 0],
        [-reach, 0],
        [0, reach],
        [0, -reach],
        [reach, reach],
        [-reach, -reach],
        [reach, -reach],
        [-reach, reach],
      ] as const)
        if (placeIn(c, point(col + dc, row + dr)).inside !== at) edge = true;
      if (!edge && got[row * SIZE + col] === at) wrong++;
    }
  return { inside, wrong };
}

describe("the clip at a channel's rim", () => {
  it("discards exactly what lies inside a straight channel, and draws the rest", () => {
    const c = straight();
    const { inside, wrong } = against(c, drawn([c]));
    expect(inside).toBeGreaterThan(SIZE * SIZE * 0.1);
    expect(wrong).toBe(0);
  });

  it("discards exactly what lies inside a curved channel, round its bends, and draws the rest", () => {
    const c = curved();
    const got = drawn([c]);
    const { inside, wrong } = against(c, got);
    expect(inside).toBeGreaterThan(SIZE * SIZE * 0.05);
    expect(wrong).toBe(0);
    // The path bends: the hole follows it to the right of the rim's line, then left
    // of it, where a straight channel from the same rim would not reach.
    expect(placeIn(c, [0.42, -0.1, 0]).inside).toBe(true);
    expect(got[index(0.42, -0.1)]).toBe(false);
    expect(got[index(-0.2, 0.4)]).toBe(false);
    // Off the path, between its bends, the quad is drawn.
    expect(got[index(0, -0.1)]).toBe(true);
    expect(got[index(0.4, 0.4)]).toBe(true);
  });

  it("follows the figure's transform into world space, scale included", () => {
    const c = straight();
    // Moved half a unit right and scaled by a half: the hole is narrower and starts at y = -0.4.
    const toWorld = new Matrix4()
      .makeTranslation(0.5, 0, 0)
      .multiply(new Matrix4().makeScale(0.5, 0.5, 0.5));
    const got = drawn([c], toWorld);
    expect(got[index(0.5, 0)]).toBe(false);
    expect(got[index(0, 0)]).toBe(true);
    expect(got[index(0.5, -0.6)]).toBe(true);
    expect(got[index(0.5, -0.3)]).toBe(false);
  });

  it("follows the group it is told to as it moves, without being set again", () => {
    const c = straight();
    const clip = new ChannelClip();
    const group = new Group();
    clip.follow(group);
    clip.set([c]);
    // Where it was set: the hole straight up the middle.
    let got = drawnBy(clip);
    expect(got[index(0, 0)]).toBe(false);
    // The group moves half a unit right and shrinks by half; the clip is drawn there next.
    group.position.set(0.5, 0, 0);
    group.scale.setScalar(0.5);
    got = drawnBy(clip);
    expect(got[index(0.5, 0)]).toBe(false);
    expect(got[index(0, 0)]).toBe(true);
    expect(got[index(0.5, -0.6)]).toBe(true);
    expect(got[index(0.5, -0.3)]).toBe(false);
    // And on to the left, under a parent that moves it back up.
    const parent = new Group();
    parent.position.set(0, 0.2, 0);
    parent.add(group);
    group.position.set(-0.5, 0, 0);
    got = drawnBy(clip);
    expect(got[index(-0.5, 0.2)]).toBe(false);
    expect(got[index(0.5, 0)]).toBe(true);
    expect(got[index(-0.5, -0.4)]).toBe(true);
    // Followed no longer, it stays where it was last drawn.
    clip.follow(null);
    group.position.set(0.5, 0, 0);
    got = drawnBy(clip);
    expect(got[index(-0.5, 0.2)]).toBe(false);
    expect(got[index(0.5, 0.2)]).toBe(true);
    clip.dispose();
  });

  it("discards a fragment just inside opened lips, and draws it when they close", () => {
    // An adult mouth facing the camera (+z) at the square's centre: its rim's tangent runs
    // between the lips (along y), so the opening is the channel's height up and down.
    const rim = {
      position: [0, 0, 0] as const,
      normal: [0, 0, 1] as const,
      tangent: [0, 1, 0] as const,
      bitangent: [-1, 0, 0] as const,
    };
    // The head behind it, facing +z, its left ear canal at +x.
    const head = headFrameOf(
      [0.0657, 0, -0.09],
      [-0.0657, 0, -0.09],
      [0, 0.1, -0.09],
      [0, 0, 0.02],
    );
    const width = 0.05;
    const mouth = (opening: number) => channelOf("oral", rim, 1, head, opening, width);
    // Seen down -z, the quad is a slice through the channel 1 mm behind the rim.
    const behind = new Matrix4().makeTranslation(0, 0, 0.001);
    const open = mouth(1);
    expect(placeIn(open, [0, 0, -0.001]).inside).toBe(true);
    const slice = (opening: number) => {
      const clip = new ChannelClip();
      // The quad stays at z = 0; the channel is moved forward by a millimetre, so the
      // quad lies a millimetre inside it, and scaled up so the mouth fills the square.
      clip.set([mouth(opening)], new Matrix4().makeScale(20, 20, 20).multiply(behind));
      const got = drawnBy(clip);
      clip.dispose();
      return got;
    };
    const centre = Math.floor(SIZE / 2) * SIZE + Math.floor(SIZE / 2);
    expect(slice(1)[centre], "inside open lips").toBe(false);
    expect(slice(0)[centre], "behind closed lips").toBe(true);
    // Outside the mouth's width, open lips or not, nothing is discarded.
    const corner = Math.floor(SIZE / 2) * SIZE + Math.floor(SIZE * 0.95);
    expect(slice(1)[corner]).toBe(true);
  });

  it("draws everything with no channel, and with a closed one", () => {
    expect(drawn([]).every(Boolean)).toBe(true);
    const shut = through(
      [
        [0, -0.8, 0],
        [0, 0.6, 0],
      ],
      [
        [0.5, 0],
        [0.2, 0],
      ],
    );
    expect(drawn([shut]).every(Boolean)).toBe(true);
  });
});
