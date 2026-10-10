import { SkinPatch, TriangleCrossings } from "./contact.ts";
import {
  FOLD_KEYS,
  FOLD_THIGH_HOLD,
  FOLD_TRUNK_REACH,
  foldParts,
  foldSides,
  foldTaper,
  HIP_FOLD,
  type HipFold,
  nearHips,
  noFold,
} from "./hipFold.ts";
import { IDENTITY_POSE, type RestBones, skinPositions } from "./pose.ts";

/**
 * Solves a figure's hip fold (docs/ARCHITECTURE.md, "The hip fold"): for each
 * key flexion of `HIP_FOLD`, how far each vertex of the skin around the hip's
 * front must move, from where the bones put it with both hips flexed so far, for
 * the thigh's skin to lie against the trunk's and not through it.
 *
 * Both give, as flesh pressed on flesh does. A step is made in `ROUNDS` rounds.
 * In each, the trunk's skin holds still and the thigh's skin that is behind it
 * is pushed out along its outward normal to `CLEARANCE` off it (the first pushes
 * of a round spread over the neighbouring skin, so that the thigh moves as a
 * surface), until no push is needed. Then, unless it is the last round, the
 * contact is shared: all the thigh's skin gives back `TRUNK_GIVE` of what the
 * round pushed it out by, and the trunk's skin it met (the belly and the groin)
 * is pressed in as far, the press spread over the trunk's neighbouring skin
 * (`PRESS_SPREADS`), each thigh's press apart from the other's. The next round
 * pushes the thigh's skin out against the pressed trunk again, so the last
 * round leaves no contact, and the two have shared it. Keeping the trunk still
 * while the thigh's skin is pushed is what lets the pushes settle: pressed while
 * pushed, a trunk's triangles tip under the thigh, and the chase between the two
 * does not end.
 *
 * The hips are flexed a few degrees at a time from where the fold starts, as a
 * contact would develop: the steps are what keep every push small, so that it is
 * always the nearest skin that the thigh is pushed from, and never a far side of
 * the belly. The displacement a step ends with carries on to the next.
 */

/** How far (metres) off the trunk's skin the thigh's is left: a skin's thickness of touching. */
const CLEARANCE = 0.005;
/** Thigh skin further than this (metres) from the trunk's is not tested. */
const REACH = 0.05;
/**
 * Thigh skin further than this (metres) from the trunk's at the start of a round
 * is not tested in it: twice what a pass may push skin (`MOST_PUSH`), more than
 * a round moves it, and more than any edge of the control mesh is long.
 */
const NEAR = 0.08;
/** Cells (metres) of the grid that finds the trunk's triangles near a vertex. */
const CELL = 0.04;
/**
 * The share of a contact the trunk's skin gives, pressed in; the thigh's takes
 * the rest. CHOICE, measured over the smoke tier (docs/ARCHITECTURE.md, "The
 * hip fold"): the lower belly and the groin are softer than the front of the
 * thigh, and of 0.3, 0.45, 0.6 and 0.75 a share of 0.6 left the fewest rows worse.
 */
export const TRUNK_GIVE = 0.6;
/** CHOICE: passes spreading a round's press over the trunk's skin, and how far each moves a vertex's press toward its neighbours' mean. */
const PRESS_SPREADS = 6;
const PRESS_SPREAD = 0.5;
/** CHOICE: rounds a step makes, the last of them pushes alone (two shares). */
const ROUNDS = 3;
/** The share of its neighbours' push each thigh vertex takes in a spread pass. */
const SPREAD = 0.5;
/** Spread passes made of each of the first passes of a round. */
const SPREADS = 2;
/** The passes of a round that spread their pushes; the rest push each vertex alone. */
const SPREADING = 3;
/** A pass that needs no push over this (metres) is the last of its round. */
const TOLERANCE = 0.0002;
const PASSES = 60;
/**
 * CHOICE: the passes of each round after the first, which only take up what the
 * sharing undid (a few passes where the contact settles; where
 * it does not, a heavy body wedged past 130°, they bound the time a step takes).
 */
