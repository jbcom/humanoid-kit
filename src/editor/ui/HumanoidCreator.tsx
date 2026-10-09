/**
 * `<HumanoidCreator>`: a complete character creator over MakeHuman's own
 * modelling taxonomy. The figure on a studio stage; a panel with MakeHuman's
 * tabs (Main, Gender, Face, Torso, Arms and Legs, Measure, Body shapes) plus
 * skin and eyes; search across every slider; undo and redo; seeded random
 * figures; reset; and save and load as JSON. Picking a slider glides the
 * camera to the part it shapes, from MakeHuman's camera hints.
 *
 * It must be inside a `<HumanoidProvider>`. Adult anatomy sliders appear only
 * when the client loaded that pack, and stay unavailable for figures under 18.
 */
import { Canvas } from "@react-three/fiber";
import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { NO_FEATURE } from "../../makehuman/features.ts";
import { Humanoid, type HumanoidPick, useHumanoidClient } from "../../react/Humanoid.tsx";
import { STUDIO_EXPOSURE, STUDIO_TONE_MAPPING, StudioStage } from "../../react/StudioStage.tsx";
import type { Recipe } from "../../recipe/recipe.ts";
import type { PickMap } from "../../worker/client.ts";
import { type FrameRequest, frameRequest } from "../framing.ts";
import { AppearancePanel } from "./AppearancePanel.tsx";
import { CameraRig } from "./CameraRig.tsx";
import { RegionPanel } from "./RegionPanel.tsx";
import { ShapePanel } from "./ShapePanel.tsx";
import { CREATOR_CSS } from "./styles.ts";
import { type HumanoidEditor, useHumanoidEditor } from "./useHumanoidEditor.ts";

export interface HumanoidCreatorProps {
  initialRecipe?: Recipe;
  /** Called with every new recipe (including undo, redo and loads). */
  onChange?: (recipe: Recipe) => void;
  /** Heading shown above the controls. */
  title?: string;
  className?: string;
  /** Extra scene content rendered beside the figure. */
  children?: ReactNode;
}

const APPEARANCE_TAB = "hk:appearance";
const REGIONS_TAB = "hk:regions";
const WHOLE_BODY: FrameRequest = { part: "body", direction: "front" };

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} />
  </svg>
);
const ICONS = {
  undo: "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  redo: "m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13",
  random: "M4 4h16v16H4zM8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01",
  reset: "M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4",
  save: "M12 4v11m0 0-4-4m4 4 4-4M5 20h14",
  load: "M12 20V9m0 0-4 4m4-4 4 4M5 4h14",
};

class CreatorErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }
  override render() {
    if (this.state.error)
      return (
        <div className="hk-status" role="alert">
          The figure could not be loaded: {this.state.error.message}
        </div>
      );
    return this.props.children;
  }
}

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] as number;
}

