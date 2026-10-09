/**
 * Builds the slider taxonomy from MakeHuman's `*_sliders.json` files (tasks,
 * groups, labels, camera hints) and `*_modifiers_desc.json` descriptions.
 *
 * Sliders name either a macro variable or a modifier from the modifier tables.
 * Each one is placed in the body pack's taxonomy or the adult anatomy pack's,
 * following the modifier it drives, so the body pack never names an adult
 * modifier. Anything the taxonomy names that the pack cannot drive fails the
 * pack rather than producing a dead slider.
 */
import type {
  ShapeModifierEntry,
  SliderEntry,
  SliderGroup,
  SliderTask,
} from "../../src/format/assetFormat.ts";
import type { MacroValues } from "../../src/makehuman/macro.ts";

/** MakeHuman's macro slider ids, mapped to the runtime's macro variables. */
const MACRO_SLIDERS: Record<string, keyof MacroValues> = {
  "macrodetails/Gender": "gender",
  "macrodetails/Age": "age",
  "macrodetails-universal/Muscle": "muscle",
  "macrodetails-universal/Weight": "weight",
  "macrodetails-height/Height": "height",
  "macrodetails-proportions/BodyProportions": "proportions",
  "macrodetails/African": "african",
  "macrodetails/Asian": "asian",
  "macrodetails/Caucasian": "caucasian",
  "breast/BreastSize": "breastSize",
  "breast/BreastFirmness": "breastFirmness",
};

/** The only enable condition upstream uses: the figure has genital anatomy (the adult pack). */
const ADULT_CONDITION = "hasGenitals";

interface RawSlider {
  mod: string;
  label?: string;
  cam?: string;
  enabledCondition?: string;
}
interface RawTask {
  label?: string;
  sortOrder?: number;
  cameraView?: string;
  showMacroStats?: boolean;
  modifiers: Record<string, RawSlider[]>;
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A readable label for a modifier that upstream leaves unlabelled. */
export function modifierLabel(id: string): string {
  const name = id
    .slice(id.indexOf("/") + 1)
    .replace(/-[a-z]+\|[a-z]+$/, "")
    .replace(/^r-/, "right-")
    .replace(/^l-/, "left-");
  return sentence(name.replaceAll("-", " "));
}

export interface SliderTables {
  /** Table name, e.g. `modeling`. */
  table: string;
  sliders: Record<string, RawTask>;
  descriptions: Record<string, string>;
}

export function buildSliders(
  tables: SliderTables[],
  modifiers: ReadonlyMap<string, ShapeModifierEntry>,
): { body: SliderTask[]; adult: SliderTask[] } {
  const body: SliderTask[] = [];
  const adult: SliderTask[] = [];
  let order = 0;
  tables.forEach(({ table, sliders, descriptions }, tableIndex) => {
    for (const [taskId, raw] of Object.entries(sliders)) {
      const known = new Set(["label", "sortOrder", "cameraView", "showMacroStats", "modifiers"]);
      for (const k of Object.keys(raw))
        if (!known.has(k)) throw new Error(`${table} task ${taskId}: unknown key ${k}`);
      // Tables become consecutive bands, each keeping upstream's order within it.
      const task = (): SliderTask => ({
        id: taskId,
        label: raw.label ?? taskId,
        sortOrder: tableIndex + (raw.sortOrder ?? 0),
        camera: raw.cameraView ?? null,
        groups: [],
      });
      const bodyTask = task();
      const adultTask = task();
      for (const [groupId, rawSliders] of Object.entries(raw.modifiers)) {
        const group = (): SliderGroup => ({ id: groupId, label: sentence(groupId), sliders: [] });
        const bodyGroup = group();
        const adultGroup = group();
        for (const s of rawSliders) {
          for (const k of Object.keys(s))
            if (!["mod", "label", "cam", "enabledCondition"].includes(k))
              throw new Error(`${table} slider ${s.mod}: unknown key ${k}`);
          const macro = MACRO_SLIDERS[s.mod];
          const modifier = modifiers.get(s.mod);
          if (!macro && !modifier)
            throw new Error(`${table} slider ${s.mod}: drives nothing packed`);
          if (s.enabledCondition !== undefined && s.enabledCondition !== ADULT_CONDITION)
            throw new Error(`${table} slider ${s.mod}: unknown condition ${s.enabledCondition}`);
          const isAdult = modifier?.adultOnly ?? false;
          if (s.enabledCondition === ADULT_CONDITION && !isAdult)
            throw new Error(`${table} slider ${s.mod}: gated upstream but not in the adult pack`);
          const entry: SliderEntry = {
            kind: macro ? "macro" : "modifier",
            id: macro ?? s.mod,
            label: s.label ?? modifierLabel(s.mod),
            camera: s.cam ?? null,
            description: descriptions[s.mod] || null,
            order: order++,
          };
          (isAdult ? adultGroup : bodyGroup).sliders.push(entry);
        }
        if (bodyGroup.sliders.length) bodyTask.groups.push(bodyGroup);
        if (adultGroup.sliders.length) adultTask.groups.push(adultGroup);
      }
      if (bodyTask.groups.length) body.push(bodyTask);
      if (adultTask.groups.length) adult.push(adultTask);
    }
  });
  return { body, adult };
}
