import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  createHistory,
  createRecipe,
  historyReducer,
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
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Box3, type Camera, type Object3D, PerspectiveCamera, Vector3 } from "three";

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

type RenderReceipt = {
  fullyVisible: boolean;
  horizontal: [number, number];
  vertical: [number, number];
};
type CameraControls = { target: Vector3; update(): void };

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
  const [history, dispatch] = useReducer(historyReducer, INITIAL_ANCHOR, (initial) =>
    createHistory(anchorRecipe(initial)),
  );
  const recipe = history.present;
  const [settled, setSettled] = useState(false);
  const [fitted, setFitted] = useState(false);
  const [receipt, setReceipt] = useState<RenderReceipt | null>(null);

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
  const modelStatus = receipt
    ? receipt.fullyVisible
      ? "settled and fully in view"
      : "settled, bounds extend outside view"
    : settled
      ? fitted
        ? "settled; measuring viewport bounds"
        : "settled; fitting camera to model bounds"
      : "evaluating";

  function replaceRecipe(change: (current: Recipe) => Recipe) {
    dispatch({ type: "apply", change });
    setSettled(false);
    setFitted(false);
    setReceipt(null);
  }

  function chooseAnchor(next: Anchor) {
    setAnchor(next);
    dispatch({ type: "reset", recipe: anchorRecipe(next) });
    setSettled(false);
    setFitted(false);
    setReceipt(null);
  }

  function undo() {
    dispatch({ type: "undo" });
    setSettled(false);
    setFitted(false);
    setReceipt(null);
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
    <main className="effective-defaults-lab" style={styles.page} data-lab="effective-adult-values">
      <style>{responsiveCss}</style>
      <section
        className="effective-defaults-lab__panel"
        style={styles.panel}
        aria-labelledby="default-lab-title"
        data-lab-panel
      >
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
          <strong>Rendered model:</strong> {modelStatus} · age {ADULT_AGE} · gender{" "}
          {anchor.gender.toFixed(1)}
        </div>
        <p
          style={{ ...styles.receipt, visibility: receipt ? "visible" : "hidden" }}
          data-render-bounds={receipt?.fullyVisible ? "visible" : "pending"}
          aria-hidden={!receipt}
        >
          {receipt ? (
            <>
              Measured model bounds in this canvas: horizontal{" "}
              {formatPercent(receipt.horizontal[0])}–{formatPercent(receipt.horizontal[1])},
              vertical {formatPercent(receipt.vertical[0])}–{formatPercent(receipt.vertical[1])}.
            </>
          ) : (
            "Measured model bounds in this canvas: horizontal 0%–100%, vertical 0%–100%."
          )}
        </p>

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
                  <tr key={entry.id} data-control-id={entry.id}>
                    <th scope="row" style={styles.rowHead}>
                      <span>{entry.label}</span>
                      <code style={styles.id}>{entry.id}</code>
                    </th>
                    <td style={styles.cell} data-raw-control={entry.id}>
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
                          aria-label={`Set ${entry.label} to zero`}
                          data-action="explicit-zero"
                          onClick={() =>
                            replaceRecipe((current) =>
                              withSliderValue(current, entry, 0, modifierTable, defaults),
                            )
                          }
                        >
                          Set {entry.label} to 0
                        </button>
                        <button
                          type="button"
                          style={styles.smallButton}
                          aria-label={`Reset ${entry.label}`}
                          data-action="reset"
                          disabled={raw === undefined}
                          onClick={() =>
                            replaceRecipe((current) =>
                              resetSliderValue(current, entry, modifierTable, defaults),
                            )
                          }
                        >
                          Reset {entry.label}
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
            disabled={history.past.length === 0}
            onClick={undo}
          >
            Undo last change
          </button>
          <span style={styles.muted}>
            History: {history.past.length} change{history.past.length === 1 ? "" : "s"}
          </span>
        </div>
        <p style={styles.note}>
          Reset removes only an explicit saved override for a defaulted adult control; it does not
          write a synthetic value. Undo restores the exact prior recipe.
        </p>
      </section>

      <section
        className="effective-defaults-lab__viewport"
        style={styles.viewport}
        aria-label="Rendered adult default diagnostic"
        data-lab-stage
      >
        <Canvas
          style={styles.canvas}
          shadows={STUDIO_SHADOWS}
          camera={{ position: [0, 1.02, 3.15], fov: 34 }}
          gl={{
            preserveDrawingBuffer: true,
            toneMapping: STUDIO_TONE_MAPPING,
            toneMappingExposure: STUDIO_EXPOSURE,
          }}
        >
          <StudioStage />
          <Humanoid
            recipe={recipe}
            onSettled={() => {
              setReceipt(null);
              setFitted(false);
              setSettled(true);
            }}
          />
          <FitFigure settled={settled} onFitted={() => setFitted(true)} />
          <ViewportReceipt settled={settled && fitted} onReceipt={setReceipt} />
          <OrbitControls makeDefault enablePan={false} target={[0, 0.95, 0]} />
        </Canvas>
      </section>
    </main>
  );
}

/** Fits the live Canvas camera to the rendered figure after each worker evaluation. */
function FitFigure({ settled, onFitted }: { settled: boolean; onFitted: () => void }) {
  const { camera, scene, size } = useThree();
  const reported = useRef(false);
  const callback = useRef(onFitted);
  callback.current = onFitted;

  useEffect(() => {
    if (!settled) reported.current = false;
  }, [settled]);

  useFrame((state) => {
    if (!settled || reported.current) return;
    const figure = figureRoot(scene);
    if (!figure || !(camera instanceof PerspectiveCamera)) return;
    scene.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(figure);
    if (bounds.isEmpty()) return;
    fitCameraToBounds(camera, cameraControls(state.controls), bounds, size.width / size.height);
    reported.current = true;
    callback.current();
    state.invalidate();
  });
  return null;
}

