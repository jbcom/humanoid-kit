/**
 * Identity-keyed site-contact solve cache.  The expensive surface solve runs
 * only when an immutable evaluated body, target, shape, or source pose changes.
 */
import type { BoneRotations } from "../rig/bones.ts";
import { slerp } from "../rig/quat.ts";
import {
  type HandShape,
  type SiteContactFigure,
  type SiteContactInput,
  type SiteContactReport,
  solveSiteContact,
} from "./siteContact.ts";

/** A source pose with an identity that changes whenever its values change. */
export interface SiteContactSource {
  /** Immutable identity for this exact source-pose sample. */
  readonly generation: object;
  /** The source rotations represented by `generation`; do not mutate while retained. */
  readonly rotations: BoneRotations;
}

/** The named self-contact target. Its identity is part of the cache key. */
export interface SiteContactTarget {
  readonly effector: string;
  readonly site: string;
}

/** The frame-level input to a cached self-contact constraint. */
export interface SiteContactConstraintInput {
  /** False releases immediately: `out` is the source pose byte-for-byte. */
  readonly active: boolean;
  readonly figure: SiteContactFigure;
  /** Must be the same object as `figure.generation`, never a rendered mesh identity. */
  readonly geometryGeneration: object;
  readonly source: SiteContactSource;
  readonly target: SiteContactTarget;
  readonly shape?: HandShape;
  readonly standoff?: number;
  readonly weight?: number;
  readonly iterations?: number;
  readonly tolerance?: number;
  /** Receives either the cached constrained pose or the untouched source pose. */
  readonly out: BoneRotations;
}

export type SiteContactConstraintState = "idle" | "blending" | "holding" | "released" | "cancelled";

export interface SiteContactConstraintReport {
  readonly state: SiteContactConstraintState;
  /** How much of the cached solved pose was applied to this frame. */
  readonly weight: number;
  /**
   * The full-weight solve receipt. During `blending`, it is intentionally not a
   * claim that the partly blended rendered pose has already reached the site.
   */
  readonly solution: SiteContactReport | null;
}

export type SiteContactSolver = (input: SiteContactInput) => SiteContactReport;

interface CachedSolve {
  figureGeneration: object;
  sourceGeneration: object;
  source: BoneRotations;
  sourceSnapshot: BoneRotations;
  target: SiteContactTarget;
  effector: string;
  site: string;
  shape: HandShape | undefined;
  standoff: number | undefined;
  iterations: number | undefined;
  tolerance: number | undefined;
  /** Full-weight result; dynamic blend weight is applied from this exact source pose. */
  solved: BoneRotations;
  report: SiteContactReport;
}

const cloneReport = (report: SiteContactReport): SiteContactReport => ({
  ...report,
  ...(report.contact && {
    contact: {
      ...report.contact,
      position: [...report.contact.position] as [number, number, number],
      normal: [...report.contact.normal] as [number, number, number],
      centreToContact: [...report.contact.centreToContact] as [number, number, number],
    },
  }),
});

function sameValues(a: BoneRotations, b: BoneRotations): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sameSolve(
  cached: CachedSolve | null,
  input: SiteContactConstraintInput,
  shape: HandShape | undefined,
): cached is CachedSolve {
  return Boolean(
    cached &&
      cached.figureGeneration === input.geometryGeneration &&
      cached.sourceGeneration === input.source.generation &&
      cached.source === input.source.rotations &&
      sameValues(cached.sourceSnapshot, input.source.rotations) &&
      cached.target === input.target &&
      cached.effector === input.target.effector &&
      cached.site === input.target.site &&
      cached.shape === shape &&
      cached.standoff === input.standoff &&
      cached.iterations === input.iterations &&
      cached.tolerance === input.tolerance,
  );
}

function copyWeighted(
  source: BoneRotations,
  solved: BoneRotations,
  weight: number,
  out: BoneRotations,
): void {
  if (weight === 1) {
    out.set(solved);
    return;
  }
  for (let at = 0; at < source.length; at += 4)
    out.set(
      slerp(
        [
          source[at] as number,
          source[at + 1] as number,
          source[at + 2] as number,
          source[at + 3] as number,
        ],
        [
          solved[at] as number,
          solved[at + 1] as number,
          solved[at + 2] as number,
          solved[at + 3] as number,
        ],
        weight,
      ),
      at,
    );
}

