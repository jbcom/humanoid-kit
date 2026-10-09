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
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { afterAll, describe, expect, it } from "vitest";
import type { BodyArtPlacement, PlacedMark, PlacedTattoo } from "../../src/bodyArt/decals.ts";
import { inkSeen } from "../../src/bodyArt/ink.ts";
import { markChannels, markedAlbedo, markOutline, markShape } from "../../src/bodyArt/marks.ts";
import {
  type BodyArtImages,
  type BodyArtSurface,
  bakeBodyArt,
  MARK_NEUTRAL,
} from "../../src/render/bodyArtTexture.ts";
import { SkinMaterial } from "../../src/render/skinMaterial.ts";
import type { SkinPaintInput } from "../../src/surface/layers.ts";
import { type Rgb, skinAlbedo, srgbToLinear } from "../../src/surface/skinTone.ts";
import { readPage } from "./readPage.ts";

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
function skin(options: { z?: number; facing?: 1 | -1; split?: boolean } = {}): BodyArtSurface {
  const z = options.z ?? 0;
  const f = options.facing ?? 1;
  const xs = options.split ? [-0.1, 0, 0, 0.1] : [-0.1, 0.1];
  const us = options.split ? [0, 0.4, 0.6, 1] : [0, 1];
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (let q = 0; q < xs.length / 2; q++) {
    const [x0, x1] = [xs[q * 2] as number, xs[q * 2 + 1] as number];
    const [u0, u1] = [us[q * 2] as number, us[q * 2 + 1] as number];
    const b = positions.length / 3;
    positions.push(x0, -0.1, z, x1, -0.1, z, x1, 0.1, z, x0, 0.1, z);
    uvs.push(u0, 0, u1, 0, u1, 1, u0, 1);
    index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const n = positions.length / 3;
  return {
    uvs: new Float32Array(uvs),
    index: new Uint32Array(index),
    vertexCount: n,
    positions: new Float32Array(positions),
    normals: new Float32Array(Array.from({ length: n }, () => [0, 0, f]).flat()),
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
const placement = (...tattoos: PlacedTattoo[]): BodyArtPlacement => ({
  tattoos,
  marks: [],
});

const SIZE = 64;
const images = { quads: quadrants(RED, BLUE, GREEN, BARE) };

/** The ink page of a bake, as a reader of texel (u, v) in 0..1: [r, g, b] sRGB 0..255, and coverage 0..1. */
function bake(surface: BodyArtSurface, art: BodyArtPlacement) {
  const t = bakeBodyArt(renderer, surface, art, images, SIZE);
  const page = readPage(renderer, t.texture, 0, SIZE);
  const marks = readPage(renderer, t.texture, 1, SIZE);
  t.dispose();
  return {
    at(u: number, v: number) {
      const i = (Math.floor(v * SIZE) * SIZE + Math.floor(u * SIZE)) * 4;
      return {
        rgb: [0, 1, 2].map((k) => Math.round((page[i + k] as number) * 255)),
        cover: page[i + 3] as number,
      };
    },
    marks,
  };
}

describe("baking a tattoo", () => {
  // The image is 0.1 m wide and 0.05 m tall, centred: u 0.25..0.75, v 0.375..0.625.
  it("puts the image where its frame projects it, the right way up and round", () => {
    const art = bake(skin(), placement(tattoo()));
    const near = (got: number[], want: number[]) =>
      got.forEach((c, k) => {
        expect(Math.abs(c - (want[k] as number))).toBeLessThanOrEqual(2);
      });
    near(art.at(0.375, 0.56).rgb, RED); // top left
    near(art.at(0.625, 0.56).rgb, BLUE); // top right
    near(art.at(0.375, 0.44).rgb, GREEN); // bottom left
    expect(art.at(0.375, 0.56).cover).toBeCloseTo(1, 2);
    expect(art.at(0.625, 0.44).cover).toBe(0); // the bare quadrant
    expect(art.at(0.1, 0.5).cover).toBe(0); // beyond the image
    expect(art.at(0.5, 0.8).cover).toBe(0);
    // No marks: the marks page is no change everywhere.
    for (let i = 0; i < art.marks.length; i += 4) {
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

  it("holds the ink's colour and takes its density as coverage, and turns with the frame", () => {
    const faded = bake(skin(), placement(tattoo({ density: 0.5 })));
    expect(faded.at(0.375, 0.56).cover).toBeCloseTo(0.5, 2);
    expect(faded.at(0.375, 0.56).rgb[0]).toBeGreaterThanOrEqual((RED[0] as number) - 2);
    // Turned 90° counter-clockwise: the image's top now points to the skin's left.
    const turned = bake(skin(), placement(tattoo({ right: [0, 1, 0], up: [-1, 0, 0] })));
    expect(turned.at(0.44, 0.375).rgb[0]).toBeGreaterThan(150); // top left → bottom left of the skin
    expect(turned.at(0.44, 0.625).rgb[2]).toBeGreaterThan(150); // top right → top left
  });

  it("is whole across a UV seam", () => {
    // Straddling x = 0, which is the seam between two islands far apart in UV.
    const art = bake(skin({ split: true }), placement(tattoo()));
    // x -0.025 is u 0.3 in the left island; x +0.025 is u 0.7 in the right.
    expect(art.at(0.3, 0.56).rgb[0]).toBeGreaterThan(150);
    expect(art.at(0.7, 0.56).rgb[2]).toBeGreaterThan(150);
    // Nothing between the islands but their gutters.
    expect(art.at(0.5, 0.56).cover).toBe(0);
  });

  it("marks only skin facing it and near it", () => {
    expect(bake(skin({ facing: -1 }), placement(tattoo())).at(0.375, 0.56).cover).toBe(0);
    // 5 cm behind a tattoo 10 cm wide: past its reach.
    expect(bake(skin({ z: -0.05 }), placement(tattoo())).at(0.375, 0.56).cover).toBe(0);
    expect(bake(skin({ z: -0.005 }), placement(tattoo())).at(0.375, 0.56).cover).toBeCloseTo(1, 2);
  });

  it("puts a later tattoo over an earlier one", () => {
    const solid = { a: quadrants(RED, RED, RED, RED), b: quadrants(BLUE, BLUE, BLUE, BLUE) };
    const t = bakeBodyArt(
      renderer,
      skin(),
      placement(tattoo({ image: "a" }), tattoo({ image: "b", width: 0.05 })),
      solid,
      SIZE,
    );
    const page = readPage(renderer, t.texture, 0, SIZE);
    t.dispose();
    const at = (u: number, v: number) => (Math.floor(v * SIZE) * SIZE + Math.floor(u * SIZE)) * 4;
    expect(Math.round((page[at(0.5, 0.5) + 2] as number) * 255)).toBeGreaterThan(190);
    expect(Math.round((page[at(0.3, 0.5)] as number) * 255)).toBeGreaterThan(190);
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
  function pages(art: BodyArtPlacement) {
    const t = bakeBodyArt(renderer, skin(), art, images, SIZE);
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
    for (const m of [
      mark("cafe-au-lait"),
      mark("scar", { width: 0.01, length: 0.1, maturity: 0, raised: 1 }),
    ]) {
      const c = markChannels(m);
      const outline = markOutline(m);
      const art = pages({ tattoos: [], marks: [m] });
      let worst = 0;
      for (let y = 0; y < SIZE; y += 3)
        for (let x = 0; x < SIZE; x += 3) {
          const s = markShape(m, outline, place(x), place(y));
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
      expect(worst, m.kind).toBeLessThanOrEqual(2);
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

  it("adds marks that overlap, and puts dermal pigment in the ink, under the tattoos", () => {
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
    // The tattoo is over everything: its top-left quadrant is red.
    expect(art.ink(28, 34)[0]).toBeGreaterThan(150);
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

  /** The shader's diffuse colour at the centre of the skin, with this body art baked on it. */
  function diffuse(melanin: number, body: BodyArtPlacement, using: BodyArtImages = images): Rgb {
    const art = bakeBodyArt(renderer, skin(), body, using, SIZE);
    const material = new SkinMaterial([]);
    material.setAppearance(appearance(melanin));
    material.setBodyArt(art.texture);
    const compile = material.onBeforeCompile;
    material.onBeforeCompile = (shader, r) => {
      compile.call(material, shader, r);
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        "#include <dithering_fragment>\n\tgl_FragColor = vec4( diffuseColor.rgb, 1.0 );",
      );
    };
    material.customProgramCacheKey = () => "humanoid-kit-skin-test-ink";
    const geometry = new BufferGeometry();
    const plane = new PlaneGeometry(2, 2);
    geometry.setAttribute("position", plane.getAttribute("position"));
    geometry.setAttribute("normal", plane.getAttribute("normal"));
    geometry.setAttribute("uv", new BufferAttribute(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), 2));
    geometry.setIndex(plane.getIndex());
    const mesh = new Mesh(geometry, material);
    const scene = new Scene().add(mesh);
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.set(0, 0, 5);
    const target = new WebGLRenderTarget(8, 8, { type: FloatType });
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const px = new Float32Array(8 * 8 * 4);
    renderer.readRenderTargetPixels(target, 0, 0, 8, 8, px);
    renderer.setRenderTarget(null);
    for (const d of [target, material, geometry, plane, art]) d.dispose();
    const i = (4 * 8 + 4) * 4;
    return [px[i] as number, px[i + 1] as number, px[i + 2] as number];
  }

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

  it("reads body art only while the figure has some", () => {
    const m = new SkinMaterial([]);
    const plain = m.customProgramCacheKey();
    expect(m.defines?.HK_BODY_ART).toBeUndefined();
    const t = bakeBodyArt(renderer, skin(), placement(tattoo()), images, 16);
    m.setBodyArt(t.texture);
    expect(m.defines?.HK_BODY_ART).toBe("");
    expect(m.customProgramCacheKey()).not.toBe(plain);
    m.setBodyArt(null);
    expect(m.defines?.HK_BODY_ART).toBeUndefined();
    expect(m.customProgramCacheKey()).toBe(plain);
    t.dispose();
    m.dispose();
  });
});
