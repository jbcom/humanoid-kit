/**
 * The phallic organ, out of the phallic reservoir (docs/research/
 * ADULT-SCULPT-PLAN.md, sections 6b, 6c and 6d). Size is a blend of shapes baked
 * at several sizes (a small organ is not a scaled-down large one: the root's loop
 * is the same whatever the organ drawn from it).
 *
 * The keys of a penis take their form from a CC0 sculpt (ukiyoe's `man_genital`):
 * its shaft, glans and corona are projected onto the reservoir (`transfer.ts`), and
 * the measured numbers enter only as scale factors on that form (`form.ts`): the
 * dorsal length and the mid-shaft girth of each key, and erect growth. Arousal swings
 * the form's centreline from the sculpt's hang toward the drawn erect direction,
 * through a drawn midpoint.
 *
 * Measured: the length and girth of the default organ, flaccid and erect, and their
 * spread (docs/research/ADULT-ANATOMY-DATA.md, section F). Modelled and labelled so:
 * the erect angle and the bend over which the shaft rises to it. The clitoral key is
 * still drawn (`phallusGeometry`) until the female transfer gives it a sculpted form.
 */
import type { Skin } from "./contact.ts";
import type { Vec3 } from "./disc.ts";
import {
  type Form,
  formOf,
  type Pose,
  ringPerimeter,
  sectionPerimeter,
  solveFactor,
  sweep,
} from "./form.ts";
import { type DetailTarget, deg, shapeSum, sizeHat, targetCollector } from "./keys.ts";
import { type ReservoirRoot, type RootShape, restShape } from "./root.ts";
import type { SculptPart } from "./sculpt.ts";
import { projectPart } from "./transfer.ts";
import { smooth, tubeShape, turnAngle } from "./tube.ts";

/** The glans' share of the length of the drawn organ (Mehraban 2007: 3.04 of 11.58 cm stretched). */
export const GLANS_FRACTION = 0.26;
/** The drawn organ's coronal ridge over its shaft, tip over corona and dome over tip (modelled). */
const CORONA = 1.08;
const TIP = 0.55;
const DOME = 0.6;
/** The distance over which the root's loop narrows or widens to the shaft, metres (modelled). */
const FLARE = 0.025;
/** Where the drawn glans' ridge is reached and its taper begins, over the glans' length (modelled). */
const RIDGE_AT = 0.25;
const TAPER_FROM = 0.3;

/** The dorsal side, where the loop's reference vertex and the dorsal length are: up. */
export const DORSAL: Vec3 = [0, 1, 0];

export interface PhallusParams {
  /**
   * The length, metres. Dorsal: along the top from the root's junction (the
   * loop's highest vertex, where the literature's landmark is) to the tip. Axial:
   * along the centreline from the plane of the root, for an organ smaller than the
   * root's own footprint, whose dorsal length is the footprint's.
   */
  length: number;
  measure: "dorsal" | "axial";
  /** The shaft's radius, metres. */
  radius: number;
  /** The tangent at the tip, radians above forward (toward +y from +z). */
  angle: number;
}

/** Loop index of the root's dorsal vertex: the loop's highest. */
export const dorsalIndex = (root: ReservoirRoot): number =>
  root.loop.reduce(
    (best, p, i) =>
      p[0] * DORSAL[0] + p[1] * DORSAL[1] + p[2] * DORSAL[2] >
      (root.loop[best] as Vec3)[0] * DORSAL[0] +
        (root.loop[best] as Vec3)[1] * DORSAL[1] +
        (root.loop[best] as Vec3)[2] * DORSAL[2]
        ? i
        : best,
    0,
  );

/**
 * The dorsal length of a shape: along the top of the organ from the root's
 * junction (the loop's dorsal vertex) through each ring's to the cap's furthest
 * point from the root.
 */
