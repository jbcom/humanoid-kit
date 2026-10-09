import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { createRecipe, HumanoidWorkerClient, type Recipe } from "humanoid-kit";
import { HumanoidCreator } from "humanoid-kit/editor";
import {
  Humanoid,
  type HumanoidPose,
  HumanoidProvider,
  STUDIO_EXPOSURE,
  STUDIO_TONE_MAPPING,
  StudioStage,
} from "humanoid-kit/react";
import { bodyPack } from "humanoid-kit-body";
import { hairPack } from "humanoid-kit-hair";
import { useEffect, useState } from "react";
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  type Mesh,
  NeutralToneMapping,
  type ToneMapping,
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
    return () => {
      delete window.hkDrawn;
    };
  }, [scene]);
  return null;
}

declare global {
  interface Window {
    /** QA only: what each part of the figure is drawing (see `SceneProbe`). */
    hkDrawn?: () => DrawnPart[];
    /** QA only: swaps the shot's recipe (and pose) without reloading (see `Shot`). */
    hkSetRecipe?: (
      init: Parameters<typeof createRecipe>[0],
      pose?: HumanoidPose,
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

/** `?face=JawDrop:1,LipsKiss:0.5` poses the shot's face. */
function initialPose(): HumanoidPose {
  const raw = params.get("face");
  const body = params.get("pose");
  return {
    ...(body && { body }),
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
 * A fixed-camera render for visual QA: `?view=front|side|back|face`, or
 * `?cam=x,y,z,tx,ty,tz` to place the camera exactly; `?tm=agx|neutral|aces`
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
  const [pose, setPose] = useState<HumanoidPose>(initialPose);
  const [signals, setSignals] = useState<Record<string, number>>(initialSignals);
  const [lift, setLift] = useState(0);
  // Tests wait for data-figure="ready": the figure is evaluated and placed, and
  // everything its recipe wears (hair style, textures, garments, posed occlusion)
  // is loaded and drawn (`Humanoid`'s `onSettled`, not `onEvaluated`).
  // data-generation counts recipes swapped in through window.hkSetRecipe, so a
  // test can render many figures from one page load.
  const [ready, setReady] = useState(false);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    window.hkSetRecipe = (init, next, nextSignals) => {
      setSignals(nextSignals ?? initialSignals());
      setReady(false);
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
  return (
    <div
      style={{ position: "absolute", inset: 0 }}
      data-figure={ready ? "ready" : "loading"}
      data-generation={generation}
    >
      <Canvas
        shadows="percentage"
        camera={{ position, fov: 35 }}
        gl={{
          preserveDrawingBuffer: true,
          toneMapping,
          toneMappingExposure: Number.isFinite(exposure) ? exposure : STUDIO_EXPOSURE,
        }}
      >
        <StudioStage {...(background ? { background } : {})} />
        <SceneProbe />
        <Humanoid
          recipe={recipe}
          pose={pose}
          signals={signals}
          position={[0, lift, 0]}
          onGroundOffset={setLift}
          onSettled={() => setReady(true)}
          bodyArtImages={tattooImages()}
        />
        <OrbitControls makeDefault target={target} />
      </Canvas>
    </div>
  );
}

export default App;
