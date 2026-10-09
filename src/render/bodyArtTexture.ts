/**
 * A figure's body-art texture (docs/ARCHITECTURE.md, "Body art"): its tattoos
 * and marks baked into the body's UV space, per figure, since placement is per
 * figure while the field atlas is shared. Two pages of an RGBA8 array:
 *
 * - page 0, ink: colour sRGB-encoded (dark inks keep their precision in eight
 *   bits) and coverage in alpha. Dermal pigment (a Mongolian spot) is ink too,
 *   under the tattoos;
 * - page 1, what marks change in the skin (`MarkChannels`): melanin, signed
 *   about `MARK_NEUTRAL` (down toward vitiligo, up toward more density), added
 *   haemoglobin, a scar's smoothness and its raise.
 *
 * Each decal is drawn by drawing the body in UV space and projecting along the
 * decal's frame (`DecalFrame`) from the figure's morphed rest surface, so a
 * decal crosses a UV seam whole: both sides of the seam are the same place on
 * the body. Tattoos and dermal pigment composite in order (a later one over an
 * earlier one) in half float, linear and premultiplied; marks add, so a patch
 * of vitiligo under a café-au-lait macule nets out. Ink spreads a little in the
 * dermis, so each texel averages a tattoo's image over a disc `INK_SPREAD`
 * across; a mark's outline is `markShape`'s exactly. A gutter pass then writes
 * each page.
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
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  WebGLArrayRenderTarget,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import type { BodyArtPlacement, DecalFrame, PlacedMark, PlacedTattoo } from "../bodyArt/decals.ts";
import { INK_DEPTH } from "../bodyArt/ink.ts";
import { markChannels, markOutline } from "../bodyArt/marks.ts";
import { COVER_FRAGMENT, NEAREST_COVERED, QUAD_VERTEX, UV_RASTER_VERTEX } from "./uvRaster.ts";

/** Pages of a body-art texture: ink, then marks. */
export const BODY_ART_PAGES = 2;

/**
 * The marks page's melanin channel with no change, in 8-bit steps: the signed
 * melanin -1..1 is stored as 128 + 127 × melanin, so "no change" is exact.
 */
export const MARK_NEUTRAL = 128;

/**
 * How far ink spreads sideways in the dermis, metres: about its depth (light
 * diffusing back up from it spreads as far as it travels). A CHOICE
 * (research/BODY-ART.md C1).
 */
export const INK_SPREAD = INK_DEPTH;

/**
 * How far off the skin's plane at a decal's centre the projection still
 * reaches, as a share of the decal's longer side, and at least `DECAL_REACH_MIN`
 * metres: enough to follow the skin's curve under the decal (a cheek, a
 * shoulder), too little to reach a limb behind it. Beyond `DECAL_REACH_FADE` of
 * it the decal fades out rather than ending in a cut along the skin's curve.
 * CHOICES.
 */
export const DECAL_REACH = 0.5;
export const DECAL_REACH_MIN = 0.01;
export const DECAL_REACH_FADE = 0.6;
/**
 * How squarely the skin must face the decal (cosine) to take it: fully from
 * `DECAL_FACING[1]`, fading to nothing at `DECAL_FACING[0]`, so the
 * projection's far sides are skipped without a cut where the skin turns away.
 */
export const DECAL_FACING: readonly [number, number] = [0.05, 0.35];

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
  texture: Texture;
  dispose(): void;
}

const DECAL_VERTEX = /* glsl */ `
in vec2 uv;
in vec3 position;
in vec3 normal;
out vec3 vPosition;
out vec3 vNormal;
void main() {
  vPosition = position;
  vNormal = normal;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}`;

/**
 * The decal's frame: the point's place in it (metres along right and up), and
 * how fully the skin there takes it (`hkDecalWeight`), fading out toward the
 * reach's end and where the skin turns away; skin it does not reach is skipped.
 */
const FRAME = /* glsl */ `
uniform vec3 centre;
uniform vec3 right;
uniform vec3 up;
uniform vec3 normal;
uniform float reach;
in vec3 vPosition;
in vec3 vNormal;
float hkDecalWeight;
vec2 hkDecalPoint() {
  vec3 d = vPosition - centre;
  hkDecalWeight = (1.0 - smoothstep(${DECAL_REACH_FADE.toFixed(3)} * reach, reach, abs(dot(d, normal))))
    * smoothstep(${DECAL_FACING[0].toFixed(3)}, ${DECAL_FACING[1].toFixed(3)}, dot(normalize(vNormal), normal));
  if (hkDecalWeight <= 0.0) discard;
  return vec2(dot(d, right), dot(d, up));
}`;

