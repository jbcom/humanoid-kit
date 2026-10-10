/**
 * The torso's skin layers (docs/ARCHITECTURE.md, "Torso"): the nipple and
 * areola, then the layers the trunk's surface has beyond them. Every
 * quantity names its source in docs/research/SKIN-STATES.md (C7) or is marked
 * a CHOICE there.
 */
import { AssetFormatError, type HumanoidAssets, jointPosition } from "../../format/assetFormat.ts";
import {
  type ColourLayer,
  type DetailLayer,
  type SkinLayerFields,
  type SkinPaintInput,
  TUBERCLE_RADIUS,
} from "../layers.ts";
import {
  areolaAlbedo,
  haemoglobinRatio,
  melaninDensityAlbedo,
  type Rgb,
  skinAlbedo,
} from "../skinTone.ts";
import {
  STRIA_WIDTH,
  STRIAE_ORIENTATION_SEAM,
  striaeAmount,
  striaeColour,
  striaeMaturity,
} from "../striae.ts";
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
import { uvOrientation } from "./uvOrientation.ts";

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
 * radius over its `areolaStretch`: a small-breasted woman's 16 mm over 1.25 is
 * 13, a short man's 14 over 0.83 is 17, with the soft edge 19) and no further,
 * so the eight stops across it are as fine as they can be. A static bound of
 * the field: the paint (`AREOLA_LAYER`) puts the figure's own edge inside it.
 */
export const AREOLA_REACH = 0.022;

