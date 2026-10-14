/**
 * A causal collar diagnostic: every frame below uses the same settled
 * SkinMaterial, dual-bone deformation, geometry, studio lights and Canvas main
 * camera. Only the material's public normal-map and layer-atlas switches vary.
 * This deliberately does not compare against MeshNormalMaterial: that would
 * replace the product's dual-skin path as well as its surface treatment.
 */
import { Canvas, type RootState, useThree } from "@react-three/fiber";
import { type ReactNode, useEffect } from "react";
import {
  DataTexture,
  HalfFloatType,
  type Matrix4,
  type Object3D,
  type PerspectiveCamera,
  RGBAFormat,
  type SkinnedMesh,
  UnsignedByteType,
  type Vector2,
  Vector3,
  WebGLRenderTarget,
} from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  Humanoid,
  HumanoidProvider,
  STUDIO_EXPOSURE,
  STUDIO_SHADOWS,
  STUDIO_TONE_MAPPING,
  StudioStage,
  useHumanoidReady,
} from "../../src/react/index.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";
import type { DualBones } from "../../src/render/dualSkinning.ts";
import { buildLayerAtlas, type LayerAtlas } from "../../src/render/layerAtlas.ts";
import { SkinMaterial } from "../../src/render/skinMaterial.ts";
import { STOP_TABLE_WIDTH, swellHeight } from "../../src/surface/layers.ts";
import { CLAVICLE_LAYER, CLAVICLE_PROFILE } from "../../src/surface/regions/torso.ts";
import type { ReadyInfo } from "../../src/worker/protocol.ts";
import { inlineWorkerClient } from "./inlineClient.ts";
import { readPage } from "./readPage.ts";

const LOAD = { timeout: 300_000 };
const SIDE = 512;
const FOCUS_BONES = ["clavicle.L", "clavicle.R", "neck01"] as const;

const client = inlineWorkerClient({ subdivision: 1 }, { adultAnatomy: true });
beforeAll(async () => {
  await client.ready;
}, LOAD.timeout);
afterAll(() => client.dispose());

const RECIPE = createRecipe({
  macros: {
    age: 30,
    gender: 0,
    african: 1 / 3,
    asian: 1 / 3,
    caucasian: 1 / 3,
    muscle: 0.5,
    weight: 0.5,
    height: 0.5,
    proportions: 0.5,
  },
  bodyArt: {
    birthmarks: [
      { kind: "cafe-au-lait", at: "brow.R", size: 0.025, rotation: 12, seed: 11 },
      { kind: "naevus", at: "ear-lobe.L", size: 0.009, rotation: 0, seed: 12 },
      { kind: "port-wine", at: "lower-lip", size: 0.018, rotation: 0, seed: 13 },
      { kind: "dermal-melanocytosis", at: "navel", size: 0.055, rotation: 35, seed: 14 },
    ],
  },
});

function Probe({ onReady }: { onReady: (get: () => RootState, ready: ReadyInfo | null) => void }) {
  const get = useThree((state) => state.get);
  const ready = useHumanoidReady();
  useEffect(() => {
    onReady(get, ready);
  }, [get, onReady, ready]);
  return null;
}

function bodyOf(scene: Object3D): SkinnedMesh {
  let body: SkinnedMesh | null = null;
  scene.traverse((object) => {
    const part = object.userData.hkPart;
    if ((part === "body" || part === "adultBody") && object.visible) body = object as SkinnedMesh;
  });
  if (!body) throw new Error("collar diagnostic could not find the visible body mesh");
  return body;
}

function dualOf(scene: Object3D): DualBones {
  let dual: DualBones | null = null;
  scene.traverse((object) => {
    const value = (object.userData as { dualBones?: DualBones }).dualBones;
    if (value) dual = value;
  });
  if (!dual) throw new Error("collar diagnostic requires the product dual-bone path");
  return dual;
}

