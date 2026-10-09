/**
 * A figure's body-art texture (docs/ARCHITECTURE.md, "Body art"): its marks
 * baked into the body's UV space, per figure, since placement is per figure
 * while the field atlas is shared, with its tattoos' decals beside them
 * (`tattooDecals.ts`). Two pages of an RGBA8 array:
 *
 * - page 0, ink: dermal pigment (a Mongolian spot), colour sRGB-encoded (dark
 *   pigment keeps its precision in eight bits) and coverage in alpha. The
 *   skin shader composites the tattoos over it;
 * - page 1, what marks change in the skin (`MarkChannels`): melanin, signed
 *   about `MARK_NEUTRAL` (down toward vitiligo, up toward more density), added
 *   haemoglobin, a scar's smoothness and its raise.
 *
 * Each mark is drawn by drawing the body in UV space and projecting along its
 * frame (`decalFrame.ts`). Dermal pigment composites in order in half float,
 * linear and premultiplied; marks add, so a patch of vitiligo under a
 * café-au-lait macule nets out. A mark's outline is `markShape`'s exactly. A
 * gutter pass then writes each page.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  DoubleSide,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NearestFilter,
  NoBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  PlaneGeometry,
  RawShaderMaterial,
  RedFormat,
  Scene,
  type Texture,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  WebGLArrayRenderTarget,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import type { BodyArtPlacement, PlacedMark } from "../bodyArt/decals.ts";
import { markChannels, markOutline } from "../bodyArt/marks.ts";
import { DECAL_FRAME, DECAL_VERTEX, frameUniforms, setFrame } from "./decalFrame.ts";
import { bakeTattooDecals, type TattooDecals } from "./tattooDecals.ts";
import { COVER_FRAGMENT, NEAREST_COVERED, QUAD_VERTEX, UV_RASTER_VERTEX } from "./uvRaster.ts";

/** Pages of a body-art texture: ink, then marks. */
export const BODY_ART_PAGES = 2;

/**
 * The marks page's melanin channel with no change, in 8-bit steps: the signed
 * melanin -1..1 is stored as 128 + 127 × melanin, so "no change" is exact.
 */
export const MARK_NEUTRAL = 128;

/** The figure's body surface, as evaluated: its UV layout and its morphed rest positions and normals. */
export interface BodyArtSurface {
  uvs: Float32Array;
  index: Uint32Array | Uint16Array;
  vertexCount: number;
  positions: Float32Array;
  normals: Float32Array;
}

/** Images by the keys tattoos name (`Tattoo.image`), decoded. */
export type BodyArtImages = Readonly<Record<string, TexImageSource>>;

export interface BodyArtTexture {
  /** The ink and marks pages. */
  texture: Texture;
  /** The tattoos' decals, or null for a figure without tattoos. */
  tattoos: TattooDecals | null;
  dispose(): void;
}

/**
 * A mark (`markShape`): an ellipse width by length with harmonics on its
 * radius, its x wandering along its length, and a soft edge. Writes the mark's
 * channels times its shape, the raise times its square for a rounded profile
 * (`toInk` 0, added), or its ink premultiplied (`toInk` 1, composited over).
 */
const MARK_FRAGMENT = /* glsl */ `
precision highp float;
uniform vec2 size;
uniform vec4 amplitude;
uniform vec4 phase;
uniform vec3 wander;
uniform vec4 channels;
uniform vec4 ink;
uniform float toInk;
out vec4 color;
${DECAL_FRAME}
void main() {
  vec2 p = hkDecalPoint() / (size * 0.5);
  float qx = p.x - wander.x * sin(3.14159265359 * 1.5 * p.y + wander.y);
  float theta = atan(p.y, qx);
  float r = 1.0;
  for (int i = 0; i < 4; i++) r += amplitude[i] * sin(float(i + 2) * theta + phase[i]);
  float s = (1.0 - smoothstep(r - wander.z, r + wander.z, length(vec2(qx, p.y)))) * hkDecalWeight;
  if (s <= 0.0) discard;
  color = toInk > 0.5 ? vec4(ink.rgb * ink.a, ink.a) * s : vec4(channels.xyz * s, channels.w * s * s);
}`;