const LATER_PASSES = 15;
/** From this pass of a round on, each push is made only `RELAXED` of the way. */
const RELAX_FROM = 30;
const RELAXED = 0.5;
/** The most (metres) a pass moves any skin. */
const MOST_PUSH = 0.04;

/** `fold` for the figure whose rest vertices are `control`, skeleton `rest`, skinned by `skinIndex` and `skinWeight`; `tris` are the body's triangles. */
export function solveHipFold(
  rest: RestBones,
  control: Float32Array,
  skinIndex: Uint8Array | Uint16Array,
  skinWeight: Float32Array,
  tris: Uint32Array,
): HipFold {
  const steps = solveHipFoldSteps(rest, control, skinIndex, skinWeight, tris);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/** `solveHipFold` a flexion at a time: it yields after each, so that a caller can let other work in between. */
export function* solveHipFoldSteps(
  rest: RestBones,
  control: Float32Array,
  skinIndex: Uint8Array | Uint16Array,
  skinWeight: Float32Array,
  tris: Uint32Array,
): Generator<void, HipFold> {
  const n = control.length / 3;
  // The thigh's skin by the hip, which moves, and the trunk's, which it must not pass through.
  const parts = foldParts(rest, control, skinIndex, skinWeight, tris, FOLD_THIGH_HOLD);
  const thighs = Array.from(parts.movers);
  // What the fold keeps of each vertex's displacement: all of it near the hip, none by the knee.
  const taper = foldTaper(rest, control);
  const skin = Array.from(parts.skin);
  const hips = [".L", ".R"].map((s) => rest.names.indexOf(HIP_FOLD.bone + s)).filter((b) => b >= 0);
  if (!thighs.length || !skin.length || !hips.length) return noFold(n);
  const patch = new SkinPatch(parts.skin, n);
  const around = neighbours(tris, n);
  const triangles = skin.length / 3;

  const isThigh = new Uint8Array(n);
  for (const v of thighs) isThigh[v] = 1;
  // The trunk's skin that gives: the corners of its triangles in front of the hips.
  const front = nearHips(rest, control, FOLD_TRUNK_REACH, true);
  const isTrunk = new Uint8Array(n);
  for (const v of skin) if (front[v] && !isThigh[v]) isTrunk[v] = 1;
  const trunks = Array.from({ length: n }, (_, v) => v).filter((v) => isTrunk[v] === 1);
  /** Every vertex the fold moves: the thigh's skin, then the trunk's. */
  const movers = thighs.concat(trunks);
  const isMover = new Uint8Array(n);
  for (const v of movers) isMover[v] = 1;

  /** How far each vertex the fold moves has been displaced so far. */
  const D = new Float64Array(n * 3);
  const push = new Float64Array(n * 3);
  /** How far each mover is to be pushed this pass. */
  const size = new Float64Array(n);
  const smoothed = new Float64Array(n * 3);
  /** What a round has pushed each thigh vertex out by, and the trunk triangle it last met (-1 for none). */
  const pushed = new Float64Array(n * 3);
  const against = new Int32Array(n);
  /** How far each trunk vertex is pressed in when a round's contacts are shared, by the left thigh and by the right, and how deep. */
  const presses = [new Float64Array(n * 3), new Float64Array(n * 3)];
  const pressSizes = [new Float64Array(n), new Float64Array(n)];
  /** Which hip drives each vertex (`foldSides`): which thigh a contact is. */
  const sides = foldSides(rest, control, skinIndex, skinWeight);
  // The edges of the body that have a thigh vertex at an end, once.
  const pairs: number[] = [];
  const seen = new Set<number>();
  for (let t = 0; t < tris.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = tris[t + k] as number;
      const b = tris[t + ((k + 1) % 3)] as number;
      if (!isThigh[a] && !isThigh[b]) continue;
      const key = a < b ? a * n + b : b * n + a;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push(a, b);
    }
  /** The edges' ends, two to an edge. */
  const edges = Uint32Array.from(pairs);
  const point = new Float64Array(3);
  const normal = new Float64Array(3);
  const share = new Float64Array(3);
  // The skin whose normal the movers change: they and their neighbours, with the triangles they are corners of.
  const turned = new Set<number>(movers);
  for (const v of movers)
    for (let e = around.start[v] as number; e < (around.start[v + 1] as number); e++)
      turned.add(around.list[e] as number);
  /** Movers first (their rows carry a displacement too), then the neighbours that are not. */
  const affected = movers.concat([...turned].filter((v) => !isMover[v]));
  const incident = new Map<number, number[]>(affected.map((v) => [v, []]));
  for (let t = 0; t < tris.length; t += 3)
    for (let k = 0; k < 3; k++) incident.get(tris[t + k] as number)?.push(t);
  /** Vertex `v`'s unit normal on `pos`: its triangles' normals, each weighted by its area. */
  const vertexNormal = (pos: Float32Array, v: number): Float64Array => {
    const sum = new Float64Array(3);
    for (const t of incident.get(v) ?? []) {
      const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]] as [number, number, number];
      const ux = (pos[b * 3] as number) - (pos[a * 3] as number);
      const uy = (pos[b * 3 + 1] as number) - (pos[a * 3 + 1] as number);
      const uz = (pos[b * 3 + 2] as number) - (pos[a * 3 + 2] as number);
      const wx = (pos[c * 3] as number) - (pos[a * 3] as number);
      const wy = (pos[c * 3 + 1] as number) - (pos[a * 3 + 1] as number);
      const wz = (pos[c * 3 + 2] as number) - (pos[a * 3 + 2] as number);
      sum[0] = (sum[0] as number) + uy * wz - uz * wy;
      sum[1] = (sum[1] as number) + uz * wx - ux * wz;
      sum[2] = (sum[2] as number) + ux * wy - uy * wx;
    }
    const length = Math.hypot(sum[0] as number, sum[1] as number, sum[2] as number) || 1;
    for (let k = 0; k < 3; k++) sum[k] = (sum[k] as number) / length;
    return sum;
  };
  /** Per affected vertex, per key, x, y, z: the displacement (movers only), and the change of the normal. */
  const keyed = new Float32Array(affected.length * FOLD_KEYS * 3);
  const keyedNormal = new Float32Array(affected.length * FOLD_KEYS * 3);
  // Only the vertices the solve reads are skinned: the movers, the trunk's skin, the ends of the edges, and the corners of the triangles whose normals turn.
  const wanted = new Uint8Array(n);
  for (const v of movers) wanted[v] = 1;
  for (const v of skin) wanted[v] = 1;
  for (const v of edges) wanted[v] = 1;
  for (const rows of incident.values())
    for (const t of rows) for (let k = 0; k < 3; k++) wanted[tris[t + k] as number] = 1;
  const needed = Uint32Array.from({ length: n }, (_, v) => v).filter((v) => wanted[v]);
  const neededControl = new Float32Array(needed.length * 3);
  const neededIndex = new Uint16Array(needed.length * 4);
  const neededWeight = new Float32Array(needed.length * 4);
  needed.forEach((v, i) => {
    neededControl.set(control.subarray(v * 3, v * 3 + 3), i * 3);
    for (let k = 0; k < 4; k++) {
      neededIndex[i * 4 + k] = skinIndex[v * 4 + k] as number;
      neededWeight[i * 4 + k] = skinWeight[v * 4 + k] as number;
    }
  });
  /** The hips flexed `degrees`, both, and the vertices the solve reads as the bones put them (the rest are zero). */
  const posedAt = (degrees: number): Float32Array => {
    const rotations = IDENTITY_POSE(rest.names.length);
    const half = (-degrees * Math.PI) / 360;
    for (const b of hips) rotations.set([Math.sin(half), 0, 0, Math.cos(half)], b * 4);
    const posed = skinPositions(
      rest,
      rotations,
      neededControl,
      neededIndex,
      neededWeight,
      new Float32Array(needed.length * 3),
    );
    const out = new Float32Array(n * 3);
    needed.forEach((v, i) => {
      out.set(posed.subarray(i * 3, i * 3 + 3), v * 3);
    });
    return out;
  };
  for (let key = 0; key < FOLD_KEYS; key++) {
    const degrees = HIP_FOLD.from + (key + 1) * HIP_FOLD.step;
    const posed0 = posedAt(degrees);
    const P = new Float32Array(posed0);
    // Halfway back to the last key, the fold is the mean of the two, which is not what is solved: it is looked at too, so that what is between two keys is as clear as they are.
    const before = Float64Array.from(D);
    const posedMid = posedAt(degrees - HIP_FOLD.step / 2);
    const PM = new Float32Array(posedMid);
    const mid = (v: number, k: number) =>
      (posedMid[v * 3 + k] as number) +
      ((before[v * 3 + k] as number) + (D[v * 3 + k] as number)) / 2;
    /** Puts the displacement of `which` (every vertex the fold moves when omitted) on both poses. */
    const place = (which: readonly number[] = movers) => {
      for (const v of which)
        for (let k = 0; k < 3; k++) {
          P[v * 3 + k] = (posed0[v * 3 + k] as number) + (D[v * 3 + k] as number);
          PM[v * 3 + k] = mid(v, k);
        }
    };
    place();

    for (let round = 0; round < ROUNDS; round++) {
      // The trunk's skin holds still while the thigh's is pushed out of it, so the pushes settle.
      const trunkSkin = patch.pose(P);
      const grid = new TriangleGrid(P, skin, triangles);
      const crossings = new TriangleCrossings(P, parts.skin);
      const crossingsMid = new TriangleCrossings(PM, parts.skin);
      pushed.fill(0);
      against.fill(-1);
      // Only the thigh's skin within `NEAR` of the trunk's can meet it this round, and only its edges cross it.
      const close = new Uint8Array(n);
      const active = thighs.filter((v) => {
        const near = grid.near(
          P[v * 3] as number,
          P[v * 3 + 1] as number,
          P[v * 3 + 2] as number,
          NEAR,
        );
        if (near.length) close[v] = 1;
        return near.length > 0;
      });
      const activeEdges: number[] = [];
      for (let e = 0; e < edges.length; e += 2)
        if (close[edges[e] as number] || close[edges[e + 1] as number])
          activeEdges.push(edges[e] as number, edges[e + 1] as number);
      const passes = round === 0 ? PASSES : LATER_PASSES;
      let settled = false;
      for (let pass = 0; pass < passes; pass++) {
        let most = 0;
        // Only the thigh's skin is pushed while the trunk's holds still.
        for (const v of thighs) {
          size[v] = 0;
          push[v * 3] = 0;
          push[v * 3 + 1] = 0;
          push[v * 3 + 2] = 0;
        }
        /**
         * Thigh vertex `v` is `wanted` behind where it may be, by trunk triangle
         * `t`, whose outward normal is `n`: it is pushed out along `n`, if that
         * is more than it is already to be pushed.
         */
        const contact = (v: number, t: number, n: ArrayLike<number>, wanted: number) => {
          most = Math.max(most, wanted);
          // However far behind a plane, a pass moves skin only so far: what is behind a plane is not always behind its triangle.
          const need = Math.min(wanted, MOST_PUSH);
          if (need <= (size[v] as number)) return;
          size[v] = need;
          against[v] = t;
          for (let k = 0; k < 3; k++) push[v * 3 + k] = (n[k] as number) * need;
        };
        // Skin behind the trunk's, by the nearest of it...
        for (const v of active) {
          const [x, y, z] = [P[v * 3] as number, P[v * 3 + 1] as number, P[v * 3 + 2] as number];
          const near = grid.near(x, y, z, REACH);
          if (!near.length) continue;
          const c = trunkSkin.signed(x, y, z, point, near, normal);
          if (CLEARANCE - c > 0) contact(v, trunkSkin.nearest, normal, CLEARANCE - c);
        }
        // ... and skin whose edges pass through it, which is what is seen, wherever the nearest of it is;
        // halfway, a push of the key moves the skin half as far, so it is twice what is behind.
        const through = (c: TriangleCrossings, t: number, v: number, scale: number) => {
          if (!isThigh[v]) return;
          const behind = -c.side(t, v);
          if (behind <= 0) return;
          c.normal(t, normal);
          contact(v, t, normal, scale * behind + CLEARANCE);
        };
        for (const [c, scale] of [
          [crossings, 1],
          [crossingsMid, 2],
        ] as const)
          for (let e = 0; e < activeEdges.length; e += 2) {
            const a = activeEdges[e] as number;
            const b = activeEdges[e + 1] as number;
            const found = c.find(a, b);
            for (let h = 0; h < found; h++) {
              through(c, c.hits[h] as number, a, scale);
              through(c, c.hits[h] as number, b, scale);
            }
          }
        if (most < TOLERANCE) {
          settled = true;
          break;
        }
        // The first pushes of a round spread over the neighbouring skin, so the thigh's moves as a surface, not vertex by vertex.
        if (pass < SPREADING)
          for (let again = 0; again < SPREADS; again++) {
            for (const v of thighs) {
              const [from, to] = [around.start[v] as number, around.start[v + 1] as number];
              for (let k = 0; k < 3; k++) {
                let sum = 0;
                for (let e = from; e < to; e++)
                  sum += push[(around.list[e] as number) * 3 + k] as number;
                smoothed[v * 3 + k] =
                  (1 - SPREAD) * (push[v * 3 + k] as number) +
                  (SPREAD * sum) / Math.max(1, to - from);
              }
            }
            for (const v of thighs)
              for (let k = 0; k < 3; k++) push[v * 3 + k] = smoothed[v * 3 + k] as number;
          }
        // A vertex in a concave corner is pushed out of one triangle into the next and back; pushing less each time settles it.
        const relax = pass < RELAX_FROM ? 1 : RELAXED;
        for (const v of thighs)
          for (let k = 0; k < 3; k++) {
            const step = (push[v * 3 + k] as number) * relax;
            D[v * 3 + k] = (D[v * 3 + k] as number) + step;
            pushed[v * 3 + k] = (pushed[v * 3 + k] as number) + step;
          }
        place(thighs);
      }
      // A round that did not settle (a thigh wedged against a belly with nowhere to go) has
      // pushes that are no contact's, and nothing of them is shared: the step ends as it is.
      if (round === ROUNDS - 1 || !settled) break;
      // The trunk gives its share: what the round pushed the thigh's skin out by, the thigh's
      // skin gives back `TRUNK_GIVE` of, and the trunk's triangle it met is pressed in as far
      // (its corners by their share of the point nearest the thigh's skin, the least press
      // that moves that point so far; a corner pressed by two contacts of one thigh takes the deeper).
      for (const p of presses) p.fill(0);
      for (const s of pressSizes) s.fill(0);
      for (const v of thighs) {
        // All the thigh's skin the round pushed gives back alike, so the push stays as smooth as it was.
        for (let k = 0; k < 3; k++) {
          const gave = TRUNK_GIVE * (pushed[v * 3 + k] as number);
          D[v * 3 + k] = (D[v * 3 + k] as number) - gave;
          normal[k] = gave;
        }
        const t = against[v] as number;
        if (t < 0) continue;
        // Each thigh's press is its own, and the two add: skin between the legs, pressed from both sides, is squeezed, not pushed in.
        const by2 = (sides[v] as number) >= 0.5 ? 0 : 1;
        const press = presses[by2] as Float64Array;
        const size = pressSizes[by2] as Float64Array;
        const corners = parts.skin.subarray(t * 3, t * 3 + 3);
        barycentric(P, corners, v, share);
        const across =
          (share[0] as number) ** 2 + (share[1] as number) ** 2 + (share[2] as number) ** 2;
        for (let c = 0; c < 3; c++) {
          const corner = corners[c] as number;
          if (!isTrunk[corner]) continue;
          const by = (share[c] as number) / (across || 1);
          const deep =
            by * Math.hypot(normal[0] as number, normal[1] as number, normal[2] as number);
          if (deep <= (size[corner] as number)) continue;
          size[corner] = deep;
          for (let k = 0; k < 3; k++) press[corner * 3 + k] = -by * (normal[k] as number);
        }
      }
      // The press spread over the trunk's neighbouring skin, so the belly gives as a surface and
      // is not dimpled at a corner (a dimple's triangles tip, and would push the thigh askew).
      for (const press of presses) {
        // Skin the trunk does not move (beyond it, or the thigh's) holds its neighbours' press toward nothing.
        for (let again = 0; again < PRESS_SPREADS; again++) {
          for (const v of trunks) {
            const [from, to] = [around.start[v] as number, around.start[v + 1] as number];
            for (let k = 0; k < 3; k++) {
              let sum = 0;
              for (let e = from; e < to; e++) {
                const u = around.list[e] as number;
                if (isTrunk[u]) sum += press[u * 3 + k] as number;
              }
              smoothed[v * 3 + k] =
                (1 - PRESS_SPREAD) * (press[v * 3 + k] as number) +
                (PRESS_SPREAD * sum) / Math.max(1, to - from);
            }
          }
          for (const v of trunks)
            for (let k = 0; k < 3; k++) press[v * 3 + k] = smoothed[v * 3 + k] as number;
        }
        for (const v of trunks)
          for (let k = 0; k < 3; k++)
            D[v * 3 + k] = (D[v * 3 + k] as number) + (press[v * 3 + k] as number);
      }
      place();
    }
    affected.forEach((v, a) => {
      const at = (a * FOLD_KEYS + key) * 3;
      const was = vertexNormal(posed0, v);
      const now = vertexNormal(P, v);
      for (let k = 0; k < 3; k++) {
        if (a < movers.length) keyed[at + k] = (D[v * 3 + k] as number) * (taper[v] as number);
        keyedNormal[at + k] = ((now[k] as number) - (was[k] as number)) * (taper[v] as number);
      }
    });
    yield;
  }
  // Only the vertices the fold ever moves or turns are kept.
  const stride = FOLD_KEYS * 3;
  const kept = affected.flatMap((_, a) => {
    for (let i = 0; i < stride; i++)
      if (keyed[a * stride + i] !== 0 || keyedNormal[a * stride + i] !== 0) return [a];
    return [];
  });
  const fold = noFold(n);
  const vertices = Uint32Array.from(kept, (a) => affected[a] as number);
  const vectors = new Float32Array(kept.length * stride);
  const normals = new Float32Array(kept.length * stride);
  const side = Float32Array.from(vertices, (v) => sides[v] as number);
  kept.forEach((a, s) => {
    fold.slot[affected[a] as number] = s;
    vectors.set(keyed.subarray(a * stride, (a + 1) * stride), s * stride);
    normals.set(keyedNormal.subarray(a * stride, (a + 1) * stride), s * stride);
  });
  return { vertices, slot: fold.slot, vectors, normals, side };
}