export function dorsalLength(root: ReservoirRoot, shape: RootShape): number {
  const n = root.loop.length;
  const top = dorsalIndex(root);
  let prev = root.loop[top] as Vec3;
  let length = 0;
  for (let k = 1; k <= root.rings; k++) {
    const p = shape[root.cap.length + (k - 1) * n + top] as Vec3;
    length += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
    prev = p;
  }
  const c = root.centre;
  const apex = shape
    .slice(0, root.cap.length)
    .reduce(
      (best, p) =>
        Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) >
        Math.hypot(best[0] - c[0], best[1] - c[1], best[2] - c[2])
          ? p
          : best,
      prev,
    );
  return length + Math.hypot(apex[0] - prev[0], apex[1] - prev[1], apex[2] - prev[2]);
}

/**
 * The drawn organ (the clitoral key's form until the female transfer): a tube out of
 * the loop that bends toward the way it lies and closes in a rounded glans.
 */
export function phallusGeometry(
  root: ReservoirRoot,
  p: PhallusParams,
): { shape: RootShape; dorsal: number; axial: number } {
  const direction: Vec3 = [0, Math.sin(p.angle), Math.cos(p.angle)];
  const glans = GLANS_FRACTION * p.length;
  const tipRadius = TIP * CORONA * p.radius;
  const dome = DOME * tipRadius;
  const turn = turnAngle(root, direction);
  const build = (axial: number) => {
    const sulcus = axial - Math.max(glans - dome, 0);
    const profile = (s: number) => {
      const g = (s - sulcus) / (axial - sulcus);
      if (g <= 0) return p.radius;
      return (
        p.radius *
        (1 + (CORONA - 1) * smooth(g / RIDGE_AT)) *
        (1 - (1 - TIP) * smooth((g - TAPER_FROM) / (1 - TAPER_FROM)))
      );
    };
    const tube = tubeShape(root, {
      axial,
      direction,
      bend: Math.min(Math.max(1.3 * p.radius * turn, 0.02), 0.6 * axial),
      flare: Math.min(FLARE, 0.45 * axial),
      section: (s) => ({ across: profile(s), up: profile(s) }),
      tip: { across: tipRadius, up: tipRadius },
      dome,
    });
    return { tube, length: dorsalLength(root, tube.shape) };
  };
  let axial = p.length - dome;
  if (p.measure === "dorsal") {
    let lo = 0.002;
    let hi = 0.6;
    if (build(lo).length > p.length)
      throw new Error(`a phallus of ${p.length} m is shorter than its root`);
    if (build(hi).length < p.length)
      throw new Error(`a phallus of ${p.length} m is longer than allowed`);
    for (let it = 0; it < 48; it++) {
      const mid = (lo + hi) / 2;
      if (build(mid).length < p.length) lo = mid;
      else hi = mid;
    }
    axial = (lo + hi) / 2;
  }
  const done = build(axial);
  return { shape: done.tube.shape, dorsal: done.length, axial };
}

/** One size the organ is baked at; sizes in between blend two of these. */
export interface PhallusKey {
  /** The size modifier's value at which this key is exact. */
  size: number;
  /** Flaccid dorsal length and mid-shaft circumference, metres. */
  length: number;
  circumference: number;
  /** Whether the key takes the sculpt's form; a drawn key gives its hang in degrees above forward. */
  form: "sculpt" | { hang: number; measure: "dorsal" | "axial" };
  /** Whether the organ erects: a key too small to be a penis has no erect state. */
  erects: boolean;
}

/**
 * The keys. The pooled mean (flaccid 9.16 cm long, 9.31 cm round; Veale 2015) is
 * exact at its key, the largest is 3 SD above it, and the smaller ones step down to
 * a clitoral glans.
 */
export const PHALLUS_KEYS: readonly PhallusKey[] = [
  { size: 0.08, length: 0.012, circumference: 0.022, form: { hang: -45, measure: "axial" }, erects: false },
  { size: 0.25, length: 0.045, circumference: 0.06, form: "sculpt", erects: true },
  { size: 0.65, length: 0.0916, circumference: 0.0931, form: "sculpt", erects: true },
  { size: 1, length: 0.145, circumference: 0.115, form: "sculpt", erects: true },
];

