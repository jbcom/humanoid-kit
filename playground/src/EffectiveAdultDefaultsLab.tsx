import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import {
  createRecipe,
  type Recipe,
  resetSliderValue,
  type SliderEntry,
  withAnatomyDefaults,
  withSliderValue,
} from "humanoid-kit";
import {
  Humanoid,
  STUDIO_EXPOSURE,
  STUDIO_SHADOWS,
  STUDIO_TONE_MAPPING,
  StudioStage,
  useHumanoidReady,
} from "humanoid-kit/react";
import { useMemo, useState } from "react";

type Anchor = {
  id: "feminine" | "mixed" | "masculine";
  label: string;
  gender: number;
};

const INITIAL_ANCHOR: Anchor = { id: "mixed", label: "Mixed", gender: 0.5 };
const ANCHORS: readonly Anchor[] = [
  { id: "feminine", label: "Feminine", gender: 0 },
  INITIAL_ANCHOR,
  { id: "masculine", label: "Masculine", gender: 1 },
];

const ADULT_AGE = 30;

function anchorRecipe(anchor: Anchor): Recipe {
  return createRecipe({ macros: { age: ADULT_AGE, gender: anchor.gender } });
}

function hasOwnModifier(recipe: Recipe, id: string): boolean {
  return Object.hasOwn(recipe.modifiers, id);
}

/**
 * A small QA workbench for the adult pack's default contract. It deliberately
 * avoids the creator's full slider bank: this route is for checking that the
 * recipe shown, the effective resolver value, and the rendered worker figure
 * agree when a default is absent, explicitly zero, reset, or undone.
 */