/** The trunk's triangles by where their centres are, to find those near a point without testing them all. */
class TriangleGrid {
  /** The grid's lowest corner, and its size in cells along each axis. */
  private readonly low: [number, number, number] = [0, 0, 0];
  private readonly size: [number, number, number] = [1, 1, 1];
  /** Triangle numbers by cell, in rows: cell `c` holds `list[start[c]..start[c + 1]]`. */
  private readonly start: Uint32Array;
  private readonly list: Uint32Array;
  /** Scratch for `near`: the triangles found, and how near their nearest points can be. */
  private readonly found: Int32Array;
  private readonly away: Float32Array;
  /** Where each triangle's centre is, and how far from it its farthest corner. */
  private readonly centres: Float32Array;
  private readonly radius: Float32Array;
  /** The largest radius. */
  private readonly widest: number;

  constructor(positions: Float32Array, skin: readonly number[], triangles: number) {
    const centres = new Float32Array(triangles * 3);
    this.centres = centres;
    this.found = new Int32Array(triangles);
    this.away = new Float32Array(triangles);
    this.radius = new Float32Array(triangles);
    const high = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
    const low = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    for (let t = 0; t < triangles; t++)
      for (let k = 0; k < 3; k++) {
        const c =
          ((positions[(skin[t * 3] as number) * 3 + k] as number) +
            (positions[(skin[t * 3 + 1] as number) * 3 + k] as number) +
            (positions[(skin[t * 3 + 2] as number) * 3 + k] as number)) /
          3;
        centres[t * 3 + k] = c;
        low[k] = Math.min(low[k] as number, c);
        high[k] = Math.max(high[k] as number, c);
      }
    let widest = 0;
    for (let t = 0; t < triangles; t++) {
      let r = 0;
      for (let c = 0; c < 3; c++) {
        const v = skin[t * 3 + c] as number;
        r = Math.max(
          r,
          Math.hypot(
            (positions[v * 3] as number) - (centres[t * 3] as number),
            (positions[v * 3 + 1] as number) - (centres[t * 3 + 1] as number),
            (positions[v * 3 + 2] as number) - (centres[t * 3 + 2] as number),
          ),
        );
      }
      this.radius[t] = r;
      widest = Math.max(widest, r);
    }
    this.widest = widest;
    for (let k = 0; k < 3; k++) {
      this.low[k] = low[k] as number;
      this.size[k] = Math.floor(((high[k] as number) - (low[k] as number)) / CELL) + 1;
    }
    const cells = this.size[0] * this.size[1] * this.size[2];
    this.start = new Uint32Array(cells + 1);
    const of = new Uint32Array(triangles);
    for (let t = 0; t < triangles; t++) {
      of[t] = this.cell(
        centres[t * 3] as number,
        centres[t * 3 + 1] as number,
        centres[t * 3 + 2] as number,
      );
      this.start[(of[t] as number) + 1] = (this.start[(of[t] as number) + 1] as number) + 1;
    }
    for (let c = 0; c < cells; c++)
      this.start[c + 1] = (this.start[c + 1] as number) + (this.start[c] as number);
    this.list = new Uint32Array(triangles);
    const filled = new Uint32Array(cells);
    for (let t = 0; t < triangles; t++) {
      const c = of[t] as number;
      this.list[(this.start[c] as number) + (filled[c] as number)++] = t;
    }
  }

