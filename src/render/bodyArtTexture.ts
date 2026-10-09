/**
 * A figure's body-art texture (docs/ARCHITECTURE.md, "Body art"): its tattoos
 * baked into the body's UV space, per figure, since placement is per figure
 * while the field atlas is shared. Two pages of an RGBA8 array:
 *
 * - page 0, ink: colour sRGB-encoded (dark inks keep their precision in eight
 *   bits) and coverage in alpha;
 * - page 1, what marks change in the skin, filled by the marks.
 *
 * Each tattoo is drawn by drawing the body in UV space and projecting the image
 * along the tattoo's frame (`DecalFrame`) from the figure's morphed rest
 * surface, so a tattoo crosses a UV seam whole: both sides of the seam are the
 * same place on the body. Ink spreads a little in the dermis, so each texel
 * averages the image over a disc `INK_SPREAD` across. The tattoos composite in
 * order (a later one over an earlier one) in half float, linear and
 * premultiplied, and the gutter pass then writes the page.
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
  WebGLArrayRenderTarget,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import type { BodyArtPlacement, PlacedTattoo } from "../bodyArt/decals.ts";
import { INK_DEPTH } from "../bodyArt/ink.ts";
import { COVER_FRAGMENT, NEAREST_COVERED, QUAD_VERTEX, UV_RASTER_VERTEX } from "./uvRaster.ts";

/** Pages of a body-art texture: ink, then marks. */
export const BODY_ART_PAGES = 2;

/**
 * How far ink spreads sideways in the dermis, metres: about its depth (light
 * diffusing back up from it spreads as far as it travels). A CHOICE
 * (research/BODY-ART.md C1).
 */
export const INK_SPREAD = INK_DEPTH;

/**
 * How far off the skin's plane at a tattoo's centre the projection still
 * reaches, as a share of the tattoo's longer side, and at least `DECAL_REACH_MIN`
 * metres: enough to follow the skin's curve under the tattoo, too little to
 * reach a limb behind it. A CHOICE.
 */
export const DECAL_REACH = 0.3;
export const DECAL_REACH_MIN = 0.01;
/** The least the skin may face the tattoo (cosine) and still take its ink: the projection's far sides are skipped. */
export const DECAL_FACING = 0.2;

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

/** Twelve points spread evenly over the unit disc (a Fibonacci spiral). */
const DISC = Array.from({ length: 12 }, (_, i) => {
  const r = Math.sqrt((i + 0.5) / 12);
  const a = i * 2.399963229728653;
  return [r * Math.cos(a), r * Math.sin(a)];
});

const DECAL_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D image;
uniform vec3 centre;
uniform vec3 right;
uniform vec3 up;
uniform vec3 normal;
uniform vec2 size;
uniform float reach;
uniform float density;
uniform vec2 spread;
in vec3 vPosition;
in vec3 vNormal;
out vec4 color;
const vec2 DISC[12] = vec2[12](${DISC.map(([x, y]) => `vec2(${(x as number).toFixed(6)}, ${(y as number).toFixed(6)})`).join(", ")});
void main() {
  vec3 d = vPosition - centre;
  if (abs(dot(d, normal)) > reach || dot(normalize(vNormal), normal) < ${DECAL_FACING.toFixed(3)}) discard;
  vec2 st = vec2(dot(d, right) / size.x, dot(d, up) / size.y) + 0.5;
  vec2 pad = spread;
  if (st.x < -pad.x || st.y < -pad.y || st.x > 1.0 + pad.x || st.y > 1.0 + pad.y) discard;
  vec4 ink = vec4(0.0);
  for (int i = 0; i < 12; i++) {
    vec2 p = st + DISC[i] * spread;
    if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) continue;
    vec4 s = texture(image, p);
    ink += vec4(s.rgb * s.a, s.a);
  }
  color = ink / 12.0 * density;
}`;

/** Writes a page: the composite's gutter filled, unpremultiplied, colour sRGB-encoded. */
const PAGE_FRAGMENT = /* glsl */ `
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

