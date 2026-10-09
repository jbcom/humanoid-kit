/**
 * React Three Fiber bindings: a provider that owns one evaluation worker, and
 * `<Humanoid>`, which renders a recipe and updates its geometry in place when
 * the recipe changes (no remount, so slider drags stay smooth).
 */
import { type ThreeElements, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  FrontSide,
  type Group,
  type Material,
  Matrix4,
  type Mesh,
  type MeshStandardMaterial,
  Skeleton,
  SkinnedMesh,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
} from "three";
import { quantisedShapeSignals, STATE_MORPHS } from "../makehuman/stateMorphs.ts";
import type {
  AdultSurfaceTopology,
  AttachmentTopology,
  Evaluation,
  SurfaceEvaluation,
  SurfaceTopology,
} from "../model/humanoidModel.ts";
import { groundOffsetOf, posedControl } from "../presence/posed.ts";
import type { Vec3 } from "../presence/presence.ts";
import { isAdult } from "../recipe/agePolicy.ts";
import { appliedAnatomy } from "../recipe/anatomy.ts";
import type { Recipe } from "../recipe/recipe.ts";
import { DualBones, dualShadowMaterials, followDualSkinning } from "../render/dualSkinning.ts";
import { EyeMaterial } from "../render/eyeMaterial.ts";
import { acquireLayerAtlas } from "../render/layerAtlas.ts";
import {
  AttachmentStandardMaterial,
  setBodyOcclusionAttributes,
  setOcclusionAttributes,
} from "../render/occlusion.ts";
import { CURVATURE_ATTRIBUTE, SkinMaterial, UV_SCALE_ATTRIBUTE } from "../render/skinMaterial.ts";
import { flexionRig, jointFlexion } from "../rig/flexion.ts";
import { occlusionKeyBasis, occlusionKeyWeights } from "../rig/occlusionKeys.ts";
import {
  bodyPoseRotations,
  composeRotations,
  faceUnitRotations,
  IDENTITY_POSE,
  restBonesFrom,
} from "../rig/pose.ts";
import { skinDualShare } from "../rig/skinShare.ts";
import type { HumanoidWorkerClient, ReadyInfo } from "../worker/client.ts";
import { type PresenceSource, usePresenceContext, usePublishPresence } from "./presence.tsx";
import { sameEntries } from "./sameEntries.ts";

const ClientContext = createContext<HumanoidWorkerClient | null>(null);

export function HumanoidProvider({
  client,
  children,
}: {
  client: HumanoidWorkerClient;
  children: ReactNode;
}) {
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
}

export function useHumanoidClient(): HumanoidWorkerClient {
  const c = useContext(ClientContext);
  if (!c) throw new Error("useHumanoidClient must be used inside <HumanoidProvider>");
  return c;
}

/**
 * The worker's ready info, or null while it loads. A failure to load the packs
 * is thrown during render so the nearest error boundary shows it.
 */
export function useHumanoidReady(): ReadyInfo | null {
  const client = useHumanoidClient();
  const [state, setState] = useState<{ client: HumanoidWorkerClient; info: ReadyInfo } | null>(
    null,
  );
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let live = true;
    setError(null);
    client.ready.then(
      (info) => live && setState({ client, info }),
      (e: Error) => live && setError(e),
    );
    return () => {
      live = false;
    };
  }, [client]);
  if (error) throw error;
  // Info from a previous client never describes this one's topology.
  return state?.client === client ? state.info : null;
}

/** Keeps the latest value of a prop in a ref, so effects need not depend on its identity. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/**
 * The previous record while a new one has the same entries, so a prop passed
 * inline (`pose={{ faceUnits: { JawDrop: 1 } }}`) does not recompute what
 * depends on it on every render.
 */
function useSameEntries<T extends Readonly<Record<string, number>> | undefined>(value: T): T {
  const ref = useRef(value);
  if (!sameEntries(ref.current, value)) ref.current = value;
  return ref.current;
}

