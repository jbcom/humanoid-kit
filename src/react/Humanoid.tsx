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
  LinearSRGBColorSpace,
  type Material,
  Matrix4,
  type Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Skeleton,
  SkinnedMesh,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Vector3,
} from "three";
import type { HumanoidAffordances } from "../affordance/live.ts";
import {
  JEWELLERY_ROUGHNESS,
  jewelleryMesh,
  METAL_REFLECTANCE,
  type PlacedPiercing,
} from "../bodyArt/jewellery.ts";
import type { EyeLibrary } from "../eyes/library.ts";
import { quantisedShapeSignals, STATE_MORPHS } from "../makehuman/stateMorphs.ts";
import { shapeSignalNames } from "../model/detailFactors.ts";
import type {
  AdultSurfaceTopology,
  AttachmentTopology,
  Evaluation,
  GarmentTopology,
  HairTopology,
  SurfaceEvaluation,
  SurfaceTopology,
} from "../model/humanoidModel.ts";
import { type SkinWeights, skinOfEvaluation } from "../model/reservoirSkin.ts";
import { groundOffsetOf, posedControl } from "../presence/posed.ts";
import type { Vec3 } from "../presence/presence.ts";
import { isAdult } from "../recipe/agePolicy.ts";
import { appliedAnatomy, withAnatomyDefaults } from "../recipe/anatomy.ts";
import type { Recipe } from "../recipe/recipe.ts";
import {
  createAttachmentMaterial,
  NAIL_EDGE_ATTRIBUTE,
  TeethMaterial,
} from "../render/attachmentLook.ts";
import { type BodyArtImages, type BodyArtTexture, bakeBodyArt } from "../render/bodyArtTexture.ts";
import { DecalMaterial } from "../render/decalMaterial.ts";
import {
  applyDualSkinning,
  DualBones,
  dualShadowMaterials,
  FOLD_SLOT_ATTRIBUTE,
  followDualSkinning,
} from "../render/dualSkinning.ts";
import { EyeMaterial } from "../render/eyeMaterial.ts";
import {
  HairMaterial,
  isMultisampled,
  setHairOcclusionAttribute,
  setHairRankAttribute,
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
import { HIP_FOLD, hipPose } from "../rig/hipFold.ts";
import { occlusionKeyBasis, occlusionKeyWeights } from "../rig/occlusionKeys.ts";
import {
  type BoneRotations,
  bodyPoseRotations,
  composeRotations,
  faceUnitRotations,
  IDENTITY_POSE,
  restBonesFrom,
  wornGroundOffset,
} from "../rig/pose.ts";
import { skinDualShare } from "../rig/skinShare.ts";
import { bodyHairColour, bodyHairCoverage } from "../surface/bodyHair.ts";
import { browColour, type DecalKind, decalOpacity, lashColour } from "../surface/decalTone.ts";
import { DEFAULT_HAIR_COLOUR, type HairColour, hairAlbedo } from "../surface/hairTone.ts";
import type { HumanoidWorkerClient, ReadyInfo } from "../worker/client.ts";
import { CoatMesh } from "./CoatMesh.tsx";
import { FIGURE_FRAME_PRIORITY } from "./framePriority.ts";
import { type PresenceSource, usePresenceContext, usePublishPresence } from "./presence.tsx";
import { sameEntries } from "./sameEntries.ts";
import { Settle, SettleContext, useSettle } from "./settle.ts";
import { type HumanoidAnimation, useFigureAnimation } from "./useFigureAnimation.ts";

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
   * A clip playing on the figure (`humanoid-kit-animations`, `loadAnimationLibrary`):
   * the body follows it, frame by frame, with `pose.faceUnits` laid over, and
   * `pose.body` standing aside. The figure stays on its feet, and a clip that carries
   * it (a walk) moves its group forward in the group's own frame; with `presence`
   * its presence follows. Nothing here goes through React state. While a clip plays
   * the figure lifts itself onto the ground each frame (as with `presence`: do not lift
   * the group), and `onGroundOffset` is not called.
   */
  animation?: HumanoidAnimation;
  /**
   * The eye pack's library (`humanoid-kit-eyes`, `loadEyeLibrary`): with it, a recipe's
   * `eyes.material` is worn (its texture's iris pattern and sclera detail in the recipe's
   * own colours). Keep it stable. Without it, or for a material it does not have (reported
   * through `onError`), the built-in eye texture is shown.
   */
  eyeMaterials?: EyeLibrary;
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
  /**
   * The images the recipe's tattoos name (`Tattoo.image`), decoded (an
   * `ImageBitmap`, a loaded `HTMLImageElement`, a canvas). Keep the object
   * stable (memoise it): a new one bakes the figure's body art again. A tattoo
   * whose image is missing is reported through `onError` and the figure is
   * drawn without its body art.
   */
  bodyArtImages?: BodyArtImages;
  /**
   * A handle on the figure's affordances (`useHumanoidAffordances`), which the
   * figure keeps current: its own affordances by the recipe's age, and frames,
   * channels and the clip on the figure as drawn. Setting the mouth's opening
   * opens the drawn jaw too (`JawDrop` = the larger of the pose's and the
   * opening), without a React render.
   */
  affordances?: HumanoidAffordances;
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
   * it), `"piercing"` (a piercing's jewellery), or the attachment's index in
   * `ModelTopology.attachments`. Look the vertex up in the pick map's
   * `render.body` or `render.adultBody` accordingly.
   */
  part: "body" | "adultBody" | "hair" | "garment" | "piercing" | number;
  /** The tapped garment's id, when `part` is `"garment"`. */
  garment?: string;
  /** The render vertex of that mesh nearest the tap. */
  vertex: number;
  /** The tapped point, in world space. */
  point: Vector3;
}

