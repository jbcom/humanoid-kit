import fs from "node:fs";
import path from "node:path";
import { it } from "vitest";
import { SMOKE_STRIDE, smokeModelOptions } from "../src/foundation/smoke.ts";
import { runFoundation, type SuiteRow } from "../src/foundation/suite.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { adultManifest, loadFixtureAssets } from "./fixtures.ts";

it("table", { timeout: 900_000 }, () => {
  const recorded: SuiteRow[] = JSON.parse(
    fs.readFileSync(path.resolve(import.meta.dirname, "../docs/evidence/foundation-smoke.json"), "utf8"),
  );
  const model = new HumanoidModel(loadFixtureAssets(true), smokeModelOptions);
  const { closure } = (model as any).adultBodySurface().skinning;
  const zonePen = new Map<string, number>();
  const key = (r: SuiteRow) => `${r.body}/${r.pose}/${r.anatomy}`;
  const rows: SuiteRow[] = [];
  for (const want of recorded) {
    const probe = { pen: [] as any[], fold: [] as any[], odd: [] as any[] };
    (globalThis as any).__hkProbe = probe;
    const [r] = runFoundation(model, "smoke", {
      adult: adultManifest,
      stride: SMOKE_STRIDE,
      only: (p) => p.body.name === want.body && p.pose.name === want.pose,
    });
    (globalThis as any).__hkProbe = undefined;
    rows.push(r!);
    const adultRow = want.anatomy !== "none";
    zonePen.set(key(want), adultRow ? probe.pen.filter(([v]) => closure.follows[v] > 0).reduce((s, x) => s + x[1], 0) : 0);
  }
  const before = new Map(recorded.map((r) => [key(r), r.measure]));
  const lines: string[] = [];
  for (const r of rows) {
    const w = before.get(key(r))!;
    const m = r.measure;
    const f = (a: number, b: number, d = 3) => (Math.abs(a - b) < 1e-3 ? a.toFixed(d) : `${b.toFixed(d)}->${a.toFixed(d)}${a > b + 1e-3 ? "!" : ""}`);
    const g = (a: number, b: number) => (a === b ? `${a}` : `${b}->${a}${a > b ? "!" : ""}`);
    lines.push(`${key(r)} pen ${f(m.penetratingArea, w.penetratingArea)} inv ${g(m.inverted, w.inverted)} sq ${f(m.squashedArea, w.squashedArea)} folds ${g(m.folds, w.folds)} vol ${g(m.volumeOut.length, w.volumeOut.length)} seam ${f(m.seamGap, w.seamGap, 6)} zonePen ${(zonePen.get(key(r)) ?? 0).toFixed(3)} nonZonePen ${(m.penetratingArea - (zonePen.get(key(r)) ?? 0)).toFixed(3)}`);
  }
  console.log(`TABLE\n${lines.join("\n")}`);
});
