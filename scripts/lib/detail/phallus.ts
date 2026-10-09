/**
 * The phallic organ, drawn out of the phallic reservoir (docs/research/
 * ADULT-SCULPT-PLAN.md, sections 6b and 6c): a tube whose rings leave the
 * reservoir's loop on the skin, bend from the skin's normal toward the way the
 * organ lies, and close in a rounded glans on the cap. One construction covers a
 * clitoral glans to a large penis; what differs is the numbers, so size is a
 * blend of shapes baked at several sizes (a small organ is not a scaled-down
 * large one: the root's loop is 1.3 cm in radius whatever the organ drawn from it).
 *
 * Measured: the length and girth of the default organ, flaccid and erect, and
 * their spread (docs/research/ADULT-ANATOMY-DATA.md, section F). Modelled and
 * labelled so: the glans (its share of the length, its coronal ridge, its
 * taper), the hang and erect angles, the bend and the flare at the root.
 *
 * Everything here is authored by us from those numbers and the reservoir's
 * geometry. No third-party mesh, texture or target is read, traced or copied;
 * the only inputs are the base body's own loop and the figures cited above.
 */
import type { Vec3 } from "./disc.ts";
import { type ReservoirRoot, type RootShape, restShape, shapeDifference } from "./root.ts";

/** Smootherstep, 0 to 1 over 0 to 1 and clamped outside. */
const smooth = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** The glans' share of the length (corona to tip over the whole; Mehraban 2007: 3.04 of 11.58 cm stretched). */
export const GLANS_FRACTION = 0.26;
/** The coronal ridge's radius over the shaft's (modelled). */
const CORONA = 1.08;
/** The tip ring's radius over the corona's (modelled). */
const TIP = 0.55;
/** The dome's height over the tip ring's radius (modelled). */
const DOME = 0.6;
/** The distance over which the root's loop narrows or widens to the shaft, metres (modelled). */
const FLARE = 0.025;
/** Where the glans' ridge is reached and the taper begins, over the glans' length (modelled). */
const RIDGE_AT = 0.25;
const TAPER_FROM = 0.3;
/** Samples of the centreline. */
const STEPS = 400;

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

const unit = (a: number, b: number): Vec3 => [0, a, b];

/**
 * The shape of the organ for these parameters on this root: a position for
 * every vertex a target of the root may move (`RootShape`), with the dorsal
 * length the shape has and the length of its centreline.
 */
