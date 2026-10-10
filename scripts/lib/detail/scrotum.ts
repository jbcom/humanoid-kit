/**
 * The scrotum, out of the labioscrotal reservoir (docs/research/
 * ADULT-SCULPT-PLAN.md, section 6d): one sac with two lobes and a median raphe,
 * whose form is a CC0 sculpt's (ieroglif's `adult_male_genitalia_breast_fix`),
 * projected onto the reservoir (`transfer.ts`). Nothing reshapes it: the lobes,
 * the raphe and any asymmetry are the sculpt's, and a key is the sculpt grown or
 * shrunk by one uniform factor.
 *
 * Measured: testis volume by ultrasound, European men, 17.2 mL (SD 4.1); the
 * proportions of length to width to depth from the one full-text source with
 * dimensions (Chinese fertile men, 37.5 x 19.0 x 22.0 mm), applied at every volume
 * (docs/research/ADULT-ANATOMY-DATA.md, section F). They label each key with the
 * sac's width (two testes side by side, with skin round them), and the factor is
 * the one that gives it; the depth and hang are the sculpt's at that width.
 * Modelled and labelled so: the skin's thickness, and the neck above the testes
 * (in `sacSize`, the size the sculpt's depth and hang are compared to).
 *
 * The sac has no arousal response here: its change is unmeasured, and this
 * library carries it as absent rather than guessed.
 */
import type { Skin } from "./contact.ts";
import type { Vec3 } from "./disc.ts";
import { type Form, formOf, solveFactor, sweep } from "./form.ts";
import { sizeHat, targetCollector } from "./keys.ts";
import { type ReservoirRoot, type RootShape, restShape } from "./root.ts";
import type { SculptPart } from "./sculpt.ts";
import { projectPart } from "./transfer.ts";

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
export function measureSac(
  root: ReservoirRoot,
  shape: RootShape,
): {
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
  /** The sculpt's width on the reservoir, as sculpted (`measureSac`). */
  private readonly width: number;
  private readonly skin: Skin;
  /** The factor found for each key's volume (`factorOf`). */
  private readonly factors = new Map<number, number>();

  /** `skin`: the lattice round the reservoirs (`contact.ts`), which the sac rests on. */
  constructor(root: ReservoirRoot, part: SculptPart, skin: Skin) {
    this.root = root;
    this.skin = skin;
    this.projected = projectPart(root, part, { reference: FORWARD, skin });
    this.form = formOf(root, this.projected, LATERAL);
    this.width = measureSac(root, this.projected).width;
  }

  /** The sculpt grown or shrunk by one factor on every axis, fading in from the loop. */
  private sized(f: number): RootShape {
    return sweep(this.form, { blend: ROOT_BLEND, length: f, across: f, up: f });
  }

  /**
   * The one factor on the sculpt for a key: the one at which the sac as drawn
   * (resting on the skin round its root) is as wide as two testes of the key's volume
   * side by side, with skin round them. Its depth and hang are the sculpt's at that
   * width. Taken as that width over the sculpt's own, the drawn sac missed it, as the
   * root's fade and the skin it rests on move it.
   */
  factorOf(key: TestesKey): number {
    const known = this.factors.get(key.volume);
    if (known !== undefined) return known;
    const want = sacSize(key.volume).width;
    const f = solveFactor(
      (g) => measureSac(this.root, this.drawn(g)).width,
      want,
      want / this.width,
    );
    this.factors.set(key.volume, f);
    return f;
  }

  /** The sac grown or shrunk by `f`, resting on the skin round its root. */
  private drawn(f: number): RootShape {
    return this.skin.rest(this.root, this.sized(f));
  }

  /** The sac at a key, resting on the skin round its root. */
  shape(key: TestesKey): RootShape {
    return this.drawn(this.factorOf(key));
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
