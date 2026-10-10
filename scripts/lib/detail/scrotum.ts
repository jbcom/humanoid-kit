/**
 * The scrotum, out of the labioscrotal reservoir (docs/research/
 * ADULT-SCULPT-PLAN.md, section 6d): one sac with two lobes and a median raphe,
 * whose form is a CC0 sculpt's (ukiyoe's `man_genital`), projected onto the
 * reservoir (`transfer.ts`) and sized from the testis volume (`form.ts`).
 *
 * Measured: testis volume by ultrasound, European men, 17.2 mL (SD 4.1), right
 * larger than left (17.9 and 16.5); the proportions of length to width to depth
 * from the one full-text source with dimensions (Chinese fertile men, 37.5 x 19.0
 * x 22.0 mm), applied at every volume (docs/research/ADULT-ANATOMY-DATA.md,
 * section F). These set only the sac's size, as scale factors on the sculpt: its
 * width holds two testes side by side, its depth one, its hang one testis'
 * length, each with skin round it. Modelled and labelled so: the skin's
 * thickness and the neck above the testes.
 *
 * The sac has no arousal response here: its change is unmeasured, and this
 * library carries it as absent rather than guessed.
 */
import type { Skin } from "./contact.ts";
import type { Vec3 } from "./disc.ts";
import { type Form, formOf, type Pose, solveFactor, sweep } from "./form.ts";
import { sizeHat, targetCollector } from "./keys.ts";
import { type ReservoirRoot, type RootShape, restShape } from "./root.ts";
import type { SculptPart } from "./sculpt.ts";
import { projectPart } from "./transfer.ts";
import { smooth } from "./tube.ts";

/** The size modifier: a virtual, one-sided one, 0 (none) to 1. */
export const TESTES_SIZE = "genitals/testes-size";

/** A size the sac is baked at, as the volume of one testis in millilitres. */
export interface TestesKey {
  size: number;
  volume: number;
}

/**
 * The keys: a small testis (about 6 mL, well under the 11 mL below which the
 * literature calls them hypotrophic), the European mean (17.2 mL), and a large one.
 */
export const TESTES_KEYS: readonly TestesKey[] = [
  { size: 0.25, volume: 6 },
  { size: 0.6, volume: 17.2 },
  { size: 1, volume: 38 },
];

/** Right and left testis volume over the mean of the pair (EAA: 17.9, 16.5 over 17.2). */
export const RIGHT_OVER_MEAN = 17.9 / 17.2;
export const LEFT_OVER_MEAN = 16.5 / 17.2;

/** Length and depth over width, from the one full-text dimensions (37.5 x 19.0 x 22.0 mm). */
const LENGTH_OVER_WIDTH = 37.5 / 19;
const DEPTH_OVER_WIDTH = 22 / 19;
/** The ellipsoid formula the volumes were measured with: V = 0.52 x length x width x depth. */
const ELLIPSOID = 0.52;
/** Skin and dartos round a testis, each side, metres (modelled). */
export const SKIN = 0.004;
/** The neck between the root and the top of the testes, metres (modelled). */
export const NECK = 0.015;
/** The sac's body, where its width and depth are taken: below this share of its hang. */
const BODY_FROM = 0.4;
/** The arclength over which the sizing fades in from the loop, metres (modelled). */
const ROOT_BLEND = 0.01;
/** Across the midline, the width over which one side's factor gives way to the other's, metres. */
const MIDLINE = 0.01;

/**
 * The median raphe's groove (modelled: the septum between the testes ties the skin
 * in along the midline, and no measurement of the groove was found): its depth and
 * its half-width across, over the testis' width, and where along the sac it comes in
 * (a share of the arclength from the root, rising to full over the next share).
 */
const RAPHE_DEPTH = 0.45;
const RAPHE_WIDTH = 0.35;
const RAPHE_FROM = 0.15;
const RAPHE_RISE = 0.4;

/** The raphe's groove for a key, metres. */
export function rapheOf(key: TestesKey): { depth: number; width: number } {
  const w = testisDimensions(key.volume).width;
  return { depth: RAPHE_DEPTH * w, width: RAPHE_WIDTH * w };
}

/** Across the figure: +x is its left (it faces +z), so the sac's frames start from it. */
export const LATERAL: Vec3 = [1, 0, 0];
/** Forward: where both loops start. */
export const FORWARD: Vec3 = [0, 0, 1];

/** The dimensions of a testis of this volume, metres (width across, length, depth front to back). */
export function testisDimensions(volumeMl: number): {
  width: number;
  length: number;
  depth: number;
} {
  const width = Math.cbrt(volumeMl / (ELLIPSOID * LENGTH_OVER_WIDTH * DEPTH_OVER_WIDTH)) / 100;
  return { width, length: width * LENGTH_OVER_WIDTH, depth: width * DEPTH_OVER_WIDTH };
}

/** The sac's size for a mean testis volume: its width, depth and hang, metres. */
export function sacSize(volumeMl: number): { width: number; depth: number; hang: number } {
  const t = testisDimensions(volumeMl);
  return {
    width: 2 * (t.width + 2 * SKIN),
    depth: t.depth + 2 * SKIN,
    hang: NECK + t.length + 2 * SKIN,
  };
}

/**
 * A sac's measured size in its own frame: its hang along the way it hangs (from
 * the loop's centre to the centroid of its lowest ring), its width across the
 * figure, and its depth across both, the last two over its body (beyond
 * `BODY_FROM` of the hang).
 */