function frameCollar(camera: PerspectiveCamera, scene: Object3D): void {
  const target = new Vector3();
  const bones = FOCUS_BONES.map((name) => scene.getObjectByName(name));
  if (bones.some((bone) => !bone))
    throw new Error(`collar diagnostic missing focus bones: ${FOCUS_BONES.join(", ")}`);
  for (const bone of bones) {
    bone?.updateWorldMatrix(true, false);
    target.add(new Vector3().setFromMatrixPosition(bone?.matrixWorld as Matrix4));
  }
  target.multiplyScalar(1 / bones.length);
  camera.position.set(target.x, target.y + 0.05, target.z + 0.62);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

type SurfaceState = "baseline" | "pores-off" | "layers-off" | "both-off" | "clavicle-off";
type Capture = {
  pixels: Uint8Array;
  camera: number[];
  bones: number[];
  screenshot: string;
  glError: number;
};

type OriginalSurface = {
  normalMap: SkinMaterial["normalMap"];
  normalScale: Vector2;
  atlas: Parameters<SkinMaterial["setLayerAtlas"]>[0];
  stops: DataTexture;
};

type ClavicleDisabledSurface = {
  atlas: LayerAtlas;
  stops: DataTexture;
  layerIndex: number;
  fieldRow: { start: number; length: number };
  stopRow: { start: number; length: number };
};

type AtlasSeamReceipt = {
  edge: string;
  triangles: number[];
  gradientJump: number;
  expected: number[];
  actual: number[];
  owner: number;
  ownerId: number;
};

function samplerBudgetReceipt(state: RootState, material: SkinMaterial) {
  const gl = state.gl.getContext();
  const skinKey = material.customProgramCacheKey();
  const programs = (
    state.gl.info as unknown as {
      programs?: {
        cacheKey?: string;
        program?: WebGLProgram;
        vertexShader?: WebGLShader;
        fragmentShader?: WebGLShader;
      }[];
    }
  ).programs;
  const program = programs?.find((candidate) => candidate.cacheKey?.endsWith(skinKey));
  if (!program?.program || !program.vertexShader || !program.fragmentShader)
    throw new Error("collar diagnostic could not find the live skin program");
  const gl2 = gl as WebGL2RenderingContext;
  const samplerTypes = new Set<number>([
    gl.SAMPLER_2D,
    gl.SAMPLER_CUBE,
    gl2.SAMPLER_2D_SHADOW,
    gl2.SAMPLER_2D_ARRAY,
    gl2.SAMPLER_2D_ARRAY_SHADOW,
  ]);
  const vertexSource = gl.getShaderSource(program.vertexShader) ?? "";
  const fragmentSource = gl.getShaderSource(program.fragmentShader) ?? "";
  const samplers: { name: string; size: number; type: number; stages: string[] }[] = [];
  const active = gl.getProgramParameter(program.program, gl.ACTIVE_UNIFORMS) as number;
  for (let index = 0; index < active; index++) {
    const uniform = gl.getActiveUniform(program.program, index);
    if (uniform && samplerTypes.has(uniform.type)) {
      const name = uniform.name.replace(/\[0\]$/, "");
      samplers.push({
        name: uniform.name,
        size: uniform.size,
        type: uniform.type,
        stages: [
          ...(vertexSource.includes(name) ? ["vertex"] : []),
          ...(fragmentSource.includes(name) ? ["fragment"] : []),
        ],
      });
    }
  }
  return {
    maxVertexTextureUnits: gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) as number,
    maxFragmentTextureUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number,
    maxCombinedTextureUnits: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) as number,
    activeSamplerUnits: samplers.reduce((sum, sampler) => sum + sampler.size, 0),
    samplers,
  };
}

function expectOnlyRowChanged(
  before: ArrayLike<number>,
  after: ArrayLike<number>,
  rowStart: number,
  rowLength: number,
  label: string,
): void {
  expect(after.length, `${label} length`).toBe(before.length);
  for (let i = 0; i < before.length; i++) {
    if (i >= rowStart && i < rowStart + rowLength) continue;
    expect(after[i], `${label} index ${i}`).toBe(before[i]);
  }
}

