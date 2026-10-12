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
import { useEffect, useMemo, useRef, useState } from "react";
import { type Group, MathUtils, type Object3D, Vector3 } from "three";
import { sampleRequiredHandFrame } from "./handFrame";

type Stage = "approach" | "grip" | "release" | "cancel";
type View = "front" | "three-quarter" | "side";

const params = new URLSearchParams(window.location.search);
const IDLE_CLIP = "idle1";
const IDLE_SECONDS = 2.5;
const TALL_OUTFIT = "suits/male_casualsuit06";
const SHORT_OUTFIT = "suits/female_casualsuit01";

// This lab refuses to mount unless its test route is silent and the clothing pack
// is requested. It is intentionally a review source, not a general playground scene.
if (!params.has("muted")) throw new Error("handshake lab requires the silent ?muted route");
if (!params.has("clothing")) throw new Error("handshake lab requires ?clothing for both figures");

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

if (tall.macros.age < 18 || short.macros.age < 18)
  throw new Error("handshake lab requires adult figures");
if (!tall.outfit?.includes(TALL_OUTFIT) || !short.outfit?.includes(SHORT_OUTFIT))
  throw new Error("handshake lab requires both figures to stay clothed");

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
  cancelled: boolean;
  settled: { tall: boolean; short: boolean };
  animationStarted: { tall: boolean; short: boolean };
  clothed: boolean;
  target: Vec3 | null;
  hands: { tall: Vec3; short: Vec3 } | null;
  bindingFailure: string | null;
  phase: string;
  ready: boolean;
}

interface GateSnapshot {
  readonly stage: Stage;
  readonly view: View;
  readonly phase: string;
  readonly ready: boolean;
  readonly clothed: boolean;
  readonly target: Vec3 | null;
  readonly hands: { readonly tall: Vec3; readonly short: Vec3 } | null;
  readonly targetGap: { readonly tall: number; readonly short: number } | null;
  readonly bindingFailure: string | null;
}

export interface HandshakeLabApi {
  setStage(stage: Stage): void;
  setView(view: View): void;
  state(): {
    stage: Stage;
    view: View;
    phase: string;
    ready: boolean;
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

/** A lab-only state change. The interaction runtime remains the source of phase state. */
function selectStage(control: Control, stage: Stage): void {
  control.stage = stage;
  control.restart = true;
  control.ready = false;
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
    clothed: control.clothed,
    target,
    hands,
    targetGap: tallGap === null || shortGap === null ? null : { tall: tallGap, short: shortGap },
    bindingFailure: control.bindingFailure,
  };
}

function Camera({ control }: { control: Control }) {
  const camera = useThree((s) => s.camera);
  const target = useMemo(() => new Vector3(0, 1.05, 0), []);
  useFrame(() => {
    const position: [number, number, number] =
      control.view === "front"
        ? [0, 1.1, 4.9]
        : control.view === "three-quarter"
          ? [3.6, 1.2, 3.6]
          : [4.9, 1.1, 0];
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
}: {
  control: Control;
  registry: ReturnType<typeof createPresenceRegistry>;
  tallGroup: React.RefObject<Group | null>;
  shortGroup: React.RefObject<Group | null>;
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
    if (control.restart) {
      control.interaction?.cancel("cancelled");
      control.interaction = null;
      control.cancelled = false;
      control.target = null;
      resetGroup(tallGroup.current, -3, Math.PI / 2);
      resetGroup(shortGroup.current, 3, -Math.PI / 2);
      control.restart = false;
    }
    if (!control.interaction && registry.get("tall") && registry.get("short") && !control.cancelled)
      control.interaction = runtime.propose(HANDSHAKE_REVIEW.id, {
        initiator: "tall",
        responder: "short",
      });
    const interaction = control.interaction;
    if (interaction) {
      control.phase = interaction.phase;
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
        control.phase = "cancelled";
      }
    }
    const phaseReady =
      control.stage === "approach"
        ? control.phase === "approach"
        : control.stage === "grip"
          ? interaction?.phase === "act" && interaction.time >= 0.3
          : control.stage === "release"
            ? interaction?.phase === "release"
            : control.cancelled;
    control.ready =
      phaseReady === true &&
      control.settled.tall &&
      control.settled.short &&
      control.animationStarted.tall &&
      control.animationStarted.short &&
      control.clothed &&
      control.target !== null &&
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
  useFrame((state) => setTime(Math.floor(state.clock.elapsedTime * 30) / 30));
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
      />
      <Markers
        control={control}
        tallAffordances={tallAffordances}
        shortAffordances={shortAffordances}
      />
      <ClothingProbe control={control} />
      <Camera control={control} />
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
        control.view = view;
      },
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
  const [snapshot, setSnapshot] = useState<GateSnapshot>(() => snapshotOf(control));
  const last = useRef(-Infinity);
  useFrame((state) => {
    // A small UI refresh rate keeps this diagnostic readable without putting
    // the interaction's continuous values into React state every render frame.
    if (state.clock.elapsedTime - last.current >= 0.15) {
      last.current = state.clock.elapsedTime;
      setSnapshot(snapshotOf(control));
    }
  });
  const gap = snapshot.targetGap;
  const fmt = (value: number | null | undefined) =>
    value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)} cm`;
  return (
    <section
      aria-label="Tall and short handshake diagnostic"
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        width: 300,
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
        <dt>fixture</dt>
        <dd>{snapshot.clothed ? "clothed" : "checking clothing"}</dd>
        <dt>hand→target</dt>
        <dd>
          tall {fmt(gap?.tall)}, short {fmt(gap?.short)}
        </dd>
        <dt>binding</dt>
        <dd>{snapshot.bindingFailure ?? (snapshot.ready ? "ready" : "settling")}</dd>
      </dl>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
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
              control.view = view;
              setSnapshot(snapshotOf(control));
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

export function HandshakeLab() {
  const control = useMemo<Control>(
    () => ({
      stage: "approach",
      view: "front",
      interaction: null,
      restart: false,
      cancelled: false,
      settled: { tall: false, short: false },
      animationStarted: { tall: false, short: false },
      clothed: false,
      target: null,
      hands: null,
      bindingFailure: null,
      phase: "loading",
      ready: false,
    }),
    [],
  );
  return (
    <div
      style={{ position: "absolute", inset: 0 }}
      data-handshake-lab
      data-figure={control.ready ? "ready" : "loading"}
    >
      <Canvas
        camera={{ position: [0, 1.1, 4.9], fov: 35 }}
        gl={{
          preserveDrawingBuffer: true,
          toneMapping: STUDIO_TONE_MAPPING,
          toneMappingExposure: STUDIO_EXPOSURE,
        }}
      >
        <StageFigures control={control} />
        <Api control={control} />
      </Canvas>
      <GatePanel control={control} />
    </div>
  );
}
