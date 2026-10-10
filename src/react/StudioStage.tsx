/**
 * A portrait-studio stage for showing figures: a slightly warm key high and to
 * the front-left (casting the only shadow), a neutral fill front-right at about
 * 3.4:1, a rim light behind, a faint studio environment for reflections, and a
 * contact shadow on the floor.
 *
 * Inside a `PresenceProvider` the contact shadow is the pooled ground field of
 * every figure that publishes presence (presence is what tells the stage where
 * the figures stand), and only of those; without a provider it falls back to
 * drei's `ContactShadows` around the origin.
 *
 * The key's shadow is fitted to the figure and blurred to a skin-like penumbra
 * (`render/studioShadow.ts`): render with `shadows={STUDIO_SHADOWS}` on the canvas.
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
import { useEffect, useMemo, useRef } from "react";
import { type Mesh, NeutralToneMapping, PMREMGenerator } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { type ContactPoint, groundOcclusion } from "../presence/presence.ts";
import { GroundContactMaterial } from "../render/groundContact.ts";
import { configureKeyShadow } from "../render/studioShadow.ts";
import { usePresenceContext } from "./presence.tsx";

/** The tone mapping the stage is validated with. */
export const STUDIO_TONE_MAPPING = NeutralToneMapping;
/** The exposure the stage is validated with. */
export const STUDIO_EXPOSURE = 1.15;
export { STUDIO_SHADOWS } from "../render/studioShadow.ts";

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

/** How far the shadow quad floats above the stage's floor, so it does not fight the soles for depth. */
const SHADOW_LIFT = 0.0005;

/**
 * The contact shadow of every published figure as one field on the ground: the
 * strongest contact at each point (`groundOcclusion`, pooled with max in the
 * shader), so figures walking together share a shadow that separates as they
 * part and overlap never darkens twice. Redrawn each frame from the registry,
 * right after it ticks.
 *
 * The floor is the stage's own height (its parent's origin): a figure standing
 * on it casts fully, one raised or sunk casts less and none beyond 0.3 m, so a
 * figure on a platform does not shadow the floor below. The quad is resized
 * each frame to fit the contacts, wherever they are, and hidden when there are
 * none. The stage may be translated but not rotated or scaled.
 */
function PooledContactShadows({ opacity }: { opacity: number }) {
  const presence = usePresenceContext();
  const material = useMemo(() => new GroundContactMaterial(), []);
  const quad = useRef<Mesh>(null);
  const contacts = useRef<ContactPoint[]>([]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(
    () =>
      presence?.afterTick((registry) => {
        const mesh = quad.current;
        if (!mesh) return;
        mesh.updateWorldMatrix(true, false);
        const floorY = mesh.matrixWorld.elements[13] - SHADOW_LIFT;
        const list = groundOcclusion(
          registry.all(),
          { strength: opacity, floorY },
          contacts.current,
        );
        mesh.visible = list.length > 0;
        if (list.length === 0) return;
        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minZ = Number.POSITIVE_INFINITY;
        let maxZ = Number.NEGATIVE_INFINITY;
        for (let i = 0; i < list.length; i++) {
          const c = list[i] as ContactPoint;
          if (c.x - c.radius < minX) minX = c.x - c.radius;
          if (c.x + c.radius > maxX) maxX = c.x + c.radius;
          if (c.z - c.radius < minZ) minZ = c.z - c.radius;
          if (c.z + c.radius > maxZ) maxZ = c.z + c.radius;
        }
        // The quad lives in the stage's frame; the contacts are in the world's.
        const parent = mesh.parent?.matrixWorld.elements;
        mesh.position.set(
          (minX + maxX) / 2 - (parent?.[12] ?? 0),
          SHADOW_LIFT,
          (minZ + maxZ) / 2 - (parent?.[14] ?? 0),
        );
        const side = Math.max(maxX - minX, maxZ - minZ);
        mesh.scale.set(side, side, 1);
        material.setContacts(list);
      }),
    [presence, material, opacity],
  );
  return (
    // Drawn before other transparent parts (eyes, hair): the ground is behind them all.
    <mesh
      ref={quad}
      name="hk-ground-contact"
      rotation-x={-Math.PI / 2}
      position-y={SHADOW_LIFT}
      renderOrder={-1}
      material={material}
      visible={false}
    >
      <planeGeometry args={[1, 1]} />
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
        ref={(light) => {
          if (light) configureKeyShadow(light);
        }}
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
