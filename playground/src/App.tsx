import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  type AnimationLibrary,
  type BodyHairGroup,
  type CustomTarget,
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
  type HumanoidAnimationFrame,
  type HumanoidPose,
  HumanoidProvider,
  STUDIO_EXPOSURE,
  STUDIO_SHADOWS,
  STUDIO_TONE_MAPPING,
  StudioStage,
  useHumanoidAffordances,
  useHumanoidClient,
  useHumanoidReady,
} from "humanoid-kit/react";
import { animationsPack } from "humanoid-kit-animations";
import { bodyPack } from "humanoid-kit-body";
import { eyesPack } from "humanoid-kit-eyes";
import { hairPack } from "humanoid-kit-hair";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  type Bone,
  Box3,
  type DirectionalLight,
  Matrix3,
  Matrix4,
  type Mesh,
  NeutralToneMapping,
  type Object3D,
  type PerspectiveCamera,
  SkinnedMesh,
  type ToneMapping,
  Vector3,
} from "three";
import { ChannelQa } from "./ChannelQa";
import { EffectiveAdultDefaultsLab } from "./EffectiveAdultDefaultsLab";
import { MiniatureLab } from "./MiniatureLab";
import { QaShade } from "./qaShade";
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

/** A response-shot-only reading of a live coat material and its current camera relationship. */
export interface CoatRuntimeProbe {
  material: {
    transparent: boolean;
    depthWrite: boolean;
    depthTest: boolean;
    forceSinglePass: boolean;
    blending: number;
    blendSrc: number;
    blendDst: number;
    blendEquation: number;
    opacity: number;
  };
  geometry: { indexCount: number; instanceCount: number; vertexCount: number };
  uniforms: { shells: number; rows: { region: string; cover: number; density: number }[] };
  program: {
    key: string;
    found: boolean;
    usedTimes: number | null;
    alphaPath: string | null;
  };
  /**
   * Camera-facing normal samples at the current response shot. They use the
   * live skinned surface and standard skinning; dual-quaternion share is named
   * separately because this QA readback does not duplicate that shader branch.
   */
  angleMethod: "skinned-normal-no-dual-correction";
  angles: {
    region: string;
    samples: number;
    minCos: number;
    meanCos: number;
    maxCos: number;
    clampedSamples: number;
  }[];
}

type CoatProbeMaterial = {
  transparent: boolean;
  depthWrite: boolean;
  depthTest: boolean;
  forceSinglePass: boolean;
  blending: number;
  blendSrc: number;
  blendDst: number;
  blendEquation: number;
  opacity: number;
  hkUniforms: {
    hkCoatPaint: { value: { x: number; z: number }[] };
    hkCoatShells: { value: number };
  };
  customProgramCacheKey(): string;
  setCompileProbe(enabled: boolean): void;
  compiledAlphaProbe(): { programKey: string; alphaPath: string } | null;
};

const asCoatMaterial = (value: unknown): CoatProbeMaterial | null => {
  const material = value as Partial<CoatProbeMaterial> | null;
  if (!material || typeof material.customProgramCacheKey !== "function") return null;
  return material.customProgramCacheKey().startsWith("humanoid-kit-coat-")
    ? (material as CoatProbeMaterial)
    : null;
};

const maskAt = (mesh: SkinnedMesh, region: number, vertex: number): number => {
  const attribute = mesh.geometry.getAttribute(region < 4 ? "hkCoatMaskA" : "hkCoatMaskB");
  if (!attribute) return 0;
  const value = attribute.array[vertex * 4 + (region % 4)] as number;
  return attribute.normalized ? value / 255 : value;
};

