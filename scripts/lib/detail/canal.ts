/**
 * The vaginal and anal canals (docs/research/ADULT-SCULPT-PLAN.md, section 6f): each a
 * reservoir drawn inward, its loop the opening on the skin, its rings the canal's wall
 * and its cap the canal's top, shaped from published measurements
 * (docs/research/ADULT-ANATOMY-DATA.md, section G). No source models either canal.
 *
 * A canal's centreline leaves its opening along the skin's inward normal and turns,
 * over its length, toward the axis the measurements give: the vagina's 90 degrees from
 * horizontal at the introitus, 72 at its middle and 41 at its top (Luo 2016), rising
 * backward; the anal canal up and forward toward the umbilicus. At rest each lumen is
 * closed: the vagina a transverse slit (the H section's 2 mm gap, its width growing
 * from 17 mm at the introitus to 45 at the top), the anal canal a near-closed tube. The
 * first rings turn the opening's own outline into that section over `OPENING` metres, so
 * the wall leaves the skin without a step. The cap closes the top: each of its vertices
 * goes to the top's section at its own place in the opening's disc.
 */
import type { Vec3 } from "./disc.ts";
import { type DetailTarget, targetCollector } from "./keys.ts";
import { type ReservoirRoot, type RootShape, restShape } from "./root.ts";
import { loopParameter } from "./transfer.ts";

/** The modifier of the anal canal: on (1) or off. Every adult has one by default. */
export const ANAL_CANAL = "genitals/anal-canal";

/** The canals' targets. */
export const VAGINA_TARGET = "genitals/vagina-k1";
export const ANUS_TARGET = "genitals/anus-k1";

/** A canal's measured form. */
export interface CanalForm {
  /** Along the centreline, metres. */
  length: number;
  /** Lumen width across (left to right), metres, at shares 0 to 1 of the length, evenly spaced. */
  widths: readonly number[];
  /** The closed lumen's gap (front to back), metres. */
  gap: number;
  /** The axis' angle from horizontal, degrees, at shares 0 to 1 of the length, evenly spaced. */
  angles: readonly number[];
  /** Which way the axis leans from vertical as it rises: -1 backward (the vagina), +1 forward (the anal canal). */
  lean: -1 | 1;
}

/**
 * The vagina (ADULT-ANATOMY-DATA.md, section G): 80 mm along its centreline, between its
 * anterior wall's 63 and posterior wall's 98 (Luo 2016); widths at its five levels
 * 17, 24, 30, 41 and 45 mm; a 2 mm gap; 90, 72 and 41 degrees from horizontal.
 */
export const VAGINA: CanalForm = {
  length: 0.08,
  widths: [0.017, 0.024, 0.03, 0.041, 0.045],
  gap: 0.002,
  angles: [90, 72, 41],
  lean: -1,
};

/**
 * The anal canal (section G): 36 mm, between its functional length in women (33 mm)
 * and men (39 mm), within either's spread; closed at rest (CHOICE: a 3 mm tube); its
 * axis up and forward toward the umbilicus (CHOICE: 60 degrees from horizontal; the
 * anorectal angle, 100 degrees, turns the rectum back above it, which no reservoir draws).
 */
export const ANUS: CanalForm = {
  length: 0.036,
  widths: [0.003],
  gap: 0.003,
  angles: [60],
  lean: 1,
};

/** Over how far along the canal its opening's outline turns into its closed section, metres. */
const OPENING = 0.012;

/** Linear interpolation of evenly spaced values at share `t` (0..1). */
function along(values: readonly number[], t: number): number {
  if (values.length === 1) return values[0] as number;
  const x = Math.min(1, Math.max(0, t)) * (values.length - 1);
  const i = Math.min(values.length - 2, Math.floor(x));
  const f = x - i;
  return (values[i] as number) * (1 - f) + (values[i + 1] as number) * f;
}

const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/**
 * The canal's shape on its reservoir (`RootShape` order: the cap, then each ring): the
 * centreline from the loop's centre, a closed section round it, and the cap at the top.
 */
