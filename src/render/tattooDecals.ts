/**
 * A figure's tattoos as decals (docs/ARCHITECTURE.md, "Body art"): rather than
 * baking a tattoo's colours into the body's UV space, whose texels are 1-2 mm
 * on a forearm at the body-art texture's size and would pixelate a tattoo's
 * line work, the bake stores where each texel lies in the tattoo that covers
 * it, and the skin shader samples the tattoo's own image there, mipmapped, at
 * the resolution the screen asks for. Three textures:
 *
 * - the decal coordinates (half-float array, a page per decal layer): per
 *   texel the point's place in its tattoo, centred (s - 0.5, t - 0.5), the
 *   tattoo's index + 1 (0 where none) and how fully the skin takes it (its
 *   density times the frame's fade). A coordinate is affine over each of the
 *   body's triangles, so the shader's bilinear blend of four texels is exact
 *   inside one; texels round each UV island are extrapolated linearly from
 *   the two nearest inside, so it stays exact up to the island's edge;
 * - the images (an sRGB array, mipmapped), one page per image the tattoos
 *   name, premultiplied so their mipmaps carry no dark fringe;
 * - a table, per tattoo: its image's page and its ink spread in (s, t).
 *
 * Tattoos that overlap (`tattooLayers`) are drawn on separate decal layers,
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
import type { PlacedTattoo } from "../bodyArt/decals.ts";
import { INK_DEPTH } from "../bodyArt/ink.ts";
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
 * Metres round a tattoo's image that its decal coordinates still cover, so
 * that each texel of skin under the image has all four of its neighbours in
 * the decal: more than one texel of the body's UV space on any skin the bake
 * draws (about 2.3 mm at most, on a forearm, at 1024). A CHOICE.
 */
export const TATTOO_MARGIN = 0.008;

/** Decal layers at most: a tattoo over two that overlap there goes on the top layer, over the one there. */
export const TATTOO_LAYERS_MAX = 2;

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

export interface TattooDecals {
  /** The decal coordinates, a page per layer. */
  coordinates: Texture;
  /** The images, a page each. */
  images: Texture;
  /** Per tattoo: its image's page, and its ink spread in (s, t). */
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

/**
 * Which decal layer each tattoo goes on: the lowest above every earlier one
 * it overlaps (each the disc round its image and margin), so a later tattoo is
 * always drawn over an earlier one under it; at most `TATTOO_LAYERS_MAX - 1`.
 */
export function tattooLayers(
  tattoos: readonly { centre: readonly number[]; size: readonly [number, number] }[],
): number[] {
  const radius = tattoos.map((t) => Math.hypot(t.size[0], t.size[1]) / 2 + TATTOO_MARGIN);
  const layers: number[] = [];
  tattoos.forEach((t, i) => {
    let layer = 0;
    for (let j = 0; j < i; j++) {
      const o = tattoos[j] as (typeof tattoos)[number];
      const d = Math.hypot(
        (t.centre[0] as number) - (o.centre[0] as number),
        (t.centre[1] as number) - (o.centre[1] as number),
        (t.centre[2] as number) - (o.centre[2] as number),
      );
      if (d < (radius[i] as number) + (radius[j] as number))
        layer = Math.max(layer, (layers[j] as number) + 1);
    }
    layers.push(Math.min(layer, TATTOO_LAYERS_MAX - 1));
  });
  return layers;
}

/** Writes a texel's place in the tattoo, centred, its index + 1, and its weight. */
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
 * coordinate), or that one alone where the next is not in the same tattoo.
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

/** What `bakeTattooDecals` draws with: the body at its UVs, and the bake's shared targets. */
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
 * Bakes `tattoos`' decals (`images` holds every image they name, checked by
 * the caller). Leaves the renderer's target, clear colour and auto-clear to
 * the caller, which restores them.
 */
