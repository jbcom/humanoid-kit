/**
 * The skin layer stack on the GPU (src/surface/layers.ts, src/render/layerAtlas.ts):
 * the field atlas holds each layer's fields where its UV islands are and fills
 * their gutters, and the skin shader applies the stack exactly as
 * `applyLayers` does, gradients included.
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
import { buildLayerAtlas, type LayerAtlasSource } from "../../src/render/layerAtlas.ts";
import { SkinMaterial } from "../../src/render/skinMaterial.ts";
import { GUTTER } from "../../src/render/uvRaster.ts";
import { densePlan, planAtlas } from "../../src/surface/atlasPlan.ts";
import {
  applyLayers,
  paintStopTable,
  type SkinLayer,
  type SkinPaintInput,
} from "../../src/surface/layers.ts";
import { SKIN_LAYERS } from "../../src/surface/regions/index.ts";
import { type Rgb, skinAlbedo } from "../../src/surface/skinTone.ts";
import { readPage as readAtlasPage } from "./readPage.ts";

const SIZE = 64;
const canvas = document.createElement("canvas");
const renderer = new WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE, false);
const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.set(0, 0, 5);
camera.lookAt(0, 0, 0);
const target = new WebGLRenderTarget(SIZE, SIZE, { type: FloatType });
afterAll(() => {
  target.dispose();
  renderer.dispose();
});

/** A quad covering UVs [lo, hi]², with per-layer (mask, coord) at its four corners. */
function quadSource(
  lo: number,
  hi: number,
  corners: ((u: number, v: number) => [number, number])[],
): LayerAtlasSource {
  const uvs = new Float32Array([lo, lo, hi, lo, hi, hi, lo, hi]);
  const layerFields = new Float32Array(corners.length * 4 * 2);
  corners.forEach((field, l) => {
    for (let v = 0; v < 4; v++) {
      const [m, c] = field(uvs[v * 2] as number, uvs[v * 2 + 1] as number);
      layerFields[(l * 4 + v) * 2] = m;
      layerFields[(l * 4 + v) * 2 + 1] = c;
    }
  });
  return {
    uvs,
    index: new Uint32Array([0, 1, 2, 0, 2, 3]),
    vertexCount: 4,
    layerFields,
    layers: corners.map((_, l) => `l${l}`),
    plan: densePlan(corners.length),
  };
}

const readPage = (texture: Texture, page: number, size: number) =>
  readAtlasPage(renderer, texture, page, size);

describe("the layer field atlas", () => {
  it("holds each layer's fields on its islands, fills their gutters, and leaves the rest empty", () => {
    const size = 64;
    const source = quadSource(0.25, 0.75, [
      (u, v) => [(u - 0.25) * 2, (v - 0.25) * 2], // mask across u, coord across v
      () => [0.5, 0.25],
      () => [1, 1],
    ]);
    const atlas = buildLayerAtlas(renderer, source, size);
    try {
      expect(atlas.pages).toBe(2);
      const p0 = readPage(atlas.texture, 0, size);
      const p1 = readPage(atlas.texture, 1, size);
      const at = (page: Float32Array, x: number, y: number) =>
        Array.from(page.slice((y * size + x) * 4, (y * size + x) * 4 + 4));
      // Centre of the island: layer 0 at (0.5, 0.5) of its ramp, layer 1 constant.
      const centre = at(p0, 32, 32);
      expect(centre[0]).toBeCloseTo(0.5, 1);
      expect(centre[1]).toBeCloseTo(0.5, 1);
      expect(centre[2]).toBeCloseTo(0.5, 2);
      expect(centre[3]).toBeCloseTo(0.25, 2);
      expect(at(p1, 32, 32).slice(0, 2)).toEqual([1, 1]);
      // Gutter just right of the island (x from 48): the right edge's values, mask ≈ 1.
      const gutter = at(p0, 48 + GUTTER - 2, 32);
      expect(gutter[0]).toBeGreaterThan(0.9);
      expect(gutter[2]).toBeCloseTo(0.5, 2);
      // Far from any island: no layer.
      expect(at(p0, 2, 2)).toEqual([0, 0, 0, 0]);
      expect(at(p1, 60, 60)).toEqual([0, 0, 0, 0]);
    } finally {
      atlas.dispose();
    }
  });
});

