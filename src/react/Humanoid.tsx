/**
 * React Three Fiber bindings: a provider that owns one evaluation worker, and
 * `<Humanoid>` which renders a recipe and updates its geometry in place when
 * the recipe changes (no remount, so slider drags stay smooth).
 */
import type { ThreeElements } from "@react-three/fiber";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
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
import type { Recipe } from "../recipe/recipe.ts";
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

/** Resolves once the worker has loaded its packs. */
export function useHumanoidReady(): ReadyInfo | null {
  const client = useHumanoidClient();
  const [info, setInfo] = useState<ReadyInfo | null>(null);
  useEffect(() => {
    let live = true;
    client.ready.then((i) => live && setInfo(i));
    return () => {
      live = false;
    };
  }, [client]);
  return info;
}

export type HumanoidProps = Omit<ThreeElements["group"], "children"> & {
  recipe: Recipe;
  /** Skin material; defaults to neutral clay. */
  material?: Material;
  onEvaluated?: (evaluation: Evaluation) => void;
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
function useAttachmentMaterial(t: AttachmentTopology): MeshStandardMaterial {
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
  useEffect(() => {
    if (!t.textureUrl) return;
    let live = true;
    new TextureLoader().loadAsync(t.textureUrl).then((tex) => {
      if (!live) {
        tex.dispose();
        return;
      }
      tex.colorSpace = SRGBColorSpace;
      tex.flipY = true;
      material.map = tex;
      material.needsUpdate = true;
    });
    return () => {
      live = false;
      material.map?.dispose();
      material.map = null;
    };
  }, [t, material]);
  useEffect(() => () => material.dispose(), [material]);
  return material;
}

function AttachmentMesh({
  topology,
  geometry,
  visible,
}: {
  topology: AttachmentTopology;
  geometry: BufferGeometry;
  visible: boolean;
}) {
  const material = useAttachmentMaterial(topology);
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
  const groupRef = useRef<Group>(null);
  const clay = useMemo(
    () => new MeshStandardMaterial({ color: "#c9b8a8", roughness: 0.62, metalness: 0 }),
    [],
  );
  const geometries = useMemo(
    () =>
      ready
        ? {
            body: makeGeometry(ready.topology.body),
            attachments: ready.topology.attachments.map(makeGeometry),
          }
        : null,
    [ready],
  );
  const [shown, setShown] = useState(false);

  useEffect(
    () => () => {
      geometries?.body.dispose();
      for (const g of geometries?.attachments ?? []) g.dispose();
    },
    [geometries],
  );
  useEffect(() => () => clay.dispose(), [clay]);

  useEffect(() => {
    if (!geometries) return;
    let live = true;
    client.evaluate(recipe).then(
      (ev) => {
        if (!live) return;
        writeGeometry(geometries.body, ev);
        ev.attachments.forEach((a, i) => {
          const g = geometries.attachments[i];
          if (g) writeGeometry(g, a);
        });
        if (groupRef.current) groupRef.current.userData.groundOffset = ev.groundOffset;
        setShown(true);
        onEvaluated?.(ev);
      },
      (e: Error) => {
        if (live && e.name !== "AbortError") onError?.(e);
      },
    );
    return () => {
      live = false;
    };
  }, [client, geometries, recipe, onEvaluated, onError]);

  return (
    <group ref={groupRef} {...group}>
      {geometries && ready && (
        <>
          <mesh
            geometry={geometries.body}
            material={material ?? clay}
            visible={shown}
            castShadow
            receiveShadow
          />
          {ready.topology.attachments.map((t, i) => {
            const g = geometries.attachments[i];
            return g ? (
              <AttachmentMesh key={t.id} topology={t} geometry={g} visible={shown} />
            ) : null;
          })}
        </>
      )}
    </group>
  );
}