export function bakeTattooDecals(
  bake: DecalBake,
  tattoos: readonly PlacedTattoo[],
  images: Readonly<Record<string, TexImageSource>>,
): TattooDecals {
  const { renderer, camera, body, bodyScene, quad, quadScene, cover, size } = bake;
  const dims = (key: string) => images[key] as TexImageSource & { width: number; height: number };
  const sizes = tattoos.map((t) => tattooSize(t, dims(t.image)));
  const layerOf = tattooLayers(
    tattoos.map((t, i) => ({ centre: t.centre, size: sizes[i] as [number, number] })),
  );
  const layers = Math.max(...layerOf) + 1;
  const keys = [...new Set(tattoos.map((t) => t.image))];
  const pageSide = (side: (k: string) => number) =>
    Math.min(TATTOO_IMAGE_MAX, 2 ** Math.ceil(Math.log2(Math.max(1, ...keys.map(side)))));
  const pageWidth = pageSide((k) => dims(k).width);
  const pageHeight = pageSide((k) => dims(k).height);

  const imagePages = new WebGLArrayRenderTarget(pageWidth, pageHeight, keys.length, {
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
    new Float32Array(tattoos.length * 4),
    tattoos.length,
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
    tattoos.forEach((t, i) => {
      const [w, h] = sizes[i] as [number, number];
      const spread = 2 * INK_SPREAD;
      (table.image.data as Float32Array).set(
        [keys.indexOf(t.image), spread / w, spread / h, 0],
        i * 4,
      );
    });
    table.needsUpdate = true;
    for (let layer = 0; layer < layers; layer++) {
      renderer.setRenderTarget(raw);
      renderer.clear();
      body.material = coordinateMaterial;
      tattoos.forEach((t, i) => {
        if (layerOf[i] !== layer) return;
        const [w, h] = sizes[i] as [number, number];
        setFrame(cu, t, Math.max(w, h));
        cu.size.value.set(w, h);
        cu.margin.value.set(TATTOO_MARGIN / w, TATTOO_MARGIN / h);
        cu.index.value = i;
        cu.density.value = t.density;
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
 * The skin shader's tattoos, under `HK_TATTOO_LAYERS` (the decal layers):
 * `hkTattooInk( uv, ink )` composites each layer's tattoo over `ink`
 * (premultiplied, linear). Each layer's place in its tattoo is the bilinear
 * blend of the four texels round `uv` that lie in the tattoo the nearest of
 * them lies in, and the image is sampled there with the screen's own
 * gradients, widened to the ink's spread where they are finer.
 */
export const TATTOO_FUNCTIONS = /* glsl */ `
#ifdef HK_TATTOO_LAYERS
uniform highp sampler2DArray hkTattooDecals;
uniform mediump sampler2DArray hkTattooImages;
uniform highp sampler2D hkTattooTable;
vec4 hkTattooDecal( vec2 uv, int layer ) {
	vec2 f = uv * vec2( textureSize( hkTattooDecals, 0 ).xy ) - 0.5;
	vec2 base = floor( f );
	vec2 w = f - base;
	vec4 d[4];
	float b[4];
	float best = 0.0;
	float index = 0.0;
	for ( int k = 0; k < 4; k ++ ) {
		ivec2 o = ivec2( k & 1, k >> 1 );
		d[k] = texelFetch( hkTattooDecals, ivec3( ivec2( base ) + o, layer ), 0 );
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
vec4 hkTattooInk( vec2 uv, vec4 ink ) {
	for ( int layer = 0; layer < HK_TATTOO_LAYERS; layer ++ ) {
		vec4 d = hkTattooDecal( uv, layer );
		vec2 dx = dFdx( d.xy );
		vec2 dy = dFdy( d.xy );
		if ( d.z < 0.0 ) continue;
		vec4 row = texelFetch( hkTattooTable, ivec2( int( d.z ), 0 ), 0 );
		if ( any( lessThan( d.xy, vec2( 0.0 ) ) ) || any( greaterThan( d.xy, vec2( 1.0 ) ) ) ) continue;
		vec4 s = textureGrad( hkTattooImages, vec3( d.xy, row.x ), hkAtLeast( dx, row.yz, vec2( row.y, 0.0 ) ), hkAtLeast( dy, row.yz, vec2( 0.0, row.z ) ) ) * d.w;
		ink = s + ink * ( 1.0 - s.a );
	}
	return ink;
}
#endif
`;
