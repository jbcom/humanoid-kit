/**
 * Review-only close comparison for the optional source-offset beard transform.
 * It is ignored unless the dedicated config enables it. Every figure reuses the
 * same MakeHuman beard mesh, faces, MHCLO anchors and material; factor five
 * multiplies the authored free offsets in every axis.
 */
import { Canvas, useThree } from "@react-three/fiber";
import { useLayoutEffect, useState } from "react";
import type { Group, Object3D, PerspectiveCamera, SkinnedMesh } from "three";
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

const inspect = import.meta.env.HK_FACIAL_HAIR_LENGTH_INSPECTION === "1" ? it : it.skip;
const LOAD = { timeout: 60_000 };
const BEARD = "beard-viking";
const JAW_DROP: HumanoidPose = { faceUnits: { JawDrop: 1 } };
const client = inlineWorkerClient({ subdivision: 1 }, { hair: true });

beforeAll(async () => {
  await client.ready;
}, LOAD.timeout);
afterAll(() => client.dispose());

type View = "front" | "three-quarter";
type ActorId = `${View}-${"default" | "5x"}`;
interface Actor {
  id: ActorId;
  view: View;
  label: string;
  recipe: Recipe;
  position: [number, number, number];
}

const defaultRecipe = createRecipe({ hair: { style: null }, facialHair: [BEARD] });
const longRecipe = createRecipe({
  hair: { style: null },
  facialHair: [BEARD],
  facialHairLength: { [BEARD]: 5 },
});
const ACTORS: readonly Actor[] = [
  {
    id: "front-default",
    view: "front",
    label: "front · authored source placement",
    recipe: defaultRecipe,
    position: [-0.42, 0, 0],
  },
  {
    id: "front-5x",
    view: "front",
    label: "front · same source, 5× free offset",
    recipe: longRecipe,
    position: [0.42, 0, 0],
  },
  {
    id: "three-quarter-default",
    view: "three-quarter",
    label: "three-quarter · authored source placement",
    recipe: defaultRecipe,
    position: [-0.42, 0, 0],
  },
  {
    id: "three-quarter-5x",
    view: "three-quarter",
    label: "three-quarter · same source, 5× free offset",
    recipe: longRecipe,
    position: [0.42, 0, 0],
  },
];

const figureGroups = new Map<ActorId, Group>();

function CameraAim({ view }: { view: View }) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  useLayoutEffect(() => {
    if (view === "front") camera.position.set(0, 1.28, 3.1);
    else camera.position.set(1.75, 1.28, 2.55);
    camera.lookAt(0, 1.18, 0);
    camera.updateProjectionMatrix();
  }, [camera, view]);
  return null;
}

function CloseView({ view }: { view: View }) {
  const actors = ACTORS.filter((actor) => actor.view === view);
  const [settled, setSettled] = useState<ReadonlySet<ActorId>>(() => new Set());
  const ready = actors.every((actor) => settled.has(actor.id));
  return (
    <section data-view={view} data-inspection-ready={ready ? "true" : "false"}>
      <Canvas
        style={{ width: 360, height: 430 }}
        shadows={STUDIO_SHADOWS}
        dpr={1}
        camera={{ fov: 28 }}
        gl={{ toneMapping: STUDIO_TONE_MAPPING, toneMappingExposure: STUDIO_EXPOSURE }}
      >
        <CameraAim view={view} />
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
              setSettled((seen) => {
                if (seen.has(actor.id)) return seen;
                return new Set(seen).add(actor.id);
              })
            }
          />
        ))}
      </Canvas>
      <p>{view === "front" ? "front · JawDrop" : "three-quarter · JawDrop"}</p>
    </section>
  );
}

