/** Messages between `HumanoidWorkerClient` and the evaluation worker. */
import type { LoadOptions } from "../format/assetFormat.ts";
import type { Evaluation, ModelOptions, ModelTopology } from "../model/humanoidModel.ts";
import type { Recipe } from "../recipe/recipe.ts";

export type WorkerRequest =
  | { type: "init"; id: number; load: LoadOptions; model: ModelOptions }
  | { type: "evaluate"; id: number; recipe: Recipe };

export type WorkerResponse =
  | {
      type: "ready";
      id: number;
      topology: ModelTopology;
      modifierIds: string[];
      adultAnatomyLoaded: boolean;
    }
  | { type: "evaluated"; id: number; evaluation: Evaluation; ms: number }
  | { type: "error"; id: number; message: string; name: string };
