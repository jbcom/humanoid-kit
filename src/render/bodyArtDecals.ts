/**
 * A figure's decals (docs/ARCHITECTURE.md, "Body art"): its tattoos and naevi.
 * The body-art texture's texels are 1-2 mm on the skin (a forearm, a brow) at
 * its size: baked into them, a tattoo's line work pixelates and a naevus a
 * few millimetres across is a blur a few texels square. Instead the bake
 * stores where each texel lies in the decal that covers it, and the skin
 * shader draws the decal there at the resolution the screen asks for: a
 * tattoo from its own image, mipmapped; a naevus as a round, slightly raised
 * dot, exactly. Three textures:
 *
 * - the decal coordinates (half-float array, a page per decal layer): per
 *   texel the point's place in its decal, centred (s - 0.5, t - 0.5), the
 *   decal's index + 1 (0 where none) and how fully the skin takes it (its
 *   density times the frame's fade). A coordinate is affine over each of the
 *   body's triangles, so the shader's bilinear blend of four texels is exact
 *   inside one; texels round each UV island are extrapolated linearly from
 *   the two nearest inside, so it stays exact up to the island's edge;
 * - the images (an sRGB array, mipmapped), one page per image the tattoos
 *   name, premultiplied so their mipmaps carry no dark fringe;
 * - a table, per decal: a tattoo's image page and its ink spread in (s, t),
 *   or a naevus's edge.
 *
 * Decals that overlap (`decalLayers`) are drawn on separate decal layers,
 * the later above, so the shader composites one over the other.
 */
