import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import {
  bodyPoseRotations,
  composeRotations,
  createRecipe,
  HumanoidModel,
  IDENTITY_POSE,
  loadHumanoidAssets,
  type ModelGraft,
  restBones,
  rigData,
  skinAlbedo,
  skinNormals,
  skinPositions,
} from "humanoid-kit";
import { STUDIO_EXPOSURE, STUDIO_TONE_MAPPING, StudioStage } from "humanoid-kit/react";
import { bodyPack } from "humanoid-kit-body";
import { useEffect, useMemo, useState } from "react";
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Vector3 } from "three";

/** A pose for the graft scene: a whole-body pose of the pack, and the head turned and tilted, in degrees. */
export interface GraftPose {
  body?: string;
  turn?: number;
  tilt?: number;
}

type Init = Parameters<typeof createRecipe>[0];

declare global {
  interface Window {
    /** QA only: the graft scene's numbers for the figure drawn (`GraftQa`). */
    hkGraft?: () => { scale: number; turn: number; loopRadius: number } | null;
  }
}

const params = new URLSearchParams(window.location.search);
/** `?graft=none`: the same figure, ungrafted, for comparison. */
const grafted = params.get("graft") !== "none";
const frameView = params.get("view")?.split(",").map(Number);
/** `?mat=normal` draws the normals as colour, so a break in them shows as a line; `?wire` overlays the triangles. */
const material = params.get("mat");

/** A unit quaternion turning `deg` degrees about an axis (x, y, z). */
function axisAngle(x: number, y: number, z: number, deg: number): [number, number, number, number] {
  const a = (deg * Math.PI) / 360;
  const s = Math.sin(a);
  return [x * s, y * s, z * s, Math.cos(a)];
}

interface Drawn {
  geometry: BufferGeometry;
  colour: Color;
  /** The seam's centre in the pose, on the ground: the body's loop round the neck. */
  seam: [number, number, number];
}

/**
 * `?frame=seam&view=dx,dy,dz&span=<m>`: aims the camera at the seam from the
 * direction `view` points to (from the seam toward the camera), at the distance
 * that fits `span` metres across the frame, so every figure's neck is framed
 * alike whatever its height.
 */
function FrameSeam({ at, view, span }: { at: Vector3; view: Vector3; span: number }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as { target: Vector3; update(): void } | null;
  useEffect(() => {
    const fov = ((camera as { fov?: number }).fov ?? 35) * (Math.PI / 180);
    const distance = span / 2 / Math.tan(fov / 2);
    camera.position.copy(at).addScaledVector(view.clone().normalize(), distance);
    controls?.target.copy(at);
    controls?.update();
    camera.lookAt(at);
  }, [camera, controls, at, view, span]);
  return null;
}

/**
 * QA scene (`?scene=graft`, docs/GRAFT.md, "Seeing a graft"): a donor figure's
 * head, cut away at the neck, grafted onto the figure, posed on the CPU by the
 * rig's own skinning and drawn as one mesh in a plain skin colour, so a seam,
 * crease or shading break reads without textures to hide it. The body is drawn
 * alone (no eyes, teeth, hair or nails) because the graft is the subject.
 * `?donor=<recipe json>` picks the donor (default: a man of 60), and
 * `?graft=none` draws the same figure ungrafted, for comparison. Camera as the
 * shot's: `?cam=x,y,z,tx,ty,tz[&span=<m>]`. `window.hkSetRecipe(init, pose)`
 * swaps the figure, with `pose` a `GraftPose`.
 */
