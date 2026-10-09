/** Messages between `HumanoidWorkerClient` and the evaluation worker. */
import type { LoadOptions, ShapeModifierEntry, SliderTask } from "../format/assetFormat.ts";
import type { FeatureRef } from "../makehuman/features.ts";
import type {
  Evaluation,
  GarmentTopology,
  ModelOptions,
  ModelTopology,
  RenderFeatures,
} from "../model/humanoidModel.ts";
import type { Recipe } from "../recipe/recipe.ts";
import type { RigData, RigSkin } from "../rig/pose.ts";

/** What the worker reports once the packs are loaded and the model is built. */
export interface ReadyInfo {
  topology: ModelTopology;
  /** Every shape modifier the loaded packs can drive. */
  modifiers: ShapeModifierEntry[];
  /** The loaded packs' slider taxonomy, merged in MakeHuman's order. */
  sliders: SliderTask[];
  /**
   * What posing needs: bone names (the topology's skin indices refer to
   * these), each bone's parent index (-1 for the root) and the facial pose
   * units. Each evaluation carries the bones' rest heads for its figure.
   */
  rig: RigData & { parents: Int16Array; skin: RigSkin };
  adultAnatomyLoaded: boolean;
}

/** Which controls shape each rendered vertex: what a tap on the figure opens. */
export interface PickMap {
  features: FeatureRef[];
  /** Per render vertex, an index into `features` or `NO_FEATURE`. */
  render: RenderFeatures;
}

export type WorkerRequest =
  | { type: "init"; id: number; load: LoadOptions; model: ModelOptions }
  /** Answered once every target file has loaded, or with the error that stopped one. */
  | { type: "complete"; id: number }
  /** Answered with the pick map once every target file (it needs the modifiers') has loaded. */
  | { type: "pickMap"; id: number }
  /** Answered with `HumanoidModel.bakePosedOcclusion`'s result, baked between evaluations. */
  | { type: "posedOcclusion"; id: number }
  | {
      type: "evaluate";
      id: number;
      recipe: Recipe;
      /** The skin state's signals; those with state morphs change the shape. */
      signals?: Readonly<Record<string, number>>;
      /**
       * The key of the outfit the caller already holds the masks of
       * (`Evaluation.outfit`); when the recipe's outfit has this key the reply
       * leaves the masks out.
       */
      haveOutfit?: string | null;
    }
  /** Answered with a garment's static render data, once the garments have loaded. */
  | { type: "garment"; id: number; garment: string };

export type WorkerResponse =
  | ({ type: "ready"; id: number } & ReadyInfo)
  | { type: "completed"; id: number }
  | ({ type: "pickMap"; id: number } & PickMap)
  /** Per worn attachment, its render vertices' occlusion at every corner; null when `ready`'s already was. */
  | { type: "posedOcclusion"; id: number; attachments: Float32Array[] | null }
  | { type: "evaluated"; id: number; evaluation: Evaluation; ms: number }
  | { type: "garment"; id: number; topology: GarmentTopology }
  | { type: "error"; id: number; message: string; name: string };
