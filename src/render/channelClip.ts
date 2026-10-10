/**
 * The renderer's clip at an aperture's rim (docs/ARCHITECTURE.md, "Affordances:
 * the registry"): what has passed into a channel is not drawn. A figure eats
 * an apple and the bite dissolves past its lips; an earbud's stem vanishes
 * into the canal; a finger is hidden past a nostril's rim. The body draws no
 * inside to its openings, so without the clip whatever entered would show
 * through the skin.
 *
 * A `ChannelClip` holds a figure's channels (`affordanceChannels`) as uniforms
 * in world space, and `clipMaterial` patches any material of the objects that
 * may enter them (never the figure's own) to discard each fragment that
 * `placeIn` would put inside one: past the rim, short of the end, within the
 * cross-section there. The test is per fragment, so a mesh is cut exactly at
 * the rim and where it leaves the channel's wall.
 *
 * A figure's channels are in the space its meshes are drawn in: the group
 * `<Humanoid>` lifts them in (the figure's own space, standing on its ground),
 * whose `matrixWorld` carries them to world space. A clip that `follow`s that
 * group reads its `matrixWorld` as each patched material is drawn, so the
 * channels move with the figure on the frame it moves.
 */
import {
  type Material,
  Matrix4,
  type Object3D,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from "three";
import { CHANNEL_KNOTS, type Channel } from "../affordance/channel.ts";

/** The most channels one clip holds: a figure's head has five (mouth, nostrils, ear canals). */
export const CLIP_CHANNELS = 8;

const vectors = (n: number) => Array.from({ length: n }, () => new Vector3());
const IDENTITY = new Matrix4();

/** A figure's channels, in world space, for the clip's shaders. */
export class ChannelClip {
  /** The channels held, in the figure's own space. */
  private held: readonly Channel[] = [];
  /** The object whose `matrixWorld` carries them to world space, once followed. */
  private followed: Object3D | null = null;
  /** The transform the uniforms were last written with. */
  private readonly written = new Matrix4();
  private readonly linear = new Matrix4();
  private readonly scale = new Vector3();
  /** Whether the uniforms are out of step with what is held. */
  private stale = true;

  /** The shader's uniforms, shared by every material the clip patches. */
  readonly uniforms = {
    hkClipCount: { value: 0 },
    hkClipOrigin: { value: vectors(CLIP_CHANNELS) },
    hkClipInward: { value: vectors(CLIP_CHANNELS) },
    hkClipAcross: { value: vectors(CLIP_CHANNELS) },
    hkClipUp: { value: vectors(CLIP_CHANNELS) },
    /** Each channel's knots (`Channel.knots`), `CHANNEL_KNOTS` a channel, the last repeated to fill. */
    hkClipKnot: { value: vectors(CLIP_CHANNELS * CHANNEL_KNOTS) },
  };

  /**
   * Holds `channels`, given in the figure's own space (the space its meshes
   * are drawn in: the group `<Humanoid>` lifts them in) and carried to world
   * space by `toWorld`: that group's `matrixWorld`, or, once the clip follows
   * an object (`follow`), that object's, read as each patched material is
   * drawn. Call it whenever the figure poses or opens a channel; without
   * `follow`, whenever it moves too. A transform with a scale scales the
   * channel with it.
   */
  set(channels: readonly Channel[], toWorld?: Matrix4): void {
    if (channels.length > CLIP_CHANNELS)
      throw new RangeError(
        `channel clip: at most ${CLIP_CHANNELS} channels, not ${channels.length}`,
      );
    for (const c of channels)
      if (c.knots.length < 2 || c.knots.length > CHANNEL_KNOTS)
        throw new RangeError(`channel clip: a channel has 2 to ${CHANNEL_KNOTS} knots`);
    this.held = channels;
    this.stale = true;
    this.write(toWorld ?? this.followed?.matrixWorld ?? IDENTITY);
  }

  /**
   * Carries the channels held to world space by `object`'s `matrixWorld`
   * whenever a patched material is drawn from now on (null: no longer), so
   * the clip moves with the figure without being set again. Follow the group
   * the figure's meshes are lifted in (`useHumanoidAffordances` does).
   */
  follow(object: Object3D | null): void {
    this.followed = object;
    this.stale = true;
  }

  /**
   * Brings the uniforms up to date with the object followed, if it has moved
   * since they were written. The patched materials call it as they are drawn;
   * it allocates nothing.
   */
  refresh(): void {
    const o = this.followed;
    if (!o) return;
    // A followed object outside the scene drawn is not brought up to date by the render.
    o.updateWorldMatrix(true, false);
    if (!this.stale && this.written.equals(o.matrixWorld)) return;
    this.write(o.matrixWorld);
  }

  /** Writes the channels held to the uniforms, in world space by `toWorld`. */
  private write(toWorld: Matrix4): void {
    const u = this.uniforms;
    const linear = this.linear.extractRotation(toWorld);
    const scale = this.scale.setFromMatrixScale(toWorld);
    if (
      Math.abs(scale.x - scale.y) > 1e-6 * scale.x ||
      Math.abs(scale.x - scale.z) > 1e-6 * scale.x
    )
      throw new RangeError("channel clip: a figure's transform must scale evenly");
    this.held.forEach((c, i) => {
      (u.hkClipOrigin.value[i] as Vector3)
        .set(c.origin[0], c.origin[1], c.origin[2])
        .applyMatrix4(toWorld);
      (u.hkClipInward.value[i] as Vector3)
        .set(c.inward[0], c.inward[1], c.inward[2])
        .applyMatrix4(linear);
      (u.hkClipAcross.value[i] as Vector3)
        .set(c.across[0], c.across[1], c.across[2])
        .applyMatrix4(linear);
      (u.hkClipUp.value[i] as Vector3).set(c.up[0], c.up[1], c.up[2]).applyMatrix4(linear);
      for (let k = 0; k < CHANNEL_KNOTS; k++) {
        const knot = c.knots[Math.min(k, c.knots.length - 1)] as readonly [number, number, number];
        (u.hkClipKnot.value[i * CHANNEL_KNOTS + k] as Vector3)
          .set(knot[0], knot[1], knot[2])
          .multiplyScalar(scale.x);
      }
    });
    u.hkClipCount.value = this.held.length;
    this.written.copy(toWorld);
    this.stale = false;
  }

  /** Patches a material's shader (in its `onBeforeCompile`) to discard what lies inside the clip's channels. */
  patch(shader: WebGLProgramParametersWithUniforms): void {
    for (const chunk of ["#include <project_vertex>", "#include <clipping_planes_fragment>"])
      if (!(shader.vertexShader + shader.fragmentShader).includes(chunk))
        throw new Error(`channel clip: three's ${chunk} chunk moved`);
    Object.assign(shader.uniforms, this.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vHkClipWorld;")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
	vHkClipWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${CLIP_GLSL}`)
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
	for ( int c = 0; c < ${CLIP_CHANNELS}; c ++ ) {
		if ( c >= hkClipCount ) break;
		if ( hkInChannel( c, vHkClipWorld ) ) discard;
	}`,
      );
  }
}

/** The fragment side: `placeIn` (src/affordance/channel.ts) for channel `c`. */
const CLIP_GLSL = `varying vec3 vHkClipWorld;
uniform int hkClipCount;
uniform vec3 hkClipOrigin[ ${CLIP_CHANNELS} ];
uniform vec3 hkClipInward[ ${CLIP_CHANNELS} ];
uniform vec3 hkClipAcross[ ${CLIP_CHANNELS} ];
uniform vec3 hkClipUp[ ${CLIP_CHANNELS} ];
uniform vec3 hkClipKnot[ ${CLIP_CHANNELS * CHANNEL_KNOTS} ];
bool hkInChannel( int c, vec3 p ) {
	vec3 o = p - hkClipOrigin[ c ];
	float d = dot( o, hkClipInward[ c ] );
	if ( d < 0.0 || d > hkClipKnot[ c * ${CHANNEL_KNOTS} + ${CHANNEL_KNOTS - 1} ].x ) return false;
	vec2 h = hkClipKnot[ c * ${CHANNEL_KNOTS} + ${CHANNEL_KNOTS - 1} ].yz;
	for ( int k = 1; k < ${CHANNEL_KNOTS}; k ++ ) {
		vec3 k0 = hkClipKnot[ c * ${CHANNEL_KNOTS} + k - 1 ];
		vec3 k1 = hkClipKnot[ c * ${CHANNEL_KNOTS} + k ];
		if ( d <= k1.x ) {
			h = mix( k0.yz, k1.yz, ( d - k0.x ) / max( k1.x - k0.x, 1e-9 ) );
			break;
		}
	}
	if ( h.x <= 0.0 || h.y <= 0.0 ) return false;
	float x = dot( o, hkClipAcross[ c ] ) / h.x;
	float y = dot( o, hkClipUp[ c ] ) / h.y;
	return x * x + y * y <= 1.0;
}`;

/**
 * Has `material` discard what lies inside `clip`'s channels, keeping any
 * `onBeforeCompile` and `onBeforeRender` it already has; as it is drawn, it
 * brings a clip that follows its figure up to date (`ChannelClip.refresh`).
 * Returns the material.
 */
export function clipMaterial<M extends Material>(material: M, clip: ChannelClip): M {
  const before = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    clip.patch(shader);
  };
  const drawing = material.onBeforeRender.bind(material);
  material.onBeforeRender = (renderer, scene, camera, geometry, object, group) => {
    drawing(renderer, scene, camera, geometry, object, group);
    clip.refresh();
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${key()}|humanoid-kit-channel-clip-1`;
  material.needsUpdate = true;
  return material;
}
