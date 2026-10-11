/**
 * The renderer's clip at an aperture's rim (docs/ARCHITECTURE.md, "Affordances:
 * the registry", "Affordances: curved channels"): what has passed into a
 * channel is not drawn. A figure eats an apple and the bite dissolves past its
 * lips; an earbud's stem vanishes into the canal, round its bends; a finger is
 * hidden past a nostril's rim. The body draws no inside to its openings, so
 * without the clip whatever entered would show through the skin.
 *
 * A `ChannelClip` holds a figure's channels (`affordanceChannels`) in world
 * space, their sections in a small float texture, and `clipMaterial` patches
 * any material of the objects that may enter them (never the figure's own) to
 * discard each fragment that `placeIn` would put inside one: between two of
 * its section planes, within the ellipse there. The test is per fragment, so a
 * mesh is cut exactly at the rim and where it leaves the channel's wall.
 *
 * A figure's channels are in the space its meshes are drawn in: the group
 * `<Humanoid>` lifts them in (the figure's own space, standing on its ground),
 * whose `matrixWorld` carries them to world space. A clip that `follow`s that
 * group reads its `matrixWorld` as each patched material is drawn, so the
 * channels move with the figure on the frame it moves.
 */
import {
  DataTexture,
  FloatType,
  type Material,
  Matrix4,
  NearestFilter,
  type Object3D,
  RGBAFormat,
  Vector3,
  Vector4,
  type WebGLProgramParametersWithUniforms,
} from "three";
import { CHANNEL_SECTIONS, type Channel, type ChannelSection } from "../affordance/channel.ts";

/** The most channels one clip holds: a figure's head has five (mouth, nostrils, ear canals). */
export const CLIP_CHANNELS = 8;

