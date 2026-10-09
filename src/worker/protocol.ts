/** Messages between `HumanoidWorkerClient` and the evaluation worker. */
import type { LoadOptions, ShapeModifierEntry, SliderTask } from "../format/assetFormat.ts";
import type { Evaluation, ModelOptions, ModelTopology } from "../model/humanoidModel.ts";
import type { Recipe } from "../recipe/recipe.ts";

/** What the worker reports once the packs are loaded and the model is built. */
export interface ReadyInfo {
  topology: ModelTopology;
  /** Every shape modifier the loaded packs can drive. */
  modifiers: ShapeModifierEntry[];
  /** The loaded packs' slider taxonomy, merged in MakeHuman's order. */
  sliders: SliderTask[];
  /** Skeleton bone names; the topology's skin indices refer to these. */
  bones: string[];
  adultAnatomyLoaded: boolean;
}

export type WorkerRequest =
  | { type: "init"; id: number; load: LoadOptions; model: ModelOptions }
  /** Answered once the modifier targets have loaded, or with the error that stopped them. */
  | { type: "modifierTargets"; id: number }
  | { type: "evaluate"; id: number; recipe: Recipe };

export type WorkerResponse =
  | ({ type: "ready"; id: number } & ReadyInfo)
  | { type: "modifierTargetsLoaded"; id: number }
  | { type: "evaluated"; id: number; evaluation: Evaluation; ms: number }
  | { type: "error"; id: number; message: string; name: string };