/** Twelve points spread evenly over the unit disc (a Fibonacci spiral). */
const DISC = Array.from({ length: 12 }, (_, i) => {
  const r = Math.sqrt((i + 0.5) / 12);
  const a = i * 2.399963229728653;
  return [r * Math.cos(a), r * Math.sin(a)];
});

const TATTOO_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D image;
uniform vec2 size;
uniform float density;
uniform vec2 spread;
out vec4 color;
${FRAME}
const vec2 DISC[12] = vec2[12](${DISC.map(([x, y]) => `vec2(${(x as number).toFixed(6)}, ${(y as number).toFixed(6)})`).join(", ")});
void main() {
  vec2 st = hkDecalPoint() / size + 0.5;
  if (st.x < -spread.x || st.y < -spread.y || st.x > 1.0 + spread.x || st.y > 1.0 + spread.y) discard;
  vec4 ink = vec4(0.0);
  for (int i = 0; i < 12; i++) {
    vec2 p = st + DISC[i] * spread;
    if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) continue;
    vec4 s = texture(image, p);
    ink += vec4(s.rgb * s.a, s.a);
  }
  color = ink / 12.0 * density * hkDecalWeight;
}`;

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
${FRAME}
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
/** Premultiplied "over": each decal over those before it. */
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

function frameUniforms() {
  return {
    centre: { value: new Vector3() },
    right: { value: new Vector3() },
    up: { value: new Vector3() },
    normal: { value: new Vector3() },
    reach: { value: 0 },
  };
}

function setFrame(u: ReturnType<typeof frameUniforms>, f: DecalFrame, extent: number): void {
  u.centre.value.fromArray(f.centre);
  u.right.value.fromArray(f.right);
  u.up.value.fromArray(f.up);
  u.normal.value.fromArray(f.normal);
  u.reach.value = Math.max(DECAL_REACH_MIN, DECAL_REACH * extent);
}

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
  const tu = {
    ...frameUniforms(),
    image: { value: null as Texture | null },
    size: { value: new Vector2() },
    density: { value: 1 },
    spread: { value: new Vector2() },
  };
  const tattoo = new RawShaderMaterial({
    ...RASTER,
    ...OVER,
    vertexShader: DECAL_VERTEX,
    fragmentShader: TATTOO_FRAGMENT,
    uniforms: tu,
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
  const textures = new Map<string, Texture>();
  const imageTexture = (key: string) => {
    let t = textures.get(key);
    if (!t) {
      t = new Texture(images[key] as TexImageSource);
      t.colorSpace = SRGBColorSpace;
      t.generateMipmaps = false;
      t.minFilter = LinearFilter;
      t.needsUpdate = true;
      textures.set(key, t);
    }
    return t;
  };
  const setTattoo = (t: PlacedTattoo) => {
    const image = images[t.image] as TexImageSource & { width: number; height: number };
    const height = (t.width * image.height) / Math.max(1, image.width);
    setFrame(tu, t, Math.max(t.width, height));
    tu.image.value = imageTexture(t.image);
    tu.size.value.set(t.width, height);
    tu.density.value = t.density;
    tu.spread.value.set(INK_SPREAD / t.width, INK_SPREAD / height);
  };
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
  // Decals composite over and add to one another: each pass must keep what is drawn.
  renderer.autoClear = false;
  try {
    renderer.setRenderTarget(cover);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(markComposite);
    renderer.clear();
    renderer.setRenderTarget(inkComposite);
    renderer.clear();
    // Dermal pigment lies under the tattoos; the other marks change the skin.
    for (const m of placement.marks) {
      const c = setMark(m);
      mu.toInk.value = c.ink ? 1 : 0;
      mesh.material = c.ink ? markInk : markAdd;
      renderer.setRenderTarget(c.ink ? inkComposite : markComposite);
      renderer.render(scene, camera);
    }
    mesh.material = tattoo;
    renderer.setRenderTarget(inkComposite);
    for (const t of placement.tattoos) {
      setTattoo(t);
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
  } finally {
    renderer.setRenderTarget(previous);
    renderer.setClearColor(clear, clearAlpha);
    renderer.autoClear = autoClear;
    for (const d of [geometry, coverMaterial, tattoo, markAdd, markInk, quad, inkPage, markPage])
      d.dispose();
    for (const t of [inkComposite, markComposite, cover]) t.dispose();
    for (const t of textures.values()) t.dispose();
  }
  return { texture: art.texture, dispose: () => art.dispose() };
}
