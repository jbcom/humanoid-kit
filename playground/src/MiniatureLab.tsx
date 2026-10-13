import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  type AnimationClip,
  bakeMiniature,
  createRecipe,
  type DecodedTexture,
  HumanoidModel,
  loadAnimationLibrary,
  loadHumanoidAssets,
  type MiniatureBake,
  rigData,
} from "humanoid-kit";
import { type MiniatureFigure, type MiniatureFrameStats, Miniatures } from "humanoid-kit/react";
import { animationsPack } from "humanoid-kit-animations";
import { bodyPack } from "humanoid-kit-body";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * The miniature stress lab (`?miniatures=500`, docs/MINIATURES.md): a strategy
 * table of N figures of four baked archetypes in brigade stands of ten, each
 * regiment in its own colours, generals at 1.6 times scale, walking, idling and
 * crouching at their own phases. Everything is baked in the page at load (the
 * figures, then the clips), so the lab also proves the bake runs in a browser.
 *
 * Once drawn it measures 240 frames after a 60-frame warm-up and publishes the
 * result on `window.hkMiniatures` and as `data-*` attributes of
 * `[data-miniatures="ready"]`: median and 95th-percentile frame time, draw calls
 * and triangles (the renderer's own count), and what the crowd chose.
 */
declare global {
  interface Window {
    hkMiniatures?: MiniatureMeasure;
  }
}

export interface MiniatureMeasure {
  figures: number;
  medianMs: number;
  p95Ms: number;
  drawCalls: number;
  triangles: number;
  /** The WebGL renderer string, which says whether the frame times measure a GPU. */
  renderer: string;
  crowd: MiniatureFrameStats;
  bakeMs: number;
}

const params = new URLSearchParams(window.location.search);
const COUNT = Math.max(1, Number(params.get("miniatures")) || 500);

const OUTFITS: readonly (readonly string[])[] = [
  ["suits/male_worksuit01", "shoes/shoes01", "hats/fedora01"],
  ["suits/male_casualsuit02", "shoes/shoes02"],
  ["suits/female_sportsuit01", "shoes/shoes04"],
  ["suits/male_elegantsuit01", "shoes/shoes03"],
];
const SKIN = [0.25, 0.5, 0.8, 0.4];
const CLIPS = [
  ["walk", "walk_loop"],
  ["idle", "idle_loop"],
  ["crouch", "crouch_idle_loop"],
] as const;
/** Regiment colours (linear RGB), coat then trousers. */
const REGIMENTS: readonly [readonly number[], readonly number[]][] = [
  [
    [0.05, 0.08, 0.35],
    [0.5, 0.5, 0.55],
  ],
  [
    [0.4, 0.4, 0.42],
    [0.25, 0.27, 0.32],
  ],
  [
    [0.45, 0.05, 0.04],
    [0.9, 0.9, 0.85],
  ],
  [
    [0.1, 0.25, 0.08],
    [0.35, 0.3, 0.2],
  ],
];

/** Decodes an image URL to RGBA pixels in the page. */
async function decode(url: string): Promise<DecodedTexture> {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return { width: bitmap.width, height: bitmap.height, data };
}

async function bakeArchetypes(): Promise<{ bakes: MiniatureBake[]; ms: number }> {
  const { clothingPack } = await import("humanoid-kit-clothing");
  const assets = await loadHumanoidAssets({ body: bodyPack, clothing: clothingPack });
  await assets.loadProxies?.();
  const library = await loadAnimationLibrary(animationsPack);
  const bones = rigData(assets).bones;
  const clips = await Promise.all(
    CLIPS.map(async ([name, id]) => ({
      name,
      clip: (await library.load(id, bones)) as AnimationClip,
    })),
  );
  const files = new Set<string>();
  for (const outfit of OUTFITS)
    for (const id of outfit) {
      const t = assets.garments.get(id)?.entry.material.texture;
      if (t) files.add(t);
    }
  for (const a of assets.manifest.attachments.entries)
    if (a.kind === "eyes" && a.material.texture) files.add(a.material.texture);
  const textures = new Map<string, DecodedTexture>();
  await Promise.all(
    [...files].map(async (f) => {
      const url = assets.fileUrls.get(f);
      if (url) textures.set(f, await decode(url));
    }),
  );
  const model = new HumanoidModel(assets, { subdivision: 0 });
  const t0 = performance.now();
  const bakes = OUTFITS.map((outfit, i) =>
    bakeMiniature(model, createRecipe({ outfit, skin: { melanin: SKIN[i] ?? 0.4 } }), {
      clips,
      texture: (p) => (p.material?.texture && textures.get(p.material.texture)) || null,
    }),
  );
  return { bakes, ms: performance.now() - t0 };
}

/** Brigade stands of ten (two ranks of five), regiments side by side, a general every fifty. */
function table(count: number): MiniatureFigure[] {
  return Array.from({ length: count }, (_, i) => {
    const stand = Math.floor(i / 10);
    const slot = i % 10;
    const regiment = Math.floor(stand / 5) % REGIMENTS.length;
    const [coat, trousers] = REGIMENTS[regiment] as [readonly number[], readonly number[]];
    const general = i % 50 === 0;
    return {
      archetype: stand % OUTFITS.length,
      x: (stand % 10) * 4.2 - 19 + (slot % 5) * 0.7,
      z: Math.floor(stand / 10) * 3.2 - 12 + Math.floor(slot / 5) * 0.9,
      heading: Math.PI,
      scale: general ? 1.6 : 1,
      clip: CLIPS[stand % CLIPS.length]?.[0] as string,
      phase: (i * 0.618) % 3,
      tints: [coat, trousers, [0.15, 0.12, 0.1]] as unknown as NonNullable<
        MiniatureFigure["tints"]
      >,
    };
  });
}

/** The GPU the page draws with (e.g. "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro …)" or SwiftShader). */
function rendererName(context: WebGLRenderingContext | WebGL2RenderingContext): string {
  const info = context.getExtension("WEBGL_debug_renderer_info");
  return String(
    info
      ? context.getParameter(info.UNMASKED_RENDERER_WEBGL)
      : context.getParameter(context.RENDERER),
  );
}

function Measure({ onDone }: { onDone: (m: Omit<MiniatureMeasure, "bakeMs" | "crowd">) => void }) {
  const gl = useThree((s) => s.gl);
  const frames = useRef<number[]>([]);
  const last = useRef(0);
  const done = useRef(false);
  useFrame(() => {
    if (done.current) return;
    const now = performance.now();
    if (last.current) frames.current.push(now - last.current);
    last.current = now;
    if (frames.current.length < 300) return;
    done.current = true;
    const sample = frames.current.slice(60).sort((a, b) => a - b);
    onDone({
      figures: COUNT,
      medianMs: sample[Math.floor(sample.length / 2)] as number,
      p95Ms: sample[Math.floor(sample.length * 0.95)] as number,
      drawCalls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      renderer: rendererName(gl.getContext()),
    });
  });
  return null;
}

export function MiniatureLab() {
  const [baked, setBaked] = useState<{ bakes: MiniatureBake[]; ms: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [measure, setMeasure] = useState<MiniatureMeasure | null>(null);
  const crowd = useRef<MiniatureFrameStats | null>(null);
  useEffect(() => {
    bakeArchetypes().then(setBaked, (e: unknown) => setError(String(e)));
  }, []);
  const figures = useMemo(() => table(COUNT), []);
  if (error) return <pre data-miniatures="error">{error}</pre>;
  return (
    <div style={{ position: "fixed", inset: 0, background: "#20242a" }}>
      {baked && (
        <Canvas camera={{ position: [0, 16, 26], fov: 45, near: 0.5, far: 200 }} dpr={1}>
          <hemisphereLight args={[0xdfe8ff, 0x403a30, 1.6]} />
          <directionalLight position={[8, 20, 10]} intensity={2.2} />
          <mesh rotation-x={-Math.PI / 2}>
            <planeGeometry args={[80, 60]} />
            <meshStandardMaterial color="#5d6b45" roughness={1} />
          </mesh>
          <CameraAim />
          <Miniatures
            archetypes={baked.bakes}
            figures={figures}
            maxFigures={COUNT}
            onFrame={(s) => {
              crowd.current = s;
            }}
          />
          <Measure
            onDone={(m) => {
              const full = { ...m, bakeMs: baked.ms, crowd: crowd.current as MiniatureFrameStats };
              window.hkMiniatures = full;
              setMeasure(full);
            }}
          />
        </Canvas>
      )}
      <div
        data-miniatures={measure ? "ready" : baked ? "drawing" : "baking"}
        style={{ position: "absolute", left: 8, top: 8, color: "#ddd", font: "12px monospace" }}
      >
        {measure
          ? `${COUNT} figures · ${measure.drawCalls} draws · ${measure.triangles} tris · ${measure.medianMs.toFixed(1)} ms median, ${measure.p95Ms.toFixed(1)} p95`
          : baked
            ? "measuring…"
            : "baking…"}
      </div>
    </div>
  );
}

function CameraAim() {
  const camera = useThree((s) => s.camera);
  useEffect(() => camera.lookAt(0, 0, -2), [camera]);
  return null;
}