/** The shader's ordinary linear-skinning normal path, read against its live camera. */
function coatAngles(mesh: SkinnedMesh, camera: Object3D): CoatRuntimeProbe["angles"] {
  const regions = (mesh.geometry.userData.hkCoatRegions as string[] | undefined) ?? [];
  const normal = mesh.geometry.getAttribute("normal");
  const skinIndex = mesh.geometry.getAttribute("skinIndex");
  const skinWeight = mesh.geometry.getAttribute("skinWeight");
  if (!normal || !skinIndex || !skinWeight) return [];
  mesh.updateWorldMatrix(true, false);
  camera.updateWorldMatrix(true, false);
  const worldNormal = new Matrix3().getNormalMatrix(mesh.matrixWorld);
  const weighted = new Matrix4();
  const skin = new Matrix4();
  const skinNormal = new Matrix3();
  const n = new Vector3();
  const position = new Vector3();
  const view = new Vector3();
  const cameraDirection = new Vector3();
  camera.getWorldDirection(cameraDirection).negate();
  return regions.map((region, group) => {
    let samples = 0;
    let sum = 0;
    let min = 1;
    let max = 0;
    let clampedSamples = 0;
    for (let vertex = 0; vertex < normal.count; vertex++) {
      if (!(maskAt(mesh, group, vertex) > 0)) continue;
      weighted.elements.fill(0);
      let totalWeight = 0;
      for (let k = 0; k < 4; k++) {
        const weight = skinWeight.getComponent(vertex, k);
        const bone = mesh.skeleton.bones[skinIndex.getComponent(vertex, k)];
        if (!bone || !(weight > 0)) continue;
        totalWeight += weight;
        for (let element = 0; element < 16; element++)
          weighted.elements[element] =
            (weighted.elements[element] as number) +
            weight * (bone.matrixWorld.elements[element] as number);
      }
      if (!(totalWeight > 0)) continue;
      skin.copy(mesh.bindMatrixInverse).multiply(weighted).multiply(mesh.bindMatrix);
      skinNormal.getNormalMatrix(skin);
      n.fromBufferAttribute(normal, vertex)
        .applyMatrix3(skinNormal)
        .applyMatrix3(worldNormal)
        .normalize();
      mesh.applyBoneTransform(vertex, position).applyMatrix4(mesh.matrixWorld);
      // The playground uses a perspective camera; retain the orthographic case
      // so a future response camera matches the shader's `isOrthographic` path.
      if ((camera as { isOrthographicCamera?: boolean }).isOrthographicCamera)
        view.copy(cameraDirection);
      else view.copy(camera.position).sub(position).normalize();
      const cosine = Math.abs(n.dot(view));
      min = Math.min(min, cosine);
      max = Math.max(max, cosine);
      sum += cosine;
      if (cosine < 0.2) clampedSamples++;
      samples++;
    }
    return {
      region,
      samples,
      minCos: samples ? min : 0,
      meanCos: samples ? sum / samples : 0,
      maxCos: samples ? max : 0,
      clampedSamples,
    };
  });
}

/** The frame a scene that plays no animation reports: none, so its `hkContacts` answers null. */
const NO_ANIMATION_FRAME: React.RefObject<HumanoidAnimationFrame | null> = { current: null };