describe("the skin shader's layer stack", () => {
  // A gradient (mix), a tint (multiply) and a flat colour (mix), so the stop
  // lookup along the coordinate, both blends and the order are all exercised.
  const layers: SkinLayer[] = [
    {
      id: "ramp",
      blend: "mix",
      targets: [],
      fields: () => ({ mask: new Float32Array(0), coord: null }),
      paint: () => ({
        strength: 1,
        stops: [
          [0.05, 0.1, 0.6],
          [0.6, 0.5, 0.05],
          [0.9, 0.2, 0.2],
        ],
      }),
    },
    {
      id: "tint",
      blend: "multiply",
      targets: [],
      fields: () => ({ mask: new Float32Array(0), coord: null }),
      paint: ({ flush }) => ({ strength: flush, stops: [[1.3, 0.7, 0.8]] }),
    },
    {
      id: "flat",
      blend: "mix",
      targets: [],
      fields: () => ({ mask: new Float32Array(0), coord: null }),
      paint: () => ({ strength: 0.5, stops: [[0.2, 0.6, 0.3]] }),
    },
  ];
  // Fields over the full-screen quad, linear so the rasterised atlas holds them
  // exactly: the ramp's mask rises across u and its coordinate across v, the
  // tint rises up the quad, the flat colour towards the left.
  const fields = (u: number, v: number): [number, number][] => [
    [u, v],
    [v, 0],
    [1 - u, 0],
  ];

  const appearance: SkinPaintInput = {
    tone: { melanin: 0.5, haemoglobin: 0.5, undertone: 0, override: null },
    flush: 0.8,
    lips: 0.5,
    areola: 0.5,
    signals: {},
  };

  /**
   * The largest difference, over a full-screen quad, between the shader's diffuse
   * colour and `applyLayers` at the same fields.
   */
  function worstDifference(
    layers: readonly SkinLayer[],
    appearance: SkinPaintInput,
    fields: (u: number, v: number) => [number, number][],
  ): number {
    const plane = new PlaneGeometry(2, 2);
    const uv = plane.getAttribute("uv");
    const source: LayerAtlasSource = {
      uvs: uv.array as Float32Array,
      index: plane.getIndex()?.array as Uint16Array,
      vertexCount: uv.count,
      layerFields: new Float32Array(layers.length * uv.count * 2),
      layers: layers.map((l) => l.id),
      plan: planAtlas(layers),
    };
    for (let v = 0; v < uv.count; v++) {
      fields(uv.getX(v), uv.getY(v)).forEach(([m, c], l) => {
        source.layerFields[(l * uv.count + v) * 2] = m;
        source.layerFields[(l * uv.count + v) * 2 + 1] = c;
      });
    }
    const atlas = buildLayerAtlas(renderer, source, 256);
    const material = new SkinMaterial(layers);
    material.setAppearance(appearance);
    material.setLayerAtlas(atlas);
    // Output the diffuse colour itself, before any lighting.
    const compile = material.onBeforeCompile;
    material.onBeforeCompile = (shader, r) => {
      compile.call(material, shader, r);
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        "#include <dithering_fragment>\n\tgl_FragColor = vec4( diffuseColor.rgb, 1.0 );",
      );
    };
    material.customProgramCacheKey = () => "humanoid-kit-skin-test-diffuse";
    const mesh = new Mesh(plane, material);
    const scene = new Scene();
    scene.add(mesh);
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const pixels = new Float32Array(SIZE * SIZE * 4);
    renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels);
    renderer.setRenderTarget(null);

    const table = paintStopTable(layers, appearance);
    const base: Rgb = skinAlbedo(appearance.tone);
    let worst = 0;
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const u = (x + 0.5) / SIZE;
        const v = (y + 0.5) / SIZE;
        const want = applyLayers(base, table, fields(u, v));
        for (let k = 0; k < 3; k++)
          worst = Math.max(
            worst,
            Math.abs((pixels[(y * SIZE + x) * 4 + k] as number) - (want[k] as number)),
          );
      }
    atlas.dispose();
    material.dispose();
    plane.dispose();
    return worst;
  }

  it("matches applyLayers per pixel", () => {
    // 8-bit fields and half-float stops: within 1% of full scale.
    expect(worstDifference(layers, appearance, fields)).toBeLessThan(0.01);
  });

  it("reads each layer's own fields from a channel that layers on separate patches of the skin share", () => {
    const gradient = (id: string, stops: [number, number, number][]): SkinLayer => ({
      id,
      blend: "mix",
      targets: [],
      fields: () => ({ mask: new Float32Array(0), coord: null }),
      paint: () => ({ strength: 1, stops }),
    });
    const group = [
      gradient("a", [
        [0.05, 0.1, 0.6],
        [0.9, 0.2, 0.2],
      ]),
      gradient("b", [
        [0.2, 0.7, 0.1],
        [0.6, 0.5, 0.05],
      ]),
    ];
    // Two quads, a patch of skin each, a layer on each: layer a runs its coordinate up
    // its quad, layer b down its own. Left quad u in [.1, .4], right in [.6, .9].
    const quad = (u0: number, u1: number, x0: number, x1: number) => ({
      uv: [u0, 0.2, u1, 0.2, u1, 0.8, u0, 0.8],
      xy: [x0, -0.8, x1, -0.8, x1, 0.8, x0, 0.8],
    });
    const left = quad(0.1, 0.4, -0.8, -0.1);
    const right = quad(0.6, 0.9, 0.1, 0.8);
    const uvs = new Float32Array([...left.uv, ...right.uv]);
    const index = new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    const layerFields = new Float32Array(2 * 8 * 2);
    for (let k = 0; k < 4; k++) {
      const v = uvs[k * 2 + 1] as number;
      layerFields[k * 2] = 1;
      layerFields[k * 2 + 1] = (v - 0.2) / 0.6;
      layerFields[(8 + 4 + k) * 2] = 1;
      layerFields[(8 + 4 + k) * 2 + 1] = 1 - (v - 0.2) / 0.6;
    }
    const surface = { uvs, index, vertexCount: 8, layerFields };
    const plan = planAtlas(group, surface);
    // One value channel and one coordinate for both layers, told apart by an owner map.
    expect(plan.value[1]).toBe(plan.value[0]);
    expect(plan.coord[1]).toBe(plan.coord[0]);
    expect(plan.channels).toBe(2);
    expect(plan.owner[0]).toBeGreaterThanOrEqual(0);

    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(
        new Float32Array([...left.xy, ...right.xy].flatMap((c, i) => (i % 2 ? [c, 0] : [c]))),
        3,
      ),
    );
    geometry.setAttribute("normal", new BufferAttribute(new Float32Array(8 * 3).fill(0), 3));
    for (let v = 0; v < 8; v++) geometry.attributes.normal?.setZ(v, 1);
    geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
    geometry.setIndex(new BufferAttribute(index, 1));
    const source: LayerAtlasSource = {
      uvs,
      index,
      vertexCount: 8,
      layerFields,
      layers: ["a", "b"],
      plan,
    };
    const atlas = buildLayerAtlas(renderer, source, 256);
    const material = new SkinMaterial(group);
    material.setAppearance(appearance);
    material.setLayerAtlas(atlas);
    const compile = material.onBeforeCompile;
    material.onBeforeCompile = (shader, r) => {
      compile.call(material, shader, r);
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        "#include <dithering_fragment>\n\tgl_FragColor = vec4( diffuseColor.rgb, 1.0 );",
      );
    };
    material.customProgramCacheKey = () => "humanoid-kit-skin-test-diffuse-shared";
    const scene = new Scene();
    scene.add(new Mesh(geometry, material));
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const pixels = new Float32Array(SIZE * SIZE * 4);
    renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels);
    renderer.setRenderTarget(null);

    const table = paintStopTable(group, appearance);
    const base: Rgb = skinAlbedo(appearance.tone);
    let worst = 0;
    let checked = 0;
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const cx = ((x + 0.5) / SIZE) * 2 - 1;
        const cy = ((y + 0.5) / SIZE) * 2 - 1;
        // Well inside either quad, so no edge pixel is in question.
        if (Math.abs(cy) > 0.7) continue;
        const v = (cy + 0.8) / 1.6;
        let fields: [number, number][] | null = null;
        if (cx > -0.7 && cx < -0.2)
          fields = [
            [1, v],
            [0, 0],
          ];
        else if (cx > 0.2 && cx < 0.7)
          fields = [
            [0, 0],
            [1, 1 - v],
          ];
        if (!fields) continue;
        checked++;
        const want = applyLayers(base, table, fields);
        for (let k = 0; k < 3; k++)
          worst = Math.max(
            worst,
            Math.abs((pixels[(y * SIZE + x) * 4 + k] as number) - (want[k] as number)),
          );
      }
    atlas.dispose();
    material.dispose();
    geometry.dispose();
    expect(checked).toBeGreaterThan(500);
    expect(worst).toBeLessThan(0.01);
  });

  it("paints the skin-state layers as applyLayers does, at every signal at once", () => {
    // Haemoglobin ratios near 1 and a lip colour mixed over the lips: the half-float
    // stop table must keep them. Masks rise and fall across the quad so every layer shows.
    const stack = SKIN_LAYERS.filter((l) => l.kind !== "detail" && l.kind !== "surface");
    const everything: SkinPaintInput = {
      ...appearance,
      signals: { blush: 1, exertion: 0.7, heat: 0.5, fear: 0.4, cold: 0.8 },
    };
    const worst = worstDifference(stack, everything, (u, v) =>
      stack.map((_, l) => [l % 2 ? u : v, 0.3 * l]),
    );
    expect(worst).toBeLessThan(0.01);
  });
});