/**
 * Keeps a solved self-contact pose for one immutable source sample. An animation
 * adapter must publish a new `source.generation` when its clip writes new values;
 * retaining an identity across mutation is rejected rather than reusing stale skin.
 */
export interface SiteContactConstraint {
  update(input: SiteContactConstraintInput): Readonly<SiteContactConstraintReport>;
  /** Drops the retained solve. The next active update solves again. */
  invalidate(): void;
  /** Writes the source pose unchanged, drops the solve, and marks the constraint released. */
  release(source: SiteContactSource, out: BoneRotations): Readonly<SiteContactConstraintReport>;
  /** Cancels without a fade: writes the source pose and forgets the retained solve. */
  cancel(source: SiteContactSource, out: BoneRotations): Readonly<SiteContactConstraintReport>;
  /** Releases all retained buffers permanently. No later update is permitted. */
  dispose(): void;
  readonly report: Readonly<SiteContactConstraintReport>;
}

export function createSiteContactConstraint(
  solve: SiteContactSolver = solveSiteContact,
): SiteContactConstraint {
  let cached: CachedSolve | null = null;
  let disposed = false;
  let report: SiteContactConstraintReport = { state: "idle", weight: 0, solution: null };

  const ensureLive = () => {
    if (disposed) throw new Error("site contact constraint: disposed");
  };
  const stop = (
    state: Extract<SiteContactConstraintState, "released" | "cancelled">,
    source: SiteContactSource,
    out: BoneRotations,
  ) => {
    ensureLive();
    if (out.length !== source.rotations.length)
      throw new RangeError("site contact constraint: out must match source rotations");
    out.set(source.rotations);
    cached = null;
    report = { state, weight: 0, solution: null };
    return report;
  };
  const release = (source: SiteContactSource, out: BoneRotations) => stop("released", source, out);

  return {
    update(input) {
      ensureLive();
      if (input.figure.generation !== input.geometryGeneration)
        throw new Error("site contact constraint: geometry generation is stale");
      if (input.out.length !== input.source.rotations.length)
        throw new RangeError("site contact constraint: out must match source rotations");
      if (!input.active) return release(input.source, input.out);
      const weight = input.weight ?? 1;
      if (!(weight >= 0 && weight <= 1))
        throw new RangeError("site contact constraint: weight must be from 0 to 1");
      const shape = input.shape;
      if (
        cached?.sourceGeneration === input.source.generation &&
        !sameValues(cached.sourceSnapshot, input.source.rotations)
      )
        throw new Error("site contact constraint: source pose changed without a new generation");
      if (
        cached?.target === input.target &&
        (cached.effector !== input.target.effector || cached.site !== input.target.site)
      )
        throw new Error("site contact constraint: target changed without a new identity");
      if (!sameSolve(cached, input, shape)) {
        const solved = new Float32Array(input.source.rotations.length);
        const contact = solve({
          figure: input.figure,
          source: input.source.rotations,
          effector: input.target.effector,
          site: input.target.site,
          ...(shape && { shape }),
          ...(input.standoff !== undefined && { standoff: input.standoff }),
          ...(input.iterations !== undefined && { iterations: input.iterations }),
          ...(input.tolerance !== undefined && { tolerance: input.tolerance }),
          weight: 1,
          out: solved,
        });
        cached = {
          figureGeneration: input.geometryGeneration,
          sourceGeneration: input.source.generation,
          source: input.source.rotations,
          sourceSnapshot: Float32Array.from(input.source.rotations),
          target: input.target,
          effector: input.target.effector,
          site: input.target.site,
          shape,
          standoff: input.standoff,
          iterations: input.iterations,
          tolerance: input.tolerance,
          solved,
          report: cloneReport(contact),
        };
      }
      copyWeighted(input.source.rotations, cached.solved, weight, input.out);
      report = {
        state: weight < 1 ? "blending" : "holding",
        weight,
        solution: cloneReport(cached.report),
      };
      return report;
    },
    invalidate() {
      ensureLive();
      cached = null;
      report = { state: "idle", weight: 0, solution: null };
    },
    release,
    cancel(source, out) {
      return stop("cancelled", source, out);
    },
    dispose() {
      if (disposed) return;
      cached = null;
      report = { state: "released", weight: 0, solution: null };
      disposed = true;
    },
    get report() {
      return report;
    },
  };
}