export function phallusGeometry(
  root: ReservoirRoot,
  p: PhallusParams,
): { shape: RootShape; dorsal: number; axial: number } {
  const [, ny, nz] = root.normal;
  if (Math.abs(root.normal[0]) > 1e-3) throw new Error("the phallic root's normal is not sagittal");
  const phiN = Math.atan2(ny, nz);
  // The loop in the plane of the root: across (x) and up the skin (toward the dorsal side).
  const eN = unit(Math.cos(phiN), -Math.sin(phiN));
  const polar = (q: Vec3) => {
    const o = [q[0] - root.centre[0], q[1] - root.centre[1], q[2] - root.centre[2]];
    const across = o[0] as number;
    const up = (o[1] as number) * eN[1] + (o[2] as number) * eN[2];
    return { across, up, radius: Math.hypot(across, up), angle: Math.atan2(up, across) };
  };
  const loop = root.loop.map(polar);
  const dorsal = loop.reduce(
    (best, l, i) => (l.up > (loop[best] as { up: number }).up ? i : best),
    0,
  );
  // The loop's radius at an angle, for the cap's polar map.
  const byAngle = loop
    .map((l) => ({ angle: l.angle, radius: l.radius }))
    .sort((a, b) => a.angle - b.angle);
  const loopRadiusAt = (angle: number) => {
    const n = byAngle.length;
    let hi = byAngle.findIndex((l) => l.angle >= angle);
    if (hi < 0) hi = 0;
    const lo = (hi + n - 1) % n;
    const a = byAngle[lo] as { angle: number; radius: number };
    const b = byAngle[hi] as { angle: number; radius: number };
    let span = b.angle - a.angle;
    let off = angle - a.angle;
    if (span <= 0) span += 2 * Math.PI;
    if (off < 0) off += 2 * Math.PI;
    return a.radius + (b.radius - a.radius) * (span > 0 ? Math.min(1, off / span) : 0);
  };

  // The glans is a share of the length drawn; an axial length is already that of the free organ.
  const glans = GLANS_FRACTION * p.length;
  const tipRadius = TIP * CORONA * p.radius;
  const dome = DOME * tipRadius;

  const build = (axial: number) => {
    const bend = Math.min(Math.max(1.3 * p.radius * Math.abs(p.angle - phiN), 0.02), 0.6 * axial);
    const flare = Math.min(FLARE, 0.45 * axial);
    const ds = axial / STEPS;
    const y = new Float64Array(STEPS + 1);
    const z = new Float64Array(STEPS + 1);
    const phi = (s: number) => phiN + (p.angle - phiN) * smooth(s / bend);
    for (let k = 1; k <= STEPS; k++) {
      const mid = phi((k - 0.5) * ds);
      y[k] = (y[k - 1] as number) + Math.sin(mid) * ds;
      z[k] = (z[k - 1] as number) + Math.cos(mid) * ds;
    }
    const centreAt = (s: number) => {
      const f = Math.min(STEPS, Math.max(0, s / ds));
      const k = Math.min(STEPS - 1, Math.floor(f));
      const t = f - k;
      return {
        y: root.centre[1] + (y[k] as number) * (1 - t) + (y[k + 1] as number) * t,
        z: root.centre[2] + (z[k] as number) * (1 - t) + (z[k + 1] as number) * t,
      };
    };
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
    const ring = (j: number): Vec3[] => {
      const s = (axial * j) / root.rings;
      const c = centreAt(s);
      const a = phi(s);
      const w = smooth(s / flare);
      return loop.map((l) => {
        const r = l.radius + (profile(s) - l.radius) * w;
        const cu = Math.cos(l.angle);
        const su = Math.sin(l.angle);
        return [
          root.centre[0] + r * cu,
          c.y + r * su * Math.cos(a),
          c.z - r * su * Math.sin(a),
        ] as Vec3;
      });
    };
    const rings = Array.from({ length: root.rings }, (_, k) => ring(k + 1));
    const tip = centreAt(axial);
    const aEnd = phi(axial);
    const cap = root.cap.map(({ position }) => {
      const q = polar(position);
      const sigma = Math.min(1, q.radius / loopRadiusAt(q.angle));
      const r = sigma * tipRadius;
      const height = dome * Math.sqrt(1 - sigma * sigma);
      return [
        root.centre[0] + r * Math.cos(q.angle),
        tip.y + r * Math.sin(q.angle) * Math.cos(aEnd) + height * Math.sin(aEnd),
        tip.z - r * Math.sin(q.angle) * Math.sin(aEnd) + height * Math.cos(aEnd),
      ] as Vec3;
    });
    const apex: Vec3 = [
      root.centre[0],
      tip.y + dome * Math.sin(aEnd),
      tip.z + dome * Math.cos(aEnd),
    ];
    // The dorsal length: along the top of the organ from the root's junction to the apex.
    let length = 0;
    let prev: Vec3 = root.loop[dorsal] as Vec3;
    for (const r of [...rings.map((v) => v[dorsal] as Vec3), apex]) {
      length += Math.hypot(r[0] - prev[0], r[1] - prev[1], r[2] - prev[2]);
      prev = r;
    }
    return { rings, cap, length };
  };

  // The centreline's length that makes the dorsal length asked for (an axial one is the centreline's).
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
  return { shape: [...done.cap, ...done.rings.flat()], dorsal: done.length, axial };
}

/** The shape alone (`phallusGeometry`). */
export const phallusShape = (root: ReservoirRoot, p: PhallusParams): RootShape =>
  phallusGeometry(root, p).shape;

/** One size the organ is baked at; sizes in between blend two of these. */
export interface PhallusKey {
  /** The size modifier's value at which this key is exact. */
  size: number;
  /** Flaccid dorsal length and circumference at the shaft, metres. */
  length: number;
  circumference: number;
  /** The flaccid hang, degrees above forward. */
  hang: number;
  /** How `length` is measured (`PhallusParams.measure`). */
  measure: "dorsal" | "axial";
  /** Whether the organ erects: a key too small to be a penis has no erect state. */
  erects: boolean;
}

/**
 * The keys. The middle two bracket the default organ (flaccid 9.16 cm long and 9.31 cm
 * round; Veale 2015), the largest is 3 SD above it, the smaller ones step down to
 * a clitoral glans. Lengths and girths between are interpolated by the blend, so
 * the measured values are exact at the key whose size they are.
 */
export const PHALLUS_KEYS: readonly PhallusKey[] = [
  { size: 0.08, length: 0.012, measure: "axial", circumference: 0.022, hang: -45, erects: false },
  { size: 0.25, length: 0.045, measure: "dorsal", circumference: 0.06, hang: -55, erects: true },
  { size: 0.65, length: 0.0916, measure: "dorsal", circumference: 0.0931, hang: -70, erects: true },
  { size: 1, length: 0.145, measure: "dorsal", circumference: 0.115, hang: -75, erects: true },
];

/** Erect over flaccid: length 13.12 / 9.16 and circumference 11.66 / 9.31 (Veale 2015, pooled means). */
export const ERECT_LENGTH = 13.12 / 9.16;
export const ERECT_GIRTH = 11.66 / 9.31;
/** The erect tangent, degrees above forward (provisional: the literature gives no angle). */
export const ERECT_ANGLE = 30;
/**
 * What a full step of the length and girth modifiers is: two standard deviations
 * of the pooled flaccid values, as a share of their mean (SD 1.57 of 9.16 cm,
 * 0.90 of 9.31 cm).
 */