function clavicleDisabledSurface(
  state: RootState,
  ready: ReadyInfo,
  original: OriginalSurface,
): ClavicleDisabledSurface {
  const { body } = ready.topology;
  const layerIndex = body.layers.indexOf(CLAVICLE_LAYER.id);
  expect(layerIndex, "clavicle layer index").toBeGreaterThanOrEqual(0);

  const fields = Float32Array.from(body.layerFields);
  const fieldRowLength = body.vertexCount * 2;
  const fieldRowStart = layerIndex * fieldRowLength;
  expect(
    fields.subarray(fieldRowStart, fieldRowStart + fieldRowLength).some((v) => v !== 0),
    "clavicle fields present",
  ).toBe(true);
  fields.fill(0, fieldRowStart, fieldRowStart + fieldRowLength);
  expectOnlyRowChanged(body.layerFields, fields, fieldRowStart, fieldRowLength, "layer fields");

  const originalData = original.stops.image.data;
  if (!(originalData instanceof Uint16Array))
    throw new Error("collar diagnostic expected a HalfFloat Uint16 stop table");
  const stops = new DataTexture(
    Uint16Array.from(originalData),
    original.stops.image.width,
    original.stops.image.height,
    RGBAFormat,
    HalfFloatType,
  );
  stops.minFilter = original.stops.minFilter;
  stops.magFilter = original.stops.magFilter;
  stops.wrapS = original.stops.wrapS;
  stops.wrapT = original.stops.wrapT;
  stops.colorSpace = original.stops.colorSpace;
  stops.generateMipmaps = original.stops.generateMipmaps;
  stops.flipY = original.stops.flipY;
  stops.unpackAlignment = original.stops.unpackAlignment;
  const stopRowLength = STOP_TABLE_WIDTH * 4;
  const stopRowStart = layerIndex * stopRowLength;
  const stopData = stops.image.data as Uint16Array;
  expect(
    stopData.subarray(stopRowStart, stopRowStart + stopRowLength).some((v) => v !== 0),
    "clavicle stops present",
  ).toBe(true);
  stopData.fill(0, stopRowStart, stopRowStart + stopRowLength);
  expectOnlyRowChanged(originalData, stopData, stopRowStart, stopRowLength, "layer stops");
  stops.needsUpdate = true;

  // This clone is test-owned: all non-clavicle field rows and stop rows are
  // byte-identical to the product source, while this one layer is disabled.
  const atlas = buildLayerAtlas(state.gl, {
    uvs: body.uvs,
    index: body.index,
    vertexCount: body.vertexCount,
    layerFields: fields,
    layers: body.layers,
    plan: body.plan,
  });
  expect(atlas.plan, "atlas plan").toBe(body.plan);
  return {
    atlas,
    stops,
    layerIndex,
    fieldRow: { start: fieldRowStart, length: fieldRowLength },
    stopRow: { start: stopRowStart, length: stopRowLength },
  };
}

function barycentricAt(
  u: number,
  v: number,
  points: readonly [number, number][],
): [number, number, number] {
  const firstPoint = points[0];
  const secondPoint = points[1];
  const thirdPoint = points[2];
  if (!firstPoint || !secondPoint || !thirdPoint)
    throw new Error("barycentric collar sample needs exactly three points");
  const [u0, v0] = firstPoint;
  const [u1, v1] = secondPoint;
  const [u2, v2] = thirdPoint;
  const det = (v1 - v2) * (u0 - u2) + (u2 - u1) * (v0 - v2);
  const first = ((v1 - v2) * (u - u2) + (u2 - u1) * (v - v2)) / det;
  const second = ((v2 - v0) * (u - u2) + (u0 - u2) * (v - v2)) / det;
  return [first, second, 1 - first - second];
}

/**
 * Reads the same 1024px field atlas the product uses at its worst interior
 * clavicle triangle seam. This separates field interpolation from owner-map or
 * raster corruption; it never substitutes a material or changes product data.
 */