export type HumanoidProps = Omit<ThreeElements["group"], "children"> & {
  recipe: Recipe;
  /** Replaces the built-in skin material (which follows `recipe.skin`). */
  material?: Material;
  onEvaluated?: (evaluation: Evaluation) => void;
  /** Evaluation and texture errors; without a handler they are logged to the console. */
  onError?: (error: Error) => void;
  /**
   * Called when the figure is tapped (pressed and released without dragging),
   * with the render vertex nearest the tap. Look it up in the client's
   * `pickMap()` to find the controls that shape it. When set, it handles the
   * group's clicks in place of `onClick`.
   */
  onPick?: (pick: HumanoidPick) => void;
  /**
   * Publishes the figure into the nearest `PresenceProvider`'s registry under
   * `id`, for as long as it is mounted. With `presence` the group's origin is
   * the ground under the figure (the figure lifts itself onto it, so do not lift
   * the group), and where it stands and which way it faces are read from the
   * group every frame: moving the group, or a parent, moves the presence.
   * `position` and `facing` are optional shorthand that place the group,
   * replacing its own `position` and `rotation`.
   */
  presence?: HumanoidPresenceProps;
  /** How the figure is posed; absent is the rest pose. */
  pose?: HumanoidPose;
  /**
   * The skin's state: named signals, each 0..1 (`cold`, `heat`, `exertion`,
   * `blush`, `fear`; `arousal` for adults only). Every signal reaches the skin
   * layers; those with state morphs (`STATE_MORPHS`) also change the shape,
   * which re-evaluates the figure. Never part of the recipe.
   */
  signals?: Readonly<Record<string, number>>;
  /**
   * Called with the lift (metres) that puts the figure's lowest body point on
   * the ground, whenever the figure or its pose changes it: place the group at
   * this height to stand, crouch or kneel on y = 0.
   */
  onGroundOffset?: (offset: number) => void;
};

export interface HumanoidPresenceProps {
  id: string;
  position?: Vec3;
  facing?: Vec3;
}

/**
 * A pose: a whole-body pose from the pack by name (`tpose`, `benchmark`,
 * `relaxed`) and
 * facial pose units by name (MakeHuman's 60, e.g. `JawDrop`,
 * `LeftUpperLidClosed`), 0..1, layered on top.
 */
export interface HumanoidPose {
  body?: string;
  faceUnits?: Readonly<Record<string, number>>;
}

/** Where a tap on the figure landed. */
export interface HumanoidPick {
  /**
   * `"body"`, `"adultBody"` (the adult surface, for a figure aged 18 or over when
   * the adult pack refines the body), or the attachment's index in
   * `ModelTopology.attachments`. Look the vertex up in the pick map's
   * `render.body` or `render.adultBody` accordingly.
   */
  part: "body" | "adultBody" | number;
  /** The render vertex of that mesh nearest the tap. */
  vertex: number;
  /** The tapped point, in world space. */
  point: Vector3;
}

/** A body surface's geometry: the skinned mesh plus the curvature and UV-scale attributes the skin reads. */
function makeBodyGeometry(
  t: SurfaceTopology & { uvScale: Float32Array; occlusion: Uint8Array },
): BufferGeometry {
  const g = makeGeometry(t);
  g.setAttribute(CURVATURE_ATTRIBUTE, new BufferAttribute(new Float32Array(t.vertexCount), 1));
  g.setAttribute(UV_SCALE_ATTRIBUTE, new BufferAttribute(t.uvScale, 1));
  setBodyOcclusionAttributes(g, t.occlusion);
  return g;
}

function makeGeometry(t: SurfaceTopology): BufferGeometry {
  const g = new BufferGeometry();
  g.setIndex(new BufferAttribute(t.index, 1));
  g.setAttribute("position", new BufferAttribute(new Float32Array(t.vertexCount * 3), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(t.vertexCount * 3), 3));
  g.setAttribute("uv", new BufferAttribute(t.uvs, 2));
  g.setAttribute("skinIndex", new BufferAttribute(t.skinIndex, 4));
  g.setAttribute("skinWeight", new BufferAttribute(t.skinWeight, 4));
  return g;
}

/**
 * The figure's skeleton, built once per rig: one bone per skeleton bone,
 * parented as in the rig, with no rest rotation (docs/ARCHITECTURE.md,
 * "Skeleton, poses and expressions"). `fit` places it on an evaluated figure.
 */
function makeSkeleton(rig: ReadyInfo["rig"]): { root: Bone; skeleton: Skeleton } {
  const bones = rig.bones.map((name) => Object.assign(new Bone(), { name }));
  let root: Bone | null = null;
  bones.forEach((b, i) => {
    const p = rig.parents[i] as number;
    if (p < 0) root = b;
    else bones[p]?.add(b);
  });
  if (!root) throw new Error("the rig has no root bone");
  return { root, skeleton: new Skeleton(bones) };
}

