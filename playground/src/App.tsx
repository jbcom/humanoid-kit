import { ContactShadows, Environment, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { createRecipe, HumanoidWorkerClient, type MacroValues, type Recipe } from "humanoid-kit";
import { Humanoid, HumanoidProvider } from "humanoid-kit/react";
import { bodyPack } from "humanoid-kit-body";
import { useEffect, useState } from "react";
import { NeutralToneMapping } from "three";

function createClient(): HumanoidWorkerClient {
  const worker = new Worker(new URL("../../src/worker/index.ts", import.meta.url), {
    type: "module",
  });
  return new HumanoidWorkerClient({ body: bodyPack }, { subdivision: 1 }, worker);
}

const SLIDERS: { key: keyof MacroValues; label: string; min: number; max: number; step: number }[] =
  [
    { key: "gender", label: "Gender", min: 0, max: 1, step: 0.01 },
    { key: "age", label: "Age", min: 1, max: 90, step: 1 },
    { key: "muscle", label: "Muscle", min: 0, max: 1, step: 0.01 },
    { key: "weight", label: "Weight", min: 0, max: 1, step: 0.01 },
    { key: "height", label: "Height", min: 0, max: 1, step: 0.01 },
  ];

/** One worker per mounted app; created in an effect so StrictMode's double render cannot leak a second worker. */
function useClient(): HumanoidWorkerClient | null {
  const [client, setClient] = useState<HumanoidWorkerClient | null>(null);
  useEffect(() => {
    const c = createClient();
    setClient(c);
    return () => c.dispose();
  }, []);
  return client;
}

export function App() {
  const client = useClient();
  if (!client) return null;
  return <Playground client={client} />;
}

function Playground({ client }: { client: HumanoidWorkerClient }) {
  // `?recipe=<json>` seeds the recipe (used by the e2e permutation tests and for sharing a figure).
  const [recipe, setRecipe] = useState<Recipe>(() => {
    const raw = new URLSearchParams(window.location.search).get("recipe");
    return createRecipe(raw ? (JSON.parse(raw) as Parameters<typeof createRecipe>[0]) : {});
  });
  const [ms, setMs] = useState<number | null>(null);
  const [lift, setLift] = useState(0);
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view") ?? "front";
  // `?cam=x,y,z,tx,ty,tz` places the camera exactly (used for close-up QA shots).
  const cam = params.get("cam")?.split(",").map(Number);
  const presetCamera: [number, number, number] =
    view === "side"
      ? [3.2, 0.95, 0]
      : view === "back"
        ? [0, 0.95, -3.2]
        : view === "face"
          ? [0, 1.55, 0.9]
          : [0, 0.95, 3.2];
  const camera: [number, number, number] =
    cam?.length === 6 ? [cam[0] ?? 0, cam[1] ?? 0, cam[2] ?? 0] : presetCamera;
  const target: [number, number, number] =
    cam?.length === 6
      ? [cam[3] ?? 0, cam[4] ?? 0, cam[5] ?? 0]
      : view === "face"
        ? [0, 1.55, 0]
        : [0, 0.88, 0];

  return (
    <HumanoidProvider client={client}>
      <div style={{ position: "absolute", inset: 0 }}>
        <Canvas
          shadows="percentage"
          camera={{ position: camera, fov: 35 }}
          gl={{
            preserveDrawingBuffer: true,
            toneMapping: NeutralToneMapping,
            toneMappingExposure: 0.95,
          }}
        >
          <color attach="background" args={["#1b2530"]} />
          {/* Portrait rig: warm key high front-left, cool soft fill front-right, rim behind. */}
          <hemisphereLight args={["#e4ecf4", "#3a3028", 0.22]} />
          <directionalLight
            position={[1.8, 3.2, 2.6]}
            intensity={2.4}
            color="#fff6ef"
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-bias={-0.0004}
            shadow-normalBias={0.02}
          />
          <directionalLight position={[-2.6, 1.6, 2.2]} intensity={0.55} color="#dfe9ff" />
          <directionalLight position={[-1.2, 2.4, -3]} intensity={1.6} color="#ffffff" />
          <Environment preset="studio" environmentIntensity={0.22} />
          <Humanoid
            recipe={recipe}
            position={[0, lift, 0]}
            onEvaluated={(ev) => {
              setLift(ev.groundOffset);
              setMs(null);
            }}
            onError={(e) => console.error(e)}
          />
          <ContactShadows position={[0, 0, 0]} opacity={0.5} scale={4} blur={2.4} far={1.5} />
          <OrbitControls makeDefault target={target} />
        </Canvas>
        <form
          aria-label="Macro controls"
          style={{
            position: "absolute",
            top: 16,
            left: 16,
            display: "grid",
            gap: 8,
            color: "#e6edf3",
            font: "14px system-ui",
          }}
        >
          {SLIDERS.map((s) => (
            <label
              key={s.key}
              style={{
                display: "grid",
                gridTemplateColumns: "72px 160px 40px",
                alignItems: "center",
                gap: 8,
              }}
            >
              {s.label}
              <input
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={recipe.macros[s.key]}
                onChange={(e) =>
                  setRecipe((r) => ({
                    ...r,
                    macros: { ...r.macros, [s.key]: Number(e.target.value) },
                  }))
                }
              />
              <output>{recipe.macros[s.key].toFixed(s.step < 1 ? 2 : 0)}</output>
            </label>
          ))}
          {ms !== null && <span>{ms.toFixed(0)} ms</span>}
        </form>
      </div>
    </HumanoidProvider>
  );
}

export default App;
