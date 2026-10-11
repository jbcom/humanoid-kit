import { createPortal, useFrame, useThree } from "@react-three/fiber";
import { CHANNEL_SECTIONS } from "humanoid-kit";
import { clipMaterial, type HumanoidAffordances } from "humanoid-kit/react";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  type Group,
  type Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Plane,
  Quaternion,
  Vector3,
} from "three";

/** Points round each section of a drawn channel. */
const RING = 24;

/** Each aperture's colour when its channel is drawn. */
const COLOURS: Record<string, number> = {
  mouth: 0xff5a36,
  "nostril.L": 0x3fb6ff,
  "nostril.R": 0x3fb6ff,
  "ear-canal.L": 0x7cff4f,
  "ear-canal.R": 0x7cff4f,
};

/** The group the figure's meshes are lifted in, once drawn. */
function useLifted(of: HumanoidAffordances): Group | null {
  const subscribe = useCallback((changed: () => void) => of.subscribe(changed), [of]);
  return useSyncExternalStore(
    subscribe,
    () => of.lifted as Group | null,
    () => of.lifted as Group | null,
  );
}

/** A tube over one aperture's channel, along its sections, redrawn each frame. */
function ChannelTube({ of, id, xray }: { of: HumanoidAffordances; id: string; xray: boolean }) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(CHANNEL_SECTIONS * RING * 3), 3),
    );
    const index: number[] = [];
    for (let s = 0; s + 1 < CHANNEL_SECTIONS; s++)
      for (let j = 0; j < RING; j++) {
        const a = s * RING + j;
        const b = s * RING + ((j + 1) % RING);
        index.push(a, b, a + RING, b, b + RING, a + RING);
      }
    g.setIndex(index);
    return g;
  }, []);
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        color: COLOURS[id] ?? 0xffffff,
        transparent: true,
        opacity: xray ? 0.55 : 0.85,
        depthTest: !xray,
        depthWrite: !xray,
        side: 2,
      }),
    [id, xray],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  const mesh = useRef<Mesh>(null);
  useFrame(() => {
    const c = of.has(id) ? of.channel(id) : null;
    if (mesh.current) mesh.current.visible = c !== null;
    if (!c) return;
    const p = geometry.getAttribute("position") as BufferAttribute;
    c.sections.forEach((s, k) => {
      // A closed channel is drawn as a thin slit, so its path still shows.
      const ha = Math.max(s.halfAcross, 0.0005);
      const hu = Math.max(s.halfUp, 0.0005);
      for (let j = 0; j < RING; j++) {
        const t = (2 * Math.PI * j) / RING;
        const ca = Math.cos(t) * ha;
        const su = Math.sin(t) * hu;
        p.setXYZ(
          k * RING + j,
          s.centre[0] + s.across[0] * ca + s.up[0] * su,
          s.centre[1] + s.across[1] * ca + s.up[1] * su,
          s.centre[2] + s.across[2] * ca + s.up[2] * su,
        );
      }
    });
    p.needsUpdate = true;
    geometry.computeBoundingSphere();
  });
  return <mesh ref={mesh} geometry={geometry} material={material} renderOrder={10} />;
}

/**
 * A straight rod pushed into an aperture along its rim's inward direction, from
 * `outside` metres in front of the rim to `length` metres in, drawn with the
 * figure's clip: what lies inside the channel is not drawn.
 */
function Probe({
  of,
  id,
  length,
  radius,
}: {
  of: HumanoidAffordances;
  id: string;
  length: number;
  radius: number;
}) {
  const outside = 0.012;
  const geometry = useMemo(
    () =>
      new CylinderGeometry(radius, radius, length + outside, 20).translate(
        0,
        (length - outside) / 2,
        0,
      ),
    [length, radius],
  );
  const material = useMemo(
    () => clipMaterial(new MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.4 }), of.clip),
    [of],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  const mesh = useRef<Mesh>(null);
  const turn = useMemo(
    () => ({ q: new Quaternion(), y: new Vector3(0, 1, 0), v: new Vector3() }),
    [],
  );
  useFrame(() => {
    const m = mesh.current;
    const c = of.has(id) ? of.channel(id) : null;
    if (!m) return;
    m.visible = c !== null;
    if (!c) return;
    m.position.set(c.origin[0], c.origin[1], c.origin[2]);
    m.quaternion.copy(
      turn.q.setFromUnitVectors(turn.y, turn.v.set(c.inward[0], c.inward[1], c.inward[2])),
    );
  });
  return <mesh ref={mesh} geometry={geometry} material={material} />;
}

