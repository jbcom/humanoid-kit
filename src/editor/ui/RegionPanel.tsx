/**
 * Regional macro overrides: pick a body region, then give any macro except
 * age a value of its own there. Regions with overrides are marked; a slider's
 * reset returns its region to the figure's value.
 */
import { useState } from "react";
import { BODY_REGIONS, type BodyRegion } from "../../makehuman/regions.ts";
import type { FrameRequest } from "../framing.ts";
import {
  isOverridden,
  REGION_LABELS,
  REGIONAL_MACRO_LABELS,
  REGIONAL_MACROS,
  regionalValue,
  withRegionalValue,
} from "../regional.ts";
import { SliderRow } from "./SliderRow.tsx";
import type { HumanoidEditor } from "./useHumanoidEditor.ts";

const FRAMES: Partial<Record<BodyRegion, FrameRequest>> = {
  head: { part: "head", direction: "front" },
  neck: { part: "head", direction: "front" },
  hands: { part: "leftHand", direction: "front" },
  feet: { part: "leftFoot", direction: "front" },
  legs: { part: "leftLeg", direction: "front" },
  arms: { part: "leftArm", direction: "front" },
};
const BODY: FrameRequest = { part: "body", direction: "front" };

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function RegionPanel({
  editor,
  onFocus,
}: {
  editor: HumanoidEditor;
  onFocus: (frame: FrameRequest) => void;
}) {
  const [region, setRegion] = useState<BodyRegion>("head");
  const { recipe, update, settle } = editor;
  const frame = FRAMES[region] ?? BODY;
  const overrides = (r: BodyRegion) => Object.keys(recipe.regionalMacros[r] ?? {}).length;

  return (
    <div className="hk-groups">
      <p className="hk-note">
        Give one part of the body its own value for any setting except age. Regions blend smoothly
        into their neighbours.
      </p>
      <fieldset className="hk-chips">
        <legend className="hk-visually-hidden">Body region</legend>
        {BODY_REGIONS.map((r) => (
          <button
            key={r}
            type="button"
            className="hk-chip"
            aria-pressed={r === region}
            aria-description={overrides(r) > 0 ? "has its own values" : undefined}
            data-overridden={overrides(r) > 0 || undefined}
            onClick={() => {
              setRegion(r);
              onFocus(FRAMES[r] ?? BODY);
            }}
          >
            {REGION_LABELS[r]}
          </button>
        ))}
      </fieldset>
      <div className="hk-group">
        <div className="hk-group-body">
          {REGIONAL_MACROS.map((k) => {
            const own = isOverridden(recipe, region, k);
            return (
              <SliderRow
                key={`${region}/${k}`}
                label={REGIONAL_MACRO_LABELS[k]}
                value={regionalValue(recipe, region, k)}
                min={0}
                max={1}
                step={0.005}
                neutral={recipe.macros[k]}
                changed={own}
                format={(v) => (own ? pct(v) : `${pct(v)} · whole body`)}
                onChange={(v, g) => update((r) => withRegionalValue(r, region, k, v), g)}
                onReset={() => update((r) => withRegionalValue(r, region, k, null))}
                onSettle={settle}
                onFocus={() => onFocus(frame)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
