/**
 * The renderer's clip at an aperture's rim (docs/ARCHITECTURE.md, "Affordances:
 * the registry"): what has passed into a channel is not drawn. A figure eats
 * an apple and the bite dissolves past its lips; an earbud's stem vanishes
 * into the canal; a finger is hidden past a nostril's rim. The body draws no
 * inside to its openings, so without the clip whatever entered would show
 * through the skin.
 *
 * A `ChannelClip` holds a figure's channels (`affordanceChannels`) in world
 * space as uniforms, and `clipMaterial` patches any material of the objects
 * that may enter them (never the figure's own) to discard each fragment that
 * `placeIn` would put inside one: past the rim, short of the end, within the
 * cross-section there. The test is per fragment, so a mesh is cut exactly at
 * the rim and where it leaves the channel's wall.
 */
import { type Material, Matrix4, Vector3, type WebGLProgramParametersWithUniforms } from "three";
import { CHANNEL_KNOTS, type Channel } from "../affordance/channel.ts";

/** The most channels one clip holds: a figure's head has five (mouth, nostrils, ear canals). */
export const CLIP_CHANNELS = 8;

const vectors = (n: number) => Array.from({ length: n }, () => new Vector3());

/** A figure's channels, in world space, for the clip's shaders. */
export class ChannelClip {
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
   * Holds `channels`, given in the figure's own space (its posed body's) and
   * carried to world space by `toWorld` (the figure's `matrixWorld`). Call it
   * whenever the figure moves, poses or opens a channel. A transform with a
   * scale scales the channel with it.
   */
  set(channels: readonly Channel[], toWorld: Matrix4 = new Matrix4()): void {
    if (channels.length > CLIP_CHANNELS)
      throw new RangeError(
        `channel clip: at most ${CLIP_CHANNELS} channels, not ${channels.length}`,
      );
    const u = this.uniforms;
    const linear = new Matrix4().extractRotation(toWorld);
    const scale = new Vector3().setFromMatrixScale(toWorld);
    if (
      Math.abs(scale.x - scale.y) > 1e-6 * scale.x ||
      Math.abs(scale.x - scale.z) > 1e-6 * scale.x
    )
      throw new RangeError("channel clip: a figure's transform must scale evenly");
    channels.forEach((c, i) => {
      (u.hkClipOrigin.value[i] as Vector3).set(...c.origin).applyMatrix4(toWorld);
      (u.hkClipInward.value[i] as Vector3).set(...c.inward).applyMatrix4(linear);
      (u.hkClipAcross.value[i] as Vector3).set(...c.across).applyMatrix4(linear);
      (u.hkClipUp.value[i] as Vector3).set(...c.up).applyMatrix4(linear);
      if (c.knots.length < 2 || c.knots.length > CHANNEL_KNOTS)
        throw new RangeError(`channel clip: a channel has 2 to ${CHANNEL_KNOTS} knots`);
      for (let k = 0; k < CHANNEL_KNOTS; k++) {
        const knot = c.knots[Math.min(k, c.knots.length - 1)] as readonly [number, number, number];
        (u.hkClipKnot.value[i * CHANNEL_KNOTS + k] as Vector3).set(...knot).multiplyScalar(scale.x);
      }
    });
    u.hkClipCount.value = channels.length;
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
 * `onBeforeCompile` it already has. Returns the material.
 */
export function clipMaterial<M extends Material>(material: M, clip: ChannelClip): M {
  const before = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    clip.patch(shader);
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${key()}|humanoid-kit-channel-clip-1`;
  material.needsUpdate = true;
  return material;
}
