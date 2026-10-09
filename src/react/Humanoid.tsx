/**
 * React Three Fiber bindings: a provider that owns one evaluation worker, and
 * `<Humanoid>`, which renders a recipe and updates its geometry in place when
 * the recipe changes (no remount, so slider drags stay smooth).
 */
import { type ThreeElements, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import {
  createContext,
  type ReactNode,
  useCallback,
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
  MeshStandardMaterial,
  Skeleton,
  SkinnedMesh,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Vector3,
} from "three";
import { quantisedShapeSignals, STATE_MORPHS } from "../makehuman/stateMorphs.ts";
import type {
  AdultSurfaceTopology,
  AttachmentTopology,
  Evaluation,
  GarmentTopology,
  HairTopology,
  SurfaceEvaluation,
  SurfaceTopology,
} from "../model/humanoidModel.ts";
import { groundOffsetOf, posedControl } from "../presence/posed.ts";
import type { Vec3 } from "../presence/presence.ts";
import { isAdult } from "../recipe/agePolicy.ts";
import { appliedAnatomy } from "../recipe/anatomy.ts";
import type { Recipe } from "../recipe/recipe.ts";
import { createAttachmentMaterial, TeethMaterial } from "../render/attachmentLook.ts";
import { DecalMaterial } from "../render/decalMaterial.ts";
import {
  applyDualSkinning,
  DualBones,
  dualShadowMaterials,
  followDualSkinning,
} from "../render/dualSkinning.ts";
import { EyeMaterial } from "../render/eyeMaterial.ts";
import {
  HairMaterial,
  isMultisampled,
  setHairOcclusionAttribute,
  setHairStrandAttributes,
} from "../render/hairMaterial.ts";
import { acquireLayerAtlas } from "../render/layerAtlas.ts";
import { setBodyOcclusionAttributes, setOcclusionAttributes } from "../render/occlusion.ts";
import {
  CURVATURE_ATTRIBUTE,
  SCALP_ATTRIBUTE,
  SkinMaterial,
  UV_SCALE_ATTRIBUTE,
} from "../render/skinMaterial.ts";
import { faceSignalBasis, faceSignals } from "../rig/faceSignals.ts";
import { flexionRig, jointFlexion } from "../rig/flexion.ts";
import { occlusionKeyBasis, occlusionKeyWeights } from "../rig/occlusionKeys.ts";
import {
  bodyPoseRotations,
  composeRotations,
  faceUnitRotations,
  IDENTITY_POSE,
  restBonesFrom,
  wornGroundOffset,
} from "../rig/pose.ts";
import { skinDualShare } from "../rig/skinShare.ts";
import { browColour, type DecalKind, decalOpacity, lashColour } from "../surface/decalTone.ts";
import { DEFAULT_HAIR_COLOUR, type HairColour, hairAlbedo } from "../surface/hairTone.ts";
import type { HumanoidWorkerClient, ReadyInfo } from "../worker/client.ts";
import { type PresenceSource, usePresenceContext, usePublishPresence } from "./presence.tsx";
import { sameEntries } from "./sameEntries.ts";
import { Settle, SettleContext, useSettle } from "./settle.ts";

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
  /**
   * Called once everything the recipe wears is drawn: the worker's reply is
   * written (as for `onEvaluated`) and the hair style's strand map, every
   * attachment's and garment's textures and the attachments' posed occlusion
   * have loaded and been drawn. Called again after each evaluation. Wait for
   * this, not `onEvaluated`, before a screenshot.
   */
  onSettled?: (evaluation: Evaluation) => void;
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
   * the adult pack refines the body), `"hair"`, `"garment"` (then `garment` names
   * it), or the attachment's index in `ModelTopology.attachments`. Look the vertex up in
   * the pick map's `render.body` or `render.adultBody` accordingly.
   */
  part: "body" | "adultBody" | "hair" | "garment" | number;
  /** The tapped garment's id, when `part` is `"garment"`. */
  garment?: string;
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
  // Where the worn hair style grows from the skin; none until a style is worn.
  g.setAttribute(SCALP_ATTRIBUTE, new BufferAttribute(new Float32Array(t.vertexCount), 1));
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
    const material =
      t.kind === "eyes" ? new EyeMaterial() : createAttachmentMaterial(t.kind, t.material);
    // The figure's key weights, shared, so a pose change reaches every attachment.
    material.occlusionKeys = occlusionKeys;
    return material;
  }, [t, occlusionKeys]);
  const reportRef = useLatest(report);
  const settle = useSettle();
  useEffect(() => {
    if (!t.textureUrl) return;
    let live = true;
    const url = t.textureUrl;
    const end = settle.begin();
    new TextureLoader().loadAsync(url).then(
      (tex) => {
        end();
        if (!live) {
          tex.dispose();
          return;
        }
        tex.colorSpace = SRGBColorSpace;
        material.map = tex;
        material.needsUpdate = true;
      },
      (e: unknown) => {
        end();
        if (live) reportRef.current(new Error(`texture ${url} failed to load: ${String(e)}`));
      },
    );
    return () => {
      live = false;
      end();
      material.map?.dispose();
      material.map = null;
    };
  }, [t, material, reportRef, settle]);
  useEffect(() => () => material.dispose(), [material]);
  return material;
}

