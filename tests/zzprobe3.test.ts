import { it } from "vitest";
import { smokeModelOptions } from "../src/foundation/smoke.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { applyStencil } from "../src/subdiv/catmullClark.ts";
import { loadFixtureAssets } from "./fixtures.ts";

it("mirror stats", () => {
  const model = new HumanoidModel(loadFixtureAssets(true), smokeModelOptions);
  const adult = (model as any).adultBodySurface();
  const { closure, owner } = adult.skinning;
  const mesh = adult.part.mesh;
  const T = applyStencil(mesh.stencil, model.assets.positions, new Float32Array(mesh.topology.vertexCount * 3));
  const sv = (r: number) => mesh.renderToSurface[r];
  const at = (r: number, k: number) => T[sv(r) * 3 + k];
  let n = 0, mutualFail = 0;
  const dists: number[] = [];
  const fails: string[] = [];
  for (let v = 0; v < owner.length; v++) {
    const inGroup = closure.canal[v] >= 0 || owner[v] === 2 || owner[v] === 3;
    if (!inGroup) continue;
    const m = closure.mirror[v];
    if (m < 0) continue;
    n++;
    const mm = closure.mirror[m];
    if (mm < 0 || sv(mm) !== sv(v)) {
      mutualFail++;
      if (fails.length < 12) fails.push(`${v}(o${owner[v]} c${closure.canal[v]})->${m}->${mm}`);
    }
    if (owner[v] < 0) dists.push(Math.hypot(at(m, 0) + at(v, 0), at(m, 1) - at(v, 1), at(m, 2) - at(v, 2)));
  }
  dists.sort((a, b) => a - b);
  const q = (p: number) => (dists[Math.floor(p * (dists.length - 1))]! * 1000).toFixed(4);
  // shortest zone edge on the template
  let shortest = Infinity;
  const idx = mesh.index;
  for (let t = 0; t < idx.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = idx[t + e], b = idx[t + ((e + 1) % 3)];
      if (closure.canal[a] < 0 || closure.canal[b] < 0 || sv(a) === sv(b)) continue;
      const d = Math.hypot(at(a, 0) - at(b, 0), at(a, 1) - at(b, 1), at(a, 2) - at(b, 2));
      if (d > 0) shortest = Math.min(shortest, d);
    }
  console.log("PAIRS", n, "non-mutual", mutualFail, fails.join(" "));
  console.log("DIST mm q0/50/90/99/100", q(0), q(0.5), q(0.9), q(0.99), q(1), "shortest zone edge mm", (shortest * 1000).toFixed(3));
});
