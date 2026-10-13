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
import type { CanalClosureSpec } from "../../../src/format/assetFormat.ts";
import { closedLoop, frameAlong } from "../../../src/model/canalClosure.ts";
import type { AdultDetailLattice } from "../../../src/model/humanoidModel.ts";
import type { Vec3 } from "./disc.ts";
import { type DetailTarget, targetCollector } from "./keys.ts";
import { regionIndex, regionNeighbours } from "./region.ts";
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
  /**
   * Its vault: the gap its top opens to, metres, over the last `VAULT_RISE` of its length.
   * Absent, the lumen keeps its gap to the top.
   */
  vault?: number;
  /** The axis' angle from horizontal, degrees, at shares 0 to 1 of the length, evenly spaced. */
  angles: readonly number[];
  /** Which way the axis leans from vertical as it rises: -1 backward (the vagina), +1 forward (the anal canal). */
  lean: -1 | 1;
  /** How its opening is closed at the skin, at rest (`closedLoop`, `canalGather`). */
  closure: CanalClosure;
}

/**
 * A canal's opening closed at the skin (coordinator ruling, 2026-10-10): the skin's
 * disc round it gathered onto the canal's closed shape at the loop itself, so no cup
 * and no rim show. Each closes to a slit front to back (`closedLoop`): the introitus
 * as long as its opening, between the minora; the anus a short one with radial folds.
 */
export interface CanalClosure {
  /** What is left open across the slit, metres. */
  gap: number;
  /** The slit's length front to back, metres; absent, the opening's own. */
  length?: number;
  /** How far round the loop the skin is gathered with it, metres. */
  zone: number;
  /** Radial folds round the opening: how many, and how deep at most, metres. */
  folds?: { count: number; depth: number };
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
  // CHOICE: the vault, round the cervix (the fornices), opens to 12 mm front to back.
  vault: 0.012,
  angles: [90, 72, 41],
  lean: -1,
  // CHOICE: closed (its lips touch: open by any gap, cameras on the midline saw in along the
  // slit's own plane), as long as the opening, the skin gathered 4 mm round: twice the
  // opening's 2 mm half-width.
  closure: { gap: 0, zone: 0.004 },
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
  // CHOICE: closed to a slit front to back as long as the opening, gathered 4 mm round (twice
  // the opening's 2 mm radius), ten radial folds up to 0.4 mm deep (the anal verge's
  // corrugations). Closed to a 3 mm slit, a 12 mm opening's 38 mm round was pressed into 6:
  // the skin round it doubled its slivers (165 to 322 triangles under 5° within 15 mm,
  // m-muscular seated) and they turned over in the pose (77 more inverted).
  closure: { gap: 0, zone: 0.004, folds: { count: 10, depth: 0.0004 } },
};

/**
 * Over how far along the canal its opening's outline turns into its closed section,
 * metres. The canal's walls take their root's weights over the same length
 * (`AdultReservoirSpec.canal`).
 */
export const OPENING = 0.012;

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
const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/**
 * How sharply a lumen's flat walls give way to its rounded ends (`lumen`): the share of
 * the flat reached is tanh(k sin phi) / tanh(k). CHOICE: about two thirds of the loop's
 * vertices on the flats, a third round the ends.
 */
const FLATS = 2.5;

/** How high a canal's vault rises past its top section, as a share of the top's width. CHOICE. */
const VAULT = 0.25;

/**
 * The share of a canal's length over which its lumen opens to its vault (`CanalForm.vault`).
 * Kept a 2 mm slit to the top, the vagina's 45 mm top ended in turns too tight for its
 * normals: one pointed into the body, and lay inside other skin at rest.
 */
const VAULT_RISE = 0.15;

/**
 * A closed lumen's section at angle `phi` round it, as offsets (across, front): flat
 * walls `b` either side of the centre with round ends of radius `b`, `a` from the
 * centre across (signed: which way round it turns). An ellipse of the same extent had
 * ends of radius b²/a, 0.04 mm at the vagina's top, finer than its rings: the ends
 * folded over, their normals pointed into the body, and their triangles turned.
 */
