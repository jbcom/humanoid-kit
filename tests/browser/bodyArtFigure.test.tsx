/**
 * Body art on a whole figure in React (`<Humanoid>`, the worker's placement):
 * piercings are drawn as metal at their sites and follow the figure, the skin
 * reads the figure's body-art texture, and a recipe without body art draws
 * none and pays nothing for it.
 */
import { Canvas, useThree } from "@react-three/fiber";
import {
  type Material,
  MeshPhysicalMaterial,
  type Object3D,
  type Scene,
  SkinnedMesh,
  Vector3,
} from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import type { Evaluation } from "../../src/model/humanoidModel.ts";
import { Humanoid, HumanoidProvider } from "../../src/react/index.ts";
import { createRecipe, type Recipe } from "../../src/recipe/recipe.ts";
import { SkinMaterial } from "../../src/render/skinMaterial.ts";
import { inlineWorkerClient } from "./inlineClient.ts";

const LOAD = { timeout: 120_000 };
const client = inlineWorkerClient();
beforeAll(async () => {
  await client.ready;
});
afterAll(() => client.dispose());

const ink = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 8;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  g.fillStyle = "#101014";
  g.fillRect(0, 0, 8, 8);
  return { mark: c };
})();

const pierced = createRecipe({
  bodyArt: {
    tattoos: [{ image: "mark", at: 8160, size: 0.08 }],
    piercings: [
      { site: "ear-lobe.L", jewellery: "ring", metal: "gold" },
      { site: "nostril.R", jewellery: "stud", metal: "steel" },
      { site: "navel", jewellery: "barbell", metal: "titanium" },
    ],
    vitiligo: { extent: 0.5, seed: 2 },
  },
});

let scene: Scene | null = null;
function Probe() {
  scene = useThree((s) => s.scene);
  return null;
}

function Figure({ recipe, onSettled }: { recipe: Recipe; onSettled: (e: Evaluation) => void }) {
  return (
    <HumanoidProvider client={client}>
      <div style={{ width: 160, height: 160 }}>
        <Canvas>
          <Probe />
          <Humanoid recipe={recipe} bodyArtImages={ink} onEvaluated={onSettled} />
        </Canvas>
      </div>
    </HumanoidProvider>
  );
}

const each = (fn: (o: Object3D) => void) => scene?.traverse(fn);
const jewellery = () => {
  const out: SkinnedMesh[] = [];
  each((o) => {
    if (
      o instanceof SkinnedMesh &&
      o.material instanceof MeshPhysicalMaterial &&
      o.material.metalness === 1
    )
      out.push(o);
  });
  return out;
};
const skins = () => {
  const out: SkinMaterial[] = [];
  each((o) => {
    const m = (o as { material?: Material }).material;
    if (m instanceof SkinMaterial) out.push(m);
  });
  return out;
};

describe("body art on a figure", () => {
  it(
    "draws each piercing in its metal at its site, and the skin with its body art",
    async () => {
      let evaluation: Evaluation | null = null;
      const screen = await render(<Figure recipe={pierced} onSettled={(e) => (evaluation = e)} />);
      await expect.poll(() => jewellery().length, LOAD).toBe(3);
      const ev = evaluation as unknown as Evaluation;
      expect(ev.bodyArt?.piercings).toHaveLength(3);
      for (const p of ev.bodyArt?.piercings ?? []) {
        const site = new Vector3().fromArray(p.hole);
        // Each piece's rest geometry lies within a size of its site.
        const piece = jewellery().find((m) => {
          m.geometry.computeBoundingSphere();
          return (m.geometry.boundingSphere?.center.distanceTo(site) ?? 1) < p.size + 0.01;
        });
        expect(piece, p.site).toBeDefined();
      }
      const colours = jewellery().map((m) => (m.material as MeshPhysicalMaterial).color.r);
      expect(Math.min(...colours)).toBeGreaterThan(0.5);
      await expect.poll(() => skins().some((m) => m.defines?.HK_BODY_ART === ""), LOAD).toBe(true);

      // The same figure without body art: no jewellery, and the skin reads none.
      await screen.rerender(<Figure recipe={createRecipe()} onSettled={(e) => (evaluation = e)} />);
      await expect.poll(() => jewellery().length, LOAD).toBe(0);
      await expect
        .poll(() => skins().every((m) => m.defines?.HK_BODY_ART === undefined), LOAD)
        .toBe(true);
    },
    LOAD.timeout,
  );
});
