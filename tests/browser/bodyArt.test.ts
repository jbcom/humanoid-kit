/**
 * Body art on the GPU (src/render/bodyArtTexture.ts, the skin shader's ink):
 * a tattoo lands in UV space where its frame projects it, right way round and
 * whole across a UV seam, only on skin facing it and near it; and the skin
 * shader draws the baked ink exactly as `inkSeen` says it looks.
 */
import {
  BufferAttribute,
  BufferGeometry,
  FloatType,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  type Texture,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { afterAll, describe, expect, it } from "vitest";
import type { BodyArtPlacement, PlacedMark, PlacedTattoo } from "../../src/bodyArt/decals.ts";
import { inkSeen } from "../../src/bodyArt/ink.ts";
import { markOutline, markShape } from "../../src/bodyArt/markShape.ts";
import {
  markChannels,
  markedAlbedo,
  NAEVUS_MELANIN,
  NAEVUS_RAISE,
  SCAR_RAISE,
  vitiligoAlbedo,
  vitiligoLipAlbedo,
} from "../../src/bodyArt/marks.ts";
import { DECAL_MARGIN } from "../../src/render/bodyArtDecals.ts";
import {
  type BodyArtImages,
  type BodyArtSurface,
  bakeBodyArt,
  MARK_NEUTRAL,
} from "../../src/render/bodyArtTexture.ts";
import { buildLayerAtlas } from "../../src/render/layerAtlas.ts";
import { SkinMaterial } from "../../src/render/skinMaterial.ts";
import { planAtlas } from "../../src/surface/atlasPlan.ts";
import type { SkinLayer, SkinPaintInput } from "../../src/surface/layers.ts";
import { LIPS_LAYER, NAIL_GLOSS_LAYER } from "../../src/surface/regions/index.ts";
import { type Rgb, skinAlbedo, srgbToLinear } from "../../src/surface/skinTone.ts";
import { readPage } from "./readPage.ts";

/** What the bake draws: tattoos and marks. */
type Baked = Pick<BodyArtPlacement, "tattoos" | "marks">;

const renderer = new WebGLRenderer({ canvas: document.createElement("canvas"), antialias: false });
renderer.setPixelRatio(1);
afterAll(() => renderer.dispose());

/** An image with a colour per quadrant (sRGB 0..255; alpha 0 leaves a quadrant bare), 8 by 4 texels. */
function quadrants(tl: number[], tr: number[], bl: number[], br: number[]): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 4;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  const fill = (x: number, y: number, [r, gr, b, a]: number[]) => {
    g.fillStyle = `rgba(${r}, ${gr}, ${b}, ${(a ?? 255) / 255})`;
    g.fillRect(x, y, 4, 2);
  };
  fill(0, 0, tl);
  fill(4, 0, tr);
  fill(0, 2, bl);
  fill(4, 2, br);
  return c;
}

const RED = [200, 30, 30];
const BLUE = [30, 40, 200];
const GREEN = [20, 160, 40];
const BARE = [0, 0, 0, 0];

/**
 * A square of skin 0.2 m across in the plane z = `z`, facing `facing` along z,
 * in one UV island (uv = position / 0.2 + 0.5), or split at x = 0 into two
 * islands far apart in UV: the left half at u 0..0.4, the right at 0.6..1.
 */
