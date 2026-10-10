/**
 * A figure's body-art texture (docs/ARCHITECTURE.md, "Body art"): its marks
 * baked into the body's UV space, per figure, since placement is per figure
 * while the field atlas is shared, with its tattoos' and naevi's decals
 * beside them (`bodyArtDecals.ts`). Two pages of an RGBA8 array:
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
import {
  EDGE_VARIATION,
  FIELD_STEP,
  FLECK_CELL,
  FLECK_REACH,
  FLECK_SOFT,
  FLECK_THRESHOLD,
  markOutline,
} from "../bodyArt/markShape.ts";
import { markChannels } from "../bodyArt/marks.ts";
import { type BodyArtDecals, bakeDecals, naevusDecal, tattooDecal } from "./bodyArtDecals.ts";
import { DECAL_FRAME, DECAL_VERTEX, frameUniforms, setFrame } from "./decalFrame.ts";
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
  /** The tattoos' and naevi's decals, or null for a figure without either. */
  decals: BodyArtDecals | null;
  dispose(): void;
}

/** GLSL twin of `markNoise` (src/bodyArt/markShape.ts), in the same uint arithmetic. */
const MARK_NOISE = /* glsl */ `
float hkHash(ivec3 i) {
  uint h = (uint(i.x) * 0x8da6b343u) ^ (uint(i.y) * 0xd8163841u) ^ (uint(i.z) * 0xcb1ab31fu);
  h = (h ^ (h >> 16u)) * 0x7feb352du;
  h = (h ^ (h >> 15u)) * 0x846ca68bu;
  return float(h ^ (h >> 16u)) / 4294967296.0;
}
float hkValueNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  ivec3 c = ivec3(i);
  return mix(
    mix(mix(hkHash(c), hkHash(c + ivec3(1, 0, 0)), u.x), mix(hkHash(c + ivec3(0, 1, 0)), hkHash(c + ivec3(1, 1, 0)), u.x), u.y),
    mix(mix(hkHash(c + ivec3(0, 0, 1)), hkHash(c + ivec3(1, 0, 1)), u.x), mix(hkHash(c + ivec3(0, 1, 1)), hkHash(c + ivec3(1, 1, 1)), u.x), u.y),
    u.z);
}
float hkMarkNoise(vec3 p) {
  float sum = 0.0;
  float amp = 1.0;
  float f = 1.0;
  for (int o = 0; o < 3; o++) {
    sum += amp * (2.0 * hkValueNoise(p * f) - 1.0);
    amp *= 0.5;
    f *= 2.0;
  }
  return sum / 1.75;
}`;

/**
 * A mark (`markShape`, whose twin this is). A scar: an ellipse width by length
 * with harmonics on its radius and its x wandering along its length. A patch:
 * an ellipsoid thresholded by noise in the frame's space, with vitiligo's
 * flecks round it. Each with a soft edge. Writes the mark's channels times
 * its shape, the raise times its square for a rounded profile (`toInk` 0,
 * added), or its ink premultiplied (`toInk` 1, composited over).
 */
const MARK_FRAGMENT = /* glsl */ `
precision highp float;
uniform vec2 size;
uniform int patchShape;
uniform vec4 amplitude;
uniform vec4 phase;
uniform vec3 wander;
uniform vec3 offset;
uniform vec3 fleckOffset;
uniform vec3 noise;
uniform vec4 channels;
uniform vec4 ink;
uniform float toInk;
out vec4 color;
${DECAL_FRAME}
${MARK_NOISE}
float hkScar() {
  vec2 p = hkDecalPoint() / (size * 0.5);
  float qx = p.x - wander.x * sin(3.14159265359 * 1.5 * p.y + wander.y);
  float theta = atan(p.y, qx);
  float r = 1.0;
  for (int i = 0; i < 4; i++) r += amplitude[i] * sin(float(i + 2) * theta + phase[i]);
  return (1.0 - smoothstep(r - wander.z, r + wander.z, length(vec2(qx, p.y)))) * hkDecalWeight;
}
vec3 hkHalf;
float hkField(vec3 p) {
  return length(p / hkHalf) - 1.0 - noise.y * hkMarkNoise(p / noise.x + offset);
}
float hkPatch() {
  vec3 p = hkDecalLocal();
  if (size.x < 0.0) p.x = -p.x;
  hkHalf = vec3(abs(size.x) * 0.5, size.y * 0.5, min(abs(size.x), size.y) * 0.5);
  float reach = ${FLECK_REACH.toFixed(3)} * hkHalf.z * noise.z;
  if (length(p / hkHalf) > 1.0 + noise.y + (wander.z * ${(1 + EDGE_VARIATION).toFixed(3)} + reach) / hkHalf.z + 0.05) discard;
  const float h = ${FIELD_STEP.toExponential(6)};
  vec3 g = vec3(
    hkField(p + vec3(h, 0.0, 0.0)) - hkField(p - vec3(h, 0.0, 0.0)),
    hkField(p + vec3(0.0, h, 0.0)) - hkField(p - vec3(0.0, h, 0.0)),
    hkField(p + vec3(0.0, 0.0, h)) - hkField(p - vec3(0.0, 0.0, h))) / (2.0 * h);
  float d = hkField(p) / max(1e-6, length(g));
  float edge = wander.z * (1.0 + ${EDGE_VARIATION.toFixed(3)} * hkMarkNoise(p / noise.x + offset));
  float s = 1.0 - smoothstep(-edge, edge, d);
  if (noise.z > 0.5) {
    float spot = smoothstep(${(FLECK_THRESHOLD - FLECK_SOFT).toFixed(4)}, ${(FLECK_THRESHOLD + FLECK_SOFT).toFixed(4)}, hkMarkNoise(p / ${FLECK_CELL.toFixed(6)} + fleckOffset));
    s = max(s, spot * (1.0 - smoothstep(0.0, reach, d)));
  }
  return s * hkDecalFacing;
}
void main() {
  float s = patchShape == 1 ? hkPatch() : hkScar();
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
    patchShape: { value: 0 },
    offset: { value: new Vector3() },
    fleckOffset: { value: new Vector3() },
    noise: { value: new Vector3() },
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
    mu.patchShape.value = o.patch ? 1 : 0;
    mu.offset.value.fromArray(o.offset);
    mu.fleckOffset.value.fromArray(o.fleckOffset);
    mu.noise.value.set(o.cell, o.irregular, o.flecks);
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
  let decals: BodyArtDecals | null = null;
  // A naevus is a decal; the other marks are baked.
  const naevi = placement.marks.filter((m) => m.kind === "naevus");
  const baked = placement.marks.filter((m) => m.kind !== "naevus");
  const dims = (key: string) => images[key] as TexImageSource & { width: number; height: number };
  const decalList = [
    ...naevi.map(naevusDecal),
    ...placement.tattoos.map((t) => tattooDecal(t, dims(t.image))),
  ];
  try {
    renderer.setRenderTarget(cover);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(markComposite);
    renderer.clear();
    renderer.setRenderTarget(inkComposite);
    renderer.clear();
    // Dermal pigment is ink; the other marks change the skin.
    for (const m of baked) {
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
    // Naevi first: a tattoo over one is drawn above it.
    if (decalList.length)
      decals = bakeDecals(
        { renderer, camera, body: mesh, bodyScene: scene, quad: quadMesh, quadScene, cover, size },
        decalList,
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
    decals,
    dispose() {
      art.dispose();
      decals?.dispose();
    },
  };
}