export function canalShape(root: ReservoirRoot, form: CanalForm): RootShape {
  const R = root.rings;
  const n = root.loop.length;
  const inward: Vec3 = [-root.normal[0], -root.normal[1], -root.normal[2]];
  /** The measured axis at share `t`: up, leaning back (-1) or forward (+1) by its angle from horizontal. */
  const axis = (t: number): Vec3 => {
    const a = (along(form.angles, t) * Math.PI) / 180;
    return norm([0, Math.sin(a), form.lean * Math.cos(a)]);
  };
  // The centreline, stepped finely: leaving along the skin's inward normal, turning to the axis.
  const STEPS = 200;
  const line: Vec3[] = [root.centre];
  const dirs: Vec3[] = [];
  for (let s = 0; s < STEPS; s++) {
    const t = s / STEPS;
    const w = smooth((t * form.length) / (2 * OPENING));
    const a = axis(t);
    const d = norm([
      inward[0] * (1 - w) + a[0] * w,
      inward[1] * (1 - w) + a[1] * w,
      inward[2] * (1 - w) + a[2] * w,
    ]);
    dirs.push(d);
    const p = line[s] as Vec3;
    const h = form.length / STEPS;
    line.push([p[0] + d[0] * h, p[1] + d[1] * h, p[2] + d[2] * h]);
  }
  dirs.push(dirs[STEPS - 1] as Vec3);
  /** The centre and frame (across: left to right; front: the lumen's gap) at share `t`. */
  const frame = (t: number) => {
    const k = Math.round(t * STEPS);
    const d = dirs[k] as Vec3;
    const across = norm(cross(d, cross([1, 0, 0], d)));
    const front = norm(cross(across, d));
    // Front faces the figure's front (+z) as the opening's reference does.
    const sign = front[2] >= 0 ? 1 : -1;
    return {
      centre: line[k] as Vec3,
      across,
      front: [front[0] * sign, front[1] * sign, front[2] * sign] as Vec3,
    };
  };
  // Each loop vertex's angle round the opening, from the midline in front.
  const { share } = loopParameter(root.loop, root.normal, [0, 0, 1]);
  // Which side a quarter of the way round lies on, so the section turns as the loop does.
  let quarter = 0;
  share.forEach((s, i) => {
    if (Math.abs(s - 0.25) < Math.abs((share[quarter] as number) - 0.25)) quarter = i;
  });
  const turn = (root.loop[quarter] as Vec3)[0] >= root.centre[0] ? 1 : -1;
  const section = (t: number, i: number, scale = 1): Vec3 => {
    const { centre, across, front } = frame(t);
    const phi = 2 * Math.PI * (share[i] as number);
    const a = (along(form.widths, t) / 2) * scale * turn;
    const b = (form.gap / 2) * scale;
    // Round the opening counter-clockwise seen from outside, as `loopParameter` turns.
    return [
      centre[0] + b * Math.cos(phi) * front[0] + a * Math.sin(phi) * across[0],
      centre[1] + b * Math.cos(phi) * front[1] + a * Math.sin(phi) * across[1],
      centre[2] + b * Math.cos(phi) * front[2] + a * Math.sin(phi) * across[2],
    ];
  };
  const out: Vec3[] = [];
  // The cap: each interior vertex at its place in the opening's disc, mapped into the top's section.
  const radius =
    root.loop.reduce(
      (s, p) => s + Math.hypot(p[0] - root.centre[0], p[1] - root.centre[1], p[2] - root.centre[2]),
      0,
    ) / n;
  const top = frame(1);
  // A cap vertex's angle is taken in the opening's own frame (across the figure, and
  // forward, on the skin), which the top's frame continues.
  const opening = frame(0);
  for (const c of root.cap) {
    const o: Vec3 = [
      c.position[0] - root.centre[0],
      c.position[1] - root.centre[1],
      c.position[2] - root.centre[2],
    ];
    const r = Math.min(1, Math.hypot(o[0], o[1], o[2]) / radius);
    const side = o[0] * opening.across[0] + o[1] * opening.across[1] + o[2] * opening.across[2];
    const ahead = o[0] * opening.front[0] + o[1] * opening.front[1] + o[2] * opening.front[2];
    const phi = Math.atan2(side, ahead);
    const a = (along(form.widths, 1) / 2) * r;
    const b = (form.gap / 2) * r;
    out.push([
      top.centre[0] + b * Math.cos(phi) * top.front[0] + a * Math.sin(phi) * top.across[0],
      top.centre[1] + b * Math.cos(phi) * top.front[1] + a * Math.sin(phi) * top.across[1],
      top.centre[2] + b * Math.cos(phi) * top.front[2] + a * Math.sin(phi) * top.across[2],
    ]);
  }
  // The rings: the opening's own outline carried in along the centreline, turning into the section.
  for (let j = 1; j <= R; j++) {
    const t = j / R;
    const s = t * form.length;
    const w = smooth(s / OPENING);
    const { centre } = frame(t);
    for (let i = 0; i < n; i++) {
      const l = root.loop[i] as Vec3;
      const outline: Vec3 = [
        centre[0] + l[0] - root.centre[0],
        centre[1] + l[1] - root.centre[1],
        centre[2] + l[2] - root.centre[2],
      ];
      const closed = section(t, i);
      out.push([
        outline[0] * (1 - w) + closed[0] * w,
        outline[1] * (1 - w) + closed[1] * w,
        outline[2] * (1 - w) + closed[2] * w,
      ]);
    }
  }
  return out;
}

/** A canal's target on its reservoir, from rest to its shape, driven by `factors`. */
export function canalTarget(
  root: ReservoirRoot,
  name: string,
  form: CanalForm,
  factors: string[],
): { targets: DetailTarget[]; drives: Record<string, string[]> } {
  const collect = targetCollector(root);
  collect.add(name, restShape(root), canalShape(root, form), factors);
  return { targets: collect.targets, drives: collect.drives };
}
