/**
 * Diagnostic-only browser fixture for issue #33. It is ignored unless
 * HK_INJURY_INSPECTION=1 and deliberately draws only labelled markers, never
 * procedural injury geometry or a proposed visual effect.
 *
 * Run only after a visual reviewer has allocated a silent browser slot:
 * pnpm exec vitest run --config vitest.injury-inspection.config.ts \
 *   tests/browser/injuryInspection.test.tsx
 */
import { Canvas, useThree } from "@react-three/fiber";
import { bodyPack } from "humanoid-kit-body";
import { clothingPack } from "humanoid-kit-clothing";
import { useMemo, useState } from "react";
import { MeshBasicMaterial, type Object3D, type Scene, type SkinnedMesh, Vector3 } from "three";
import { afterAll, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { posedSurface } from "../../src/foundation/posed.ts";
import {
  HumanoidModel,
  loadHumanoidAssets,
  type RegionalInjury,
  RegionalInjuryState,
  regionalInjuryBody,
  routeRegionalInjuryLayers,
} from "../../src/index.ts";
import { Humanoid, type HumanoidPose, HumanoidProvider } from "../../src/react/index.ts";
import { createRecipe, type Recipe } from "../../src/recipe/recipe.ts";
import { inlineWorkerClient } from "./inlineClient.ts";

const inspect = import.meta.env.HK_INJURY_INSPECTION === "1" ? it : it.skip;
const LOAD = { timeout: 30_000 };
const SWEATER = "suits/male_casualsuit02";
const client = inlineWorkerClient({ subdivision: 0 }, { clothing: true });

afterAll(() => client.dispose());

interface DiagnosticRow {
  label: string;
  recipe: Recipe;
  pose: HumanoidPose;
  record: RegionalInjury;
  position: [number, number, number];
  renderVertex: number;
  sceneName: string;
  covered: boolean;
  route: "body" | "under-cover";
  offset: [number, number, number];
  colour: string;
}

function record(
  body: ReturnType<typeof regionalInjuryBody>,
  id: string,
  kind: RegionalInjury["class"],
  vertex: number,
): RegionalInjury {
  const shared = {
    schemaVersion: 1 as const,
    id,
    anchor: { topology: body.topology, bodySha256: body.bodySha256, vertex },
    lifecycle: "active" as const,
    createdAt: 10,
    updatedAt: 10,
    sourceCategory: "inspection.fixture",
    severityBand: "diagnostic",
  };
  if (kind === "transient-deformation")
    return { ...shared, class: kind, persistence: "session", duration: 3 };
  return { ...shared, class: kind, persistence: "saved" };
}

function point(
  model: HumanoidModel,
  recipe: Recipe,
  pose: HumanoidPose,
  vertex: number,
): { point: [number, number, number]; renderVertex: number } {
  const surface = posedSurface(model, recipe, pose.body ?? "tpose");
  const renderVertex = model.baseRenderVertices(surface.surface)[vertex] as number;
  if (renderVertex < 0) throw new Error("inspection anchor is absent from the rendered body");
  const p = renderVertex * 3;
  return {
    point: [
      surface.positions[p] as number,
      surface.positions[p + 1] as number,
      surface.positions[p + 2] as number,
    ],
    renderVertex,
  };
}

async function diagnostics(): Promise<DiagnosticRow[]> {
  const assets = await loadHumanoidAssets({ body: bodyPack, clothing: clothingPack });
  const model = new HumanoidModel(assets, { subdivision: 0 });
  const body = regionalInjuryBody(assets);
  const covered = model.outfit([SWEATER]).bodyVisible;
  let coveredVertex = -1;
  let bareVertex = -1;
  const renderVertices = model.baseRenderVertices();
  for (let vertex = 0; vertex < covered.length; vertex++) {
    if ((renderVertices[vertex] as number) < 0) continue;
    if ((covered[vertex] as number) === 0 && coveredVertex < 0) coveredVertex = vertex;
    if ((covered[vertex] as number) === 1 && bareVertex < 0) bareVertex = vertex;
  }
  if (coveredVertex < 0 || bareVertex < 0)
    throw new Error("inspection fixture found no covered and bare vertices");

  const bareRecipe = createRecipe({ macros: { age: 30, gender: 1 } });
  const clothedRecipe = createRecipe({
    macros: { age: 30, gender: 1 },
    outfit: [SWEATER],
  });
  const specs: readonly {
    label: string;
    recipe: Recipe;
    pose: HumanoidPose;
    kind: RegionalInjury["class"];
    vertex: number;
    offset: [number, number, number];
    colour: string;
  }[] = [
    {
      label: "bare / active marking",
      recipe: bareRecipe,
      pose: { body: "tpose" },
      kind: "surface-marking",
      vertex: bareVertex,
      offset: [-1.15, 0, 0],
      colour: "#22d3ee",
    },
    {
      label: "clothed / persistent under-cover",
      recipe: clothedRecipe,
      pose: { body: "tpose" },
      kind: "persistent-body-change",
      vertex: coveredVertex,
      offset: [0, 0, 0],
      colour: "#f59e0b",
    },
    {
      label: "posed / active transient",
      recipe: bareRecipe,
      pose: { body: "relaxed" },
      kind: "transient-deformation",
      vertex: bareVertex,
      offset: [1.15, 0, 0],
      colour: "#f472b6",
    },
  ];

  return specs.map((spec, index) => {
    const injury = record(body, `inspection-${index}`, spec.kind, spec.vertex);
    const state = new RegionalInjuryState(body);
    state.create(injury);
    const actualCoverage =
      spec.recipe.outfit === undefined
        ? false
        : (model.outfit(spec.recipe.outfit).bodyVisible[spec.vertex] as number) === 0;
    const routed = routeRegionalInjuryLayers(state.records, {
      covers: (anchor) => actualCoverage && anchor.vertex === spec.vertex,
    });
    const route = routed[0]?.layer;
    if (!route) throw new Error("inspection fixture produced no active injury route");
    const anchor = point(model, spec.recipe, spec.pose, spec.vertex);
    return {
      label: spec.label,
      recipe: spec.recipe,
      pose: spec.pose,
      record: injury,
      position: anchor.point,
      renderVertex: anchor.renderVertex,
      sceneName: `injury-inspection-${index}`,
      covered: actualCoverage,
      route,
      offset: spec.offset,
      colour: spec.colour,
    };
  });
}

function DiagnosticOverlay({
  at,
  offset,
  colour,
}: {
  at: [number, number, number];
  offset: [number, number, number];
  colour: string;
}) {
  const material = useMemo(
    () => new MeshBasicMaterial({ color: colour, depthTest: false, depthWrite: false }),
    [colour],
  );
  return (
    <mesh
      position={[at[0] + offset[0], at[1] + offset[1], at[2] + offset[2] + 0.025]}
      renderOrder={100}
    >
      <sphereGeometry args={[0.025, 12, 8]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

let scene: Scene | null = null;

function SceneProbe() {
  // The body meshes use raw posed coordinates unless presence or animation owns
  // the lift. The test below reads the actual skinned world point rather than
  // assuming which transform path this fixture has selected.
  scene = useThree((state) => state.scene);
  return null;
}

function Inspection({ rows }: { rows: readonly DiagnosticRow[] }) {
  const [evaluatedActors, setEvaluatedActors] = useState<ReadonlySet<string>>(() => new Set());
  const ready = rows.every((row) => evaluatedActors.has(row.record.id));
  return (
    <div
      data-inspection-ready={ready ? "true" : "false"}
      data-evaluated-actors={[...evaluatedActors].sort().join(",")}
    >
      <Canvas style={{ width: 720, height: 420 }} camera={{ position: [0, 1, 4.5], fov: 35 }}>
        <SceneProbe />
        <ambientLight intensity={2} />
        {rows.map((row) => (
          <group key={row.record.id}>
            <Humanoid
              name={row.sceneName}
              recipe={row.recipe}
              pose={row.pose}
              position={row.offset}
              // The visual contract here is the evaluated body/garment geometry.
              // `onSettled` also waits for every material-image request, which is
              // intentionally outside this anchor/routing inspection.
              onEvaluated={() =>
                setEvaluatedActors((actors) => {
                  if (actors.has(row.record.id)) return actors;
                  return new Set(actors).add(row.record.id);
                })
              }
            />
            <DiagnosticOverlay at={row.position} offset={row.offset} colour={row.colour} />
          </group>
        ))}
      </Canvas>
      <table>
        <caption>
          Neutral injury-state diagnostic overlays and routes, not injury appearance
        </caption>
        <thead>
          <tr>
            <th>case</th>
            <th>class</th>
            <th>base vertex</th>
            <th>garment coverage</th>
            <th>data route</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.record.id}
              data-case={row.record.id}
              data-class={row.record.class}
              data-covered={row.covered ? "true" : "false"}
              data-route={row.route}
            >
              <td>{row.label}</td>
              <td>{row.record.class}</td>
              <td>{row.record.anchor.vertex}</td>
              <td>{row.covered ? "covered" : "exposed"}</td>
              <td>{row.route}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function bodyOf(figure: Object3D): SkinnedMesh {
  let body: SkinnedMesh | null = null;
  figure.traverse((object) => {
    if (object.userData.hkPart === "body" && object.visible) body = object as SkinnedMesh;
  });
  if (!body) throw new Error(`inspection figure ${figure.name} has no ready body mesh`);
  return body;
}

function garmentOf(figure: Object3D): Object3D | null {
  let garment: Object3D | null = null;
  figure.traverse((object) => {
    if (
      object.userData.hkPart === "garment" &&
      object.userData.hkGarment === SWEATER &&
      object.visible
    )
      garment = object;
  });
  return garment;
}

function actualAnchorWorld(row: DiagnosticRow): Vector3 {
  if (!scene) throw new Error("inspection scene is not ready");
  const figure = scene.getObjectByName(row.sceneName);
  if (!figure) throw new Error(`inspection figure ${row.sceneName} is not mounted`);
  scene.updateMatrixWorld(true);
  const body = bodyOf(figure);
  const positions = body.geometry.getAttribute("position");
  const world = new Vector3().fromBufferAttribute(positions, row.renderVertex);
  body.applyBoneTransform(row.renderVertex, world);
  return body.localToWorld(world);
}

describe("regional injury inspection fixture", () => {
  inspect(
    "shows diagnostic base-anchor routes across bare, clothed and posed figures",
    async () => {
      await client.ready;
      const rows = await diagnostics();
      const screen = await render(
        <HumanoidProvider client={client}>
          <Inspection rows={rows} />
        </HumanoidProvider>,
      );
      const fixture = screen.container.querySelector("[data-inspection-ready]");
      if (!fixture) throw new Error("inspection fixture root is not mounted");
      try {
        await expect.poll(() => fixture.getAttribute("data-inspection-ready"), LOAD).toBe("true");
      } catch (error) {
        throw new Error(
          `inspection actors still unevaluated: ${fixture.getAttribute("data-evaluated-actors")}`,
          { cause: error },
        );
      }
      expect(fixture).toHaveAttribute(
        "data-evaluated-actors",
        "inspection-0,inspection-1,inspection-2",
      );
      const canvas = fixture.querySelector("canvas");
      if (!canvas) throw new Error("inspection fixture has no canvas");
      const fixtureRect = fixture.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      expect(canvasRect.width, "diagnostic canvas width").toBe(720);
      expect(canvasRect.right, "diagnostic canvas right edge").toBeLessThanOrEqual(
        window.innerWidth,
      );
      expect(fixtureRect.right, "diagnostic table right edge").toBeLessThanOrEqual(
        window.innerWidth,
      );

      expect(screen.getByText("bare / active marking")).toBeVisible();
      expect(screen.getByText("clothed / persistent under-cover")).toBeVisible();
      expect(screen.getByText("posed / active transient")).toBeVisible();
      expect(screen.getByText("under-cover")).toBeVisible();
      expect(screen.container.querySelectorAll('[data-route="body"]')).toHaveLength(2);
      expect(screen.container.querySelector('[data-case="inspection-0"]')).toHaveAttribute(
        "data-class",
        "surface-marking",
      );
      expect(screen.container.querySelector('[data-case="inspection-0"]')).toHaveAttribute(
        "data-covered",
        "false",
      );
      expect(screen.container.querySelector('[data-case="inspection-0"]')).toHaveAttribute(
        "data-route",
        "body",
      );
      expect(screen.container.querySelector('[data-case="inspection-1"]')).toHaveAttribute(
        "data-class",
        "persistent-body-change",
      );
      expect(screen.container.querySelector('[data-case="inspection-1"]')).toHaveAttribute(
        "data-covered",
        "true",
      );
      expect(screen.container.querySelector('[data-case="inspection-1"]')).toHaveAttribute(
        "data-route",
        "under-cover",
      );
      expect(screen.container.querySelector('[data-case="inspection-2"]')).toHaveAttribute(
        "data-class",
        "transient-deformation",
      );
      expect(screen.container.querySelector('[data-case="inspection-2"]')).toHaveAttribute(
        "data-covered",
        "false",
      );
      expect(screen.container.querySelector('[data-case="inspection-2"]')).toHaveAttribute(
        "data-route",
        "body",
      );

      // The covered route is data-only. Its always-visible sphere is a labelled
      // diagnostic overlay, never evidence that a garment visually occludes it.
      for (const row of rows) {
        const figure = scene?.getObjectByName(row.sceneName);
        expect(figure, `${row.label} figure`).toBeTruthy();
        expect(bodyOf(figure as Object3D), `${row.label} body`).toBeTruthy();
        if (row.covered) expect(garmentOf(figure as Object3D), `${row.label} garment`).toBeTruthy();

        const expected = new Vector3(...row.position).add(new Vector3(...row.offset));
        expect(
          actualAnchorWorld(row).distanceTo(expected),
          `${row.label} anchor world point`,
        ).toBeLessThan(1e-4);
      }

      await page.screenshot({
        element: fixture,
        path: "../../test-results/injury-inspection/regional-injury-routes.png",
      });
    },
    LOAD.timeout + 10_000,
  );
});
