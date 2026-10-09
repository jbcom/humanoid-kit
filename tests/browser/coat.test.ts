/**
 * The coat's shells (src/render/coat.ts) on a flat patch of skin: nothing where
 * nothing is painted, strands seen from above, height seen from the side, cover
 * thinning the hair, and the strands' colour the paint's.
 */
import {
  AmbientLight,
  BufferAttribute,
  Color,
  FloatType,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { afterAll, describe, expect, it } from "vitest";
import { CoatMaterial, coatGeometry } from "../../src/render/coat.ts";
import { UV_SCALE_ATTRIBUTE } from "../../src/render/skinMaterial.ts";
import { COAT_REGION_LIMIT } from "../../src/surface/coat.ts";

const SIZE = 128;
/** The patch's side, metres (its metres per UV unit). */
const SIDE = 0.04;
let renderer: WebGLRenderer | null = null;
const target = new WebGLRenderTarget(SIZE, SIZE, { type: FloatType });
afterAll(() => {
  target.dispose();
  renderer?.dispose();
});

interface Paint {
  cover: number;
  length: number;
  density: number;
  lie: number;
  colour: [number, number, number];
  width: number;
}
const HAIR: Paint = {
  cover: 1,
  length: 0.008,
  density: 30,
  lie: 0,
  colour: [0.05, 0.03, 0.02],
  width: 0.0004,
};

/**
 * Renders the patch (facing +z, the camera looking down -z from `from`) with
 * one region painted `paint`, against a white background. Returns red, row-major.
 */
function render(paint: Paint | null, view: "front" | "slant" = "front", shells = 8) {
  renderer ??= new WebGLRenderer({ canvas: document.createElement("canvas"), antialias: false });
  renderer.setSize(SIZE, SIZE, false);
  const body = new PlaneGeometry(SIDE, SIDE, 16, 16);
  const n = body.getAttribute("position").count;
  body.setAttribute("skinIndex", new BufferAttribute(new Uint16Array(n * 4), 4));
  body.setAttribute("skinWeight", new BufferAttribute(new Float32Array(n * 4), 4));
  body.setAttribute(UV_SCALE_ATTRIBUTE, new BufferAttribute(new Float32Array(n).fill(SIDE), 1));
  const comb = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) comb[v * 3 + 1] = -1;
  const masks = new Uint8Array(n * COAT_REGION_LIMIT);
  for (let v = 0; v < n; v++) masks[v * COAT_REGION_LIMIT] = 255;
  const index = body.getIndex()?.array as Uint16Array;
  const geometry = coatGeometry(body, { comb, masks }, Uint32Array.from(index), shells);
  const material = new CoatMaterial();
  const table = new Float32Array(COAT_REGION_LIMIT * 8);
  if (paint)
    table.set(
      [paint.cover, paint.length, paint.density, paint.lie, ...paint.colour, paint.width],
      0,
    );
  material.setPaint(table);
  material.setShells(shells);
  const scene = new Scene();
  scene.background = new Color(1, 1, 1);
  scene.add(new Mesh(geometry, material));
  scene.add(new AmbientLight(0xffffff, 3));
  const half = SIDE / 4;
  const camera = new OrthographicCamera(-half, half, half, -half, 0.001, 1);
  // Straight down at the patch, or 70° off its normal, where each shell's strands
  // are seen side on and longer ones overlap more of the skin.
  if (view === "front") camera.position.set(0, 0, 0.5);
  else camera.position.set(0, -0.5 * Math.sin(1.22), 0.5 * Math.cos(1.22));
  camera.lookAt(0, 0, 0);
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  const px = new Float32Array(SIZE * SIZE * 4);
  renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, px);
  renderer.setRenderTarget(null);
  geometry.dispose();
  body.dispose();
  material.dispose();
  return px.filter((_, i) => i % 4 === 0);
}

const share = (px: Float32Array, test: (x: number) => boolean) =>
  px.filter(test).length / px.length;

