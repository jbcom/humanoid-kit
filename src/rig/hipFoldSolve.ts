import type { RestBones } from "./bones.ts";
import {
  DEFAULT_FOLD_SOLVE_PASSES,
  type FoldSetup,
  resolveFoldSolvePasses,
  runSolve,
  solveFold,
} from "./foldSolve.ts";
import { jointRotations } from "./folds.ts";
import {
  FOLD_BODIES,
  FOLD_PRESS,
  FOLD_REACH,
  FOLD_THIGH_HOLD,
  FOLD_TRUNK_REACH,
  foldParts,
  foldSides,
  foldTaper,
  HIP_FOLD,
  nearHips,
} from "./hipFold.ts";
import { boneMass, type JointFold, noFold } from "./jointFold.ts";

/**
 * Solves a figure's hip fold (docs/ARCHITECTURE.md, "The hip fold"): for each
 * key flexion and opening of `HIP_FOLD`, how far each vertex of the skin
 * around the hip's front must move, from where the bones put it with both hips
 * flexed and opened so far, for the thigh's skin to lie against the trunk's and
 * not through it. The solve is the joint fold's (`solveFold`): the thigh's skin
 * is pushed out of the trunk's, and the belly and the groin in front of the
 * hips give `TRUNK_GIVE` of each contact.
 */

/**
 * The share of a contact the trunk's skin gives, pressed in; the thigh's takes
 * the rest. CHOICE, measured over the smoke tier (docs/ARCHITECTURE.md, "The
 * hip fold"): the lower belly and the groin are softer than the front of the
 * thigh, and of 0.3, 0.45, 0.6 and 0.75 a share of 0.6 left the fewest rows worse.
 */
export const TRUNK_GIVE = 0.6;

/** What the hip fold is solved from (`FoldSetup`), or null for a skeleton without hips. */
export function hipFoldSetup(
  rest: RestBones,
  control: Float32Array,
  skinIndex: Uint8Array | Uint16Array,
  skinWeight: Float32Array,
  tris: Uint32Array,
): FoldSetup | null {
  const n = control.length / 3;
  const hips = [".L", ".R"].map((s) => rest.names.indexOf(HIP_FOLD.bone + s)).filter((b) => b >= 0);
  if (!hips.length) return null;
  // The thigh's skin by the hip, which moves, and the trunk's, which it must not pass through.
  const parts = foldParts(rest, control, skinIndex, skinWeight, tris, FOLD_THIGH_HOLD);
  const isThigh = new Uint8Array(n);
  for (const v of parts.movers) isThigh[v] = 1;
  // The trunk's skin that gives: the corners of its triangles in front of the hips.
  const front = nearHips(rest, control, FOLD_TRUNK_REACH, true);
  const givers = new Uint8Array(n);
  for (const v of parts.skin) if (front[v] && !isThigh[v]) givers[v] = 1;
  // The thighs' skin by the hips, all of it (not only what the fold moves): what the trunk's press must be near.
  const trunkMass = boneMass(rest.names, skinIndex, skinWeight, FOLD_BODIES.trunk);
  const nearThigh = nearHips(rest, control, FOLD_REACH);
  const thighSkin = (v: number) =>
    nearThigh[v] === 1 && (parts.thigh[v] as number) > (trunkMass[v] as number);
  const pressing: number[] = [];
  for (let t = 0; t < tris.length; t += 3)
    if ([0, 1, 2].every((k) => thighSkin(tris[t + k] as number)))
      pressing.push(tris[t] as number, tris[t + 1] as number, tris[t + 2] as number);
  return {
    joint: HIP_FOLD,
    movers: parts.movers,
    patch: parts.skin,
    givers,
    pressing: Uint32Array.from(pressing),
    give: TRUNK_GIVE,
    press: FOLD_PRESS,
    patchSmooths: "touched",
    mutual: false,
    smoothsShaded: false,
    // What the fold keeps of each vertex's displacement: all of it near the hip, none by the knee.
    taper: foldTaper(rest, control),
    sides: foldSides(rest, control, skinIndex, skinWeight),
    rotationsAt: (degrees, opening) => jointRotations(HIP_FOLD, rest, degrees, opening),
  };
}

/** The hip fold of the figure whose rest vertices are `control`, skeleton `rest`, skinned by `skinIndex` and `skinWeight`; `tris` are the body's triangles. */
export function solveHipFold(
  rest: RestBones,
  control: Float32Array,
  skinIndex: Uint8Array | Uint16Array,
  skinWeight: Float32Array,
  tris: Uint32Array,
  foldSolvePasses = DEFAULT_FOLD_SOLVE_PASSES,
): JointFold {
  return runSolve(solveHipFoldSteps(rest, control, skinIndex, skinWeight, tris, foldSolvePasses));
}

/** `solveHipFold` a flexion at a time: it yields after each, so that a caller can let other work in between. */
export function* solveHipFoldSteps(
  rest: RestBones,
  control: Float32Array,
  skinIndex: Uint8Array | Uint16Array,
  skinWeight: Float32Array,
  tris: Uint32Array,
  foldSolvePasses = DEFAULT_FOLD_SOLVE_PASSES,
): Generator<void, JointFold> {
  resolveFoldSolvePasses(foldSolvePasses);
  const setup = hipFoldSetup(rest, control, skinIndex, skinWeight, tris);
  if (!setup) return noFold(control.length / 3, HIP_FOLD);
  return yield* solveFold(rest, control, skinIndex, skinWeight, tris, setup, foldSolvePasses);
}
