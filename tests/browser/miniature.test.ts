import {
  AmbientLight,
  NoToneMapping,
  OrthographicCamera,
  Scene,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MiniatureBake } from "../../src/bake/miniature.ts";
import { MiniatureCrowd, type MiniatureFigure } from "../../src/render/miniature.ts";
import { createTestRenderer } from "./gl.ts";

/**
 * The miniature shader is the runtime's whole job: these tests draw a tiny
 * hand-made bake (a one-metre square facing the camera, two frames one metre
 * apart) and read the pixels back, so the frame blend, the clip timing, the
 * tint channels and the draw count are measured from what the GPU drew.
 */
const SIZE = 64;
/** The camera sees this many metres square, centred on (0.5, 0.5). */
const SPAN = 4;

function squareBake(channel: number): MiniatureBake {
  // A square over x ∈ [-0.5, 0.5], y ∈ [0, 1] at frame 0, moved 1 m along +x at frame 1.
  const frame = (dx: number) => [-0.5 + dx, 0, 0, 0.5 + dx, 0, 0, 0.5 + dx, 1, 0, -0.5 + dx, 1, 0];
  const normals = new Float32Array(2 * 4 * 3);
  for (let i = 0; i < 8; i++) normals[i * 3 + 2] = 1;
  const index = new Uint32Array([0, 1, 2, 0, 2, 3]);
  return {
    body: "test",
    vertexCount: 4,
    lods: [
      { target: 2, index, normals },
      { target: 2, index, normals },
    ],
    colour: new Uint8Array(12).fill(255),
    channel: new Uint8Array(4).fill(channel),
    frameCount: 2,
    positions: Float32Array.from([...frame(0), ...frame(1)]),
    clips: [{ name: "slide", start: 0, frames: 2, fps: 1, loop: false }],
    min: [-0.5, 0, 0],
    max: [1.5, 1, 0],
  };
}

function alphaCardBake(): MiniatureBake {
  const bake = squareBake(0);
  bake.colour.fill(0);
  const frame = (z: number) => [-0.5, 0, z, 0.5, 0, z, 0.5, 1, z, -0.5, 1, z];
  const normals = new Float32Array(2 * 4 * 3);
  for (let i = 0; i < 8; i++) normals[i * 3 + 2] = 1;
  bake.alphaCards = [
    {
      id: "source-card",
      vertexCount: 4,
      index: new Uint32Array([0, 1, 2, 0, 2, 3]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      positions: Float32Array.from([...frame(0.01), ...frame(0.01)]),
      normals,
      texture: {
        width: 2,
        height: 2,
        // The left source half is transparent and the right half opaque.
        rgba: new Uint8Array([
          255, 255, 255, 0, 255, 255, 255, 255, 255, 255, 255, 0, 255, 255, 255, 255,
        ]),
      },
      tint: [1, 0, 0],
    },
  ];
  return bake;
}

let renderer: WebGLRenderer;
let target: WebGLRenderTarget;
beforeAll(() => {
  renderer = createTestRenderer({ antialias: false });
  renderer.toneMapping = NoToneMapping;
  renderer.setClearColor(0x000000, 1);
  target = new WebGLRenderTarget(SIZE, SIZE);
});
afterAll(() => target.dispose());

/** Draws the crowd at `time`; returns the pixels and the draw calls the renderer counted. */
function draw(crowd: MiniatureCrowd, figures: MiniatureFigure[], time: number) {
  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, 1), crowd.object);
  const camera = new OrthographicCamera(-SPAN / 2, SPAN / 2, SPAN / 2, -SPAN / 2, 0.1, 10);
  camera.position.set(0.5, 0.5, 5);
  camera.lookAt(0.5, 0.5, 0);
  crowd.setFigures(figures);
  const stats = crowd.update(camera, time, SIZE);
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.info.reset();
  renderer.info.autoReset = false;
  renderer.render(scene, camera);
  const calls = renderer.info.render.calls;
  renderer.info.autoReset = true;
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels);
  renderer.setRenderTarget(null);
  return { pixels, calls, stats };
}