/** Puts the skeleton at an evaluated figure's rest: bone offsets and inverse binds from its heads. */
function fitSkeleton(skeleton: Skeleton, parents: Int16Array, heads: Float32Array): void {
  skeleton.bones.forEach((bone, i) => {
    const p = parents[i] as number;
    const [x, y, z] = [heads[i * 3] ?? 0, heads[i * 3 + 1] ?? 0, heads[i * 3 + 2] ?? 0];
    if (p < 0) bone.position.set(x, y, z);
    else
      bone.position.set(
        x - (heads[p * 3] ?? 0),
        y - (heads[p * 3 + 1] ?? 0),
        z - (heads[p * 3 + 2] ?? 0),
      );
    // Bones and meshes share the figure's group, so mesh space is bind space.
    skeleton.boneInverses[i]?.makeTranslation(-x, -y, -z);
  });
}

function writeGeometry(g: BufferGeometry, s: SurfaceEvaluation): void {
  (g.getAttribute("position") as BufferAttribute).copyArray(s.positions).needsUpdate = true;
  (g.getAttribute("normal") as BufferAttribute).copyArray(s.normals).needsUpdate = true;
  g.computeBoundingBox();
  g.computeBoundingSphere();
}

/**
 * The material for an attachment: the eye shader for eyes, otherwise a
 * standard material built from the packed material description.
 */
function useAttachmentMaterial(
  t: AttachmentTopology,
  occlusionKeys: Vector3,
  report: (e: Error) => void,
): MeshStandardMaterial {
  const material = useMemo(() => {
    const m = t.material;
    const material =
      t.kind === "eyes"
        ? new EyeMaterial()
        : new AttachmentStandardMaterial({
            color: new Color(m.color[0], m.color[1], m.color[2]),
            roughness: m.roughness,
            metalness: 0,
            transparent: m.transparent && !m.alphaToCoverage,
            alphaToCoverage: m.alphaToCoverage,
            side: m.backfaceCull ? FrontSide : DoubleSide,
          });
    // The figure's key weights, shared, so a pose change reaches every attachment.
    material.occlusionKeys = occlusionKeys;
    return material;
  }, [t, occlusionKeys]);
  const reportRef = useLatest(report);
  useEffect(() => {
    if (!t.textureUrl) return;
    let live = true;
    const url = t.textureUrl;
    new TextureLoader().loadAsync(url).then(
      (tex) => {
        if (!live) {
          tex.dispose();
          return;
        }
        tex.colorSpace = SRGBColorSpace;
        material.map = tex;
        material.needsUpdate = true;
      },
      (e: unknown) => {
        if (live) reportRef.current(new Error(`texture ${url} failed to load: ${String(e)}`));
      },
    );
    return () => {
      live = false;
      material.map?.dispose();
      material.map = null;
    };
  }, [t, material, reportRef]);
  useEffect(() => () => material.dispose(), [material]);
  return material;
}

/** A mesh skinned to the figure's skeleton, bound once in mesh space. */
function SkinnedPart({
  geometry,
  material,
  skeleton,
  visible,
  part,
  renderOrder,
  shape,
  dual,
}: {
  geometry: BufferGeometry;
  material: Material;
  skeleton: Skeleton;
  visible: boolean;
  part: HumanoidPick["part"];
  renderOrder?: number;
  /** Changes whenever the figure is re-evaluated or re-posed. */
  shape: object;
  /** Set when the material skins by dual quaternions: shadows and bounds then follow it. */
  dual?: DualBones | null;
}) {
  const mesh = useMemo(() => {
    const m = new SkinnedMesh(geometry, material);
    m.bind(skeleton, new Matrix4());
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }, [geometry, material, skeleton]);
  // Shadows are cast by a depth material, which would skin linearly alone; and
  // the mesh's own CPU skinning (its bounds, and ray picking) likewise.
  useEffect(() => {
    if (!dual) return;
    const shadows = dualShadowMaterials(dual);
    mesh.customDepthMaterial = shadows.depth;
    mesh.customDistanceMaterial = shadows.distance;
    const applyBoneTransform = mesh.applyBoneTransform;
    followDualSkinning(mesh, dual);
    return () => {
      mesh.customDepthMaterial = undefined as never;
      mesh.customDistanceMaterial = undefined as never;
      mesh.applyBoneTransform = applyBoneTransform;
      shadows.depth.dispose();
      shadows.distance.dispose();
    };
  }, [mesh, dual]);
  // A skinned mesh caches its own (posed) bounds: three computes them once and
  // never again, so a new pose or a re-evaluated (say, taller) figure would
  // keep the old ones, and picking and culling would miss whatever lies
  // outside them. They are recomputed from the posed vertices on the frame
  // after each change of shape (the skinning reads world matrices, so those
  // are brought up to date first).
  const stale = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: shape is a deliberate trigger
  useEffect(() => {
    stale.current = true;
  }, [mesh, shape]);
  useFrame(() => {
    if (!stale.current) return;
    stale.current = false;
    mesh.parent?.updateWorldMatrix(true, true);
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  });
  mesh.visible = visible;
  mesh.userData.hkPart = part;
  if (renderOrder !== undefined) mesh.renderOrder = renderOrder;
  return <primitive object={mesh} />;
}

