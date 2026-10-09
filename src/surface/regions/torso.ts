/**
 * The torso's skin layers (docs/ARCHITECTURE.md, "Torso"): the nipple and
 * areola, then the layers the trunk's surface has beyond them. Every
 * quantity names its source in docs/research/SKIN-STATES.md (C7) or is marked
 * a CHOICE there.
 */
import { AssetFormatError, type HumanoidAssets } from "../../format/assetFormat.ts";
import type { ColourLayer, DetailLayer, SkinPaintInput } from "../layers.ts";
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

/** The radii at which a layer's eight stops sample the coordinate, metres. */
const STOP_RADII = Array.from({ length: 8 }, (_, i) => (i / 7) * AREOLA_REACH);

/** Where a figure's nipple and areola end, and how soft the areola's edge is, metres, and its stage. */
interface AreolaShape {
  edge: number;
  soft: number;
  tip: number;
  /** Puberty, 0..1 (`pubertyProgress`). */
  stage: number;
  gender: number;
}

function areolaShape(input: SkinPaintInput): AreolaShape {
  const b = figureBuild(input);
  const edge = areolaRadius(b.age, b.gender, b.breastSize);
  return {
    edge,
    soft: Math.max(AREOLA_EDGE_MIN, AREOLA_EDGE_SOFTNESS * edge),
    tip: nippleRadius(b.age, b.gender),
    stage: pubertyProgress(b.age, b.gender),
    gender: b.gender,
  };
}

/** 1 within the areola, 0 beyond it, at radius `r` from the nipple's centre. */
const onAreola = (s: AreolaShape, r: number) => 1 - smoothstep(s.edge - s.soft, s.edge + s.soft, r);
/** 1 on the nipple, 0 beyond it. */
const onNipple = (s: AreolaShape, r: number) => 1 - smoothstep(s.tip - 0.0008, s.tip + 0.0012, r);

/**
 * The areola's colour round a nipple, by distance from its centre: the nipple's
 * colour (the areola's by `nippleContrast`) out to the nipple's radius, the
 * areola's out to the areola's (`areolaRadius`, which grows through puberty
 * and with the breast), the skin's beyond, each edge soft. Painted as the
 * ratio of each to the tone's skin and multiplied in.
 */
export const AREOLA_LAYER: ColourLayer = {
  id: "areola",
  blend: "multiply",
  targets: [NIPPLE_TARGET],
  fields: (assets) => {
    const { mask, radial } = areolaZone(assets);
    return { mask, coord: radial };
  },
  paint: (input) => {
    const { tone, areola } = input;
    const b = figureBuild(input);
    const shape = areolaShape(input);
    const depth = areola * (AREOLA_CHILD_DEPTH + (1 - AREOLA_CHILD_DEPTH) * shape.stage);
    const areolaColour = areolaAlbedo(tone, depth);
    const k = nippleContrast(b.age, b.gender);
    const nippleColour = areolaColour.map((c) => c * k) as Rgb;
    const skin = skinAlbedo(tone);
    // As ratios to the tone's own skin, so the layer multiplies whatever skin is under it (the
    // base colour carries its own shading, which a mix to the tone's flat albedo would show as
    // a halo) and the skin beyond the areola is the identity.
    const stops = STOP_RADII.map((r) => {
      const a = onAreola(shape, r);
      const n = onNipple(shape, r);
      return [0, 1, 2].map((c) => {
        const inside =
          (areolaColour[c] as number) +
          ((nippleColour[c] as number) - (areolaColour[c] as number)) * n;
        return 1 + (inside / (skin[c] as number) - 1) * a;
      }) as Rgb;
    });
    return { strength: 1, stops };
  },
};

