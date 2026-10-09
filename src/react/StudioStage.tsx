/**
 * A portrait-studio stage for showing figures: a slightly warm key high and to
 * the front-left (casting the only shadow), a neutral fill front-right at about
 * 3.4:1, a rim light behind, a faint studio environment for reflections, and a
 * contact shadow on the floor.
 *
 * Fill and ambient are neutral on purpose: cool fill pushes deep skin toward
 * grey ("ashy"). Render it with `STUDIO_TONE_MAPPING` and `STUDIO_EXPOSURE`.
 * They were chosen by measuring rendered faces against the measured albedo at
 * five melanin levels: Neutral keeps lightness, hue and chroma within a few
 * units with the same offset at every tone, while AgX lifted the deepest skin
 * by 9 L* and greyed it, flattening the range (docs/research/SKIN-RENDERING.md).
 *
 * The environment is three's procedural RoomEnvironment, generated on the GPU:
 * no file is downloaded, so the stage works offline, under strict content
 * security policies, and renders the same everywhere.
 */
import { ContactShadows } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { NeutralToneMapping, PMREMGenerator } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/** The tone mapping the stage is validated with. */
export const STUDIO_TONE_MAPPING = NeutralToneMapping;
/** The exposure the stage is validated with. */
export const STUDIO_EXPOSURE = 1.15;

export interface StudioStageProps {
  /** Background colour; `null` leaves the canvas background alone. */
  background?: string | null;
  /** Scales every light together. */
  intensity?: number;
}

/** Image-based lighting from a procedural studio room, prefiltered once. */
function RoomLighting({ intensity }: { intensity: number }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    const previous = { environment: scene.environment, intensity: scene.environmentIntensity };
    scene.environment = target.texture;
    return () => {
      scene.environment = previous.environment;
      scene.environmentIntensity = previous.intensity;
      target.dispose();
    };
  }, [gl, scene]);
  useEffect(() => {
    scene.environmentIntensity = intensity;
  }, [scene, intensity]);
  return null;
}

export function StudioStage({ background = "#1b2530", intensity = 1 }: StudioStageProps) {
  return (
    <>
      {background !== null && <color attach="background" args={[background]} />}
      <hemisphereLight args={["#eceeee", "#3a342e", 0.22 * intensity]} />
      <directionalLight
        position={[1.8, 3.2, 2.6]}
        intensity={2.4 * intensity}
        color="#fff6ef"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      <directionalLight position={[-2.6, 1.6, 2.2]} intensity={0.7 * intensity} color="#ffffff" />
      <directionalLight position={[-1.2, 2.4, -3]} intensity={1.6 * intensity} color="#ffffff" />
      <RoomLighting intensity={0.22 * intensity} />
      <ContactShadows position={[0, 0, 0]} opacity={0.5} scale={4} blur={2.4} far={1.5} />
    </>
  );
}