function AttachmentMesh({
  index,
  topology,
  geometry,
  skeleton,
  occlusionKeys,
  visible,
  report,
  eyes,
  shape,
}: {
  index: number;
  topology: AttachmentTopology;
  geometry: BufferGeometry;
  skeleton: Skeleton;
  occlusionKeys: Vector3;
  visible: boolean;
  report: (e: Error) => void;
  eyes: Recipe["eyes"];
  shape: object;
}) {
  const material = useAttachmentMaterial(topology, occlusionKeys, report);
  useEffect(() => {
    if (material instanceof EyeMaterial) material.setAppearance(eyes);
  }, [material, eyes]);
  return (
    <SkinnedPart
      geometry={geometry}
      material={material}
      skeleton={skeleton}
      visible={visible}
      part={index}
      renderOrder={topology.zDepth}
      shape={shape}
    />
  );
}

/** A pointer that moved further than this between press and release was dragging (orbiting), not tapping. */
const TAP_SLOP_PX = 6;

/** Reports a tap on the figure: which mesh, and the hit triangle's vertex nearest the point. */
function pick(e: ThreeEvent<MouseEvent>, onPick: (pick: HumanoidPick) => void): void {
  if (e.delta > TAP_SLOP_PX) return;
  const part = e.object.userData.hkPart as HumanoidPick["part"] | undefined;
  const face = e.face;
  if (part === undefined || !face) return;
  e.stopPropagation();
  const positions = (e.object as Mesh).geometry.getAttribute("position");
  const local = e.object.worldToLocal(e.point.clone());
  const at = new Vector3();
  let vertex = face.a;
  let best = Number.POSITIVE_INFINITY;
  for (const v of [face.a, face.b, face.c]) {
    const d = at.fromBufferAttribute(positions, v).distanceToSquared(local);
    if (d < best) {
      best = d;
      vertex = v;
    }
  }
  onPick({ part, vertex, point: e.point.clone() });
}

