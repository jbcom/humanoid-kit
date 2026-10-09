/**
 * The wardrobe: the clothing pack's garments by kind, one chip each. Choosing
 * a garment wears it (and takes off the one of its kind it replaces); choosing
 * a worn one takes it off. Kinds layer over one another, so a jacket goes over
 * a suit. Shown only when the client loaded a clothing pack.
 */
import { wardrobeGroups, wearGarment, wornIn } from "../wardrobe.ts";
import type { HumanoidEditor } from "./useHumanoidEditor.ts";

/** "male_casualsuit01" as "Male casualsuit 01". */
const title = (name: string) => {
  const spaced = name.replace(/_/g, " ").replace(/(\D)(\d+)$/, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

export function WardrobePanel({ editor }: { editor: HumanoidEditor }) {
  const wardrobe = editor.ready?.wardrobe ?? [];
  const worn = new Set(wornIn(editor.recipe));
  const groups = wardrobeGroups(wardrobe);
  if (!groups.length) return <p className="hk-empty">No clothing pack is loaded.</p>;
  return (
    <div className="hk-groups">
      {groups.map((group) => {
        const on = group.garments.filter((g) => worn.has(g.id)).length;
        return (
          <details key={group.kind} className="hk-group" open>
            <summary className="hk-group-title">
              <span>{group.label}</span>
              {on > 0 && <span className="hk-group-count">{on} worn</span>}
            </summary>
            <fieldset className="hk-chips">
              <legend className="hk-visually-hidden">{group.label}</legend>
              {group.garments.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className="hk-chip"
                  aria-pressed={worn.has(g.id)}
                  title={g.tags.join(", ")}
                  onClick={() => editor.update((r) => wearGarment(r, g, wardrobe))}
                >
                  {title(g.name)}
                </button>
              ))}
            </fieldset>
          </details>
        );
      })}
    </div>
  );
}
