/**
 * The shape controls of one MakeHuman task (Main, Gender, Face, ...): its
 * groups as collapsible sections of sliders. With a search query, matching
 * sliders from every task are listed instead.
 */
import { useEffect, useRef } from "react";
import type { SliderEntry, SliderGroup, SliderTask } from "../../format/assetFormat.ts";
import {
  formatSliderValue,
  resetSliderValue,
  sliderAvailability,
  sliderValue,
} from "../controls.ts";
import type { FrameRequest } from "../framing.ts";
import { frameRequest } from "../framing.ts";
import { scrollBehavior } from "./motion.ts";
import { SliderRow } from "./SliderRow.tsx";
import type { HumanoidEditor } from "./useHumanoidEditor.ts";

export interface ShapePanelProps {
  editor: HumanoidEditor;
  task: SliderTask | null;
  query: string;
  onFocus: (frame: FrameRequest) => void;
  /**
   * A group to open and scroll to, as when its part of the figure is tapped;
   * a new `nonce` reveals it again even if it was closed since.
   */
  reveal?: { group: string; nonce: number } | null;
}

function ShapeSlider({
  editor,
  entry,
  task,
  onFocus,
}: {
  editor: HumanoidEditor;
  entry: SliderEntry;
  task: SliderTask;
  onFocus: (frame: FrameRequest) => void;
}) {
  const range = editor.range(entry);
  const availability = sliderAvailability(editor.recipe, entry, editor.modifiers);
  const anatomyDefaults = editor.ready?.anatomy?.defaults;
  const defaultedAdultModifier =
    entry.kind === "modifier" &&
    anatomyDefaults !== undefined &&
    Object.hasOwn(anatomyDefaults, entry.id);
  const withoutOverride = defaultedAdultModifier
    ? { ...editor.recipe, modifiers: { ...editor.recipe.modifiers } }
    : editor.recipe;
  if (defaultedAdultModifier) delete withoutOverride.modifiers[entry.id];
  const value = sliderValue(editor.recipe, entry, anatomyDefaults);
  const defaultValue = defaultedAdultModifier
    ? sliderValue(withoutOverride, entry, anatomyDefaults)
    : range.neutral;
  const neutral = Math.min(range.max, Math.max(range.min, defaultValue));
  const defaultFitsRange = defaultValue === neutral;
  return (
    <SliderRow
      label={entry.label}
      value={value}
      min={range.min}
      max={range.max}
      step={range.step}
      neutral={neutral}
      format={(v) => formatSliderValue(entry, v, range)}
      description={entry.description}
      disabledReason={availability.enabled ? null : availability.reason}
      onChange={(v, gesture) => editor.setSlider(entry, v, gesture)}
      {...(defaultedAdultModifier && {
        changed:
          Object.hasOwn(editor.recipe.modifiers, entry.id) &&
          (defaultFitsRange || Math.abs(value - neutral) > range.step / 2),
        onReset: () =>
          editor.update((recipe) =>
            resetSliderValue(recipe, entry, editor.modifiers, anatomyDefaults, range),
          ),
      })}
      onSettle={editor.settle}
      onFocus={() => onFocus(frameRequest(entry.camera, task.camera))}
    />
  );
}

function Group({
  group,
  task,
  open,
  revealed,
  ...rest
}: {
  editor: HumanoidEditor;
  group: SliderGroup;
  task: SliderTask;
  open: boolean;
  revealed: boolean;
  onFocus: (frame: FrameRequest) => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (revealed) ref.current?.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
  }, [revealed]);
  return (
    <details ref={ref} className="hk-group" open={open} data-revealed={revealed || undefined}>
      <summary className="hk-group-title">
        <span>{group.label}</span>
        <span className="hk-group-count">{group.sliders.length}</span>
      </summary>
      <div className="hk-group-body">
        {group.sliders.map((s) => (
          <ShapeSlider key={s.id} entry={s} task={task} {...rest} />
        ))}
      </div>
    </details>
  );
}

const matches = (s: SliderEntry, q: string) =>
  s.label.toLowerCase().includes(q) || s.id.toLowerCase().includes(q);

export function ShapePanel({ editor, task, query, onFocus, reveal = null }: ShapePanelProps) {
  const q = query.trim().toLowerCase();
  if (q) {
    const hits = editor.tasks.flatMap((t) =>
      t.groups.flatMap((g) => g.sliders.filter((s) => matches(s, q)).map((s) => ({ t, g, s }))),
    );
    if (!hits.length) return <p className="hk-empty">No sliders match “{query.trim()}”.</p>;
    return (
      <div className="hk-group-body">
        {hits.map(({ t, g, s }) => (
          <div key={s.id} className="hk-hit">
            <p className="hk-hit-path">
              {t.label} · {g.label}
            </p>
            <ShapeSlider editor={editor} entry={s} task={t} onFocus={onFocus} />
          </div>
        ))}
      </div>
    );
  }
  if (!task) return null;
  return (
    <div className="hk-groups">
      {task.groups.map((g, i) => {
        const revealed = reveal?.group === g.id;
        return (
          <Group
            // A new reveal remounts the group, so it opens even if the user closed it.
            key={`${task.id}/${g.id}${revealed ? `#${reveal.nonce}` : ""}`}
            editor={editor}
            group={g}
            task={task}
            open={revealed || (!reveal && (i === 0 || task.groups.length <= 2))}
            revealed={revealed}
            onFocus={onFocus}
          />
        );
      })}
    </div>
  );
}