export function measureSac(root: ReservoirRoot, shape: RootShape): {
  width: number;
  depth: number;
  hang: number;
} {
  const n = root.loop.length;
  const last = shape.slice(root.cap.length + (root.rings - 1) * n);
  const end = [0, 1, 2].map((k) => last.reduce((s, p) => s + (p[k] as number), 0) / n);
  const c = root.centre;
  const down = [0, 1, 2].map((k) => (end[k] as number) - (c[k] as number));
  const dl = Math.hypot(...down);
  const h: Vec3 = [(down[0] as number) / dl, (down[1] as number) / dl, (down[2] as number) / dl];
  const across: Vec3 = [1 - h[0] * h[0], -h[0] * h[1], -h[0] * h[2]];
  const al = Math.hypot(...across);
  const w: Vec3 = [across[0] / al, across[1] / al, across[2] / al];
  const d: Vec3 = [h[1] * w[2] - h[2] * w[1], h[2] * w[0] - h[0] * w[2], h[0] * w[1] - h[1] * w[0]];
  const along = (p: Vec3, axis: Vec3) =>
    (p[0] - c[0]) * axis[0] + (p[1] - c[1]) * axis[1] + (p[2] - c[2]) * axis[2];
  const hang = Math.max(...shape.map((p) => along(p, h)));
  const body = shape.filter((p) => along(p, h) >= BODY_FROM * hang);
  const extent = (axis: Vec3) => {
    const v = body.map((p) => along(p, axis));
    return Math.max(...v) - Math.min(...v);
  };
  return { width: extent(w), depth: extent(d), hang };
}

/** The sac's sculpted form on this root, and each key's shape. */
export class SculptedScrotum {
  readonly root: ReservoirRoot;
  /** The sculpt projected onto the reservoir, before any sizing. */
  readonly projected: RootShape;
  readonly form: Form;
  private readonly scales = new Map<TestesKey, { across: number; up: number; length: number }>();
  private readonly skin: Skin;

  /** `skin`: the lattice round the reservoirs (`contact.ts`), which the sac rests on. */
  constructor(root: ReservoirRoot, part: SculptPart, skin: Skin) {
    this.root = root;
    this.skin = skin;
    this.projected = projectPart(root, part, { reference: FORWARD });
    this.form = formOf(root, this.projected, LATERAL);
  }

  private pose(s: { across: number; up: number; length: number }, key: TestesKey): Pose {
    const right = Math.cbrt(RIGHT_OVER_MEAN);
    const left = Math.cbrt(LEFT_OVER_MEAN);
    const raphe = rapheOf(key);
    return {
      blend: ROOT_BLEND,
      length: s.length,
      across: s.across,
      up: s.up,
      // Offsets across are along +x, the figure's left: negative is its right, the larger.
      side: (across) => left + (right - left) * smooth(0.5 - across / (2 * MIDLINE)),
      relief: (o, share) => {
        const w = Math.exp(-((o[0] / raphe.width) ** 2)) * smooth((share - RAPHE_FROM) / RAPHE_RISE);
        // Toward the centreline within the midline's plane: in from the front and the
        // back, and up from the bottom (the cap's offset along is past the last ring).
        // The pull is d w r^2 / (r^2 + d^2) at distance r from the centreline: the full
        // depth well out from it, and little near it, so the new distance still grows
        // with the old one and the skin never folds over itself.
        const along = share >= 1 ? Math.max(0, o[2]) : 0;
        const r = Math.hypot(o[1], along);
        if (r < 1e-9) return o;
        const d = raphe.depth;
        const k = 1 - (d * w * r) / (r * r + d * d);
        return [o[0], o[1] * k, o[2] - along * (1 - k)];
      },
    };
  }

  /** The factors on the sculpt's width (across), depth (up) and hang (length) for a key. */
  scalesOf(key: TestesKey): { across: number; up: number; length: number } {
    const known = this.scales.get(key);
    if (known) return known;
    const want = sacSize(key.volume);
    const s = { across: 1, up: 1, length: 1 };
    // Each factor in turn with the others held, until all hold: the raphe's groove ties
    // the depth to the width, so a factor's effect is not its own alone.
    const solve = (axis: "across" | "up" | "length", measure: "width" | "depth" | "hang") => {
      s[axis] = solveFactor(
        (f) => measureSac(this.root, sweep(this.form, this.pose({ ...s, [axis]: f }, key)))[measure],
        want[measure],
        s[axis],
      );
    };
    for (let pass = 0; pass < 8; pass++) {
      solve("length", "hang");
      solve("across", "width");
      solve("up", "depth");
      const got = measureSac(this.root, sweep(this.form, this.pose(s, key)));
      if (
        Math.abs(got.width / want.width - 1) < 1e-5 &&
        Math.abs(got.depth / want.depth - 1) < 1e-5 &&
        Math.abs(got.hang / want.hang - 1) < 1e-5
      )
        break;
    }
    this.scales.set(key, s);
    return s;
  }

  /** The sac at a key, resting on the skin round its root. */
  shape(key: TestesKey): RootShape {
    return this.skin.rest(this.root, sweep(this.form, this.pose(this.scalesOf(key), key)));
  }
}

/** The targets' names: key number (1-based). */
export const testesTarget = (n: number) => `genitals/testes-k${n}`;

/** The targets of the sac and the factors that drive each: its shape at a key, worth that key's hat of the size. */
export function scrotumTargets(root: ReservoirRoot, part: SculptPart, skin: Skin) {
  const sac = new SculptedScrotum(root, part, skin);
  const { targets, drives, add } = targetCollector(root);
  const rest = restShape(root);
  const sizes = TESTES_KEYS.map((k) => k.size);
  TESTES_KEYS.forEach((key, k) => {
    add(testesTarget(k + 1), rest, sac.shape(key), [sizeHat(TESTES_SIZE, sizes, k)]);
  });
  return { targets, drives };
}