export function EffectiveAdultDefaultsLab() {
  const ready = useHumanoidReady();
  const [anchor, setAnchor] = useState<Anchor>(INITIAL_ANCHOR);
  const [recipe, setRecipe] = useState<Recipe>(() => anchorRecipe(INITIAL_ANCHOR));
  const [history, setHistory] = useState<readonly Recipe[]>([]);
  const [settled, setSettled] = useState(false);

  const defaults = ready?.anatomy?.defaults;
  const defaultedControls = useMemo<readonly SliderEntry[]>(() => {
    if (!ready || !defaults) return [];
    return ready.sliders
      .flatMap((task) => task.groups.flatMap((group) => group.sliders))
      .filter(
        (entry): entry is SliderEntry =>
          entry.kind === "modifier" && Object.hasOwn(defaults, entry.id),
      );
  }, [defaults, ready]);

  // One canonical expansion per render: the table reads this same effective
  // recipe, while Humanoid's worker applies the same loaded defaults itself.
  const effectiveRecipe = useMemo(() => withAnatomyDefaults(recipe, defaults), [defaults, recipe]);
  const modifierTable = useMemo(
    () => new Map(ready?.modifiers.map((modifier) => [modifier.id, modifier])),
    [ready?.modifiers],
  );

  function replaceRecipe(next: Recipe) {
    setHistory((past) => [...past, recipe]);
    setSettled(false);
    setRecipe(next);
  }

  function chooseAnchor(next: Anchor) {
    setAnchor(next);
    setHistory([]);
    setSettled(false);
    setRecipe(anchorRecipe(next));
  }

  function undo() {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory((past) => past.slice(0, -1));
    setSettled(false);
    setRecipe(previous);
  }

  if (!ready) {
    return <LabNotice>Loading the adult-pack diagnostic…</LabNotice>;
  }
  if (!defaults || !ready.adultAnatomyLoaded) {
    return (
      <LabNotice>
        This diagnostic needs the locally loaded adult pack. Open it with{" "}
        <code>?adult&amp;muted&amp;lab=effective-adult-values</code>.
      </LabNotice>
    );
  }

  return (
    <main style={styles.page} data-lab="effective-adult-values">
      <section style={styles.panel} aria-labelledby="default-lab-title">
        <p style={styles.eyebrow}>Humanoid-kit QA lab</p>
        <h1 id="default-lab-title" style={styles.title}>
          Effective adult defaults
        </h1>
        <p style={styles.copy}>
          This is a default-semantics diagnostic, not the finished anatomy editor. Each row compares
          the saved raw recipe with the loaded pack’s canonical effective value.
        </p>

        <fieldset style={styles.fieldset}>
          <legend style={styles.legend}>Adult anchor</legend>
          <div style={styles.anchorRow}>
            {ANCHORS.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                onClick={() => chooseAnchor(candidate)}
                aria-pressed={candidate.id === anchor.id}
                style={{ ...styles.button, ...(candidate.id === anchor.id ? styles.selected : {}) }}
              >
                {candidate.label}
              </button>
            ))}
          </div>
        </fieldset>

        <div style={styles.status} aria-live="polite">
          <strong>Rendered worker:</strong> {settled ? "settled" : "evaluating"} · age {ADULT_AGE} ·
          gender {anchor.gender.toFixed(1)}
        </div>

        {defaultedControls.length === 4 ? null : (
          <p style={styles.warning}>
            Expected four loaded defaulted adult controls; found {defaultedControls.length}. This is
            a pack/content mismatch to investigate before accepting this lab.
          </p>
        )}

        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Loaded control</th>
                <th style={styles.th}>Raw recipe</th>
                <th style={styles.th}>Effective / rendered</th>
                <th style={styles.th}>Check</th>
              </tr>
            </thead>
            <tbody>
              {defaultedControls.map((entry) => {
                const raw = hasOwnModifier(recipe, entry.id)
                  ? recipe.modifiers[entry.id]
                  : undefined;
                const effective = effectiveRecipe.modifiers[entry.id] ?? 0;
                return (
                  <tr key={entry.id}>
                    <th scope="row" style={styles.rowHead}>
                      <span>{entry.label}</span>
                      <code style={styles.id}>{entry.id}</code>
                    </th>
                    <td style={styles.cell}>
                      {raw === undefined ? "absent (default applies)" : raw.toFixed(3)}
                    </td>
                    <td style={styles.cell} data-effective-control={entry.id}>
                      {effective.toFixed(3)}
                    </td>
                    <td style={styles.cell}>
                      <div style={styles.actionRow}>
                        <button
                          type="button"
                          style={styles.smallButton}
                          onClick={() =>
                            replaceRecipe(
                              withSliderValue(recipe, entry, 0, modifierTable, defaults),
                            )
                          }
                        >
                          Explicit 0
                        </button>
                        <button
                          type="button"
                          style={styles.smallButton}
                          disabled={raw === undefined}
                          onClick={() =>
                            replaceRecipe(resetSliderValue(recipe, entry, modifierTable, defaults))
                          }
                        >
                          Reset
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={styles.footerRow}>
          <button
            type="button"
            style={styles.button}
            disabled={history.length === 0}
            onClick={undo}
          >
            Undo last change
          </button>
          <span style={styles.muted}>
            History: {history.length} change{history.length === 1 ? "" : "s"}
          </span>
        </div>
        <p style={styles.note}>
          Reset removes only an explicit saved override for a defaulted adult control; it does not
          write a synthetic value. Undo restores the exact prior recipe.
        </p>
      </section>

      <section style={styles.viewport} aria-label="Rendered adult default diagnostic">
        <Canvas
          shadows={STUDIO_SHADOWS}
          camera={{ position: [0, 1.02, 3.15], fov: 34 }}
          gl={{
            preserveDrawingBuffer: true,
            toneMapping: STUDIO_TONE_MAPPING,
            toneMappingExposure: STUDIO_EXPOSURE,
          }}
        >
          <StudioStage />
          <Humanoid recipe={recipe} onSettled={() => setSettled(true)} />
          <OrbitControls makeDefault enablePan={false} target={[0, 0.95, 0]} />
        </Canvas>
      </section>
    </main>
  );
}

function LabNotice({ children }: { children: React.ReactNode }) {
  return <main style={styles.notice}>{children}</main>;
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "grid",
    gridTemplateColumns: "minmax(28rem, 0.95fr) minmax(30rem, 1.05fr)",
    background: "#111315",
    color: "#eef1ef",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
  },
  panel: { padding: "2rem", overflowY: "auto", background: "#202522" },
  eyebrow: {
    margin: 0,
    color: "#9fd4ba",
    fontWeight: 700,
    letterSpacing: "0.09em",
    textTransform: "uppercase",
    fontSize: "0.72rem",
  },
  title: { margin: "0.35rem 0 0", fontSize: "2rem", lineHeight: 1.05 },
  copy: { color: "#c6ccc8", lineHeight: 1.5, maxWidth: "62ch" },
  fieldset: {
    margin: "1.5rem 0",
    padding: "0.8rem",
    border: "1px solid #52665a",
    borderRadius: "0.5rem",
  },
  legend: { padding: "0 0.3rem", color: "#b9c9bf", fontWeight: 700 },
  anchorRow: { display: "flex", gap: "0.5rem", flexWrap: "wrap" },
  button: {
    border: "1px solid #759983",
    borderRadius: "0.35rem",
    padding: "0.5rem 0.7rem",
    background: "#26382d",
    color: "#f5faf6",
    cursor: "pointer",
    fontWeight: 700,
  },
  selected: { background: "#9fd4ba", color: "#102217", borderColor: "#c4f0d6" },
  smallButton: {
    border: "1px solid #5d806a",
    borderRadius: "0.28rem",
    padding: "0.35rem 0.45rem",
    background: "#18281e",
    color: "#e7f5eb",
    cursor: "pointer",
    fontSize: "0.78rem",
  },
  status: {
    padding: "0.7rem",
    background: "#152019",
    borderLeft: "3px solid #9fd4ba",
    lineHeight: 1.4,
  },
  warning: { padding: "0.7rem", background: "#3f291d", color: "#ffdbbd", lineHeight: 1.4 },
  tableWrap: {
    overflowX: "auto",
    marginTop: "1.2rem",
    border: "1px solid #425448",
    borderRadius: "0.45rem",
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" },
  th: {
    textAlign: "left",
    padding: "0.6rem",
    background: "#172019",
    color: "#cbe4d4",
    verticalAlign: "bottom",
  },
  rowHead: {
    textAlign: "left",
    padding: "0.6rem",
    borderTop: "1px solid #38473d",
    fontWeight: 700,
    minWidth: "10rem",
  },
  cell: {
    padding: "0.6rem",
    borderTop: "1px solid #38473d",
    verticalAlign: "top",
    fontVariantNumeric: "tabular-nums",
  },
  id: {
    display: "block",
    color: "#9ca9a0",
    marginTop: "0.2rem",
    fontSize: "0.7rem",
    overflowWrap: "anywhere",
  },
  actionRow: { display: "flex", gap: "0.35rem", flexWrap: "wrap" },
  footerRow: { display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "1rem" },
  muted: { color: "#a9b4ac", fontSize: "0.85rem" },
  note: { color: "#c1cbc4", lineHeight: 1.45, fontSize: "0.9rem" },
  viewport: { minHeight: "45rem", position: "sticky", top: 0 },
  notice: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    padding: "2rem",
    background: "#111315",
    color: "#eef1ef",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
  },
};