function skin(
  options: { z?: number; facing?: 1 | -1; split?: boolean; tilt?: number } = {},
): BodyArtSurface {
  const z = options.z ?? 0;
  const f = options.facing ?? 1;
  // Tilted, the skin's depth rises `tilt` per metre along x (its UVs unchanged).
  const tilt = options.tilt ?? 0;
  const normal = [-tilt * f, 0, f].map((c) => c / Math.hypot(tilt, 1));
  const xs = options.split ? [-0.1, 0, 0, 0.1] : [-0.1, 0.1];
  const us = options.split ? [0, 0.4, 0.6, 1] : [0, 1];
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (let q = 0; q < xs.length / 2; q++) {
    const [x0, x1] = [xs[q * 2] as number, xs[q * 2 + 1] as number];
    const [u0, u1] = [us[q * 2] as number, us[q * 2 + 1] as number];
    const b = positions.length / 3;
    const [z0, z1] = [z + tilt * x0, z + tilt * x1];
    positions.push(x0, -0.1, z0, x1, -0.1, z1, x1, 0.1, z1, x0, 0.1, z0);
    uvs.push(u0, 0, u1, 0, u1, 1, u0, 1);
    index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const n = positions.length / 3;
  return {
    uvs: new Float32Array(uvs),
    index: new Uint32Array(index),
    vertexCount: n,
    positions: new Float32Array(positions),
    normals: new Float32Array(Array.from({ length: n }, () => normal).flat()),
  };
}

const tattoo = (more: Partial<PlacedTattoo> = {}): PlacedTattoo => ({
  centre: [0, 0, 0],
  normal: [0, 0, 1],
  right: [1, 0, 0],
  up: [0, 1, 0],
  image: "quads",
  width: 0.1,
  density: 1,
  ...more,
});
const placement = (...tattoos: PlacedTattoo[]): Baked => ({
  tattoos,
  marks: [],
});

const SIZE = 64;
const images = { quads: quadrants(RED, BLUE, GREEN, BARE) };

/** A texel of a decal layer: its place in its tattoo (s, t), which tattoo (-1 for none), and its weight. */
interface Decal {
  s: number;
  t: number;
  tattoo: number;
  weight: number;
}

/**
 * A bake's decal layers, as readers of texel (x, y), with its ink and marks
 * pages; texel (x, y)'s centre is at uv ((x + 0.5) / SIZE, (y + 0.5) / SIZE).
 */
function bake(surface: BodyArtSurface, art: Baked, using: BodyArtImages = images) {
  const t = bakeBodyArt(renderer, surface, art, using, SIZE);
  const layers = Array.from({ length: t.decals?.layers ?? 0 }, (_, l) =>
    readPage(renderer, t.decals?.coordinates as Texture, l, SIZE),
  );
  const ink = readPage(renderer, t.texture, 0, SIZE);
  const marks = readPage(renderer, t.texture, 1, SIZE);
  t.dispose();
  return {
    layers: layers.length,
    decal(x: number, y: number, layer = 0): Decal {
      const page = layers[layer] as Float32Array;
      const i = (y * SIZE + x) * 4;
      return {
        s: (page[i] as number) + 0.5,
        t: (page[i + 1] as number) + 0.5,
        tattoo: Math.round(page[i + 2] as number) - 1,
        weight: page[i + 3] as number,
      };
    },
    ink,
    marks,
  };
}

/** Texel i's centre on the skin, metres: uv = position / 0.2 + 0.5. */
const place = (i: number) => ((i + 0.5) / SIZE - 0.5) * 0.2;

describe("baking a tattoo", () => {
  // The image is 0.1 m wide and 0.05 m tall, centred.
  it("places each texel in the image where its frame projects it, the right way up and round", () => {
    const art = bake(skin(), placement(tattoo()));
    expect(art.layers).toBe(1);
    let inside = 0;
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const d = art.decal(x, y);
        const s = place(x) / 0.1 + 0.5;
        const t = place(y) / 0.05 + 0.5;
        const margin = [DECAL_MARGIN / 0.1, DECAL_MARGIN / 0.05] as const;
        if (Math.abs(s - 0.5) > 0.5 + margin[0] || Math.abs(t - 0.5) > 0.5 + margin[1]) {
          expect(d.tattoo, `${x}, ${y}`).toBe(-1);
          continue;
        }
        // Half floats: within 1/2048 of 1.
        expect(Math.abs(d.s - s)).toBeLessThan(1e-3);
        expect(Math.abs(d.t - t)).toBeLessThan(1e-3);
        expect(d.tattoo).toBe(0);
        expect(d.weight).toBeCloseTo(1, 3);
        inside++;
      }
    expect(inside).toBeGreaterThan(SIZE * SIZE * 0.1);
    // No marks: the ink page is bare and the marks page no change everywhere.
    for (let i = 0; i < art.marks.length; i += 4) {
      expect(art.ink[i + 3]).toBe(0);
      expect(Math.round((art.marks[i] as number) * 255)).toBe(MARK_NEUTRAL);
      expect(
        Math.max(
          art.marks[i + 1] as number,
          art.marks[i + 2] as number,
          art.marks[i + 3] as number,
        ),
      ).toBe(0);
    }
  });

  it("takes its density as weight, and turns with the frame", () => {
    expect(bake(skin(), placement(tattoo({ density: 0.5 }))).decal(32, 32).weight).toBeCloseTo(
      0.5,
      3,
    );
    // Turned 90° counter-clockwise: the image's right runs up the skin, its top to the left.
    const turned = bake(skin(), placement(tattoo({ right: [0, 1, 0], up: [-1, 0, 0] })));
    const d = turned.decal(30, 36);
    expect(d.s).toBeCloseTo(place(36) / 0.1 + 0.5, 3);
    expect(d.t).toBeCloseTo(-place(30) / 0.05 + 0.5, 3);
  });

  it("is whole across a UV seam, and carries on exactly just outside each island", () => {
    // Straddling x = 0, the seam between two islands far apart in UV: the
    // left half of the skin at u 0..0.4, the right at 0.6..1.
    const art = bake(skin({ split: true }), placement(tattoo()));
    const x = (u: number) => (u < 0.5 ? -0.1 + (u / 0.4) * 0.1 : ((u - 0.6) / 0.4) * 0.1);
    const t = place(32) / 0.05 + 0.5;
    // Inside each island, and in the first texel past its edge (u 0.4..0.6 is gutter).
    const left = Math.ceil(0.4 * SIZE - 0.5);
    const right = Math.floor(0.6 * SIZE - 0.5);
    expect([left, right]).toEqual([26, 37]);
    for (const i of [left - 4, left, right, right + 4]) {
      const d = art.decal(i, 32);
      const u = (i + 0.5) / SIZE;
      expect(d.tattoo, `texel ${i}`).toBe(0);
      // Within a sixteenth of a texel's step: the rasteriser snaps the
      // islands' corners (u 0.4 is texel 25.6) to its sub-pixel grid.
      const step = 0.1 / 0.4 / SIZE / 0.1;
      expect(Math.abs(d.s - (x(u) / 0.1 + 0.5)), `texel ${i}`).toBeLessThan(step / 16);
      expect(Math.abs(d.t - t)).toBeLessThan(1e-3);
    }
    // Nothing further between the islands.
    expect(art.decal(32, 32).tattoo).toBe(-1);
  });

  it("covers only skin facing it and near it", () => {
    expect(bake(skin({ facing: -1 }), placement(tattoo())).decal(32, 32).tattoo).toBe(-1);
    // 5 cm behind a tattoo 10 cm wide: past its reach.
    expect(bake(skin({ z: -0.05 }), placement(tattoo())).decal(32, 32).tattoo).toBe(-1);
    expect(bake(skin({ z: -0.005 }), placement(tattoo())).decal(32, 32).weight).toBeCloseTo(1, 3);
  });

  it("puts a later tattoo that overlaps an earlier one on a layer above it", () => {
    const art = bake(skin(), placement(tattoo(), tattoo({ width: 0.05 })));
    expect(art.layers).toBe(2);
    expect(art.decal(32, 32, 0).tattoo).toBe(0);
    expect(art.decal(32, 32, 1).tattoo).toBe(1);
    expect(art.decal(32, 32, 1).s).toBeCloseTo(place(32) / 0.05 + 0.5, 3);
  });

  it("refuses a tattoo whose image it was not given", () => {
    expect(() =>
      bakeBodyArt(renderer, skin(), placement(tattoo({ image: "x" })), images, SIZE),
    ).toThrow(RangeError);
  });
});