/** Erect over flaccid: length 13.12 / 9.16 and circumference 11.66 / 9.31 (Veale 2015, pooled means). */
export const ERECT_LENGTH = 13.12 / 9.16;
export const ERECT_GIRTH = 11.66 / 9.31;
/** The erect tangent, degrees above forward (provisional: the literature gives no angle). */
export const ERECT_ANGLE = 30;
/** Two standard deviations of the pooled flaccid values over their mean: a full step of length and girth. */
export const LENGTH_RANGE = (2 * 1.57) / 9.16;
export const GIRTH_RANGE = (2 * 0.9) / 9.31;
/** The arclength over which a pose fades in from the loop, metres (modelled: the root's own flare). */
const ROOT_BLEND = 0.012;
/**
 * The arclength over which arousal's turn of the shaft fades in from the loop,
 * metres (modelled): wider than the shaft, so the root bends rather than kinks.
 */
const TURN_BLEND = 0.035;

/** How one key's organ is varied for a variant of it. */
export interface Variation {
  /** Length and girth multipliers, 1 for the key's own. */
  length?: number;
  girth?: number;
  /** How far along the way to erect, 0 (flaccid) to 1 (erect): length, girth and angle go that share. */
  state?: number;
}

/**
 * Where the shaft's girth is taken on a shape: halfway along the centreline from
 * ring 1 (the sculpt's cut, where the free shaft begins) to the sulcus (the
 * narrowest ring behind the corona, which is the widest of the last 40% of rings).
 * Returns the point, the centreline's tangent there, and the fractional ring it
 * falls at.
 */