/** Texels a section takes in the clip's texture: its centre and depth, normal, across and half-size, up and half-size. */
const TEXELS = 4;
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
  private readonly v = new Vector3();
  /** Whether the uniforms are out of step with what is held. */
  private stale = true;
  /** Each channel's sections, a row each (`TEXELS` texels a section), in world space. */
  private readonly data = new Float32Array(CLIP_CHANNELS * CHANNEL_SECTIONS * TEXELS * 4);
  private readonly texture = new DataTexture(
    this.data,
    CHANNEL_SECTIONS * TEXELS,
    CLIP_CHANNELS,
    RGBAFormat,
    FloatType,
  );

  /** The shader's uniforms, shared by every material the clip patches. */
  readonly uniforms = {
    hkClipCount: { value: 0 },
    /** Each channel's bounding sphere in world space (centre, radius): nothing outside it is inside the channel. */
    hkClipBound: { value: Array.from({ length: CLIP_CHANNELS }, () => new Vector4()) },
    /** The sections (`Channel.sections`), a row a channel: `TEXELS` RGBA texels a section. */
    hkClipSections: { value: this.texture },
  };

  constructor() {
    this.texture.minFilter = NearestFilter;
    this.texture.magFilter = NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
  }

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
      if (c.sections.length !== CHANNEL_SECTIONS)
        throw new RangeError(`channel clip: a channel has ${CHANNEL_SECTIONS} sections`);
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

  /**
   * Channel `c`'s section `s` as the shader reads it, in world space: its
   * centre and half-sizes. For checking what the clip holds.
   */
  sectionOf(c: number, s: number): { centre: Vector3; halfAcross: number; halfUp: number } {
    const o = (c * CHANNEL_SECTIONS + s) * TEXELS * 4;
    const d = this.data;
    return {
      centre: new Vector3(d[o], d[o + 1], d[o + 2]),
      halfAcross: d[o + 11] as number,
      halfUp: d[o + 15] as number,
    };
  }

  /** Releases the clip's texture. */
  dispose(): void {
    this.texture.dispose();
  }

  /** Writes the channels held to the texture and uniforms, in world space by `toWorld`. */
  private write(toWorld: Matrix4): void {
    const linear = this.linear.extractRotation(toWorld);
    const scale = this.scale.setFromMatrixScale(toWorld);
    if (
      Math.abs(scale.x - scale.y) > 1e-6 * scale.x ||
      Math.abs(scale.x - scale.z) > 1e-6 * scale.x
    )
      throw new RangeError("channel clip: a figure's transform must scale evenly");
    const s = scale.x;
    const data = this.data;
    const v = this.v;
    this.held.forEach((c, i) => {
      const row = i * CHANNEL_SECTIONS * TEXELS * 4;
      // The bounding sphere: round the sections' centres, as far as the widest
      // cross-section and a whole segment beyond, so it never culls an inside point.
      let lx = Number.POSITIVE_INFINITY;
      let ly = Number.POSITIVE_INFINITY;
      let lz = Number.POSITIVE_INFINITY;
      let hx = Number.NEGATIVE_INFINITY;
      let hy = Number.NEGATIVE_INFINITY;
      let hz = Number.NEGATIVE_INFINITY;
      let widest = 0;
      let longest = 0;
      c.sections.forEach((section: ChannelSection, k) => {
        const o = row + k * TEXELS * 4;
        v.set(section.centre[0], section.centre[1], section.centre[2]).applyMatrix4(toWorld);
        data[o] = v.x;
        data[o + 1] = v.y;
        data[o + 2] = v.z;
        data[o + 3] = section.depth * s;
        lx = Math.min(lx, v.x);
        ly = Math.min(ly, v.y);
        lz = Math.min(lz, v.z);
        hx = Math.max(hx, v.x);
        hy = Math.max(hy, v.y);
        hz = Math.max(hz, v.z);
        this.direction(section.normal, linear, data, o + 4, 0);
        this.direction(section.across, linear, data, o + 8, section.halfAcross * s);
        this.direction(section.up, linear, data, o + 12, section.halfUp * s);
        widest = Math.max(widest, section.halfAcross * s, section.halfUp * s);
        if (k > 0) {
          const prev = c.sections[k - 1] as ChannelSection;
          longest = Math.max(longest, (section.depth - prev.depth) * s);
        }
      });
      const bx = (lx + hx) / 2;
      const by = (ly + hy) / 2;
      const bz = (lz + hz) / 2;
      (this.uniforms.hkClipBound.value[i] as Vector4).set(
        bx,
        by,
        bz,
        Math.hypot(hx - bx, hy - by, hz - bz) + widest * Math.SQRT2 + longest,
      );
    });
    this.uniforms.hkClipCount.value = this.held.length;
    this.texture.needsUpdate = true;
    this.written.copy(toWorld);
    this.stale = false;
  }

  /** Writes direction `d` turned by `linear` and `w` into the texture at `o`. */
  private direction(
    d: readonly [number, number, number],
    linear: Matrix4,
    data: Float32Array,
    o: number,
    w: number,
  ): void {
    const v = this.v.set(d[0], d[1], d[2]).applyMatrix4(linear);
    data[o] = v.x;
    data[o + 1] = v.y;
    data[o + 2] = v.z;
    data[o + 3] = w;
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
uniform vec4 hkClipBound[ ${CLIP_CHANNELS} ];
uniform highp sampler2D hkClipSections;
vec4 hkClipTexel( int c, int s, int k ) {
	return texelFetch( hkClipSections, ivec2( s * ${TEXELS} + k, c ), 0 );
}
float hkClipAlong( vec3 a, vec3 b, float t, vec3 o ) {
	vec3 axis = mix( a, b, t );
	return dot( o, axis ) / length( axis );
}
bool hkInChannel( int c, vec3 p ) {
	vec4 bound = hkClipBound[ c ];
	if ( distance( p, bound.xyz ) > bound.w ) return false;
	vec4 a0 = hkClipTexel( c, 0, 0 );
	vec4 a1 = hkClipTexel( c, 0, 1 );
	float f0 = dot( a1.xyz, p - a0.xyz );
	if ( f0 < 0.0 ) return false;
	for ( int s = 1; s < ${CHANNEL_SECTIONS}; s ++ ) {
		vec4 b0 = hkClipTexel( c, s, 0 );
		vec4 b1 = hkClipTexel( c, s, 1 );
		float f1 = dot( b1.xyz, p - b0.xyz );
		if ( f0 >= 0.0 && f1 <= 0.0 ) {
			float t = f0 - f1 != 0.0 ? f0 / ( f0 - f1 ) : f0;
			vec4 a2 = hkClipTexel( c, s - 1, 2 );
			vec4 a3 = hkClipTexel( c, s - 1, 3 );
			vec4 b2 = hkClipTexel( c, s, 2 );
			vec4 b3 = hkClipTexel( c, s, 3 );
			vec2 h = vec2( mix( a2.w, b2.w, t ), mix( a3.w, b3.w, t ) );
			if ( h.x > 0.0 && h.y > 0.0 ) {
				vec3 o = p - mix( a0.xyz, b0.xyz, t );
				float x = hkClipAlong( a2.xyz, b2.xyz, t, o ) / h.x;
				float y = hkClipAlong( a3.xyz, b3.xyz, t, o ) / h.y;
				if ( x * x + y * y <= 1.0 ) return true;
			}
		}
		f0 = f1;
		a0 = b0;
	}
	return false;
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
  material.customProgramCacheKey = () => `${key()}|humanoid-kit-channel-clip-2`;
  material.needsUpdate = true;
  return material;
}
