/**
 * Review-only source-proxy growth comparison. It is ignored unless its
 * dedicated config enables it. The full view makes the rest-floor endpoint
 * inspectable; the close views show that authored card roots remain face/jaw-bound
 * while only their source extent grows.
 */
import { Canvas, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useState } from "react";
import {
  type Group,
  type Object3D,
  type PerspectiveCamera,
  type SkinnedMesh,
  Vector3,
} from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  Humanoid,
  type HumanoidPose,
  HumanoidProvider,
  STUDIO_EXPOSURE,
  STUDIO_SHADOWS,
  STUDIO_TONE_MAPPING,
  StudioStage,
} from "../../src/react/index.ts";
import { createRecipe, type Recipe } from "../../src/recipe/recipe.ts";
import { inlineWorkerClient } from "./inlineClient.ts";

const inspect = import.meta.env.HK_FACIAL_HAIR_GROWTH_INSPECTION === "1" ? it : it.skip;
const LOAD = { timeout: 60_000 };
const BEARD = "beard-viking";
const JAW_DROP: HumanoidPose = { faceUnits: { JawDrop: 1 } };
const client = inlineWorkerClient({ subdivision: 1 }, { hair: true });

beforeAll(async () => {
  await client.ready;
}, LOAD.timeout);
afterAll(() => client.dispose());

type View = "full" | "front" | "three-quarter";
type ActorId = `${View}-${"zero" | "source" | "floor"}`;
interface Actor {
  id: ActorId;
  view: View;
  label: string;
  recipe: Recipe;
  position: [number, number, number];
}

const zeroRecipe = createRecipe({
  hair: { style: null },
  facialHair: [BEARD],
  facialHairGrowth: { [BEARD]: 0 },
});
const sourceRecipe = createRecipe({
  hair: { style: null },
  facialHair: [BEARD],
  facialHairGrowth: { [BEARD]: 0.5 },
});
const floorRecipe = createRecipe({
  hair: { style: null },
  facialHair: [BEARD],
  facialHairGrowth: { [BEARD]: 1 },
});
const ACTORS: readonly Actor[] = [
  {
    id: "full-zero",
    view: "full",
    label: "growth 0 · source beard omitted",
    recipe: zeroRecipe,
    position: [-0.72, 0, 0],
  },
  {
    id: "full-source",
    view: "full",
    label: "growth 0.5 · exact native source",
    recipe: sourceRecipe,
    position: [0, 0, 0],
  },
  {
    id: "full-floor",
    view: "full",
    label: "growth 1 · rest-floor source-depth proxy",
    recipe: floorRecipe,
    position: [0.72, 0, 0],
  },
  {
    id: "front-source",
    view: "front",
    label: "front · exact native source",
    recipe: sourceRecipe,
    position: [-0.42, 0, 0],
  },
  {
    id: "front-floor",
    view: "front",
    label: "front · rest-floor source-depth proxy",
    recipe: floorRecipe,
    position: [0.42, 0, 0],
  },
  {
    id: "three-quarter-source",
    view: "three-quarter",
    label: "three-quarter · exact native source",
    recipe: sourceRecipe,
    position: [-0.42, 0, 0],
  },
  {
    id: "three-quarter-floor",
    view: "three-quarter",
    label: "three-quarter · rest-floor source-depth proxy",
    recipe: floorRecipe,
    position: [0.42, 0, 0],
  },
];

const figureGroups = new Map<ActorId, Group>();
const viewCameras = new Map<View, PerspectiveCamera>();

type Bounds = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  count: number;
};

const newBounds = (): Bounds => ({
  minX: Number.POSITIVE_INFINITY,
  minY: Number.POSITIVE_INFINITY,
  minZ: Number.POSITIVE_INFINITY,
  maxX: Number.NEGATIVE_INFINITY,
  maxY: Number.NEGATIVE_INFINITY,
  maxZ: Number.NEGATIVE_INFINITY,
  count: 0,
});

function addPoint(bounds: Bounds, point: Vector3): void {
  bounds.minX = Math.min(bounds.minX, point.x);
  bounds.minY = Math.min(bounds.minY, point.y);
  bounds.minZ = Math.min(bounds.minZ, point.z);
  bounds.maxX = Math.max(bounds.maxX, point.x);
  bounds.maxY = Math.max(bounds.maxY, point.y);
  bounds.maxZ = Math.max(bounds.maxZ, point.z);
  bounds.count++;
}