export function midShaft(
  root: ReservoirRoot,
  shape: RootShape,
  /** The sulcus' index among the rings, 0-based (`sulcusIndex`); found on `shape` when not given. */
  sulcusAt?: number,
): { point: Vec3; tangent: Vec3; ring: number } {
  const R = root.rings;
  const sulcus = sulcusAt ?? sulcusIndex(root, shape);
  const n = root.loop.length;
  const centre = (k: number): Vec3 => {
    if (k === 0) return root.centre;
    const r = shape.slice(root.cap.length + (k - 1) * n, root.cap.length + k * n);
    return r.reduce<Vec3>((s, q) => [s[0] + q[0] / n, s[1] + q[1] / n, s[2] + q[2] / n], [0, 0, 0]);
  };
  const arc = [0];
  for (let k = 1; k <= R; k++) {
    const a = centre(k - 1);
    const b = centre(k);
    arc.push((arc[k - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  // `sulcus` indexes ring sulcus + 1.
  const half = ((arc[sulcus + 1] as number) + (arc[1] as number)) / 2;
  let k = 1;
  while (k + 1 < R && (arc[k + 1] as number) < half) k++;
  const a0 = arc[k] as number;
  const a1 = arc[k + 1] as number;
  const t = a1 > a0 ? (half - a0) / (a1 - a0) : 0;
  const c0 = centre(k);
  const c1 = centre(k + 1);
  const d: Vec3 = [c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]];
  const dl = Math.hypot(...d);
  return {
    point: [c0[0] + d[0] * t, c0[1] + d[1] * t, c0[2] + d[2] * t],
    tangent: [d[0] / dl, d[1] / dl, d[2] / dl],
    ring: k + t,
  };
}

/**
 * The sulcus' index among a shape's rings, 0-based: the narrowest ring behind the
 * corona, which is the widest of the last 40% of rings.
 */
export function sulcusIndex(root: ReservoirRoot, shape: RootShape): number {
  const R = root.rings;
  const p = Array.from({ length: R }, (_, k) => ringPerimeter(root, shape, k + 1));
  const from = Math.floor(0.6 * R);
  let corona = from;
  for (let k = from; k < R; k++) if ((p[k] as number) > (p[corona] as number)) corona = k;
  let sulcus = Math.floor(0.4 * R);
  for (let k = sulcus; k < corona; k++) if ((p[k] as number) < (p[sulcus] as number)) sulcus = k;
  return sulcus;
}

/** The girth at mid-shaft: the length round the wall across the centreline there. */
export function midShaftGirth(root: ReservoirRoot, shape: RootShape, sulcusAt?: number): number {
  const m = midShaft(root, shape, sulcusAt);
  const ring = Math.round(m.ring);
  // The rings are oblique to the shaft, so the plane crosses many of them: take the
  // whole wall, within a reach of a few radii so the wall elsewhere is not counted.
  const radius = ringPerimeter(root, shape, Math.max(1, Math.min(root.rings, ring))) / (2 * Math.PI);
  return sectionPerimeter(root, shape, m.point, m.tangent, 0, root.rings, 2 * radius);
}

/** The organ's sculpted form on this root, and each sculpted key's shapes. */
export class SculptedPhallus {
  readonly root: ReservoirRoot;
  /** The sculpt projected onto the reservoir, before any scaling: the flaccid form as sculpted. */
  readonly projected: RootShape;
  readonly form: Form;
  /** The sculpt's sulcus among the rings (`sulcusIndex`): a landmark of the form, the same in every pose. */
  readonly sulcus: number;
  private readonly scales = new Map<string, { length: number; girth: number }>();
  private readonly skin: Skin;

  /** `skin`: the lattice round the reservoirs (`contact.ts`), which the organ rests on. */
  constructor(root: ReservoirRoot, part: SculptPart, skin: Skin) {
    this.root = root;
    this.skin = skin;
    this.projected = projectPart(root, part, { reference: DORSAL });
    this.form = formOf(root, this.projected, DORSAL);
    this.sulcus = sulcusIndex(root, this.projected);
  }

  /** The girth at mid-shaft of a shape of this form, about its own sulcus. */
  girthOf(shape: RootShape): number {
    return midShaftGirth(this.root, shape, this.sulcus);
  }

  /** The erect centreline's direction at a share of the arclength: drawn, turning from the root's normal. */
  private erectDirection(share: number, total: number, girth: number): Vec3 {
    const n = this.root.normal;
    const d: Vec3 = [0, Math.sin(deg(ERECT_ANGLE)), Math.cos(deg(ERECT_ANGLE))];
    const delta = turnAngle(this.root, d);
    const axisRaw: Vec3 = [n[1] * d[2] - n[2] * d[1], n[2] * d[0] - n[0] * d[2], n[0] * d[1] - n[1] * d[0]];
    const al = Math.hypot(...axisRaw);
    const axis: Vec3 = al > 1e-9 ? [axisRaw[0] / al, axisRaw[1] / al, axisRaw[2] / al] : [1, 0, 0];
    const radius = girth / (2 * Math.PI);
    const bend = Math.min(Math.max(1.3 * radius * delta, 0.02), 0.6 * total);
    const angle = delta * smooth((share * total) / bend);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const kv = axis[0] * n[0] + axis[1] * n[1] + axis[2] * n[2];
    const kx: Vec3 = [axis[1] * n[2] - axis[2] * n[1], axis[2] * n[0] - axis[0] * n[2], axis[0] * n[1] - axis[1] * n[0]];
    return [0, 1, 2].map(
      (i) => (n[i] as number) * c + (kx[i] as number) * s + (axis[i] as number) * kv * (1 - c),
    ) as unknown as Vec3;
  }

  /** The pose of the form at factors on its sculpted length and girth, in a state. */
  private pose(length: number, girth: number, state: number, circumference: number): Pose {
    const total = this.form.lengths.reduce((s, l) => s + l, 0) * length;
    return {
      blend: ROOT_BLEND,
      turnBlend: TURN_BLEND,
      length,
      across: girth,
      up: girth,
      ...(state > 0 && {
        direction: (own: Vec3, share: number) => {
          const erect = this.erectDirection(share, total, circumference);
          const c = Math.min(1, Math.max(-1, own[0] * erect[0] + own[1] * erect[1] + own[2] * erect[2]));
          const angle = Math.acos(c);
          if (angle < 1e-9) return own;
          const k = Math.sin(angle);
          const a = Math.sin((1 - state) * angle) / k;
          const b = Math.sin(state * angle) / k;
          return [own[0] * a + erect[0] * b, own[1] * a + erect[1] * b, own[2] * a + erect[2] * b];
        },
      }),
    };
  }

  /**
   * The factors on the sculpt's length and girth that give a dorsal length and a
   * mid-shaft girth in a state: measured on the shape as the literature measures them.
   */
  scalesFor(dorsal: number, circumference: number, state: number): { length: number; girth: number } {
    const id = `${dorsal}:${circumference}:${state}`;
    const known = this.scales.get(id);
    if (known) return known;
    // Each factor in turn with the other held, until both hold: the dorsal length moves
    // a little with the girth (the glans' dome), the girth's place with the length.
    let girth = circumference / this.girthOf(this.projected);
    let length = 1;
    for (let pass = 0; pass < 8; pass++) {
      girth = solveFactor(
        (f) => this.girthOf(sweep(this.form, this.pose(length, f, state, circumference))),
        circumference,
        girth,
      );
      length = solveFactor(
        (f) => dorsalLength(this.root, sweep(this.form, this.pose(f, girth, state, circumference))),
        dorsal,
        length,
      );
      const shape = sweep(this.form, this.pose(length, girth, state, circumference));
      if (Math.abs(this.girthOf(shape) / circumference - 1) < 1e-5) break;
    }
    const out = { length, girth };
    this.scales.set(id, out);
    return out;
  }

  /** The dorsal length and mid-shaft girth a key has with a variation, as measured. */
  static measures(key: PhallusKey, v: Variation = {}): { dorsal: number; circumference: number } {
    const state = v.state ?? 0;
    return {
      dorsal: key.length * (v.length ?? 1) * (1 + state * (ERECT_LENGTH - 1)),
      circumference: key.circumference * (v.girth ?? 1) * (1 + state * (ERECT_GIRTH - 1)),
    };
  }

  /** The shape of a sculpted key with a variation applied. */
  shape(key: PhallusKey, v: Variation = {}): RootShape {
    const state = v.state ?? 0;
    const want = SculptedPhallus.measures(key, v);
    const s = this.scalesFor(want.dorsal, want.circumference, state);
    return this.skin.rest(
      this.root,
      sweep(this.form, this.pose(s.length, s.girth, state, want.circumference)),
    );
  }
}

/** The shape of key `key` with a variation applied: sculpted, or drawn for the clitoral key. */
export function keyShape(
  organ: SculptedPhallus,
  key: PhallusKey,
  v: Variation = {},
): RootShape {
  if (key.form === "sculpt") return organ.shape(key, v);
  const s = v.state ?? 0;
  const length = key.length * (v.length ?? 1);
  const girth = key.circumference * (v.girth ?? 1);
  return phallusGeometry(organ.root, {
    length: length * (1 + s * (ERECT_LENGTH - 1)),
    measure: key.form.measure,
    radius: (girth * (1 + s * (ERECT_GIRTH - 1))) / (2 * Math.PI),
    angle: deg(key.form.hang + s * (ERECT_ANGLE - key.form.hang)),
  }).shape;
}

/**
 * The states between flaccid and erect the organ is drawn at, and the target-name
 * suffix of each. A morph moves a vertex in a straight line, so a shaft that swings from
 * hanging to rising would shorten on the way between two states; drawn at each quarter
 * of the way it swings through them, and the blend between each pair is short enough
 * that the shaft keeps lengthening.
 */
export const STATES: readonly { name: string; state: number }[] = [
  { name: "rising", state: 0.25 },
  { name: "mid", state: 0.5 },
  { name: "lifted", state: 0.75 },
  { name: "erect", state: 1 },
];

export type PhallusTarget = DetailTarget;

/** The modifiers' ids. */
export const PHALLUS_SIZE = "genitals/phallus-size";
export const PHALLUS_LENGTH = "genitals/phallus-length-decr|incr";
export const PHALLUS_GIRTH = "genitals/phallus-girth-decr|incr";

/** The targets' names for key number `n` (1-based), a part (base, length-incr…) and a state (none: flaccid). */
export const keyTarget = (n: number, part: string, state?: string) =>
  `genitals/phallus-k${n}-${part}${state ? `-${state}` : ""}`;

/**
 * Every target of the organ and its weight, as `drives` factor lists: a key's
 * base shape worth its hat of the size, its length and girth variations worth
 * the modifier's two sides times the hat; and for each state the organ erects
 * through, the shape's difference from flaccid, and that of each variation, worth
 * the hat of the arousal signal for that state times the same factors.
 */
export function phallusTargets(
  root: ReservoirRoot,
  part: SculptPart,
  skin: Skin,
): {
  targets: PhallusTarget[];
  drives: Record<string, string[]>;
} {
  const organ = new SculptedPhallus(root, part, skin);
  const rest = restShape(root);
  const { targets, drives, add } = targetCollector(root);
  const sizes = PHALLUS_KEYS.map((k) => k.size);
  PHALLUS_KEYS.forEach((key, k) => {
    const n = k + 1;
    const hat = sizeHat(PHALLUS_SIZE, sizes, k);
    const flaccid = keyShape(organ, key);
    add(keyTarget(n, "base"), rest, flaccid, [hat]);
    for (const [part, mod, mul] of [
      ["length", PHALLUS_LENGTH, "length"],
      ["girth", PHALLUS_GIRTH, "girth"],
    ] as const) {
      const range = mul === "length" ? LENGTH_RANGE : GIRTH_RANGE;
      const up = { [mul]: 1 + range } as Variation;
      const down = { [mul]: 1 - range } as Variation;
      add(keyTarget(n, `${part}-incr`), flaccid, keyShape(organ, key, up), [`mod:${mod}`, hat]);
      add(keyTarget(n, `${part}-decr`), flaccid, keyShape(organ, key, down), [`mod-:${mod}`, hat]);
      if (!key.erects) continue;
      // In a state the length and girth change by more than the flaccid ones do (the share they
      // grow by), and in another direction: the variation's own target is the difference.
      for (const { name, state } of STATES) {
        const arousal = arousalHat(name);
        const shaped = keyShape(organ, key, { state });
        for (const [side, v, sign] of [
          ["incr", up, "mod"],
          ["decr", down, "mod-"],
        ] as const) {
          add(
            keyTarget(n, `${part}-${side}`, name),
            shapeSum(root, shaped, flaccid, keyShape(organ, key, v)),
            keyShape(organ, key, { ...v, state }),
            [`${sign}:${mod}`, arousal, hat],
          );
        }
      }
    }
    if (key.erects)
      for (const { name, state } of STATES)
        add(keyTarget(n, "base", name), flaccid, keyShape(organ, key, { state }), [
          arousalHat(name),
          hat,
        ]);
  });
  return { targets, drives };
}

/** The factor that is 1 at a state of the signal and falls to 0 at the states either side of it. */
function arousalHat(name: string): string {
  const at = STATES.findIndex((s) => s.name === name);
  const here = (STATES[at] as { state: number }).state;
  const before = at === 0 ? 0 : (STATES[at - 1] as { state: number }).state;
  const after = STATES[at + 1]?.state;
  const points = [`${before},0`, `${here},1`, ...(after === undefined ? [] : [`${after},0`])];
  return `sramp:arousal:${points.join(";")}`;
}
