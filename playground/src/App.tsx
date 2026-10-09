import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { createRecipe, HumanoidWorkerClient, type Recipe } from "humanoid-kit";
import { HumanoidCreator } from "humanoid-kit/editor";
import {
  Humanoid,
  HumanoidProvider,
  STUDIO_EXPOSURE,
  STUDIO_TONE_MAPPING,
  StudioStage,
} from "humanoid-kit/react";
import { bodyPack } from "humanoid-kit-body";
import { useEffect, useState } from "react";
import { ACESFilmicToneMapping, AgXToneMapping, NeutralToneMapping, type ToneMapping } from "three";
import { Walk } from "./Walk";

async function createClient(): Promise<HumanoidWorkerClient> {
  // `?adult` loads the adult anatomy pack for local testing only: the condition
  // is false in a production build, so the import is dropped and the public demo
  // never carries the pack (`pnpm check:pages` proves it).
  const adultAnatomy =
    import.meta.env.DEV && params.has("adult")
      ? (await import("humanoid-kit-adult-anatomy")).adultAnatomyPack
      : undefined;
  const worker = new Worker(new URL("../../src/worker/index.ts", import.meta.url), {
    type: "module",
  });
  // The first figure's own targets load first; the rest stream in behind it.
  return new HumanoidWorkerClient(
    {
      body: bodyPack,
      ...(adultAnatomy && { adultAnatomy }),
      firstFigureAge: initialRecipe().macros.age,
    },
    { subdivision: 1 },
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

declare global {
  interface Window {
    /** QA only: swaps the shot's recipe without reloading (see `Shot`). */
    hkSetRecipe?: (init: Parameters<typeof createRecipe>[0]) => void;
  }
}

const params = new URLSearchParams(window.location.search);

/** `?recipe=<json>` seeds the figure (e2e permutations, sharing a figure). */
function initialRecipe(): Recipe {
  const raw = params.get("recipe");
  return createRecipe(raw ? (JSON.parse(raw) as Parameters<typeof createRecipe>[0]) : {});
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
 * `?bg=rrggbb` sets a background key colour.
 */
function Shot() {
  const toneMapping = TONE_MAPPERS[params.get("tm") ?? ""] ?? STUDIO_TONE_MAPPING;
  const exposure = Number(params.get("exp") ?? Number.NaN);
  // `?bg=rrggbb`: a key colour no figure uses, so tests can mask the background exactly.
  const bg = params.get("bg");
  const background = bg && /^[0-9a-f]{6}$/i.test(bg) ? `#${bg}` : null;
  const [recipe, setRecipe] = useState(initialRecipe);
  const [lift, setLift] = useState(0);
  // Tests wait for data-figure="ready": the figure is evaluated and placed.
  // data-generation counts recipes swapped in through window.hkSetRecipe, so a
  // test can render many figures from one page load.
  const [ready, setReady] = useState(false);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    window.hkSetRecipe = (init) => {
      setReady(false);
      setRecipe(createRecipe(init));
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
        <Humanoid
          recipe={recipe}
          position={[0, lift, 0]}
          onEvaluated={(ev) => {
            setLift(ev.groundOffset);
            setReady(true);
          }}
        />
        <OrbitControls makeDefault target={target} />
      </Canvas>
    </div>
  );
}

export default App;