describe("the coat's shells", () => {
  it("draw nothing where no region is painted", () => {
    expect(share(render(null), (x) => x < 0.99)).toBe(0);
  });

  it("draw separate strands seen from above, in the paint's colour", () => {
    const px = render(HAIR);
    const hair = share(px, (x) => x < 0.5);
    expect(hair).toBeGreaterThan(0.03);
    expect(hair).toBeLessThan(0.6);
    // Dark hair: its pixels are near the paint's albedo, lit.
    expect(Math.min(...px)).toBeLessThan(0.3);
  });

  it("stand off the skin: seen at a slant, longer hair hides more of the skin", () => {
    const short = share(render({ ...HAIR, length: 0.0005 }, "slant"), (x) => x < 0.5);
    const long = share(render(HAIR, "slant"), (x) => x < 0.5);
    expect(long).toBeGreaterThan(1.5 * short);
  });

  // The coat's geometry shares the body's vertex buffers: disposing it must not
  // free them under the body, which would go on drawing the shape it had.
  it("leave the body's own buffers when disposed", () => {
    renderer ??= new WebGLRenderer({ canvas: document.createElement("canvas"), antialias: false });
    renderer.setSize(SIZE, SIZE, false);
    const body = new PlaneGeometry(SIDE, SIDE, 4, 4);
    const n = body.getAttribute("position").count;
    body.setAttribute("skinIndex", new BufferAttribute(new Uint16Array(n * 4), 4));
    body.setAttribute("skinWeight", new BufferAttribute(new Float32Array(n * 4), 4));
    body.setAttribute(UV_SCALE_ATTRIBUTE, new BufferAttribute(new Float32Array(n).fill(SIDE), 1));
    const masks = new Uint8Array(n * COAT_REGION_LIMIT);
    const index = Uint32Array.from(body.getIndex()?.array as Uint16Array);
    const coat = coatGeometry(body, { comb: new Float32Array(n * 3), masks }, index, 1);
    const material = new CoatMaterial();
    const scene = new Scene();
    scene.background = new Color(1, 1, 1);
    // The body, black, beside the coat drawn on it.
    const skin = new Mesh(body, new MeshBasicMaterial({ color: 0x000000 }));
    const shells = new Mesh(coat, material);
    scene.add(skin, shells);
    const camera = new OrthographicCamera(-SIDE, SIDE, SIDE, -SIDE, 0.001, 1);
    camera.position.set(0, 0, 0.5);
    /** The share of the view's left and right halves the black body covers. */
    const covered = () => {
      renderer?.setRenderTarget(target);
      renderer?.render(scene, camera);
      const px = new Float32Array(SIZE * SIZE * 4);
      renderer?.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, px);
      renderer?.setRenderTarget(null);
      let left = 0;
      let right = 0;
      for (let i = 0; i < SIZE * SIZE; i++)
        if ((px[i * 4] as number) < 0.5) {
          if (i % SIZE < SIZE / 2) left++;
          else right++;
        }
      return { left: left / (SIZE * SIZE * 0.5), right: right / (SIZE * SIZE * 0.5) };
    };
    // The body spans the middle of the view, half of it in each half.
    const before = covered();
    expect(before.left).toBeGreaterThan(0.1);
    expect(before.right).toBeGreaterThan(0.1);
    // The coat goes; then the body moves wholly into the right half, as a new
    // figure's shape would move it.
    scene.remove(shells);
    coat.dispose();
    const position = body.getAttribute("position") as BufferAttribute;
    for (let v = 0; v < n; v++) position.setX(v, position.getX(v) + 0.5 * SIDE);
    position.needsUpdate = true;
    const after = covered();
    expect(after.left).toBe(0);
    expect(after.right).toBeGreaterThan(0.2);
    body.dispose();
    material.dispose();
  });

  it("thin with cover: half the cover draws about half the strands", () => {
    const full = share(render(HAIR), (x) => x < 0.5);
    const half = share(render({ ...HAIR, cover: 0.5 }), (x) => x < 0.5);
    expect(half / full).toBeGreaterThan(0.3);
    expect(half / full).toBeLessThan(0.7);
  });
});
