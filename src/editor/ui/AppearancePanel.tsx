/**
 * Skin, eye and hair controls. Skin sliders show their effect in the track
 * itself (the melanin track is the actual skin ramp for the current
 * haemoglobin and undertone), eyes offer a palette of natural iris colours plus
 * a picker, and hair (when a hair pack is loaded) a style, a palette of natural
 * colours, a picker for dyed hair and the pigment sliders behind the palette.
 */
import { DEFAULT_EYES, DEFAULT_SKIN, type Recipe, type SkinRecipe } from "../../recipe/recipe.ts";
import {
  DEFAULT_HAIR_COLOUR,
  HAIR_COLOURS,
  type HairColour,
  hairAlbedo,
} from "../../surface/hairTone.ts";
import { type Rgb, skinAlbedo } from "../../surface/skinTone.ts";
import type { FrameRequest } from "../framing.ts";
import { IRIS_PALETTE } from "../randomize.ts";
import { cssColour as css, fromCssColour as fromCss, cssRamp as ramp } from "./cssColour.ts";
import { SliderRow } from "./SliderRow.tsx";
import type { HumanoidEditor } from "./useHumanoidEditor.ts";

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
  // Hair is offered when a hair pack is loaded; a recipe with no `hair` has none.
  const hairStyles = editor.ready?.hair?.styles ?? null;
  const style = recipe.hair?.style ?? null;
  const hairColour = recipe.hair?.colour ?? DEFAULT_HAIR_COLOUR;
  const setHair = (patch: { style?: string | null }, gesture?: string) =>
    update(
      (r) => ({
        ...r,
        hair: {
          style: r.hair?.style ?? null,
          colour: r.hair?.colour ?? { ...DEFAULT_HAIR_COLOUR },
          ...patch,
        },
      }),
      gesture,
    );
  const setHairColour = (colour: HairColour, gesture?: string) =>
    update((r) => ({ ...r, hair: { style: r.hair?.style ?? null, colour } }), gesture);

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
      {hairStyles && (
        <details className="hk-group" open>
          <summary className="hk-group-title">
            <span>Hair</span>
          </summary>
          <div className="hk-group-body">
            <fieldset className="hk-chips">
              <legend className="hk-visually-hidden">Hair style</legend>
              {[{ id: null, label: "None" }, ...hairStyles].map((s) => (
                <button
                  key={s.id ?? "none"}
                  type="button"
                  className="hk-chip"
                  aria-pressed={style === s.id}
                  onClick={() => {
                    onFocus(face);
                    setHair({ style: s.id });
                  }}
                >
                  {s.label}
                </button>
              ))}
            </fieldset>
            <fieldset className="hk-swatches">
              <legend>Hair colour</legend>
              {HAIR_PRESETS.map(([id, label]) => {
                const preset = HAIR_COLOURS[id] as HairColour;
                return (
                  <button
                    key={id}
                    type="button"
                    className="hk-swatch"
                    style={{ background: css(hairAlbedo(preset)) }}
                    aria-label={label}
                    aria-pressed={sameColour(hairColour, preset)}
                    onClick={() => {
                      onFocus(face);
                      setHairColour({ ...preset });
                    }}
                  />
                );
              })}
              <label className="hk-swatch hk-swatch-custom" aria-label="Custom hair colour">
                <input
                  type="color"
                  value={css(hairAlbedo(hairColour))}
                  onFocus={() => onFocus(face)}
                  onChange={(e) =>
                    setHairColour({ ...hairColour, override: fromCss(e.target.value) }, "hair-dye")
                  }
                  onBlur={settle}
                />
              </label>
            </fieldset>
            {HAIR_SLIDERS.map((s) => (
              <SliderRow
                key={s.key}
                label={s.label}
                value={hairColour[s.key]}
                min={0}
                max={1}
                step={0.005}
                neutral={DEFAULT_HAIR_COLOUR[s.key]}
                format={pct}
                description={s.description}
                track={ramp(7, (t) => hairAlbedo({ ...hairColour, [s.key]: t, override: null }))}
                onChange={(v, g) => setHairColour({ ...hairColour, [s.key]: v, override: null }, g)}
                onSettle={settle}
                onFocus={() => onFocus(face)}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/** Whether two natural hair colours are the same pigments (a dyed colour is never a preset). */
const sameColour = (a: HairColour, b: HairColour) =>
  a.override === null &&
  a.eumelanin === b.eumelanin &&
  a.pheomelanin === b.pheomelanin &&
  a.grey === b.grey;

/** The named colours offered as swatches, dark to light, with their labels. */
const HAIR_PRESETS: readonly (readonly [string, string])[] = [
  ["black", "Black hair"],
  ["dark-brown", "Dark brown hair"],
  ["brown", "Brown hair"],
  ["light-brown", "Light brown hair"],
  ["auburn", "Auburn hair"],
  ["red", "Red hair"],
  ["ginger", "Ginger hair"],
  ["blonde", "Blond hair"],
  ["light-blonde", "Light blond hair"],
  ["platinum", "Platinum hair"],
  ["grey", "Grey hair"],
  ["white", "White hair"],
];

const HAIR_SLIDERS: {
  key: "eumelanin" | "pheomelanin" | "grey";
  label: string;
  description: string;
}[] = [
  {
    key: "eumelanin",
    label: "Dark pigment",
    description: "Eumelanin: none is white or blond, full is black.",
  },
  {
    key: "pheomelanin",
    label: "Red pigment",
    description: "Pheomelanin: the red and gold in auburn, red and ginger hair.",
  },
  {
    key: "grey",
    label: "Greying",
    description: "The share of hairs that have lost their pigment.",
  },
];