/** Reads the actual figure group's post-render bounds in Canvas coordinates. */
function ViewportReceipt({
  settled,
  onReceipt,
}: {
  settled: boolean;
  onReceipt: (receipt: RenderReceipt) => void;
}) {
  const { camera, scene } = useThree();
  const reported = useRef(false);
  const callback = useRef(onReceipt);
  callback.current = onReceipt;

  useEffect(() => {
    if (!settled) reported.current = false;
  }, [settled]);

  useFrame(() => {
    if (!settled || reported.current) return;
    const figure = figureRoot(scene);
    if (!figure) return;
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld();
    const bounds = new Box3().setFromObject(figure);
    if (bounds.isEmpty()) return;
    const receipt = receiptOf(bounds, camera);
    reported.current = true;
    callback.current(receipt);
  });
  return null;
}

function figureRoot(scene: Object3D): Object3D | null {
  let figure: Object3D | null = null;
  scene.traverse((object) => {
    if (!figure && object.userData.groundOffset !== undefined) figure = object;
  });
  return figure;
}

function receiptOf(bounds: Box3, camera: Camera): RenderReceipt {
  const points = [
    new Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
    new Vector3(bounds.min.x, bounds.min.y, bounds.max.z),
    new Vector3(bounds.min.x, bounds.max.y, bounds.min.z),
    new Vector3(bounds.min.x, bounds.max.y, bounds.max.z),
    new Vector3(bounds.max.x, bounds.min.y, bounds.min.z),
    new Vector3(bounds.max.x, bounds.min.y, bounds.max.z),
    new Vector3(bounds.max.x, bounds.max.y, bounds.min.z),
    new Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
  ].map((point) => point.project(camera));
  const horizontal: [number, number] = [
    Math.min(...points.map((point) => point.x)),
    Math.max(...points.map((point) => point.x)),
  ];
  const vertical: [number, number] = [
    Math.min(...points.map((point) => point.y)),
    Math.max(...points.map((point) => point.y)),
  ];
  return {
    horizontal,
    vertical,
    fullyVisible:
      horizontal[0] >= -1 && horizontal[1] <= 1 && vertical[0] >= -1 && vertical[1] <= 1,
  };
}

function fitCameraToBounds(
  camera: PerspectiveCamera,
  controls: CameraControls | null,
  bounds: Box3,
  aspect: number,
): void {
  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  const direction = camera.position.clone().sub(center);
  if (direction.lengthSq() < 1e-6) direction.set(0, 0, 1);
  direction.normalize();
  const halfVerticalFov = (camera.fov * Math.PI) / 360;
  const distance =
    Math.max(
      size.y / 2 / Math.tan(halfVerticalFov),
      size.x / 2 / (Math.tan(halfVerticalFov) * Math.max(aspect, 0.01)),
    ) *
      1.18 +
    size.z / 2;
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.near = Math.max(0.01, distance - size.length() * 1.5);
  camera.far = Math.max(camera.near + 1, distance + size.length() * 1.5);
  camera.updateProjectionMatrix();
  camera.lookAt(center);
  if (controls) {
    controls.target.copy(center);
    controls.update();
  }
}

function cameraControls(value: unknown): CameraControls | null {
  if (
    value !== null &&
    typeof value === "object" &&
    "target" in value &&
    value.target instanceof Vector3 &&
    "update" in value &&
    typeof value.update === "function"
  )
    return value as CameraControls;
  return null;
}

function formatPercent(ndc: number): string {
  return `${(((ndc + 1) / 2) * 100).toFixed(0)}%`;
}

function LabNotice({ children }: { children: React.ReactNode }) {
  return <main style={styles.notice}>{children}</main>;
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    position: "fixed",
    inset: 0,
    boxSizing: "border-box",
    display: "grid",
    background: "#111315",
    color: "#eef1ef",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
  },
  panel: { boxSizing: "border-box", padding: "2rem", overflowY: "auto", background: "#202522" },
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
  selected: { background: "#9fd4ba", color: "#102217", border: "1px solid #c4f0d6" },
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
    minHeight: "3.6rem",
    display: "flex",
    alignItems: "center",
    padding: "0.7rem",
    background: "#152019",
    borderLeft: "3px solid #9fd4ba",
    lineHeight: 1.4,
  },
  receipt: {
    minHeight: "2.8rem",
    margin: "0.55rem 0 0",
    color: "#d2ded6",
    lineHeight: 1.4,
    fontSize: "0.82rem",
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
  viewport: { minHeight: 0, height: "100dvh", position: "relative", overflow: "hidden" },
  canvas: { width: "100%", height: "100%", display: "block" },
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

const responsiveCss = `
  .effective-defaults-lab {
    height: 100dvh;
    width: 100vw;
    grid-template-columns: minmax(28rem, 0.95fr) minmax(30rem, 1.05fr);
    overflow: clip;
  }
  .effective-defaults-lab__panel { min-height: 0; height: 100dvh; }
  @media (max-width: 760px) {
    .effective-defaults-lab {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(17rem, 0.48fr) minmax(18rem, 0.52fr);
    }
    .effective-defaults-lab__viewport { grid-row: 1; height: auto; }
    .effective-defaults-lab__panel { grid-row: 2; height: auto; padding: 1.25rem; }
  }
`;