export function lumen(phi: number, a: number, b: number): [number, number] {
  const s = Math.sin(phi);
  const flat = Math.max(0, Math.abs(a) - b);
  const h = Math.tanh(FLATS * s) / Math.tanh(FLATS);
  return [Math.sign(a || 1) * (flat * h + b * s), b * Math.cos(phi)];
}

/** A root's loop closed at the skin (`closedLoop`, evaluated the same way on every figure). */
export function rootClosed(root: ReservoirRoot, closure: CanalClosure): Vec3[] {
  return closedLoop(root.loop, root.normal, closure.gap, closure.length);
}

/**
 * The canal's shape on its reservoir (`RootShape` order: the cap, then each ring): the
 * centreline from the loop's centre, a closed section round it, and the cap at the top.
 * The rings leave from `outline`, where the loop is drawn at the skin (`closedLoop`);
 * the loop's own vertices give each its place round the opening.
 */
export function canalShape(
  root: ReservoirRoot,
  form: CanalForm,
  outline: readonly Vec3[] = root.loop,
): RootShape {
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
    return { centre: line[k] as Vec3, ahead: dirs[k] as Vec3, ...frameAlong(dirs[k] as Vec3) };
  };
  // Each loop vertex's angle round the opening, from the midline in front.
  const { share } = loopParameter(root.loop, root.normal, [0, 0, 1]);
  // Which side a quarter of the way round lies on, so the section turns as the loop does.
  let quarter = 0;
  share.forEach((s, i) => {
    if (Math.abs(s - 0.25) < Math.abs((share[quarter] as number) - 0.25)) quarter = i;
  });
  const turn = (root.loop[quarter] as Vec3)[0] >= root.centre[0] ? 1 : -1;
  /** The lumen's gap at share `t`: its own, opening to its vault's over the last `VAULT_RISE`. */
  const gapAt = (t: number) =>
    form.vault === undefined
      ? form.gap
      : form.gap + (form.vault - form.gap) * smooth((t - (1 - VAULT_RISE)) / VAULT_RISE);
  const section = (t: number, i: number, scale = 1): Vec3 => {
    const { centre, across, front } = frame(t);
    const phi = 2 * Math.PI * (share[i] as number);
    const [x, y] = lumen(phi, (along(form.widths, t) / 2) * scale * turn, (gapAt(t) / 2) * scale);
    // Round the opening counter-clockwise seen from outside, as `loopParameter` turns.
    return [
      centre[0] + y * front[0] + x * across[0],
      centre[1] + y * front[1] + x * across[1],
      centre[2] + y * front[2] + x * across[2],
    ];
  };
  const out: Vec3[] = [];
  // The cap: the vault over the top's section. Its plan is the cap's own mesh laid out with
  // each interior vertex at the mean of its neighbours and the loop on the top's section
  // (Tutte's embedding), which over a convex section cannot fold. Mapped vertex by vertex
  // from the opening's disc instead (a long, narrow opening onto a wide, shallow top), the
  // cap folded at the top's ends: 64 triangles turned on f-slim, and its corners' normals
  // pointed into the body (0.23 cm² inside other skin at rest). Its height is the mean of
  // its neighbours' plus a constant (a Poisson dome), none at the rim and `VAULT` of the
  // top's width at its highest, so its faces face the lumen. As low as the lumen's gap, the
  // vagina's top turned 23 triangles against 7.
  const top = frame(1);
  const width = along(form.widths, 1);
  const m = root.cap.length;
  /** Neighbours of each cap vertex: another cap vertex `j` as `j`, loop vertex `i` as `-(i + 1)`. */
  const around = Array.from({ length: m }, () => new Set<number>());
  for (const polygon of root.capPolygons) {
    const ids = polygon.map((c) => ("cap" in c ? c.cap : -(c.loop + 1)));
    ids.forEach((a, k) => {
      const b = ids[(k + 1) % ids.length] as number;
      if (a >= 0) (around[a] as Set<number>).add(b);
      if (b >= 0) (around[b] as Set<number>).add(a);
    });
  }
  const rimPlan = root.loop.map((_, i) =>
    lumen(2 * Math.PI * (share[i] as number), (width / 2) * turn, gapAt(1) / 2),
  );
  const plan = new Float64Array(m * 2);
  const height = new Float64Array(m);
  for (let sweep = 0; sweep < 20000; sweep++) {
    let change = 0;
    for (let j = 0; j < m; j++) {
      const ns = [...(around[j] as Set<number>)];
      let x = 0;
      let y = 0;
      let z = 0;
      for (const b of ns) {
        const p = b >= 0 ? [plan[b * 2] as number, plan[b * 2 + 1] as number] : rimPlan[-b - 1];
        x += (p as number[])[0] as number;
        y += (p as number[])[1] as number;
        z += b >= 0 ? (height[b] as number) : 0;
      }
      const next = [x / ns.length, y / ns.length, z / ns.length + 1];
      change = Math.max(
        change,
        Math.abs((next[0] as number) - (plan[j * 2] as number)),
        Math.abs((next[1] as number) - (plan[j * 2 + 1] as number)),
        Math.abs((next[2] as number) - (height[j] as number)) * 1e-3,
      );
      plan[j * 2] = next[0] as number;
      plan[j * 2 + 1] = next[1] as number;
      height[j] = next[2] as number;
    }
    if (change < 1e-10) break;
  }
  const highest = Math.max(1e-12, ...height);
  for (let j = 0; j < m; j++) {
    const x = plan[j * 2] as number;
    const y = plan[j * 2 + 1] as number;
    const z = (VAULT * width * (height[j] as number)) / highest;
    out.push([
      top.centre[0] + y * top.front[0] + x * top.across[0] + z * top.ahead[0],
      top.centre[1] + y * top.front[1] + x * top.across[1] + z * top.ahead[1],
      top.centre[2] + y * top.front[2] + x * top.across[2] + z * top.ahead[2],
    ]);
  }
  // The rings: the opening's outline at the skin carried in along the centreline, turning into the section.
  for (let j = 1; j <= R; j++) {
    const t = j / R;
    const s = t * form.length;
    const w = smooth(s / OPENING);
    const { centre } = frame(t);
    for (let i = 0; i < n; i++) {
      const l = outline[i] as Vec3;
      const carried: Vec3 = [
        centre[0] + l[0] - root.centre[0],
        centre[1] + l[1] - root.centre[1],
        centre[2] + l[2] - root.centre[2],
      ];
      const closed = section(t, i);
      out.push([
        carried[0] * (1 - w) + closed[0] * w,
        carried[1] * (1 - w) + closed[1] * w,
        carried[2] * (1 - w) + closed[2] * w,
      ]);
    }
  }
  return out;
}