export function Humanoid({
  recipe,
  material,
  onEvaluated,
  onError,
  onPick,
  presence,
  pose,
  signals,
  onGroundOffset,
  ...group
}: HumanoidProps) {
  const client = useHumanoidClient();
  const ready = useHumanoidReady();
  const key = useId();
  const groupRef = useRef<Group>(null);
  const presenceSource = useRef<PresenceSource | null>(null);
  const presenceContext = usePresenceContext();
  if (presence && !presenceContext)
    throw new Error("<Humanoid presence> must be used inside <PresenceProvider>");
  usePublishPresence(presence?.id, groupRef, presenceSource);
  // Lifts the figure so its soles meet the declared ground position.
  const [lift, setLift] = useState(0);
  const onEvaluatedRef = useLatest(onEvaluated);
  const onErrorRef = useLatest(onError);
  const report = useMemo(
    () => (e: Error) => (onErrorRef.current ? onErrorRef.current(e) : console.error(e)),
    [onErrorRef],
  );
  // How much of each occlusion key the pose holds, shared by the skin and the
  // attachments' materials.
  const occlusionKeys = useMemo(() => new Vector3(), []);
  const skin = useMemo(() => {
    const m = new SkinMaterial();
    m.occlusionKeys = occlusionKeys;
    return m;
  }, [occlusionKeys]);
  // A body pack without the joints presence reads still renders the figure; it
  // is reported (not thrown, which would take the canvas down) and not published.
  const lacksPresenceJoints = Boolean(presence && ready && !ready.presenceJoints);
  useEffect(() => {
    if (lacksPresenceJoints)
      report(
        new Error(
          "<Humanoid presence> needs the body pack's head, eye, mouth, spine, wrist, finger, ankle and toe joints, and this pack lacks one",
        ),
      );
  }, [lacksPresenceJoints, report]);
  const geometries = useMemo(() => {
    if (!ready) return null;
    const body = makeBodyGeometry(ready.topology.body);
    const attachments = ready.topology.attachments.map((t) => {
      const g = makeGeometry(t);
      setOcclusionAttributes(g, t.occlusion);
      return g;
    });
    return { body, attachments };
  }, [ready]);
  // A worn set the pack did not bake arrives at rest only; its pose-following
  // corners replace that once the worker has baked them.
  useEffect(() => {
    if (!geometries) return;
    let live = true;
    client.posedOcclusion().then(
      (posed) => {
        if (!live || !posed) return;
        geometries.attachments.forEach((g, i) => {
          const o = posed[i];
          if (o) setOcclusionAttributes(g, o);
        });
      },
      (e: Error) => live && report(e),
    );
    return () => {
      live = false;
    };
  }, [client, geometries, report]);
  const rig = useMemo(() => (ready ? makeSkeleton(ready.rig) : null), [ready]);
  // The bones as dual quaternions, which the skin skins by on the GPU (mixed
  // with three's linear skinning by each bone's share, `SKIN_DUAL_SHARE`).
  const dual = useMemo(
    () => (ready ? new DualBones(ready.rig.bones.length, skinDualShare(ready.rig.bones)) : null),
    [ready],
  );
  useEffect(() => () => dual?.dispose(), [dual]);
  // A custom material skins as it chooses; ours follows the dual quaternions.
  useLayoutEffect(() => {
    if (material) return;
    skin.setDualBones(dual);
    return () => skin.setDualBones(null);
  }, [skin, dual, material]);
  // Whatever else skins to this figure (clothing, a custom material) follows its
  // joints by `applyDualSkinning(material, group.userData.dualBones)`.
  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    group.userData.dualBones = dual;
    return () => {
      group.userData.dualBones = null;
    };
  }, [dual]);
  const keyBasis = useMemo(() => (ready ? occlusionKeyBasis(ready.rig) : null), [ready]);
  const [shown, setShown] = useState(false);
  // The adult surface (the base body with the adult pack's finer pelvis), for a
  // figure aged 18 or over. It arrives on its own request, never with the
  // base's topology, and is drawn only while the figure shown is an adult's.
  const [adultSurface, setAdultSurface] = useState<AdultSurfaceTopology | null>(null);
  const refinesBody = ready?.anatomy?.surface !== undefined;
  useEffect(() => {
    if (!ready || !refinesBody) {
      setAdultSurface(null);
      return;
    }
    let live = true;
    client.adultSurface().then(
      (t) => live && setAdultSurface(t),
      (e: Error) => live && report(e),
    );
    return () => {
      live = false;
    };
  }, [client, ready, refinesBody, report]);
  const adultGeometry = useMemo(
    () => (adultSurface ? makeBodyGeometry(adultSurface) : null),
    [adultSurface],
  );
  useEffect(() => () => adultGeometry?.dispose(), [adultGeometry]);
  /** Which body surface the geometry last written is for. */
  const [surface, setSurface] = useState<"base" | "adult">("base");

  // The pose: face units blended into bone rotations (rest when absent), and
  // the attachments' occlusion following it.
  const faceUnits = useSameEntries(pose?.faceUnits);
  const body = pose?.body;
  const rotations = useMemo(() => {
    if (!ready || (!body && !faceUnits)) return null; // rest
    const face = faceUnitRotations(ready.rig, faceUnits ?? {});
    return body ? composeRotations(bodyPoseRotations(ready.rig, body), face) : face;
  }, [ready, body, faceUnits]);
  useEffect(() => {
    if (!rig || !ready || !keyBasis) return;
    const q = rotations ?? IDENTITY_POSE(ready.rig.bones.length);
    rig.skeleton.bones.forEach((bone, i) => {
      bone.quaternion.fromArray(q, i * 4);
    });
    occlusionKeys.fromArray(occlusionKeyWeights(keyBasis, q));
  }, [rig, ready, keyBasis, occlusionKeys, rotations]);

  // Where the posed figure's lowest body point is: a crouch or a kneel comes
  // down to the ground rather than hanging where the standing feet were.
  const [figure, setFigure] = useState<Evaluation | null>(null);
  // The same pose, as dual quaternions over the evaluated figure's rest skeleton.
  useEffect(() => {
    if (!dual || !ready || !figure) return;
    dual.update(
      restBonesFrom(ready.rig.bones, ready.rig.parents, figure.boneHeads),
      rotations ?? IDENTITY_POSE(ready.rig.bones.length),
    );
  }, [dual, ready, figure, rotations]);
  // A new identity whenever the figure or its pose changes: the meshes' bounds follow it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: figure and rotations are the triggers
  const shape = useMemo(() => ({}), [figure, rotations]);
  const onGroundOffsetRef = useLatest(onGroundOffset);
  const rotationsRef = useLatest(rotations);
  /** Reports the ground offset of `ev` in the current pose. */
  const ground = useMemo(
    () => (ev: Evaluation) => {
      if (!ready) return;
      const q = rotationsRef.current;
      // The same skinning of the control mesh the figure's presence derives from.
      const offset = q
        ? groundOffsetOf(posedControl(ready.rig, ev, q), ready.rig.skin.bodyVertices)
        : ev.groundOffset;
      if (groupRef.current) groupRef.current.userData.groundOffset = offset;
      setLift(offset);
      onGroundOffsetRef.current?.(offset);
    },
    [ready, rotationsRef, onGroundOffsetRef],
  );
  // A new pose regrounds the figure it poses; a new evaluation is grounded as
  // it arrives (below), before `onEvaluated`, so the two are never out of step.
  // biome-ignore lint/correctness/useExhaustiveDependencies: rotations is the trigger; figure is read
  useEffect(() => {
    if (figure) ground(figure);
  }, [rotations, ground]);
  // A new pose gives the figure's presence a new source, so it is derived again
  // from the posed skeleton (a new evaluation's own source carries the pose).
  useEffect(() => {
    const source = presenceSource.current;
    if (!source || !ready) return;
    presenceSource.current = {
      ...source,
      pose: rotations ? { rig: ready.rig, rotations } : undefined,
    };
  }, [rotations, ready]);

  useEffect(
    () => () => {
      geometries?.body.dispose();
      for (const g of geometries?.attachments ?? []) g.dispose();
    },
    [geometries],
  );
  useEffect(() => () => skin.dispose(), [skin]);
  // The skin layers' field atlas depends on the body alone, so figures share it.
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    if (!ready) return;
    const atlas = acquireLayerAtlas(gl, ready.topology.body);
    skin.setLayerAtlas(atlas.texture);
    // The adult anatomy's fields arrive after the atlas exists, once the adult
    // pack's last stage has loaded: only their pages are re-rasterised, in
    // place, so the figure neither recompiles its shader nor re-evaluates.
    let live = true;
    if (ready.adultAnatomyLoaded)
      client.adultLayers().then(
        (update) => live && update && atlas.refresh(update),
        (e: Error) => live && report(e),
      );
    return () => {
      live = false;
      skin.setLayerAtlas(null);
      atlas.release();
    };
  }, [client, gl, ready, skin, report]);
  // The joints' flexion in the current pose joins the skin's signals
  // (`flex.elbow.L`, …), so crease layers follow any pose or animation.
  const flexion = useMemo(() => {
    if (!figure || !ready) return {};
    const rest = restBonesFrom(ready.rig.bones, ready.rig.parents, figure.boneHeads);
    return jointFlexion(flexionRig(rest), rest, rotations ?? IDENTITY_POSE(ready.rig.bones.length));
  }, [figure, ready, rotations]);
  useEffect(() => {
    const s = recipe.skin;
    skin.setAppearance({
      tone: {
        melanin: s.melanin,
        haemoglobin: s.haemoglobin,
        undertone: s.undertone,
        override: s.override,
      },
      flush: s.flush,
      lips: s.lips,
      areola: s.areola,
      signals: { ...signals, ...flexion },
      // Which adult layers paint: only for an adult, only for the anatomy applied
      // (the adult pack's own list of features; none without the pack).
      adult: isAdult(recipe),
      anatomy: appliedAnatomy(recipe, ready?.anatomy?.features ?? []),
    });
  }, [skin, recipe, signals, flexion, ready]);

  // Only the signals that change the shape re-evaluate the figure; a stable
  // key keeps a colour-only change (or a new object with the same values) from
  // re-evaluating it. The adult pack's state morphs (arousal) count with the
  // body's once it is loaded. Rounded to steps (`quantiseShapeSignal`), so a
  // signal that eases does not evaluate every frame.
  const shapeNames = useMemo(
    () => [
      ...new Set([...STATE_MORPHS, ...(ready?.anatomy?.stateMorphs ?? [])].map((m) => m.signal)),
    ],
    [ready],
  );
  // The age policy judges the signals before they are rounded; a refused one
  // is reported rather than evaluated.
  const { shapeKey, signalPolicyError } = useMemo(() => {
    try {
      const key = quantisedShapeSignals(recipe, signals ?? {}, shapeNames).join(",");
      return { shapeKey: key, signalPolicyError: null };
    } catch (e) {
      return { shapeKey: "", signalPolicyError: e as Error };
    }
  }, [recipe, signals, shapeNames]);
  const shapeSignals = useMemo(
    () => Object.fromEntries(shapeNames.map((name, i) => [name, Number(shapeKey.split(",")[i])])),
    [shapeNames, shapeKey],
  );

  useEffect(() => {
    if (!geometries) return;
    if (signalPolicyError) {
      report(signalPolicyError);
      return;
    }
    let live = true;
    client.evaluate(recipe, key, shapeSignals).then(
      (ev) => {
        if (!live) return;
        // An adult's evaluation is for the adult surface: wait for its geometry
        // (this effect runs again when it arrives) rather than write it to the base's.
        const target = ev.surface === "adult" ? adultGeometry : geometries.body;
        if (!target) return;
        if (rig && ready) fitSkeleton(rig.skeleton, ready.rig.parents, ev.boneHeads);
        writeGeometry(target, ev);
        (target.getAttribute(CURVATURE_ATTRIBUTE) as BufferAttribute).copyArray(
          ev.curvature,
        ).needsUpdate = true;
        setSurface(ev.surface);
        ev.attachments.forEach((a, i) => {
          const g = geometries.attachments[i];
          if (g) writeGeometry(g, a);
        });
        setFigure(ev);
        ground(ev);
        presenceSource.current = ready?.presenceJoints
          ? {
              evaluation: ev,
              recipe,
              joints: ready.presenceJoints,
              pose: rotationsRef.current
                ? { rig: ready.rig, rotations: rotationsRef.current }
                : undefined,
            }
          : null;
        setShown(true);
        onEvaluatedRef.current?.(ev);
      },
      (e: Error) => {
        if (live && e.name !== "AbortError") report(e);
      },
    );
    return () => {
      live = false;
    };
  }, [
    client,
    geometries,
    adultGeometry,
    rig,
    ready,
    recipe,
    key,
    shapeSignals,
    signalPolicyError,
    onEvaluatedRef,
    rotationsRef,
    report,
    ground,
  ]);

  const placed = presence?.position;
  const heading = presence?.facing;
  return (
    <group
      ref={groupRef}
      {...group}
      {...(placed && { position: placed })}
      {...(heading && { rotation: [0, Math.atan2(heading[0], heading[2]), 0] as Vec3 })}
      // Only listen when asked: a handler makes three raycast the figure on every click.
      {...(onPick && { onClick: (e: ThreeEvent<MouseEvent>) => pick(e, onPick) })}
    >
      {geometries && ready && rig && (
        // With presence the group's origin is the ground under the figure, so the
        // meshes are lifted here; without it the caller lifts the group.
        <group position-y={presence ? lift : 0}>
          <primitive object={rig.root} />
          <SkinnedPart
            geometry={geometries.body}
            material={material ?? skin}
            skeleton={rig.skeleton}
            visible={shown && surface === "base"}
            part="body"
            shape={shape}
            dual={material ? null : dual}
          />
          {adultGeometry && (
            <SkinnedPart
              geometry={adultGeometry}
              material={material ?? skin}
              skeleton={rig.skeleton}
              visible={shown && surface === "adult"}
              part="adultBody"
              shape={shape}
            />
          )}
          {ready.topology.attachments.map((t, i) => {
            const g = geometries.attachments[i];
            return g ? (
              <AttachmentMesh
                key={t.id}
                index={i}
                topology={t}
                geometry={g}
                skeleton={rig.skeleton}
                occlusionKeys={occlusionKeys}
                visible={shown}
                report={report}
                eyes={recipe.eyes}
                shape={shape}
              />
            ) : null;
          })}
        </group>
      )}
    </group>
  );
}