/**
 * The texture of nipple and areolar skin: a fine granular relief (the areola's
 * skin is thin, with smooth muscle beneath that wrinkles it, and the nipple's
 * is creased). Amplitude by the profile: full on the nipple, `AREOLA_BODY_RELIEF`
 * of it over the areola, none beyond the areola's edge; fainter before puberty.
 * Height and grain are CHOICES, a tenth of a millimetre at a millimetre's
 * spacing: no profilometry of the areola was found, and skin's own relief is of
 * that order.
 */
export const AREOLA_RELIEF_HEIGHT = 0.00012;
export const AREOLA_RELIEF_SPACING = 0.0009;
export const AREOLA_BODY_RELIEF = 0.5;
/** The share of the relief a child's skin shows before puberty (CHOICE). */
export const AREOLA_CHILD_RELIEF = 0.35;

export const AREOLA_RELIEF_LAYER: DetailLayer = {
  id: "areola-relief",
  kind: "detail",
  pattern: "bumps",
  profiled: true,
  targets: [NIPPLE_TARGET],
  fields: (assets) => {
    const { mask, radial } = areolaZone(assets);
    return { mask, coord: radial };
  },
  paint: (input) => {
    const shape = areolaShape(input);
    return {
      strength: AREOLA_CHILD_RELIEF + (1 - AREOLA_CHILD_RELIEF) * shape.stage,
      height: AREOLA_RELIEF_HEIGHT,
      size: AREOLA_RELIEF_SPACING,
      profile: STOP_RADII.map((r) =>
        Math.max(onNipple(shape, r), AREOLA_BODY_RELIEF * onAreola(shape, r)),
      ),
    };
  },
};

/**
 * Montgomery tubercles: sebaceous glands in a ring over the areola, 1 to 2 mm
 * across, 2 to 28 on an areola in pregnancy (a count with no baseline for
 * other women or for men: both found only for the pregnant). Raised cells in a
 * ring from `MONTGOMERY_RING` of the areola's radius, their share of the cells
 * (the occupancy) the paint's profile: `MONTGOMERY_OCCUPANCY` at full
 * maturity, by sex, scaled by the stage's square so they appear through
 * puberty and not before it. The occupancies give about a dozen on an adult
 * woman's areola and four on a man's, a CHOICE inside the measured range.
 * Spacing and height are CHOICES: a bump spans 0.7 of a cell, so a spacing of
 * 2.2 mm makes the 1.5 mm tubercle.
 */
export const MONTGOMERY_SPACING = 0.0022;
export const MONTGOMERY_HEIGHT = 0.0006;
export const MONTGOMERY_RING: readonly [number, number, number, number] = [0.25, 0.4, 0.75, 0.92];
export const MONTGOMERY_OCCUPANCY = { female: 0.08, male: 0.05 } as const;

export const MONTGOMERY_LAYER: DetailLayer = {
  id: "montgomery",
  kind: "detail",
  pattern: "tubercles",
  targets: [NIPPLE_TARGET],
  fields: (assets) => {
    const { mask, radial } = areolaZone(assets);
    return { mask, coord: radial };
  },
  paint: (input) => {
    const shape = areolaShape(input);
    const full =
      MONTGOMERY_OCCUPANCY.female +
      (MONTGOMERY_OCCUPANCY.male - MONTGOMERY_OCCUPANCY.female) * shape.gender;
    const occupancy = full * shape.stage ** 2;
    const [in0, in1, out0, out1] = MONTGOMERY_RING;
    return {
      strength: 1,
      height: MONTGOMERY_HEIGHT,
      size: MONTGOMERY_SPACING,
      profile: STOP_RADII.map(
        (r) =>
          occupancy *
          smoothstep(in0 * shape.edge, in1 * shape.edge, r) *
          (1 - smoothstep(out0 * shape.edge, out1 * shape.edge, r)),
      ),
    };
  },
};

/** The torso's layers in stack order. */
export const TORSO_SKIN_LAYERS: readonly (ColourLayer | DetailLayer)[] = [
  AREOLA_LAYER,
  AREOLA_RELIEF_LAYER,
  MONTGOMERY_LAYER,
];