/** Exposes `window.hkDrawn` while mounted: the triangles each part of the figure draws. */
function SceneProbe({
  animationFrame,
}: {
  animationFrame: React.RefObject<HumanoidAnimationFrame | null>;
}) {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const renderer = useThree((s) => s.gl);
  const wantsCoatProbe = params.has("coatprobe");
  useFrame(() => {
    if (!wantsCoatProbe) return;
    scene.traverse((object) => {
      if (!(object instanceof SkinnedMesh)) return;
      const material = asCoatMaterial(object.material);
      material?.setCompileProbe(true);
    });
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: the probe intentionally reads the latest ref on each QA call.
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
    window.hkContacts = () => {
      const frame = animationFrame.current;
      if (!frame) return null;
      let figure: Object3D | null = null;
      scene.traverse((o) => {
        if (!figure && o.userData.groundOffset !== undefined) figure = o;
      });
      const figureGroup = figure as Object3D | null;
      if (!figureGroup) return null;
      figureGroup.updateWorldMatrix(true, false);
      return {
        generation: frame.generation,
        time: frame.time,
        contacts: frame.contacts.map((contact) => {
          const point = figureGroup.localToWorld(new Vector3(...contact.position));
          return { ...contact, position: [point.x, point.y, point.z] as [number, number, number] };
        }),
      };
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
    if (wantsCoatProbe) {
      window.hkCoatProbe = () => {
        const out: CoatRuntimeProbe[] = [];
        const programs = (
          renderer.info as unknown as { programs?: { cacheKey?: string; usedTimes?: number }[] }
        ).programs;
        scene.traverse((object) => {
          if (!(object instanceof SkinnedMesh)) return;
          const material = asCoatMaterial(object.material);
          if (!material) return;
          const key = material.customProgramCacheKey();
          // Three appends a material's custom key to its full renderer program
          // cache key (`WebGLPrograms.getProgramCacheKey`), rather than storing
          // the custom part alone.
          const program = programs?.find((candidate) => candidate.cacheKey?.endsWith(key));
          const compiled = material.compiledAlphaProbe();
          const regions = (object.geometry.userData.hkCoatRegions as string[] | undefined) ?? [];
          out.push({
            material: {
              transparent: material.transparent,
              depthWrite: material.depthWrite,
              depthTest: material.depthTest,
              forceSinglePass: material.forceSinglePass,
              blending: material.blending,
              blendSrc: material.blendSrc,
              blendDst: material.blendDst,
              blendEquation: material.blendEquation,
              opacity: material.opacity,
            },
            geometry: {
              indexCount: object.geometry.index?.count ?? 0,
              instanceCount: object.geometry.instanceCount,
              vertexCount: object.geometry.getAttribute("position").count,
            },
            uniforms: {
              shells: material.hkUniforms.hkCoatShells.value,
              rows: regions.map((region, index) => {
                const row = material.hkUniforms.hkCoatPaint.value[index * 2];
                return { region, cover: row?.x ?? 0, density: row?.z ?? 0 };
              }),
            },
            program: {
              key,
              found: program !== undefined,
              usedTimes: program?.usedTimes ?? null,
              alphaPath: compiled?.alphaPath ?? null,
            },
            angleMethod: "skinned-normal-no-dual-correction",
            angles: coatAngles(object, camera),
          });
        });
        return out;
      };
    }
    return () => {
      delete window.hkDrawn;
      delete window.hkBone;
      delete window.hkContacts;
      delete window.hkFigure;
      delete window.hkCoatProbe;
    };
  }, [camera, renderer, scene, wantsCoatProbe]);
  return null;
}

declare global {
  interface Window {
    /** QA only: what each part of the figure is drawing (see `SceneProbe`). */
    hkDrawn?: () => DrawnPart[];
    /** QA only: a bone's head in world space (see `SceneProbe`). */
    hkBone?: (name: string) => [number, number, number] | null;
    /** QA only: exact current sole contacts in world space, from the animation frame observer. */
    hkContacts?: () => {
      generation: number;
      time: number;
      contacts: Array<{
        side: "left" | "right";
        point: "heel" | "ballInner" | "ballOuter";
        position: [number, number, number];
        owned: boolean;
        hold: number;
      }>;
    } | null;
    /** QA only: where the figure's group stands, and the lift it was given. */
    hkFigure?: () => { position: [number, number, number]; groundOffset: number } | null;
    /** QA only: swaps the shot's recipe (and pose) without reloading (see `Shot`). */
    hkSetRecipe?: (
      init: Parameters<typeof createRecipe>[0],
      pose?: ShotPose,
      signals?: Record<string, number>,
    ) => void;
    /** QA only: live coat material/program state and current response-camera angles. */
    hkCoatProbe?: () => CoatRuntimeProbe[];
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

/** `?miniatures=N` is the miniature stress lab (docs/MINIATURES.md); it needs no worker. */
export function App() {
  return params.has("miniatures") ? <MiniatureLab /> : <Studio />;
}

function Studio() {
  const client = useClient();
  if (!client) return null;
  return (
    <HumanoidProvider client={client}>
      {params.get("lab") === "effective-adult-values" ? (
        <EffectiveAdultDefaultsLab />
      ) : params.has("bodyHairLab") ? (
        <BodyHairLab />
      ) : params.get("scene") === "walk" ? (
        <Walk />
      ) : params.has("view") || params.has("cam") ? (
        <Shot />
      ) : (
        <Creator />
      )}
    </HumanoidProvider>
  );
}

/** The four regional probes frame the current posed skeleton rather than world coordinates. */
interface BodyHairLabRegion {
  id: BodyHairGroup;
  label: string;
  bone: string;
  view: [number, number, number];
  span: number;
  offset?: [number, number, number];
  pose?: string;
}

const BODY_HAIR_LAB_REGIONS: readonly BodyHairLabRegion[] = [
  { id: "face", label: "Face", bone: "head", view: [0, 0.05, 1], span: 0.32 },
  { id: "chest", label: "Chest", bone: "spine02", view: [0, 0.1, 1], span: 0.6 },
  {
    id: "axillary",
    label: "Axillary",
    bone: "upperarm01.L",
    view: [0.7, -0.3, 1],
    span: 0.5,
    pose: "overhead",
  },
  { id: "legs", label: "Legs", bone: "lowerleg01.L", view: [0, 0, 1], span: 0.62 },
] as const;

const BODY_HAIR_LAB_FORMS = [
  { label: "Feminine", gender: 0 },
  { label: "Mixed", gender: 0.5 },
  { label: "Masculine", gender: 1 },
] as const;

const BODY_HAIR_LAB_COVERAGE = [
  { label: "None", value: 0 },
  { label: "Sparse", value: 0.25 },
  { label: "Medium", value: 0.5 },
  { label: "Full", value: 1 },
] as const;

const BODY_HAIR_LAB_FOLLICLES = [
  { label: "Sparse follicles", value: 0.25 },
  { label: "Standard follicles", value: 1 },
  { label: "Dense follicles", value: 2 },
] as const;

const BODY_HAIR_LAB_HAIR = { eumelanin: 0.85, pheomelanin: 0.02, grey: 0, override: null };

function bodyHairLabRegion(id: BodyHairGroup): BodyHairLabRegion {
  const region = BODY_HAIR_LAB_REGIONS.find((candidate) => candidate.id === id);
  if (!region) throw new Error(`No direct body-hair lab region for ${id}`);
  return region;
}

function bodyHairLabForm(gender: number) {
  const form = BODY_HAIR_LAB_FORMS.find((candidate) => candidate.gender === gender);
  if (!form) throw new Error(`No direct body-hair lab form for ${gender}`);
  return form;
}

/**
 * A compact acceptance workbench for the existing independent regional API.
 * It intentionally does not reuse the creator's slider bank: each button has
 * a finite, named recipe outcome and the selected recipe remains inspectable.
 */
function BodyHairLab() {
  const [regionId, setRegionId] = useState<BodyHairGroup>("chest");
  const [gender, setGender] = useState(0.5);
  const [coverage, setCoverage] = useState(0.5);
  const [follicleDensity, setFollicleDensity] = useState(1);
  const [generation, setGeneration] = useState(0);
  const [settled, setSettled] = useState(false);
  const region = bodyHairLabRegion(regionId);
  const form = bodyHairLabForm(gender);
  const recipe = useMemo(
    () =>
      createRecipe({
        macros: { age: 30, gender },
        skin: { melanin: 0.5 },
        hair: { style: null, colour: BODY_HAIR_LAB_HAIR },
        bodyHair: {
          coverage: { [region.id]: coverage },
          follicleDensity: { [region.id]: follicleDensity },
          // The face coat selects existing beard geometry; other regions do not.
          beard: region.id === "face" ? "full" : "none",
        },
      }),
    [coverage, follicleDensity, gender, region.id],
  );
  const recipeSummary = JSON.stringify({
    age: recipe.macros.age,
    gender: recipe.macros.gender,
    bodyHair: recipe.bodyHair,
  });
  const select = (change: () => void) => {
    setSettled(false);
    setGeneration((value) => value + 1);
    change();
  };
  const choice = <T extends { label: string; value: number }>(
    heading: string,
    choices: readonly T[],
    selected: number,
    choose: (value: number) => void,
  ) => (
    <section aria-label={heading} style={{ display: "grid", gap: 8 }}>
      <h2 style={bodyHairLabHeadingStyle}>{heading}</h2>
      <div style={bodyHairLabChoicesStyle}>
        {choices.map((choice) => (
          <button
            key={choice.label}
            type="button"
            aria-pressed={selected === choice.value}
            onClick={() => select(() => choose(choice.value))}
            style={bodyHairLabButtonStyle(selected === choice.value)}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </section>
  );
  return (
    <main style={bodyHairLabLayoutStyle}>
      <section data-body-hair-stage style={bodyHairLabStageStyle} aria-label="Body hair model">
        <div
          data-body-hair-figure={settled ? "ready" : "loading"}
          data-body-hair-generation={generation}
          style={{ position: "absolute", inset: 0 }}
        >
          <Canvas
            shadows={STUDIO_SHADOWS}
            camera={{ position: [0, 0.95, 3.2], fov: 35 }}
            gl={{
              preserveDrawingBuffer: true,
              toneMapping: STUDIO_TONE_MAPPING,
              toneMappingExposure: STUDIO_EXPOSURE,
            }}
          >
            <StudioStage />
            <SceneProbe animationFrame={NO_ANIMATION_FRAME} />
            <AutoFrame
              bone={region.bone}
              view={region.view}
              span={region.span}
              offset={region.offset ?? [0, 0, 0]}
            />
            <Humanoid
              recipe={recipe}
              {...(region.pose && { pose: { body: region.pose } })}
              onSettled={() => setSettled(true)}
              bodyArtImages={tattooImages()}
            />
          </Canvas>
        </div>
      </section>
      <aside
        data-body-hair-controls
        style={bodyHairLabControlsStyle}
        aria-label="Body hair controls"
      >
        <header style={{ display: "grid", gap: 6 }}>
          <p
            style={{
              color: "#a9bfd6",
              fontSize: 12,
              letterSpacing: "0.12em",
              margin: 0,
              textTransform: "uppercase",
            }}
          >
            Adult 30 direct controls
          </p>
          <h1 style={{ fontSize: 26, margin: 0 }}>Body hair controls</h1>
          <p style={{ color: "#c8d2dd", lineHeight: 1.5, margin: 0 }}>
            Inspect one regional coverage choice and one follicle-spacing choice at a time.
          </p>
        </header>
        <section style={{ display: "grid", gap: 6 }}>
          <h2 style={bodyHairLabHeadingStyle}>What changes</h2>
          <p style={{ color: "#c8d2dd", lineHeight: 1.5, margin: 0 }}>
            Coverage changes occupied skin area. Follicle density changes strand spacing while
            keeping that selected coverage. Region selection also uses its own inspection camera.
          </p>
        </section>
        <section aria-label="Region" style={{ display: "grid", gap: 8 }}>
          <h2 style={bodyHairLabHeadingStyle}>Region</h2>
          <div style={bodyHairLabChoicesStyle}>
            {BODY_HAIR_LAB_REGIONS.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                aria-pressed={region.id === candidate.id}
                onClick={() => select(() => setRegionId(candidate.id))}
                style={bodyHairLabButtonStyle(region.id === candidate.id)}
              >
                {candidate.label}
              </button>
            ))}
          </div>
        </section>
        <section aria-label="Form" style={{ display: "grid", gap: 8 }}>
          <h2 style={bodyHairLabHeadingStyle}>Form</h2>
          <div style={bodyHairLabChoicesStyle}>
            {BODY_HAIR_LAB_FORMS.map((candidate) => (
              <button
                key={candidate.label}
                type="button"
                aria-pressed={form.gender === candidate.gender}
                onClick={() => select(() => setGender(candidate.gender))}
                style={bodyHairLabButtonStyle(form.gender === candidate.gender)}
              >
                {candidate.label}
              </button>
            ))}
          </div>
          <output>Form: {form.label}</output>
        </section>
        {choice("Coverage", BODY_HAIR_LAB_COVERAGE, coverage, setCoverage)}
        {choice("Follicle density", BODY_HAIR_LAB_FOLLICLES, follicleDensity, setFollicleDensity)}
        <section style={{ display: "grid", gap: 8 }}>
          <h2 style={bodyHairLabHeadingStyle}>Rendered recipe</h2>
          <code
            data-body-hair-recipe={recipeSummary}
            style={{
              background: "#07111f",
              border: "1px solid #29415c",
              borderRadius: 8,
              color: "#d9e9fb",
              fontSize: 12,
              overflowWrap: "anywhere",
              padding: 12,
            }}
          >
            {recipeSummary}
          </code>
        </section>
        <section style={{ display: "grid", gap: 6 }}>
          <h2 style={bodyHairLabHeadingStyle}>Evidence boundary</h2>
          <p style={{ color: "#c8d2dd", lineHeight: 1.5, margin: 0 }}>
            A settled recipe and visible figure prove handoff. They do not accept strand
            readability, regional placement, or a density response: capture each region and review
            it at its intended camera before treating the renderer as finished.
          </p>
        </section>
      </aside>
    </main>
  );
}

const bodyHairLabLayoutStyle = {
  background: "#07101c",
  color: "#f2f6fb",
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(19rem, 26rem)",
  height: "100vh",
  overflow: "hidden",
} as const;
const bodyHairLabStageStyle = { minHeight: 0, position: "relative" } as const;
const bodyHairLabControlsStyle = {
  borderLeft: "1px solid #29415c",
  display: "grid",
  gap: 24,
  overflowY: "auto",
  padding: 24,
} as const;
const bodyHairLabHeadingStyle = { fontSize: 14, letterSpacing: "0.04em", margin: 0 } as const;
const bodyHairLabChoicesStyle = { display: "flex", flexWrap: "wrap", gap: 8 } as const;
const bodyHairLabButtonStyle = (selected: boolean) => ({
  background: selected ? "#4d8dcc" : "#14253a",
  border: `1px solid ${selected ? "#a9d4ff" : "#42617f"}`,
  borderRadius: 7,
  color: "#f2f6fb",
  cursor: "pointer",
  font: "inherit",
  padding: "8px 10px",
});

/**
 * The creator with the eye pack. The library is only the pack's manifest, fetched once;
 * a material's texture loads when a figure first wears it.
 */
function Creator() {
  const [eyeMaterials, setEyeMaterials] = useState<EyeLibrary | null>(null);
  useEffect(() => {
    let live = true;
    void loadEyeLibrary(eyesPack).then((l) => live && setEyeMaterials(l));
    return () => {
      live = false;
    };
  }, []);
  return (
    <HumanoidCreator
      title="humanoid-kit"
      initialRecipe={initialRecipe()}
      frameloop="demand"
      {...(eyeMaterials && { eyeMaterials })}
    >
      {params.has("e2eEyeRegion") && <EyeRegionProbe />}
    </HumanoidCreator>
  );
}

interface EyeRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** E2E-only projected bounds for evidence that an actual eye attachment changed. */
function EyeRegionProbe() {
  const ready = useHumanoidReady();
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const size = useThree((state) => state.size);

  useEffect(() => {
    const stage = gl.domElement.closest(".hk-stage");
    if (!(stage instanceof HTMLElement) || !ready) return;
    let frame = 0;
    const report = () => {
      frame = 0;
      if (stage.dataset.framing !== "settled") return;
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld();
      const bounds = new Box3();
      let found = false;
      scene.traverse((node) => {
        if (!(node instanceof SkinnedMesh)) return;
        const index = node.userData.hkPart;
        if (typeof index !== "number" || ready.topology.attachments[index]?.kind !== "eyes") return;
        node.computeBoundingBox();
        if (!node.boundingBox) return;
        bounds.union(node.boundingBox.clone().applyMatrix4(node.matrixWorld));
        found = true;
      });
      if (!found || bounds.isEmpty()) {
        delete stage.dataset.eyeRegion;
        return;
      }
      const corners = [
        [bounds.min.x, bounds.min.y, bounds.min.z],
        [bounds.min.x, bounds.min.y, bounds.max.z],
        [bounds.min.x, bounds.max.y, bounds.min.z],
        [bounds.min.x, bounds.max.y, bounds.max.z],
        [bounds.max.x, bounds.min.y, bounds.min.z],
        [bounds.max.x, bounds.min.y, bounds.max.z],
        [bounds.max.x, bounds.max.y, bounds.min.z],
        [bounds.max.x, bounds.max.y, bounds.max.z],
      ].map(([x, y, z]) => new Vector3(x, y, z).project(camera));
      const xs = corners.map((point) => (point.x * 0.5 + 0.5) * size.width);
      const ys = corners.map((point) => (1 - (point.y * 0.5 + 0.5)) * size.height);
      const left = Math.max(0, Math.min(...xs));
      const right = Math.min(size.width, Math.max(...xs));
      const top = Math.max(0, Math.min(...ys));
      const bottom = Math.min(size.height, Math.max(...ys));
      const region: EyeRegion | null =
        right > left && bottom > top
          ? { x: left, y: top, width: right - left, height: bottom - top }
          : null;
      if (region) stage.dataset.eyeRegion = JSON.stringify(region);
      else delete stage.dataset.eyeRegion;
    };
    const schedule = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(report);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(stage, { attributes: true, attributeFilter: ["data-framing"] });
    schedule();
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      delete stage.dataset.eyeRegion;
    };
  }, [camera, gl, ready, scene, size.height, size.width]);

  return null;
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

/** QA-only floor: a visible world-space grid and surface for contact review. */
function GroundQa() {
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[8, 8]} />
        <meshStandardMaterial color="#c9c3b8" roughness={0.9} />
      </mesh>
      <gridHelper args={[8, 16, "#6d675e", "#aaa398"]} position-y={0.002} />
    </>
  );
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
 * poses the face with MakeHuman's face units; `?channels`, `?probe`, `?cut`
 * and `?open` show the apertures' channels and their clip (`ChannelQa`).
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
  const client = useHumanoidClient();
  // Playground-only bridge from the package's neutral frame observer to SceneProbe.
  const animationFrame = useRef<HumanoidAnimationFrame | null>(null);
  const onAnimationFrame = useCallback((frame: Readonly<HumanoidAnimationFrame>) => {
    animationFrame.current = frame;
  }, []);
  useEffect(() => {
    window.hkSetRecipe = (given, next, nextSignals) => {
      // `$customTargets` registers MakeHuman custom targets first, so a recipe can
      // name `custom/<name>` (a lab's specimen rendered by the real evaluator).
      const { $customTargets, ...init } = given as typeof given & {
        $customTargets?: CustomTarget[];
      };
      const show = () => {
        setSignals(nextSignals ?? initialSignals());
        setSettled(false);
        setPlaying(null);
        setRecipe(createRecipe(init));
        setPose(next ?? initialPose());
        setGeneration((g) => g + 1);
      };
      if (!$customTargets?.length) return show();
      client.addCustomTargets($customTargets).then(show, (e: unknown) => {
        console.error(`custom targets refused: ${e instanceof Error ? e.message : String(e)}`);
      });
    };
    return () => {
      delete window.hkSetRecipe;
    };
  }, [client]);
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
  // `?channels`, `?probe=…`, `?cut=…`, `?open=…`: the affordances' channels for review (`ChannelQa`).
  const affordances = useHumanoidAffordances();
  const channelQa = ["channels", "probe", "cut", "open", "hold"].some((k) => params.has(k));
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
        shadows={params.has("noshadow") ? false : STUDIO_SHADOWS}
        camera={{ position, fov }}
        // Compositor screenshots do not need a retained WebGL drawing buffer.
        gl={{
          toneMapping,
          toneMappingExposure: Number.isFinite(exposure) ? exposure : STUDIO_EXPOSURE,
        }}
      >
        <StudioStage {...(background ? { background } : {})} />
        {params.has("groundQa") && <GroundQa />}
        <SceneProbe animationFrame={animationFrame} />
        <QaShade />
        {frame && frameView.length === 3 && frameView.every(Number.isFinite) && (
          <AutoFrame
            bone={frame}
            view={frameView as [number, number, number]}
            span={Number.isFinite(frameSpan) && frameSpan > 0 ? frameSpan : 0.5}
            offset={frameOffset}
          />
        )}
        {(qaLight === "camera" || qaLight === "under") && <QaLight kind={qaLight} />}
        {channelQa && <ChannelQa of={affordances} params={params} />}
        {/* QA-only rigid orientation: no anatomy, gravity or tissue deformation is changed. */}
        <group
          rotation={params.has("supineQa") ? [-Math.PI / 2, 0, 0] : [0, 0, 0]}
          position={params.has("supineQa") ? [0, 0.35, 0] : [0, 0, 0]}
        >
          <Humanoid
            recipe={recipe}
            pose={bodyPose}
            {...(channelQa && { affordances })}
            {...(library &&
              animation && {
                animation: {
                  library,
                  ...animation,
                  onStart: setPlaying,
                  onFrame: onAnimationFrame,
                },
              })}
            {...(eyeLibrary && { eyeMaterials: eyeLibrary })}
            signals={signals}
            position={[0, animation ? 0 : lift, 0]}
            onGroundOffset={setLift}
            onSettled={() => setSettled(true)}
            bodyArtImages={tattooImages()}
          />
        </group>
        <OrbitControls makeDefault target={target} />
      </Canvas>
    </div>
  );
}

export default App;
