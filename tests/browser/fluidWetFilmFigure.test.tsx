/**
 * A source-body proof for dynamic fluid coverage: two actual figures share the
 * static layer atlas, while only the right figure receives posed water support.
 */
import { Canvas, type RootState, useThree } from "@react-three/fiber";
import { bodyPack } from "humanoid-kit-body";
import { Component, type ReactNode, useEffect } from "react";
import { type PerspectiveCamera, type Scene, type SkinnedMesh, Vector3 } from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import bodyManifest from "../../packs/body/data/manifest.json";
import { AttachedFluidField, type FluidCoverageSnapshot } from "../../src/fluid/attachedField.ts";
import { fluidFrameFromPose } from "../../src/fluid/posedSurfaceFrame.ts";
import { FluidState, type FluidSurfaceAnchor } from "../../src/fluid/state.ts";
import { loadHumanoidAssets } from "../../src/format/assetFormat.ts";
import { REST_POSE } from "../../src/foundation/permutations.ts";
import { HumanoidModel } from "../../src/model/humanoidModel.ts";
import { Humanoid, HumanoidProvider, StudioStage } from "../../src/react/index.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";
import { bindFluidWetFilmCoverage } from "../../src/render/fluidCoverage.ts";
import { SkinMaterial } from "../../src/render/skinMaterial.ts";
import { inlineWorkerClient } from "./inlineClient.ts";

const LOAD = { timeout: 300_000 };
/** A source-body review PNG is requested explicitly; isolation assertions always run. */
const CAPTURE_WET_FILM = import.meta.env.HK_FLUID_WET_FILM_CAPTURE === "true";
const recipe = createRecipe({ macros: { age: 25 } });
const client = inlineWorkerClient({ subdivision: 1 });

type Proof = {
  rest: FluidCoverageSnapshot;
  flexed: FluidCoverageSnapshot;
  detached: FluidCoverageSnapshot;
  focus: readonly [number, number, number];
  initial: SupportMetadata;
  updated: SupportMetadata;
  releasedKg: number;
};

type SupportMetadata = {
  occupiedTriangles: number;
  coveredVertices: number;
  interpolatedFanTriangles: number;
};

class Boundary extends Component<{ children: ReactNode }, { message: string | null }> {
  override state = { message: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { message: error.message };
  }
  override render() {
    return this.state.message ? (
      <div data-fluid-wet-film-error>{this.state.message}</div>
    ) : (
      this.props.children
    );
  }
}

function Probe({ onReady }: { onReady: (get: () => RootState) => void }) {
  const get = useThree((state) => state.get);
  useEffect(() => onReady(get), [get, onReady]);
  return null;
}

function bodies(scene: Scene): SkinnedMesh[] {
  const found: SkinnedMesh[] = [];
  scene.traverse((object) => {
    if (object.userData.hkPart === "body" && object.visible) found.push(object as SkinnedMesh);
  });
  if (found.length !== 2)
    throw new Error(`fluid wet-film figure proof needs two body meshes, found ${found.length}`);
  return found.sort((a, b) => {
    a.updateWorldMatrix(true, false);
    b.updateWorldMatrix(true, false);
    return a.matrixWorld.elements[12] - b.matrixWorld.elements[12];
  });
}

function bodyPair(scene: Scene): [SkinnedMesh, SkinnedMesh] {
  const found = bodies(scene);
  return [found[0] as SkinnedMesh, found[1] as SkinnedMesh];
}

function skinOf(body: SkinnedMesh): SkinMaterial {
  if (!(body.material instanceof SkinMaterial))
    throw new Error("fluid wet-film figure proof needs the source SkinMaterial");
  return body.material;
}

function triangleNormal(frame: ReturnType<typeof fluidFrameFromPose>, triangle: number): Vector3 {
  const at = triangle * 3;
  const normal = new Vector3();
  for (let corner = 0; corner < 3; corner++) {
    const vertex = frame.index[at + corner] as number;
    normal.add(new Vector3().fromArray(frame.normals, vertex * 3));
  }
  return normal.normalize();
}

function triangleCentre(frame: ReturnType<typeof fluidFrameFromPose>, triangle: number): Vector3 {
  const at = triangle * 3;
  const centre = new Vector3();
  for (let corner = 0; corner < 3; corner++) {
    const vertex = frame.index[at + corner] as number;
    centre.add(new Vector3().fromArray(frame.positions, vertex * 3));
  }
  return centre.multiplyScalar(1 / 3);
}

