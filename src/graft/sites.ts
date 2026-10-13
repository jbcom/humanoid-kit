/**
 * The cut-loop registry (docs/GRAFT.md, "The cut-loop registry"): the places a
 * part can be grafted, each a rule that resolves, on the base mesh at rest, to
 * one closed edge loop of the control mesh.
 */
import type { Vec3 } from "./types.ts";

export interface CutSite {
  /** The plane runs through the point `at` of the way from `from` to `to` (skeleton joints, bone heads), normal along them. */
  from: string;
  to: string;
  at: number;
  /** The bone the part is bound to. */
  rootBone: string;
  /** The body's front: where a loop's samples start. */
  forward: Vec3;
}

const FRONT: Vec3 = [0, 0, 1];

const side = (s: "L" | "R"): Record<string, CutSite> => ({
  [`wrist.${s}`]: {
    from: `lowerarm01.${s}____head`,
    to: `wrist.${s}____head`,
    at: 1,
    rootBone: `wrist.${s}`,
    forward: FRONT,
  },
  [`ankle.${s}`]: {
    from: `lowerleg01.${s}____head`,
    to: `foot.${s}____head`,
    at: 1,
    rootBone: `foot.${s}`,
    forward: FRONT,
  },
});

export const CUT_SITES: Readonly<Record<string, CutSite>> = {
  // At 0.3 of the neck the chin stays clear of the plane; halfway up, it dips below it.
  neck: { from: "neck01____head", to: "head____head", at: 0.3, rootBone: "head", forward: FRONT },
  ...side("L"),
  ...side("R"),
};