const mark = (kind: PlacedMark["kind"], more: Partial<PlacedMark> = {}): PlacedMark => ({
  centre: [0, 0, 0],
  normal: [0, 0, 1],
  right: [1, 0, 0],
  up: [0, 1, 0],
  kind,
  length: 0.08,
  width: 0.08,
  maturity: 1,
  raised: 0,
  seed: 5,
  ...more,
});

describe("baking marks", () => {
  /** Both pages of a bake, read back. */
  function pages(art: Baked, surface = skin()) {
    const t = bakeBodyArt(renderer, surface, art, images, SIZE);
    const out = [readPage(renderer, t.texture, 0, SIZE), readPage(renderer, t.texture, 1, SIZE)];
    t.dispose();
    const at = (page: Float32Array, x: number, y: number) =>
      Array.from(page.slice((y * SIZE + x) * 4, (y * SIZE + x) * 4 + 4)).map((c) =>
        Math.round(c * 255),
      );
    return {
      ink: (x: number, y: number) => at(out[0] as Float32Array, x, y),
      marks: (x: number, y: number) => at(out[1] as Float32Array, x, y),
    };
  }
  // Texel (x, y)'s centre on the skin, metres: uv = position / 0.2 + 0.5.
  const place = (i: number) => ((i + 0.5) / SIZE - 0.5) * 0.2;

  it("draws each mark's outline as markShape does, its channels scaled by it", () => {
    for (const [m, tilt] of [
      [mark("cafe-au-lait"), 0],
      [mark("port-wine"), 0],
      [mark("vitiligo"), 0],
      // Mirrored, and on skin turning away, which a patch measures as depth.
      [mark("vitiligo", { width: -0.08 }), 0],
      [mark("vitiligo", { seed: 9 }), 0.8],
      [mark("scar", { width: 0.01, length: 0.1, maturity: 0, raised: 1 }), 0],
    ] as const) {
      const c = markChannels(m);
      const outline = markOutline(m);
      const art = pages({ tattoos: [], marks: [m] }, skin({ tilt }));
      let worst = 0;
      for (let y = 0; y < SIZE; y += 3)
        for (let x = 0; x < SIZE; x += 3) {
          // The texel's place in the mark's frame: along the skin's own x, its depth.
          const s = markShape(m, outline, place(x), place(y), tilt * place(x));
          const got = art.marks(x, y);
          const want = [
            MARK_NEUTRAL + 127 * Math.max(-1, Math.min(1, c.melanin * s)),
            255 * c.haemoglobin * s,
            255 * c.smooth * s,
            255 * c.raise * s * s,
          ];
          for (let k = 0; k < 4; k++)
            worst = Math.max(worst, Math.abs((got[k] as number) - Math.round(want[k] as number)));
        }
      // Eight bits, and the outline's edge between texel centres: within two steps.
      expect(worst, `${m.kind} width ${m.width} tilt ${tilt}`).toBeLessThanOrEqual(2);
    }
  });

  it("leaves the marks page at no change where there are none", () => {
    const art = pages(placement(tattoo()));
    for (const [x, y] of [
      [32, 32],
      [2, 60],
      [60, 2],
    ] as const)
      expect(art.marks(x, y)).toEqual([MARK_NEUTRAL, 0, 0, 0]);
  });

  it("adds marks that overlap, and puts dermal pigment alone in the ink page", () => {
    const art = pages({
      tattoos: [tattoo({ width: 0.05 })],
      marks: [
        mark("vitiligo", { width: 0.16, length: 0.16 }),
        mark("cafe-au-lait", { width: 0.16, length: 0.16 }),
        mark("dermal-melanocytosis", { centre: [0.06, 0, 0], width: 0.04, length: 0.04 }),
      ],
    });
    // Vitiligo (-1) and café-au-lait (+0.2) net out at the centre of both.
    const net = -1 + markChannels(mark("cafe-au-lait")).melanin;
    expect(art.marks(32, 40)[0]).toBeCloseTo(MARK_NEUTRAL + 127 * net, -0.5);
    // The spot is ink, blue-grey through the skin, not a change to the marks page.
    expect(art.ink(51, 32)[3]).toBeGreaterThan(150);
    // The tattoo is a decal of its own, not in the ink page.
    expect(art.ink(28, 34)[3]).toBe(0);
  });
});

