import fs from "node:fs";
import { it } from "vitest";
import { foundationPermutations } from "../src/foundation/permutations.ts";
import { posedSurface } from "../src/foundation/posed.ts";
import { foundationRecipe } from "../src/foundation/recipe.ts";
import { smokeModelOptions } from "../src/foundation/smoke.ts";
import { creaseMask } from "../src/foundation/suite.ts";
import { measureInvariants } from "../src/foundation/invariants.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { adultManifest, loadFixtureAssets } from "./fixtures.ts";

const OUT = process.env.HK_PROBE_OUT as string;
const ROWS = (process.env.HK_PROBE_ROWS ?? "f-heavy/seated").split(",");

it("probe", { timeout: 900_000 }, () => {
  const model = new HumanoidModel(loadFixtureAssets(true), smokeModelOptions);
  const adult = (model as any).adultBodySurface();
  const { owner, closure } = adult.skinning;
  const result: any = {};
  for (const want of ROWS) {
    const [b, pose] = want.split("/");
    const p = foundationPermutations("smoke").find((x) => x.body.name === b && x.pose.name === pose);
    if (!p) throw new Error(want);
    (globalThis as any).__hkRows = [];
    const body = posedSurface(model, foundationRecipe(p, adultManifest), pose as string);
    const rowsDump = (globalThis as any).__hkRows;
    (globalThis as any).__hkRows = undefined;
    const crease = creaseMask(model, body.surface);
    const probe = { pen: [] as any[], fold: [] as any[], odd: [] as any[] };
    (globalThis as any).__hkProbe = probe;
    const m = measureInvariants(body, crease, 1);
    (globalThis as any).__hkProbe = undefined;
    // classify
    const zone: number[] = [];
    for (let v = 0; v < body.vertexCount; v++)
      if (closure && (closure.follows[v] as number) > 0 && (closure.canal[v] as number) >= 0) zone.push(v);
    const R = body.rest;
    const dist = (v: number) => {
      let d = Infinity;
      for (const z of zone)
        d = Math.min(d, Math.hypot(R[v * 3]! - R[z * 3]!, R[v * 3 + 1]! - R[z * 3 + 1]!, R[v * 3 + 2]! - R[z * 3 + 2]!));
      return d;
    };
    const cls = (v: number) => ({
      v,
      owner: owner[v],
      canal: body.canals?.of[v],
      zone: closure ? +(closure.follows[v] as number).toFixed(3) : 0,
      zcanal: closure ? closure.canal[v] : -1,
      d: +dist(v).toFixed(4),
      x: +R[v * 3]!.toFixed(3), y: +R[v * 3 + 1]!.toFixed(3), z: +R[v * 3 + 2]!.toFixed(3),
    });
    result[want] = {
      measure: { pen: m.penetratingArea, folds: m.folds, inverted: m.inverted, squashed: m.squashedArea },
      pen: probe.pen.map(([v, a, depth, parts]) => ({ ...cls(v), a, depth, parts })),
      fold: probe.fold.map(([p, q, ang]) => ({ p: cls(p), q: cls(q), ang })),
      odd: probe.odd,
      rows: rowsDump,
      pos: Array.from(body.positions),
      nrm: Array.from(body.normals),
      rn: Array.from(body.restNormals),
      rest: Array.from(body.rest),
      zone: zone.map((v) => [v, closure.follows[v], closure.canal[v]]),
      index: Array.from(body.index),
      weld: Array.from(body.weld),
    };
  }
  fs.writeFileSync(OUT, JSON.stringify(result));
});