function atlasSeamReceipt(state: RootState, body: ReadyInfo["topology"]["body"]): AtlasSeamReceipt {
  const layer = body.layers.indexOf(CLAVICLE_LAYER.id);
  expect(layer, "clavicle atlas layer").toBeGreaterThanOrEqual(0);
  const n = body.vertexCount;
  const field = body.layerFields.subarray(layer * n * 2, (layer + 1) * n * 2);
  type Triangle = { ids: number[]; fields: number[]; gradient: [number, number] };
  const triangles: Triangle[] = [];
  const edges = new Map<string, number[]>();
  const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  for (let at = 0; at < body.index.length; at += 3) {
    const ids = [body.index[at], body.index[at + 1], body.index[at + 2]] as number[];
    const fields = ids.flatMap((id) => [field[id * 2] as number, field[id * 2 + 1] as number]);
    const height = ids.map((_, k) =>
      swellHeight(1, CLAVICLE_PROFILE, fields[k * 2 + 1] as number, fields[k * 2] as number),
    );
    const a = ids[0] as number;
    const b = ids[1] as number;
    const c = ids[2] as number;
    const u0 = body.uvs[a * 2] as number;
    const v0 = body.uvs[a * 2 + 1] as number;
    const du1 = (body.uvs[b * 2] as number) - u0;
    const dv1 = (body.uvs[b * 2 + 1] as number) - v0;
    const du2 = (body.uvs[c * 2] as number) - u0;
    const dv2 = (body.uvs[c * 2 + 1] as number) - v0;
    const determinant = du1 * dv2 - du2 * dv1;
    const dh1 = (height[1] as number) - (height[0] as number);
    const dh2 = (height[2] as number) - (height[0] as number);
    triangles.push({
      ids,
      fields,
      gradient: [(dh1 * dv2 - dh2 * dv1) / determinant, (du1 * dh2 - du2 * dh1) / determinant],
    });
    for (const [left, right] of [
      [a, b],
      [b, c],
      [c, a],
    ] as [number, number][]) {
      const key = edgeKey(left, right);
      const hits = edges.get(key) ?? [];
      hits.push(at / 3);
      edges.set(key, hits);
    }
  }
  let selected: { edge: string; triangles: number[]; jump: number } | null = null;
  for (const [edge, shared] of edges) {
    if (shared.length !== 2) continue;
    const first = triangles[shared[0] as number] as Triangle;
    const second = triangles[shared[1] as number] as Triangle;
    const masks = [...first.fields, ...second.fields].filter((_, i) => i % 2 === 0);
    if (Math.max(...masks) <= 0.1) continue;
    const jump = Math.hypot(
      (first.gradient[0] as number) - (second.gradient[0] as number),
      (first.gradient[1] as number) - (second.gradient[1] as number),
    );
    if (!selected || jump > selected.jump) selected = { edge, triangles: shared, jump };
  }
  if (!selected) throw new Error("collar diagnostic found no shared interior field edge");
  const triangle = triangles[selected.triangles[0] as number] as Triangle;
  const points = triangle.ids.map(
    (id) => [body.uvs[id * 2] as number, body.uvs[id * 2 + 1] as number] as [number, number],
  );
  const [u, v] = points.reduce(
    ([sumU, sumV], [pointU, pointV]) => [sumU + pointU / 3, sumV + pointV / 3],
    [0, 0],
  );
  const size = 1024;
  const x = Math.floor(u * size);
  const y = Math.floor(v * size);
  const weights = barycentricAt((x + 0.5) / size, (y + 0.5) / size, points);
  expect(Math.min(...weights), "sample stays inside its source triangle").toBeGreaterThan(0);
  const expected = [0, 1].map((component) =>
    weights.reduce(
      (sum, weight, vertex) => sum + weight * (triangle.fields[vertex * 2 + component] as number),
      0,
    ),
  );
  const atlas = buildLayerAtlas(state.gl, body, size);
  try {
    const channel = body.plan.value[layer] as number;
    const page = readPage(state.gl, atlas.texture, Math.floor(channel / 4), size);
    const component = (value: number) => value - 4 * Math.floor(value / 4);
    const texel = (y * size + x) * 4;
    const actual = [
      page[texel + component(channel)] as number,
      page[texel + component(body.plan.coord[layer] as number)] as number,
    ];
    const ownerCell =
      Math.min(63, Math.max(0, Math.floor(((y + 0.5) / size) * 64))) * 64 +
      Math.min(63, Math.max(0, Math.floor(((x + 0.5) / size) * 64)));
    const owner = body.plan.ownerMaps[
      (body.plan.owner[layer] as number) * 64 * 64 + ownerCell
    ] as number;
    expect(owner, "atlas owner at collar sample").toBe(body.plan.ownerId[layer]);
    actual.forEach((value, componentIndex) => {
      expect(value, `atlas field ${componentIndex}`).toBeCloseTo(
        expected[componentIndex] as number,
        2,
      );
    });
    return {
      edge: selected.edge,
      triangles: selected.triangles,
      gradientJump: selected.jump,
      expected,
      actual,
      owner,
      ownerId: body.plan.ownerId[layer] as number,
    };
  } finally {
    atlas.dispose();
  }
}

