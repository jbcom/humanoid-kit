/**
 * The invariant suite over a tier (docs/FOUNDATION.md): each permutation's
 * body posed and measured. Tone changes no position, so each body × pose ×
 * anatomy is posed once and its measure holds for every tone it is listed with.
 */
import type { AdultAnatomyManifest } from "../format/assetFormat.ts";
import type { HumanoidModel } from "../model/humanoidModel.ts";
import { CREASE_LAYERS } from "../surface/regions/creases.ts";
import { type InvariantMeasure, measureInvariants } from "./invariants.ts";
import {
  type FoundationPermutation,
  type FoundationTier,
  foundationPermutations,
} from "./permutations.ts";
import { posedSurface } from "./posed.ts";
import { foundationRecipe } from "./recipe.ts";

/** One body × pose × anatomy, the tones it was listed at, and what it measures. */
export interface SuiteRow {
  body: string;
  pose: string;
  anatomy: string;
  tones: string[];
  measure: InvariantMeasure;
}

/** The named creases' mask on a body surface's render vertices: the union of the crease layers'. */
export function creaseMask(model: HumanoidModel, surface: "base" | "adult"): Float32Array {
  const n = model.assets.manifest.vertexCount;
  const union = new Float32Array(n);
  for (const layer of CREASE_LAYERS) {
    const mask = layer.fields(model.assets).mask;
    for (let v = 0; v < n; v++) union[v] = Math.max(union[v] as number, mask[v] as number);
  }
  return model.bodyField(union, surface);
}

/**
 * Measures every distinct body × pose × anatomy of `tier` (or of `only`, a
 * subset of its permutations). `stride` samples vertices for penetration.
 */
export function runFoundation(
  model: HumanoidModel,
  tier: FoundationTier,
  options: {
    adult?: Pick<AdultAnatomyManifest, "anatomy" | "modifiers">;
    stride?: number;
    only?: (p: FoundationPermutation) => boolean;
  } = {},
): SuiteRow[] {
  const groups = new Map<string, { p: FoundationPermutation; tones: string[] }>();
  for (const p of foundationPermutations(tier)) {
    if (options.only && !options.only(p)) continue;
    const key = `${p.body.name}/${p.pose.name}/${p.anatomy ?? "none"}`;
    const g = groups.get(key);
    if (g) g.tones.push(p.tone.name);
    else groups.set(key, { p, tones: [p.tone.name] });
  }
  const creases = new Map<string, Float32Array>();
  const rows: SuiteRow[] = [];
  for (const { p, tones } of groups.values()) {
    const body = posedSurface(model, foundationRecipe(p, options.adult), p.pose.name);
    let crease = creases.get(body.surface);
    if (!crease) {
      crease = creaseMask(model, body.surface);
      creases.set(body.surface, crease);
    }
    rows.push({
      body: p.body.name,
      pose: p.pose.name,
      anatomy: p.anatomy ?? "none",
      tones,
      measure: measureInvariants(body, crease, options.stride),
    });
  }
  return rows;
}

/** Whether a row passes every invariant. */
export const rowPasses = (m: InvariantMeasure): boolean =>
  m.penetrating === 0 &&
  m.inverted === 0 &&
  m.squashed === 0 &&
  m.volumeOut.length === 0 &&
  m.folds === 0 &&
  m.seamGap < 1e-6;

/** The rows as a markdown table: one line per body × pose × anatomy, failures first. */
export function suiteTable(rows: readonly SuiteRow[]): string {
  const mm = (x: number) => (x * 1000).toFixed(1);
  const lines = [
    "| body | pose | anatomy | penetrating (deepest mm, parts) | contacts (deepest mm) | inverted | squashed | joint volume out of band | folds (sharpest °) | seam gap (mm) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  const sorted = [...rows].sort(
    (x, y) => Number(rowPasses(x.measure)) - Number(rowPasses(y.measure)),
  );
  for (const r of sorted) {
    const m = r.measure;
    lines.push(
      `| ${r.body} | ${r.pose} | ${r.anatomy} | ${m.penetrating ? `${m.penetrating} (${mm(m.deepest)}, ${m.deepestParts})` : "0"} | ${m.contacts ? `${m.contacts} (${mm(m.deepestContact)})` : "0"} | ${m.inverted} | ${m.squashed} | ${m.volumeOut.join(", ") || "-"} | ${m.folds ? `${m.folds} (${m.sharpest.toFixed(0)})` : "0"} | ${mm(m.seamGap)} |`,
    );
  }
  return lines.join("\n");
}
