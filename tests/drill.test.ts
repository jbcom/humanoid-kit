/**
 * Acceptance gates for the kit-authored 1860s drill and prayer clips. These
 * exercise the posed, grounded skin rather than only their bone channels: the
 * same surface and sole lift used when a paused clip is drawn.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { DRILLS } from "../scripts/lib/drill.ts";
import {
  type DrillWorklist,
  drillFindings,
  keyId,
  authoredKeys as keysOf,
  WORKLIST_ROUNDING,
} from "../scripts/lib/drillWorklist.ts";
import { clip, figure, stanceDrift } from "./animationHarness.ts";
import { DRILL_FIGURES, drillFigure } from "./drillHarness.ts";

const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(
    (a[0] as number) - (b[0] as number),
    (a[1] as number) - (b[1] as number),
    (a[2] as number) - (b[2] as number),
  );

/** The lowest drawn skin point close to the named joint, after the renderer's sole lift. */
function groundDistanceNear(
  positions: Float32Array,
  lift: number,
  joint: readonly number[],
  radius: number,
): number {
  // `body.positions` are before the renderer's ground lift; landmarks from the
  // drill harness already include it. Keep the nearest-skin search in the
  // body's frame, then measure the returned point in the grounded frame.
  const unliftedJoint = [joint[0] as number, (joint[1] as number) - lift, joint[2] as number];
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < positions.length; i += 3) {
    const point: [number, number, number] = [
      positions[i] as number,
      positions[i + 1] as number,
      positions[i + 2] as number,
    ];
    if (distance(point, unliftedJoint) <= radius) best = Math.min(best, Math.abs(point[1] + lift));
  }
  return best;
}

declare module "vitest" {
  interface ProvidedContext {
    /** How many times its budget a test that sets its own gets: 3 when coverage instruments it. */
    budgetScale: number;
  }
}

const stationaryFigure = {
  "slim@25": figure("slim", 25),
  "heavy@35": figure("heavy", 35),
  "older@70": figure("average", 70),
  "average@25": figure("average", 25),
} as const;

/**
 * The authored clips do not meet the drill yet (#15). Every Hardee count without
 * a key and every contact miss is on the reviewed worklist
 * (`docs/evidence/drill-worklist.json`, `scripts/drill-worklist.ts`). This is a
 * regression budget, not acceptance:
 * - a recorded miss may shrink but not grow;
 * - nothing off the list may start missing;
 * - an entry that passes now must come off the list.
 */
const worklist: DrillWorklist = JSON.parse(
  fs.readFileSync(
    path.resolve(import.meta.dirname, "../docs/evidence/drill-worklist.json"),
    "utf8",
  ),
);

/**
 * Every judged figure's sampler is made once, before the tests: each solves its
 * figure's joint folds for the support path, about 9 s a figure on the M2 Max
 * pool host (37 s for the four), where sampling a count takes about 0.1 s. Made
 * inside the first test, that cost landed on whichever clip ran first.
 */
beforeAll(() => {
  for (const figure of DRILL_FIGURES) drillFigure(figure.macros);
}, 180_000 * inject("budgetScale"));

describe("period drill acceptance worklist (NOT acceptance)", () => {
  it("is the reviewed worklist, printed on every run until it is empty", () => {
    const misses = Object.entries(worklist.misses);
    console.log(
      `drill worklist (NOT acceptance): ${worklist.missingKeys.length} counts without a key, ${misses.length} contact misses`,
    );
    for (const id of worklist.missingKeys) console.log(`  no key: ${id}`);
    for (const [id, metres] of misses)
      console.log(`  miss: ${id}: ${(metres * 1000).toFixed(1)} mm`);
    const known = new Set(DRILLS.map((drill) => drill.clip));
    for (const id of Object.keys(worklist.misses))
      expect(known.has(id.split(" ").find((word) => known.has(word)) ?? ""), id).toBe(true);
    // A listed count without a key must still be a count of the drill.
    const counts = new Set(DRILLS.flatMap((drill) => drill.counts.map((c) => keyId(drill, c))));
    for (const id of worklist.missingKeys)
      expect(counts.has(id), `${id} is no longer a count: take it off the worklist`).toBe(true);
  });

  it.each(DRILLS)(
    "$clip places every Hardee count at an authored key, or keeps it listed",
    (drill) => {
      const keys = keysOf(drill.clip);
      for (const count of drill.counts) {
        const id = keyId(drill, count);
        if (worklist.missingKeys.includes(id))
          expect(keys, `${id} is authored now: take it off the worklist`).not.toContain(count.t);
        else expect(keys, id).toContain(count.t);
      }
    },
  );

  it.each(DRILLS)(
    "$clip meets every Hardee contact, or misses by no more than recorded",
    (drill) => {
      const failures: string[] = [];
      const mm = (metres: number) => `${(metres * 1000).toFixed(1)} mm`;
      const findings = drillFindings(drill);
      const judged = new Set(findings.map((f) => f.id));
      for (const id of Object.keys(worklist.misses))
        if (id.includes(` ${drill.clip} @`) && !judged.has(id))
          failures.push(`${id}: no longer judged: take it off the worklist`);
      for (const { id, measured, bound } of findings) {
        const recorded = worklist.misses[id];
        if (recorded === undefined) {
          if (measured > bound)
            failures.push(`${id}: ${mm(measured)} (limit ${mm(bound)}), a new miss`);
        } else if (measured <= bound)
          failures.push(`${id}: meets its ${mm(bound)} limit now: take it off the worklist`);
        else if (measured > recorded + WORKLIST_ROUNDING)
          failures.push(`${id}: ${mm(measured)}, worse than the recorded ${mm(recorded)}`);
      }
      expect(failures).toEqual([]);
    },
  );
});

