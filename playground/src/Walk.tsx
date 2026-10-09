import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  createPresenceRegistry,
  createRecipe,
  groundOcclusion,
  type PublishedPresence,
  sampleGroundOcclusion,
} from "humanoid-kit";
import {
  Humanoid,
  PresenceProvider,
  STUDIO_EXPOSURE,
  STUDIO_TONE_MAPPING,
  StudioStage,
} from "humanoid-kit/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Group, Vector3 } from "three";

/**
 * QA scene (`?scene=walk`): two figures walk toward the camera side by side and
 * part, to see the presence-driven studio shadow pool and separate. `?bg=rrggbb`
 * sets the background, so a shadow reads against a light ground.
 *
 * `window.hkWalk` lets a test steer it and read it back: the gap between the
 * figures, whether they are walking, whether the second figure is there, what
 * the registry holds, and where a ground point lands on the canvas.
 */
export interface WalkApi {
  /** Eases the lateral distance between the two figures to this many metres. */
  setGap(metres: number): void;
  setWalking(on: boolean): void;
  /** Where the figures stand along the walk, so a still frame is the same every time. */
  setZ(z: number): void;
  /** One figure or two. */
  setCount(count: 1 | 2): void;
  /** Gives the second figure the first one's recipe, so their feet are alike. */
  setTwins(twins: boolean): void;
  /** Poses the first figure with a whole-body pose from the pack (`benchmark`, `tpose`), or back to rest with null. */
  setPose(body: string | null): void;
  state(): {
    gap: number;
    targetGap: number;
    z: number;
    walking: boolean;
    count: 1 | 2;
    twins: boolean;
  };
  /** The registry's figures: id, ground position, velocity and footprint. */
  figures(): {
    id: string;
    position: number[];
    velocity: number[];
    feet: number[][];
    radius: number;
    /** Height of the head anchor, and of the lowest point of the bounds. */
    head: number;
    /** Height of the left hand anchor. */
    hand: number;
    floor: number;
  }[];
  /** What the presence model says the shadow is at ground point (x, z): `sampleGroundOcclusion` over the registry. */
  expectedShadow(x: number, z: number): number;
  /** Canvas pixel of the ground point (x, 0, z). */
  groundPixel(x: number, z: number): [number, number];
}

declare global {
  interface Window {
    hkWalk?: WalkApi;
  }
}

const params = new URLSearchParams(window.location.search);
/** Metres per second toward the camera, and where the walk wraps. */
const SPEED = 0.9;
const Z_RANGE: [number, number] = [-1.2, 0.6];
/** Darkness of the contact shadow at its centre; the test reads back the same number. */
const SHADOW_OPACITY = 0.6;
/** How fast the gap eases, metres per second. */
const GAP_RATE = 1.5;

const alex = createRecipe({ macros: { gender: 0.2, height: 0.55 }, skin: { melanin: 0.25 } });
const sam = createRecipe({ macros: { gender: 0.8, height: 0.8 }, skin: { melanin: 0.8 } });

interface Control {
  gap: number;
  targetGap: number;
  z: number;
  walking: boolean;
  count: 1 | 2;
  twins: boolean;
}

/** Who is on stage; changing it re-renders, unlike the rest of `Control`, which the frame loop reads. */
interface Roster {
  count: 1 | 2;
  twins: boolean;
  /** The first figure's whole-body pose, or null at rest. */
  pose: string | null;
}

function Pair({ control, roster }: { control: Control; roster: Roster }) {
  const a = useRef<Group>(null);
  const b = useRef<Group>(null);
  const pose = useMemo(() => (roster.pose ? { body: roster.pose } : undefined), [roster.pose]);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const step = GAP_RATE * dt;
    control.gap += Math.max(-step, Math.min(step, control.targetGap - control.gap));
    if (control.walking) {
      control.z += SPEED * dt;
      if (control.z > Z_RANGE[1]) control.z = Z_RANGE[0];
    }
    a.current?.position.set(-control.gap / 2, 0, control.z);
    b.current?.position.set(control.gap / 2, 0, control.z);
  });
  return (
    <>
      <group ref={a}>
        <Humanoid recipe={alex} {...(pose && { pose })} presence={{ id: "alex" }} />
      </group>
      {roster.count === 2 && (
        <group ref={b}>
          <Humanoid recipe={roster.twins ? alex : sam} presence={{ id: "sam" }} />
        </group>
      )}
    </>
  );
}

