import type { FrameOut } from "humanoid-kit";
import type { HumanoidAffordances } from "humanoid-kit/react";

/** The hand-frame dependency a review marker needs from a settled rendered figure. */
export interface HandFrameRequest {
  readonly figure: string;
  readonly settled: boolean;
  readonly affordances: HumanoidAffordances;
  readonly out: FrameOut;
}

/** Reads the right-hand frame for a review marker. */
export function sampleRequiredHandFrame(request: HandFrameRequest): FrameOut | null {
  // `<Humanoid>` binds its affordances after mounting. A render-loop marker can
  // arrive first, so a pre-settled read is pending rather than an absent hand.
  if (!request.settled) return null;
  // Once the figure says it is settled, absence is a real binding regression,
  // not a normal loading state. Fail the review fixture with its figure id.
  if (!request.affordances.has("hand.R"))
    throw new Error(`${request.figure} settled without required hand.R affordance`);
  return request.affordances.frame("hand.R", "world", request.out);
}
