/**
 * A source-body proof for dynamic fluid coverage: two actual figures share the
 * static layer atlas, while only the right figure receives posed water support.
 */
import { Canvas, type RootState, useThree } from "@react-three/fiber";
import { bodyPack } from "humanoid-kit-body";
import { Component, type ReactNode, useEffect } from "react";
import {
  MeshBasicMaterial,
  PerspectiveCamera,
  type Scene,
  type SkinnedMesh,
  SphereGeometry,
  Vector3,
} from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import bodyManifest from "../../packs/body/data/manifest.json";
import { AttachedFluidField, type FluidCoverageSnapshot } from "../../src/fluid/attachedField.ts";
import {
  type DetachedFluidParticle,
  DetachedFluidParticles,
} from "../../src/fluid/detachedParticles.ts";
import { fluidFrameFromPose } from "../../src/fluid/posedSurfaceFrame.ts";
import { FluidState, type FluidSurfaceAnchor } from "../../src/fluid/state.ts";
import { loadHumanoidAssets } from "../../src/format/assetFormat.ts";
import { REST_POSE } from "../../src/foundation/permutations.ts";
import { HumanoidModel } from "../../src/model/humanoidModel.ts";
import { Humanoid, HumanoidProvider, StudioStage } from "../../src/react/index.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";
import { bindFluidWetFilmCoverage } from "../../src/render/fluidCoverage.ts";
import { FluidParticleRenderer } from "../../src/render/fluidParticles.ts";
import { SkinMaterial } from "../../src/render/skinMaterial.ts";
import { centreHeight, edgeNeighbours, lowestNeighbour } from "../posedFluidTransportProof.ts";
import { inlineWorkerClient } from "./inlineClient.ts";

const LOAD = { timeout: 300_000 };
/** A source-body review PNG is requested explicitly; remote execution selects this profile by argv. */
const CAPTURE_WET_FILM =
  import.meta.env.HK_FLUID_WET_FILM_CAPTURE === "true" ||
  import.meta.env.MODE === "fluid-wet-film-capture";
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
  spawnedParticles: readonly DetachedFluidParticle[];
  movedParticles: readonly DetachedFluidParticle[];
  flow: {
    before: FluidCoverageSnapshot;
    after: FluidCoverageSnapshot;
    movedKg: number;
    downhillTransfers: number;
  };
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

/** A visible central front source triangle, found from the actual posed source frame. */
function frontSourceTriangle(frame: ReturnType<typeof fluidFrameFromPose>): number {
  const centres = Array.from({ length: frame.index.length / 3 }, (_, triangle) =>
    triangleCentre(frame, triangle),
  );
  const minY = Math.min(...centres.map((centre) => centre.y));
  const maxY = Math.max(...centres.map((centre) => centre.y));
  const targetY = minY + (maxY - minY) * 0.53;
  let selected = -1;
  let score = -Infinity;
  for (const [triangle, centre] of centres.entries()) {
    const normal = triangleNormal(frame, triangle);
    // The camera looks from +z; choose a central, visible source patch from the posed frame.
    const candidate =
      5 * normal.z - 2.4 * Math.abs(centre.x) - (5 * Math.abs(centre.y - targetY)) / (maxY - minY);
    if (candidate > score) {
      score = candidate;
      selected = triangle;
    }
  }
  if (selected < 0)
    throw new Error("fluid wet-film figure proof could not select a visible source triangle");
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

function worldParticles(
  body: SkinnedMesh,
  particles: readonly DetachedFluidParticle[],
): readonly DetachedFluidParticle[] {
  body.updateWorldMatrix(true, false);
  return particles.map((particle) => {
    const positionM = body.localToWorld(new Vector3(...particle.positionM)).toArray() as [
      number,
      number,
      number,
    ];
    return { ...particle, positionM };
  });
}

function configureCloseupCamera(
  camera: PerspectiveCamera,
  anchor: Vector3,
  particles: readonly Pick<DetachedFluidParticle, "positionM">[],
  aspect: number,
): void {
  const points = [anchor, ...particles.map((particle) => new Vector3(...particle.positionM))];
  const min = points.reduce(
    (bounds, point) => bounds.min(point),
    new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY),
  );
  const max = points.reduce(
    (bounds, point) => bounds.max(point),
    new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY),
  );
  const centre = min.clone().add(max).multiplyScalar(0.5);
  const span = Math.max(0.1, (max.x - min.x) / aspect, max.y - min.y);
  const distance = Math.max(0.32, (1.2 * span) / (2 * Math.tan((camera.fov * Math.PI) / 360)));
  camera.aspect = aspect;
  camera.position.set(centre.x, centre.y, max.z + distance);
  camera.lookAt(centre);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  for (const point of points) {
    const projected = point.clone().project(camera);
    expect(Math.abs(projected.x), "source and particle bounds fit the close-up width").toBeLessThan(
      0.85,
    );
    expect(
      Math.abs(projected.y),
      "source and particle bounds fit the close-up height",
    ).toBeLessThan(0.85);
    expect(
      projected.z,
      "source and particle bounds are in front of the near plane",
    ).toBeGreaterThan(-1);
    expect(projected.z, "source and particle bounds are inside the far plane").toBeLessThan(1);
  }
}