async function capture(
  state: RootState,
  material: SkinMaterial,
  mode: SurfaceState,
  original: OriginalSurface,
  clavicleDisabled: ClavicleDisabledSurface,
): Promise<Capture> {
  const pores = mode === "layers-off" || mode === "baseline";
  const layers = mode === "pores-off" || mode === "baseline";
  material.normalMap = pores ? original.normalMap : null;
  material.normalScale.copy(original.normalScale);
  material.hkUniforms.hkLayerStops.value =
    mode === "clavicle-off" ? clavicleDisabled.stops : original.stops;
  material.setLayerAtlas(
    mode === "clavicle-off" ? clavicleDisabled.atlas : layers ? original.atlas : null,
  );
  material.needsUpdate = true;

  const target = new WebGLRenderTarget(SIDE, SIDE, { type: UnsignedByteType });
  state.gl.setRenderTarget(target);
  state.gl.render(state.scene, state.camera);
  const pixels = new Uint8Array(SIDE * SIDE * 4);
  state.gl.readRenderTargetPixels(target, 0, 0, SIDE, SIDE, pixels);
  const glError = state.gl.getContext().getError();
  state.gl.setRenderTarget(null);
  target.dispose();
  // The saved frame is the same Canvas main camera used for the readback, not
  // a second camera or a synthetic image assembled from the pixels.
  state.gl.render(state.scene, state.camera);
  const screenshot = await page.screenshot({
    element: state.gl.domElement,
    path: `../../test-results/collar-surface-isolation/${mode}.png`,
  });
  const camera = [...state.camera.matrixWorld.elements];
  const bones = Array.from(dualOf(state.scene).texture.image.data ?? []);
  return { pixels, camera, bones, screenshot, glError };
}

function changedPixels(a: Uint8Array, b: Uint8Array, radius = SIDE / 4): number {
  let changed = 0;
  const start = SIDE / 2 - radius;
  const end = SIDE / 2 + radius;
  for (let y = start; y < end; y++)
    for (let x = start; x < end; x++) {
      const i = (y * SIDE + x) * 4;
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) changed++;
    }
  return changed;
}

