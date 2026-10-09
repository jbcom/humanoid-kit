/**
 * The torso's skin layers (docs/ARCHITECTURE.md, "Torso"): the nipple and
 * areola, then the layers the trunk's surface has beyond them. Every
 * quantity names its source in docs/research/SKIN-STATES.md (C7) or is marked
 * a CHOICE there.
 */
import { AssetFormatError, type HumanoidAssets } from "../../format/assetFormat.ts";
import type { ColourLayer } from "../layers.ts";
import { areolaAlbedo, type Rgb, skinAlbedo } from "../skinTone.ts";
import {
  areolaRadius,
  figureBuild,
  nippleContrast,
  nippleRadius,
  pubertyProgress,
} from "../torsoTone.ts";
import { once } from "./once.ts";

const smoothstep = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** The target whose moved vertices are the nipple and its areola: their centre is the nipple's. */
const NIPPLE_TARGET = "breast/nipple-size-incr";

/** An areola's edge is soft by this fraction of its radius either side (CHOICE: a few millimetres on an adult's), and at least `AREOLA_EDGE_MIN` metres. */
export const AREOLA_EDGE_SOFTNESS = 0.14;
const AREOLA_EDGE_MIN = 0.0015;

/**
 * How far from a nipple's centre the areola's fields reach, metres: past the
 * largest areola a figure paints (a woman's at the largest breast, 22 mm in
 * radius) and its soft edge. A static bound of the field: the
 * paint (`AREOLA_LAYER`) puts the figure's own edge inside it.
 */
export const AREOLA_REACH = 0.0275;

export interface AreolaZone {
  /** 1 within the reach's inner part, easing to 0 at the reach. */
  mask: Float32Array;
  /** Distance from the nipple's centre in reaches, 0..1, where the mask lies. */
  radial: Float32Array;
}

/** The centre of the vertices the nipple-size target moves on each side of the body (side +1, then -1). */
function nippleCentres(assets: HumanoidAssets): [number, number, number][] {
  const t = assets.targets.get(NIPPLE_TARGET);
  if (!t)
    throw new AssetFormatError(`a skin layer needs target ${NIPPLE_TARGET}, which is not loaded`);
  const P = assets.positions;
  return [1, -1].map((side) => {
    const vs = Array.from(t.indices).filter((v) => Math.sign(P[v * 3] as number) === side);
    const sum = [0, 0, 0];
    for (const v of vs)
      for (let k = 0; k < 3; k++) sum[k] = (sum[k] as number) + (P[v * 3 + k] as number);
    return sum.map((s) => s / vs.length) as [number, number, number];
  });
}

/** The disk of `AREOLA_REACH` round each nipple, with its radial coordinate. */
export function areolaZone(assets: HumanoidAssets): AreolaZone {
  return once(assets, "areola-zone", () => {
    const P = assets.positions;
    const n = assets.manifest.vertexCount;
    const mask = new Float32Array(n);
    const radial = new Float32Array(n);
    for (const c of nippleCentres(assets)) {
      for (let v = 0; v < n; v++) {
        const d = Math.hypot(
          (P[v * 3] as number) - c[0],
          (P[v * 3 + 1] as number) - c[1],
          (P[v * 3 + 2] as number) - c[2],
        );
        const w = 1 - smoothstep(0.85 * AREOLA_REACH, AREOLA_REACH, d);
        if (w > (mask[v] as number)) {
          mask[v] = w;
          radial[v] = Math.min(1, d / AREOLA_REACH);
        }
      }
    }
    return { mask, radial };
  });
}

/**
 * How much of the recipe's areola setting a figure shows at its age: a child's
 * areola is hardly darker than the skin round it and darkens through puberty
 * (CHOICE: a tenth to the whole of the setting's depth, on the puberty ramp).
 */
export const AREOLA_CHILD_DEPTH = 0.3;

/**
 * The areola's colour round a nipple, by distance from its centre: the nipple's
 * colour (the areola's by `nippleContrast`) out to the nipple's radius, the
 * areola's out to the areola's (`areolaRadius`, which grows through puberty
 * and with the breast), the skin's beyond, each edge soft.
 */
export const AREOLA_LAYER: ColourLayer = {
  id: "areola",
  blend: "mix",
  targets: [NIPPLE_TARGET],
  fields: (assets) => {
    const { mask, radial } = areolaZone(assets);
    return { mask, coord: radial };
  },
  paint: (input) => {
    const { tone, areola } = input;
    const b = figureBuild(input);
    const p = pubertyProgress(b.age, b.gender);
    const depth = areola * (AREOLA_CHILD_DEPTH + (1 - AREOLA_CHILD_DEPTH) * p);
    const areolaColour = areolaAlbedo(tone, depth);
    const k = nippleContrast(b.age, b.gender);
    const nippleColour = areolaColour.map((c) => c * k) as Rgb;
    const skin = skinAlbedo(tone);
    const edge = areolaRadius(b.age, b.gender, b.breastSize);
    const tip = nippleRadius(b.age, b.gender);
    const edgeSoft = Math.max(AREOLA_EDGE_MIN, AREOLA_EDGE_SOFTNESS * edge);
    const stops = Array.from({ length: 8 }, (_, i) => {
      const r = (i / 7) * AREOLA_REACH;
      const onAreola = 1 - smoothstep(edge - edgeSoft, edge + edgeSoft, r);
      const onNipple = 1 - smoothstep(tip - 0.0008, tip + 0.0012, r);
      return [0, 1, 2].map((c) => {
        const inside =
          (areolaColour[c] as number) +
          ((nippleColour[c] as number) - (areolaColour[c] as number)) * onNipple;
        return (skin[c] as number) + (inside - (skin[c] as number)) * onAreola;
      }) as Rgb;
    });
    return { strength: 0.9, stops };
  },
};

/** The torso's layers in stack order. */
export const TORSO_SKIN_LAYERS: readonly ColourLayer[] = [AREOLA_LAYER];
