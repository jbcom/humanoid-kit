/**
 * Skin and eye controls. Skin sliders show their effect in the track itself
 * (the melanin track is the actual skin ramp for the current haemoglobin and
 * undertone), and eyes offer a palette of natural iris colours plus a picker.
 */
import { DEFAULT_EYES, DEFAULT_SKIN, type Recipe, type SkinRecipe } from "../../recipe/recipe.ts";
import { linearToSrgb, type Rgb, skinAlbedo, srgbToLinear } from "../../surface/skinTone.ts";
import type { FrameRequest } from "../framing.ts";
import { IRIS_PALETTE } from "../randomize.ts";
import { SliderRow } from "./SliderRow.tsx";
import type { HumanoidEditor } from "./useHumanoidEditor.ts";

const css = (rgb: Readonly<Rgb>) =>
  `#${rgb
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, linearToSrgb(c))) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

const fromCss = (hex: string): Rgb => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => srgbToLinear(c / 255)) as Rgb;
};

function ramp(steps: number, at: (t: number) => Rgb): string {
  const stops = Array.from({ length: steps }, (_, i) => css(at(i / (steps - 1))));
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

type SkinNumber = Exclude<keyof SkinRecipe, "override">;

const SKIN_SLIDERS: { key: SkinNumber; label: string; min: number; description: string }[] = [
  {
    key: "melanin",
    label: "Skin tone",
    min: 0,
    description: "Melanin, from very fair to very deep.",
  },
  {
    key: "undertone",
    label: "Undertone",
    min: -1,
    description: "Cool and pink to warm and golden.",
  },
  {
    key: "haemoglobin",
    label: "Ruddiness",
    min: 0,
    description: "Blood under the skin, pale to ruddy.",
  },
  { key: "flush", label: "Flush", min: 0, description: "Colour on the cheeks, nose and ears." },
  {
    key: "lips",
    label: "Lip colour",
    min: 0,
    description: "Depth of lip colour against the skin.",
  },
  {
    key: "areola",
    label: "Areola colour",
    min: 0,
    description: "Depth of areola and nipple colour.",
  },
];

export function AppearancePanel({
  editor,
  onFocus,
}: {
  editor: HumanoidEditor;
  onFocus: (frame: FrameRequest) => void;
}) {
  const { recipe, update, settle } = editor;
  const skin = recipe.skin;
  const tone = (patch: Partial<SkinRecipe>) => ({
    melanin: skin.melanin,
    haemoglobin: skin.haemoglobin,
    undertone: skin.undertone,
    override: null,
    ...patch,
  });
  const tracks: Partial<Record<SkinNumber, string>> = {
    melanin: ramp(9, (t) => skinAlbedo(tone({ melanin: t }))),
    undertone: ramp(5, (t) => skinAlbedo(tone({ undertone: t * 2 - 1 }))),
    haemoglobin: ramp(5, (t) => skinAlbedo(tone({ haemoglobin: t }))),
  };
  const setSkin = (patch: Partial<Recipe["skin"]>, gesture: string) =>
    update((r) => ({ ...r, skin: { ...r.skin, ...patch } }), gesture);
  const setEyes = (patch: Partial<Recipe["eyes"]>, gesture?: string) =>
    update((r) => ({ ...r, eyes: { ...r.eyes, ...patch } }), gesture);
  const face: FrameRequest = { part: "head", direction: "front" };
  const body: FrameRequest = { part: "body", direction: "front" };
  const iris = css(recipe.eyes.iris);

  return (
    <div className="hk-groups">
      <details className="hk-group" open>
        <summary className="hk-group-title">
          <span>Skin</span>
        </summary>
        <div className="hk-group-body">
          {SKIN_SLIDERS.map((s) => (
            <SliderRow
              key={s.key}
              label={s.label}
              value={skin[s.key]}
              min={s.min}
              max={1}
              step={0.005}
              neutral={DEFAULT_SKIN[s.key]}
              format={pct}
              description={s.description}
              {...(tracks[s.key] ? { track: tracks[s.key] as string } : {})}
              onChange={(v, g) => setSkin({ [s.key]: v, override: null }, g)}
              onSettle={settle}
              onFocus={() => onFocus(s.key === "areola" || s.key === "melanin" ? body : face)}
            />
          ))}
        </div>
      </details>
      <details className="hk-group" open>
        <summary className="hk-group-title">
          <span>Eyes</span>
        </summary>
        <div className="hk-group-body">
          <fieldset className="hk-swatches">
            <legend>Iris colour</legend>
            {IRIS_PALETTE.map((c) => {
              const hex = css(c.rgb);
              return (
                <button
                  key={c.name}
                  type="button"
                  className="hk-swatch"
                  style={{ background: hex }}
                  aria-label={c.name}
                  aria-pressed={hex === iris}
                  onClick={() => {
                    onFocus(face);
                    setEyes({ iris: [...c.rgb] as Rgb });
                  }}
                />
              );
            })}
            <label className="hk-swatch hk-swatch-custom" aria-label="Custom iris colour">
              <input
                type="color"
                value={iris}
                onFocus={() => onFocus(face)}
                onChange={(e) => setEyes({ iris: fromCss(e.target.value) }, "iris-picker")}
                onBlur={settle}
              />
            </label>
          </fieldset>
          <SliderRow
            label="Sclera warmth"
            value={recipe.eyes.scleraWarmth}
            min={0}
            max={1}
            step={0.005}
            neutral={DEFAULT_EYES.scleraWarmth}
            format={pct}
            description="Clinical white to warm ivory."
            onChange={(v, g) => setEyes({ scleraWarmth: v }, g)}
            onSettle={settle}
            onFocus={() => onFocus(face)}
          />
        </div>
      </details>
    </div>
  );
}