/** Mean world x of the lit pixels, and their mean colour. */
function measure(pixels: Uint8Array) {
  let n = 0;
  let sx = 0;
  const rgb = [0, 0, 0];
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const o = (y * SIZE + x) * 4;
      const sum = (pixels[o] as number) + (pixels[o + 1] as number) + (pixels[o + 2] as number);
      if (sum < 30) continue;
      n++;
      sx += ((x + 0.5) / SIZE - 0.5) * SPAN + 0.5;
      for (let c = 0; c < 3; c++) rgb[c] = (rgb[c] as number) + (pixels[o + c] as number);
    }
  return { count: n, x: sx / Math.max(1, n), rgb: rgb.map((c) => c / Math.max(1, n)) };
}

describe("the miniature runtime on the GPU", () => {
  it("draws each frame of the clip, blended between frames, and holds a clip's last", () => {
    const crowd = new MiniatureCrowd([squareBake(0)]);
    const figure: MiniatureFigure[] = [{ archetype: 0, x: 0, z: 0 }];
    const at0 = measure(draw(crowd, figure, 0).pixels);
    const half = measure(draw(crowd, figure, 0.5).pixels);
    const held = measure(draw(crowd, figure, 7).pixels);
    // A 1 m square is a quarter of the view's width: 16 × 16 pixels.
    expect(at0.count).toBeGreaterThan(200);
    expect(at0.x).toBeCloseTo(0, 1);
    expect(half.x).toBeCloseTo(0.5, 1);
    expect(held.x).toBeCloseTo(1, 1);
    // A phase moves one figure along its clip without moving the others.
    const phased = measure(draw(crowd, [{ archetype: 0, x: 0, z: 0, phase: 0.5 }], 0).pixels);
    expect(phased.x).toBeCloseTo(0.5, 1);
    crowd.dispose();
  });

  it("tints a garment channel by the figure's tint and never tints skin", () => {
    const red: [number, number, number] = [1, 0, 0];
    const tints = [red, red, red] as const;
    const skin = new MiniatureCrowd([squareBake(0)]);
    const coat = new MiniatureCrowd([squareBake(1)]);
    const s = measure(draw(skin, [{ archetype: 0, x: 0, z: 0, tints }], 0).pixels);
    const c = measure(draw(coat, [{ archetype: 0, x: 0, z: 0, tints }], 0).pixels);
    // Skin stays white (grey under the light); the coat turns red at the same brightness.
    const [sr, sg, sb] = s.rgb as [number, number, number];
    const [cr, cg, cb] = c.rgb as [number, number, number];
    expect(sr).toBeGreaterThan(40);
    expect(Math.abs(sr - sg)).toBeLessThan(3);
    expect(Math.abs(sr - sb)).toBeLessThan(3);
    expect(cr).toBeCloseTo(sr, -1);
    expect(cg).toBeLessThan(3);
    expect(cb).toBeLessThan(3);
    skin.dispose();
    coat.dispose();
  });

  it("preserves a source card's transparent corner and opaque interior with an embedded alpha map", () => {
    const crowd = new MiniatureCrowd([alphaCardBake()], { levelPixels: [0, 0] });
    const { calls, pixels, stats } = draw(crowd, [{ archetype: 0, x: 0, z: 0 }], 0);
    const pixel = (x: number, y: number) => pixels[(y * SIZE + x) * 4] as number;
    // The card overlays the opaque black square: the embedded source map retains both a cut-out corner and an opaque interior.
    const samples = [pixel(28, 32), pixel(36, 32)];
    expect(Math.min(...samples)).toBeLessThan(8);
    expect(Math.max(...samples)).toBeGreaterThan(20);
    expect(stats.triangles).toBe(4);
    expect(calls).toBe(2);
    crowd.dispose();
  });

  it("issues one draw per archetype and level in use, however many figures", () => {
    const crowd = new MiniatureCrowd([squareBake(0), squareBake(1)], { levelPixels: [1e9, 0] });
    const figures: MiniatureFigure[] = Array.from({ length: 40 }, (_, i) => ({
      archetype: i % 2,
      x: (i % 8) * 0.1 - 0.5,
      z: -Math.floor(i / 8) * 0.1,
      scale: 0.2,
    }));
    const { calls, stats } = draw(crowd, figures, 0);
    expect(stats.drawCalls).toBe(2);
    expect(calls).toBe(2);
    expect(stats.perLevel).toEqual([0, 40]);
    crowd.dispose();
  });
});
