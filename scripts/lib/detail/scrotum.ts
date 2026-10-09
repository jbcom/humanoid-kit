/**
 * The scrotal lobes and the testes in them, drawn out of the labioscrotal pair of
 * reservoirs (docs/research/ADULT-SCULPT-PLAN.md, section 6c): each lobe is a
 * tube from its loop on the skin that hangs and swells to the sac of one testis
 * (`tube.ts`). The pair is the same structure the vulva's labia majora will be
 * drawn from, so a figure between them is a point on the same continuum.
 *
 * Measured: testis volume by ultrasound, European men, 17.2 mL (SD 4.1), right
 * larger than left (17.9 and 16.5); the proportions of length to width to depth
 * from the one full-text source with dimensions (Chinese fertile men, 37.5 x 19.0
 * x 22.0 mm), applied at every volume (docs/research/ADULT-ANATOMY-DATA.md,
 * section F). Modelled and labelled so: the sac's skin thickness, the neck, the
 * hang direction and the outward lean that keeps the lobes apart.
 *
 * The sac has no arousal response here: its change is unmeasured, and this
 * library carries it as absent rather than guessed.
 */
import type { Vec3 } from "./disc.ts";
import { sizeHat, targetCollector } from "./keys.ts";
import { type ReservoirRoot, type RootShape, restShape } from "./root.ts";
import { smooth, tubeShape, turnAngle } from "./tube.ts";

/** The size modifier: a virtual, one-sided one, 0 (none) to 1. */
export const TESTES_SIZE = "genitals/testes-size";

/** A size the lobes are baked at, as the volume of one testis in millilitres. */
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
/** Skin and dartos around the testis, each side, metres (modelled). */
const SKIN = 0.004;
/** Length of the neck between the root and the sac, metres (modelled). */
const NECK = 0.015;
/** The neck's section over the sac's widest (modelled). */
const NECK_SECTION = 0.6;
/** How far along its ellipse the last ring is: past it the dome closes (modelled). */
const LAST = 0.97;
/** The lobe's outward lean: the hang direction's sideways part, away from the midline (modelled). */
const LEAN = 0.25;

/** The dimensions of a testis of this volume, metres (width across, length, depth front to back). */
export function testisDimensions(volumeMl: number): {
  width: number;
  length: number;
  depth: number;
} {
  const width = Math.cbrt(volumeMl / (ELLIPSOID * LENGTH_OVER_WIDTH * DEPTH_OVER_WIDTH)) / 100;
  return { width, length: width * LENGTH_OVER_WIDTH, depth: width * DEPTH_OVER_WIDTH };
}

/**
 * The shape of one lobe for a testis of this volume: a position for every vertex a
 * target of the root may move. The lobe leans away from the midline by the sign of
 * its root's x.
 */
export function lobeShape(root: ReservoirRoot, volumeMl: number): RootShape {
  const t = testisDimensions(volumeMl);
  const a = t.width / 2 + SKIN;
  const b = t.depth / 2 + SKIN;
  const length = t.length + 2 * SKIN;
  const axial = length + NECK;
  const outward = Math.sign(root.centre[0]) || 1;
  const direction: Vec3 = [outward * LEAN, -1, 0];
  const norm = Math.hypot(...direction);
  const down: Vec3 = [direction[0] / norm, direction[1] / norm, direction[2] / norm];
  const f = (s: number) => {
    const q = Math.min(1, Math.max(0, (s - NECK) / length));
    const xi = LAST * (2 * q - 1);
    // Above the equator the wall comes from the neck's section; below it, an ellipse.
    return xi < 0 ? NECK_SECTION + (1 - NECK_SECTION) * smooth(1 + xi) : Math.sqrt(1 - xi * xi);
  };
  const end = f(axial);
  const dome = ((1 - LAST) * length) / 2;
  const turn = turnAngle(root, down);
  return tubeShape(root, {
    axial,
    direction: down,
    bend: Math.min(1.3 * Math.max(a, b) * turn, 0.6 * axial),
    flare: NECK,
    section: (s) => ({ across: a * f(s), up: b * f(s) }),
    tip: { across: a * end, up: b * end },
    dome,
  }).shape;
}

/** The targets' names: key number (1-based) and the anatomical side. */
export const testesTarget = (n: number, side: "right" | "left") => `genitals/testes-k${n}-${side}`;

/**
 * The targets of the two lobes and the factors that drive each: a lobe's shape at
 * a key, worth that key's hat of the size. The figure faces +z, so its right side
 * is -x: the root with x negative gets the right testis, the larger.
 */
export function scrotumTargets(roots: [ReservoirRoot, ReservoirRoot]) {
  const sides = roots.map((root) => ({
    root,
    side: ((root.centre[0] as number) < 0 ? "right" : "left") as "right" | "left",
  }));
  if (sides[0]?.side === sides[1]?.side) throw new Error("the two lobes are on the same side");
  const collected = sides.map(({ root, side }) => ({
    root,
    side,
    ...targetCollector(root),
    rest: restShape(root),
  }));
  const sizes = TESTES_KEYS.map((k) => k.size);
  for (const c of collected)
    TESTES_KEYS.forEach((key, k) => {
      const volume = key.volume * (c.side === "right" ? RIGHT_OVER_MEAN : LEFT_OVER_MEAN);
      c.add(testesTarget(k + 1, c.side), c.rest, lobeShape(c.root, volume), [
        sizeHat(TESTES_SIZE, sizes, k),
      ]);
    });
  return {
    targets: collected.flatMap((c) => c.targets),
    drives: Object.assign({}, ...collected.map((c) => c.drives)) as Record<string, string[]>,
  };
}
