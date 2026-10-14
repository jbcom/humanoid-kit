/**
 * Test-only R3F surface viewer for issue #117. Playwright supplies an exact
 * CPU-skinned fixture before this route starts; this canvas only renders those
 * immutable positions, normals, indices and contact markers.
 */
import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { STUDIO_EXPOSURE, STUDIO_TONE_MAPPING, StudioStage } from "humanoid-kit/react";
import { useEffect, useMemo, useState } from "react";
import { ArrowHelper, BufferAttribute, BufferGeometry, Color, DoubleSide, Vector3 } from "three";

type V3 = [number, number, number];

export interface SelfContactFixture {
  positions: number[];
  normals: number[];
  index: number[];
  target: V3;
  anchor: V3;
  /** Stable `palm.X` centre; broad support remains separately marked. */
  centre?: V3;
  normal: V3;
  receipt: {
    id: string;
    source: string;
    label: string;
    status: "reached" | "unreached";
    reason?: string;
    gap: number;
    collision: number;
    anchor:
      | { kind: "finger-pad" }
      | {
          kind: "volar-palm";
          vertex: number;
          centreVertex: number;
          centreToContact: V3;
        };
  };
}

declare global {
  interface Window {
    /** Test-owned solved source mesh, installed with Playwright addInitScript. */
    hkSelfContactFixture?: SelfContactFixture;
    hkSelfContact?: () => SelfContactFixture["receipt"] | null;
  }
}

function ContactCamera({ target }: { target: V3 }) {
  const { camera, controls } = useThree();
  useEffect(() => {
    const at = new Vector3(...target);
    camera.position.copy(at).add(new Vector3(0.72, 0.3, 0.9).normalize().multiplyScalar(0.72));
    camera.lookAt(at);
    const orbit = controls as { target: Vector3; update(): void } | null;
    orbit?.target.copy(at);
    orbit?.update();
  }, [camera, controls, target]);
  return null;
}

function ContactMarkers({
  anchor,
  centre,
  normal,
  site,
}: {
  anchor: V3;
  centre?: V3;
  normal: V3;
  site: V3;
}) {
  const arrow = useMemo(
    () =>
      new ArrowHelper(
        new Vector3(...normal).normalize(),
        new Vector3(...anchor).addScaledVector(new Vector3(...normal).normalize(), -0.08),
        0.08,
        0x48d8ff,
        0.018,
        0.01,
      ),
    [anchor, normal],
  );
  return (
    <>
      <mesh position={anchor}>
        <sphereGeometry args={[0.012, 16, 12]} />
        <meshBasicMaterial color="#ff3ba7" />
      </mesh>
      {centre && (
        <mesh position={centre}>
          <sphereGeometry args={[0.008, 16, 12]} />
          <meshBasicMaterial color="#9b5cff" />
        </mesh>
      )}
      <mesh position={site}>
        <sphereGeometry args={[0.01, 16, 12]} />
        <meshBasicMaterial color="#ffd43b" />
      </mesh>
      <primitive object={arrow} />
    </>
  );
}

export function SelfContactLab() {
  const [fixture] = useState(() => window.hkSelfContactFixture);
  useEffect(() => {
    window.hkSelfContact = () => fixture?.receipt ?? null;
    return () => {
      delete window.hkSelfContact;
    };
  }, [fixture]);
  const geometry = useMemo(() => {
    if (!fixture) return null;
    const out = new BufferGeometry();
    out.setAttribute("position", new BufferAttribute(Float32Array.from(fixture.positions), 3));
    out.setAttribute("normal", new BufferAttribute(Float32Array.from(fixture.normals), 3));
    out.setIndex(new BufferAttribute(Uint32Array.from(fixture.index), 1));
    return out;
  }, [fixture]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!fixture || !geometry)
    return <pre data-figure="error">self-contact fixture was not installed</pre>;
  return (
    <div style={{ position: "absolute", inset: 0 }} data-figure="ready">
      <Canvas
        shadows={false}
        camera={{ position: [0, 1, 2], fov: 35 }}
        gl={{
          preserveDrawingBuffer: true,
          toneMapping: STUDIO_TONE_MAPPING,
          toneMappingExposure: STUDIO_EXPOSURE,
        }}
      >
        <StudioStage />
        <ContactCamera target={fixture.target} />
        <mesh geometry={geometry}>
          <meshPhysicalMaterial
            color={new Color(0.64, 0.42, 0.3)}
            roughness={0.6}
            side={DoubleSide}
          />
        </mesh>
        <ContactMarkers
          anchor={fixture.anchor}
          normal={fixture.normal}
          site={fixture.target}
          {...(fixture.centre && { centre: fixture.centre })}
        />
        <OrbitControls makeDefault enablePan={false} />
      </Canvas>
    </div>
  );
}
