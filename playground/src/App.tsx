import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  type AnimationLibrary,
  createRecipe,
  type EyeLibrary,
  HumanoidWorkerClient,
  loadAnimationLibrary,
  loadEyeLibrary,
  type Recipe,
} from "humanoid-kit";
import { HumanoidCreator } from "humanoid-kit/editor";
import {
  Humanoid,
  type HumanoidPose,
  HumanoidProvider,
  STUDIO_EXPOSURE,
  STUDIO_TONE_MAPPING,
  StudioStage,
} from "humanoid-kit/react";
import { animationsPack } from "humanoid-kit-animations";
import { bodyPack } from "humanoid-kit-body";
import { eyesPack } from "humanoid-kit-eyes";
import { hairPack } from "humanoid-kit-hair";
import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  type Bone,
  type DirectionalLight,
  type Mesh,
  NeutralToneMapping,
  type Object3D,
  type ToneMapping,
  Vector3,
} from "three";
import { tattooImages } from "./tattooImages";
import { Walk } from "./Walk";

async function createClient(): Promise<HumanoidWorkerClient> {
  // `?adult` loads the adult anatomy pack for local testing only: the condition
  // is false in a production build, so the import is dropped and the public demo
  // never carries the pack (`pnpm check:pages` proves it).
  const adultAnatomy =
    import.meta.env.DEV && params.has("adult")
      ? (await import("humanoid-kit-adult-anatomy")).adultAnatomyPack
      : undefined;
  // `?clothing` loads the clothing pack, so a recipe's `outfit` can name its
  // garments. Imported on demand: a visit without it fetches none of the pack.
  const clothing = params.has("clothing")
    ? (await import("humanoid-kit-clothing")).clothingPack
    : undefined;
  const worker = new Worker(new URL("../../src/worker/index.ts", import.meta.url), {
    type: "module",
  });
  // `?wear=teeth/base,eyes/high-poly` wears only those attachments: a set the
  // pack did not bake, whose occlusion is baked at rest at load and posed after.
  const wear = params.get("wear")?.split(",").filter(Boolean);
  // The first figure's own targets load first; the rest stream in behind it.
  return new HumanoidWorkerClient(
    {
      body: bodyPack,
      // Only the hair manifest loads up front; a style's files load when a figure wears it.
      hair: hairPack,
      ...(adultAnatomy && { adultAnatomy }),
      ...(clothing && { clothing }),
      firstFigureAge: initialRecipe().macros.age,
    },
    { subdivision: 1, ...(wear && { attachments: wear }) },
    worker,
  );
}

/** One worker per mounted app; created in an effect so StrictMode's double render cannot leak a second worker. */
function useClient(): HumanoidWorkerClient | null {
  const [client, setClient] = useState<HumanoidWorkerClient | null>(null);
  useEffect(() => {
    let live = true;
    let made: HumanoidWorkerClient | null = null;
    void createClient().then((c) => {
      if (!live) {
        c.dispose();
        return;
      }
      made = c;
      setClient(c);
    });
    return () => {
      live = false;
      made?.dispose();
    };
  }, []);
  return client;
}

/** What the figure is drawing: one entry per skinned part, for QA to count. */
export interface DrawnPart {
  /** `"body"`, `"garment"` or an attachment's index. */
  part: string | number;
  garment?: string;
  /** Triangles in the part's index buffer, i.e. what it draws. */
  triangles: number;
}

/** Exposes `window.hkDrawn` while mounted: the triangles each part of the figure draws. */
function SceneProbe() {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    window.hkDrawn = () => {
      const out: DrawnPart[] = [];
      scene.traverse((o) => {
        const part = o.userData.hkPart as string | number | undefined;
        const geometry = (o as Mesh).geometry;
        if (part === undefined || !geometry) return;
        const garment = o.userData.hkGarment as string | undefined;
        out.push({
          part,
          ...(garment && { garment }),
          triangles: (geometry.index?.count ?? 0) / 3,
        });
      });
      return out;
    };
    // Where a bone's head is in the world, and where the figure's group stands: for the animation spec.
    window.hkBone = (name) => {
      let found: Object3D | null = null;
      scene.traverse((o) => {
        if (!found && o.name === name && (o as Bone).isBone) found = o;
      });
      if (!found) return null;
      (found as Object3D).updateWorldMatrix(true, false);
      const v = new Vector3().setFromMatrixPosition((found as Object3D).matrixWorld);
      return [v.x, v.y, v.z];
    };
    window.hkFigure = () => {
      let found: Object3D | null = null;
      scene.traverse((o) => {
        if (!found && o.userData.groundOffset !== undefined) found = o;
      });
      if (!found) return null;
      (found as Object3D).updateWorldMatrix(true, false);
      const v = new Vector3().setFromMatrixPosition((found as Object3D).matrixWorld);
      return { position: [v.x, v.y, v.z], groundOffset: (found as Object3D).userData.groundOffset };
    };
    return () => {
      delete window.hkDrawn;
      delete window.hkBone;
      delete window.hkFigure;
    };
  }, [scene]);
  return null;
}