/**
 * Cuts the whole scene by a plane through an affordance's rim, as the figure is
 * drawn: what lies on the side `normal` points away from is cut away.
 */
function Cut({ of, id, normal }: { of: HumanoidAffordances; id: string; normal: Vector3 }) {
  const gl = useThree((s) => s.gl);
  const plane = useMemo(() => new Plane(), []);
  useEffect(() => {
    gl.clippingPlanes = [plane];
    return () => {
      gl.clippingPlanes = [];
    };
  }, [gl, plane]);
  const at = useMemo(() => new Vector3(), []);
  useFrame(() => {
    const f = of.has(id) ? of.frame(id, "world") : null;
    if (f) plane.setFromNormalAndCoplanarPoint(normal, at.set(...f.position));
  });
  return null;
}

/**
 * The QA shot's view of the affordances' channels, for review sheets:
 * `?channels` draws each aperture's channel as a tube seen through the skin
 * (`?channels=solid`: hidden by it, for a cut view); `?probe=<id>:<length>:<radius>`
 * pushes a straight rod into an aperture, drawn with the figure's clip;
 * `?cut=<id>:nx,ny,nz` cuts the scene by a plane through an affordance's rim,
 * keeping the side its normal points to; `?open=<0..1>` opens the mouth;
 * `?hold` tells the probed aperture it holds the probe (its occupancy).
 */
export function ChannelQa({ of, params }: { of: HumanoidAffordances; params: URLSearchParams }) {
  const lifted = useLifted(of);
  const channels = params.get("channels");
  const probe = params.get("probe")?.split(":");
  const [cutAt, cutNormal] = params.get("cut")?.split(":") ?? [];
  const normal = useMemo(() => {
    const n = cutNormal?.split(",").map(Number);
    return n?.length === 3 && n.every(Number.isFinite)
      ? new Vector3(n[0], n[1], n[2]).normalize()
      : null;
  }, [cutNormal]);
  const open = Number(params.get("open") ?? Number.NaN);
  const hold = params.has("hold");
  // The mouth opens once the figure has one (its affordances follow its recipe), and with
  // `?hold` the probed aperture is told it holds the probe.
  useFrame(() => {
    if (Number.isFinite(open) && of.has("mouth")) {
      const state = of.get("mouth");
      if (state.kind === "aperture" && state.opening !== open) of.set("mouth", { opening: open });
    }
    const id = probe?.[0];
    if (!hold || !id || !of.has(id)) return;
    const state = of.get(id);
    if (state.kind === "aperture" && !state.occupancy)
      of.set(id, {
        occupancy: { depth: Number(probe[1] ?? 0.03), radius: Number(probe[2] ?? 0.002) },
      });
  });
  const ids = ["mouth", "nostril.L", "nostril.R", "ear-canal.L", "ear-canal.R"];
  return (
    <>
      {cutAt && normal && <Cut of={of} id={cutAt} normal={normal} />}
      {lifted &&
        createPortal(
          <>
            {channels !== null &&
              ids.map((id) => <ChannelTube key={id} of={of} id={id} xray={channels !== "solid"} />)}
            {probe?.[0] && (
              <Probe
                of={of}
                id={probe[0]}
                length={Number(probe[1] ?? 0.03)}
                radius={Number(probe[2] ?? 0.002)}
              />
            )}
          </>,
          lifted,
        )}
    </>
  );
}