/**
 * A body surface's geometry: the skinned mesh plus the curvature and UV-scale
 * attributes the skin reads. Its skin weights are its own copies, written from
 * each evaluation (`writeSkin`), so a figure's are never written into the topology's.
 */
function makeBodyGeometry(
  t: SurfaceTopology & { uvScale: Float32Array; occlusion: Uint8Array },
): BufferGeometry {
  const g = makeGeometry({
    ...t,
    skinIndex: t.skinIndex.slice(),
    skinWeight: t.skinWeight.slice(),
  });
  g.setAttribute(CURVATURE_ATTRIBUTE, new BufferAttribute(new Float32Array(t.vertexCount), 1));
  g.setAttribute(UV_SCALE_ATTRIBUTE, new BufferAttribute(t.uvScale, 1));
  setBodyOcclusionAttributes(g, t.occlusion);
  // Where the worn hair style grows from the skin; none until a style is worn.
  g.setAttribute(SCALP_ATTRIBUTE, new BufferAttribute(new Float32Array(t.vertexCount), 1));
  // Each vertex's row in the hip fold, which is solved after the figure is drawn; -1 is none.
  g.setAttribute(
    FOLD_SLOT_ATTRIBUTE,
    new BufferAttribute(new Float32Array(t.vertexCount).fill(-1), 1),
  );
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

/** A short key of a figure's control vertices: what changes when its shape does. */
function controlKey(control: Float32Array): string {
  let h = 0;
  for (let i = 0; i < control.length; i += 7)
    h = (Math.imul(h, 31) + Math.round((control[i] as number) * 1e5)) | 0;
  return `${control.length}:${h}`;
}

/** The weights each body geometry was last written from, so the topology's are not sent again each evaluation. */
const writtenSkin = new WeakMap<BufferGeometry, SkinWeights>();

/** A body geometry's skin weights set to those an evaluation is skinned by (`skinOfEvaluation`). */
function writeSkin(g: BufferGeometry, skin: SkinWeights): void {
  if (writtenSkin.get(g) === skin) return;
  writtenSkin.set(g, skin);
  (g.getAttribute("skinIndex") as BufferAttribute).copyArray(skin.skinIndex).needsUpdate = true;
  (g.getAttribute("skinWeight") as BufferAttribute).copyArray(skin.skinWeight).needsUpdate = true;
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
  eyeMaterial: { library: EyeLibrary; id: string } | null = null,
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
  // An eye wears a material of the eye pack when the recipe names one the library has.
  const library = eyeMaterial?.library ?? null;
  const wanted = eyeMaterial ? library?.entry(eyeMaterial.id) : undefined;
  const missing = eyeMaterial && library && !wanted ? eyeMaterial.id : null;
  useEffect(() => {
    if (missing) reportRef.current(new Error(`the eye library has no material ${missing}`));
  }, [missing, reportRef]);
  useEffect(() => {
    if (!(material instanceof EyeMaterial)) return;
    material.setMaterial(wanted ?? null, library?.manifest);
  }, [material, wanted, library]);
  useEffect(() => {
    const worn = wanted && library ? library.textureUrl(wanted.id) : t.textureUrl;
    if (!worn) return;
    let live = true;
    const url = worn;
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
  }, [t, material, reportRef, settle, wanted, library]);
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
  shadows = true,
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
  /**
   * Whether it casts and receives shadows (default true). A decal lying on the skin
   * does neither: its quad's outline would shade the skin round it, and the skin
   * under it would shade it.
   */
  shadows?: boolean;
}) {
  const mesh = useMemo(() => {
    const m = new SkinnedMesh(geometry, material);
    m.bind(skeleton, new Matrix4());
    m.castShadow = shadows;
    m.receiveShadow = shadows;
    return m;
  }, [geometry, material, skeleton, shadows]);
  // Shadows are cast by a depth material, which would skin linearly alone; and
  // the mesh's own CPU skinning (its bounds, and ray picking) likewise.
  useEffect(() => {
    if (!dual) return;
    // The body's carries the hip fold, which its shadow, bounds and picking follow too.
    const body = part === "body" || part === "adultBody";
    const shadows = dualShadowMaterials(dual, body);
    mesh.customDepthMaterial = shadows.depth;
    mesh.customDistanceMaterial = shadows.distance;
    const applyBoneTransform = mesh.applyBoneTransform;
    followDualSkinning(mesh, dual, body);
    return () => {
      mesh.customDepthMaterial = undefined as never;
      mesh.customDistanceMaterial = undefined as never;
      mesh.applyBoneTransform = applyBoneTransform;
      shadows.depth.dispose();
      shadows.distance.dispose();
    };
  }, [mesh, dual, part]);
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
  eyeLibrary,
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
  eyeLibrary: EyeLibrary | undefined;
  melanin: number;
  shape: object;
}) {
  const eyeMaterial = useMemo(
    () =>
      topology.kind === "eyes" && eyeLibrary && eyes.material
        ? { library: eyeLibrary, id: eyes.material }
        : null,
    [topology.kind, eyeLibrary, eyes.material],
  );
  const material = useAttachmentMaterial(topology, occlusionKeys, report, eyeMaterial);
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
  density = 1,
}: {
  topology: HairTopology;
  geometry: BufferGeometry;
  skeleton: Skeleton;
  colour: HairColour;
  multisampled: boolean;
  visible: boolean;
  report: (e: Error) => void;
  shape: object;
  /** For body hair cards, how many are drawn (the figure's coverage); scalp hair is whole. */
  density?: number;
}) {
  const material = useMemo(() => new HairMaterial(), []);
  useEffect(() => material.setDensity(density), [material, density]);
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
/**
 * A piercing's jewellery (`jewelleryMesh`), skinned rigidly with its site
 * vertex's bones so it follows the posed skin there; the part inside the
 * tissue is hidden by the skin in front of it.
 */
function PiercingMesh({
  piercing,
  skeleton,
  visible,
  shape,
}: {
  piercing: PlacedPiercing;
  skeleton: Skeleton;
  visible: boolean;
  shape: object;
}) {
  const geometry = useMemo(() => {
    const m = jewelleryMesh(piercing);
    const n = m.positions.length / 3;
    const g = new BufferGeometry();
    g.setIndex(new BufferAttribute(m.index, 1));
    g.setAttribute("position", new BufferAttribute(m.positions, 3));
    g.setAttribute("normal", new BufferAttribute(m.normals, 3));
    const index = new Uint8Array(n * 4);
    const weight = new Float32Array(n * 4);
    for (let v = 0; v < n; v++) {
      index.set(piercing.skinIndex, v * 4);
      weight.set(piercing.skinWeight, v * 4);
    }
    g.setAttribute("skinIndex", new BufferAttribute(index, 4));
    g.setAttribute("skinWeight", new BufferAttribute(weight, 4));
    return g;
  }, [piercing]);
  const material = useMemo(
    () => new MeshPhysicalMaterial({ metalness: 1, roughness: JEWELLERY_ROUGHNESS }),
    [],
  );
  useEffect(() => {
    material.color.setRGB(...METAL_REFLECTANCE[piercing.metal], LinearSRGBColorSpace);
  }, [material, piercing.metal]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <SkinnedPart
      geometry={geometry}
      material={material}
      skeleton={skeleton}
      visible={visible}
      part="piercing"
      shape={shape}
    />
  );
}

function DecalMesh({
  topology,
  geometry,
  skeleton,
  colour,
  age,
  visible,
  report,
  shape,
}: {
  topology: HairTopology;
  geometry: BufferGeometry;
  skeleton: Skeleton;
  colour: HairColour;
  age: number;
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
      shadows={false}
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
  animation,
  eyeMaterials,
  signals,
  onGroundOffset,
  bodyArtImages,
  affordances,
  ref: callerRef,
  ...group
}: HumanoidProps) {
  const client = useHumanoidClient();
  const ready = useHumanoidReady();
  const key = useId();
  const groupRef = useRef<Group>(null);
  /** The group the meshes are drawn in, lifted onto the ground: the figure's own space. */
  const liftedRef = useRef<Group>(null);
  // The caller's ref and the figure's own both hold the group: presence and root
  // motion read it through the figure's.
  const callerCleanup = useRef<(() => void) | null>(null);
  const setGroup = useCallback(
    (g: Group | null) => {
      groupRef.current = g;
      if (typeof callerRef === "function") {
        // A callback ref may return its own cleanup, which React would call in place of it with null.
        if (g) {
          const cleanup = callerRef(g);
          callerCleanup.current = typeof cleanup === "function" ? cleanup : null;
        } else if (callerCleanup.current) {
          callerCleanup.current();
          callerCleanup.current = null;
        } else callerRef(null);
      } else if (callerRef) (callerRef as { current: Group | null }).current = g;
    },
    [callerRef],
  );
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
      if (t.nailEdge) g.setAttribute(NAIL_EDGE_ATTRIBUTE, new BufferAttribute(t.nailEdge, 1));
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
  /** The cards of a grown beard, when the recipe's style has some and the face grows hair. */
  const [beard, setBeard] = useState<{ topology: HairTopology; geometry: BufferGeometry } | null>(
    null,
  );
  // Alpha-to-coverage needs a multisampled framebuffer; hair falls back to a plain alpha test.
  const multisampled = useThree((s) => isMultisampled(s.gl.getContext()));
  const invalidate = useThree((s) => s.invalidate);
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
  // A grown beard's cards: their colour and how many show are the body hair model's.
  const beardLook = useMemo(() => {
    const input = {
      age: recipe.macros.age,
      gender: recipe.macros.gender,
      colour: recipe.hair?.colour ?? DEFAULT_HAIR_COLOUR,
      ...(recipe.bodyHair && { bodyHair: recipe.bodyHair }),
    };
    return { colour: bodyHairColour("face", input), density: bodyHairCoverage("face", input) };
  }, [recipe]);

  // The pose: face units blended into bone rotations (rest when absent), and
  // the attachments' occlusion following it.
  const faceUnits = useSameEntries(pose?.faceUnits);
  const body = pose?.body;
  const rotations = useMemo(() => {
    if (!ready || (!body && !faceUnits)) return null; // rest
    const face = faceUnitRotations(ready.rig, faceUnits ?? {});
    return body ? composeRotations(bodyPoseRotations(ready.rig, body), face) : face;
  }, [ready, body, faceUnits]);
  const bodyRotations = useMemo(
    () => (ready && body ? bodyPoseRotations(ready.rig, body) : null),
    [ready, body],
  );

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
  // How much larger the skin round the nipples is than the base mesh's, to a hundredth, so the
  // skin is repainted when the figure's shape changes it and not on every evaluation.
  const [areolaScale, setAreolaScale] = useState(1);
  const figureRef = useLatest(figure);
  const affordancesRef = useLatest(affordances);
  /**
   * The mouth's opening laid over the jaw (`HumanoidProps.affordances`), and the
   * handle and its `jawVersion` it was read from.
   */
  const jaw = useRef<{ opening: number; of: HumanoidAffordances | null; version: number }>({
    opening: 0,
    of: null,
    version: -1,
  });
  /** The face units' rotations with the jaw laid over, which a playing clip composes with. */
  const faceRef = useRef<BoneRotations | null>(null);
  /**
   * Writes the pose as drawn: the face units (with the mouth's opening laid over
   * the jaw) over the body's pose, to the skeleton, the attachments' occlusion
   * keys and, over the rest skeleton of `ev` (the figure shown, or one about to
   * be), the skin's dual quaternions.
   */
  const writePose = useCallback(
    (ev: Evaluation | null) => {
      if (!rig || !ready || !keyBasis) return;
      const opening = jaw.current.opening;
      const units =
        opening > (faceUnits?.JawDrop ?? 0) ? { ...faceUnits, JawDrop: opening } : faceUnits;
      faceRef.current = units ? faceUnitRotations(ready.rig, units) : null;
      let q: BoneRotations;
      if (!body && !units) q = IDENTITY_POSE(ready.rig.bones.length);
      else {
        const face = faceRef.current ?? faceUnitRotations(ready.rig, {});
        q = bodyRotations ? composeRotations(bodyRotations, face) : face;
      }
      rig.skeleton.bones.forEach((bone, i) => {
        bone.quaternion.fromArray(q, i * 4);
      });
      occlusionKeys.fromArray(occlusionKeyWeights(keyBasis, q));
      if (dual && ev)
        dual.update(restBonesFrom(ready.rig.bones, ready.rig.parents, ev.boneHeads), q);
    },
    [rig, ready, keyBasis, occlusionKeys, dual, body, bodyRotations, faceUnits],
  );
  const writePoseRef = useLatest(writePose);
  useEffect(() => writePose(figure), [writePose, figure]);
  const materialRef = useLatest(material);
  /**
   * Gives the affordances the figure `ev` of `evaluated` as it is drawn: its rest
   * surface and skin weights, and the live pose, fold and lifted group. With a
   * custom material the figure skins linearly with no fold, and so do they.
   */
  const feedAffordances = useCallback(
    (ev: Evaluation, evaluated: Recipe) => {
      const of = affordancesRef.current;
      if (!of || !ready || !dual) return;
      of.setRecipe(evaluated);
      const t = ev.surface === "adult" ? adultSurface : ready.topology.body;
      if (!t) return;
      const skin = skinOfEvaluation(ev, t);
      of.attach({
        surface: ev.surface,
        rest: ev.positions,
        restNormals: ev.normals,
        skinIndex: skin.skinIndex,
        skinWeight: skin.skinWeight,
        pose: () => (materialRef.current ? dual.linearPose() : dual.pose()),
        fold: () =>
          materialRef.current || dual.foldSurface !== ev.surface ? null : dual.skinFold(),
        skeleton: () => dual.skeleton(),
        world: liftedRef.current,
      });
    },
    [affordancesRef, ready, dual, adultSurface, materialRef],
  );
  // A handle given after the figure is drawn, or a new one, is fed the figure shown;
  // one taken away is left with none.
  // biome-ignore lint/correctness/useExhaustiveDependencies: affordances is the trigger; the figure and its recipe are read
  useEffect(() => {
    const shown = figureRef.current;
    const evaluated = foldedFor.current?.recipe;
    if (shown && evaluated) feedAffordances(shown, evaluated);
    return () => affordances?.attach(null);
  }, [affordances, feedAffordances]);
  // The mouth's opening is applied in a frame: a figure drawn only on demand is asked for one.
  useEffect(() => affordances?.onJawChange(invalidate), [affordances, invalidate]);
  // Where the landmarks are held, which the affordances' frames need: the figure is not
  // settled until they have arrived.
  useEffect(() => {
    if (!affordances || !ready) return;
    let live = true;
    const end = settle.begin();
    client.landmarkAnchors().then(
      (anchors) => {
        end();
        if (live) affordances.setAnchors(anchors);
      },
      (e: Error) => {
        end();
        if (live) report(e);
      },
    );
    return () => {
      live = false;
      end();
      // Another client's (or no) figure is coming: its anchors are not these, so until its own
      // arrive the frames are null rather than these anchors read on its figure.
      affordances.setAnchors(null);
    };
  }, [client, affordances, ready, report, settle]);
  // The hip fold (docs/ARCHITECTURE.md, "The hip fold") is solved for the figure when a
  // hip is flexed far enough to need it, in the worker between other requests; until it
  // arrives, or when the figure changes shape, the last one stays.
  const foldedFor = useRef<{
    recipe: Recipe;
    signals: Readonly<Record<string, number>>;
  } | null>(null);
  const hipsFlexed = useMemo(() => {
    if (!figure || !ready || !rotations) return false;
    const rest = restBonesFrom(ready.rig.bones, ready.rig.parents, figure.boneHeads);
    return hipPose(rest, rotations).flexion.some((f) => f > HIP_FOLD.from);
  }, [figure, ready, rotations]);
  const figureKey = useMemo(() => (figure ? controlKey(figure.control) : ""), [figure]);
  /** Ends the hold on the settle that the fold's fade-in keeps, while it fades. */
  const fading = useRef<(() => void) | null>(null);
  /** Counts the folds that have faded in whole: the meshes' bounds follow each (`shape`). */
  const [foldsShown, setFoldsShown] = useState(0);
  useFrame((_, delta) => {
    if (!dual) return;
    if (dual.advanceFold(delta)) invalidate();
    else if (fading.current) {
      fading.current();
      fading.current = null;
      setFoldsShown((n) => n + 1);
    }
    // The mouth's opening, set on the affordances, opens the jaw drawn: without a render.
    const of = affordancesRef.current ?? null;
    const version = of?.jawVersion ?? -1;
    if (of !== jaw.current.of || version !== jaw.current.version) {
      jaw.current.of = of;
      jaw.current.version = version;
      const opening = of?.jawOpening() ?? 0;
      if (opening !== jaw.current.opening) {
        jaw.current.opening = opening;
        writePoseRef.current(figureRef.current);
        invalidate();
      }
    }
  }, FIGURE_FRAME_PRIORITY);
  // biome-ignore lint/correctness/useExhaustiveDependencies: figureKey stands for the figure; foldedFor holds what it was evaluated from
  useEffect(() => {
    const wanted = foldedFor.current;
    if (!hipsFlexed || !wanted || !dual || !geometries) return;
    let live = true;
    // The figure is not settled until the fold that shapes it has been drawn.
    const end = settle.begin();
    client.hipFold(wanted.recipe, wanted.signals).then(
      ({ surface, fold }) => {
        end();
        if (!live) return;
        const [target, other] =
          surface === "adult" ? [adultGeometry, geometries.body] : [geometries.body, adultGeometry];
        if (!target) return;
        (target.getAttribute(FOLD_SLOT_ATTRIBUTE) as BufferAttribute).copyArray(
          fold.slot,
        ).needsUpdate = true;
        // The rows are of the surface drawn; the other has none.
        const left = other?.getAttribute(FOLD_SLOT_ATTRIBUTE) as BufferAttribute | undefined;
        if (left) {
          left.array.fill(-1);
          left.needsUpdate = true;
        }
        dual.setFold(fold, surface);
        // It fades in over the next frames (`DualBones.advanceFold`), and the figure is not settled before it has.
        fading.current?.();
        fading.current = settle.begin();
        invalidate();
      },
      (e: Error) => {
        end();
        if (live && e.name !== "AbortError") report(e);
      },
    );
    return () => {
      live = false;
      end();
    };
  }, [client, hipsFlexed, figureKey, dual, geometries, adultGeometry, report, settle]);
  // A new identity whenever the figure or its pose changes, or a fold has faded in: the
  // meshes' bounds follow it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: figure, rotations and foldsShown are the triggers
  const shape = useMemo(() => ({}), [figure, rotations, foldsShown]);
  const onGroundOffsetRef = useLatest(onGroundOffset);
  // A clip's pose is written each frame (`useFigureAnimation`), the face units (with the
  // jaw laid over, `writePose`) over it.
  useFigureAnimation({
    animation,
    ready,
    figure,
    skeleton: rig?.skeleton ?? null,
    dual,
    keyBasis,
    occlusionKeys,
    face: faceRef,
    group: groupRef,
    lifted: liftedRef,
    lifts: Boolean(presence) || animation !== undefined,
    staticLift: lift,
    presenceSource,
    report,
  });
  // Once the pose of the frame is written, the affordances' clip is set to the channels it opens.
  useFrame(() => affordancesRef.current?.refreshClip(), FIGURE_FRAME_PRIORITY);
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
  // The figure's body art, baked into a texture of its own from each evaluation
  // that brings some (the placement follows the shape). A new bake replaces the
  // last without rebuilding the shader; only a figure gaining or losing body art,
  // or a layer of overlapping tattoos, does.
  const bodyArt = useRef<BodyArtTexture | null>(null);
  useEffect(() => {
    if (!figure) return;
    const placement = figure.bodyArt;
    const topology = figure.surface === "adult" ? adultSurface : ready?.topology.body;
    // An adult's evaluation waits for the adult surface's topology.
    if (placement && !topology) return;
    let next: BodyArtTexture | null = null;
    if (placement && (placement.tattoos.length || placement.marks.length) && topology)
      try {
        next = bakeBodyArt(
          gl,
          {
            uvs: topology.uvs,
            index: topology.index,
            vertexCount: topology.vertexCount,
            positions: figure.positions,
            normals: figure.normals,
          },
          placement,
          bodyArtImages ?? {},
        );
      } catch (e) {
        report(e as Error);
      }
    skin.setBodyArt(next);
    bodyArt.current?.dispose();
    bodyArt.current = next;
  }, [figure, ready, adultSurface, gl, skin, bodyArtImages, report]);
  useEffect(
    () => () => {
      bodyArt.current?.dispose();
      bodyArt.current = null;
    },
    [],
  );
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
      build: {
        gender: recipe.macros.gender,
        weight: recipe.macros.weight,
        height: recipe.macros.height,
        muscle: recipe.macros.muscle,
        breastSize: recipe.macros.breastSize,
      },
      areolaScale,
      // Which adult layers paint: only for an adult, only for the anatomy applied
      // (the adult pack's own list of features; none without the pack).
      adult: isAdult(recipe),
      // The anatomy the figure is drawn with: its defaults included, as the model morphs it.
      anatomy: appliedAnatomy(
        withAnatomyDefaults(recipe, ready?.anatomy?.defaults),
        ready?.anatomy?.features ?? [],
      ),
      // Body hair: its amount from the androgen axis and age, its colour from the hair's.
      gender: recipe.macros.gender,
      ...(recipe.hair && { hairColour: recipe.hair.colour }),
      ...(recipe.bodyHair && { bodyHair: recipe.bodyHair }),
    });
  }, [skin, recipe, signals, flexion, face, ready, areolaScale]);

  // Only the signals that change the shape re-evaluate the figure; a stable
  // key keeps a colour-only change (or a new object with the same values) from
  // re-evaluating it. The adult pack's state morphs (arousal) count with the
  // body's once it is loaded. Rounded to steps (`quantiseShapeSignal`), so a
  // signal that eases does not evaluate every frame.
  const shapeNames = useMemo(() => shapeSignalNames(STATE_MORPHS, ready?.anatomy), [ready]);
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
        const topology = ev.surface === "adult" ? adultSurface : ready?.topology.body;
        if (topology) writeSkin(target, skinOfEvaluation(ev, topology));
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
            setHairStrandAttributes(
              g,
              hairTopology.fade,
              hairTopology.growth,
              hairTopology.fin,
              hairTopology.uvScale,
            );
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
        // A grown beard's cards: bound like scalp hair, thinned by their ranks.
        const beardTopology = ev.beard ? client.hairTopology(ev.beard.id) : undefined;
        if (ev.beard && beardTopology) {
          let g = geometries.hair.get(ev.beard.id);
          if (!g) {
            g = makeGeometry(beardTopology);
            setHairOcclusionAttribute(g, beardTopology.occlusion);
            setHairStrandAttributes(
              g,
              beardTopology.fade,
              beardTopology.growth,
              beardTopology.fin,
              beardTopology.uvScale,
            );
            if (beardTopology.rank) setHairRankAttribute(g, beardTopology.rank);
            geometries.hair.set(ev.beard.id, g);
          }
          writeGeometry(g, ev.beard);
          setBeard({ topology: beardTopology, geometry: g });
        } else setBeard(null);
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
        foldedFor.current = { recipe, signals: shapeSignals };
        setFigure(ev);
        setAreolaScale(Math.round(ev.areolaScale * 100) / 100);
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
        // The skin's bones over this figure's rest, and the affordances on it, from now:
        // a frame read before the next render is of the figure drawn.
        writePoseRef.current(ev);
        feedAffordances(ev, recipe);
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
    adultSurface,
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
    feedAffordances,
    writePoseRef,
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
        ref={setGroup}
        {...group}
        {...(placed && { position: placed })}
        {...(heading && { rotation: [0, Math.atan2(heading[0], heading[2]), 0] as Vec3 })}
        // Only listen when asked: a handler makes three raycast the figure on every click.
        {...(onPick && { onClick: (e: ThreeEvent<MouseEvent>) => pick(e, onPick) })}
      >
        {geometries && ready && rig && (
          // With presence, or a clip playing, the group's origin is the ground under the
          // figure, so the meshes are lifted here; without it the caller lifts the group.
          <group ref={liftedRef} position-y={presence || animation ? lift : 0}>
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
            {/* The coat (stubble, a dense chest): shells on whichever body surface is drawn. */}
            {!material && (
              <CoatMesh
                body={surface === "adult" && adultGeometry ? adultGeometry : geometries.body}
                fields={
                  surface === "adult" && adultSurface ? adultSurface.coat : ready.topology.body.coat
                }
                recipe={recipe}
                skeleton={rig.skeleton}
                dual={dual}
                visible={shown}
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
                  eyeLibrary={eyeMaterials}
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
                visible={shown}
                report={report}
                shape={shape}
              />
            ))}
            {beard && (
              <HairMesh
                key={beard.topology.id}
                topology={beard.topology}
                geometry={beard.geometry}
                skeleton={rig.skeleton}
                colour={beardLook.colour}
                density={beardLook.density}
                multisampled={multisampled}
                visible={shown}
                report={report}
                shape={shape}
              />
            )}
            {figure?.bodyArt?.piercings.map((p) => (
              <PiercingMesh
                key={p.site}
                piercing={p}
                skeleton={rig.skeleton}
                visible={shown}
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