declare global {
  interface Window {
    /** QA only: what each part of the figure is drawing (see `SceneProbe`). */
    hkDrawn?: () => DrawnPart[];
    /** QA only: a bone's head in world space (see `SceneProbe`). */
    hkBone?: (name: string) => [number, number, number] | null;
    /** QA only: where the figure's group stands, and the lift it was given. */
    hkFigure?: () => { position: [number, number, number]; groundOffset: number } | null;
    /** QA only: swaps the shot's recipe (and pose) without reloading (see `Shot`). */
    hkSetRecipe?: (
      init: Parameters<typeof createRecipe>[0],
      pose?: ShotPose,
      signals?: Record<string, number>,
    ) => void;
  }
}

const params = new URLSearchParams(window.location.search);

/** `?recipe=<json>` seeds the figure (e2e permutations, sharing a figure). */
function initialRecipe(): Recipe {
  const raw = params.get("recipe");
  return createRecipe(raw ? (JSON.parse(raw) as Parameters<typeof createRecipe>[0]) : {});
}

/** `?signals=cold:1,exertion:0.5` sets the skin's state. */
function initialSignals(): Record<string, number> {
  const raw = params.get("signals");
  if (!raw) return {};
  return Object.fromEntries(
    raw.split(",").map((pair) => {
      const [name = "", value = "1"] = pair.split(":");
      return [name, Number(value)];
    }),
  );
}

/** A shot's pose: the figure's, and optionally a clip playing on it (`?anim=walk_normal&t=0.4`). */
type ShotPose = HumanoidPose & {
  animation?: {
    clip: string;
    time?: number;
    paused?: boolean;
    rootMotion?: boolean;
    speed?: number;
  };
};

/**
 * `?face=JawDrop:1,LipsKiss:0.5` poses the shot's face; `?anim=<clip>` plays a clip of the
 * animation pack (held at `&t=<seconds>` when given, as a still; `&root=0` keeps a walk on the
 * spot).
 */
function initialPose(): ShotPose {
  const raw = params.get("face");
  const body = params.get("pose");
  const anim = params.get("anim");
  const time = params.get("t");
  return {
    ...(body && { body }),
    ...(anim && {
      animation: {
        clip: anim,
        ...(time !== null && { time: Number(time), paused: true }),
        ...(params.get("root") === "0" && { rootMotion: false }),
      },
    }),
    ...(raw && {
      faceUnits: Object.fromEntries(
        raw.split(",").map((pair) => {
          const [name = "", weight = "1"] = pair.split(":");
          return [name, Number(weight)];
        }),
      ),
    }),
  };
}

export function App() {
  const client = useClient();
  if (!client) return null;
  return (
    <HumanoidProvider client={client}>
      {params.get("scene") === "walk" ? (
        <Walk />
      ) : params.has("view") || params.has("cam") ? (
        <Shot />
      ) : (
        <HumanoidCreator title="humanoid-kit" initialRecipe={initialRecipe()} />
      )}
    </HumanoidProvider>
  );
}

/** Tone mappers QA can compare with `?tm=` (the stage's own is the default). */
const TONE_MAPPERS: Record<string, ToneMapping> = {
  agx: AgXToneMapping,
  neutral: NeutralToneMapping,
  aces: ACESFilmicToneMapping,
};

