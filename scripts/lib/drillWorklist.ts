/**
 * The period drill's acceptance worklist: every Hardee count the authored clips
 * do not yet place at a key, and every contact they miss on the judged bodies.
 *
 * The clips do not meet the drill yet (#15). `tests/drill.test.ts` holds them to
 * the reviewed worklist in `docs/evidence/drill-worklist.json`: a miss may shrink
 * but never grow, nothing off the list may start missing, and an entry that now
 * passes must come off. This is a regression budget, not acceptance. The drill is
 * accepted only once the worklist is empty.
 */
import fs from "node:fs";
import path from "node:path";
import { clip } from "../../tests/animationHarness.ts";
import { DRILL_FIGURES, drillFigure } from "../../tests/drillHarness.ts";
import { AUTHORED_CLIPS_DIR } from "./authoredClips.ts";
import { type Count, DRILLS, type Drill, judgeCount } from "./drill.ts";

/** What the worklist records, in a stable order. */
export interface DrillWorklist {
  /** `<clip> <count> at <t>s`: a Hardee count with no authored key at its time. */
  missingKeys: string[];
  /** `<figure> <clip> @<t>s <finding>`: metres measured past the finding's bound. */
  misses: Record<string, number>;
}

/** A recorded miss may differ from a new measurement by rounding, no more (0.1 mm). */
export const WORKLIST_ROUNDING = 1e-4;

/** The authored key times of a clip. */
export function authoredKeys(id: string): readonly number[] {
  const source = fs.readFileSync(path.join(AUTHORED_CLIPS_DIR, `${id}.json`), "utf8");
  return (JSON.parse(source) as { keys: readonly { t: number }[] }).keys.map(({ t }) => t);
}

export const keyId = (drill: Drill, count: Count): string =>
  `${drill.clip} ${count.name} at ${count.t}s`;

export const missId = (figure: string, drill: Drill, count: Count, what: string): string =>
  `${figure} ${drill.clip} @${count.t}s ${what}`;

/** Every judged finding of one drill on every judged body. */
export function drillFindings(drill: Drill): { id: string; measured: number; bound: number }[] {
  const out: { id: string; measured: number; bound: number }[] = [];
  const animation = clip(drill.clip);
  for (const figure of DRILL_FIGURES) {
    const frameAt = drillFigure(figure.macros);
    for (const count of drill.counts) {
      const { findings } = judgeCount(drill, count, frameAt(animation, count.t).marks);
      for (const finding of findings)
        out.push({
          id: missId(figure.name, drill, count, finding.what),
          measured: finding.measured,
          bound: finding.bound,
        });
    }
  }
  return out;
}

/** Measures the whole worklist from the current clips. */
export function measureDrillWorklist(): DrillWorklist {
  const missingKeys: string[] = [];
  const misses: Record<string, number> = {};
  for (const drill of DRILLS) {
    const keys = authoredKeys(drill.clip);
    for (const count of drill.counts)
      if (!keys.includes(count.t)) missingKeys.push(keyId(drill, count));
    for (const finding of drillFindings(drill))
      if (finding.measured > finding.bound) misses[finding.id] = finding.measured;
  }
  return { missingKeys, misses };
}