/**
 * A canal's target on its reservoir, driven by `factors`: from its rings on the loop as
 * the skin leaves it (`outline`, where its closure puts it, `rootClosed`) to its shape.
 * A ring copies its loop vertex, and follows whatever displaces it, so the rings start
 * from the closed loop and the closure is not counted twice.
 */
export function canalTarget(
  root: ReservoirRoot,
  name: string,
  form: CanalForm,
  factors: string[],
  outline: readonly Vec3[] = root.loop,
): { targets: DetailTarget[]; drives: Record<string, string[]> } {
  const collect = targetCollector(root);
  collect.add(
    name,
    restShape({ ...root, loop: outline }),
    canalShape(root, form, outline),
    factors,
  );
  return { targets: collect.targets, drives: collect.drives };
}

/** A zone weight under this is left out: the fill's last thousandth of a loop vertex's move. */
const ZONE_WEIGHT_FLOOR = 1e-3;

/** Over-relaxation of the zone's harmonic fills: the same fill, in a fraction of the sweeps. */
const RELAX = 1.8;

/**
 * A canal's closure (`CanalClosureSpec`, evaluated on each figure by
 * `closureDisplacement`), on the lattice's region: the loop (`loopRegion`, region
 * indices in loop order), and the skin within `closure.zone` of it carried with the
 * loop by a harmonic fill (each vertex the mean of its neighbours), which falls to
 * nothing at the zone's edge. The fill is linear in the loop's moves, so it is kept as
 * each zone vertex's weights on the loop's places: one fill per place, that place
 * moved by 1 and the rest held. `held` are region vertices that stay where they are:
 * the canal's own cap (its target moves it) and every other reservoir's loop and cap.
 * Radial folds are grooves sunk into the zone, `count` round it, deepest midway
 * across it.
 */
