/**
 * The phallic organ, out of the phallic reservoir (docs/research/
 * ADULT-SCULPT-PLAN.md, sections 6b, 6c and 6d). Size is a blend of shapes baked
 * at several sizes (a small organ is not a scaled-down large one: the root's loop
 * is the same whatever the organ drawn from it).
 *
 * The keys of a penis take their form from two CC0 sculpts, both projected onto the
 * reservoir (`transfer.ts`): the flaccid shaft, glans and corona of ieroglif's
 * `adult_male_genitalia_breast_fix`, and the erect ones of Slayer227's
 * `Male_Gen-Heal1`. Nothing reshapes them: a key is a sculpt scaled along its own
 * centreline and across it, each factor the key's measured dorsal length or
 * mid-shaft girth over the sculpt's own, and arousal goes from the flaccid sculpt to
 * the erect one along their centrelines (`blendForms`), at the length and girth the
 * literature gives for that share of the way. A small organ is not a large one
 * shrunk evenly (its girth is a larger share of its length), so one factor would
 * not do. The measurements label the sculpts; nothing is fitted on the drawn shape.
 *
 * Measured: the length and girth of the default organ, flaccid and erect, and their
 * spread (docs/research/ADULT-ANATOMY-DATA.md, section F). The clitoral key is still
 * drawn (`phallusGeometry`) until the female transfer gives it a sculpted form.
 */
