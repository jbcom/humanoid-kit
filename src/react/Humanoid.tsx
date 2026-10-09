/**
 * React Three Fiber bindings: a provider that owns one evaluation worker, and
 * `<Humanoid>`, which renders a recipe and updates its geometry in place when
 * the recipe changes (no remount, so slider drags stay smooth).
 */
import type { ThreeElements } from "@react-three/fiber";
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
  MeshStandardMaterial,
  SRGBColorSpace,
  TextureLoader,
} from "three";
import type {
  AttachmentTopology,
  Evaluation,
  SurfaceEvaluation,
  SurfaceTopology,
} from "../model/humanoidModel.ts";
import { isAdult } from "../recipe/agePolicy.ts";
import type { Recipe } from "../recipe/recipe.ts";
import { SKIN_MASK_ATTRIBUTE, SkinMaterial } from "../render/skinMaterial.ts";
import type { HumanoidWorkerClient, ReadyInfo } from "../worker/client.ts";

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
};

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

/** A standard material built from an attachment's packed material description. */
function useAttachmentMaterial(
  t: AttachmentTopology,
  report: (e: Error) => void,
): MeshStandardMaterial {
  const material = useMemo(() => {
    const m = t.material;
    return new MeshStandardMaterial({
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
  topology,
  geometry,
  visible,
  report,
}: {
  topology: AttachmentTopology;
  geometry: BufferGeometry;
  visible: boolean;
  report: (e: Error) => void;
}) {
  const material = useAttachmentMaterial(topology, report);
  return (
    <mesh
      geometry={geometry}
      material={material}
      visible={visible}
      renderOrder={topology.zDepth}
      castShadow
      receiveShadow
    />
  );
}

export function Humanoid({ recipe, material, onEvaluated, onError, ...group }: HumanoidProps) {
  const client = useHumanoidClient();
  const ready = useHumanoidReady();
  const key = useId();
  const groupRef = useRef<Group>(null);
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
    return { body, attachments: ready.topology.attachments.map(makeGeometry) };
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
    skin.setAppearance(
      {
        tone: {
          melanin: s.melanin,
          haemoglobin: s.haemoglobin,
          undertone: s.undertone,
          override: s.override,
        },
        flush: s.flush,
        lips: s.lips,
        areola: s.areola,
      },
      isAdult(recipe),
    );
  }, [skin, recipe]);

  useEffect(() => {
    if (!geometries) return;
    let live = true;
    client.evaluate(recipe, key).then(
      (ev) => {
        if (!live) return;
        writeGeometry(geometries.body, ev);
        ev.attachments.forEach((a, i) => {
          const g = geometries.attachments[i];
          if (g) writeGeometry(g, a);
        });
        if (groupRef.current) groupRef.current.userData.groundOffset = ev.groundOffset;
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
  }, [client, geometries, recipe, key, onEvaluatedRef, report]);

  return (
    <group ref={groupRef} {...group}>
      {geometries && ready && (
        <>
          <mesh
            geometry={geometries.body}
            material={material ?? skin}
            visible={shown}
            castShadow
            receiveShadow
          />
          {ready.topology.attachments.map((t, i) => {
            const g = geometries.attachments[i];
            return g ? (
              <AttachmentMesh
                key={t.id}
                topology={t}
                geometry={g}
                visible={shown}
                report={report}
              />
            ) : null;
          })}
        </>
      )}
    </group>
  );
}
