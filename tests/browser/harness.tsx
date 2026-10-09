/**
 * Drives the creator's panels in a real browser without a worker: ready info
 * built from the shipped pack manifests, and the real editor state logic.
 */
import type { ReactNode } from "react";
import adultManifest from "../../packs/adult-anatomy/data/manifest.json";
import bodyManifest from "../../packs/body/data/manifest.json";
import clothingManifest from "../../packs/clothing/data/manifest.json";
import type { HumanoidEditor } from "../../src/editor/ui/useHumanoidEditor.ts";
import { useEditorState } from "../../src/editor/ui/useHumanoidEditor.ts";
import { wardrobeOf } from "../../src/editor/wardrobe.ts";
import {
  type ClothingManifest,
  mergeSliderTasks,
  type ShapeModifierEntry,
  type SliderTask,
} from "../../src/format/assetFormat.ts";
import type { Recipe } from "../../src/recipe/recipe.ts";
import type { ReadyInfo } from "../../src/worker/protocol.ts";
import { EMPTY_RIG } from "../emptyRig.ts";

export function readyInfo(withAdultPack = false, withClothingPack = false): ReadyInfo {
  const body = bodyManifest as unknown as {
    modifiers: ShapeModifierEntry[];
    sliders: SliderTask[];
  };
  const adult = adultManifest as unknown as {
    modifiers: ShapeModifierEntry[];
    sliders: SliderTask[];
  };
  return {
    topology: { body: {} as never, attachments: [] },
    modifiers: withAdultPack ? [...body.modifiers, ...adult.modifiers] : body.modifiers,
    sliders: withAdultPack
      ? mergeSliderTasks(body.sliders, adult.sliders)
      : mergeSliderTasks(body.sliders),
    rig: EMPTY_RIG,
    presenceJoints: {} as never,
    adultAnatomyLoaded: withAdultPack,
    wardrobe: withClothingPack ? wardrobeOf(clothingManifest as unknown as ClothingManifest) : [],
  };
}

/** Renders `children(editor)` with live editor state; the latest editor is exposed for assertions. */
export function EditorHarness({
  ready,
  initial,
  children,
  onEditor,
}: {
  ready: ReadyInfo;
  initial?: Recipe;
  children: (editor: HumanoidEditor) => ReactNode;
  onEditor?: (editor: HumanoidEditor) => void;
}) {
  const editor = useEditorState(ready, initial);
  onEditor?.(editor);
  return <>{children(editor)}</>;
}
