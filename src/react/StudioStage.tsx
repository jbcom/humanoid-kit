/**
 * A portrait-studio stage for showing figures: a warm key light high and to
 * the front-left (casting the only shadow), a cool soft fill front-right, a rim
 * light behind, a faint studio environment for reflections, and a contact
 * shadow on the floor. Tuned for skin under three's neutral tone mapping.
 */
import { ContactShadows, Environment } from "@react-three/drei";

export interface StudioStageProps {
  /** Background colour; `null` leaves the canvas background alone. */
  background?: string | null;
  /** Scales every light together. */
  intensity?: number;
}

export function StudioStage({ background = "#1b2530", intensity = 1 }: StudioStageProps) {
  return (
    <>
      {background !== null && <color attach="background" args={[background]} />}
      <hemisphereLight args={["#e4ecf4", "#3a3028", 0.22 * intensity]} />
      <directionalLight
        position={[1.8, 3.2, 2.6]}
        intensity={2.4 * intensity}
        color="#fff6ef"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      <directionalLight position={[-2.6, 1.6, 2.2]} intensity={0.55 * intensity} color="#dfe9ff" />
      <directionalLight position={[-1.2, 2.4, -3]} intensity={1.6 * intensity} color="#ffffff" />
      <Environment preset="studio" environmentIntensity={0.22 * intensity} />
      <ContactShadows position={[0, 0, 0]} opacity={0.5} scale={4} blur={2.4} far={1.5} />
    </>
  );
}