import {
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  type Mesh,
  NearestFilter,
  NoBlending,
  type OrthographicCamera,
  RawShaderMaterial,
  RGBAFormat,
  type Scene,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
  Vector2,
  WebGLArrayRenderTarget,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import type { DecalFrame, PlacedMark, PlacedTattoo } from "../bodyArt/decals.ts";
import { INK_DEPTH } from "../bodyArt/ink.ts";
import { NAEVUS_EDGE, NAEVUS_MELANIN, NAEVUS_RAISE, SCAR_RAISE } from "../bodyArt/marks.ts";
import { DECAL_FRAME, DECAL_VERTEX, frameUniforms, setFrame } from "./decalFrame.ts";
import { QUAD_VERTEX } from "./uvRaster.ts";

/**
 * How far ink spreads sideways in the dermis, metres: about its depth (light
 * diffusing back up from it spreads as far as it travels). The shader never
 * samples a tattoo's image finer than a disc this far round. A CHOICE
 * (research/BODY-ART.md C1).
 */
export const INK_SPREAD = INK_DEPTH;

/**
 * Metres round a decal that its coordinates still cover, so that each texel
 * of skin under it has all four of its neighbours in the decal: more than one
 * texel of the body's UV space on any skin the bake draws (about 2.3 mm at
 * most, on a forearm, at 1024). A CHOICE.
 */
export const DECAL_MARGIN = 0.008;

/** Decal layers at most: a decal over two that overlap there goes on the top layer, over the one there. */
export const DECAL_LAYERS_MAX = 2;

/**
 * The longest side of an image's page, texels: the pages are as wide as the
 * power of two at least the widest image, and as tall as the tallest, each at
 * most this (an image narrower or shorter is stretched to its page, and the
 * images are sampled anisotropically, so a stretched axis costs no detail).
 * 1024 texels across a 40 cm back piece are 0.4 mm each, about the ink's
 * spread across (2 × `INK_SPREAD`), so no tattoo of that size or less loses
 * detail the skin would show. A CHOICE.
 */
export const TATTOO_IMAGE_MAX = 1024;

/** Anisotropic filtering of the images, at most (as far as the GPU allows): for a tattoo seen edge-on round a limb. */
export const TATTOO_ANISOTROPY = 8;

/** A decal to bake: its frame and size on the skin, and a tattoo's image (null for a naevus). */
export interface Decal extends DecalFrame {
  /** Metres across (along right) and up. */
  size: [number, number];
  density: number;
  image: string | null;
}

export interface BodyArtDecals {
  /** The decal coordinates, a page per layer. */
  coordinates: Texture;
  /** The tattoos' images, a page each. */
  images: Texture;
  /** Per decal: a tattoo's image page and ink spread in (s, t), or -1 and a naevus's edge. */
  table: Texture;
  layers: number;
  dispose(): void;
}

/** A tattoo's size on the skin, metres: its width, and its height from its image's aspect. */
export function tattooSize(
  t: Pick<PlacedTattoo, "width">,
  image: { width: number; height: number },
): [number, number] {
  return [t.width, (t.width * image.height) / Math.max(1, image.width)];
}

/** A tattoo as a decal. */
export function tattooDecal(t: PlacedTattoo, image: { width: number; height: number }): Decal {
  const { image: key, width: _, density, ...frame } = t;
  return { ...frame, size: tattooSize(t, image), density, image: key };
}

/** A naevus as a decal: a dot its size across. */
export function naevusDecal(m: PlacedMark): Decal {
  const { centre, normal, right, up } = m;
  const d = Math.abs(m.width);
  return { centre, normal, right, up, size: [d, d], density: 1, image: null };
}

/**
 * Which decal layer each decal goes on: the lowest above every earlier one it
 * overlaps (each the disc round it and its margin), so a later decal is always
 * drawn over an earlier one under it; at most `DECAL_LAYERS_MAX - 1`.
 */
export function decalLayers(
  decals: readonly { centre: readonly number[]; size: readonly [number, number] }[],
): number[] {
  const radius = decals.map((t) => Math.hypot(t.size[0], t.size[1]) / 2 + DECAL_MARGIN);
  const layers: number[] = [];
  decals.forEach((t, i) => {
    let layer = 0;
    for (let j = 0; j < i; j++) {
      const o = decals[j] as (typeof decals)[number];
      const d = Math.hypot(
        (t.centre[0] as number) - (o.centre[0] as number),
        (t.centre[1] as number) - (o.centre[1] as number),
        (t.centre[2] as number) - (o.centre[2] as number),
      );
      if (d < (radius[i] as number) + (radius[j] as number))
        layer = Math.max(layer, (layers[j] as number) + 1);
    }
    layers.push(Math.min(layer, DECAL_LAYERS_MAX - 1));
  });
  return layers;
}

/** Writes a texel's place in the decal, centred, its index + 1, and its weight. */
const COORDINATE_FRAGMENT = /* glsl */ `
precision highp float;
uniform vec2 size;
uniform vec2 margin;
uniform float index;
uniform float density;
out vec4 color;
${DECAL_FRAME}
void main() {
  vec2 st = hkDecalPoint() / size;
  if (any(greaterThan(abs(st), 0.5 + margin))) discard;
  color = vec4(st, index + 1.0, density * hkDecalWeight);
}`;

/**
 * Copies a layer's coordinates, and fills each texel just outside a UV island
 * by extrapolating from the texels inside next to it: along each direction to
 * one inside, twice that one less the next one on (exact for an affine
 * coordinate), or that one alone where the next is not in the same decal.
 */
const EXTRAPOLATE_FRAGMENT = /* glsl */ `
precision highp float;
uniform highp sampler2D raw;
uniform sampler2D cover;
out vec4 color;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 last = textureSize(raw, 0) - 1;
  vec4 v = texelFetch(raw, p, 0);
  if (v.z > 0.5 || texelFetch(cover, p, 0).r > 0.5) { color = v; return; }
  vec3 sum = vec3(0.0);
  float n = 0.0;
  float index = 0.0;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      ivec2 o = ivec2(x, y);
      if (o == ivec2(0)) continue;
      ivec2 q = clamp(p + o, ivec2(0), last);
      vec4 a = texelFetch(raw, q, 0);
      if (a.z < 0.5 || (index > 0.5 && a.z != index)) continue;
      vec4 b = texelFetch(raw, clamp(q + o, ivec2(0), last), 0);
      vec2 st = b.z == a.z ? 2.0 * a.xy - b.xy : a.xy;
      sum += vec3(st, a.w);
      n += 1.0;
      index = a.z;
    }
  color = n > 0.0 ? vec4(sum.xy / n, index, sum.z / n) : vec4(0.0);
}`;

/** Draws an image to its page, premultiplied. */
const IMAGE_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D image;
in vec2 vUv;
out vec4 color;
void main() {
  vec4 s = texture(image, vUv);
  color = vec4(s.rgb * s.a, s.a);
}`;

/** What `bakeDecals` draws with: the body at its UVs, and the bake's shared targets. */
export interface DecalBake {
  renderer: WebGLRenderer;
  camera: OrthographicCamera;
  /** The body drawn at its UVs (`DECAL_VERTEX`'s attributes). */
  body: Mesh;
  bodyScene: Scene;
  /** A full-target quad. */
  quad: Mesh;
  quadScene: Scene;
  /** The texels the body's UV islands cover. */
  cover: WebGLRenderTarget;
  size: number;
}

/**
 * Bakes `decals` (`images` holds every image they name, checked by the
 * caller). Leaves the renderer's target, clear colour and auto-clear to the
 * caller, which restores them.
 */
export function bakeDecals(
  bake: DecalBake,
  decals: readonly Decal[],
  images: Readonly<Record<string, TexImageSource>>,
): BodyArtDecals {
  const { renderer, camera, body, bodyScene, quad, quadScene, cover, size } = bake;
  const dims = (key: string) => images[key] as TexImageSource & { width: number; height: number };
  const layerOf = decalLayers(decals);
  const layers = Math.max(...layerOf) + 1;
  const keys = [...new Set(decals.flatMap((d) => (d.image === null ? [] : [d.image])))];
  const pageSide = (side: (k: string) => number) =>
    Math.min(TATTOO_IMAGE_MAX, 2 ** Math.ceil(Math.log2(Math.max(1, ...keys.map(side)))));
  const pageWidth = pageSide((k) => dims(k).width);
  const pageHeight = pageSide((k) => dims(k).height);

  const imagePages = new WebGLArrayRenderTarget(pageWidth, pageHeight, Math.max(1, keys.length), {
    type: UnsignedByteType,
    colorSpace: SRGBColorSpace,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
    generateMipmaps: true,
    anisotropy: Math.min(TATTOO_ANISOTROPY, renderer.capabilities.getMaxAnisotropy()),
    depthBuffer: false,
  });
  const coordinates = new WebGLArrayRenderTarget(size, size, layers, {
    type: HalfFloatType,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    generateMipmaps: false,
    depthBuffer: false,
  });
  const raw = new WebGLRenderTarget(size, size, {
    type: HalfFloatType,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    generateMipmaps: false,
    depthBuffer: false,
  });
  const table = new DataTexture(
    new Float32Array(decals.length * 4),
    decals.length,
    1,
    RGBAFormat,
    FloatType,
  );
  table.minFilter = NearestFilter;
  table.magFilter = NearestFilter;
  const iu = { image: { value: null as Texture | null } };
  const imageMaterial = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: QUAD_VERTEX,
    fragmentShader: IMAGE_FRAGMENT,
    uniforms: iu,
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
  });
  const cu = {
    ...frameUniforms(),
    size: { value: new Vector2() },
    margin: { value: new Vector2() },
    index: { value: 0 },
    density: { value: 1 },
  };
  const coordinateMaterial = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: DECAL_VERTEX,
    fragmentShader: COORDINATE_FRAGMENT,
    uniforms: cu,
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
  });
  const extrapolate = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: QUAD_VERTEX,
    fragmentShader: EXTRAPOLATE_FRAGMENT,
    uniforms: { raw: { value: raw.texture }, cover: { value: cover.texture } },
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
  });
  const bodyMaterial = body.material;
  const quadMaterial = quad.material;
  const sources: Texture[] = [];
  try {
    quad.material = imageMaterial;
    keys.forEach((key, page) => {
      const source = new Texture(images[key] as TexImageSource);
      source.colorSpace = SRGBColorSpace;
      source.generateMipmaps = false;
      source.minFilter = LinearFilter;
      source.needsUpdate = true;
      sources.push(source);
      iu.image.value = source;
      renderer.setRenderTarget(imagePages, page);
      renderer.clear();
      renderer.render(quadScene, camera);
    });
    decals.forEach((d, i) => {
      const [w, h] = d.size;
      const spread = 2 * INK_SPREAD;
      (table.image.data as Float32Array).set(
        d.image === null
          ? [-1, NAEVUS_EDGE / (w / 2), 0, 0]
          : [keys.indexOf(d.image), spread / w, spread / h, 0],
        i * 4,
      );
    });
    table.needsUpdate = true;
    for (let layer = 0; layer < layers; layer++) {
      renderer.setRenderTarget(raw);
      renderer.clear();
      body.material = coordinateMaterial;
      decals.forEach((d, i) => {
        if (layerOf[i] !== layer) return;
        const [w, h] = d.size;
        setFrame(cu, d, Math.max(w, h));
        cu.size.value.set(w, h);
        cu.margin.value.set(DECAL_MARGIN / w, DECAL_MARGIN / h);
        cu.index.value = i;
        cu.density.value = d.density;
        renderer.render(bodyScene, camera);
      });
      renderer.setRenderTarget(coordinates, layer);
      renderer.clear();
      quad.material = extrapolate;
      renderer.render(quadScene, camera);
    }
  } finally {
    body.material = bodyMaterial;
    quad.material = quadMaterial;
    for (const d of [imageMaterial, coordinateMaterial, extrapolate, raw, ...sources]) d.dispose();
  }
  return {
    coordinates: coordinates.texture,
    images: imagePages.texture,
    table,
    layers,
    dispose() {
      coordinates.dispose();
      imagePages.dispose();
      table.dispose();
    },
  };
}

/**
 * The skin shader's decals, under `HK_DECAL_LAYERS` (the decal layers):
 * `hkDecals( uv, ink, melanin, surface )` composites each layer's tattoo over
 * `ink` (premultiplied, linear) and adds each naevus to the marks' `melanin`
 * and `surface` (its raise). Each layer's place in its decal is the bilinear
 * blend of the four texels round `uv` that lie in the decal the nearest of
 * them lies in. A tattoo's image is sampled there with the screen's own
 * gradients, widened to the ink's spread where they are finer; a naevus is a
 * disc with a soft edge and a dome's raise.
 */
export const DECAL_FUNCTIONS = /* glsl */ `
#ifdef HK_DECAL_LAYERS
uniform highp sampler2DArray hkDecalCoordinates;
uniform mediump sampler2DArray hkDecalImages;
uniform highp sampler2D hkDecalTable;
vec4 hkDecalAt( vec2 uv, int layer ) {
	vec2 f = uv * vec2( textureSize( hkDecalCoordinates, 0 ).xy ) - 0.5;
	vec2 base = floor( f );
	vec2 w = f - base;
	vec4 d[4];
	float b[4];
	float best = 0.0;
	float index = 0.0;
	for ( int k = 0; k < 4; k ++ ) {
		ivec2 o = ivec2( k & 1, k >> 1 );
		d[k] = texelFetch( hkDecalCoordinates, ivec3( ivec2( base ) + o, layer ), 0 );
		b[k] = ( o.x == 1 ? w.x : 1.0 - w.x ) * ( o.y == 1 ? w.y : 1.0 - w.y );
		if ( d[k].z > 0.5 && b[k] >= best ) { best = b[k]; index = d[k].z; }
	}
	vec4 sum = vec4( 0.0 );
	for ( int k = 0; k < 4; k ++ )
		if ( index > 0.5 && d[k].z == index ) sum += vec4( d[k].xy, 1.0, d[k].w ) * b[k];
	return sum.z > 0.0 ? vec4( sum.xy / sum.z + 0.5, index - 1.0, sum.w / sum.z ) : vec4( 0.0, 0.0, -1.0, 0.0 );
}
vec2 hkAtLeast( vec2 g, vec2 spread, vec2 along ) {
	float l = length( g / spread );
	return l < 1e-6 ? along : g * max( 1.0, 1.0 / l );
}
void hkDecals( vec2 uv, inout vec4 ink, inout float melanin, inout vec2 surface ) {
	for ( int layer = 0; layer < HK_DECAL_LAYERS; layer ++ ) {
		vec4 d = hkDecalAt( uv, layer );
		vec2 dx = dFdx( d.xy );
		vec2 dy = dFdy( d.xy );
		if ( d.z < 0.0 ) continue;
		vec4 row = texelFetch( hkDecalTable, ivec2( int( d.z ), 0 ), 0 );
		if ( row.x < 0.0 ) {
			// A naevus: a disc, its edge soft over row.y of its radius, raised as a dome.
			float r = length( d.xy - 0.5 ) * 2.0;
			melanin += ${NAEVUS_MELANIN.toFixed(4)} * ( 1.0 - smoothstep( 1.0 - row.y, 1.0 + row.y, r ) ) * d.w;
			float dome = max( 1.0 - r * r, 0.0 );
			surface.y += ${(NAEVUS_RAISE / SCAR_RAISE).toFixed(4)} * dome * dome * d.w;
			continue;
		}
		if ( any( lessThan( d.xy, vec2( 0.0 ) ) ) || any( greaterThan( d.xy, vec2( 1.0 ) ) ) ) continue;
		vec4 s = textureGrad( hkDecalImages, vec3( d.xy, row.x ), hkAtLeast( dx, row.yz, vec2( row.y, 0.0 ) ), hkAtLeast( dy, row.yz, vec2( 0.0, row.z ) ) ) * d.w;
		ink = s + ink * ( 1.0 - s.a );
	}
}
#endif
`;
