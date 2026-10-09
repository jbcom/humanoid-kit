/** Messages between `HumanoidWorkerClient` and the evaluation worker. */
import type { WardrobeEntry } from "../editor/wardrobe.ts";
import type {
  AdultAnatomySpec,
  HairKind,
  LoadOptions,
  ShapeModifierEntry,
  SliderTask,
} from "../format/assetFormat.ts";
import type { FeatureRef } from "../makehuman/features.ts";
import type {
  AdultSurfaceTopology,
  Evaluation,
  GarmentTopology,
  HairTopology,
  ModelOptions,
  ModelTopology,
  RenderFeatures,
} from "../model/humanoidModel.ts";
import type { PresenceJoints } from "../presence/fromEvaluation.ts";
import type { Recipe } from "../recipe/recipe.ts";
import type { SurfaceFold } from "../rig/hipFold.ts";
import type { RigData, RigSkin } from "../rig/pose.ts";
import type { LayerFieldsUpdate } from "../surface/layers.ts";

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
  /**
   * The joints presence reads (`presenceFromEvaluation`), so the main thread
   * needs no packs; null when the body pack lacks one (such a pack renders but
   * cannot publish presence).
   */
  presenceJoints: PresenceJoints | null;
  adultAnatomyLoaded: boolean;
  /** The hair pack's styles, in the order a picker offers them; null when no hair pack was loaded. */
  hair: HairInfo | null;
  /**
   * The adult anatomy pack's features and state morphs (`AdultAnatomySpec`),
   * which the skin paint and the shape signals read; absent without the pack.
   */
  anatomy?: AdultAnatomySpec;
  /**
   * The garments the clothing pack offers, listed before their geometry has
   * loaded; empty without that pack. A recipe wears them by `id`.
   */
  wardrobe: WardrobeEntry[];
}

/** What a picker needs of the hair pack before any style's geometry has loaded. */
export interface HairInfo {
  styles: { id: string; label: string; tags: string[]; kind: HairKind }[];
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
  /**
   * Answered with the adult anatomy layers' fields (`HumanoidModel.adultLayerFields`)
   * once the adult pack's stage has loaded, or null without an adult pack.
   */
  | { type: "adultLayers"; id: number }
  /**
   * Answered with the adult surface (`HumanoidModel.adultSurface`) at once, or
   * null without an adult pack that refines the body: it needs the pack's
   * manifest, not its targets.
   */
  | { type: "adultSurface"; id: number }
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
  | { type: "garment"; id: number; garment: string }
  /**
   * Answered with the recipe's hip fold on its body surface (`HumanoidModel.hipFold`),
   * solved between other requests; a later request of this kind supersedes
   * one still being solved, which is answered with an `AbortError`.
   */
  | {
      type: "hipFold";
      id: number;
      recipe: Recipe;
      signals?: Readonly<Record<string, number>>;
    };

export type WorkerResponse =
  | ({ type: "ready"; id: number } & ReadyInfo)
  | { type: "completed"; id: number }
  | ({ type: "pickMap"; id: number } & PickMap)
  /** Per worn attachment, its render vertices' occlusion at every corner; null when `ready`'s already was. */
  | { type: "posedOcclusion"; id: number; attachments: Float32Array[] | null }
  | { type: "adultLayers"; id: number; update: LayerFieldsUpdate | null }
  | { type: "adultSurface"; id: number; topology: AdultSurfaceTopology | null }
  | {
      type: "evaluated";
      id: number;
      evaluation: Evaluation;
      ms: number;
      /** The worn hair style's static data, with the first evaluation that wears it; absent after. */
      hairTopology?: HairTopology;
      /** The worn brows' and lashes' static data, each once like the scalp style's. */
      decalTopologies?: HairTopology[];
    }
  | { type: "garment"; id: number; topology: GarmentTopology }
  | { type: "hipFold"; id: number; surface: "base" | "adult"; fold: SurfaceFold }
  | { type: "error"; id: number; message: string; name: string };