export function canalClosure(
  lattice: AdultDetailLattice,
  root: ReservoirRoot,
  loopRegion: readonly number[],
  closure: CanalClosure,
  held: ReadonlySet<number>,
  target: string,
): CanalClosureSpec {
  const n = lattice.regionCount;
  const P = lattice.positions;
  const at = (v: number): Vec3 => [
    P[v * 3] as number,
    P[v * 3 + 1] as number,
    P[v * 3 + 2] as number,
  ];
  const nb = regionNeighbours(lattice, regionIndex(lattice));
  const onLoop = new Set(loopRegion);
  // The zone: free region vertices within reach of the loop.
  const distance = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
  for (let v = 0; v < n; v++) {
    if (onLoop.has(v) || held.has(v)) continue;
    const p = at(v);
    for (const l of root.loop)
      distance[v] = Math.min(
        distance[v] as number,
        Math.hypot(p[0] - l[0], p[1] - l[1], p[2] - l[2]),
      );
  }
  const zone: number[] = [];
  for (let v = 0; v < n; v++) if ((distance[v] as number) < closure.zone) zone.push(v);
  // One harmonic fill per loop place (Gauss–Seidel, over-relaxed by `RELAX`): that place at 1,
  // the rest of the loop and everything outside the zone at 0.
  const weights = zone.map(() => new Float64Array(loopRegion.length));
  const value = new Float64Array(n);
  loopRegion.forEach((place, i) => {
    value.fill(0);
    value[place] = 1;
    for (let sweep = 0; sweep < 5000; sweep++) {
      let change = 0;
      for (const v of zone) {
        const around = nb[v] as number[];
        let sum = 0;
        for (const w of around) sum += value[w] as number;
        const step = RELAX * (sum / around.length - (value[v] as number));
        change = Math.max(change, Math.abs(step));
        value[v] = (value[v] as number) + step;
      }
      if (change < 1e-8) break;
    }
    zone.forEach((v, z) => {
      (weights[z] as Float64Array)[i] = value[v] as number;
    });
  });
  const kept: number[] = [];
  const zoneStart = [0];
  const zoneLoop: number[] = [];
  const zoneWeight: number[] = [];
  zone.forEach((v, z) => {
    const row = weights[z] as Float64Array;
    let any = false;
    row.forEach((w, i) => {
      if (w < ZONE_WEIGHT_FLOOR) return;
      zoneLoop.push(i);
      zoneWeight.push(w);
      any = true;
    });
    if (!any) return;
    kept.push(v);
    zoneStart.push(zoneLoop.length);
  });
  let folds: CanalClosureSpec["folds"];
  if (closure.folds) {
    // Grooves round the loop's centre, in the skin's plane, sunk along each vertex's normal.
    const d: Vec3 = [-root.normal[0], -root.normal[1], -root.normal[2]];
    const { across, front } = frameAlong(d);
    const indices: number[] = [];
    const xyz: number[] = [];
    for (const v of zone) {
      const p = at(v);
      const o: Vec3 = [p[0] - root.centre[0], p[1] - root.centre[1], p[2] - root.centre[2]];
      const phi = Math.atan2(
        o[0] * across[0] + o[1] * across[1] + o[2] * across[2],
        o[0] * front[0] + o[1] * front[1] + o[2] * front[2],
      );
      const groove = (1 + Math.cos(closure.folds.count * phi)) / 2;
      const midway = Math.sin((Math.PI * (distance[v] as number)) / closure.zone);
      const sink = closure.folds.depth * groove * midway;
      if (sink < 1e-7) continue;
      indices.push(v);
      for (let k = 0; k < 3; k++) xyz.push(-sink * (lattice.normals[v * 3 + k] as number));
    }
    folds = { indices, xyz };
  }
  return {
    target,
    gap: closure.gap,
    ...(closure.length !== undefined && { length: closure.length }),
    normal: [root.normal[0], root.normal[1], root.normal[2]],
    loopRegion: [...loopRegion],
    zone: kept,
    zoneStart,
    zoneLoop,
    zoneWeight,
    ...(folds && { folds }),
  };
}