function eachWorldVertex(
  actorIds: readonly ActorId[],
  include: (part: unknown) => boolean,
  visit: (point: Vector3) => void,
): void {
  const local = new Vector3();
  const world = new Vector3();
  for (const actor of actorIds) {
    const group = figureGroups.get(actor);
    if (!group) throw new Error(`${actor} figure group is unavailable for camera fitting`);
    group.updateWorldMatrix(true, true);
    group.traverse((object: Object3D) => {
      const mesh = object as SkinnedMesh;
      if (mesh.isSkinnedMesh !== true || !include(object.userData.hkPart)) return;
      const positions = mesh.geometry.getAttribute("position");
      if (!positions) return;
      mesh.updateWorldMatrix(true, false);
      for (let vertex = 0; vertex < positions.count; vertex++) {
        mesh.getVertexPosition(vertex, local);
        visit(world.copy(local).applyMatrix4(mesh.matrixWorld));
      }
    });
  }
}

function worldBounds(
  actorIds: readonly ActorId[],
  include: (part: unknown) => boolean,
  minimumY = Number.NEGATIVE_INFINITY,
): Bounds {
  const bounds = newBounds();
  eachWorldVertex(actorIds, include, (point) => {
    if (point.y >= minimumY) addPoint(bounds, point);
  });
  if (!bounds.count) throw new Error("camera fitting found no rendered source vertices");
  return bounds;
}

function fitCamera(camera: PerspectiveCamera, bounds: Bounds, aspect: number): void {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const halfHeight = (bounds.maxY - bounds.minY) / 2;
  const halfWidth = (bounds.maxX - bounds.minX) / 2;
  const vertical = (camera.fov * Math.PI) / 360;
  const distance =
    1.1 * Math.max(halfHeight / Math.tan(vertical), halfWidth / (aspect * Math.tan(vertical)));
  camera.position.set(centerX, centerY, bounds.maxZ + distance);
  camera.lookAt(centerX, centerY, (bounds.minZ + bounds.maxZ) / 2);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

function CameraAim({
  view,
  ready,
  onFitted,
}: {
  view: View;
  ready: boolean;
  onFitted: () => void;
}) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const size = useThree((state) => state.size);
  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(() => {
      const actors = ACTORS.filter((actor) => actor.view === view).map((actor) => actor.id);
      if (actors.some((actor) => !figureGroups.has(actor))) return;
      const include = (part: unknown) => part === "body" || part === "hair";
      const all = worldBounds(actors, include);
      // A close view uses the rendered head/jaw portion, not a guessed ground lift.
      const headFloor = all.maxY - Math.min(0.65, (all.maxY - all.minY) * 0.36);
      fitCamera(
        camera,
        view === "full" ? all : worldBounds(actors, include, headFloor),
        size.width / size.height,
      );
      viewCameras.set(view, camera);
      onFitted();
    });
    return () => cancelAnimationFrame(frame);
  }, [camera, onFitted, ready, size.height, size.width, view]);
  return null;
}

function projectedBounds(
  view: View,
  actorIds: readonly ActorId[],
  include: (part: unknown) => boolean,
  minimumY = Number.NEGATIVE_INFINITY,
): Bounds {
  const camera = viewCameras.get(view);
  if (!camera) throw new Error(`${view} camera has not been fitted`);
  camera.updateMatrixWorld(true);
  const projected = newBounds();
  eachWorldVertex(actorIds, include, (point) => {
    if (point.y >= minimumY) addPoint(projected, point.clone().project(camera));
  });
  if (!projected.count) throw new Error(`${view} camera has no projected source vertices`);
  return projected;
}