/**
 * The material for a garment: a standard material from the packed description
 * with its diffuse and normal maps, loaded once and released with it.
 * Garments are not enclosed by the figure, so they take no baked occlusion.
 */
function useGarmentMaterial(
  t: GarmentTopology,
  dual: DualBones | null,
  report: (e: Error) => void,
): MeshStandardMaterial {
  const material = useMemo(() => {
    const m = t.material;
    const made = new MeshStandardMaterial({
      color: new Color(m.color[0], m.color[1], m.color[2]),
      roughness: m.roughness,
      metalness: 0,
      alphaToCoverage: m.alphaToCoverage,
      side: m.backfaceCull ? FrontSide : DoubleSide,
    });
    // Skinned as the body is, so a sleeve does not part from the arm at a joint.
    if (dual) applyDualSkinning(made, dual);
    return made;
  }, [t, dual]);
  const reportRef = useLatest(report);
  const settle = useSettle();
  useEffect(() => {
    let live = true;
    const loader = new TextureLoader();
    const ends: (() => void)[] = [];
    const load = (url: string | null, apply: (tex: Texture) => void) => {
      if (!url) return;
      const end = settle.begin();
      ends.push(end);
      loader.loadAsync(url).then(
        (tex) => {
          end();
          if (!live) {
            tex.dispose();
            return;
          }
          apply(tex);
          material.needsUpdate = true;
        },
        (e: unknown) => {
          end();
          if (live) reportRef.current(new Error(`texture ${url} failed to load: ${String(e)}`));
        },
      );
    };
    load(t.textureUrl, (tex) => {
      tex.colorSpace = SRGBColorSpace;
      material.map = tex;
    });
    // A normal map is data, not colour: it keeps three's default (no) colour space.
    load(t.normalTextureUrl, (tex) => {
      material.normalMap = tex;
    });
    return () => {
      live = false;
      for (const end of ends) end();
      material.map?.dispose();
      material.map = null;
      material.normalMap?.dispose();
      material.normalMap = null;
    };
  }, [t, material, reportRef, settle]);
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
  garment,
  renderOrder,
  shape,
  dual,
}: {
  geometry: BufferGeometry;
  material: Material;
  skeleton: Skeleton;
  visible: boolean;
  part: HumanoidPick["part"];
  /** The garment's id, for a `"garment"` part. */
  garment?: string;
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
  mesh.userData.hkGarment = garment;
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
  melanin,
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
  melanin: number;
  shape: object;
}) {
  const material = useAttachmentMaterial(topology, occlusionKeys, report);
  useEffect(() => {
    if (material instanceof EyeMaterial) material.setAppearance(eyes);
  }, [material, eyes]);
  useEffect(() => {
    // The gums are pigmented as the skin is.
    if (material instanceof TeethMaterial) material.setSkin({ melanin });
  }, [material, melanin]);
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

/** Loads `url` as the material's diffuse map (sRGB), and frees it when the url or material changes. */
function useDiffuseTexture(
  material: MeshStandardMaterial,
  url: string | null,
  report: (e: Error) => void,
): void {
  const reportRef = useLatest(report);
  const settle = useSettle();
  useEffect(() => {
    if (!url) return;
    let live = true;
    const end = settle.begin();
    new TextureLoader().loadAsync(url).then(
      (tex) => {
        end();
        if (!live) {
          tex.dispose();
          return;
        }
        tex.colorSpace = SRGBColorSpace;
        material.map = tex;
        material.needsUpdate = true;
      },
      (e: unknown) => {
        end();
        if (live) reportRef.current(new Error(`texture ${url} failed to load: ${String(e)}`));
      },
    );
    return () => {
      live = false;
      end();
      material.map?.dispose();
      material.map = null;
    };
  }, [url, material, reportRef, settle]);
}

/** The worn hair style: alpha cards skinned to the figure, coloured by the recipe. */
function HairMesh({
  topology,
  geometry,
  skeleton,
  colour,
  multisampled,
  visible,
  report,
  shape,
}: {
  topology: HairTopology;
  geometry: BufferGeometry;
  skeleton: Skeleton;
  colour: HairColour;
  multisampled: boolean;
  visible: boolean;
  report: (e: Error) => void;
  shape: object;
}) {
  const material = useMemo(() => new HairMaterial(), []);
  useDiffuseTexture(material, topology.textureUrl, report);
  // The colour is a few numbers; effects depend on their values, not the recipe's object identity.
  const { eumelanin, pheomelanin, grey, override } = colour;
  const overrideKey = override?.join(",") ?? "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: overrideKey stands for override's values
  useEffect(() => {
    material.setColour({ eumelanin, pheomelanin, grey, override });
  }, [material, eumelanin, pheomelanin, grey, overrideKey]);
  useEffect(() => material.setStrand(topology.strand), [material, topology]);
  useEffect(() => material.setMultisampled(multisampled), [material, multisampled]);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <SkinnedPart
      geometry={geometry}
      material={material}
      skeleton={skeleton}
      visible={visible}
      part="hair"
      renderOrder={topology.zDepth}
      shape={shape}
    />
  );
}

