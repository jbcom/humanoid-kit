/**
 * Acceptance gates for the kit-authored 1860s drill and prayer clips. These
 * exercise the posed, grounded skin rather than only their bone channels: the
 * same surface and sole lift used when a paused clip is drawn.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AUTHORED_CLIPS_DIR } from "../scripts/lib/authoredClips.ts";
import { DRILLS, judgeCount } from "../scripts/lib/drill.ts";
import { clip, figure, stanceDrift } from "./animationHarness.ts";
import { DRILL_FIGURES, drillFigure } from "./drillHarness.ts";

type AuthoredClip = { keys: readonly { t: number }[] };

const keysOf = (id: string): readonly number[] => {
  const source = fs.readFileSync(path.join(AUTHORED_CLIPS_DIR, `${id}.json`), "utf8");
  return (JSON.parse(source) as AuthoredClip).keys.map(({ t }) => t);
};

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
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < positions.length; i += 3) {
    const point = [positions[i] as number, positions[i + 1] as number, positions[i + 2] as number];
    if (distance(point, joint) <= radius) best = Math.min(best, Math.abs(point[1] + lift));
  }
  return best;
}

const stationaryFigure = {
  "slim@25": figure("slim", 25),
  "heavy@35": figure("heavy", 35),
  "older@70": figure("average", 70),
  "average@25": figure("average", 25),
} as const;

describe("period drill acceptance", () => {
  it.each(DRILLS)("$clip places every Hardee count at an authored key", (drill) => {
    const keys = keysOf(drill.clip);
    for (const count of drill.counts)
      expect(keys, `${drill.clip}: ${count.name} at ${count.t}s`).toContain(count.t);
  });

  it.each(DRILLS)("$clip meets every Hardee contact at every authored count", (drill) => {
    const failures: string[] = [];
    for (const figure of DRILL_FIGURES) {
      const frameAt = drillFigure(figure.macros);
      const animation = clip(drill.clip);
      for (const count of drill.counts) {
        const result = judgeCount(drill, count, frameAt(animation, count.t).marks);
        for (const finding of result.findings)
          if (finding.measured > finding.bound)
            failures.push(
              `${figure.name} ${drill.clip} ${finding.what}: ${(finding.measured * 1000).toFixed(1)} mm (limit ${(finding.bound * 1000).toFixed(1)} mm)`,
            );
      }
    }
    expect(failures).toEqual([]);
  });

  it("grounds the rear knee and each supporting sole in the held kneeling prayer", () => {
    const animation = clip("kneel_pray");
    const failures: string[] = [];
    for (const figure of DRILL_FIGURES) {
      const frame = drillFigure(figure.macros)(animation, animation.duration);
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
        const middle = [
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
  });

  it("keeps every non-locomotion period clip from skating on each reference figure", () => {
    for (const id of [
      "musket_load",
      "musket_fire",
      "kneel_pray",
      "pray_standing",
      "colour_bearer",
    ]) {
      for (const spec of DRILL_FIGURES) {
        const drift = stanceDrift(stationaryFigure[spec.name], clip(id), 3);
        expect(
          drift.worst,
          `${spec.name} ${id}: ${(drift.worst * 1000).toFixed(1)} mm`,
        ).toBeLessThan(0.01);
      }
    }
  });
});