  private cell(x: number, y: number, z: number): number {
    const [sx, sy] = this.size;
    return (
      Math.floor((x - this.low[0]) / CELL) +
      sx * (Math.floor((y - this.low[1]) / CELL) + sy * Math.floor((z - this.low[2]) / CELL))
    );
  }

  /**
   * The triangles that can hold the point nearest (x, y, z) when it is within
   * `reach` of the trunk's skin: those no further from it than the farthest
   * another triangle is sure to be (a triangle lies within its radius of its
   * centre). None when the point is not within reach. The list is reused.
   */
  near(x: number, y: number, z: number, reach: number): Int32Array {
    const r = reach + this.widest;
    const [sx, sy, sz] = this.size;
    const range = (v: number, axis: 0 | 1 | 2, size: number): [number, number] => [
      Math.max(0, Math.floor((v - r - this.low[axis]) / CELL)),
      Math.min(size - 1, Math.floor((v + r - this.low[axis]) / CELL)),
    ];
    const [i0, i1] = range(x, 0, sx);
    const [j0, j1] = range(y, 1, sy);
    const [k0, k1] = range(z, 2, sz);
    const { found, away, centres, radius } = this;
    let count = 0;
    let sure = Number.POSITIVE_INFINITY;
    for (let k = k0; k <= k1; k++)
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const c = i + sx * (j + sy * k);
          for (let e = this.start[c] as number; e < (this.start[c + 1] as number); e++) {
            const t = this.list[e] as number;
            const d = Math.sqrt(
              ((centres[t * 3] as number) - x) ** 2 +
                ((centres[t * 3 + 1] as number) - y) ** 2 +
                ((centres[t * 3 + 2] as number) - z) ** 2,
            );
            // The triangle's nearest point is no nearer than `d - radius` and no further than `d + radius`.
            found[count] = t;
            away[count++] = d - (radius[t] as number);
            sure = Math.min(sure, d + (radius[t] as number));
          }
        }
    if (sure > reach + this.widest) return found.subarray(0, 0);
    let kept = 0;
    for (let e = 0; e < count; e++)
      if ((away[e] as number) <= sure) found[kept++] = found[e] as number;
    return found.subarray(0, kept);
  }
}

