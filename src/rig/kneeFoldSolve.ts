import type { RestBones } from "./bones.ts";
import { type FoldSetup, runSolve, solveFold } from "./foldSolve.ts";
import { jointRotations } from "./folds.ts";
import { FOLD_PRESS } from "./hipFold.ts";
import { type JointFold, noFold } from "./jointFold.ts";
import { KNEE_FOLD, kneeParts, kneeSides, kneeTaper } from "./kneeFold.ts";

/**
 * Solves a figure's knee fold (docs/ARCHITECTURE.md, "The knee fold"): for each
 * key flexion of `KNEE_FOLD`, how far each vertex of the skin round the knee
 * must move, from where the bones put it with both knees bent so far, for the
 * calf's skin to lie against the thigh's and not through it, and for the back
 * of the knee to fold over no skin. The solve is the joint fold's (`solveFold`):
 * the calf's skin is pushed out of the thigh's, and the thigh's gives
 * `KNEE_GIVE` of each contact.
 */

/**
 * The share of a contact the thigh's skin gives, pressed in; the calf's takes
 * the rest. CHOICE: half, the back of the thigh (the hamstrings) and the calf
 * being muscle alike.
 */
export const KNEE_GIVE = 0.5;

/** What the knee fold is solved from (`FoldSetup`), or null for a skeleton without knees. */
export function kneeFoldSetup(
  rest: RestBones,
  control: Float32Array,
  skinIndex: Uint8Array | Uint16Array,
  skinWeight: Float32Array,
  tris: Uint32Array,
): FoldSetup | null {
  const n = control.length / 3;
  const knees = [".L", ".R"]
    .map((s) => rest.names.indexOf(KNEE_FOLD.bone + s))
    .filter((b) => b >= 0);
  if (!knees.length) return null;
  const parts = kneeParts(rest, control, skinIndex, skinWeight, tris);
  const isCalf = new Uint8Array(n);
  for (const v of parts.calf) isCalf[v] = 1;
  // All the thigh's skin by the knee gives, but what is the calf's.
  const givers = new Uint8Array(n);
  for (const v of parts.thigh) if (!isCalf[v]) givers[v] = 1;
  return {
    joint: KNEE_FOLD,
    movers: parts.calf,
    patch: parts.thigh,
    givers,
    pressing: parts.calfSkin,
    give: KNEE_GIVE,
    press: FOLD_PRESS,
    patchSmooths: "folded",
    mutual: true,
    smoothsShaded: true,
    taper: kneeTaper(rest, control),
    sides: kneeSides(rest, control, skinIndex, skinWeight),
    rotationsAt: (degrees, opening) => jointRotations(KNEE_FOLD, rest, degrees, opening),
  };
}

/** The knee fold of the figure whose rest vertices are `control`, skeleton `rest`, skinned by `skinIndex` and `skinWeight`; `tris` are the body's triangles. */
export function solveKneeFold(
  rest: RestBones,
  control: Float32Array,
  skinIndex: Uint8Array | Uint16Array,
  skinWeight: Float32Array,
  tris: Uint32Array,
): JointFold {
  return runSolve(solveKneeFoldSteps(rest, control, skinIndex, skinWeight, tris));
}

/** `solveKneeFold` a flexion at a time: it yields after each, so that a caller can let other work in between. */
export function* solveKneeFoldSteps(
  rest: RestBones,
  control: Float32Array,
  skinIndex: Uint8Array | Uint16Array,
  skinWeight: Float32Array,
  tris: Uint32Array,
): Generator<void, JointFold> {
  const setup = kneeFoldSetup(rest, control, skinIndex, skinWeight, tris);
  if (!setup) return noFold(control.length / 3, KNEE_FOLD);
  return yield* solveFold(rest, control, skinIndex, skinWeight, tris, setup);
}
