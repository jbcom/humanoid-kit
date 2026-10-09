/**
 * The shape controls of one MakeHuman task (Main, Gender, Face, ...): its
 * groups as collapsible sections of sliders. With a search query, matching
 * sliders from every task are listed instead.
 */
import type { SliderEntry, SliderGroup, SliderTask } from "../../format/assetFormat.ts";
import { formatSliderValue, sliderAvailability, sliderRange, sliderValue } from "../controls.ts";
import type { FrameRequest } from "../framing.ts";
import { frameRequest } from "../framing.ts";
import { SliderRow } from "./SliderRow.tsx";
import type { HumanoidEditor } from "./useHumanoidEditor.ts";

export interface ShapePanelProps {
  editor: HumanoidEditor;
  task: SliderTask | null;
  query: string;
  onFocus: (frame: FrameRequest) => void;
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
  const range = sliderRange(entry, editor.modifiers);
  const availability = sliderAvailability(editor.recipe, entry, editor.modifiers);
  return (
    <SliderRow
      label={entry.label}
      value={sliderValue(editor.recipe, entry)}
      min={range.min}
      max={range.max}
      step={range.step}
      neutral={range.neutral}
      format={(v) => formatSliderValue(entry, v, range)}
      description={entry.description}
      disabledReason={availability.enabled ? null : availability.reason}
      onChange={(v, gesture) => editor.setSlider(entry, v, gesture)}
      onSettle={editor.settle}
      onFocus={() => onFocus(frameRequest(entry.camera, task.camera))}
    />
  );
}

function Group({
  group,
  task,
  open,
  ...rest
}: {
  editor: HumanoidEditor;
  group: SliderGroup;
  task: SliderTask;
  open: boolean;
  onFocus: (frame: FrameRequest) => void;
}) {
  return (
    <details className="hk-group" open={open}>
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

export function ShapePanel({ editor, task, query, onFocus }: ShapePanelProps) {
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
      {task.groups.map((g, i) => (
        <Group
          key={`${task.id}/${g.id}`}
          editor={editor}
          group={g}
          task={task}
          open={i === 0 || task.groups.length <= 2}
          onFocus={onFocus}
        />
      ))}
    </div>
  );
}