export interface AreolaZone {
  /** 1 within the reach's inner part, easing to 0 at the reach. */
  mask: Float32Array;
  /**
   * Distance from the nearer nipple's centre in reaches, held at 1 past the
   * reach: continuous everywhere, so a triangle on the mask's edge reads the
   * outer stops, never the nipple's.
   */
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

/**
 * The disk of `AREOLA_REACH` round each nipple, with its radial coordinate. The
 * coordinate runs on past the disk, held at 1 (the skin's own stops): it once
 * fell to 0 outside it, so every triangle on the mask's edge swept through
 * the whole profile back to the nipple's stop, and drew a ring of the
 * nipple's colour and relief round the areola (the step under a man's
 * areola, where his nipple is lighter than it) and a ring of small tubercles.
 */
export function areolaZone(assets: HumanoidAssets): AreolaZone {
  return once(assets, "areola-zone", () => {
    const P = assets.positions;
    const n = assets.manifest.vertexCount;
    const mask = new Float32Array(n);
    const radial = new Float32Array(n).fill(1);
    for (const c of nippleCentres(assets)) {
      for (let v = 0; v < n; v++) {
        const d = Math.hypot(
          (P[v * 3] as number) - c[0],
          (P[v * 3 + 1] as number) - c[1],
          (P[v * 3 + 2] as number) - c[2],
        );
        const w = 1 - smoothstep(0.85 * AREOLA_REACH, AREOLA_REACH, d);
        if (w > (mask[v] as number)) mask[v] = w;
        radial[v] = Math.min(radial[v] as number, d / AREOLA_REACH);
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
export interface AreolaShape {
  edge: number;
  soft: number;
  tip: number;
  /** Puberty, 0..1 (`pubertyProgress`). */
  stage: number;
  gender: number;
  /** How much larger the figure's skin is than the field's (`areolaScale`): a metre on the figure is 1 / scale in the field. */
  scale: number;
}

export function areolaShape(input: SkinPaintInput): AreolaShape {
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
    scale: k,
  };
}

/** 1 within the areola, 0 beyond it, at radius `r` from the nipple's centre. */
const onAreola = (s: AreolaShape, r: number) => 1 - smoothstep(s.edge - s.soft, s.edge + s.soft, r);
/**
 * How far out the areola's colour is solid, field metres: the radius where the
 * colour as the shader draws it (`onAreola` at the eight stops, linearly between
 * them) first falls below nine tenths. The stops are 3 mm apart, so this is up
 * to a stop inside the edge's own smooth fade: what the eye takes as the areola.
 */
export function areolaSolid(s: AreolaShape): number {
  const a = STOP_RADII.map((r) => onAreola(s, r));
  for (let k = 1; k < a.length; k++) {
    const lo = a[k - 1] as number;
    const hi = a[k] as number;
    if (hi < 0.9) {
      const r0 = STOP_RADII[k - 1] as number;
      const r1 = STOP_RADII[k] as number;
      return lo <= 0.9 ? r0 : r0 + ((lo - 0.9) / (lo - hi)) * (r1 - r0);
    }
  }
  return AREOLA_REACH;
}

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
export const MONTGOMERY_HEIGHT = 0.0004;
export const MONTGOMERY_RING: readonly [number, number, number, number] = [0.25, 0.4, 0.75, 0.92];
export const MONTGOMERY_OCCUPANCY = { female: 0.08, male: 0.05 } as const;
/**
 * How far inside the areola's edge every tubercle stays, metres on the figure
 * (the integrator's ruling: tubercles sat just outside the edge, where the
 * coarse profile's interpolation and bumps cut at the pixel let them through).
 */
export const MONTGOMERY_EDGE_MARGIN = 0.001;

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
      // No bump reaches past where the areola's colour starts to fade (its edge less its
      // softness) less the margin: the limit on a bump's centre is that, less its radius, in
      // the field's coordinate (the bumps are drawn at the figure's size).
      limit: Math.min(
        1,
        Math.max(
          0,
          (areolaSolid(shape) -
            (MONTGOMERY_EDGE_MARGIN + TUBERCLE_RADIUS * MONTGOMERY_SPACING) / shape.scale) /
            AREOLA_REACH,
        ),
      ),
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
const STRETCH_RING = [0.008, 0.02] as const;

/**
 * How much larger the skin round the nipples is on a figure than on the base
 * mesh: the median, over the body's vertices in a ring round each nipple's
 * centre, of their distance from it on the figure (`control`, the morphed
 * control mesh) over their distance on the base mesh. The fields are measured
 * on the base mesh, and the figure's mesh is that mesh morphed: 0.68 on a
 * seven year old, 2.09 on the largest breast. 1 on the base mesh itself.
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
 * The collarbones: a swell layer (`swellHeight`), a smooth rounded ridge over
 * each clavicle with the supraclavicular fossa, a hollow, above it, and no
 * groove or outline anywhere. The coordinate is the signed distance up from
 * the bone across the skin, from `CLAVICLE_BELOW` under it (0) to
 * `CLAVICLE_ABOVE` over it (1); the cross-section (`CLAVICLE_PROFILE`) is flat
 * at both ends. The bone is S-shaped, bowed forward over its inner two thirds
 * and back over its outer third (`clavicleBow`), so the ridge follows the S.
 * The mask tapers where the bone meets the breastbone and the shoulder, and
 * over skin that does not face up and forward; the shader fades the relief by
 * the smootherstep of the mask per pixel, so its edge leaves no step.
 */
/** The window's reach below the bone's line across the skin, metres (CHOICE: the ridge's lower flank). */
const CLAVICLE_BELOW = 0.02;
/** The window's reach above the bone's line, metres (CHOICE: the ridge's upper flank and the supraclavicular fossa, 2 to 3 cm wide). */
const CLAVICLE_ABOVE = 0.04;
/**
 * The cross-section, below to above (CHOICE, shaped on lean figures' photographs): flat,
 * the ridge over the bone a millimetre above its line (the spline's peak, about 0.75),
 * then the fossa's hollow (about -0.45) 2 to 3 cm above it, and flat again.
 */
export const CLAVICLE_PROFILE = [0, 0, 0.9, 0.8, -0.3, -0.6, 0, 0] as const;
/** The relief of a collarbone on a lean figure, metres (CHOICE: bone is 6 to 10 mm proud of the hollows; a shading cue is a fraction of it). */
export const CLAVICLE_RELIEF_HEIGHT = 0.0012;
/** How far the clavicle bows forward over its inner part and back over its outer part, metres (CHOICE from its S shape seen from above). */
const CLAVICLE_BOW_MEDIAL = 0.008;
const CLAVICLE_BOW_LATERAL = 0.005;
/** Where along the bone (0 at the breastbone) the bow turns from forward to back (its inner two thirds and outer third). */
const CLAVICLE_BOW_TURN = 0.6;

/** The direction from a collarbone out through the skin over it: forward and up (a unit vector). */
const CLAVICLE_OUTWARD = [0, 0.5, 0.866] as const;

/** How far forward of its straight axis the S-shaped clavicle lies at `t` along it (0 at the breastbone), metres. */
export function clavicleBow(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  return t < CLAVICLE_BOW_TURN
    ? CLAVICLE_BOW_MEDIAL * Math.sin((Math.PI * t) / CLAVICLE_BOW_TURN)
    : -CLAVICLE_BOW_LATERAL *
        Math.sin((Math.PI * (t - CLAVICLE_BOW_TURN)) / (1 - CLAVICLE_BOW_TURN));
}

/**
 * The clavicle's outer (acromial) end. The rig's clavicle bone stops at the shoulder
 * bone's head, about halfway along the real collarbone, and the shoulder bone runs on
 * down to the head of the humerus; the collarbone itself runs out over it to the
 * acromion, at the shoulder bone's tail's width, rising on along its own slope by half
 * as much again (CHOICE: the bone's outer end is a little higher than its middle).
 */
export function clavicleLateralEnd(
  assets: HumanoidAssets,
  side: "L" | "R",
): [number, number, number] {
  const head = joint(assets, `clavicle.${side}____head`);
  const mid = joint(assets, `clavicle.${side}____tail`);
  const shoulder = joint(assets, `shoulder01.${side}____tail`);
  const run = Math.abs(shoulder[0] - mid[0]) / Math.max(1e-6, Math.abs(mid[0] - head[0]));
  return [shoulder[0], mid[1] + 0.5 * run * (mid[1] - head[1]), mid[2]];
}

export function clavicleFields(assets: HumanoidAssets): SkinLayerFields {
  return once(assets, "clavicles", () => {
    const P = assets.positions;
    const n = assets.manifest.vertexCount;
    const onBody = bodySurface(assets);
    const mask = new Float32Array(n);
    const coord = new Float32Array(n);
    const window = CLAVICLE_BELOW + CLAVICLE_ABOVE;
    // The skin lies in front of and above the bone: out from the bone along this.
    const out = CLAVICLE_OUTWARD;
    for (const side of ["L", "R"] as const) {
      const head = joint(assets, `clavicle.${side}____head`);
      const tail = clavicleLateralEnd(assets, side);
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
        // Relative to the S-shaped bone at this place along it, not its straight axis.
        p[2] = (p[2] as number) - clavicleBow(t);
        const d = p.reduce((a, x, k) => a + x * (across[k] as number), 0);
        // The coordinate is the height over the bone's own line, held at 0 and 1 (the flat ends of
        // the cross-section) beyond the window, so no triangle on the mask's edge sweeps through it.
        coord[v] = Math.min(1, Math.max(0, (d + CLAVICLE_BELOW) / window));
        if (t < 0 || t > 1) continue;
        const height = p.reduce((a, x, k) => a + x * (out[k] as number), 0);
        // Over the bone and the fossa, not the back: the skin over the bone is a few millimetres
        // to three centimetres out, and the fossa lies above and a little behind it (its skin up
        // to 1.5 cm behind the bone's line along the outward direction).
        const over = smoothstep(-0.02, -0.008, height) * (1 - smoothstep(0.03, 0.045, height));
        const w =
          smoothstep(0.04, 0.18, t) *
          (1 - smoothstep(0.78, 0.96, t)) *
          smoothstep(-CLAVICLE_BELOW, -0.6 * CLAVICLE_BELOW, d) *
          (1 - smoothstep(0.75 * CLAVICLE_ABOVE, CLAVICLE_ABOVE, d)) *
          over;
        if (w > (mask[v] as number)) mask[v] = w;
      }
    }
    return { mask, coord };
  });
}

export const CLAVICLE_LAYER: DetailLayer = {
  id: "clavicles",
  kind: "detail",
  pattern: "swell",
  targets: [],
  fields: clavicleFields,
  paint: (input) => ({
    strength: clavicleDefinition(figureBuild(input)),
    height: CLAVICLE_RELIEF_HEIGHT,
    // A swell has no period; the size is unused.
    size: 1,
    profile: CLAVICLE_PROFILE,
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
      // Past the window the coordinate holds its end value (a flat of the grooves), so no
      // triangle on its edge sweeps through the ribs it skips.
      coord[v] = Math.min(1, Math.max(0, t));
      if (t <= 0 || t >= 1) continue;
      const w =
        (zones.front[v] as number) *
        smoothstep(0, 0.12, t) *
        (1 - smoothstep(0.88, 1, t)) *
        smoothstep(0.015, 0.04, x) *
        (1 - smoothstep(0.13, 0.2, x)) *
        (1 - smoothstep(0.1, 0.5, breast[v] as number)) *
        (1 - smoothstep(0.1, 0.5, arm[v] as number));
      if (w > 0) mask[v] = w;
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
    // Across the strip the coordinate runs on past its edges, held at 0 and 1, so the triangles on
    // the mask's edge sweep no coordinate between the two.
    coord[v] = Math.min(1, Math.max(0, 0.5 + x / (2 * halfWidth)));
    if (w > 0) mask[v] = w;
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

/**
 * Where stretch marks form: the skin that stretches with growth and weight, the
 * lower trunk (flanks, lumbar back and the belly's lower part), the hips and
 * buttocks, and the outer and back of the thigh; each site's weight is how much
 * of its amount shows (the density the layer's threshold takes). Left out: the
 * breasts (which have a growth of their own and are not painted here), the
 * groin, the inner thigh, and skin that faces up or down, where the marks'
 * direction (round the body, across the stretch) has no meaning.
 */
export const STRIAE_SITE_WEIGHT = { flank: 1, belly: 0.7, hip: 1, thigh: 0.8 } as const;

/**
 * The direction of the noise's waves at each vertex, three floats a vertex: across the marks, which run
 * horizontal in the skin's plane (up × normal) round the body, across the stretch; so the waves run
 * along the skin's vertical (the normal × that horizontal).
 */
function striaeDirections(assets: HumanoidAssets): {
  direction: Float32Array;
  weight: Float32Array;
} {
  const P = assets.positions;
  const n = assets.manifest.vertexCount;
  const zones = skinZones(assets);
  const onBody = bodySurface(assets);
  const trunk = zones.zone("lowerTrunk");
  const pelvis = zones.zone("pelvis");
  const thigh = zones.zone("thigh");
  const breast = zones.zone("breast");
  const hip = joint(assets, "upperleg01.L____head")[1];
  const knee = joint(assets, "lowerleg01.L____head")[1];
  const direction = new Float32Array(n * 3);
  const weight = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    if (onBody[v] !== 1) continue;
    const nx = zones.normals[v * 3] as number;
    const ny = zones.normals[v * 3 + 1] as number;
    const nz = zones.normals[v * 3 + 2] as number;
    // up × normal = (nz, 0, -nx): horizontal, in the skin's plane; short where the skin faces up or down.
    const tx = nz;
    const tz = -nx;
    const len = Math.hypot(tx, tz);
    const x = P[v * 3] as number;
    const y = P[v * 3 + 1] as number;
    const front = zones.front[v] as number;
    const facing = smoothstep(0.45, 0.75, len);
    // The belly, in front on the lower trunk; the flanks and back are the rest of it.
    const trunkWeight =
      (trunk[v] as number) *
      (STRIAE_SITE_WEIGHT.flank + (STRIAE_SITE_WEIGHT.belly - STRIAE_SITE_WEIGHT.flank) * front);
    const hipWeight = (pelvis[v] as number) * STRIAE_SITE_WEIGHT.hip;
    // Skin that faces the other leg is the inner thigh and groin's; the thigh's marks stop a half of the way to the knee.
    const inner = -Math.sign(x) * nx;
    const thighWeight =
      (thigh[v] as number) *
      STRIAE_SITE_WEIGHT.thigh *
      (1 - smoothstep(0.35, 0.6, (hip - y) / (hip - knee)));
    // Not the groin, in front, central and low.
    const groin =
      front * (1 - smoothstep(0.03, 0.06, Math.abs(x))) * (1 - smoothstep(0.05, 0.08, y));
    const w =
      Math.max(trunkWeight, hipWeight, thighWeight) *
      (1 - smoothstep(0.2, 0.6, inner)) *
      facing *
      (1 - groin) *
      // The body's UV islands meet on the midline, and the marks are drawn in UV: a mark that
      // crossed it would be cut and offset there, and the orientation measured on the seam's
      // vertices mixes the two islands' (it tilts the marks into chevrons), so they stop short of it.
      smoothstep(0.015, 0.045, Math.abs(x)) *
      (1 - smoothstep(0.2, 0.5, breast[v] as number));
    if (w <= 0 || len < 1e-6) continue;
    weight[v] = w;
    // The marks' own direction is (tx, 0, tz) / len; the waves cross them: normal × it.
    const hx = tx / len;
    const hz = tz / len;
    direction[v * 3] = ny * hz;
    direction[v * 3 + 1] = nz * hx - nx * hz;
    direction[v * 3 + 2] = -ny * hx;
  }
  return { direction, weight };
}

function striaeFields(assets: HumanoidAssets): SkinLayerFields {
  return once(assets, "striae", () => {
    const { direction, weight } = striaeDirections(assets);
    const { coord, valid } = uvOrientation(assets, direction, weight, STRIAE_ORIENTATION_SEAM);
    const mask = Float32Array.from(weight, (w, v) => (valid[v] === 1 ? w : 0));
    return { mask, coord };
  });
}

/** How deep a mark is, metres (CHOICE: atrophic, a fraction of a millimetre; none measured on the skin's surface). */
export const STRIAE_DEPTH = 0.00015;
/** How opaque a mark's colour is where it lies (CHOICE). */
export const STRIAE_OPACITY = 0.9;

/**
 * Stretch marks: clusters of long, thin, parallel spindles round the lower
 * trunk, hips and thighs, red and then silver on light skin and violet-brown
 * and then pale on deep skin, slightly sunk, as many as the figure's weight,
 * height and age make (`striaeAmount`), of the colour their age gives
 * (`striaeColour`). Drawn in the shader per pixel (`striaMark`), as the sole's
 * friction ridges are, their orientation stored in the layer's coordinate.
 */
export const STRIAE_LAYER: DetailLayer = {
  id: "striae",
  kind: "detail",
  pattern: "striae",
  targets: [],
  fields: striaeFields,
  paint: (input) => {
    const b = figureBuild(input);
    return {
      strength: STRIAE_OPACITY,
      height: STRIAE_DEPTH,
      size: STRIA_WIDTH,
      striae: {
        amount: striaeAmount(b),
        ratio: striaeColour(input.tone, striaeMaturity(b.age)),
      },
    };
  },
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
  STRIAE_LAYER,
];
