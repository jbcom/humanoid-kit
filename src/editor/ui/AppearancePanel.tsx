/**
 * Skin, eye and hair controls. Skin sliders show their effect in the track
 * itself (the melanin track is the actual skin ramp for the current
 * haemoglobin and undertone), eyes offer a palette of natural iris colours plus
 * a picker, and hair (when a hair pack is loaded) a style, a palette of natural
 * colours, a picker for dyed hair and the pigment sliders behind the palette.
 * Body hair offers authored facial-hair assets and explicit coverage per region,
 * the same control at every frame (DECISIONS ruling 1). An unset region shows
 * what is drawn for it, labelled as unset; the pubic control is offered only to
 * adults, as the age policy has it.
 */
import { useMemo } from "react";
import type { EyeLibrary } from "../../eyes/library.ts";
import { isAdult } from "../../recipe/agePolicy.ts";
import {
  DEFAULT_EYES,
  DEFAULT_SKIN,
  type Recipe,
  type SkinRecipe,
  withHair,
} from "../../recipe/recipe.ts";
import {
  type BodyHairGroup,
  type BodyHairRecipe,
  isAdultOnlyBodyHair,
} from "../../surface/bodyHair.ts";
import {
  DEFAULT_HAIR_COLOUR,
  HAIR_COLOURS,
  type HairColour,
  hairAlbedo,
} from "../../surface/hairTone.ts";
import { drawnBodyHairCoverage } from "../../surface/regions/bodyHairCoat.ts";
import { type Rgb, skinAlbedo } from "../../surface/skinTone.ts";
import { eyeMaterialGroups, withEyeMaterial } from "../eyeMaterials.ts";
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
  eyeMaterials,
}: {
  editor: HumanoidEditor;
  onFocus: (frame: FrameRequest) => void;
  /** The eye pack's library; without it there is no eye texture to choose. */
  eyeMaterials?: EyeLibrary;
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
  const hairStyles = editor.ready?.hair?.styles.filter((s) => s.kind === "scalp") ?? null;
  const style = recipe.hair?.style ?? null;
  const hairColour = recipe.hair?.colour ?? DEFAULT_HAIR_COLOUR;
  const brows = editor.ready?.hair?.styles.filter((s) => s.kind === "brows") ?? [];
  const lashes = editor.ready?.hair?.styles.filter((s) => s.kind === "lashes") ?? [];
  const facialHair = editor.ready?.hair?.styles.filter((s) => s.kind === "facial") ?? [];
  const setHair = (
    patch: { style?: string | null; brows?: string | null; lashes?: string | null },
    gesture?: string,
  ) => update((r) => withHair(r, patch), gesture);
  const setHairColour = (colour: HairColour, gesture?: string) =>
    update((r) => withHair(r, { colour }), gesture);
  // Body hair: a recipe that sets nothing keeps no `bodyHair` at all.
  const setBodyHair = (change: (b: BodyHairRecipe) => BodyHairRecipe, gesture?: string) =>
    update((r) => {
      const { bodyHair, ...rest } = r;
      const next = change(bodyHair ?? {});
      return Object.keys(next).length === 0 ? rest : { ...rest, bodyHair: next };
    }, gesture);
  const toggleFacialHair = (id: string) =>
    update((r) => {
      const selected = r.facialHair ?? [];
      const next = selected.includes(id)
        ? selected.filter((selectedId) => selectedId !== id)
        : [...selected, id];
      const { facialHair: _, ...rest } = r;
      return next.length === 0 ? rest : { ...rest, facialHair: next };
    });
  const clearFacialHair = () =>
    update((r) => {
      const { facialHair: _, ...rest } = r;
      return rest;
    });
  // The age policy's adult-only group (pubic) is offered only to adults.
  const adult = isAdult(recipe);
  const hairInput = {
    age: recipe.macros.age,
    colour: hairColour,
    ...(recipe.bodyHair && { bodyHair: recipe.bodyHair }),
  };

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
          {eyeMaterials && (
            <EyeTexturePicker
              library={eyeMaterials}
              worn={recipe.eyes.material ?? null}
              onPick={(id) => {
                onFocus(face);
                update((r) => withEyeMaterial(r, id));
              }}
            />
          )}
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
            {brows.length > 0 && (
              <fieldset className="hk-chips">
                <legend className="hk-visually-hidden">Eyebrows</legend>
                {[{ id: null, label: "No eyebrows" }, ...brows].map((s) => (
                  <button
                    key={s.id ?? "none"}
                    type="button"
                    className="hk-chip"
                    aria-pressed={(recipe.hair?.brows ?? null) === s.id}
                    onClick={() => {
                      onFocus(face);
                      setHair({ brows: s.id });
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </fieldset>
            )}
            {lashes.length > 0 && (
              <fieldset className="hk-chips">
                <legend className="hk-visually-hidden">Eyelashes</legend>
                {[{ id: null, label: "No eyelashes" }, ...lashes].map((s) => (
                  <button
                    key={s.id ?? "none"}
                    type="button"
                    className="hk-chip"
                    aria-pressed={(recipe.hair?.lashes ?? null) === s.id}
                    onClick={() => {
                      onFocus(face);
                      setHair({ lashes: s.id });
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </fieldset>
            )}
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
      <details className="hk-group">
        <summary className="hk-group-title">
          <span>Body hair</span>
        </summary>
        <div className="hk-group-body">
          {facialHair.length > 0 && (
            <fieldset className="hk-chips">
              <legend>Facial hair</legend>
              <button
                type="button"
                className="hk-chip"
                aria-pressed={recipe.facialHair === undefined}
                onClick={() => {
                  onFocus(face);
                  clearFacialHair();
                }}
              >
                None
              </button>
              {facialHair.map((style) => (
                <button
                  key={style.id}
                  type="button"
                  className="hk-chip"
                  aria-pressed={recipe.facialHair?.includes(style.id) ?? false}
                  onClick={() => {
                    onFocus(face);
                    toggleFacialHair(style.id);
                  }}
                >
                  {style.label}
                </button>
              ))}
            </fieldset>
          )}
          {BODY_HAIR_SLIDERS.filter((s) => adult || !isAdultOnlyBodyHair(s.group)).map((s) => {
            const control = bodyHairControl(recipe.bodyHair, s.group);
            const drawn = drawnBodyHairCoverage(s.group, hairInput);
            const asked = recipe.bodyHair?.coverage?.[s.group];
            return (
              <SliderRow
                key={s.group}
                label={s.label}
                value={asked ?? drawn}
                min={0}
                max={1}
                step={0.01}
                neutral={drawn}
                changed={control !== "unset"}
                format={(v) => coverageLabel(control, v, drawn)}
                description={s.description}
                onChange={(v, g) => setBodyHair((b) => withCoverage(b, s.group, v), g)}
                onReset={() => setBodyHair((b) => withoutCoverage(b, s.group))}
                onSettle={settle}
                onFocus={() => onFocus(s.group === "face" ? face : body)}
              />
            );
          })}
        </div>
      </details>
    </div>
  );
}

/**
 * The eye pack's materials as chips, by kind, after the built-in eye. A material
 * supplies the iris's pattern and the sclera's detail; the colours above stay in force.
 */
function EyeTexturePicker({
  library,
  worn,
  onPick,
}: {
  library: EyeLibrary;
  worn: string | null;
  onPick: (id: string | null) => void;
}) {
  const groups = useMemo(() => eyeMaterialGroups(library), [library]);
  const entry = worn === null ? undefined : library.entry(worn);
  return (
    <>
      <fieldset className="hk-chips">
        <legend>Eye texture</legend>
        <button
          type="button"
          className="hk-chip"
          aria-pressed={worn === null}
          onClick={() => onPick(null)}
        >
          Built-in
        </button>
      </fieldset>
      {entry && !entry.hasIris && (
        <p className="hk-note">This eye has no iris, so its colour has no effect.</p>
      )}
      {groups.map((group) => (
        <fieldset key={group.kind} className="hk-chips">
          <legend>{group.label}</legend>
          {group.materials.map((m) => (
            <button
              key={m.id}
              type="button"
              className="hk-chip"
              aria-pressed={worn === m.id}
              onClick={() => onPick(m.id)}
            >
              {m.label}
            </button>
          ))}
        </fieldset>
      ))}
    </>
  );
}

/** How a recipe sets one group's body hair: not at all, by explicit coverage, or by the legacy multiplier. */
type BodyHairControl = "unset" | "explicit" | "legacy";

function bodyHairControl(b: BodyHairRecipe | undefined, group: BodyHairGroup): BodyHairControl {
  if (b?.coverage?.[group] !== undefined) return "explicit";
  return b?.density?.[group] !== undefined ? "legacy" : "unset";
}

/**
 * A group's map with `group` set to `v`, or removed when `v` is undefined; the
 * map itself is dropped when nothing is left in it.
 */
function withEntry(
  map: Partial<Record<BodyHairGroup, number>> | undefined,
  group: BodyHairGroup,
  v: number | undefined,
): Partial<Record<BodyHairGroup, number>> | undefined {
  const { [group]: _, ...rest } = map ?? {};
  const next = v === undefined ? rest : { ...rest, [group]: v };
  return Object.keys(next).length > 0 ? next : undefined;
}

/** `b` with `field` replaced by `map`, the field left out when the map is empty. */
function withField(
  b: BodyHairRecipe,
  field: "coverage" | "density",
  map: Partial<Record<BodyHairGroup, number>> | undefined,
): BodyHairRecipe {
  const { [field]: _, ...rest } = b;
  return map ? { ...rest, [field]: map } : rest;
}

/**
 * A body hair recipe with one group's explicit coverage set. It replaces that
 * group's legacy multiplier, which the recipe may not hold beside it.
 */
const withCoverage = (b: BodyHairRecipe, group: BodyHairGroup, v: number): BodyHairRecipe =>
  withField(
    withField(b, "density", withEntry(b.density, group, undefined)),
    "coverage",
    withEntry(b.coverage, group, v),
  );

/** A body hair recipe with one group back to unset: neither coverage nor the legacy multiplier. */
const withoutCoverage = (b: BodyHairRecipe, group: BodyHairGroup): BodyHairRecipe =>
  withField(
    withField(b, "density", withEntry(b.density, group, undefined)),
    "coverage",
    withEntry(b.coverage, group, undefined),
  );

/**
 * What a body hair slider says: an unset group says so and what is drawn for
 * it (nothing, for a coat group the recipe does not enable), so an unset group
 * is never shown as an explicit 0 or as a choice.
 */
function coverageLabel(control: BodyHairControl, value: number, drawn: number): string {
  if (control === "unset") return drawn > 0 ? `Not set (${pct(drawn)})` : "Not set (none)";
  if (control === "legacy") return `${pct(drawn)} (legacy)`;
  if (Math.abs(value - drawn) < 0.005) return pct(value);
  return `${pct(value)} (drawn ${pct(drawn)})`;
}

const BODY_HAIR_SLIDERS: { group: BodyHairGroup; label: string; description: string }[] = [
  {
    group: "face",
    label: "Facial hair",
    description: "Fine facial coat coverage, independent of an authored beard or moustache asset.",
  },
  { group: "chest", label: "Chest", description: "Hair on the chest." },
  { group: "abdomen", label: "Abdomen", description: "Hair on the belly and down its midline." },
  { group: "back", label: "Back", description: "Hair on the back." },
  { group: "buttocks", label: "Buttocks", description: "Hair on the buttocks." },
  { group: "arms", label: "Arms", description: "Hair on the arms." },
  { group: "legs", label: "Legs", description: "Hair on the legs." },
  { group: "axillary", label: "Underarms", description: "Underarm hair." },
  { group: "pubic", label: "Pubic", description: "Pubic hair (adults only)." },
];

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
