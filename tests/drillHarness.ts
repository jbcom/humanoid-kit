/**
 * The drill and prayer clips posed as the renderer draws them, for the contact
 * tests (`tests/drill.test.ts`) and the probe (`scripts/research/drill-probe.ts`):
 * a clip played by the `Animator` and held at a time (the foot lock applied, as
 * `<Humanoid>` holds a paused clip), the body skinned there (`surfacePoser`, the
 * renderer's skinning and folds), lifted onto the ground by its soles as
 * `useFigureAnimation` lifts a grounded clip, and its landmarks read on it.
 */

import type { Marks } from "../scripts/lib/drill.ts";
import { Animator } from "../src/animation/animator.ts";
import type { AnimationClip } from "../src/animation/clip.ts";
import { contactPoints } from "../src/animation/locomotion.ts";
import type { SupportFigure, SupportReport } from "../src/animation/supportConstraint.ts";
import {
  type FrameOut,
  type LandmarkFrame,
  type LandmarkId,
  landmarkAnchors,
  landmarks,
} from "../src/foundation/landmarks.ts";
import { type PosedBody, solvedFolds, surfacePoser } from "../src/foundation/posed.ts";
import type { MacroValues } from "../src/makehuman/macro.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { skinOfEvaluation } from "../src/model/reservoirSkin.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { restBones } from "../src/rig/pose.ts";
import { assets, rig } from "./animationHarness.ts";

/** The bodies the drill is judged on: slim, heavy and older, and the average the poses were solved on. */
export const DRILL_FIGURES: readonly { name: string; macros: Partial<MacroValues> }[] = [
  { name: "slim@25", macros: { age: 25, gender: 1, weight: 0.1 } },
  { name: "heavy@35", macros: { age: 35, gender: 0, weight: 0.95, muscle: 0.8 } },
  { name: "older@70", macros: { age: 70, gender: 0.5 } },
  { name: "average@25", macros: { age: 25, gender: 0.5 } },
];

/** One frame of a clip on one figure, grounded. */
export interface DrillFrame {
  /** The body as drawn, before the lift: add `lift` to a height. */
  body: PosedBody;
  lift: number;
  marks: Marks;
  /** The six sole points (`CONTACT_BONES`: heel and ball's two toe joints, left then right), grounded. */
  soles: Float32Array;
  /** The internal support result for this exact sample. */
  support: SupportReport;
}

const model = new HumanoidModel(assets, { subdivision: 1 });

/** The evaluated renderer surface fed to the private support path in a drill test. */
export function drillSupport(macros: Partial<MacroValues>): SupportFigure {
  const recipe = createRecipe({ macros });
  const ev = model.evaluate(recipe);
  const groundOffset = ev.groundOffset;
  const rest = restBones(assets, Float32Array.from(ev.control));
  const topology = ev.surface === "adult" ? model.adultSurface() : model.topology().body;
  if (!topology) throw new Error("drill figure has no evaluated surface");
  const skin = skinOfEvaluation(ev, topology);
  return {
    generation: {},
    restBones: rest,
    ground: -groundOffset,
    rest: Float32Array.from(ev.positions),
    skinIndex: skin.skinIndex,
    skinWeight: skin.skinWeight,
    anchors: landmarkAnchors(model, ev.surface),
    folds: solvedFolds(model, recipe),
  };
}

/** Each figure's sampler, made once: its support solves the figure's folds, the costliest part. */
const samplers = new Map<string, (clip: AnimationClip, t: number) => DrillFrame>();

/** Samples the figure of `macros` at a clip's time; the same sampler for the same macros. */
export function drillFigure(macros: Partial<MacroValues>) {
  const key = JSON.stringify(Object.entries(macros).sort(([a], [b]) => a.localeCompare(b)));
  let sampler = samplers.get(key);
  if (!sampler) {
    sampler = makeDrillFigure(macros);
    samplers.set(key, sampler);
  }
  return sampler;
}

function makeDrillFigure(macros: Partial<MacroValues>) {
  const support = drillSupport(macros);
  const recipe = createRecipe({ macros });
  const pose = surfacePoser(model, recipe);
  const groundOffset = model.evaluate(recipe).groundOffset;
  const rest = support.restBones;
  return (clip: AnimationClip, t: number): DrillFrame => {
    const an = new Animator(rig.bones.length, rest, -groundOffset);
    an.setSupportFigure(support);
    an.play(clip);
    an.seek(t);
    const body = pose(an.rotations);
    const soles = new Float32Array(18);
    contactPoints(rest, an.rotations, -groundOffset, soles);
    let low = Number.POSITIVE_INFINITY;
    for (let k = 0; k < 6; k++) low = Math.min(low, soles[k * 3 + 1] as number);
    // `contactPoints` gives heights above the ground at rest; the renderer lifts by the lowest.
    for (let k = 0; k < 6; k++) soles[k * 3 + 1] = (soles[k * 3 + 1] as number) - low;
    const lift = groundOffset - low;
    const frames = landmarks(model, body);
    const grounded = new Map<LandmarkId, FrameOut>();
    const marks: Marks = (id) => {
      let f = grounded.get(id);
      if (!f) {
        const m = frames[id] as LandmarkFrame;
        f = {
          position: [m.position[0], m.position[1] + lift, m.position[2]],
          normal: [...m.normal],
          tangent: [...m.tangent],
          bitangent: [...m.bitangent],
        };
        grounded.set(id, f);
      }
      return f;
    };
    return { body, lift, marks, soles, support: { ...an.supportReport } };
  };
}
