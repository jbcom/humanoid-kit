/**
 * A portrait-studio stage for showing figures: a slightly warm key high and to
 * the front-left (casting the only shadow), a neutral fill front-right at about
 * 3.4:1, a rim light behind, a faint studio environment for reflections, and a
 * contact shadow on the floor.
 *
 * Fill and ambient are neutral on purpose: cool fill pushes deep skin toward
 * grey ("ashy"). Inside a `PresenceProvider` the contact shadow is the pooled
 * ground field of every published figure (presence is what tells the stage
 * where the figures stand); without one it falls back to drei's
 * `ContactShadows` around the origin. Render it with `STUDIO_TONE_MAPPING` and `STUDIO_EXPOSURE`.
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
import { useEffect, useMemo } from "react";
import { NeutralToneMapping, PMREMGenerator } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { groundOcclusion } from "../presence/presence.ts";
import { GroundContactMaterial } from "../render/groundContact.ts";
import { usePresenceContext } from "./presence.tsx";

/** The tone mapping the stage is validated with. */
export const STUDIO_TONE_MAPPING = NeutralToneMapping;
/** The exposure the stage is validated with. */
export const STUDIO_EXPOSURE = 1.15;

export interface StudioStageProps {
  /** Background colour; `null` leaves the canvas background alone. */
  background?: string | null;
  /** Scales every light together. */
  intensity?: number;
  /** Darkness of the contact shadow under the figures at its centre, 0 to 1. Default 0.5. */
  contactShadowOpacity?: number;
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
      // Leave alone an environment someone else set after us.
      if (scene.environment === target.texture) {
        scene.environment = previous.environment;
        scene.environmentIntensity = previous.intensity;
      }
      target.dispose();
    };
  }, [gl, scene]);
  // Re-applied whenever the environment above is rebuilt (same deps plus intensity).
  // biome-ignore lint/correctness/useExhaustiveDependencies: gl is a deliberate trigger: a new renderer rebuilds the environment, whose cleanup resets the intensity
  useEffect(() => {
    scene.environmentIntensity = intensity;
  }, [gl, scene, intensity]);
  return null;
}

/** Side of the square the pooled contact shadow is drawn on, metres: more than any studio shot sees. */
const GROUND_SIZE = 40;

/**
 * The contact shadow of every published figure as one field on the ground: the
 * strongest contact at each point (`groundOcclusion`, pooled with max in the
 * shader), so figures walking together share a shadow that separates as they
 * part and overlap never darkens twice. Redrawn each frame from the registry,
 * right after it ticks.
 */
function PooledContactShadows({ opacity }: { opacity: number }) {
  const presence = usePresenceContext();
  const material = useMemo(() => new GroundContactMaterial(), []);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(
    () =>
      presence?.afterTick((registry) => {
        material.setContacts(groundOcclusion(registry.all(), { strength: opacity }));
      }),
    [presence, material, opacity],
  );
  return (
    // Drawn before other transparent parts (eyes, hair): the ground is behind them all.
    <mesh rotation-x={-Math.PI / 2} position-y={0.0005} renderOrder={-1} material={material}>
      <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
    </mesh>
  );
}

export function StudioStage({
  background = "#1b2530",
  intensity = 1,
  contactShadowOpacity = 0.5,
}: StudioStageProps) {
  const pooled = usePresenceContext() !== null;
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
      {pooled ? (
        <PooledContactShadows opacity={contactShadowOpacity} />
      ) : (
        <ContactShadows
          position={[0, 0, 0]}
          opacity={contactShadowOpacity}
          scale={4}
          blur={2.4}
          far={1.5}
        />
      )}
    </>
  );
}