export function GraftQa() {
  const [model, setModel] = useState<HumanoidModel | null>(null);
  const [graft, setGraft] = useState<ModelGraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void loadHumanoidAssets({ body: bodyPack })
      .then((assets) => {
        if (!live) return;
        const m = new HumanoidModel(assets, { subdivision: 1 });
        const raw = params.get("donor");
        const donor = createRecipe(
          raw ? (JSON.parse(raw) as Init) : { macros: { age: 60, gender: 1, weight: 0.4 } },
        );
        const part = m.cutAway("neck", m.evaluate(donor));
        setGraft(m.graft({ at: "neck", part }));
        setModel(m);
      })
      .catch((e: unknown) => setError(String(e)));
    return () => {
      live = false;
    };
  }, []);

  const [figure, setFigure] = useState<{ init: Init; pose: GraftPose }>(() => ({
    init: JSON.parse(params.get("recipe") ?? "{}") as Init,
    pose: {},
  }));
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    window.hkSetRecipe = (init, pose) => {
      setFigure({ init, pose: (pose ?? {}) as GraftPose });
      setGeneration((g) => g + 1);
    };
    return () => {
      delete window.hkSetRecipe;
      delete window.hkGraft;
    };
  }, []);

  const drawn = useMemo<Drawn | null>(() => {
    if (!model) return null;
    const recipe = createRecipe(figure.init);
    const ev = model.evaluate(recipe);
    const rig = rigData(model.assets);
    const bones = restBones(model.assets, Float32Array.from(ev.control));
    const base = figure.pose.body
      ? bodyPoseRotations(rig, figure.pose.body)
      : IDENTITY_POSE(rig.bones.length);
    const head = IDENTITY_POSE(rig.bones.length);
    const h = rig.bones.indexOf("head");
    const turn = axisAngle(0, 1, 0, figure.pose.turn ?? 0);
    const tilt = axisAngle(1, 0, 0, figure.pose.tilt ?? 0);
    // The tilt after the turn: q = turn · tilt.
    head.set(
      [
        turn[3] * tilt[0] + turn[0] * tilt[3] + turn[1] * tilt[2] - turn[2] * tilt[1],
        turn[3] * tilt[1] - turn[0] * tilt[2] + turn[1] * tilt[3] + turn[2] * tilt[0],
        turn[3] * tilt[2] + turn[0] * tilt[1] - turn[1] * tilt[0] + turn[2] * tilt[3],
        turn[3] * tilt[3] - turn[0] * tilt[0] - turn[1] * tilt[1] - turn[2] * tilt[2],
      ],
      h * 4,
    );
    const rotations = composeRotations(base, head);
    let positions: Float32Array;
    let normals: Float32Array;
    let index: Uint32Array;
    let skin: { skinIndex: Uint16Array | Uint8Array; skinWeight: Float32Array };
    if (!graft) return null;
    const s = graft.evaluate(ev);
    const t = graft.topology(s.surface);
    if (grafted) {
      positions = s.positions;
      normals = s.normals;
      index = t.index;
      skin = s.skin ?? { skinIndex: t.skinIndex, skinWeight: t.skinWeight };
      window.hkGraft = () => ({
        scale: s.fit.scale,
        turn: s.fit.turn,
        loopRadius: s.fit.loopRadius,
      });
    } else {
      const topology = ev.surface === "adult" ? model.adultSurface() : model.topology().body;
      if (!topology) throw new Error("an adult evaluation without the adult surface");
      positions = Float32Array.from(ev.positions);
      normals = Float32Array.from(ev.normals);
      index = topology.index;
      skin = ev.skin ?? topology;
      window.hkGraft = () => null;
    }
    const n = positions.length;
    const posed = skinPositions(
      bones,
      rotations,
      positions,
      skin.skinIndex,
      skin.skinWeight,
      new Float32Array(n),
    );
    const posedNormals = skinNormals(
      bones,
      rotations,
      normals,
      skin.skinIndex,
      skin.skinWeight,
      new Float32Array(n),
    );
    // Stand the figure on the ground.
    let low = Number.POSITIVE_INFINITY;
    for (let v = 1; v < n; v += 3) low = Math.min(low, posed[v] as number);
    for (let v = 1; v < n; v += 3) posed[v] = (posed[v] as number) - low;
    const seam: [number, number, number] = [0, 0, 0];
    for (const v of t.loop)
      for (let k = 0; k < 3; k++)
        seam[k] = (seam[k] as number) + (posed[v * 3 + k] as number) / t.loop.length;
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(posed, 3));
    geometry.setAttribute("normal", new BufferAttribute(posedNormals, 3));
    geometry.setIndex(new BufferAttribute(index, 1));
    const [r, g, b] = skinAlbedo(recipe.skin);
    return { geometry, colour: new Color().setRGB(r, g, b), seam };
  }, [model, graft, figure]);
  useEffect(() => () => drawn?.geometry.dispose(), [drawn]);

  const cam = params.get("cam")?.split(",").map(Number);
  const exact = cam?.length === 6 && cam.every(Number.isFinite);
  const position = (exact ? cam.slice(0, 3) : [0, 1.5, 0.9]) as [number, number, number];
  const target = (exact ? cam.slice(3) : [0, 1.5, 0]) as [number, number, number];
  const span = Number(params.get("span"));
  const reach = Math.hypot(
    position[0] - target[0],
    position[1] - target[1],
    position[2] - target[2],
  );
  const fov =
    Number.isFinite(span) && span > 0 && reach > 0
      ? 2 * Math.atan(span / 2 / reach) * (180 / Math.PI)
      : 35;
  const seamView = useMemo(
    () =>
      params.get("frame") === "seam" && frameView?.length === 3 && frameView.every(Number.isFinite)
        ? new Vector3(...(frameView as [number, number, number]))
        : null,
    [],
  );
  if (error) return <pre data-figure="error">{error}</pre>;
  return (
    <div
      style={{ position: "absolute", inset: 0 }}
      data-figure={drawn ? "ready" : "loading"}
      data-generation={generation}
    >
      <Canvas
        shadows={false}
        camera={{ position, fov }}
        gl={{
          preserveDrawingBuffer: true,
          toneMapping: STUDIO_TONE_MAPPING,
          toneMappingExposure: STUDIO_EXPOSURE,
        }}
      >
        <StudioStage />
        {drawn && seamView && (
          <FrameSeam
            at={new Vector3(...drawn.seam)}
            view={seamView}
            span={Number.isFinite(span) && span > 0 ? span : 0.3}
          />
        )}
        {drawn && (
          <mesh geometry={drawn.geometry}>
            {material === "normal" ? (
              <meshNormalMaterial side={DoubleSide} />
            ) : (
              <meshPhysicalMaterial
                color={drawn.colour}
                roughness={0.55}
                sheen={0.3}
                sheenRoughness={0.6}
                side={DoubleSide}
              />
            )}
          </mesh>
        )}
        {drawn && params.has("wire") && (
          <mesh geometry={drawn.geometry}>
            <meshBasicMaterial color="#202020" wireframe transparent opacity={0.35} />
          </mesh>
        )}
        <OrbitControls makeDefault target={target} />
      </Canvas>
    </div>
  );
}