function Api({
  control,
  registry,
  onRoster,
  onReady,
}: {
  control: Control;
  registry: ReturnType<typeof createPresenceRegistry>;
  onRoster: (change: Partial<Roster>) => void;
  onReady: (ready: boolean) => void;
}) {
  const camera = useThree((s) => s.camera);
  const canvas = useThree((s) => s.gl.domElement);
  // Ready when every figure that should be here has published.
  const wasReady = useRef(false);
  useFrame(() => {
    const ready = registry.all().length === control.count;
    if (ready !== wasReady.current) {
      wasReady.current = ready;
      onReady(ready);
    }
  });
  useEffect(() => {
    camera.lookAt(0, 0.9, 0);
    const v = new Vector3();
    window.hkWalk = {
      setGap: (m) => {
        control.targetGap = m;
      },
      setWalking: (on) => {
        control.walking = on;
      },
      setZ: (z) => {
        control.z = z;
      },
      setCount: (count) => {
        control.count = count;
        onRoster({ count });
      },
      setTwins: (twins) => {
        control.twins = twins;
        onRoster({ twins });
      },
      setPose: (pose) => onRoster({ pose }),
      state: () => ({ ...control }),
      figures: () =>
        registry.all().map((p: PublishedPresence) => ({
          id: p.id,
          position: p.position,
          velocity: p.velocity,
          feet: p.footprint.points,
          radius: p.footprint.radius,
          head: p.anchors.head[1],
          hand: p.anchors.leftHand[1],
          floor: p.bounds.min[1],
        })),
      expectedShadow: (x, z) =>
        sampleGroundOcclusion(
          groundOcclusion(registry.all(), { strength: SHADOW_OPACITY, floorY: 0 }),
          x,
          z,
        ),
      groundPixel: (x, z) => {
        v.set(x, 0, z).project(camera);
        return [(v.x * 0.5 + 0.5) * canvas.width, (-v.y * 0.5 + 0.5) * canvas.height];
      },
    };
    return () => {
      delete window.hkWalk;
    };
  }, [camera, canvas, control, registry, onRoster]);
  return null;
}

export function Walk() {
  const registry = useMemo(() => createPresenceRegistry(), []);
  const control = useMemo<Control>(
    () => ({ gap: 1.8, targetGap: 1.8, z: 0, walking: true, count: 2, twins: false }),
    [],
  );
  const [roster, setRoster] = useState<Roster>({ count: 2, twins: false, pose: null });
  const onRoster = useCallback(
    (change: Partial<Roster>) => setRoster((r) => ({ ...r, ...change })),
    [],
  );
  const [ready, setReady] = useState(false);
  const bg = params.get("bg");
  const background = bg && /^[0-9a-f]{6}$/i.test(bg) ? `#${bg}` : undefined;
  return (
    <div style={{ position: "absolute", inset: 0 }} data-figure={ready ? "ready" : "loading"}>
      <Canvas
        camera={{ position: [0, 1.4, 5.5], fov: 35 }}
        gl={{
          preserveDrawingBuffer: true,
          toneMapping: STUDIO_TONE_MAPPING,
          toneMappingExposure: STUDIO_EXPOSURE,
        }}
      >
        <PresenceProvider registry={registry}>
          <StudioStage contactShadowOpacity={SHADOW_OPACITY} {...(background && { background })} />
          <Pair control={control} roster={roster} />
          <Api control={control} registry={registry} onRoster={onRoster} onReady={setReady} />
        </PresenceProvider>
      </Canvas>
    </div>
  );
}
