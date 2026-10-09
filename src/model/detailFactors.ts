/**
 * The factors a detail target's weight is built from (`AdultDetailSpec.gates` and
 * `.drives`), a small language the adult pack writes in its manifest so that the
 * core names no anatomy:
 *
 * - `mod:<id>`: the positive part of a modifier's value, 0 to 1 (how much of a
 *   feature there is, or how far toward a modifier's `hi` end);
 * - `mod-:<id>`: the negative part (how far toward its `lo` end);
 * - `signal:<name>`: a skin-state signal, 0 to 1;
 * - `ramp:<id>:<x>,<w>;<x>,<w>;…`: a piecewise-linear function of the positive
 *   part of a modifier's value, holding its end values outside its points, which
 *   lets one modifier blend between baked shapes (a small organ is not a
 *   scaled-down large one, so size is a blend of keys, not a scale).
 *
 * A target's weight is the product of its factors.
 */
import { AssetFormatError, type ShapeModifierEntry } from "../format/assetFormat.ts";
import type { Recipe } from "../recipe/recipe.ts";

export type Factor = (recipe: Recipe, signals: Readonly<Record<string, number>>) => number;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** A factor as a function of a recipe and a skin state; throws `AssetFormatError` for a text it cannot read. */
export function compileFactor(
  text: string,
  what: string,
  modifiers: ReadonlyMap<string, ShapeModifierEntry>,
): Factor {
  const fail = (why: string): never => {
    throw new AssetFormatError(`${what}: factor "${text}" ${why}`);
  };
  const colon = text.indexOf(":");
  if (colon < 0) return fail("is not kind:name");
  const kind = text.slice(0, colon);
  const rest = text.slice(colon + 1);
  const known = (id: string) => {
    if (!modifiers.has(id)) fail(`names no modifier ${id}`);
    return id;
  };
  switch (kind) {
    case "mod": {
      const id = known(rest);
      return (r) => clamp01(r.modifiers[id] ?? 0);
    }
    case "mod-": {
      const id = known(rest);
      return (r) => clamp01(-(r.modifiers[id] ?? 0));
    }
    case "signal":
      return (_r, s) => clamp01(s[rest] ?? 0);
    case "ramp": {
      const at = rest.lastIndexOf(":");
      if (at < 0) return fail("needs ramp:<modifier>:<x>,<w>;…");
      const id = known(rest.slice(0, at));
      const points = rest
        .slice(at + 1)
        .split(";")
        .map((p) => p.split(",").map(Number) as [number, number]);
      if (
        points.length < 2 ||
        points.some((p) => p.length !== 2 || p.some((x) => !Number.isFinite(x)))
      )
        return fail("needs at least two numeric x,w points");
      for (let i = 1; i < points.length; i++)
        if ((points[i] as [number, number])[0] <= (points[i - 1] as [number, number])[0])
          return fail("has points that do not ascend in x");
      return (r) => {
        const v = clamp01(r.modifiers[id] ?? 0);
        const first = points[0] as [number, number];
        const last = points[points.length - 1] as [number, number];
        if (v <= first[0]) return first[1];
        if (v >= last[0]) return last[1];
        for (let i = 1; i < points.length; i++) {
          const b = points[i] as [number, number];
          if (v <= b[0]) {
            const a = points[i - 1] as [number, number];
            return a[1] + ((v - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
          }
        }
        return last[1];
      };
    }
    default:
      return fail("has an unknown kind (mod, mod-, signal or ramp)");
  }
}

/** The product of factors for a recipe in a skin state (1 for none). */
export const product = (
  factors: readonly Factor[],
  recipe: Recipe,
  signals: Readonly<Record<string, number>>,
): number => {
  let w = 1;
  for (const f of factors) {
    w *= f(recipe, signals);
    if (w === 0) return 0;
  }
  return w;
};