const target = (size: number, options: ConstructorParameters<typeof WebGLRenderTarget>[2]) =>
  new WebGLRenderTarget(size, size, {
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    generateMipmaps: false,
    depthBuffer: false,
    ...options,
  });

/**
 * Bakes the placement's tattoos for a figure whose surface is `surface`; the
 * caller owns the result and disposes it. Throws `RangeError` for a tattoo
 * whose image is not in `images`.
 */
export function bakeBodyArt(
  renderer: WebGLRenderer,
  surface: BodyArtSurface,
  placement: BodyArtPlacement,
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
  const composite = target(size, { type: HalfFloatType });
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
  const raster = { glslVersion: GLSL3, depthTest: false, depthWrite: false, side: DoubleSide };
  const coverMaterial = new RawShaderMaterial({
    ...raster,
    vertexShader: UV_RASTER_VERTEX,
    fragmentShader: COVER_FRAGMENT,
    blending: NoBlending,
  });
  const u = {
    image: { value: null as Texture | null },
    centre: { value: new Vector3() },
    right: { value: new Vector3() },
    up: { value: new Vector3() },
    normal: { value: new Vector3() },
    size: { value: new Vector2() },
    reach: { value: 0 },
    density: { value: 1 },
    spread: { value: new Vector2() },
  };
  const decal = new RawShaderMaterial({
    ...raster,
    vertexShader: DECAL_VERTEX,
    fragmentShader: DECAL_FRAGMENT,
    // Premultiplied "over": each tattoo over those before it.
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
    uniforms: u,
  });
  const mesh = new Mesh(geometry, coverMaterial);
  mesh.frustumCulled = false;
  const scene = new Scene().add(mesh);
  const quad = new PlaneGeometry(2, 2);
  const page = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: QUAD_VERTEX,
    fragmentShader: PAGE_FRAGMENT,
    uniforms: {
      composite: { value: composite.texture },
      cover: { value: cover.texture },
      texel: { value: 1 / size },
    },
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
  });
  const quadMesh = new Mesh(quad, page);
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
  const setDecal = (t: PlacedTattoo) => {
    const image = images[t.image] as TexImageSource & { width: number; height: number };
    const height = (t.width * image.height) / Math.max(1, image.width);
    u.image.value = imageTexture(t.image);
    u.centre.value.fromArray(t.centre);
    u.right.value.fromArray(t.right);
    u.up.value.fromArray(t.up);
    u.normal.value.fromArray(t.normal);
    u.size.value.set(t.width, height);
    u.reach.value = Math.max(DECAL_REACH_MIN, DECAL_REACH * Math.max(t.width, height));
    u.density.value = t.density;
    u.spread.value.set(INK_SPREAD / t.width, INK_SPREAD / height);
  };

  const previous = renderer.getRenderTarget();
  const clear = renderer.getClearColor(new Color());
  const clearAlpha = renderer.getClearAlpha();
  const autoClear = renderer.autoClear;
  renderer.setClearColor(0x000000, 0);
  // The tattoos composite over one another: each pass must keep what is drawn.
  renderer.autoClear = false;
  try {
    renderer.setRenderTarget(cover);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(composite);
    renderer.clear();
    mesh.material = decal;
    for (const t of placement.tattoos) {
      setDecal(t);
      renderer.render(scene, camera);
    }
    renderer.setRenderTarget(art, 0);
    renderer.clear();
    renderer.render(quadScene, camera);
    renderer.setRenderTarget(art, 1);
    renderer.clear();
  } finally {
    renderer.setRenderTarget(previous);
    renderer.setClearColor(clear, clearAlpha);
    renderer.autoClear = autoClear;
    geometry.dispose();
    coverMaterial.dispose();
    decal.dispose();
    quad.dispose();
    page.dispose();
    composite.dispose();
    cover.dispose();
    for (const t of textures.values()) t.dispose();
  }
  return { texture: art.texture, dispose: () => art.dispose() };
}
