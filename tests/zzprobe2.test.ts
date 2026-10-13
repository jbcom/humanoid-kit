import fs from "node:fs";
import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import { it } from "vitest";
import { measureInvariants } from "../src/foundation/invariants.ts";
import { foundationPermutations } from "../src/foundation/permutations.ts";
import { posedSurface } from "../src/foundation/posed.ts";
import { foundationRecipe } from "../src/foundation/recipe.ts";
import { smokeModelOptions } from "../src/foundation/smoke.ts";
import { creaseMask } from "../src/foundation/suite.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { adultManifest, loadFixtureAssets } from "./fixtures.ts";

const ROWS = (process.env.HK_PROBE_ROWS ?? "f-elder/squat").split(",");
const OUT = process.env.HK_PROBE_OUT as string;

it("probe2", { timeout: 900_000 }, () => {
  const model = new HumanoidModel(loadFixtureAssets(true), smokeModelOptions);
  const adult = (model as any).adultBodySurface();
  const { closure } = adult.skinning;
  const out: any = {};
  for (const want of ROWS) {
    const [b, pose] = want.split("/");
    const p = foundationPermutations("smoke").find((x) => x.body.name === b && x.pose.name === pose);
    if (!p) throw new Error(want);
    const body = posedSurface(model, foundationRecipe(p, adultManifest), pose as string);
    const probe = { pen: [] as any[], fold: [] as any[], odd: [] as any[] };
    (globalThis as any).__hkProbe = probe;
    const m = measureInvariants(body, creaseMask(model, body.surface), 1);
    (globalThis as any).__hkProbe = undefined;
    const P = body.positions;
    const N = body.normals;
    const idx = body.index;
    const zonePen = probe.pen.filter(([v]) => (closure.follows[v] as number) > 0);
    const res: any[] = [];
    for (const [v, a] of zonePen) {
      let best = Infinity;
      const partners: number[] = [];
      for (let u = 0; u < body.vertexCount; u++) {
        if (body.weld[u] === body.weld[v]) continue;
        const d = Math.hypot(P[u * 3]! - P[v * 3]!, P[u * 3 + 1]! - P[v * 3 + 1]!, P[u * 3 + 2]! - P[v * 3 + 2]!);
        if (d < best) best = d;
        if (d < 2e-4) partners.push(u);
      }
      const n = new Vector3(N[v * 3]!, N[v * 3 + 1]!, N[v * 3 + 2]!).normalize();
      // recast with the partner lip (every vertex within 3 mm whose normal faces v's) moved 0.5 mm away along v's normal
      const Q = Float32Array.from(P);
      for (let u = 0; u < body.vertexCount; u++) {
        const d = Math.hypot(P[u * 3]! - P[v * 3]!, P[u * 3 + 1]! - P[v * 3 + 1]!, P[u * 3 + 2]! - P[v * 3 + 2]!);
        const facing = N[u * 3]! * n.x + N[u * 3 + 1]! * n.y + N[u * 3 + 2]! * n.z;
        if (d < 3e-3 && facing < -0.3 && body.weld[u] !== body.weld[v]) {
          Q[u * 3] += 5e-4 * n.x;
          Q[u * 3 + 1] += 5e-4 * n.y;
          Q[u * 3 + 2] += 5e-4 * n.z;
        }
      }
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(Q, 3));
      g.setIndex(new BufferAttribute(Uint32Array.from(idx), 1));
      const bvh = new MeshBVH(g, { verbose: false });
      const ray = new Ray(new Vector3(P[v * 3]!, P[v * 3 + 1]!, P[v * 3 + 2]!).addScaledVector(n, 1e-4), n);
      const hits = bvh.raycast(ray, DoubleSide).length;
      g.dispose();
      res.push({ v, a, nearest: best, partners: partners.length, recastHits: hits });
    }
    out[want] = {
      measure: { pen: m.penetratingArea, folds: m.folds, inverted: m.inverted },
      zonePenArea: zonePen.reduce((s, x) => s + x[1], 0),
      allPenArea: probe.pen.reduce((s, x) => s + x[1], 0),
      res,
    };
  }
  fs.writeFileSync(OUT, JSON.stringify(out));
});