/** A visible front-torso triangle, found from the actual posed source frame. */
function frontTorsoTriangle(frame: ReturnType<typeof fluidFrameFromPose>): number {
  let selected = -1;
  let score = -Infinity;
  for (let triangle = 0; triangle < frame.index.length / 3; triangle++) {
    const centre = triangleCentre(frame, triangle);
    const normal = triangleNormal(frame, triangle);
    // The camera looks from +z; favour the central upper torso without naming body geometry.
    const candidate = 5 * normal.z - 2.4 * Math.abs(centre.x) - 5 * Math.abs(centre.y - 1.18);
    if (candidate > score) {
      score = candidate;
      selected = triangle;
    }
  }
  if (selected < 0)
    throw new Error("fluid wet-film figure proof could not select a source triangle");
  return selected;
}

function triangleNeighbours(index: Uint32Array, seed: number, count: number): number[] {
  const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const byEdge = new Map<string, number[]>();
  for (let triangle = 0; triangle < index.length / 3; triangle++) {
    const at = triangle * 3;
    const vertices = [index[at], index[at + 1], index[at + 2]] as const;
    for (const [a, b] of [
      [vertices[0], vertices[1]],
      [vertices[1], vertices[2]],
      [vertices[2], vertices[0]],
    ] as const) {
      const key = edgeKey(a as number, b as number);
      const list = byEdge.get(key) ?? [];
      list.push(triangle);
      byEdge.set(key, list);
    }
  }
  const selected = [seed];
  const seen = new Set(selected);
  for (let cursor = 0; cursor < selected.length && selected.length < count; cursor++) {
    const triangle = selected[cursor] as number;
    const at = triangle * 3;
    const vertices = [index[at], index[at + 1], index[at + 2]] as const;
    for (const [a, b] of [
      [vertices[0], vertices[1]],
      [vertices[1], vertices[2]],
      [vertices[2], vertices[0]],
    ] as const) {
      const neighbours = byEdge.get(edgeKey(a as number, b as number)) ?? [];
      for (const neighbour of neighbours)
        if (!seen.has(neighbour) && selected.length < count) {
          seen.add(neighbour);
          selected.push(neighbour);
        }
    }
  }
  if (selected.length !== count)
    throw new Error(
      `fluid wet-film figure proof selected ${selected.length} triangles, expected ${count}`,
    );
  return selected;
}

function supportMetadata(
  frame: ReturnType<typeof fluidFrameFromPose>,
  snapshot: FluidCoverageSnapshot,
): SupportMetadata {
  const water = snapshot.materials.find((material) => material.materialId === "water");
  if (!water) throw new Error("fluid wet-film figure proof has no water coverage");
  const covered = new Set(
    water.vertexCoverage.flatMap((coverage, vertex) => (coverage > 0 ? [vertex] : [])),
  );
  let fan = 0;
  for (let triangle = 0; triangle < frame.index.length / 3; triangle++) {
    const at = triangle * 3;
    if ([0, 1, 2].some((corner) => covered.has(frame.index[at + corner] as number))) fan++;
  }
  return {
    occupiedTriangles: snapshot.cells.length,
    coveredVertices: covered.size,
    interpolatedFanTriangles: fan,
  };
}

function occupiedTexels(material: SkinMaterial): number {
  const texture = material.hkUniforms.hkFluidCoverage.value;
  if (!texture) throw new Error("fluid wet-film figure proof needs a coverage texture");
  const data = (texture as { image: { data: Uint8Array } }).image.data;
  return data.reduce((total, value) => total + Number(value > 0), 0);
}

function renderedPixels(state: RootState): Uint8Array {
  const { gl, scene, camera } = state;
  gl.render(scene, camera);
  const canvas = gl.domElement;
  const pixels = new Uint8Array(canvas.width * canvas.height * 4);
  const context = gl.getContext();
  context.readPixels(
    0,
    0,
    canvas.width,
    canvas.height,
    context.RGBA,
    context.UNSIGNED_BYTE,
    pixels,
  );
  return pixels;
}

function changedPixels(before: Uint8Array, after: Uint8Array): number {
  let changed = 0;
  for (let pixel = 0; pixel < before.length; pixel += 4)
    if (
      before[pixel] !== after[pixel] ||
      before[pixel + 1] !== after[pixel + 1] ||
      before[pixel + 2] !== after[pixel + 2]
    )
      changed++;
  return changed;
}

