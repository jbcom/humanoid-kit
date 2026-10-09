/**
 * The torso's skin layers (docs/ARCHITECTURE.md, "Torso"): the nipple and
 * areola, then the layers the trunk's surface has beyond them. Every
 * quantity names its source in docs/research/SKIN-STATES.md (C7) or is marked
 * a CHOICE there.
 */
import { AssetFormatError, type HumanoidAssets, jointPosition } from "../../format/assetFormat.ts";
import type { ColourLayer, DetailLayer, SkinLayerFields, SkinPaintInput } from "../layers.ts";
import {
  areolaAlbedo,
  haemoglobinRatio,
  melaninDensityAlbedo,
  type Rgb,
  skinAlbedo,
} from "../skinTone.ts";
import {
  abdominalDefinition,
  areolaRadius,
  clavicleDefinition,
  figureBuild,
  lineaNigraStrength,
  nippleContrast,
  nippleRadius,
  pubertyProgress,
  ribDefinition,
} from "../torsoTone.ts";
import { bodySurface, once } from "./once.ts";
import { skinZones } from "./skinZones.ts";

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
 * How far from a nipple's centre the areola's fields reach, in the base mesh's
 * metres: past the largest areola any figure paints on that mesh (its own
 * radius over its `areolaStretch`: a small-breasted woman's 16 mm over 1.14 is
 * 14, a short man's 14 over 0.83 is 17, with the soft edge 19) and no further,
 * so the eight stops across it are as fine as they can be. A static bound of
 * the field: the paint (`AREOLA_LAYER`) puts the figure's own edge inside it.
 */
export const AREOLA_REACH = 0.022;

export interface AreolaZone {
  /** 1 within the reach's inner part, easing to 0 at the reach. */
  mask: Float32Array;
  /** Distance from the nipple's centre in reaches, 0..1, where the mask lies. */
  radial: Float32Array;
}

/** The vertices the nipple-size target moves on one side of the body (+1 the left, -1 the right). */
function nippleVertices(assets: HumanoidAssets, side: number): number[] {
  const t = assets.targets.get(NIPPLE_TARGET);
  if (!t)
    throw new AssetFormatError(`a skin layer needs target ${NIPPLE_TARGET}, which is not loaded`);
  const P = assets.positions;
  return Array.from(t.indices).filter((v) => Math.sign(P[v * 3] as number) === side);
}

/** The centre of the vertices the nipple-size target moves on each side of the body (side +1, then -1). */
function nippleCentres(assets: HumanoidAssets): [number, number, number][] {
  const P = assets.positions;
  return [1, -1].map((side) => {
    const vs = nippleVertices(assets, side);
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
  // The figure's own lengths, in the field's: the mesh round the nipple is this much bigger.
  const k = input.areolaScale && input.areolaScale > 0 ? input.areolaScale : 1;
  const edge = areolaRadius(b.age, b.gender, b.breastSize) / k;
  return {
    edge,
    soft: Math.max(AREOLA_EDGE_MIN / k, AREOLA_EDGE_SOFTNESS * edge),
    tip: nippleRadius(b.age, b.gender) / k,
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

/** The vertices the stretch is measured on: the body's, from this far to this far (base metres) of a nipple's centre. */
const STRETCH_RING = [0.008, 0.03] as const;

/**
 * How much larger the skin round the nipples is on a figure than on the base
 * mesh: the median, over the body's vertices in a ring round each nipple's
 * centre, of their distance from it on the figure (`control`, the morphed
 * control mesh) over their distance on the base mesh. The fields are measured
 * on the base mesh, and the figure's mesh is that mesh morphed: 0.65 on a
 * seven year old, 1.96 on the largest breast. 1 on the base mesh itself.
 */
export function areolaStretch(assets: HumanoidAssets, control: Float32Array): number {
  const rings = once(assets, "areola-ring", () => {
    const P = assets.positions;
    const onBody = bodySurface(assets);
    return nippleCentres(assets).map((c) => {
      const side = Math.sign(c[0]);
      const vs: number[] = [];
      const base: number[] = [];
      for (let v = 0; v < assets.manifest.vertexCount; v++) {
        if (onBody[v] !== 1 || Math.sign(P[v * 3] as number) !== side) continue;
        const d = Math.hypot(
          (P[v * 3] as number) - c[0],
          (P[v * 3 + 1] as number) - c[1],
          (P[v * 3 + 2] as number) - c[2],
        );
        if (d >= STRETCH_RING[0] && d <= STRETCH_RING[1]) {
          vs.push(v);
          base.push(d);
        }
      }
      return { vs, base, centre: nippleVertices(assets, side) };
    });
  });
  const ratios: number[] = [];
  for (const { vs, base, centre } of rings) {
    // The nipple's centre on the figure: the same vertices' centroid.
    const c = [0, 0, 0];
    for (const v of centre)
      for (let k = 0; k < 3; k++)
        c[k] = (c[k] as number) + (control[v * 3 + k] as number) / centre.length;
    vs.forEach((v, i) => {
      const d = Math.hypot(
        (control[v * 3] as number) - (c[0] as number),
        (control[v * 3 + 1] as number) - (c[1] as number),
        (control[v * 3 + 2] as number) - (c[2] as number),
      );
      ratios.push(d / (base[i] as number));
    });
  }
  ratios.sort((a, b) => a - b);
  return ratios.length > 0 ? (ratios[ratios.length >> 1] as number) : 1;
}

/** A skeleton joint's position on the base mesh. */
function joint(assets: HumanoidAssets, name: string): [number, number, number] {
  const out = new Float32Array(3);
  jointPosition(assets, assets.positions, name, out, 0);
  return [out[0] as number, out[1] as number, out[2] as number];
}

/**
 * The collarbones: a ridge on each clavicle's axis between two grooves, the
 * fossae above and below it, drawn as two periods of a crease layer across the
 * bone. The coordinate is the signed distance up from the axis, in the skin's
 * plane, in periods (`CLAVICLE_PERIOD`): the ridge is at coordinate 0.5, the
 * grooves at 0.25 and 0.75, and the window is flat at 0 and 1. The mask
 * tapers where the bone meets the breastbone and the shoulder, and over skin
 * that does not face up and forward.
 */
export const CLAVICLE_PERIODS = 2;
/** Groove to ridge to groove, metres (CHOICE: a collarbone's width, with the hollows either side). */
const CLAVICLE_PERIOD = 0.016;
/** The relief of a collarbone on a lean figure, metres (CHOICE: bone is 6 to 10 mm proud of the hollows; a shading cue is a fraction of it). */
export const CLAVICLE_RELIEF_HEIGHT = 0.0012;

/** The direction from a collarbone out through the skin over it: forward and up (a unit vector). */
const CLAVICLE_OUTWARD = [0, 0.5, 0.866] as const;

export function clavicleFields(assets: HumanoidAssets): SkinLayerFields {
  return once(assets, "clavicles", () => {
    const P = assets.positions;
    const n = assets.manifest.vertexCount;
    const onBody = bodySurface(assets);
    const mask = new Float32Array(n);
    const coord = new Float32Array(n);
    // The skin lies in front of and above the bone: out from the bone along this.
    const out = CLAVICLE_OUTWARD;
    for (const side of ["L", "R"]) {
      const head = joint(assets, `clavicle.${side}____head`);
      const tail = joint(assets, `clavicle.${side}____tail`);
      const axis = [0, 1, 2].map((k) => (tail[k] as number) - (head[k] as number));
      const len2 = axis.reduce((a, x) => a + x * x, 0);
      // Up across the bone, in the cross-section the outward direction and the axis leave: a
      // point straight out from the bone has 0 of it, the neck side of the bone has more.
      const raw = [
        out[1] * (axis[2] as number) - out[2] * (axis[1] as number),
        out[2] * (axis[0] as number) - out[0] * (axis[2] as number),
        out[0] * (axis[1] as number) - out[1] * (axis[0] as number),
      ];
      const sign = (raw[1] as number) >= 0 ? 1 : -1;
      const across = raw.map((x) => (sign * x) / Math.hypot(...raw));
      for (let v = 0; v < n; v++) {
        if (onBody[v] !== 1) continue;
        // Each vertex belongs to the bone on its own side of the body.
        if ((P[v * 3] as number) >= 0 !== (side === "L")) continue;
        const p = [0, 1, 2].map((k) => (P[v * 3 + k] as number) - (head[k] as number));
        const t = p.reduce((a, x, k) => a + x * (axis[k] as number), 0) / len2;
        if (t < 0 || t > 1) continue;
        const height = p.reduce((a, x, k) => a + x * (out[k] as number), 0);
        // Over the bone, not behind it: the skin is a few millimetres to three centimetres out.
        const over = smoothstep(0, 0.008, height) * (1 - smoothstep(0.03, 0.045, height));
        const d = p.reduce((a, x, k) => a + x * (across[k] as number), 0);
        const w =
          smoothstep(0.04, 0.18, t) *
          (1 - smoothstep(0.78, 0.96, t)) *
          (1 - smoothstep(0.75 * CLAVICLE_PERIOD, CLAVICLE_PERIOD, Math.abs(d))) *
          over;
        if (w > (mask[v] as number)) {
          mask[v] = w;
          coord[v] = 0.5 + d / (CLAVICLE_PERIODS * CLAVICLE_PERIOD);
        }
      }
    }
    return { mask, coord };
  });
}

export const CLAVICLE_LAYER: DetailLayer = {
  id: "clavicles",
  kind: "detail",
  pattern: "creases",
  targets: [],
  fields: clavicleFields,
  paint: (input) => ({
    strength: clavicleDefinition(figureBuild(input)),
    height: CLAVICLE_RELIEF_HEIGHT,
    size: CLAVICLE_PERIODS,
  }),
};

/**
 * The ribs: the grooves between them over the front and flanks of the chest,
 * `RIB_PERIODS` periods of a crease layer down a window from the second rib to
 * the tenth. A rib runs down and outward from the breastbone, so the coordinate
 * is the distance down from the second rib's height along the line y + slope ·
 * |x| = constant, in the window's length. The breast (tissue over the ribs),
 * the arms and the breastbone's own strip are left out. Anatomy (the ribs'
 * spacing, slope, extent) is a CHOICE from a thorax's proportions, fitted to the
 * base mesh's chest: no measurement of the surface landmarks was found.
 */
export const RIB_PERIODS = 9;
/** Distance between ribs at the front, metres. */
const RIB_SPACING = 0.03;
/** How far a rib falls per metre outward from the breastbone (a slope of 25°). */
const RIB_SLOPE = 0.47;
/** The second rib sits this far below the collarbone's inner end at the midline, metres. */
const RIB_TOP_BELOW_CLAVICLE = 0.05;
/** The relief of the grooves between ribs on a lean figure, metres (CHOICE). */
export const RIB_RELIEF_HEIGHT = 0.0008;

export function ribFields(assets: HumanoidAssets): SkinLayerFields {
  return once(assets, "ribs", () => {
    const P = assets.positions;
    const n = assets.manifest.vertexCount;
    const zones = skinZones(assets);
    const breast = zones.zone("breast");
    const arm = zones.zone("upperArm");
    const top = joint(assets, "clavicle.L____head")[1] - RIB_TOP_BELOW_CLAVICLE;
    const window = RIB_PERIODS * RIB_SPACING;
    const onBody = bodySurface(assets);
    const mask = new Float32Array(n);
    const coord = new Float32Array(n);
    for (let v = 0; v < n; v++) {
      if (onBody[v] !== 1) continue;
      const x = Math.abs(P[v * 3] as number);
      const y = P[v * 3 + 1] as number;
      const t = (top - (y + RIB_SLOPE * x)) / window;
      if (t <= 0 || t >= 1) continue;
      const w =
        (zones.front[v] as number) *
        smoothstep(0, 0.12, t) *
        (1 - smoothstep(0.88, 1, t)) *
        smoothstep(0.015, 0.04, x) *
        (1 - smoothstep(0.13, 0.2, x)) *
        (1 - smoothstep(0.1, 0.5, breast[v] as number)) *
        (1 - smoothstep(0.1, 0.5, arm[v] as number));
      if (w > 0) {
        mask[v] = w;
        coord[v] = t;
      }
    }
    return { mask, coord };
  });
}

export const RIB_LAYER: DetailLayer = {
  id: "ribs",
  kind: "detail",
  pattern: "creases",
  targets: [],
  fields: ribFields,
  paint: (input) => ({
    strength: ribDefinition(figureBuild(input)),
    height: RIB_RELIEF_HEIGHT,
    size: RIB_PERIODS,
  }),
};

/**
 * The navel's centre on the base mesh: the deepest point of the midline's skin
 * at the height of the spine's third joint (the navel lies at about the level of
 * the third lumbar vertebra), where the mesh has its dimple.
 */
export function navelCentre(assets: HumanoidAssets): [number, number, number] {
  return once(assets, "navel", () => {
    const P = assets.positions;
    const onBody = bodySurface(assets);
    const level = joint(assets, "spine03____head")[1];
    let best = -1;
    for (let v = 0; v < assets.manifest.vertexCount; v++) {
      if (onBody[v] !== 1 || Math.abs(P[v * 3] as number) > 0.006) continue;
      if ((P[v * 3 + 2] as number) < 0.05 || Math.abs((P[v * 3 + 1] as number) - level) > 0.02)
        continue;
      if (best < 0 || (P[v * 3 + 2] as number) < (P[best * 3 + 2] as number)) best = v;
    }
    if (best < 0) throw new AssetFormatError("no navel on the base mesh's midline");
    return [P[best * 3] as number, P[best * 3 + 1] as number, P[best * 3 + 2] as number];
  });
}

/** How far from the navel's centre its skin reaches, in the base mesh's metres (CHOICE: a navel is 1 to 2 cm across, with the skin that folds into it). */
export const NAVEL_REACH = 0.02;

/** The navel: a disc round its centre, the coordinate the distance from it in reaches. */
function navelFields(assets: HumanoidAssets): SkinLayerFields {
  return once(assets, "navel-fields", () => {
    const P = assets.positions;
    const n = assets.manifest.vertexCount;
    const onBody = bodySurface(assets);
    const c = navelCentre(assets);
    const mask = new Float32Array(n);
    const coord = new Float32Array(n);
    for (let v = 0; v < n; v++) {
      if (onBody[v] !== 1) continue;
      const d = Math.hypot(
        (P[v * 3] as number) - c[0],
        (P[v * 3 + 1] as number) - c[1],
        (P[v * 3 + 2] as number) - c[2],
      );
      const w = 1 - smoothstep(0.85 * NAVEL_REACH, NAVEL_REACH, d);
      if (w > 0) {
        mask[v] = w;
        coord[v] = Math.min(1, d / NAVEL_REACH);
      }
    }
    return { mask, coord };
  });
}

/** How much redder (more haemoglobin, in units of the measured axis) and how much darker the navel's hollow is than its skin (CHOICE: thin scar skin in shadow; none measured). */
export const NAVEL_HAEMOGLOBIN = 0.4;
export const NAVEL_DARKENING = 0.93;

export const NAVEL_LAYER: ColourLayer = {
  id: "navel",
  blend: "multiply",
  targets: [],
  fields: navelFields,
  paint: ({ tone }) => {
    const pink = haemoglobinRatio(tone, NAVEL_HAEMOGLOBIN).map((c) => c * NAVEL_DARKENING) as Rgb;
    return {
      strength: 1,
      stops: STOP_RADII.map((_, i) => {
        // The hollow in the middle third, easing out to the skin at the edge.
        const w = 1 - smoothstep(0.25, 0.8, i / 7);
        return pink.map((c) => 1 + (c - 1) * w) as Rgb;
      }),
    };
  },
};

/**
 * Where the midline layers end above the navel's level, base metres (full, then none): a hand's
 * breadth above it. The linea reaches the breastbone in life; here it stops below the
 * breasts' skin, which the atlas has other layers' channels over (a layer shares channels
 * only with layers that lie well apart from it, `docs/ARCHITECTURE.md`).
 */
const MIDLINE_TOP: [number, number] = [0.05, 0.08];

/**
 * A strip down the midline, `halfWidth` either side, from `below` the navel's
 * level to `above` it, over the belly's front: the coordinate runs across it
 * (0.5 on the midline, 0 and 1 at the edges). A strip of a few centimetres is
 * what the base mesh's vertices can carry; the finer line is the layer's paint.
 */
function midlineFields(
  assets: HumanoidAssets,
  halfWidth: number,
  below: [number, number],
  above: [number, number],
  clearNavel: boolean,
): SkinLayerFields {
  const P = assets.positions;
  const n = assets.manifest.vertexCount;
  const onBody = bodySurface(assets);
  const front = skinZones(assets).front;
  const c = navelCentre(assets);
  const mask = new Float32Array(n);
  const coord = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    if (onBody[v] !== 1) continue;
    const x = P[v * 3] as number;
    const dy = (P[v * 3 + 1] as number) - c[1];
    const across = 1 - smoothstep(0.7 * halfWidth, halfWidth, Math.abs(x));
    const along = smoothstep(-below[1], -below[0], dy) * (1 - smoothstep(above[0], above[1], dy));
    let w = across * along * (front[v] as number);
    if (clearNavel) {
      const d = Math.hypot(
        x - c[0],
        (P[v * 3 + 1] as number) - c[1],
        (P[v * 3 + 2] as number) - c[2],
      );
      w *= smoothstep(0.5 * NAVEL_REACH, 0.9 * NAVEL_REACH, d);
    }
    if (w > 0) {
      mask[v] = w;
      coord[v] = Math.min(1, Math.max(0, 0.5 + x / (2 * halfWidth)));
    }
  }
  return { mask, coord };
}

/** Half the width of the linea nigra's band, base metres (CHOICE: 0.5 to 1.5 cm wide in pregnancy; a base mesh's vertices cannot carry less than a few centimetres). */
const LINEA_NIGRA_HALF_WIDTH = 0.015;
/** How much more melanin the line holds than the skin (CHOICE: a factor on the skin's own optical density; deeper in pregnancy). */
export const LINEA_NIGRA_DENSITY = 1.6;

/**
 * The linea nigra, the dark midline of the lower belly, from the pubic bone to
 * above the navel: seen in most pregnant women and faintly in others, in both
 * sexes. At rest a faint line (`lineaNigraStrength`), after puberty; the
 * pregnancy state will raise its strength to full. Its colour is the skin's
 * own melanin at `LINEA_NIGRA_DENSITY` times its density, as a ratio to the
 * skin, bell-shaped across the strip.
 */
export const LINEA_NIGRA_LAYER: ColourLayer = {
  id: "linea-nigra",
  blend: "multiply",
  targets: [],
  fields: (assets) =>
    once(assets, "linea-nigra", () =>
      midlineFields(assets, LINEA_NIGRA_HALF_WIDTH, [0.13, 0.17], MIDLINE_TOP, false),
    ),
  paint: (input) => {
    const { tone } = input;
    const skin = skinAlbedo(tone);
    const dark: Rgb = tone.override
      ? [0.78, 0.7, 0.66]
      : (melaninDensityAlbedo(tone, LINEA_NIGRA_DENSITY, tone.haemoglobin).map(
          (c, k) => c / (skin[k] as number),
        ) as Rgb);
    return {
      strength: lineaNigraStrength(figureBuild(input)),
      stops: Array.from({ length: 8 }, (_, i) => {
        const x = (2 * i) / 7 - 1;
        const bell = 1 - x * x;
        return dark.map((c) => 1 + (c - 1) * bell) as Rgb;
      }),
    };
  },
};

/** Half the width of the linea alba's furrow window, base metres. */
const LINEA_ALBA_HALF_WIDTH = 0.012;
/** The furrow's depth on a lean, muscular figure, metres (CHOICE: a fraction of a millimetre, a shading cue). */
export const LINEA_ALBA_DEPTH = 0.0005;

/**
 * The linea alba, the furrow between the rectus muscles from the breastbone
 * to the pubic bone, broken at the navel: one groove of a crease layer across
 * the strip, as deep as the figure's leanness and muscle make it
 * (`abdominalDefinition`).
 */
export const LINEA_ALBA_LAYER: DetailLayer = {
  id: "linea-alba",
  kind: "detail",
  pattern: "creases",
  targets: [],
  fields: (assets) =>
    once(assets, "linea-alba", () =>
      midlineFields(assets, LINEA_ALBA_HALF_WIDTH, [0.1, 0.13], MIDLINE_TOP, true),
    ),
  paint: (input) => ({
    strength: abdominalDefinition(figureBuild(input)),
    height: LINEA_ALBA_DEPTH,
    size: 1,
  }),
};

/** The torso's layers in stack order. */
export const TORSO_SKIN_LAYERS: readonly (ColourLayer | DetailLayer)[] = [
  AREOLA_LAYER,
  AREOLA_RELIEF_LAYER,
  MONTGOMERY_LAYER,
  CLAVICLE_LAYER,
  RIB_LAYER,
  NAVEL_LAYER,
  LINEA_NIGRA_LAYER,
  LINEA_ALBA_LAYER,
];