function ViewPanel({ view }: { view: View }) {
  const actors = ACTORS.filter((actor) => actor.view === view);
  const [settled, setSettled] = useState<ReadonlySet<ActorId>>(() => new Set());
  const [fitted, setFitted] = useState(false);
  const ready = actors.every((actor) => settled.has(actor.id));
  const onFitted = useCallback(() => setFitted(true), []);
  const full = view === "full";
  return (
    <section data-view={view} data-inspection-ready={ready && fitted ? "true" : "false"}>
      <Canvas
        style={{ width: 960, height: full ? 760 : 430 }}
        shadows={STUDIO_SHADOWS}
        dpr={1}
        camera={{ fov: full ? 22 : 28 }}
        gl={{ toneMapping: STUDIO_TONE_MAPPING, toneMappingExposure: STUDIO_EXPOSURE }}
      >
        <CameraAim view={view} ready={ready} onFitted={onFitted} />
        <StudioStage contactShadowOpacity={0.2} />
        {actors.map((actor) => (
          <Humanoid
            key={actor.id}
            name={actor.id}
            position={actor.position}
            ref={(group) => {
              if (group) figureGroups.set(actor.id, group);
              else figureGroups.delete(actor.id);
            }}
            recipe={actor.recipe}
            pose={JAW_DROP}
            onSettled={() =>
              setSettled((seen) => (seen.has(actor.id) ? seen : new Set(seen).add(actor.id)))
            }
          />
        ))}
      </Canvas>
      <p>
        {view === "full"
          ? "full figure · sole plane and rest-floor endpoint"
          : `${view === "front" ? "front" : "three-quarter"} · JawDrop root comparison`}
      </p>
    </section>
  );
}