describe("ink in the skin shader", () => {
  const appearance = (melanin: number): SkinPaintInput => ({
    tone: { melanin, haemoglobin: 0.5, undertone: 0, override: null },
    flush: 0,
    lips: 0.5,
    areola: 0.5,
    signals: {},
  });

  /**
   * The shader's diffuse colour across the middle row of the skin, `width`
   * pixels, with this body art baked on it at `size`; with `under`, under
   * that layer with its mask at that strength over the whole skin (the nail
   * plate's, the lips').
   */
  function shade(
    melanin: number,
    body: Baked,
    using: BodyArtImages = images,
    {
      under,
      width = 8,
      size = SIZE,
      output = "diffuse",
    }: {
      under?: readonly [SkinLayer, number] | undefined;
      width?: number;
      size?: number;
      /** The diffuse colour, or the marks' surface change (smoothness, raise). */
      output?: "diffuse" | "surface";
    } = {},
  ): Rgb[] {
    const art = bakeBodyArt(renderer, skin(), body, using, size);
    const uvs = new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]);
    const layers = under ? [under[0]] : [];
    const mask = under?.[1] ?? 0;
    const atlas = under
      ? buildLayerAtlas(
          renderer,
          {
            uvs,
            index: new Uint16Array([0, 2, 1, 2, 3, 1]),
            vertexCount: 4,
            layerFields: new Float32Array([mask, 0, mask, 0, mask, 0, mask, 0]),
            layers: [under[0].id],
            plan: planAtlas(layers),
          },
          64,
        )
      : null;
    const material = new SkinMaterial(layers);
    if (atlas) material.setLayerAtlas(atlas);
    material.setAppearance(appearance(melanin));
    material.setBodyArt(art);
    const compile = material.onBeforeCompile;
    material.onBeforeCompile = (shader, r) => {
      compile.call(material, shader, r);
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        output === "diffuse"
          ? "#include <dithering_fragment>\n\tgl_FragColor = vec4( diffuseColor.rgb, 1.0 );"
          : "#include <dithering_fragment>\n\tgl_FragColor = vec4( hkMarkSurface, 0.0, 1.0 );",
      );
    };
    material.customProgramCacheKey = () => `humanoid-kit-skin-test-${output}`;
    const geometry = new BufferGeometry();
    const plane = new PlaneGeometry(2, 2);
    geometry.setAttribute("position", plane.getAttribute("position"));
    geometry.setAttribute("normal", plane.getAttribute("normal"));
    geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
    geometry.setIndex(plane.getIndex());
    const mesh = new Mesh(geometry, material);
    const scene = new Scene().add(mesh);
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.set(0, 0, 5);
    // Square pixels, so the image is sampled at the detail they show in both directions.
    const target = new WebGLRenderTarget(width, width, { type: FloatType });
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const px = new Float32Array(width * 4);
    renderer.readRenderTargetPixels(target, 0, width / 2, width, 1, px);
    renderer.setRenderTarget(null);
    for (const d of [target, material, geometry, plane, art]) d.dispose();
    atlas?.dispose();
    return Array.from(
      { length: width },
      (_, x) => [px[x * 4], px[x * 4 + 1], px[x * 4 + 2]] as Rgb,
    );
  }

  /** The shader's diffuse colour at the centre of the skin (`shade`). */
  const diffuse = (
    melanin: number,
    body: Baked,
    using: BodyArtImages = images,
    under?: readonly [SkinLayer, number],
  ) => shade(melanin, body, using, { under })[4] as Rgb;

  it("draws ink as it looks through the skin, mixed in by its coverage, at every tone", () => {
    for (const melanin of [0.05, 0.5, 1])
      for (const [ink, density] of [
        [[20, 20, 25], 1],
        [[180, 30, 40], 0.6],
      ] as const) {
        const base = skinAlbedo(appearance(melanin).tone);
        const seen = inkSeen(appearance(melanin).tone, ink.map((c) => srgbToLinear(c)) as Rgb);
        const want = base.map((b, k) => b + ((seen[k] as number) - b) * density);
        const solid = quadrants([...ink], [...ink], [...ink], [...ink]);
        const got = diffuse(melanin, placement(tattoo({ image: "ink", width: 0.4, density })), {
          ink: solid,
        });
        // Eight-bit ink and coverage: within 1% of full scale.
        got.forEach((c, k) => {
          expect(Math.abs(c - (want[k] as number)), `melanin ${melanin}`).toBeLessThan(0.01);
        });
      }
  });

  it("draws a tattoo finer than the bake's texels, from its own image", () => {
    // Sixteen stripes, white and black, across a tattoo the width of the skin
    // (12.5 mm each), baked at 8 texels across (25 mm each): two stripes to a
    // texel, which a bake of the tattoo's colours would average to grey.
    const c = document.createElement("canvas");
    c.width = 16;
    c.height = 2;
    const g = c.getContext("2d") as CanvasRenderingContext2D;
    for (let i = 0; i < 16; i++) {
      g.fillStyle = i % 2 ? "#000" : "#fff";
      g.fillRect(i, 0, 1, 2);
    }
    const tone = appearance(0.05).tone;
    const seen = (v: number) => inkSeen(tone, [v, v, v])[0] as number;
    const [white, black] = [seen(1), seen(0)];
    const row = shade(
      0.05,
      placement(tattoo({ image: "stripes", width: 0.2 })),
      { stripes: c },
      {
        width: 64,
        size: 8,
      },
    );
    // Four pixels to a stripe: the middle two of each, away from the image's ends.
    for (let i = 1; i < 15; i++)
      for (const x of [4 * i + 1, 4 * i + 2]) {
        const want = i % 2 ? black : white;
        const got = (row[x] as Rgb)[0];
        expect(Math.abs(got - want), `pixel ${x}`).toBeLessThan(0.2 * Math.abs(white - black));
      }
  });

  it("draws a naevus as a round, slightly raised dot, finer than the bake's texels", () => {
    // 2 cm across, baked at 8 texels over the skin's 20 cm (25 mm each), drawn
    // at 64 pixels (3.1 mm each): a bake of its colour would be a blur a texel square.
    const naevus = mark("naevus", { width: 0.02, length: 0.02 });
    const body = { tattoos: [], marks: [naevus] };
    const tone = appearance(0.3).tone;
    const base = skinAlbedo(tone);
    const dark = markedAlbedo(tone, { melanin: NAEVUS_MELANIN, haemoglobin: 0 });
    const row = shade(0.3, body, images, { width: 64, size: 8 });
    const raise = shade(0.3, body, images, { width: 64, size: 8, output: "surface" }); // Row 32's centre is 1.6 mm above the naevus's centre.
    const r = (x: number) => Math.hypot(((x + 0.5) / 64 - 0.5) * 0.2, (0.5 / 64) * 0.2) / 0.01;
    for (let x = 0; x < 64; x++) {
      const want = r(x) < 0.8 ? dark : r(x) > 1.2 ? base : null;
      if (want)
        (row[x] as Rgb).forEach((c, k) => {
          expect(Math.abs(c - (want[k] as number)), `pixel ${x}, r ${r(x)}`).toBeLessThan(0.01);
        });
      const dome = Math.max(0, 1 - r(x) ** 2) ** 2;
      expect(Math.abs((raise[x] as Rgb)[1] - (NAEVUS_RAISE / SCAR_RAISE) * dome)).toBeLessThan(
        0.01,
      );
    }
  });

  it("draws a tattoo over dermal pigment", () => {
    const red = [180, 30, 40];
    const solid = quadrants(red, red, red, red);
    const spot = mark("dermal-melanocytosis", { width: 2, length: 2 });
    const got = diffuse(
      0.5,
      { tattoos: [tattoo({ image: "ink", width: 0.4 })], marks: [spot] },
      {
        ink: solid,
      },
    );
    const want = inkSeen(appearance(0.5).tone, red.map((c) => srgbToLinear(c)) as Rgb);
    got.forEach((c, k) => {
      expect(Math.abs(c - (want[k] as number))).toBeLessThan(0.01);
    });
  });

  it("changes the skin under a mark as markedAlbedo does, at every tone", () => {
    for (const melanin of [0.05, 0.5, 1])
      for (const kind of ["cafe-au-lait", "naevus", "port-wine", "vitiligo"] as const) {
        // A mark far larger than the skin: its full strength at the centre.
        const m = mark(kind, { width: 2, length: 2 });
        const c = markChannels(m);
        const want = markedAlbedo(appearance(melanin).tone, c);
        const got = diffuse(melanin, { tattoos: [], marks: [m] });
        // Eight-bit channels: within 1% of full scale.
        got.forEach((x, k) => {
          expect(Math.abs(x - (want[k] as number)), `${kind} at melanin ${melanin}`).toBeLessThan(
            0.01,
          );
        });
      }
  });

  it("leaves the nail plate untouched by any mark or ink: it is not skin", () => {
    const base = skinAlbedo(appearance(0.7).tone);
    const solid = quadrants([20, 20, 25], [20, 20, 25], [20, 20, 25], [20, 20, 25]);
    const kinds = [
      mark("vitiligo", { width: 2, length: 2 }),
      mark("cafe-au-lait", { width: 2, length: 2 }),
      mark("naevus", { width: 2, length: 2 }),
      mark("port-wine", { width: 2, length: 2 }),
      mark("dermal-melanocytosis", { width: 2, length: 2 }),
      mark("scar", { width: 2, length: 2, maturity: 0, raised: 1 }),
    ];
    for (const art of [
      ...kinds.map((m) => ({ tattoos: [], marks: [m] })),
      { tattoos: [tattoo({ image: "ink", width: 0.4 })], marks: [] },
    ]) {
      const what = art.marks[0]?.kind ?? "tattoo";
      const plate = [NAIL_GLOSS_LAYER, 1] as const;
      diffuse(0.7, art, { ink: solid }, plate).forEach((c, k) => {
        expect(Math.abs(c - (base[k] as number)), what).toBeLessThan(0.01);
      });
      // Nor its surface: no scar's smoothness or raise.
      const surface = shade(0.7, art, { ink: solid }, { under: plate, output: "surface" })[4];
      expect(surface, what).toEqual([0, 0, 0]);
      // Off the plate the same art changes the skin.
      const bare = diffuse(0.7, art, { ink: solid }, [NAIL_GLOSS_LAYER, 0]);
      expect(
        Math.max(...bare.map((c, k) => Math.abs(c - (base[k] as number)))),
        what,
      ).toBeGreaterThan(0.01);
    }
  });

  it("whitens a lip as a depigmented lip, pink rather than lavender, at every tone", () => {
    for (const melanin of [0.05, 0.5, 1]) {
      const tone = appearance(melanin).tone;
      const vitiligo = mark("vitiligo", { width: 2, length: 2 });
      const got = diffuse(melanin, { tattoos: [], marks: [vitiligo] }, images, [LIPS_LAYER, 1]);
      // The lips' layer mixes in at its strength over the skin; under vitiligo
      // both lose their melanin, the lip to the lip of skin that light.
      const w = LIPS_LAYER.paint(appearance(melanin)).strength;
      const want = vitiligoAlbedo(tone).map(
        (s, k) => s + ((vitiligoLipAlbedo(tone, 0.5)[k] as number) - s) * w,
      );
      got.forEach((c, k) => {
        expect(Math.abs(c - (want[k] as number)), `melanin ${melanin}`).toBeLessThan(0.01);
      });
      // Pink: red well above blue, as lips are.
      expect(got[0] as number).toBeGreaterThan(1.3 * (got[2] as number));
    }
  });

  it("reads body art only while the figure has some", () => {
    const m = new SkinMaterial([]);
    const plain = m.customProgramCacheKey();
    expect(m.defines?.HK_BODY_ART).toBeUndefined();
    const marked = bakeBodyArt(renderer, skin(), { tattoos: [], marks: [mark("scar")] }, {}, 16);
    m.setBodyArt(marked);
    expect(m.defines?.HK_BODY_ART).toBe("");
    expect(m.defines?.HK_DECAL_LAYERS).toBeUndefined();
    const art = m.customProgramCacheKey();
    expect(art).not.toBe(plain);
    // Tattoos and naevi add their decal layers, one per layer of overlap.
    const inked = bakeBodyArt(renderer, skin(), placement(tattoo(), tattoo()), images, 16);
    m.setBodyArt(inked);
    expect(m.defines?.HK_DECAL_LAYERS).toBe("2");
    expect(m.customProgramCacheKey()).not.toBe(art);
    const naevus = bakeBodyArt(renderer, skin(), { tattoos: [], marks: [mark("naevus")] }, {}, 16);
    m.setBodyArt(naevus);
    expect(m.defines?.HK_DECAL_LAYERS).toBe("1");
    m.setBodyArt(null);
    expect(m.defines?.HK_BODY_ART).toBeUndefined();
    expect(m.defines?.HK_DECAL_LAYERS).toBeUndefined();
    expect(m.customProgramCacheKey()).toBe(plain);
    marked.dispose();
    inked.dispose();
    naevus.dispose();
    m.dispose();
  });
});
