/**
 * Diagnostic-only browser fixture for issue #33. It is ignored unless
 * HK_INJURY_INSPECTION=1 and deliberately draws only labelled markers, never
 * procedural injury geometry or a proposed visual effect.
 *
 * Run only after a visual reviewer has allocated a silent browser slot:
 * HK_INJURY_INSPECTION=1 pnpm exec vitest run tests/browser/injuryInspection.test.tsx
 */
import { Canvas } from "@react-three/fiber";
import { bodyPack } from "humanoid-kit-body";
import { clothingPack } from "humanoid-kit-clothing";
import { useMemo, useState } from "react";
import { MeshBasicMaterial } from "three";
import { afterAll, describe, expect, it } from "vitest";
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

const inspect = process.env.HK_INJURY_INSPECTION === "1" ? it : it.skip;
const LOAD = { timeout: 120_000 };
const SWEATER = "suits/male_casualsuit02";
const client = inlineWorkerClient({ subdivision: 0 }, { clothing: true });

afterAll(() => client.dispose());

interface DiagnosticRow {
  label: string;
  recipe: Recipe;
  pose: HumanoidPose;
  record: RegionalInjury;
  position: [number, number, number];
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
): [number, number, number] {
  const surface = posedSurface(model, recipe, pose.body ?? "tpose");
  const renderVertex = model.baseRenderVertices(surface.surface)[vertex] as number;
  if (renderVertex < 0) throw new Error("inspection anchor is absent from the rendered body");
  const p = renderVertex * 3;
  return [
    surface.positions[p] as number,
    surface.positions[p + 1] as number,
    surface.positions[p + 2] as number,
  ];
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
    return {
      label: spec.label,
      recipe: spec.recipe,
      pose: spec.pose,
      record: injury,
      position: point(model, spec.recipe, spec.pose, spec.vertex),
      covered: actualCoverage,
      route,
      offset: spec.offset,
      colour: spec.colour,
    };
  });
}

function Gizmo({
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

function Inspection({ rows }: { rows: readonly DiagnosticRow[] }) {
  const [settled, setSettled] = useState(0);
  return (
    <div data-inspection-ready={settled === rows.length ? "true" : "false"}>
      <Canvas style={{ width: 720, height: 420 }} camera={{ position: [0, 1, 4.5], fov: 35 }}>
        <ambientLight intensity={2} />
        {rows.map((row) => (
          <group key={row.record.id}>
            <Humanoid
              recipe={row.recipe}
              pose={row.pose}
              position={row.offset}
              onSettled={() => setSettled((count) => Math.min(rows.length, count + 1))}
            />
            <Gizmo at={row.position} offset={row.offset} colour={row.colour} />
          </group>
        ))}
      </Canvas>
      <table>
        <caption>Neutral injury-state diagnostic routes, not injury appearance</caption>
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
            <tr key={row.record.id} data-route={row.route}>
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
      await expect
        .poll(() => screen.container.getAttribute("data-inspection-ready"), LOAD)
        .toBe("true");

      expect(screen.getByText("bare / active marking")).toBeVisible();
      expect(screen.getByText("clothed / persistent under-cover")).toBeVisible();
      expect(screen.getByText("posed / active transient")).toBeVisible();
      expect(screen.getByText("under-cover")).toBeVisible();
      expect(screen.container.querySelectorAll('[data-route="body"]')).toHaveLength(2);
    },
    LOAD.timeout,
  );
});