function renderCloseupPanel(
  state: RootState,
  camera: PerspectiveCamera,
  wetSkin: SkinMaterial,
  wetBody: SkinnedMesh,
  source: Proof,
  particleRenderer: FluidParticleRenderer,
  snapshot: FluidCoverageSnapshot,
  particles: readonly DetachedFluidParticle[],
): void {
  const renderer = state.gl;
  const canvas = renderer.domElement;
  bindFluidWetFilmCoverage(wetSkin, wetBody.geometry, snapshot);
  particleRenderer.update(particles);
  configureCloseupCamera(
    camera,
    wetBody.localToWorld(new Vector3(...source.focus)),
    particles,
    canvas.width / canvas.height,
  );
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, canvas.width, canvas.height);
  renderer.clear(true, true, true);
  renderer.render(state.scene, camera);
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
  const triangles = triangleNeighbours(flexedFrame.index, frontSourceTriangle(flexedFrame), 90);
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
  const particles = new DetachedFluidParticles(state, {
    maxParticles: released.length,
    gravityMps2: [0, -1, 0],
  });
  const spawnedParticles = particles.spawn(
    released.map((release) => ({ release, velocityMps: [0.18, 0.1, 0] as const })),
  );
  particles.stepFixed(4);
  const movedParticles = particles.frame();
  particles.dispose();
  const flowState = new FluidState({
    figureId: "posed-flow-proof",
    seed: 32,
    fixedStepSeconds: 1 / 60,
    topology: state.topology,
    recipe,
    assets,
  });
  const flowing = new AttachedFluidField(flowState, restFrame, {
    maxCells: triangles.length * 2,
    mobilityPerSecond: 1,
    gravity: [0, -1, 0],
  });
  const neighbours = edgeNeighbours(flexedFrame.index);
  const expectedMass = new Map<number, number>();
  let downhillTransfers = 0;
  for (const triangle of triangles.slice(0, 45)) {
    const anchor: FluidSurfaceAnchor = {
      kind: "surface",
      topology: bodyManifest.topology,
      bodySha256: bodyManifest.body.sha256,
      triangle,
      barycentric: [1 / 3, 1 / 3, 1 / 3],
    };
    const id = `flow-${triangle}`;
    flowState.registerSource({ id, materialId: "water", anchor, rateKgPerSecond: 0 });
    flowing.inject(id, anchor, "water", 0.0005);
    const destination = lowestNeighbour(flexedFrame, neighbours, triangle);
    if (destination === undefined) {
      expectedMass.set(triangle, (expectedMass.get(triangle) ?? 0) + 0.0005);
    } else {
      expect(centreHeight(flexedFrame, destination)).toBeLessThan(
        centreHeight(flexedFrame, triangle),
      );
      expectedMass.set(triangle, (expectedMass.get(triangle) ?? 0) + 0.00025);
      expectedMass.set(destination, (expectedMass.get(destination) ?? 0) + 0.00025);
      downhillTransfers++;
    }
  }
  const flowBefore = flowing.coverageSnapshot(flexedFrame);
  const stateBefore = flowState.snapshot();
  flowing.step(flexedFrame, 0.5);
  const flowAfter = flowing.coverageSnapshot(flexedFrame);
  expect(downhillTransfers).toBeGreaterThan(0);
  expect(flowAfter.cells.length).toBe(expectedMass.size);
  for (const cell of flowAfter.cells)
    expect(cell.massKg).toBeCloseTo(expectedMass.get(cell.triangle) as number, 15);
  expect(flowAfter.attachedKg).toBeCloseTo(flowBefore.attachedKg, 15);
  expect(
    flowState.snapshot(),
    "transport neither creates ledger mass nor advances the shared clock",
  ).toEqual(stateBefore);
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
    spawnedParticles,
    movedParticles,
    flow: {
      before: flowBefore,
      after: flowAfter,
      movedKg: downhillTransfers * 0.00025,
      downhillTransfers,
    },
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
  it("frames positive-offset bounds in a narrow viewport without mutating the minimum", () => {
    const camera = new PerspectiveCamera(28, 0.5, 0.1, 100);
    const anchor = new Vector3(10, 20, 30);
    const particle = { positionM: [10.4, 20.3, 30] as const };
    configureCloseupCamera(camera, anchor, [particle], 0.5);
    expect(anchor.toArray()).toEqual([10, 20, 30]);
    expect(camera.position.x).toBeCloseTo(10.2);
    expect(camera.position.y).toBeCloseTo(20.15);
    expect(camera.position.z - 30).toBeCloseTo((1.2 * 0.8) / (2 * Math.tan((28 * Math.PI) / 360)));
  });
  it(
    "renders actual posed downhill transport with conserved kilograms and identical dry neighbour pixels",
    async () => {
      const source = await proof();
      let get: (() => RootState) | null = null;
      let settled = 0;
      const screen = await render(
        scene(
          "flexed",
          (next) => (get = next),
          () => settled++,
          "posed downhill transport",
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
      const [dryBody, wetBody] = bodyPair(state().scene);
      const drySkin = skinOf(dryBody);
      const wetSkin = skinOf(wetBody);
      const atlas = drySkin.hkUniforms.hkLayerAtlas.value;
      expect(wetSkin.hkUniforms.hkLayerAtlas.value).toBe(atlas);
      const camera = state().camera as PerspectiveCamera;
      const focus = new Vector3(...source.focus);
      camera.position.set(0, focus.y + 0.04, focus.z + 4.4);
      camera.lookAt(0, focus.y, focus.z);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      state().setFrameloop("never");
      const canvas = state().gl.domElement;
      const dryPixels = () => {
        wetBody.visible = false;
        const pixels = renderedPixels(state());
        wetBody.visible = true;
        return pixels;
      };
      try {
        bindFluidWetFilmCoverage(wetSkin, wetBody.geometry, source.flow.before);
        const beforeDry = dryPixels();
        const beforeWet = renderedPixels(state());
        const beforeTexture = new Uint8Array(
          (wetSkin.hkUniforms.hkFluidCoverage.value as { image: { data: Uint8Array } }).image.data,
        );
        bindFluidWetFilmCoverage(wetSkin, wetBody.geometry, source.flow.after);
        const afterDry = dryPixels();
        const afterWet = renderedPixels(state());
        const afterTexture = (
          wetSkin.hkUniforms.hkFluidCoverage.value as { image: { data: Uint8Array } }
        ).image.data;
        expect(
          changedPixels(beforeDry, afterDry),
          "dry source figure renders identically through transport",
        ).toBe(0);
        expect(
          changedPixels(beforeWet, afterWet),
          "transport updates actual source-body GPU pixels",
        ).toBeGreaterThan(0);
        expect(afterTexture.some((value, index) => value !== beforeTexture[index])).toBe(true);
        expect(drySkin.hkUniforms.hkFluidCoverage.value).toBeNull();
        expect(drySkin.hkUniforms.hkLayerAtlas.value).toBe(atlas);
        console.info(
          "posed-fluid-transport",
          JSON.stringify({
            pose: "flexed",
            seconds: 0.5,
            downhillTransfers: source.flow.downhillTransfers,
            movedKg: source.flow.movedKg,
            attachedBeforeKg: source.flow.before.attachedKg,
            attachedAfterKg: source.flow.after.attachedKg,
            occupiedBefore: source.flow.before.cells.length,
            occupiedAfter: source.flow.after.cells.length,
            wetChangedPixels: changedPixels(beforeWet, afterWet),
            dryChangedPixels: changedPixels(beforeDry, afterDry),
          }),
        );
        dryBody.visible = false;
        const anchor = wetBody.localToWorld(new Vector3(...source.focus));
        const bounds = source.flow.after.cells.map((cell) => ({
          positionM: wetBody.localToWorld(new Vector3(...cell.positionM)).toArray(),
        }));
        configureCloseupCamera(camera, anchor, bounds, canvas.width / canvas.height);
        for (const [name, snapshot] of [
          ["posed-flow-before", source.flow.before],
          ["posed-flow-after", source.flow.after],
        ] as const) {
          bindFluidWetFilmCoverage(wetSkin, wetBody.geometry, snapshot);
          state().gl.render(state().scene, camera);
          if (CAPTURE_WET_FILM)
            await page.screenshot({
              element: canvas,
              path: `../../test-results/fluid-wet-film-figure/${name}.png`,
            });
        }
        const receipt = `flexed posed transport: ${source.flow.downhillTransfers} shared-edge downhill transfers over 0.5 s\n${source.flow.movedKg.toFixed(5)} kg transferred; ${source.flow.before.attachedKg.toFixed(5)} kg conserved; dry neighbour pixels identical\ncoverage is support occupancy; no water appearance claim`;
        screen.container.querySelector("[data-fluid-wet-film-receipt]")?.replaceChildren(receipt);
      } finally {
        dryBody.visible = true;
        wetBody.visible = true;
        state().setFrameloop("always");
      }
    },
    LOAD.timeout + 30_000,
  );
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
      const particleGeometry = new SphereGeometry(0.003, 8, 6);
      const particleMaterial = new MeshBasicMaterial({ color: 0x9bdcff });
      const particleRenderer = new FluidParticleRenderer({
        capacity: source.movedParticles.length,
        geometry: particleGeometry,
        material: particleMaterial,
      });
      state().scene.add(particleRenderer.mesh);
      particleRenderer.update(worldParticles(wetFlexed, source.spawnedParticles));
      const spawnedPixels = renderedPixels(state());
      particleRenderer.update(worldParticles(wetFlexed, source.movedParticles));
      const movedPixels = renderedPixels(state());
      expect(changedPixels(detachedPixels, spawnedPixels)).toBeGreaterThan(0);
      expect(changedPixels(spawnedPixels, movedPixels)).toBeGreaterThan(0);
      const canvas = state().gl.domElement;
      state().setFrameloop("never");
      dryFlexed.visible = false;
      try {
        const captures = [
          {
            name: "attached-film",
            snapshot: source.flexed,
            particles: [] as readonly DetachedFluidParticle[],
          },
          {
            name: "detached-spawn",
            snapshot: source.detached,
            particles: worldParticles(wetFlexed, source.spawnedParticles),
          },
          {
            name: "detached-four-steps",
            snapshot: source.detached,
            particles: worldParticles(wetFlexed, source.movedParticles),
          },
        ];
        for (const capture of captures) {
          renderCloseupPanel(
            state(),
            camera,
            wetFlexedSkin,
            wetFlexed,
            source,
            particleRenderer,
            capture.snapshot,
            capture.particles,
          );
          if (CAPTURE_WET_FILM)
            await page.screenshot({
              element: canvas,
              path: `../../test-results/fluid-wet-film-figure/${capture.name}.png`,
            });
        }
      } finally {
        dryFlexed.visible = true;
        state().setFrameloop("always");
      }
      const receipt = [
        "POSE: flexed — close-up bounds from actual source releases and their four-step positions",
        "captures: attached localized film / detached at spawn / same 45 drops after four fixed steps",
        `water: ${source.detached.cells.length}/${source.updated.occupiedTriangles} attached triangles after ${source.releasedKg.toFixed(4)} kg detached`,
        `detached particles: ${source.movedParticles.length}, mass ${source.releasedKg.toFixed(4)} kg; caller velocity and gravity advance four fixed steps`,
        "cyan spheres are opaque QA position markers, not a water-material appearance claim",
        `vertex interpolation reaches ${source.updated.interpolatedFanTriangles} incident triangles (+${source.updated.interpolatedFanTriangles - source.updated.occupiedTriangles} support expansion)`,
        `attached mass: ${source.flexed.attachedKg.toFixed(4)} kg; coverage is support occupancy, not optical alpha or thickness`,
      ].join("\n");
      const receiptNode = screen.container.querySelector("[data-fluid-wet-film-receipt]");
      receiptNode?.replaceChildren(receipt);
      state().gl.render(state().scene, camera);
      particleRenderer.dispose();
      particleGeometry.dispose();
      particleMaterial.dispose();
    },
    LOAD.timeout + 30_000,
  );
});