function Inspection() {
  return (
    <div data-inspection="facial-hair-length-close">
      <div style={{ display: "flex", gap: 8 }}>
        <CloseView view="front" />
        <CloseView view="three-quarter" />
      </div>
      <table>
        <caption>
          JawDrop source-offset diagnostic: same source mesh, face/jaw anchors and material; not a
          new appearance claim
        </caption>
        <thead>
          <tr>
            <th>figure</th>
            <th>style</th>
            <th>free-offset multiplier</th>
            <th>runtime topology</th>
          </tr>
        </thead>
        <tbody>
          {ACTORS.map((actor) => (
            <tr key={actor.id} data-actor={actor.id}>
              <td>{actor.label}</td>
              <td>{BEARD}</td>
              <td>{actor.id.endsWith("5x") ? "5×" : "1×"}</td>
              <td>same source-derived runtime topology</td>
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
    const candidate = object as unknown as {
      isSkinnedMesh?: boolean;
      geometry?: SkinnedMesh["geometry"];
    };
    if (
      candidate.isSkinnedMesh === true &&
      object.userData.hkPart === "hair" &&
      candidate.geometry?.getAttribute("position")
    )
      beard = object as SkinnedMesh;
  });
  return beard;
}

function beardMesh(actor: ActorId): SkinnedMesh {
  const beard = beardMeshOrNull(actor);
  if (!beard) throw new Error(`inspection figure ${actor} has no ${BEARD} mesh`);
  return beard;
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
    const x = normals.getX(vertex);
    const y = normals.getY(vertex);
    const z = normals.getZ(vertex);
    const length = Math.hypot(x, y, z);
    finite &&= Number.isFinite(length);
    unit &&= Math.abs(length - 1) < 1e-3;
  }
  return { count: normals.count, finite, unit };
}

function boundsReceipt(mesh: SkinnedMesh): { minY: number; maxY: number; radius: number } {
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  const box = mesh.geometry.boundingBox;
  const sphere = mesh.geometry.boundingSphere;
  if (!box || !sphere) throw new Error("facial-hair renderer did not compute culling bounds");
  return { minY: box.min.y, maxY: box.max.y, radius: sphere.radius };
}

function closestVertexDistance(a: SkinnedMesh, b: SkinnedMesh): number {
  const ap = a.geometry.getAttribute("position");
  const bp = b.geometry.getAttribute("position");
  if (ap.count !== bp.count) throw new Error("facial-hair topology changed before comparison");
  let closest = Number.POSITIVE_INFINITY;
  for (let vertex = 0; vertex < ap.count; vertex++)
    closest = Math.min(
      closest,
      Math.hypot(
        ap.getX(vertex) - bp.getX(vertex),
        ap.getY(vertex) - bp.getY(vertex),
        ap.getZ(vertex) - bp.getZ(vertex),
      ),
    );
  return closest;
}

describe("facial hair length inspection fixture", () => {
  inspect(
    "shows JawDrop face roots, normals and culling bounds for the source-offset large beard",
    async () => {
      const screen = await render(
        <HumanoidProvider client={client}>
          <Inspection />
        </HumanoidProvider>,
      );
      const fixture = screen.container.querySelector("[data-inspection]");
      if (!fixture) throw new Error("facial hair length inspection root is not mounted");
      for (const view of ["front", "three-quarter"] as const) {
        const panel = fixture.querySelector(`[data-view="${view}"]`);
        if (!panel) throw new Error(`${view} comparison panel is not mounted`);
        await expect.poll(() => panel.getAttribute("data-inspection-ready"), LOAD).toBe("true");
        const canvas = panel.querySelector("canvas");
        if (!canvas) throw new Error(`${view} comparison has no canvas`);
        const bounds = canvas.getBoundingClientRect();
        expect(bounds.width, `${view} canvas width`).toBe(360);
        expect(bounds.right, `${view} canvas right edge`).toBeLessThanOrEqual(window.innerWidth);
      }

      const topologyVertices = client.hairTopology(BEARD)?.vertexCount;
      if (topologyVertices === undefined) throw new Error(`${BEARD} topology is not loaded`);
      for (const view of ["front", "three-quarter"] as const) {
        const ordinary = beardMesh(`${view}-default`);
        const extended = beardMesh(`${view}-5x`);
        expect(ordinary.geometry.getAttribute("position").count).toBe(topologyVertices);
        expect(extended.geometry.getAttribute("position").count).toBe(topologyVertices);
        expect(minimumY(extended), `${view} fivefold beard reaches lower`).toBeLessThan(
          minimumY(ordinary) - 0.15,
        );
        // Near-zero source offsets leave their face-root placement coincident;
        // large free offsets retain the same skinned face/jaw attachment path.
        expect(
          closestVertexDistance(ordinary, extended),
          `${view} face-root correspondence`,
        ).toBeLessThan(1e-5);
        for (const mesh of [ordinary, extended]) {
          const normals = normalReceipt(mesh);
          expect(normals.count).toBe(topologyVertices);
          expect(normals.finite, `${view} normal values`).toBe(true);
          expect(normals.unit, `${view} normal lengths`).toBe(true);
        }
        const ordinaryBounds = boundsReceipt(ordinary);
        const extendedBounds = boundsReceipt(extended);
        expect(extendedBounds.minY, `${view} culling bounds include the long beard`).toBeLessThan(
          ordinaryBounds.minY - 0.15,
        );
        expect(extendedBounds.radius).toBeGreaterThan(ordinaryBounds.radius);
      }

      expect(screen.getByText("front · JawDrop")).toBeVisible();
      expect(screen.getByText("three-quarter · JawDrop")).toBeVisible();
      expect(screen.getByText("same source-derived runtime topology")).toHaveLength(4);
      await page.screenshot({
        element: fixture,
        path: "../../test-results/facial-hair-length-inspection/source-offset-jawdrop-close.png",
      });
    },
    LOAD.timeout + 10_000,
  );
});