describe("period drill acceptance", () => {
  it("resolves renderer-surface support at the held kneeling key", () => {
    const animation = clip("kneel_pray");
    const frame = drillFigure(DRILL_FIGURES[3]?.macros ?? {})(animation, animation.duration);
    expect(frame.support).toMatchObject({
      state: "satisfied",
      clip: "kneel_pray",
      time: animation.duration,
      tolerance: 0.015,
    });
    expect(frame.support.residual).toBeLessThanOrEqual(0.015);
  });

  it("grounds the rear knee and each supporting sole in the held kneeling prayer", () => {
    const animation = clip("kneel_pray");
    const failures: string[] = [];
    for (const figure of DRILL_FIGURES) {
      const frame = drillFigure(figure.macros)(animation, animation.duration);
      if (frame.support.state !== "satisfied")
        failures.push(`${figure.name}: support solver ${frame.support.state}`);
      else if (frame.support.residual > 0.015)
        failures.push(
          `${figure.name}: support residual ${(frame.support.residual * 1000).toFixed(1)} mm`,
        );
      const rearKnee = groundDistanceNear(
        frame.body.positions,
        frame.lift,
        frame.marks("knee.R").position,
        0.1,
      );
      if (rearKnee > 0.015)
        failures.push(`${figure.name}: rear knee skin: ${(rearKnee * 1000).toFixed(1)} mm`);
      // Left foot is forward: heel plus the two ball contacts. The kneeling right
      // foot rests on its two toe contacts while its heel is raised.
      for (const index of [0, 1, 2, 4, 5])
        if ((frame.soles[index * 3 + 1] as number) > 0.015)
          failures.push(
            `${figure.name}: sole contact ${index}: ${((frame.soles[index * 3 + 1] as number) * 1000).toFixed(1)} mm`,
          );
    }
    expect(failures).toEqual([]);
  });

  it("joins opposed prayer palms in front of the sternum", () => {
    const failures: string[] = [];
    for (const id of ["kneel_pray", "pray_standing"]) {
      const animation = clip(id);
      for (const figure of DRILL_FIGURES) {
        const marks = drillFigure(figure.macros)(animation, animation.duration).marks;
        const left = marks("palm.L");
        const right = marks("palm.R");
        const middle: [number, number, number] = [
          (left.position[0] + right.position[0]) / 2,
          (left.position[1] + right.position[1]) / 2,
          (left.position[2] + right.position[2]) / 2,
        ];
        const normalAgreement =
          left.normal[0] * right.normal[0] +
          left.normal[1] * right.normal[1] +
          left.normal[2] * right.normal[2];
        const gap = distance(left.position, right.position);
        if (gap > 0.035)
          failures.push(`${figure.name} ${id}: palm gap: ${(gap * 1000).toFixed(1)} mm`);
        if (normalAgreement > -0.5)
          failures.push(
            `${figure.name} ${id}: palms face each other: ${normalAgreement.toFixed(3)}`,
          );
        if (middle[2] <= marks("sternum-notch").position[2])
          failures.push(`${figure.name} ${id}: palms in front of sternum`);
      }
    }
    expect(failures).toEqual([]);
  }, 60_000);

  it("keeps every non-locomotion period clip from skating on each reference figure", () => {
    for (const id of [
      "musket_load",
      "musket_fire",
      "kneel_pray",
      "pray_standing",
      "colour_bearer",
    ]) {
      for (const spec of DRILL_FIGURES) {
        const drift = stanceDrift(
          stationaryFigure[spec.name as keyof typeof stationaryFigure],
          clip(id),
          3,
        );
        expect(
          drift.worst,
          `${spec.name} ${id}: ${(drift.worst * 1000).toFixed(1)} mm`,
        ).toBeLessThan(0.01);
      }
    }
  });
});