function Inspection() {
  return (
    <div data-inspection="facial-hair-growth">
      <ViewPanel view="full" />
      <div style={{ display: "grid", gap: 8 }}>
        <ViewPanel view="front" />
        <ViewPanel view="three-quarter" />
      </div>
      <p>
        controls: 0 omits the mesh · 0.5 is exact native source · 1 maps source depth to the
        rest-floor while preserving each authored card root, with a runtime body-front clearance
        proxy
      </p>
      <table>
        <caption>JawDrop source-proxy growth diagnostic, not a new authored style</caption>
        <thead>
          <tr>
            <th>figure</th>
            <th>source mesh</th>
            <th>growth control</th>
          </tr>
        </thead>
        <tbody>
          {ACTORS.map((actor) => (
            <tr key={actor.id} data-actor={actor.id}>
              <td>{actor.label}</td>
              <td>{BEARD}</td>
              <td>
                {actor.id.endsWith("zero")
                  ? "0"
                  : actor.id.endsWith("floor")
                    ? "1"
                    : "0.5 (native)"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function beardMeshOrNull(actor: ActorId): SkinnedMesh | null {
  const figure = figureGroups.get(actor);
  if (!figure) return null;
  let beard: SkinnedMesh | null = null;
  figure.traverse((object: Object3D) => {
    const candidate = object as SkinnedMesh;
    if (
      candidate.isSkinnedMesh === true &&
      object.userData.hkPart === "hair" &&
      candidate.geometry.getAttribute("position")
    )
      beard = candidate;
  });
  return beard;
}

function beardMesh(actor: ActorId): SkinnedMesh {
  const mesh = beardMeshOrNull(actor);
  if (!mesh) throw new Error(`${actor} has no rendered ${BEARD} mesh`);
  return mesh;
}

function minimumY(mesh: SkinnedMesh): number {
  const positions = mesh.geometry.getAttribute("position");
  let minimum = Number.POSITIVE_INFINITY;
  for (let vertex = 0; vertex < positions.count; vertex++)
    minimum = Math.min(minimum, positions.getY(vertex));
  return minimum;
}

function normalReceipt(mesh: SkinnedMesh): { count: number; finite: boolean; unit: boolean } {
  const normals = mesh.geometry.getAttribute("normal");
  let finite = true;
  let unit = true;
  for (let vertex = 0; vertex < normals.count; vertex++) {
    const length = Math.hypot(normals.getX(vertex), normals.getY(vertex), normals.getZ(vertex));
    finite &&= Number.isFinite(length);
    unit &&= Math.abs(length - 1) < 1e-3;
  }
  return { count: normals.count, finite, unit };
}

describe("facial hair growth inspection fixture", () => {
  inspect(
    "shows the full rest-floor endpoint and the JawDrop source-card roots",
    async () => {
      const screen = await render(
        <HumanoidProvider client={client}>
          <Inspection />
        </HumanoidProvider>,
      );
      const fixture = screen.container.querySelector("[data-inspection]");
      if (!fixture) throw new Error("facial hair growth inspection root is not mounted");
      for (const view of ["full", "front", "three-quarter"] as const) {
        const panel = fixture.querySelector(`[data-view="${view}"]`);
        if (!panel) throw new Error(`${view} growth panel is not mounted`);
        await expect.poll(() => panel.getAttribute("data-inspection-ready"), LOAD).toBe("true");
        const canvas = panel.querySelector("canvas");
        if (!canvas) throw new Error(`${view} growth panel has no canvas`);
        const bounds = canvas.getBoundingClientRect();
        expect(bounds.width, `${view} canvas width`).toBe(960);
        expect(bounds.right, `${view} canvas right edge`).toBeLessThanOrEqual(window.innerWidth);
      }

      const includeBodyAndHair = (part: unknown) => part === "body" || part === "hair";
      const fullActors = ACTORS.filter((actor) => actor.view === "full").map((actor) => actor.id);
      const fullProjection = projectedBounds("full", fullActors, includeBodyAndHair);
      for (const [name, value] of Object.entries({
        left: fullProjection.minX,
        right: fullProjection.maxX,
        bottom: fullProjection.minY,
        top: fullProjection.maxY,
      }))
        expect(value, `full view ${name} extrema are inside the canvas`).toBeGreaterThanOrEqual(-1);
      for (const [name, value] of Object.entries({
        left: fullProjection.minX,
        right: fullProjection.maxX,
        bottom: fullProjection.minY,
        top: fullProjection.maxY,
      }))
        expect(value, `full view ${name} extrema are inside the canvas`).toBeLessThanOrEqual(1);
      for (const view of ["front", "three-quarter"] as const) {
        const actors = ACTORS.filter((actor) => actor.view === view).map((actor) => actor.id);
        const all = worldBounds(actors, includeBodyAndHair);
        const headFloor = all.maxY - Math.min(0.65, (all.maxY - all.minY) * 0.36);
        const closeProjection = projectedBounds(view, actors, includeBodyAndHair, headFloor);
        expect(
          closeProjection.maxY - closeProjection.minY,
          `${view} JawDrop region occupies a meaningful close view`,
        ).toBeGreaterThan(1);
      }

      expect(beardMeshOrNull("full-zero")).toBeNull();
      const topologyVertices = client.hairTopology(BEARD)?.vertexCount;
      if (topologyVertices === undefined) throw new Error(`${BEARD} topology is not loaded`);
      const fullSource = beardMesh("full-source");
      const fullFloor = beardMesh("full-floor");
      expect(fullSource.geometry.getAttribute("position").count).toBe(topologyVertices);
      expect(fullFloor.geometry.getAttribute("position").count).toBe(topologyVertices);
      expect(fullFloor.visible).toBe(true);
      expect(minimumY(fullFloor)).toBeLessThan(minimumY(fullSource) - 0.15);
      fullFloor.computeBoundingBox();
      if (!fullFloor.geometry.boundingBox)
        throw new Error("full-growth beard has no culling bounds");
      expect(fullFloor.geometry.boundingBox.min.y).toBeCloseTo(minimumY(fullFloor), 5);

      for (const view of ["front", "three-quarter"] as const) {
        const source = beardMesh(`${view}-source`);
        const floor = beardMesh(`${view}-floor`);
        expect(source.geometry.getAttribute("position").count).toBe(topologyVertices);
        expect(floor.geometry.getAttribute("position").count).toBe(topologyVertices);
        for (const mesh of [source, floor]) {
          const normals = normalReceipt(mesh);
          expect(normals.count).toBe(topologyVertices);
          expect(normals.finite, `${view} normal values`).toBe(true);
          expect(normals.unit, `${view} normal lengths`).toBe(true);
        }
      }

      expect(screen.getByText("growth 0 · source beard omitted")).toBeVisible();
      expect(screen.getByText("growth 0.5 · exact native source")).toBeVisible();
      expect(screen.getByText("growth 1 · rest-floor source-depth proxy")).toBeVisible();
      expect(screen.getByText(/0.5 is exact native source/)).toBeVisible();
      const full = fixture.querySelector('[data-view="full"]');
      const close = fixture.querySelector('[data-view="front"]')?.parentElement;
      if (!full || !close) throw new Error("growth inspection screenshot targets are not mounted");
      await page.screenshot({
        element: full,
        path: "../../test-results/facial-hair-growth-inspection/full-rest-floor-growth.png",
      });
      await page.screenshot({
        element: close,
        path: "../../test-results/facial-hair-growth-inspection/jaw-root-growth-close.png",
      });
      await screen.unmount();
    },
    LOAD.timeout + 10_000,
  );
});
