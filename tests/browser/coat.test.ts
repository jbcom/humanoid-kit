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

interface View {
  /** Straight down at the patch, or 70° off its normal. */
  view?: "front" | "slant";
  shells?: number;
  /** The patch's side, metres (and its metres per UV unit); default `SIDE`. */
  side?: number;
  /** The width the camera sees, metres; default half of `SIDE`. */
  span?: number;
  /** How far the patch is slid along x, metres. */
  offset?: number;
  /** The skin under the coat, a grey drawn unlit; default none, on white. */
  skin?: number;
}

/**
 * Renders the patch (facing +z, the camera looking down -z) with one region
 * painted `paint`. Returns red, row-major.
 */
function render(paint: Paint | null, options: View = {}) {
  const { view = "front", shells = 8, side = SIDE, span = SIDE / 2, offset = 0 } = options;
  renderer ??= new WebGLRenderer({ canvas: document.createElement("canvas"), antialias: false });
  renderer.setSize(SIZE, SIZE, false);
  const body = new PlaneGeometry(side, side, 16, 16);
  body.translate(offset, 0, 0);
  const n = body.getAttribute("position").count;
  body.setAttribute("skinIndex", new BufferAttribute(new Uint16Array(n * 4), 4));
  body.setAttribute("skinWeight", new BufferAttribute(new Float32Array(n * 4), 4));
  body.setAttribute(UV_SCALE_ATTRIBUTE, new BufferAttribute(new Float32Array(n).fill(side), 1));
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
  const skin =
    options.skin === undefined
      ? null
      : new MeshBasicMaterial({ color: new Color(options.skin, options.skin, options.skin) });
  if (skin) scene.add(new Mesh(body, skin));
  const coat = new Mesh(geometry, material);
  coat.renderOrder = 1;
  scene.add(coat);
  scene.add(new AmbientLight(0xffffff, 3));
  const half = span / 2;
  // Far enough back that a tilted patch of any size lies between the clip planes.
  const distance = 0.5 + side;
  const camera = new OrthographicCamera(-half, half, half, -half, 0.001, 2 * distance);
  // Straight down at the patch, or 70° off its normal, where each shell's strands
  // are seen side on and longer ones overlap more of the skin.
  if (view === "front") camera.position.set(0, 0, distance);
  else camera.position.set(0, -distance * Math.sin(1.22), distance * Math.cos(1.22));
  camera.lookAt(0, 0, 0);
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  const px = new Float32Array(SIZE * SIZE * 4);
  renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, px);
  renderer.setRenderTarget(null);
  geometry.dispose();
  body.dispose();
  material.dispose();
  skin?.dispose();
  return px.filter((_, i) => i % 4 === 0);
}

const share = (px: Float32Array, test: (x: number) => boolean) =>
  px.filter(test).length / px.length;

const average = (px: Float32Array) => px.reduce((s, x) => s + x, 0) / px.length;

/**
 * The share of pixels that differ from all eight neighbours by more than
 * `step`, all on the same side: lone points, the coat v2 pepper.
 */
function lonePixels(px: Float32Array, step: number): number {
  let lone = 0;
  for (let y = 1; y + 1 < SIZE; y++)
    for (let x = 1; x + 1 < SIZE; x++) {
      const p = px[y * SIZE + x] as number;
      let above = 0;
      let below = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const q = px[(y + dy) * SIZE + x + dx] as number;
          if (p - q > step) above++;
          if (q - p > step) below++;
        }
      if (above === 8 || below === 8) lone++;
    }
  return lone / ((SIZE - 2) * (SIZE - 2));
}

/** The skin under the coat in the coverage tests: a mid grey, unlit. */
const SKIN = 0.6;
/** A follicle cell's side for `HAIR`, metres: the follicle spacing. */
const CELL = 0.01 / Math.sqrt(HAIR.density);
/**
 * A view `cells` follicle cells a pixel across, on a patch wide enough to fill
 * it even foreshortened at a slant (cos 70° ≈ 0.34).
 */
const atFootprint = (cells: number, offset = 0): View => {
  const span = cells * CELL * SIZE;
  return { span, side: Math.max(SIDE, 4 * span), skin: SKIN, offset };
};

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
    const short = share(render({ ...HAIR, length: 0.0005 }, { view: "slant" }), (x) => x < 0.5);
    const long = share(render(HAIR, { view: "slant" }), (x) => x < 0.5);
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

  // Coat v2 kept or dropped each fragment whole, so below a pixel its strands
  // became lone dots that moved with the screen. Coverage blends them instead.
  describe("as coverage", () => {
    /** Near (a cell 7 pixels across), about a pixel a cell, and far (6 cells a pixel). */
    const FOOTPRINTS = [0.15, 1, 6];

    it("darken the skin about as much at every distance, seen from above or at a slant", () => {
      for (const view of ["front", "slant"] as const) {
        const dark = FOOTPRINTS.map(
          (f) => 1 - average(render(HAIR, { ...atFootprint(f), view })) / SKIN,
        );
        for (const d of dark) expect(d, `${view} ${dark}`).toBeGreaterThan(0.1);
        expect(Math.max(...dark) / Math.min(...dark), `${view} ${dark}`).toBeLessThan(1.25);
      }
    });

    it("draw no lone pixels at any distance", () => {
      for (const f of FOOTPRINTS)
        expect(lonePixels(render(HAIR, atFootprint(f)), 0.08), `${f} cells a pixel`).toBeLessThan(
          0.002,
        );
    });

    it("draw the same image of the skin wherever it is on screen: slid 4 pixels, it moves 4", () => {
      for (const f of FOOTPRINTS) {
        const view = atFootprint(f);
        const pixel = (view.span as number) / SIZE;
        const here = render(HAIR, view);
        const slid = render(HAIR, atFootprint(f, 4 * pixel));
        let worst = 0;
        for (let y = 8; y < SIZE - 8; y++)
          for (let x = 8; x < SIZE - 12; x++)
            worst = Math.max(
              worst,
              Math.abs((slid[y * SIZE + x + 4] as number) - (here[y * SIZE + x] as number)),
            );
        expect(worst, `${f} cells a pixel`).toBeLessThan(0.02);
      }
    });
  });

  it("thin with cover: half the cover draws about half the strands", () => {
    const full = share(render(HAIR), (x) => x < 0.5);
    const half = share(render({ ...HAIR, cover: 0.5 }), (x) => x < 0.5);
    expect(half / full).toBeGreaterThan(0.3);
    expect(half / full).toBeLessThan(0.7);
  });
});