import type { Skin } from "./contact.ts";
import type { Vec3 } from "./disc.ts";
import {
  blendForms,
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

/** Alternations of the length and girth factors a key's size is found in (`SculptedPhallus.scalesFor`). */
const SIZE_PASSES = 8;

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
 * The dorsal length of a shape: along the top of the organ from where it leaves the
 * skin (the skin line's dorsal vertex) through each ring's to the cap's furthest
 * point from the root.
 */
export function dorsalLength(root: ReservoirRoot, shape: RootShape): number {
  const n = root.loop.length;
  const top = dorsalIndex(root);
  // From the skin line (ring 1, `transfer.ts`, `skinLine`): the band from the loop to it
  // is the body's skin, not the organ's.
  let prev = shape[root.cap.length + top] as Vec3;
  let length = 0;
  for (let k = 2; k <= root.rings; k++) {
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
  {
    size: 0.08,
    length: 0.012,
    circumference: 0.022,
    form: { hang: -45, measure: "axial" },
    erects: false,
  },
  { size: 0.25, length: 0.045, circumference: 0.06, form: "sculpt", erects: true },
  { size: 0.65, length: 0.0916, circumference: 0.0931, form: "sculpt", erects: true },
  { size: 1, length: 0.145, circumference: 0.115, form: "sculpt", erects: true },
];

/** Erect over flaccid: length 13.12 / 9.16 and circumference 11.66 / 9.31 (Veale 2015, pooled means). */
export const ERECT_LENGTH = 13.12 / 9.16;
export const ERECT_GIRTH = 11.66 / 9.31;
/** Two standard deviations of the pooled flaccid values over their mean: a full step of length and girth. */
export const LENGTH_RANGE = (2 * 1.57) / 9.16;
export const GIRTH_RANGE = (2 * 0.9) / 9.31;
/**
 * The arclength over which a pose fades in from the loop, metres, for the
 * default key (modelled: the root's own flare). A shorter organ's root flare is
 * shorter in proportion (`rootBlend`): a fixed one held the first 1.2 cm at
 * the sculpt's length and put a floor of about 3 cm under every size.
 */
const ROOT_BLEND = 0.012;
/** The dorsal length the root blend is drawn for: the default key's, Veale's pooled flaccid mean. */
const ROOT_BLEND_AT = 0.0916;

/** The root flare for an organ of dorsal length `dorsal`: in proportion, never wider than the default's. */
export function rootBlend(dorsal: number): number {
  return ROOT_BLEND * Math.min(1, dorsal / ROOT_BLEND_AT);
}

/** How one key's organ is varied for a variant of it. */
export interface Variation {
  /** Length and girth multipliers, 1 for the key's own. */
  length?: number;
  girth?: number;
  /** How far along the way from the flaccid sculpt to the erect one, 0 to 1. */
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
  // whole wall, within a reach of a few radii so the wall elsewhere is not counted. The
  // wall starts at the skin line (ring 1): the band inside the loop is the body's skin,
  // which a short, narrowed organ's middle can come within reach of.
  const radius =
    ringPerimeter(root, shape, Math.max(1, Math.min(root.rings, ring))) / (2 * Math.PI);
  return sectionPerimeter(root, shape, m.point, m.tangent, 1, root.rings, 2 * radius);
}

/** The dorsal length at a share of the way to erect, over the flaccid one. */
export const stateLength = (state: number): number => 1 + state * (ERECT_LENGTH - 1);

/** The organ's two sculpted forms on this root, flaccid and erect, and each sculpted key's shapes. */
export class SculptedPhallus {
  readonly root: ReservoirRoot;
  /** Each sculpt projected onto the reservoir, before any scaling: the forms as sculpted. */
  readonly flaccid: RootShape;
  readonly erect: RootShape;
  private readonly forms: { flaccid: Form; erect: Form };
  /** Each sculpt's dorsal length and mid-shaft girth on the reservoir, as sculpted. */
  private readonly measured: Record<"flaccid" | "erect", { dorsal: number; girth: number }>;
  private readonly skin: Skin;
  /** The factors found for each dorsal length, girth and state (`scalesFor`). */
  private readonly scales = new Map<string, { length: number; girth: number }>();

  /** `skin`: the lattice round the reservoirs (`contact.ts`), which the organ rests on. */
  constructor(root: ReservoirRoot, parts: { flaccid: SculptPart; erect: SculptPart }, skin: Skin) {
    this.root = root;
    this.skin = skin;
    this.flaccid = projectPart(root, parts.flaccid, { reference: DORSAL, skin });
    this.erect = projectPart(root, parts.erect, { reference: DORSAL, skin });
    this.forms = {
      flaccid: formOf(root, this.flaccid, DORSAL),
      erect: formOf(root, this.erect, DORSAL),
    };
    const measure = (shape: RootShape) => ({
      dorsal: dorsalLength(root, shape),
      girth: this.girthOf(shape),
    });
    this.measured = { flaccid: measure(this.flaccid), erect: measure(this.erect) };
  }

  /** The form share `state` of the way from the flaccid sculpt to the erect one. */
  formAt(state: number): Form {
    return blendForms(this.forms.flaccid, this.forms.erect, state);
  }

  /** The girth at mid-shaft of a shape of this organ. */
  girthOf(shape: RootShape): number {
    return midShaftGirth(this.root, shape);
  }

  /**
   * The form at a state with factors on its length and girth, resting on the skin,
   * for an organ whose flaccid dorsal length is `flaccid`: its root flare's size, the
   * same in every state, so arousal does not move the root.
   */
  private drawn(state: number, length: number, girth: number, flaccid: number): RootShape {
    const pose: Pose = {
      blend: rootBlend(flaccid),
      length,
      across: girth,
      up: girth,
      rootFollows: true,
    };
    return this.skin.rest(this.root, sweep(this.formAt(state), pose));
  }

  /**
   * The form at a state as sculpted, before any scaling: its dorsal length and
   * mid-shaft girth, each sculpt's measured on its own shape and between them in
   * proportion, as the blended segments and offsets are.
   */
  sculpted(state: number): { dorsal: number; girth: number } {
    const { flaccid, erect } = this.measured;
    return {
      dorsal: flaccid.dorsal + (erect.dorsal - flaccid.dorsal) * state,
      girth: flaccid.girth + (erect.girth - flaccid.girth) * state,
    };
  }

  /**
   * The factors along the form's centreline and across it that give a dorsal length
   * and a mid-shaft girth at a state, measured on the shape as drawn (resting on the
   * skin, which can move it) as the literature measures an organ: from the skin line
   * to the tip, round the middle of the shaft. Each factor is found in turn with the
   * other held, until both hold: the length moves a little with the girth (the glans'
   * dome), the girth's place with the length. Taken as the measurement over the
   * sculpt's own, a key fell short of its label by up to 14 %, as the root's fade
   * leaves its first rings unscaled.
   */
  scalesFor(
    dorsal: number,
    circumference: number,
    state: number,
  ): { length: number; girth: number } {
    const id = `${dorsal}:${circumference}:${state}`;
    const known = this.scales.get(id);
    if (known) return known;
    const flaccid = dorsal / stateLength(state);
    const drawn = (l: number, g: number) => this.drawn(state, l, g, flaccid);
    const own = this.sculpted(state);
    let length = dorsal / own.dorsal;
    let girth = circumference / own.girth;
    for (let pass = 0; pass < SIZE_PASSES; pass++) {
      girth = solveFactor((f) => this.girthOf(drawn(length, f)), circumference, girth);
      length = solveFactor((f) => dorsalLength(this.root, drawn(f, girth)), dorsal, length);
      if (Math.abs(this.girthOf(drawn(length, girth)) / circumference - 1) < 1e-5) break;
    }
    const out = { length, girth };
    this.scales.set(id, out);
    return out;
  }

  /** The dorsal length and mid-shaft girth a key has with a variation, as measured. */
  static measures(key: PhallusKey, v: Variation = {}): { dorsal: number; circumference: number } {
    const state = v.state ?? 0;
    return {
      dorsal: key.length * (v.length ?? 1) * stateLength(state),
      circumference: key.circumference * (v.girth ?? 1) * (1 + state * (ERECT_GIRTH - 1)),
    };
  }

  /** The shape of a sculpted key with a variation applied. */
  shape(key: PhallusKey, v: Variation = {}): RootShape {
    const state = v.state ?? 0;
    const want = SculptedPhallus.measures(key, v);
    const s = this.scalesFor(want.dorsal, want.circumference, state);
    return this.drawn(state, s.length, s.girth, want.dorsal / stateLength(state));
  }
}

/** The shape of key `key` with a variation applied: sculpted, or drawn for the clitoral key, which does not erect. */
export function keyShape(organ: SculptedPhallus, key: PhallusKey, v: Variation = {}): RootShape {
  if (key.form === "sculpt") return organ.shape(key, v);
  if (v.state) throw new Error(`phallus key ${key.size}: a drawn key has no erect state`);
  return phallusGeometry(organ.root, {
    length: key.length * (v.length ?? 1),
    measure: key.form.measure,
    radius: (key.circumference * (v.girth ?? 1)) / (2 * Math.PI),
    angle: deg(key.form.hang),
  }).shape;
}

/**
 * The states between flaccid and erect the organ is drawn at, and the target-name
 * suffix of each. A morph moves a vertex in a straight line, so a shaft that swings from
 * the flaccid sculpt's hang to the erect sculpt's rise would shorten on the way between
 * two states; blended at each quarter of the way (`blendForms`), it swings through
 * them, and the morph between each pair is short enough that the shaft keeps lengthening.
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
  parts: { flaccid: SculptPart; erect: SculptPart },
  skin: Skin,
): {
  targets: PhallusTarget[];
  drives: Record<string, string[]>;
} {
  const organ = new SculptedPhallus(root, parts, skin);
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