/**
 * A worn eyebrow or eyelash: a decal on the skin, cut out by its mask and
 * coloured by the recipe's hair colour (the lashes darker), thinner on a child.
 */
function DecalMesh({
  topology,
  geometry,
  skeleton,
  colour,
  age,
  multisampled,
  visible,
  report,
  shape,
}: {
  topology: HairTopology;
  geometry: BufferGeometry;
  skeleton: Skeleton;
  colour: HairColour;
  age: number;
  multisampled: boolean;
  visible: boolean;
  report: (e: Error) => void;
  shape: object;
}) {
  const material = useMemo(() => new DecalMaterial(), []);
  useDiffuseTexture(material, topology.textureUrl, report);
  const kind = topology.kind as DecalKind;
  const { eumelanin, pheomelanin, grey, override } = colour;
  const overrideKey = override?.join(",") ?? "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: overrideKey stands for override's values
  useEffect(() => {
    const c = { eumelanin, pheomelanin, grey, override };
    material.setColour(kind === "lashes" ? lashColour(c) : browColour(c));
  }, [material, kind, eumelanin, pheomelanin, grey, overrideKey]);
  useEffect(() => material.setOpacity(decalOpacity(kind, age)), [material, kind, age]);
  useEffect(() => material.setMultisampled(multisampled), [material, multisampled]);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <SkinnedPart
      geometry={geometry}
      material={material}
      skeleton={skeleton}
      visible={visible}
      part="hair"
      renderOrder={topology.zDepth}
      shape={shape}
    />
  );
}