describe("the product collar surface in the twisted pose", () => {
  it(
    "isolates pores and layer relief with the same product skinning and main camera",
    async () => {
      let get: (() => RootState) | null = null;
      let ready: ReadyInfo | null = null;
      let settled = false;
      const captureProbe = (nextGet: () => RootState, nextReady: ReadyInfo | null) => {
        get = nextGet;
        ready = nextReady;
      };
      const figure: ReactNode = (
        <HumanoidProvider client={client}>
          <div style={{ width: SIDE, height: SIDE }}>
            <Canvas
              shadows={STUDIO_SHADOWS}
              dpr={1}
              camera={{ position: [0, 1, 2], fov: 35 }}
              gl={{ toneMapping: STUDIO_TONE_MAPPING, toneMappingExposure: STUDIO_EXPOSURE }}
            >
              <Probe onReady={captureProbe} />
              <StudioStage contactShadowOpacity={0.32} />
              <Humanoid
                recipe={RECIPE}
                pose={{ body: "twisted" }}
                onSettled={() => (settled = true)}
              />
            </Canvas>
          </div>
        </HumanoidProvider>
      );
      await render(figure);
      await expect.poll(() => settled, LOAD).toBe(true);
      await expect.poll(() => ready, LOAD).not.toBeNull();
      if (!get || !ready)
        throw new Error("collar diagnostic did not receive its Canvas state and topology");
      // Vitest's control-flow analysis cannot observe React's asynchronous probe callback.
      const state = (get as unknown as () => RootState)();
      const topology = (ready as unknown as ReadyInfo).topology;
      frameCollar(state.camera as PerspectiveCamera, state.scene);
      const body = bodyOf(state.scene);
      expect(body.material).toBeInstanceOf(SkinMaterial);
      const material = body.material as SkinMaterial;
      expect(dualOf(state.scene)).toBeTruthy();
      const original = {
        normalMap: material.normalMap,
        normalScale: material.normalScale.clone(),
        atlas: {
          texture: material.hkUniforms.hkLayerAtlas.value,
          owners: material.hkUniforms.hkLayerOwners.value,
          plan: topology.body.plan,
        },
        stops: material.hkUniforms.hkLayerStops.value,
      };
      const atlasReceipt = atlasSeamReceipt(state, topology.body);
      const clavicleDisabled = clavicleDisabledSurface(state, ready as ReadyInfo, original);
      const modes: SurfaceState[] = [
        "baseline",
        "pores-off",
        "layers-off",
        "both-off",
        "clavicle-off",
      ];
      const captures = new Map<SurfaceState, Capture>();
      let samplerBudget: ReturnType<typeof samplerBudgetReceipt> | null = null;
      try {
        for (const mode of modes)
          captures.set(mode, await capture(state, material, mode, original, clavicleDisabled));
        samplerBudget = samplerBudgetReceipt(state, material);
      } finally {
        material.normalMap = original.normalMap;
        material.normalScale.copy(original.normalScale);
        material.hkUniforms.hkLayerStops.value = original.stops;
        material.setLayerAtlas(original.atlas);
        material.needsUpdate = true;
        clavicleDisabled.stops.dispose();
        clavicleDisabled.atlas.dispose();
      }

      const baseline = captures.get("baseline") as Capture;
      expect(samplerBudget, "live skin sampler budget").not.toBeNull();
      // The four frames remain the same figure, camera and dual-bone deformation.
      for (const mode of modes) {
        const current = captures.get(mode) as Capture;
        expect(current.camera, `${mode} camera`).toEqual(baseline.camera);
        expect(current.bones, `${mode} dual bones`).toEqual(baseline.bones);
        expect(current.glError, `${mode} render/readback GL error`).toBe(
          state.gl.getContext().NO_ERROR,
        );
      }
      const deltas = {
        pores: changedPixels(baseline.pixels, captures.get("pores-off")?.pixels as Uint8Array),
        layers: changedPixels(baseline.pixels, captures.get("layers-off")?.pixels as Uint8Array),
        both: changedPixels(baseline.pixels, captures.get("both-off")?.pixels as Uint8Array),
        clavicle: changedPixels(
          baseline.pixels,
          captures.get("clavicle-off")?.pixels as Uint8Array,
        ),
      };
      // The 256px square is centred on the exact averaged collar target used by
      // the lab camera. Each disabled input must be observed in that actual
      // main-camera capture; this is not an appearance acceptance threshold.
      expect(deltas.pores, "pore-normal contribution").toBeGreaterThan(0);
      expect(deltas.layers, "layer-atlas contribution").toBeGreaterThan(0);
      expect(deltas.both, "combined contribution").toBeGreaterThan(0);
      expect(deltas.clavicle, "clavicle layer contribution").toBeGreaterThan(0);
      console.info("collar surface isolation", {
        atlasReceipt,
        clavicleDisabled: {
          layer: CLAVICLE_LAYER.id,
          index: clavicleDisabled.layerIndex,
          fieldRow: clavicleDisabled.fieldRow,
          stopRow: clavicleDisabled.stopRow,
          unchanged: "all remaining field and stop-table values asserted byte-identical",
        },
        deltas,
        samplerBudget,
        screenshots: Object.fromEntries(
          modes.map((mode) => [mode, (captures.get(mode) as Capture).screenshot]),
        ),
      });
    },
    LOAD.timeout,
  );
});
