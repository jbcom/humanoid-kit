import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  createInteractions,
  createPresenceRegistry,
  createRecipe,
  type FrameOut,
  frameOut,
  type Interaction,
  type InteractionDefinition,
  loadAnimationLibrary,
  type SlotPlacement,
  type Vec3,
} from "humanoid-kit";
import {
  Humanoid,
  type HumanoidAffordances,
  PresenceProvider,
  STUDIO_EXPOSURE,
  STUDIO_TONE_MAPPING,
  StudioStage,
  useHumanoidAffordances,
} from "humanoid-kit/react";
import { animationsPack } from "humanoid-kit-animations";
import {
  Component,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { type Group, MathUtils, type Object3D, Vector3 } from "three";
import { sampleRequiredHandFrame } from "./handFrame";

type Stage = "approach" | "grip" | "release" | "cancel";
type View = "front" | "three-quarter" | "side";
type ReviewMode = "inspect" | "play";

const params = new URLSearchParams(window.location.search);
const stageOptions: readonly Stage[] = ["approach", "grip", "release", "cancel"];
const viewOptions: readonly View[] = ["front", "three-quarter", "side"];

function stageFromQuery(): Stage {
  const stage = params.get("stage");
  return stageOptions.includes(stage as Stage) ? (stage as Stage) : "approach";
}

function viewFromQuery(): View {
  const view = params.get("view");
  return viewOptions.includes(view as View) ? (view as View) : "front";
}

function persistReviewParam(name: "stage" | "view", value: Stage | View): void {
  const url = new URL(window.location.href);
  url.searchParams.set(name, value);
  window.history.replaceState(null, "", url);
}
const IDLE_CLIP = "idle1";
const IDLE_SECONDS = 2.5;
const TALL_OUTFIT = "suits/male_casualsuit06";
const SHORT_OUTFIT = "suits/female_casualsuit01";

const tall = createRecipe({
  macros: { age: 25, gender: 0.85, height: 0.8 },
  skin: { melanin: 0.32 },
  outfit: [TALL_OUTFIT],
});
const short = createRecipe({
  macros: { age: 25, gender: 0.15, height: 0.2 },
  skin: { melanin: 0.62 },
  outfit: [SHORT_OUTFIT],
});

/**
 * This lab refuses to mount unless its test route is silent, the clothing pack is
 * requested, and both figures are clothed adults. It is intentionally a review
 * source, not a general playground scene. The refusal runs when the lab mounts,
 * never when its module loads: the playground imports every scene, so a throw at
 * load would take down every other route with it.
 */
function requireReviewRoute(): void {
  if (!params.has("muted")) throw new Error("handshake lab requires the silent ?muted route");
  if (!params.has("clothing")) throw new Error("handshake lab requires ?clothing for both figures");
  if (tall.macros.age < 18 || short.macros.age < 18)
    throw new Error("handshake lab requires adult figures");
  if (!tall.outfit?.includes(TALL_OUTFIT) || !short.outfit?.includes(SHORT_OUTFIT))
    throw new Error("handshake lab requires both figures to stay clothed");
}

const standBack = (of: string) => ({ of, measure: "reach" as const, times: -0.7 });

/** A review-only definition that keeps its planned grip target observable in every sheet row. */
const HANDSHAKE_REVIEW: InteractionDefinition = {
  id: "handshake.visual-review",
  tags: ["greeting.handshake"],
  audience: "all",
  roles: [
    {
      name: "initiator",
      takes: "figure",
      affordances: ["hand.R"],
      uses: ["arm.R", "hand.R", "gaze"],
      slot: { offset: [0, 0, standBack("initiator")], yaw: 0, tolerance: 0.04 },
      track: {
        approach: { clip: IDLE_CLIP, loop: true },
        align: { clip: IDLE_CLIP, loop: true },
        act: { clip: IDLE_CLIP, loop: true },
        release: { clip: IDLE_CLIP, loop: true },
      },
    },
    {
      name: "responder",
      takes: "figure",
      affordances: ["hand.R"],
      uses: ["arm.R", "hand.R", "gaze"],
      slot: { offset: [0, 0, standBack("responder")], yaw: 0, tolerance: 0.04 },
      track: {
        approach: { clip: IDLE_CLIP, loop: true },
        align: { clip: IDLE_CLIP, loop: true },
        act: { clip: IDLE_CLIP, loop: true },
        release: { clip: IDLE_CLIP, loop: true },
      },
    },
  ],
  reference: { between: ["initiator", "responder"] },
  // Keeping this planning contact active across the rows lets the sheet compare
  // one runtime target with the two live hand frames before and after the grip.
  contacts: [
    {
      name: "grip",
      a: "initiator:hand.R",
      b: "responder:hand.R",
      during: ["approach", "align", "act", "release"],
    },
  ],
  beats: [{ name: "grip", at: 0.3 }],
  alignSeconds: 0.2,
  // Long enough for the sheet runner to sample the real release frame.
  releaseSeconds: 1.2,
};

interface Control {
  stage: Stage;
  view: View;
  interaction: Interaction | null;
  restart: boolean;
  runEpoch: number;
  restartRun: (() => void) | null;
  mode: ReviewMode;
  held: boolean;
  animationTime: number;
  cancelled: boolean;
  settled: { tall: boolean; short: boolean };
  animationStarted: { tall: boolean; short: boolean };
  clothed: boolean;
  target: Vec3 | null;
  hands: { tall: Vec3; short: Vec3 } | null;
  bindingFailure: string | null;
  phase: string;
  ready: boolean;
  gateSnapshot: GateSnapshot;
  gateListeners: Set<() => void>;
}

interface GateSnapshot {
  readonly stage: Stage;
  readonly view: View;
  readonly phase: string;
  readonly ready: boolean;
  readonly held: boolean;
  readonly mode: ReviewMode;
  readonly animationTime: number;
  readonly settled: { readonly tall: boolean; readonly short: boolean };
  readonly animationStarted: { readonly tall: boolean; readonly short: boolean };
  readonly clothed: boolean;
  readonly target: Vec3 | null;
  readonly hands: { readonly tall: Vec3; readonly short: Vec3 } | null;
  readonly targetGap: { readonly tall: number; readonly short: number } | null;
  readonly bindingFailure: string | null;
}

const INITIAL_GATE_SNAPSHOT: GateSnapshot = {
  stage: "approach",
  view: "front",
  phase: "loading",
  ready: false,
  held: false,
  mode: "inspect",
  animationTime: 0,
  settled: { tall: false, short: false },
  animationStarted: { tall: false, short: false },
  clothed: false,
  target: null,
  hands: null,
  targetGap: null,
  bindingFailure: null,
};

export interface HandshakeLabApi {
  setStage(stage: Stage): void;
  setView(view: View): void;
  inspect(): void;
  play(): void;
  state(): {
    stage: Stage;
    view: View;
    phase: string;
    ready: boolean;
    held: boolean;
    mode: ReviewMode;
    animationTime: number;
    settled: { tall: boolean; short: boolean };
    animationStarted: { tall: boolean; short: boolean };
    muted: boolean;
    adults: boolean;
    clothed: boolean;
    consent: { tall: true; short: true };
    source: "presence-registry+interaction-runtime+animation-library";
    animation: string;
    target: number[] | null;
    hands: { tall: number[]; short: number[] } | null;
    targetGap: { tall: number; short: number } | null;
    bindingFailure: string | null;
  };
}

declare global {
  interface Window {
    hkHandshake?: HandshakeLabApi;
  }
}

const resetGroup = (group: Group | null, x: number, facing: number) => {
  if (!group) return;
  group.position.set(x, 0, 0);
  group.rotation.set(0, facing, 0);
};

function moveToSlot(group: Group | null, slot: SlotPlacement | null, delta: number) {
  if (!group || !slot) return;
  const dx = slot.position[0] - group.position.x;
  const dz = slot.position[2] - group.position.z;
  const distance = Math.hypot(dx, dz);
  const step = Math.min(distance, delta * 1.5);
  if (distance > 0)
    group.position.addScaledVector(new Vector3(dx / distance, 0, dz / distance), step);
  const yaw = Math.atan2(slot.facing[0], slot.facing[2]);
  group.rotation.y = MathUtils.damp(group.rotation.y, yaw, 12, delta);
}

/** A lab-only stage request. The interaction runtime remains the source of phase state. */
function resetReviewRun(control: Control): void {
  // A held review freezes the values sampled from the runtime, while that
  // runtime remains attached to the presence clock. Resetting cancels the old
  // interaction and asks the same live runtime for a fresh run.
  control.restart = true;
  control.cancelled = false;
  control.held = false;
  control.ready = false;
  control.phase = "preparing";
  control.target = null;
  control.hands = null;
  control.animationTime = 0;
  // These describe mounted figure sources, not an interaction run. Their
  // callbacks fire once, so retain the already-proven source readiness.
  control.bindingFailure = null;
}

function selectStage(control: Control, stage: Stage): void {
  control.stage = stage;
  persistReviewParam("stage", stage);
  resetReviewRun(control);
  publishGate(control);
}

function selectView(control: Control, view: View): void {
  control.view = view;
  persistReviewParam("view", view);
  publishGate(control);
}

function selectMode(control: Control, mode: ReviewMode): void {
  control.mode = mode;
  resetReviewRun(control);
  publishGate(control);
}

function snapshotOf(control: Control): GateSnapshot {
  const target = control.target && ([...control.target] as Vec3);
  const hands = control.hands && {
    tall: [...control.hands.tall] as Vec3,
    short: [...control.hands.short] as Vec3,
  };
  const gap = (hand: Vec3) =>
    target === null
      ? null
      : Math.hypot(hand[0] - target[0], hand[1] - target[1], hand[2] - target[2]);
  const tallGap = hands ? gap(hands.tall) : null;
  const shortGap = hands ? gap(hands.short) : null;
  return {
    stage: control.stage,
    view: control.view,
    phase: control.phase,
    ready: control.ready,
    held: control.held,
    mode: control.mode,
    animationTime: control.animationTime,
    settled: { ...control.settled },
    animationStarted: { ...control.animationStarted },
    clothed: control.clothed,
    target,
    hands,
    targetGap: tallGap === null || shortGap === null ? null : { tall: tallGap, short: shortGap },
    bindingFailure: control.bindingFailure,
  };
}

function publishGate(control: Control): void {
  control.gateSnapshot = snapshotOf(control);
  for (const listener of control.gateListeners) listener();
}

/** Samples rendered state inside Canvas and publishes a stable external snapshot for DOM diagnostics. */
function GateProbe({ control }: { control: Control }) {
  const last = useRef(-Infinity);
  useFrame((state) => {
    // The outside diagnostic must never use R3F hooks. Publishing at a readable
    // cadence preserves a cached snapshot between subscriptions and frames.
    if (state.clock.elapsedTime - last.current >= 0.15) {
      last.current = state.clock.elapsedTime;
      publishGate(control);
    }
  });
  return null;
}

function Camera({ control }: { control: Control }) {
  const camera = useThree((s) => s.camera);
  const aspect = useThree((s) => s.size.width / s.size.height);
  const target = useMemo(() => new Vector3(0, 1.05, 0), []);
  useFrame(() => {
    // The figures start six metres apart. Calculate the distance from the
    // actual stage aspect instead of letting a diagnostic layout crop either
    // clothed body in a review view.
    const distance = 11.9 / Math.max(aspect, 1);
    const position: [number, number, number] =
      control.view === "front"
        ? [0, 1.1, distance]
        : control.view === "three-quarter"
          ? [distance * Math.SQRT1_2, 1.2, distance * Math.SQRT1_2]
          : [distance, 1.1, 0];
    camera.position.set(...position);
    camera.lookAt(target);
  });
  return null;
}
function Markers({
  control,
  tallAffordances,
  shortAffordances,
}: {
  control: Control;
  tallAffordances: HumanoidAffordances;
  shortAffordances: HumanoidAffordances;
}) {
  const target = useRef<Group>(null);
  const tallHand = useRef<Group>(null);
  const shortHand = useRef<Group>(null);
  const tallFrame = useMemo(frameOut, []);
  const shortFrame = useMemo(frameOut, []);
  useFrame(() => {
    if (control.bindingFailure) return;
    let a: FrameOut | null;
    let b: FrameOut | null;
    try {
      a = sampleRequiredHandFrame({
        figure: "tall",
        settled: control.settled.tall,
        affordances: tallAffordances,
        out: tallFrame,
      });
      b = sampleRequiredHandFrame({
        figure: "short",
        settled: control.settled.short,
        affordances: shortAffordances,
        out: shortFrame,
      });
    } catch (error) {
      // A settled figure without hand.R is terminal for this source. Keep one
      // explicit failure in the test API instead of throwing every render tick.
      control.bindingFailure = error instanceof Error ? error.message : String(error);
      control.ready = false;
      setHandFrame(tallHand.current, null);
      setHandFrame(shortHand.current, null);
      return;
    }
    if (control.target) target.current?.position.set(...control.target);
    if (target.current) target.current.visible = control.target !== null;
    setHandFrame(tallHand.current, a);
    setHandFrame(shortHand.current, b);
    if (a && b) control.hands = { tall: [...a.position], short: [...b.position] };
  });
  return (
    <>
      <group ref={target}>
        <mesh>
          <sphereGeometry args={[0.035, 16, 12]} />
          <meshBasicMaterial color="#ffd23f" depthTest={false} />
        </mesh>
        <axesHelper args={[0.15]} />
      </group>
      <group ref={tallHand}>
        <axesHelper args={[0.12]} />
      </group>
      <group ref={shortHand}>
        <axesHelper args={[0.12]} />
      </group>
    </>
  );
}

/** The axes use each hand's live tangent, bitangent and normal: not an assumed world orientation. */
function setHandFrame(group: Group | null, frame: FrameOut | null) {
  if (!group) return;
  group.visible = frame !== null;
  if (!frame) return;
  const { position, tangent, bitangent, normal } = frame;
  group.matrixAutoUpdate = false;
  group.matrix.set(
    tangent[0],
    bitangent[0],
    normal[0],
    position[0],
    tangent[1],
    bitangent[1],
    normal[1],
    position[1],
    tangent[2],
    bitangent[2],
    normal[2],
    position[2],
    0,
    0,
    0,
    1,
  );
  group.matrixWorldNeedsUpdate = true;
}

function ClothingProbe({ control }: { control: Control }) {
  const scene = useThree((s) => s.scene);
  useFrame(() => {
    const garments = new Set<string>();
    scene.traverse((object: Object3D) => {
      const garment = object.userData.hkGarment;
      if (typeof garment === "string") garments.add(garment);
    });
    control.clothed = garments.has(TALL_OUTFIT) && garments.has(SHORT_OUTFIT);
  });
  return null;
}

function Controller({
  control,
  registry,
  tallGroup,
  shortGroup,
  runEpoch,
}: {
  control: Control;
  registry: ReturnType<typeof createPresenceRegistry>;
  tallGroup: React.RefObject<Group | null>;
  shortGroup: React.RefObject<Group | null>;
  runEpoch: number;
}) {
  const runtime = useMemo(
    () =>
      createInteractions(registry, {
        seed: 17,
        clipLength: (clip) => (clip === IDLE_CLIP ? IDLE_SECONDS : 0),
      }),
    [registry],
  );
  useEffect(() => {
    runtime.define([HANDSHAKE_REVIEW]);
    // The fixture makes both participants explicitly consent. It must not rely
    // on the runtime's permissive default for an "all" interaction.
    const unconsentTall = runtime.policy("tall", () => true);
    const unconsentShort = runtime.policy("short", () => true);
    return () => {
      unconsentTall();
      unconsentShort();
      runtime.detach();
    };
  }, [runtime]);
  useFrame((_, delta) => {
    if (control.runEpoch !== runEpoch) return;
    if (control.restart) {
      control.interaction?.cancel("cancelled");
      control.interaction = null;
      control.cancelled = false;
      control.target = null;
      control.animationTime = 0;
      resetGroup(tallGroup.current, -3, Math.PI / 2);
      resetGroup(shortGroup.current, 3, -Math.PI / 2);
      control.restart = false;
    }
    if (
      !control.held &&
      !control.interaction &&
      registry.get("tall") &&
      registry.get("short") &&
      !control.cancelled
    )
      control.interaction = runtime.propose(HANDSHAKE_REVIEW.id, {
        initiator: "tall",
        responder: "short",
      });
    const interaction = control.interaction;
    if (interaction && !control.held) {
      control.phase = interaction.phase;
      const clock = interaction.trackTime("initiator");
      if (clock !== null) control.animationTime = clock;
      if (control.stage !== "approach" && interaction.phase === "approach") {
        moveToSlot(tallGroup.current, interaction.slot("initiator"), delta);
        moveToSlot(shortGroup.current, interaction.slot("responder"), delta);
      }
      const target = interaction.contactTarget("grip", "initiator", [0, 0, 0]);
      if (target) control.target = [...target];
      if (control.stage === "cancel" && interaction.phase === "act" && interaction.time >= 0.35) {
        interaction.cancel("cancelled");
        control.interaction = null;
        control.cancelled = true;
        control.target = null;
        control.phase = "cancelled";
        if (control.mode === "inspect") control.held = true;
      } else {
        const selectedPhase =
          control.stage === "approach"
            ? interaction.phase === "approach"
            : control.stage === "grip"
              ? interaction.phase === "act" && interaction.time >= 0.3
              : control.stage === "release"
                ? interaction.phase === "release"
                : false;
        // Stop copying values at the selected real runtime phase. The runtime
        // stays attached so a later selection can begin a fresh run.
        if (control.mode === "inspect" && selectedPhase) {
          control.held = true;
        }
      }
    }
    const phaseReady =
      control.stage === "approach"
        ? control.phase === "approach"
        : control.stage === "grip"
          ? control.phase === "act" && control.held
          : control.stage === "release"
            ? control.phase === "release" && control.held
            : control.cancelled && control.held;
    control.ready =
      phaseReady &&
      control.settled.tall &&
      control.settled.short &&
      control.animationStarted.tall &&
      control.animationStarted.short &&
      control.clothed &&
      (control.stage === "cancel" || control.target !== null) &&
      control.bindingFailure === null;
  });
  return null;
}

function StageFigures({ control }: { control: Control }) {
  const tallGroup = useRef<Group>(null);
  const shortGroup = useRef<Group>(null);
  const registry = useMemo(() => createPresenceRegistry(), []);
  const tallAffordances = useHumanoidAffordances();
  const shortAffordances = useHumanoidAffordances();
  const [library, setLibrary] = useState<Awaited<ReturnType<typeof loadAnimationLibrary>> | null>(
    null,
  );
  const [time, setTime] = useState(0);
  useEffect(() => {
    let live = true;
    void loadAnimationLibrary(animationsPack).then((loaded) => live && setLibrary(loaded));
    return () => {
      live = false;
    };
  }, []);
  useFrame(() =>
    setTime((previous) => (previous === control.animationTime ? previous : control.animationTime)),
  );
  const animation = library
    ? {
        library,
        clip: IDLE_CLIP,
        time,
        paused: true,
      }
    : undefined;
  return (
    <PresenceProvider registry={registry}>
      <StudioStage contactShadowOpacity={0.55} />
      <group ref={tallGroup} position={[-3, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <Humanoid
          recipe={tall}
          presence={{ id: "tall" }}
          affordances={tallAffordances}
          {...(animation && {
            animation: { ...animation, onStart: () => (control.animationStarted.tall = true) },
          })}
          onSettled={() => (control.settled.tall = true)}
        />
      </group>
      <group ref={shortGroup} position={[3, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <Humanoid
          recipe={short}
          presence={{ id: "short" }}
          affordances={shortAffordances}
          {...(animation && {
            animation: { ...animation, onStart: () => (control.animationStarted.short = true) },
          })}
          onSettled={() => (control.settled.short = true)}
        />
      </group>
      <Controller
        control={control}
        registry={registry}
        tallGroup={tallGroup}
        shortGroup={shortGroup}
        runEpoch={control.runEpoch}
      />
      <Markers
        control={control}
        tallAffordances={tallAffordances}
        shortAffordances={shortAffordances}
      />
      <ClothingProbe control={control} />
      <Camera control={control} />
      <GateProbe control={control} />
    </PresenceProvider>
  );
}

function Api({ control }: { control: Control }) {
  useFrame(() => {
    document
      .querySelector("[data-handshake-lab]")
      ?.setAttribute("data-figure", control.ready ? "ready" : "loading");
  });
  useEffect(() => {
    window.hkHandshake = {
      setStage: (stage) => {
        selectStage(control, stage);
      },
      setView: (view) => {
        selectView(control, view);
      },
      inspect: () => selectMode(control, "inspect"),
      play: () => selectMode(control, "play"),
      state: () => ({
        ...snapshotOf(control),
        muted: params.has("muted"),
        adults: tall.macros.age >= 18 && short.macros.age >= 18,
        consent: { tall: true, short: true },
        source: "presence-registry+interaction-runtime+animation-library",
        animation: IDLE_CLIP,
      }),
    };
    return () => {
      delete window.hkHandshake;
    };
  }, [control]);
  return null;
}

/**
 * A visible diagnostic readout for root review. It does not move a hand or
 * decide whether the figures have made contact: the yellow point and two hand
 * frames are live values from the interaction runtime and rendered figures.
 */
function GatePanel({ control }: { control: Control }) {
  const snapshot = useSyncExternalStore(
    (notify) => {
      control.gateListeners.add(notify);
      return () => control.gateListeners.delete(notify);
    },
    () => control.gateSnapshot,
    () => control.gateSnapshot,
  );
  const gap = snapshot.targetGap;
  const fmt = (value: number | null | undefined) =>
    value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)} cm`;
  return (
    <section
      aria-label="Tall and short handshake diagnostic"
      style={{
        padding: 14,
        color: "#f4ecda",
        background: "rgba(20, 23, 29, 0.9)",
        border: "1px solid rgba(255, 210, 63, 0.65)",
        borderRadius: 8,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 12,
        lineHeight: 1.45,
      }}
    >
      <strong style={{ display: "block", color: "#ffd23f", fontSize: 14 }}>
        Tall / short handshake gate
      </strong>
      <p style={{ margin: "6px 0 10px" }}>
        Neutral, clothed adult pair. Both fixture policies explicitly consent. Yellow = runtime grip
        target; RGB = live hand frames.
      </p>
      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 10px", margin: 0 }}>
        <dt>stage</dt>
        <dd>
          {snapshot.stage} / {snapshot.phase}
        </dd>
        <dt>view</dt>
        <dd>{snapshot.view}</dd>
        <dt>inspection</dt>
        <dd>
          {snapshot.held
            ? "held on actual runtime state"
            : snapshot.mode === "play"
              ? "playing"
              : "seeking"}
        </dd>
        <dt>clock</dt>
        <dd>{snapshot.animationTime.toFixed(3)} s</dd>
        <dt>fixture</dt>
        <dd>
          {snapshot.clothed ? "clothed" : "checking clothing"}; settled{" "}
          {String(snapshot.settled.tall)}/{String(snapshot.settled.short)}; clip{" "}
          {String(snapshot.animationStarted.tall)}/{String(snapshot.animationStarted.short)}
        </dd>
        <dt>hand→target</dt>
        <dd>
          tall {fmt(gap?.tall)}, short {fmt(gap?.short)}
        </dd>
        <dt>capture</dt>
        <dd>
          {snapshot.bindingFailure ??
            (snapshot.ready
              ? "ready"
              : snapshot.held
                ? "held; waiting for source readiness"
                : "seeking runtime state")}
        </dd>
      </dl>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
        <button
          type="button"
          onClick={() => selectMode(control, "inspect")}
          style={{
            border: `1px solid ${snapshot.mode === "inspect" ? "#9bc7ff" : "#79808b"}`,
            borderRadius: 4,
            background: snapshot.mode === "inspect" ? "#19334b" : "#252a33",
            color: "#f4ecda",
            cursor: "pointer",
            padding: "4px 7px",
          }}
        >
          Inspect hold
        </button>
        <button
          type="button"
          onClick={() => selectMode(control, "play")}
          style={{
            border: `1px solid ${snapshot.mode === "play" ? "#9bc7ff" : "#79808b"}`,
            borderRadius: 4,
            background: snapshot.mode === "play" ? "#19334b" : "#252a33",
            color: "#f4ecda",
            cursor: "pointer",
            padding: "4px 7px",
          }}
        >
          Play once
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
        {(["approach", "grip", "release", "cancel"] as const).map((stage) => (
          <button
            key={stage}
            type="button"
            onClick={() => selectStage(control, stage)}
            style={{
              border: `1px solid ${snapshot.stage === stage ? "#ffd23f" : "#79808b"}`,
              borderRadius: 4,
              background: snapshot.stage === stage ? "#473c11" : "#252a33",
              color: "#f4ecda",
              cursor: "pointer",
              padding: "4px 7px",
            }}
          >
            {stage}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
        {(["front", "three-quarter", "side"] as const).map((view) => (
          <button
            key={view}
            type="button"
            onClick={() => {
              selectView(control, view);
            }}
            style={{
              border: `1px solid ${snapshot.view === view ? "#9bc7ff" : "#79808b"}`,
              borderRadius: 4,
              background: snapshot.view === view ? "#19334b" : "#252a33",
              color: "#f4ecda",
              cursor: "pointer",
              padding: "4px 7px",
            }}
          >
            {view}
          </button>
        ))}
      </div>
    </section>
  );
}

function useCompactLayout(): boolean {
  return useSyncExternalStore(
    (notify) => {
      window.addEventListener("resize", notify);
      return () => window.removeEventListener("resize", notify);
    },
    () => window.innerWidth < 980,
    () => false,
  );
}

interface HandshakeErrorBoundaryState {
  error: Error | null;
}

/** A lab boot failure must name itself in the review surface instead of leaving a blank screen. */
class HandshakeErrorBoundary extends Component<
  { children: ReactNode },
  HandshakeErrorBoundaryState
> {
  state: HandshakeErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): HandshakeErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error("handshake visual gate failed to mount", error);
  }

  render() {
    if (this.state.error)
      return (
        <section
          role="alert"
          aria-label="Handshake diagnostic failed to mount"
          data-handshake-error
          style={{
            minHeight: "100vh",
            boxSizing: "border-box",
            padding: 32,
            color: "#f4ecda",
            background: "#171b22",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        >
          <h1>Handshake diagnostic failed to mount</h1>
          <p>Reload after correcting the lab error; this review route must never fail silently.</p>
          <pre style={{ whiteSpace: "pre-wrap", color: "#ffb4a7" }}>{this.state.error.message}</pre>
        </section>
      );
    return this.props.children;
  }
}

/** The lab inside its boundary, so a refused route names itself instead of blanking the page. */
export function HandshakeLab() {
  return (
    <HandshakeErrorBoundary>
      <HandshakeReview />
    </HandshakeErrorBoundary>
  );
}

function HandshakeReview() {
  requireReviewRoute();
  const compact = useCompactLayout();
  const control = useMemo<Control>(
    () => ({
      stage: stageFromQuery(),
      view: viewFromQuery(),
      interaction: null,
      restart: false,
      runEpoch: 0,
      restartRun: null,
      mode: "inspect",
      held: false,
      animationTime: 0,
      cancelled: false,
      settled: { tall: false, short: false },
      animationStarted: { tall: false, short: false },
      clothed: false,
      target: null,
      hands: null,
      bindingFailure: null,
      phase: "loading",
      ready: false,
      gateSnapshot: INITIAL_GATE_SNAPSHOT,
      gateListeners: new Set(),
    }),
    [],
  );
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        gridTemplateColumns: compact ? "minmax(0, 1fr)" : "minmax(0, 1fr) 332px",
        gridTemplateRows: compact ? "minmax(0, 1fr) auto" : "minmax(0, 1fr)",
        background: "#171b22",
      }}
      data-handshake-lab
      data-figure={control.ready ? "ready" : "loading"}
    >
      <div style={{ minWidth: 0, minHeight: 0, position: "relative" }}>
        <Canvas
          camera={{ position: [0, 1.1, 8.5], fov: 35 }}
          gl={{
            preserveDrawingBuffer: true,
            toneMapping: STUDIO_TONE_MAPPING,
            toneMappingExposure: STUDIO_EXPOSURE,
          }}
        >
          <StageFigures control={control} />
          <Api control={control} />
        </Canvas>
      </div>
      <aside
        aria-label="Handshake review controls"
        style={{
          minWidth: 0,
          overflowY: "auto",
          borderLeft: compact ? undefined : "1px solid rgba(255, 210, 63, 0.35)",
          borderTop: compact ? "1px solid rgba(255, 210, 63, 0.35)" : undefined,
          background: "rgba(20, 23, 29, 0.98)",
        }}
      >
        <GatePanel control={control} />
      </aside>
    </div>
  );
}