function GarmentMesh({
  topology,
  geometry,
  skeleton,
  visible,
  report,
  shape,
  dual,
}: {
  topology: GarmentTopology;
  geometry: BufferGeometry;
  skeleton: Skeleton;
  visible: boolean;
  report: (e: Error) => void;
  shape: object;
  /** The figure's bones as dual quaternions, which the garment skins by like the body. */
  dual: DualBones | null;
}) {
  const material = useGarmentMaterial(topology, dual, report);
  return (
    <SkinnedPart
      geometry={geometry}
      material={material}
      skeleton={skeleton}
      visible={visible}
      part="garment"
      garment={topology.id}
      shape={shape}
      dual={dual}
    />
  );
}

/** The garments a figure is wearing: their static data and the geometry drawn from it. */
interface Worn {
  /** `Outfit.key`; "" for nothing. */
  key: string;
  topologies: GarmentTopology[];
  geometries: BufferGeometry[];
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
  const garment = e.object.userData.hkGarment as string | undefined;
  onPick({ part, ...(garment && { garment }), vertex, point: e.point.clone() });
}

export function Humanoid({
  recipe,
  material,
  onEvaluated,
  onSettled,
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
  const onSettledRef = useLatest(onSettled);
  const settle = useMemo(() => new Settle(), []);
  /** The latest evaluation written to the geometry and not yet reported as settled. */
  const [unsettled, setUnsettled] = useState<Evaluation | null>(null);
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
    // Hair styles' geometries are made when a figure first wears the style.
    return { body, attachments, hair: new Map<string, BufferGeometry>() };
  }, [ready]);
  // A worn set the pack did not bake arrives at rest only; its pose-following
  // corners replace that once the worker has baked them.
  useEffect(() => {
    if (!geometries) return;
    let live = true;
    const end = settle.begin();
    client.posedOcclusion().then(
      (posed) => {
        end();
        if (!live || !posed) return;
        geometries.attachments.forEach((g, i) => {
          const o = posed[i];
          if (o) setOcclusionAttributes(g, o);
        });
      },
      (e: Error) => {
        end();
        if (live) report(e);
      },
    );
    return () => {
      live = false;
      end();
    };
  }, [client, geometries, report, settle]);
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
  /** The worn hair style: its static data and geometry, once an evaluation has brought them. */
  const [hair, setHair] = useState<{ topology: HairTopology; geometry: BufferGeometry } | null>(
    null,
  );
  /** The worn brows and lashes, each with its static data and geometry. */
  const [decals, setDecals] = useState<{ topology: HairTopology; geometry: BufferGeometry }[]>([]);
  // Alpha-to-coverage needs a multisampled framebuffer; hair falls back to a plain alpha test.
  const multisampled = useThree((s) => isMultisampled(s.gl.getContext()));
  /** Which style's scalp each body geometry holds (null: none), so it is written when it changes. */
  const scalpOf = useRef(new WeakMap<BufferGeometry, string | null>());
  // The scalp shows the hair's own colour under it, so it follows the recipe's hair colour.
  const wornHair = hair !== null;
  const wornColour = recipe.hair?.colour ?? DEFAULT_HAIR_COLOUR;
  const overrideKey = wornColour.override?.join(",") ?? "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: overrideKey stands for the override's values
  useEffect(() => {
    skin.setScalp(wornHair ? hairAlbedo(wornColour) : null);
  }, [skin, wornHair, wornColour.eumelanin, wornColour.pheomelanin, wornColour.grey, overrideKey]);

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

  // The garments worn: their geometry is built when an evaluation brings the
  // outfit's masks, and replaced when a different outfit does. The body's own
  // geometry is never rebuilt; only its index changes.
  const [worn, setWorn] = useState<Worn | null>(null);
  const wornRef = useRef<Worn | null>(null);
  const wear = useCallback((next: Worn | null) => {
    for (const g of wornRef.current?.geometries ?? []) g.dispose();
    wornRef.current = next;
    setWorn(next);
  }, []);

  // Where the posed figure's lowest point is (the body's, or what it wears): a
  // crouch or a kneel comes down to the ground rather than hanging where the
  // standing feet were.
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
      // What the figure wears stands on the ground too: a sole is lower than the foot in it.
      const worn = ev.garments.flatMap((g, i) => {
        const t = wornRef.current?.topologies[i];
        return t
          ? [{ positions: g.positions, skinIndex: t.skinIndex, skinWeight: t.skinWeight }]
          : [];
      });
      // The same skinning of the control mesh the figure's presence derives from.
      const offset = q
        ? Math.max(
            groundOffsetOf(posedControl(ready.rig, ev, q), ready.rig.skin.bodyVertices),
            wornGroundOffset(
              restBonesFrom(ready.rig.bones, ready.rig.parents, ev.boneHeads),
              q,
              worn,
            ),
          )
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
      for (const g of geometries?.hair.values() ?? []) g.dispose();
    },
    [geometries],
  );

  // A new body (a new client) starts again undressed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: geometries is the trigger
  useEffect(() => () => wear(null), [geometries, wear]);
  useEffect(() => () => skin.dispose(), [skin]);
  // The skin layers' field atlas depends on the body alone, so figures share it.
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    if (!ready) return;
    const atlas = acquireLayerAtlas(gl, ready.topology.body);
    skin.setLayerAtlas(atlas);
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
  // So does the face in it (`face.smile`, …), for the lines an expression draws.
  const faceBasis = useMemo(() => (ready ? faceSignalBasis(ready.rig) : null), [ready]);
  const face = useMemo(
    () => (faceBasis && rotations ? faceSignals(faceBasis, rotations) : {}),
    [faceBasis, rotations],
  );
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
      signals: { ...signals, ...flexion, ...face },
      age: recipe.macros.age,
      // Which adult layers paint: only for an adult, only for the anatomy applied
      // (the adult pack's own list of features; none without the pack).
      adult: isAdult(recipe),
      anatomy: appliedAnatomy(recipe, ready?.anatomy?.features ?? []),
    });
  }, [skin, recipe, signals, flexion, face, ready]);

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
    client
      .evaluate(recipe, key, shapeSignals, wornRef.current?.key ?? "")
      .then(async (ev) => {
        // A different outfit brings its masks: the body draws the faces they keep,
        // and the garments' static data comes once per garment, not per evaluation.
        const masks = ev.outfit.masks;
        const topologies = masks
          ? await Promise.all(ev.outfit.order.map((id) => client.garment(id)))
          : [];
        if (!live) return;
        // An adult's evaluation is for the adult surface: wait for its geometry
        // (this effect runs again when it arrives) rather than write it to the base's.
        const target = ev.surface === "adult" ? adultGeometry : geometries.body;
        if (!target) return;
        if (masks) {
          target.setIndex(new BufferAttribute(masks.bodyIndex, 1));
          wear({
            key: ev.outfit.key,
            topologies,
            geometries: topologies.map((t, i) =>
              makeGeometry({ ...t, index: masks.garmentIndex[i] as Uint32Array }),
            ),
          });
        }
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
        const hairTopology = ev.hair ? client.hairTopology(ev.hair.id) : undefined;
        if (ev.hair && hairTopology) {
          let g = geometries.hair.get(ev.hair.id);
          if (!g) {
            g = makeGeometry(hairTopology);
            setHairOcclusionAttribute(g, hairTopology.occlusion);
            setHairStrandAttributes(g, hairTopology.fade, hairTopology.growth, hairTopology.fin);
            geometries.hair.set(ev.hair.id, g);
          }
          writeGeometry(g, ev.hair);
          setHair({ topology: hairTopology, geometry: g });
        } else setHair(null);
        // The brows and lashes: decals, which need nothing of a style's strands.
        setDecals(
          [ev.brows, ev.lashes].flatMap((d) => {
            const t = d ? client.hairTopology(d.id) : undefined;
            if (!d || !t) return [];
            let g = geometries.hair.get(d.id);
            if (!g) {
              g = makeGeometry(t);
              geometries.hair.set(d.id, g);
            }
            writeGeometry(g, d);
            return [{ topology: t, geometry: g }];
          }),
        );
        // The skin under the worn style takes the scalp tint; a figure with none has no scalp.
        const style = ev.hair && hairTopology ? ev.hair.id : null;
        if (!scalpOf.current.has(target) || scalpOf.current.get(target) !== style) {
          scalpOf.current.set(target, style);
          const attribute = target.getAttribute(SCALP_ATTRIBUTE) as BufferAttribute;
          const scalp = ev.surface === "adult" ? hairTopology?.adultScalp : hairTopology?.scalp;
          if (style && scalp) attribute.copyArray(scalp);
          else attribute.array.fill(0);
          attribute.needsUpdate = true;
        }
        ev.garments.forEach((a, i) => {
          const g = wornRef.current?.geometries[i];
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
        setUnsettled(ev);
      })
      .catch((e: Error) => {
        if (live && e.name !== "AbortError") report(e);
      });
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
    wear,
  ]);

  // Settled: the evaluation is written and everything it brought has loaded and been drawn.
  // Children register their loads in their own effects, which run before this one.
  useEffect(() => {
    if (!unsettled) return;
    let live = true;
    let cancel = () => {};
    let frame = 0;
    const settleAfter = (frames: number) => {
      cancel = settle.whenIdle(() => {
        if (!live) return;
        if (frames > 0) {
          frame = requestAnimationFrame(() => settleAfter(frames - 1));
          return;
        }
        setUnsettled(null);
        onSettledRef.current?.(unsettled);
      });
    };
    // Two frames after the last load: the textures upload and the materials compile.
    settleAfter(2);
    return () => {
      live = false;
      cancel();
      cancelAnimationFrame(frame);
    };
  }, [unsettled, settle, onSettledRef]);

  const placed = presence?.position;
  const heading = presence?.facing;
  return (
    <SettleContext.Provider value={settle}>
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
                dual={material ? null : dual}
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
                  melanin={recipe.skin.melanin}
                  shape={shape}
                />
              ) : null;
            })}
            {hair && (
              <HairMesh
                key={hair.topology.id}
                topology={hair.topology}
                geometry={hair.geometry}
                skeleton={rig.skeleton}
                colour={recipe.hair?.colour ?? DEFAULT_HAIR_COLOUR}
                multisampled={multisampled}
                visible={shown}
                report={report}
                shape={shape}
              />
            )}
            {decals.map((d) => (
              <DecalMesh
                key={d.topology.id}
                topology={d.topology}
                geometry={d.geometry}
                skeleton={rig.skeleton}
                colour={recipe.hair?.colour ?? DEFAULT_HAIR_COLOUR}
                age={recipe.macros.age}
                multisampled={multisampled}
                visible={shown}
                report={report}
                shape={shape}
              />
            ))}
            {worn?.topologies.map((t, i) => {
              const g = worn.geometries[i];
              return g ? (
                <GarmentMesh
                  key={`${worn.key}:${t.id}`}
                  topology={t}
                  geometry={g}
                  skeleton={rig.skeleton}
                  visible={shown}
                  report={report}
                  shape={shape}
                  dual={dual}
                />
              ) : null;
            })}
          </group>
        )}
      </group>
    </SettleContext.Provider>
  );
}