async function proof(): Promise<Proof> {
  const assets = await loadHumanoidAssets({ body: bodyPack });
  const model = new HumanoidModel(assets, { subdivision: 1 });
  const state = new FluidState({
    figureId: "wet-film-figure-proof",
    seed: 31,
    fixedStepSeconds: 1 / 60,
    topology: {
      topology: bodyManifest.topology,
      bodySha256: bodyManifest.body.sha256,
      triangleCount: model.bodyIndex("base").length / 3,
    },
    recipe,
    assets,
  });
  const restFrame = fluidFrameFromPose(state, model, recipe, REST_POSE);
  const flexedFrame = fluidFrameFromPose(state, model, recipe, "flexed");
  const triangles = triangleNeighbours(flexedFrame.index, frontTorsoTriangle(flexedFrame), 90);
  const field = new AttachedFluidField(state, restFrame, {
    maxCells: triangles.length,
    mobilityPerSecond: 0,
    gravity: [0, -1, 0],
  });
  for (const [order, triangle] of triangles.entries()) {
    const anchor: FluidSurfaceAnchor = {
      kind: "surface",
      topology: bodyManifest.topology,
      bodySha256: bodyManifest.body.sha256,
      triangle,
      barycentric: [1 / 3, 1 / 3, 1 / 3],
    };
    const id = `water-${triangle}`;
    state.registerSource({ id, materialId: "water", anchor, rateKgPerSecond: 0 });
    if (order < 45) field.inject(id, anchor, "water", 0.0005);
  }
  const rest = field.coverageSnapshot(restFrame);
  for (const triangle of triangles.slice(45)) {
    const id = `water-${triangle}`;
    const source = state.snapshot().sources.find((entry) => entry.id === id);
    if (source?.anchor.kind !== "surface")
      throw new Error("fluid wet-film figure proof lost a registered source");
    field.inject(id, source.anchor, "water", 0.0005);
  }
  const flexed = field.coverageSnapshot(flexedFrame);
  const released = field.detach(
    flexedFrame,
    flexed.cells.slice(45).map((cell) => ({
      triangle: cell.triangle,
      materialId: cell.materialId,
      massKg: cell.massKg,
    })),
  );
  const detached = field.coverageSnapshot(flexedFrame);
  return {
    rest,
    flexed,
    detached,
    focus: triangleCentre(flexedFrame, triangles[0] as number).toArray() as [
      number,
      number,
      number,
    ],
    initial: supportMetadata(restFrame, rest),
    updated: supportMetadata(flexedFrame, flexed),
    releasedKg: released.reduce((total, release) => total + release.massKg, 0),
  };
}

beforeAll(async () => {
  await client.ready;
  await client.folds(recipe);
}, LOAD.timeout);
afterAll(() => client.dispose());

function scene(
  pose: string | null,
  onReady: (get: () => RootState) => void,
  onSettled: () => void,
  receipt: string,
) {
  return (
    <HumanoidProvider client={client}>
      <div
        data-fluid-wet-film-figure
        style={{ width: 400, background: "#1b2530", color: "#f5f1e8" }}
      >
        <Boundary>
          <Canvas
            shadows
            camera={{ fov: 28, position: [0, 1.2, 4.4] }}
            style={{ width: 400, height: 480 }}
          >
            <Probe onReady={onReady} />
            <StudioStage background="#1b2530" intensity={1.8} contactShadowOpacity={0} />
            <Humanoid
              recipe={recipe}
              {...(pose && { pose: { body: pose } })}
              position={[-0.5, 0, 0]}
              onEvaluated={onSettled}
              onSettled={onSettled}
            />
            <Humanoid
              recipe={recipe}
              {...(pose && { pose: { body: pose } })}
              position={[0.5, 0, 0]}
              onEvaluated={onSettled}
              onSettled={onSettled}
            />
          </Canvas>
        </Boundary>
        <div
          data-fluid-wet-film-receipt
          style={{
            padding: "8px 10px 12px",
            maxWidth: 380,
            color: "#f5f1e8",
            background: "#1b2530",
            font: "14px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace",
            whiteSpace: "pre-line",
          }}
        >
          {receipt}
        </div>
      </div>
    </HumanoidProvider>
  );
}