/** Writes the ink page: the composite's gutter filled, unpremultiplied, colour sRGB-encoded. */
const INK_PAGE_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D composite;
uniform sampler2D cover;
uniform float texel;
in vec2 vUv;
out vec4 color;
${NEAREST_COVERED}
vec3 encode(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
void main() {
  vec4 p = hkNearestCovered(composite, cover, vUv, texel);
  color = vec4(p.a > 0.0 ? encode(p.rgb / p.a) : vec3(0.0), p.a);
}`;

/** Writes the marks page: the summed channels clamped, melanin about the exact neutral. */
const MARK_PAGE_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D composite;
uniform sampler2D cover;
uniform float texel;
in vec2 vUv;
out vec4 color;
${NEAREST_COVERED}
void main() {
  vec4 p = hkNearestCovered(composite, cover, vUv, texel);
  color = vec4((${MARK_NEUTRAL.toFixed(1)} + 127.0 * clamp(p.x, -1.0, 1.0)) / 255.0, clamp(p.yzw, 0.0, 1.0));
}`;

const target = (size: number, options: ConstructorParameters<typeof WebGLRenderTarget>[2]) =>
  new WebGLRenderTarget(size, size, {
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    generateMipmaps: false,
    depthBuffer: false,
    ...options,
  });

const RASTER = { glslVersion: GLSL3, depthTest: false, depthWrite: false, side: DoubleSide };
/** Premultiplied "over": each pigment over those before it. */
const OVER = {
  blending: CustomBlending,
  blendSrc: OneFactor,
  blendDst: OneMinusSrcAlphaFactor,
  blendSrcAlpha: OneFactor,
  blendDstAlpha: OneMinusSrcAlphaFactor,
};
/** Marks add. */
const ADD = {
  blending: CustomBlending,
  blendSrc: OneFactor,
  blendDst: OneFactor,
  blendSrcAlpha: OneFactor,
  blendDstAlpha: OneFactor,
};

/**
 * Bakes the placement's tattoos and marks for a figure whose surface is
 * `surface`; the caller owns the result and disposes it. Throws `RangeError`
 * for a tattoo whose image is not in `images`.
 */
export function bakeBodyArt(
  renderer: WebGLRenderer,
  surface: BodyArtSurface,
  placement: Pick<BodyArtPlacement, "tattoos" | "marks">,
  images: BodyArtImages,
  size = 1024,
): BodyArtTexture {
  const missing = placement.tattoos.filter((t) => !(t.image in images)).map((t) => t.image);
  if (missing.length) throw new RangeError(`body art needs images ${missing.join(", ")}`);
  const art = new WebGLArrayRenderTarget(size, size, BODY_ART_PAGES, {
    type: UnsignedByteType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    generateMipmaps: false,
    depthBuffer: false,
  });
  const inkComposite = target(size, { type: HalfFloatType });
  const markComposite = target(size, { type: HalfFloatType });
  const cover = target(size, { format: RedFormat, type: UnsignedByteType });
  const camera = new OrthographicCamera();
  const geometry = new BufferGeometry();
  geometry.setAttribute("uv", new BufferAttribute(surface.uvs, 2));
  geometry.setAttribute("position", new BufferAttribute(surface.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(surface.normals, 3));
  geometry.setAttribute(
    "fields",
    new BufferAttribute(new Float32Array(surface.vertexCount * 4), 4),
  );
  geometry.setIndex(new BufferAttribute(surface.index, 1));
  const coverMaterial = new RawShaderMaterial({
    ...RASTER,
    vertexShader: UV_RASTER_VERTEX,
    fragmentShader: COVER_FRAGMENT,
    blending: NoBlending,
  });
  const mu = {
    ...frameUniforms(),
    size: { value: new Vector2() },
    amplitude: { value: new Vector4() },
    phase: { value: new Vector4() },
    wander: { value: new Vector3() },
    channels: { value: new Vector4() },
    ink: { value: new Vector4() },
    toInk: { value: 0 },
  };
  const markAdd = new RawShaderMaterial({
    ...RASTER,
    ...ADD,
    vertexShader: DECAL_VERTEX,
    fragmentShader: MARK_FRAGMENT,
    uniforms: mu,
  });
  const markInk = new RawShaderMaterial({
    ...RASTER,
    ...OVER,
    vertexShader: DECAL_VERTEX,
    fragmentShader: MARK_FRAGMENT,
    uniforms: mu,
  });
  const mesh = new Mesh(geometry, coverMaterial);
  mesh.frustumCulled = false;
  const scene = new Scene().add(mesh);
  const quad = new PlaneGeometry(2, 2);
  const pageMaterial = (fragmentShader: string, composite: WebGLRenderTarget) =>
    new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: QUAD_VERTEX,
      fragmentShader,
      uniforms: {
        composite: { value: composite.texture },
        cover: { value: cover.texture },
        texel: { value: 1 / size },
      },
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
    });
  const inkPage = pageMaterial(INK_PAGE_FRAGMENT, inkComposite);
  const markPage = pageMaterial(MARK_PAGE_FRAGMENT, markComposite);
  const quadMesh = new Mesh(quad, inkPage);
  quadMesh.frustumCulled = false;
  const quadScene = new Scene().add(quadMesh);
  const setMark = (m: PlacedMark) => {
    const o = markOutline(m);
    const c = markChannels(m);
    setFrame(mu, m, Math.max(Math.abs(m.width), m.length));
    mu.size.value.set(m.width, m.length);
    mu.amplitude.value.fromArray(o.amplitude);
    mu.phase.value.fromArray(o.phase);
    mu.wander.value.set(o.wander, o.wanderPhase, o.soft);
    mu.channels.value.set(c.melanin, c.haemoglobin, c.smooth, c.raise);
    mu.ink.value.set(...(c.ink?.colour ?? [0, 0, 0]), c.ink?.cover ?? 0);
    return c;
  };

  const previous = renderer.getRenderTarget();
  const clear = renderer.getClearColor(new Color());
  const clearAlpha = renderer.getClearAlpha();
  const autoClear = renderer.autoClear;
  renderer.setClearColor(0x000000, 0);
  // Pigment composites over and marks add to one another: each pass must keep what is drawn.
  renderer.autoClear = false;
  let tattoos: TattooDecals | null = null;
  try {
    renderer.setRenderTarget(cover);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(markComposite);
    renderer.clear();
    renderer.setRenderTarget(inkComposite);
    renderer.clear();
    // Dermal pigment is ink; the other marks change the skin.
    for (const m of placement.marks) {
      const c = setMark(m);
      mu.toInk.value = c.ink ? 1 : 0;
      mesh.material = c.ink ? markInk : markAdd;
      renderer.setRenderTarget(c.ink ? inkComposite : markComposite);
      renderer.render(scene, camera);
    }
    renderer.setRenderTarget(art, 0);
    renderer.clear();
    quadMesh.material = inkPage;
    renderer.render(quadScene, camera);
    renderer.setRenderTarget(art, 1);
    renderer.clear();
    quadMesh.material = markPage;
    renderer.render(quadScene, camera);
    if (placement.tattoos.length)
      tattoos = bakeTattooDecals(
        { renderer, camera, body: mesh, bodyScene: scene, quad: quadMesh, quadScene, cover, size },
        placement.tattoos,
        images,
      );
  } catch (e) {
    art.dispose();
    throw e;
  } finally {
    renderer.setRenderTarget(previous);
    renderer.setClearColor(clear, clearAlpha);
    renderer.autoClear = autoClear;
    for (const d of [geometry, coverMaterial, markAdd, markInk, quad, inkPage, markPage])
      d.dispose();
    for (const t of [inkComposite, markComposite, cover]) t.dispose();
  }
  return {
    texture: art.texture,
    tattoos,
    dispose() {
      art.dispose();
      tattoos?.dispose();
    },
  };
}
