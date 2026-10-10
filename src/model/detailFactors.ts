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
 *   scaled-down large one, so size is a blend of keys, not a scale);
 * - `sramp:<name>:<x>,<w>;…`: the same of a skin-state signal, which lets a state
 *   pass through a shape drawn between its ends (a morph blends positions
 *   linearly, so a tube swinging from hanging to rising would shorten on the
 *   way if it were not drawn at its midpoint too).
 *
 * A target's weight is the product of its factors.
 */
import {
  type AdultAnatomySpec,
  AssetFormatError,
  curveAt,
  parseCurve,
  type ShapeModifierEntry,
} from "../format/assetFormat.ts";
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
    case "ramp":
    case "sramp": {
      const at = rest.lastIndexOf(":");
      if (at < 0)
        return fail(`needs ${kind}:<${kind === "ramp" ? "modifier" : "signal"}>:<x>,<w>;…`);
      const name = rest.slice(0, at);
      const curve = piecewise(rest.slice(at + 1), fail);
      if (kind === "sramp") return (_r, s) => curve(clamp01(s[name] ?? 0));
      const id = known(name);
      return (r) => curve(clamp01(r.modifiers[id] ?? 0));
    }
    default:
      return fail("has an unknown kind (mod, mod-, signal, ramp or sramp)");
  }
}

/** A piecewise-linear function from `x,w;x,w;…`, holding its end values outside its points. */
function piecewise(text: string, fail: (why: string) => never): (x: number) => number {
  let points: [number, number][];
  try {
    points = parseCurve(text);
  } catch (e) {
    return fail((e as Error).message);
  }
  return (v) => curveAt(points, v);
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

/**
 * The skin-state signals that change the figure's shape: those the body's and
 * the adult pack's state morphs drive, and those a gate or drive of the pack's
 * detail targets reads (`signal:<name>`). A caller that re-evaluates the figure
 * only when one of these changes needs the list.
 */
export function shapeSignalNames(
  bodyMorphs: readonly { signal: string }[],
  anatomy?: AdultAnatomySpec,
): string[] {
  const names = new Set([...bodyMorphs, ...(anatomy?.stateMorphs ?? [])].map((m) => m.signal));
  for (const table of [anatomy?.detail?.gates, anatomy?.detail?.drives])
    for (const factors of Object.values(table ?? {}))
      for (const f of factors) {
        if (f.startsWith("signal:")) names.add(f.slice("signal:".length));
        else if (f.startsWith("sramp:"))
          names.add(f.slice("sramp:".length).split(":")[0] as string);
      }
  return [...names];
}