describe("posed source-body wet-film coverage", () => {
  it(
    "updates one flexed figure's localized water support without changing its dry atlas-sharing neighbour",
    async () => {
      const source = await proof();
      let get: (() => RootState) | null = null;
      let settled = 0;
      const initialReceipt = "POSE: rest\nwater coverage pending on right source body";
      const screen = await render(
        scene(
          null,
          (state) => (get = state),
          () => settled++,
          initialReceipt,
        ),
      );
      await expect
        .poll(
          () =>
            screen.container.querySelector("[data-fluid-wet-film-error]")?.textContent ??
            (settled >= 2 ? "settled" : null),
          LOAD,
        )
        .toBe("settled");
      const state = get as unknown as () => RootState;
      await expect.poll(() => bodies(state().scene).length, LOAD).toBe(2);
      const [dryRest, wetRest] = bodyPair(state().scene);
      const drySkin = skinOf(dryRest);
      const wetSkin = skinOf(wetRest);
      expect(wetSkin.hkUniforms.hkLayerAtlas.value).toBe(drySkin.hkUniforms.hkLayerAtlas.value);
      bindFluidWetFilmCoverage(wetSkin, wetRest.geometry, source.rest);
      state().invalidate();
      expect(drySkin.hkUniforms.hkFluidCoverage.value).toBeNull();

      await screen.rerender(
        scene(
          "flexed",
          (next) => (get = next),
          () => settled++,
          initialReceipt,
        ),
      );
      await expect.poll(() => settled, LOAD).toBeGreaterThanOrEqual(4);
      const [dryFlexed, wetFlexed] = bodyPair(state().scene);
      const dryFlexedSkin = skinOf(dryFlexed);
      const wetFlexedSkin = skinOf(wetFlexed);
      expect(wetFlexedSkin.hkUniforms.hkLayerAtlas.value).toBe(
        dryFlexedSkin.hkUniforms.hkLayerAtlas.value,
      );
      bindFluidWetFilmCoverage(wetFlexedSkin, wetFlexed.geometry, source.flexed);
      state().invalidate();

      expect(dryFlexedSkin.hkUniforms.hkFluidCoverage.value).toBeNull();
      expect(wetFlexedSkin.hkUniforms.hkFluidCoverage.value).not.toBeNull();
      dryFlexed.updateWorldMatrix(true, false);
      wetFlexed.updateWorldMatrix(true, false);
      const dryX = dryFlexed.matrixWorld.elements[12];
      const wetX = wetFlexed.matrixWorld.elements[12];
      expect(
        Math.abs(wetX - dryX),
        "the two source figures must remain visually distinct",
      ).toBeGreaterThan(0.9);
      expect(source.updated.occupiedTriangles).toBeGreaterThan(source.initial.occupiedTriangles);
      expect(source.updated.interpolatedFanTriangles).toBeGreaterThanOrEqual(
        source.updated.occupiedTriangles,
      );

      const camera = state().camera as PerspectiveCamera;
      const focus = new Vector3(...source.focus);
      const pairCentreX = (dryX + wetX) / 2;
      camera.position.set(pairCentreX, focus.y + 0.04, focus.z + 4.4);
      camera.lookAt(pairCentreX, focus.y, focus.z);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      const fullTexels = occupiedTexels(wetFlexedSkin);
      const fullPixels = renderedPixels(state());
      bindFluidWetFilmCoverage(wetFlexedSkin, wetFlexed.geometry, source.detached);
      state().invalidate();
      const detachedTexels = occupiedTexels(wetFlexedSkin);
      const detachedPixels = renderedPixels(state());
      expect(detachedTexels).toBeLessThan(fullTexels);
      expect(changedPixels(fullPixels, detachedPixels)).toBeGreaterThan(0);
      const receipt = [
        "POSE: flexed — left dry / right partially detached water support",
        "shared static LayerAtlas: same texture object",
        `water: ${source.detached.cells.length}/${source.updated.occupiedTriangles} attached triangles after ${source.releasedKg.toFixed(4)} kg detached`,
        `vertex interpolation reaches ${source.updated.interpolatedFanTriangles} incident triangles (+${source.updated.interpolatedFanTriangles - source.updated.occupiedTriangles} support expansion)`,
        `attached mass: ${source.flexed.attachedKg.toFixed(4)} kg; coverage is support occupancy, not optical alpha or thickness`,
      ].join("\n");
      const receiptNode = screen.container.querySelector("[data-fluid-wet-film-receipt]");
      receiptNode?.replaceChildren(receipt);
      state().gl.render(state().scene, camera);
      if (CAPTURE_WET_FILM)
        await page.screenshot({
          element: screen.container.querySelector("[data-fluid-wet-film-figure]") as HTMLElement,
          path: "../../test-results/fluid-wet-film-figure/flexed-dry-wet-source-body.png",
        });
    },
    LOAD.timeout + 30_000,
  );
});