function download(recipe: Recipe) {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(recipe, null, 2)}\n`], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "figure.json";
  a.click();
  URL.revokeObjectURL(url);
}

function Toolbar({
  editor,
  title,
  onProblems,
}: {
  editor: HumanoidEditor;
  title: string;
  onProblems: (p: string[]) => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const button = (label: string, icon: string, action: () => void, disabled = false) => (
    <button
      type="button"
      className="hk-icon-button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={action}
    >
      <Icon d={icon} />
    </button>
  );
  return (
    <div className="hk-toolbar">
      <h2 className="hk-title">{title}</h2>
      {button("Undo", ICONS.undo, editor.undo, !editor.canUndo)}
      {button("Redo", ICONS.redo, editor.redo, !editor.canRedo)}
      {button("Random figure", ICONS.random, () => editor.randomize(randomSeed()), !editor.ready)}
      {button("Reset figure", ICONS.reset, editor.resetAll)}
      {button("Save figure", ICONS.save, () => download(editor.recipe))}
      {button("Load figure", ICONS.load, () => file.current?.click(), !editor.ready)}
      <input
        ref={file}
        className="hk-visually-hidden"
        type="file"
        accept="application/json,.json"
        tabIndex={-1}
        aria-hidden="true"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            onProblems(editor.load(JSON.parse(await f.text())));
          } catch (err) {
            onProblems([`${f.name} is not a saved figure: ${(err as Error).message}`]);
          }
        }}
      />
    </div>
  );
}

function CreatorBody({
  initialRecipe,
  onChange,
  title = "Create",
  children,
}: HumanoidCreatorProps) {
  const editor = useHumanoidEditor(initialRecipe);
  const client = useHumanoidClient();
  const { ready, recipe, tasks } = editor;
  const [tab, setTab] = useState<string | null>(null);
  const [pickMap, setPickMap] = useState<PickMap | null>(null);
  const [reveal, setReveal] = useState<{ group: string; nonce: number } | null>(null);
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<FrameRequest>(WHOLE_BODY);
  const [problems, setProblems] = useState<string[]>([]);
  const [lift, setLift] = useState(0);
  const positions = useRef<Float32Array | null>(null);
  const [hasFigure, setHasFigure] = useState(false);
  const tabsId = useId();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    onChangeRef.current?.(recipe);
  }, [recipe]);

  const activeTab = tab ?? tasks[0]?.id ?? APPEARANCE_TAB;
  const task = tasks.find((t) => t.id === activeTab) ?? null;
  const tabs = [
    ...tasks.map((t) => ({ id: t.id, label: t.label })),
    { id: REGIONS_TAB, label: "Regions" },
    { id: APPEARANCE_TAB, label: "Skin & eyes" },
  ];
  // Task ids contain spaces, so element ids use the tab's position.
  const tabElementId = (id: string) => `${tabsId}-tab-${tabs.findIndex((t) => t.id === id)}`;
  const reframe = (f: FrameRequest) =>
    setFocus((cur) => (cur.part === f.part && cur.direction === f.direction ? cur : f));

  useEffect(() => {
    if (!ready) return;
    let live = true;
    // The map waits for the modifier targets; until it arrives a tap does nothing.
    // If they fail, evaluations that need them report it, so it is not repeated here.
    client.pickMap().then(
      (m) => live && setPickMap(m),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [client, ready]);

  /** Opens the controls of the tapped part of the figure and frames it. */
  const onPick = (p: HumanoidPick) => {
    const table = p.part === "body" ? pickMap?.render.body : pickMap?.render.attachments[p.part];
    const index = table?.[p.vertex];
    if (index === undefined || index === NO_FEATURE) return;
    const feature = pickMap?.features[index];
    const task = tasks.find((t) => t.id === feature?.task);
    const group = task?.groups.find((g) => g.id === feature?.group);
    if (!task || !group) return;
    setQuery("");
    setTab(task.id);
    setReveal((r) => ({ group: group.id, nonce: (r?.nonce ?? 0) + 1 }));
    // Frame the part the group shapes, facing it as the user was when they tapped it;
    // MakeHuman's side views stay with the sliders that ask for them.
    reframe({
      part: frameRequest(group.sliders[0]?.camera ?? null, task.camera).part,
      direction: "front",
    });
  };

  return (
    <>
      {/* data-pick: whether tapping the figure opens its controls yet (they need the modifier targets). */}
      <div className="hk-stage" data-pick={pickMap ? "ready" : "loading"}>
        <Canvas
          shadows="percentage"
          camera={{ position: [0, 1, 3.4], fov: 32 }}
          gl={{
            toneMapping: STUDIO_TONE_MAPPING,
            toneMappingExposure: STUDIO_EXPOSURE,
            preserveDrawingBuffer: true,
          }}
          aria-label="Figure preview"
        >
          <StudioStage />
          <Humanoid
            recipe={recipe}
            position={[0, lift, 0]}
            onPick={onPick}
            onEvaluated={(ev) => {
              positions.current = ev.positions;
              setLift(ev.groundOffset);
              setHasFigure(true);
            }}
          />
          {ready && (
            <CameraRig
              ready={ready}
              positions={hasFigure ? positions.current : null}
              offsetY={lift}
              focus={focus}
            />
          )}
          {children}
        </Canvas>
        {!hasFigure && <div className="hk-status">Loading figure…</div>}
      </div>
      <section
        className="hk-panel"
        aria-label="Figure controls"
        onKeyDown={(e) => {
          const mod = e.metaKey || e.ctrlKey;
          if (!mod || e.key.toLowerCase() !== "z") return;
          e.preventDefault();
          if (e.shiftKey) editor.redo();
          else editor.undo();
        }}
      >
        <Toolbar editor={editor} title={title} onProblems={setProblems} />
        {problems.length > 0 && (
          <div className="hk-error" role="alert">
            That figure could not be loaded:
            <ul>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="hk-search-row">
          <input
            className="hk-search"
            type="search"
            placeholder="Search sliders"
            aria-label="Search sliders"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {!query.trim() && (
          <div className="hk-tabs" role="tablist" aria-label="Control groups">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={tabElementId(t.id)}
                className="hk-tab"
                aria-selected={t.id === activeTab}
                aria-controls={`${tabsId}-panel`}
                onClick={() => {
                  setTab(t.id);
                  setReveal(null);
                  const target = tasks.find((x) => x.id === t.id);
                  reframe(
                    target?.camera === "faceCamera"
                      ? { part: "head", direction: "front" }
                      : WHOLE_BODY,
                  );
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        {query.trim() ? (
          <section className="hk-scroll" aria-label="Search results">
            <ShapePanel editor={editor} task={null} query={query} onFocus={reframe} />
          </section>
        ) : (
          <div
            className="hk-scroll"
            id={`${tabsId}-panel`}
            role="tabpanel"
            aria-labelledby={tabElementId(activeTab)}
          >
            {!ready ? (
              <p className="hk-empty">Loading controls…</p>
            ) : activeTab === REGIONS_TAB ? (
              <RegionPanel editor={editor} onFocus={reframe} />
            ) : activeTab === APPEARANCE_TAB ? (
              <AppearancePanel editor={editor} onFocus={reframe} />
            ) : (
              <ShapePanel editor={editor} task={task} query="" onFocus={reframe} reveal={reveal} />
            )}
          </div>
        )}
      </section>
    </>
  );
}

export function HumanoidCreator(props: HumanoidCreatorProps) {
  return (
    <div className={props.className ? `hk-creator ${props.className}` : "hk-creator"}>
      <style href="humanoid-kit-creator" precedence="default">
        {CREATOR_CSS}
      </style>
      <CreatorErrorBoundary>
        <CreatorBody {...props} />
      </CreatorErrorBoundary>
    </div>
  );
}
