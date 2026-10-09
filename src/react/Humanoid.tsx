/**
 * React Three Fiber bindings: a provider that owns one evaluation worker, and
 * `<Humanoid>`, which renders a recipe and updates its geometry in place when
 * the recipe changes (no remount, so slider drags stay smooth).
 */
import type { ThreeElements, ThreeEvent } from "@react-three/fiber";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  FrontSide,
  type Group,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
} from "three";
import type {
  AttachmentTopology,
  Evaluation,
  SurfaceEvaluation,
  SurfaceTopology,
} from "../model/humanoidModel.ts";
import type { Vec3 } from "../presence/presence.ts";
import type { Recipe } from "../recipe/recipe.ts";
import { EyeMaterial } from "../render/eyeMaterial.ts";
import { AttachmentStandardMaterial, OCCLUSION_ATTRIBUTE } from "../render/occlusion.ts";
import { CURVATURE_ATTRIBUTE, SKIN_MASK_ATTRIBUTE, SkinMaterial } from "../render/skinMaterial.ts";
import type { HumanoidWorkerClient, ReadyInfo } from "../worker/client.ts";
import { type PresenceSource, usePresenceContext, usePublishPresence } from "./presence.tsx";

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
};

export interface HumanoidPresenceProps {
  id: string;
  position?: Vec3;
  facing?: Vec3;
}

/** Where a tap on the figure landed. */
export interface HumanoidPick {
  /** `"body"`, or the attachment's index in `ModelTopology.attachments`. */
  part: "body" | number;
  /** The render vertex of that mesh nearest the tap. */
  vertex: number;
  /** The tapped point, in world space. */
  point: Vector3;
}

function makeGeometry(t: SurfaceTopology): BufferGeometry {
  const g = new BufferGeometry();
  g.setIndex(new BufferAttribute(t.index, 1));
  g.setAttribute("position", new BufferAttribute(new Float32Array(t.vertexCount * 3), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(t.vertexCount * 3), 3));
  g.setAttribute("uv", new BufferAttribute(t.uvs, 2));
  return g;
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
  report: (e: Error) => void,
): MeshStandardMaterial {
  const material = useMemo(() => {
    const m = t.material;
    if (t.kind === "eyes") return new EyeMaterial();
    return new AttachmentStandardMaterial({
      color: new Color(m.color[0], m.color[1], m.color[2]),
      roughness: m.roughness,
      metalness: 0,
      transparent: m.transparent && !m.alphaToCoverage,
      alphaToCoverage: m.alphaToCoverage,
      side: m.backfaceCull ? FrontSide : DoubleSide,
    });
  }, [t]);
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

function AttachmentMesh({
  index,
  topology,
  geometry,
  visible,
  report,
  eyes,
}: {
  index: number;
  topology: AttachmentTopology;
  geometry: BufferGeometry;
  visible: boolean;
  report: (e: Error) => void;
  eyes: Recipe["eyes"];
}) {
  const material = useAttachmentMaterial(topology, report);
  useEffect(() => {
    if (material instanceof EyeMaterial) material.setAppearance(eyes);
  }, [material, eyes]);
  return (
    <mesh
      geometry={geometry}
      material={material}
      visible={visible}
      userData={{ hkPart: index }}
      renderOrder={topology.zDepth}
      castShadow
      receiveShadow
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
  const readyRef = useLatest(ready);
  const onEvaluatedRef = useLatest(onEvaluated);
  const onErrorRef = useLatest(onError);
  const report = useMemo(
    () => (e: Error) => (onErrorRef.current ? onErrorRef.current(e) : console.error(e)),
    [onErrorRef],
  );
  const skin = useMemo(() => new SkinMaterial(), []);
  const geometries = useMemo(() => {
    if (!ready) return null;
    const body = makeGeometry(ready.topology.body);
    body.setAttribute(SKIN_MASK_ATTRIBUTE, new BufferAttribute(ready.topology.body.skinMask, 3));
    body.setAttribute(
      CURVATURE_ATTRIBUTE,
      new BufferAttribute(new Float32Array(ready.topology.body.vertexCount), 1),
    );
    const attachments = ready.topology.attachments.map((t) => {
      const g = makeGeometry(t);
      g.setAttribute(OCCLUSION_ATTRIBUTE, new BufferAttribute(t.occlusion, 1));
      return g;
    });
    return { body, attachments };
  }, [ready]);
  const [shown, setShown] = useState(false);

  useEffect(
    () => () => {
      geometries?.body.dispose();
      for (const g of geometries?.attachments ?? []) g.dispose();
    },
    [geometries],
  );
  useEffect(() => () => skin.dispose(), [skin]);
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
    });
  }, [skin, recipe]);

  useEffect(() => {
    if (!geometries) return;
    let live = true;
    client.evaluate(recipe, key).then(
      (ev) => {
        if (!live) return;
        writeGeometry(geometries.body, ev);
        (geometries.body.getAttribute(CURVATURE_ATTRIBUTE) as BufferAttribute).copyArray(
          ev.curvature,
        ).needsUpdate = true;
        ev.attachments.forEach((a, i) => {
          const g = geometries.attachments[i];
          if (g) writeGeometry(g, a);
        });
        if (groupRef.current) groupRef.current.userData.groundOffset = ev.groundOffset;
        const info = readyRef.current;
        presenceSource.current = info
          ? { evaluation: ev, recipe, joints: info.presenceJoints }
          : null;
        setLift(ev.groundOffset);
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
  }, [client, geometries, recipe, key, onEvaluatedRef, readyRef, report]);

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
      {geometries && ready && (
        // With presence the group's origin is the ground under the figure, so the
        // meshes are lifted here; without it the caller lifts the group.
        <group position-y={presence ? lift : 0}>
          <mesh
            geometry={geometries.body}
            material={material ?? skin}
            visible={shown}
            userData={{ hkPart: "body" }}
            castShadow
            receiveShadow
          />
          {ready.topology.attachments.map((t, i) => {
            const g = geometries.attachments[i];
            return g ? (
              <AttachmentMesh
                key={t.id}
                index={i}
                topology={t}
                geometry={g}
                visible={shown}
                report={report}
                eyes={recipe.eyes}
              />
            ) : null;
          })}
        </group>
      )}
    </group>
  );
}