/**
 * The shares (each 0 to 1, summing to 1) of `corners`' three vertices in the
 * point of their triangle nearest vertex `v`'s projection on its plane, all on
 * `P`, into `out`.
 */
function barycentric(
  P: Float32Array,
  corners: ArrayLike<number>,
  v: number,
  out: Float64Array,
): void {
  const a = (corners[0] as number) * 3;
  const b = (corners[1] as number) * 3;
  const c = (corners[2] as number) * 3;
  const e1 = [0, 1, 2].map((k) => (P[b + k] as number) - (P[a + k] as number));
  const e2 = [0, 1, 2].map((k) => (P[c + k] as number) - (P[a + k] as number));
  const r = [0, 1, 2].map((k) => (P[v * 3 + k] as number) - (P[a + k] as number));
  const dot = (x: number[], y: number[]) =>
    (x[0] as number) * (y[0] as number) +
    (x[1] as number) * (y[1] as number) +
    (x[2] as number) * (y[2] as number);
  const d11 = dot(e1, e1);
  const d12 = dot(e1, e2);
  const d22 = dot(e2, e2);
  const d1 = dot(r, e1);
  const d2 = dot(r, e2);
  const det = d11 * d22 - d12 * d12 || 1;
  const u = Math.max(0, (d22 * d1 - d12 * d2) / det);
  const w = Math.max(0, (d11 * d2 - d12 * d1) / det);
  const o = Math.max(0, 1 - u - w);
  const sum = u + w + o || 1;
  out[0] = o / sum;
  out[1] = u / sum;
  out[2] = w / sum;
}

/** Each vertex's neighbours along the triangles' edges, in compressed rows. */
function neighbours(tris: Uint32Array, n: number): { start: Uint32Array; list: Uint32Array } {
  const sets = Array.from({ length: n }, () => new Set<number>());
  for (let t = 0; t < tris.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = tris[t + k] as number;
      const b = tris[t + ((k + 1) % 3)] as number;
      sets[a]?.add(b);
      sets[b]?.add(a);
    }
  const start = new Uint32Array(n + 1);
  for (let v = 0; v < n; v++) start[v + 1] = (start[v] as number) + (sets[v]?.size ?? 0);
  const list = new Uint32Array(start[n] as number);
  sets.forEach((s, v) => {
    let at = start[v] as number;
    for (const u of s) list[at++] = u;
  });
  return { start, list };
}