/**
 * `?frame=<bone>&view=dx,dy,dz&span=<metres>`: aims the camera at a bone's
 * posed world position (the skeleton's names, such as `foot.R`, `toe1-1.L`,
 * `upperarm01.L`, `head`), from the direction `view` points to (from the bone
 * toward the camera), at the distance that fits `span` metres across the frame.
 * It follows the bone every frame, so a pose or a recipe swapped in is framed
 * as it settles. `?light=camera` adds a light at the camera, so a view of the
 * underside, or of anything the studio's key light does not reach, is lit
 * head-on; `?light=under` adds one from below.
 */
function AutoFrame({
  bone,
  view,
  span,
  offset,
}: {
  bone: string;
  view: [number, number, number];
  span: number;
  offset: [number, number, number];
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as { target: Vector3; update(): void } | null;
  const scene = useThree((s) => s.scene);
  const at = useRef(new Vector3());
  useFrame(() => {
    const b = scene.getObjectByName(bone);
    if (!b) return;
    b.getWorldPosition(at.current);
    at.current.add(new Vector3(...offset));
    const fov = ((camera as { fov?: number }).fov ?? 35) * (Math.PI / 180);
    const distance = span / 2 / Math.tan(fov / 2);
    const dir = new Vector3(...view).normalize();
    camera.position.copy(at.current).addScaledVector(dir, distance);
    controls?.target.copy(at.current);
    controls?.update();
    camera.lookAt(at.current);
  });
  return null;
}

/** `?light=camera`: a light that follows the camera, and `?light=under`: one from below. */
function QaLight({ kind }: { kind: "camera" | "under" }) {
  const camera = useThree((s) => s.camera);
  const light = useRef<DirectionalLight>(null);
  useFrame(() => {
    if (kind === "camera" && light.current) light.current.position.copy(camera.position);
  });
  return (
    <directionalLight
      ref={light}
      position={kind === "under" ? [0, -3, 1] : [0, 1, 3]}
      intensity={kind === "under" ? 2.5 : 3}
    />
  );
}

/**
 * A fixed-camera render for visual QA: `?view=front|side|back|face`, or
 * `?cam=x,y,z,tx,ty,tz[&span=<m>]` to place the camera exactly (with `span`, the field of view fits that many metres across at the target), or `?frame=<bone>&view=dx,dy,dz&span=<m>[&at=dx,dy,dz]`
 * to frame a bone by name (`AutoFrame`, `at` a world offset in metres from the bone's head), with `?light=camera|under` to light what the studio
 * does not reach; `?tm=agx|neutral|aces`
 * and `?exp=<number>` override tone mapping and exposure for comparisons;
 * `?bg=rrggbb` sets a background key colour; `?face=JawDrop:1,LipsKiss:0.5`
 * poses the face with MakeHuman's face units.
 */
function Shot() {
  const toneMapping = TONE_MAPPERS[params.get("tm") ?? ""] ?? STUDIO_TONE_MAPPING;
  const exposure = Number(params.get("exp") ?? Number.NaN);
  // `?bg=rrggbb`: a key colour no figure uses, so tests can mask the background exactly.
  const bg = params.get("bg");
  const background = bg && /^[0-9a-f]{6}$/i.test(bg) ? `#${bg}` : null;
  const [recipe, setRecipe] = useState(initialRecipe);
  const [pose, setPose] = useState<ShotPose>(initialPose);
  const { animation, ...bodyPose } = pose;
  // The animation pack's library, fetched once and only for a shot that plays a clip.
  const [library, setLibrary] = useState<AnimationLibrary | null>(null);
  const wantsAnimation = animation !== undefined;
  useEffect(() => {
    if (!wantsAnimation || library) return;
    let live = true;
    void loadAnimationLibrary(animationsPack).then((l) => live && setLibrary(l));
    return () => {
      live = false;
    };
  }, [wantsAnimation, library]);
  // The eye pack's library, fetched once and only for a shot whose recipe names an eye material.
  const [eyeLibrary, setEyeLibrary] = useState<EyeLibrary | null>(null);
  const wantsEyes = recipe.eyes.material !== undefined;
  useEffect(() => {
    if (!wantsEyes || eyeLibrary) return;
    let live = true;
    void loadEyeLibrary(eyesPack).then((l) => live && setEyeLibrary(l));
    return () => {
      live = false;
    };
  }, [wantsEyes, eyeLibrary]);
  const [playing, setPlaying] = useState<string | null>(null);
  const [signals, setSignals] = useState<Record<string, number>>(initialSignals);
  const [lift, setLift] = useState(0);
  // Tests wait for data-figure="ready": the figure is evaluated and placed, and
  // everything its recipe wears (hair style, textures, garments, posed occlusion)
  // is loaded and drawn (`Humanoid`'s `onSettled`, not `onEvaluated`).
  // data-generation counts recipes swapped in through window.hkSetRecipe, so a
  // test can render many figures from one page load.
  const [settled, setSettled] = useState(false);
  // A shot that plays a clip is ready once the figure follows it.
  const ready =
    settled &&
    (animation === undefined || playing === animation.clip) &&
    (!wantsEyes || eyeLibrary !== null);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    window.hkSetRecipe = (init, next, nextSignals) => {
      setSignals(nextSignals ?? initialSignals());
      setSettled(false);
      setPlaying(null);
      setRecipe(createRecipe(init));
      setPose(next ?? initialPose());
      setGeneration((g) => g + 1);
    };
    return () => {
      delete window.hkSetRecipe;
    };
  }, []);
  const view = params.get("view") ?? "front";
  const cam = params.get("cam")?.split(",").map(Number);
  const exact = cam?.length === 6 && cam.every(Number.isFinite);
  const frame = params.get("frame");
  const frameView = (params.get("view")?.split(",").map(Number) ?? [0, 0, 1]) as number[];
  const frameSpan = Number(params.get("span") ?? 0.5);
  const at = params.get("at")?.split(",").map(Number);
  const frameOffset: [number, number, number] =
    at?.length === 3 && at.every(Number.isFinite) ? (at as [number, number, number]) : [0, 0, 0];
  const qaLight = params.get("light");
  const preset: Record<
    string,
    { position: [number, number, number]; target: [number, number, number] }
  > = {
    front: { position: [0, 0.95, 3.2], target: [0, 0.88, 0] },
    side: { position: [3.2, 0.95, 0], target: [0, 0.88, 0] },
    back: { position: [0, 0.95, -3.2], target: [0, 0.88, 0] },
    face: { position: [0, 1.55, 0.9], target: [0, 1.55, 0] },
  };
  const { position, target } = exact
    ? {
        position: cam.slice(0, 3) as [number, number, number],
        target: cam.slice(3) as [number, number, number],
      }
    : ((preset[view] ?? preset.front) as (typeof preset)[string]);
  // `?cam=…&span=<m>`: an exact camera keeps its position and narrows (or widens)
  // its field of view until `span` metres across fit the frame at the target, so a
  // close crop can be shot from a set distance without perspective changing.
  const camSpan = Number(params.get("span"));
  const reach = Math.hypot(
    position[0] - target[0],
    position[1] - target[1],
    position[2] - target[2],
  );
  const fov =
    exact && Number.isFinite(camSpan) && camSpan > 0 && reach > 0
      ? 2 * Math.atan(camSpan / 2 / reach) * (180 / Math.PI)
      : 35;
  return (
    <div
      style={{ position: "absolute", inset: 0 }}
      data-figure={ready ? "ready" : "loading"}
      data-generation={generation}
    >
      <Canvas
        shadows={params.has("noshadow") ? false : "percentage"}
        camera={{ position, fov }}
        gl={{
          preserveDrawingBuffer: true,
          toneMapping,
          toneMappingExposure: Number.isFinite(exposure) ? exposure : STUDIO_EXPOSURE,
        }}
      >
        <StudioStage {...(background ? { background } : {})} />
        <SceneProbe />
        {frame && frameView.length === 3 && frameView.every(Number.isFinite) && (
          <AutoFrame
            bone={frame}
            view={frameView as [number, number, number]}
            span={Number.isFinite(frameSpan) && frameSpan > 0 ? frameSpan : 0.5}
            offset={frameOffset}
          />
        )}
        {(qaLight === "camera" || qaLight === "under") && <QaLight kind={qaLight} />}
        <Humanoid
          recipe={recipe}
          pose={bodyPose}
          {...(library &&
            animation && {
              animation: { library, ...animation, onStart: setPlaying },
            })}
          {...(eyeLibrary && { eyeMaterials: eyeLibrary })}
          signals={signals}
          position={[0, animation ? 0 : lift, 0]}
          onGroundOffset={setLift}
          onSettled={() => setSettled(true)}
          bodyArtImages={tattooImages()}
        />
        <OrbitControls makeDefault target={target} />
      </Canvas>
    </div>
  );
}

export default App;