export const LENGTH_RANGE = (2 * 1.57) / 9.16;
export const GIRTH_RANGE = (2 * 0.9) / 9.31;

/** How one key's organ is varied for a variant of it. */
export interface Variation {
  /** Length and girth multipliers, 1 for the key's own. */
  length?: number;
  girth?: number;
  /**
   * How far along the way to erect, 0 (flaccid) to 1 (erect): length, girth and
   * the angle of the tip all go that share of the way.
   */
  state?: number;
}

const deg = (d: number) => (d * Math.PI) / 180;

/** The shape of key `key` with a variation applied. */
export function keyShape(root: ReservoirRoot, key: PhallusKey, v: Variation = {}): RootShape {
  const s = v.state ?? 0;
  const length = key.length * (v.length ?? 1);
  const girth = key.circumference * (v.girth ?? 1);
  return phallusShape(root, {
    length: length * (1 + s * (ERECT_LENGTH - 1)),
    measure: key.measure,
    radius: (girth * (1 + s * (ERECT_GIRTH - 1))) / (2 * Math.PI),
    angle: deg(key.hang + s * (ERECT_ANGLE - key.hang)),
  });
}

/**
 * The states between flaccid and erect the organ is drawn at, and the target-name
 * suffix of each. A morph moves a vertex in a straight line, so a tube that swings from
 * hanging to rising would shorten on the way between the two; drawn at the midpoint too
 * it swings through it, and the blend between each pair is short enough to stay a tube.
 */
export const STATES: readonly { name: string; state: number }[] = [
  { name: "mid", state: 0.5 },
  { name: "erect", state: 1 },
];

export interface PhallusTarget {
  name: string;
  indices: number[];
  xyz: number[];
}

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
export function phallusTargets(root: ReservoirRoot): {
  targets: PhallusTarget[];
  drives: Record<string, string[]>;
} {
  const rest = restShape(root);
  const targets: PhallusTarget[] = [];
  const drives: Record<string, string[]> = {};
  const add = (name: string, from: RootShape, to: RootShape, factors: string[]) => {
    targets.push({ name, ...shapeDifference(root, from, to) });
    drives[name] = factors;
  };
  const sizes = PHALLUS_KEYS.map((k) => k.size);
  PHALLUS_KEYS.forEach((key, k) => {
    const n = k + 1;
    const before = sizes[k - 1];
    const after = sizes[k + 1];
    // The hat of the size: up from the key before to this one, down to the key after (or held).
    const points = [
      ...(before === undefined ? [`0,0`] : [`${before},0`]),
      `${key.size},1`,
      ...(after === undefined ? [] : [`${after},0`]),
    ];
    const hat = `ramp:${PHALLUS_SIZE}:${points.join(";")}`;
    const flaccid = keyShape(root, key);
    add(keyTarget(n, "base"), rest, flaccid, [hat]);
    for (const [part, mod, mul] of [
      ["length", PHALLUS_LENGTH, "length"],
      ["girth", PHALLUS_GIRTH, "girth"],
    ] as const) {
      const range = mul === "length" ? LENGTH_RANGE : GIRTH_RANGE;
      const up = { [mul]: 1 + range } as Variation;
      const down = { [mul]: 1 - range } as Variation;
      add(keyTarget(n, `${part}-incr`), flaccid, keyShape(root, key, up), [`mod:${mod}`, hat]);
      add(keyTarget(n, `${part}-decr`), flaccid, keyShape(root, key, down), [`mod-:${mod}`, hat]);
      if (!key.erects) continue;
      // In a state the length and girth change by more than the flaccid ones do (the share they
      // grow by), and in another direction: the variation's own target is the difference.
      for (const { name, state } of STATES) {
        const arousal = arousalHat(name);
        const shaped = keyShape(root, key, { state });
        for (const [side, v, sign] of [
          ["incr", up, "mod"],
          ["decr", down, "mod-"],
        ] as const) {
          add(
            keyTarget(n, `${part}-${side}`, name),
            shapeSum(root, shaped, flaccid, keyShape(root, key, v)),
            keyShape(root, key, { ...v, state }),
            [`${sign}:${mod}`, arousal, hat],
          );
        }
      }
    }
    if (key.erects)
      for (const { name, state } of STATES)
        add(keyTarget(n, "base", name), flaccid, keyShape(root, key, { state }), [
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

/** a + (c - b) for shapes: `a` moved by what takes `b` to `c`. */
function shapeSum(root: ReservoirRoot, a: RootShape, b: RootShape, c: RootShape): RootShape {
  if (a.length !== b.length || b.length !== c.length)
    throw new Error(`reservoir ${root.id}: shapes of different sizes`);
  return a.map((p, i) => {
    const q = b[i] as Vec3;
    const r = c[i] as Vec3;
    return [p[0] + r[0] - q[0], p[1] + r[1] - q[1], p[2] + r[2] - q[2]] as Vec3;
  });
}
