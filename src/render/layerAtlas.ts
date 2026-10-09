/**
 * The skin layers' field atlas (src/surface/layers.ts): every layer's mask and
 * coordinate rasterised once into the body's UV space and shared by every
 * figure, since the fields depend on the base mesh alone.
 *
 * Two layers per page of an array texture: (mask, coord) of layer 2p in RG and
 * of layer 2p + 1 in BA. Texels outside the UV islands are filled from the
 * nearest covered texel (a gutter of `GUTTER` texels), so bilinear filtering
 * at an island's edge never blends in empty texels and draws a seam.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataArrayTexture,
  DoubleSide,
  GLSL3,
  LinearFilter,
  Mesh,
  NearestFilter,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  RawShaderMaterial,
  RedFormat,
  Scene,
  type Texture,
  UnsignedByteType,
  WebGLArrayRenderTarget,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";

/** Texels of gutter filled around each UV island. */
export const GUTTER = 4;

export interface LayerAtlas {
  texture: Texture;
  pages: number;
  dispose(): void;
}

export interface LayerAtlasSource {
  uvs: Float32Array;
  index: Uint32Array | Uint16Array;
  vertexCount: number;
  /** `layers.length` blocks of `vertexCount` (mask, coord) pairs. */
  layerFields: Float32Array;
  layers: readonly string[];
}

/** Pages needed for `count` layers (at least one, so the sampler is always valid). */
export const atlasPages = (count: number) => Math.max(1, Math.ceil(count / 2));

const RASTER_VERTEX = /* glsl */ `
in vec2 uv;
in vec4 fields;
out vec4 vFields;
void main() {
  vFields = fields;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}`;

const RASTER_FRAGMENT = /* glsl */ `
precision highp float;
in vec4 vFields;
out vec4 color;
void main() { color = vFields; }`;

const COVER_FRAGMENT = /* glsl */ `
precision highp float;
out vec4 color;
void main() { color = vec4(1.0); }`;

const QUAD_VERTEX = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const DILATE_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D fields;
uniform sampler2D cover;
uniform float texel;
in vec2 vUv;
out vec4 color;
void main() {
  if (texture(cover, vUv).r > 0.5) { color = texture(fields, vUv); return; }
  float best = 1e9;
  color = vec4(0.0);
  for (int y = -${GUTTER}; y <= ${GUTTER}; y++)
    for (int x = -${GUTTER}; x <= ${GUTTER}; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 p = vUv + o * texel;
      float d = dot(o, o);
      if (d < best && texture(cover, p).r > 0.5) { best = d; color = texture(fields, p); }
    }
}`;

/** Rasterises the fields; the caller owns the result and disposes it. */
export function buildLayerAtlas(
  renderer: WebGLRenderer,
  source: LayerAtlasSource,
  size = 1024,
): LayerAtlas {
  const pages = atlasPages(source.layers.length);
  const atlas = new WebGLArrayRenderTarget(size, size, pages, {
    type: UnsignedByteType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    generateMipmaps: false,
    depthBuffer: false,
  });
  const scratch = new WebGLRenderTarget(size, size, {
    type: UnsignedByteType,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    generateMipmaps: false,
    depthBuffer: false,
  });
  const cover = new WebGLRenderTarget(size, size, {
    format: RedFormat,
    type: UnsignedByteType,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    generateMipmaps: false,
    depthBuffer: false,
  });
  const camera = new OrthographicCamera();
  const n = source.vertexCount;
  const geometry = new BufferGeometry();
  geometry.setAttribute("uv", new BufferAttribute(source.uvs, 2));
  geometry.setIndex(new BufferAttribute(source.index, 1));
  const fields = new Float32Array(n * 4);
  geometry.setAttribute("fields", new BufferAttribute(fields, 4));
  // Positions come from the UVs in the shader; three still wants a position attribute to draw.
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(n * 3), 3));
  const raster = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: RASTER_VERTEX,
    fragmentShader: RASTER_FRAGMENT,
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
  });
  const coverMaterial = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: RASTER_VERTEX,
    fragmentShader: COVER_FRAGMENT,
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
  });
  const mesh = new Mesh(geometry, coverMaterial);
  mesh.frustumCulled = false;
  const scene = new Scene();
  scene.add(mesh);

  const quad = new PlaneGeometry(2, 2);
  const dilate = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: QUAD_VERTEX,
    fragmentShader: DILATE_FRAGMENT,
    uniforms: {
      fields: { value: scratch.texture },
      cover: { value: cover.texture },
      texel: { value: 1 / size },
    },
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
  });
  const quadMesh = new Mesh(quad, dilate);
  quadMesh.frustumCulled = false;
  const quadScene = new Scene();
  quadScene.add(quadMesh);

  const previous = renderer.getRenderTarget();
  const clear = renderer.getClearColor(new Color());
  const clearAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 0);
  try {
    renderer.setRenderTarget(cover);
    renderer.clear();
    renderer.render(scene, camera);
    mesh.material = raster;
    for (let p = 0; p < pages; p++) {
      fields.fill(0);
      for (let k = 0; k < 2; k++) {
        const l = p * 2 + k;
        if (l >= source.layers.length) break;
        for (let v = 0; v < n; v++) {
          fields[v * 4 + k * 2] = source.layerFields[(l * n + v) * 2] as number;
          fields[v * 4 + k * 2 + 1] = source.layerFields[(l * n + v) * 2 + 1] as number;
        }
      }
      (geometry.getAttribute("fields") as BufferAttribute).needsUpdate = true;
      renderer.setRenderTarget(scratch);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(atlas, p);
      renderer.clear();
      renderer.render(quadScene, camera);
    }
  } finally {
    renderer.setRenderTarget(previous);
    renderer.setClearColor(clear, clearAlpha);
    geometry.dispose();
    raster.dispose();
    coverMaterial.dispose();
    quad.dispose();
    dilate.dispose();
    scratch.dispose();
    cover.dispose();
  }
  return { texture: atlas.texture, pages, dispose: () => atlas.dispose() };
}

const shared = new WeakMap<
  WebGLRenderer,
  WeakMap<LayerAtlasSource, { atlas: LayerAtlas; users: number }>
>();

/**
 * The atlas for `source` on `renderer`, built on first use and shared by every
 * figure drawing the same body; call `release` when done with it, and the last
 * release disposes it.
 */
export function acquireLayerAtlas(
  renderer: WebGLRenderer,
  source: LayerAtlasSource,
): { texture: Texture; release(): void } {
  let byBody = shared.get(renderer);
  if (!byBody) {
    byBody = new WeakMap();
    shared.set(renderer, byBody);
  }
  let entry = byBody.get(source);
  if (!entry) {
    entry = { atlas: buildLayerAtlas(renderer, source), users: 0 };
    byBody.set(source, entry);
  }
  entry.users++;
  const held = entry;
  let released = false;
  return {
    texture: held.atlas.texture,
    release() {
      if (released) return;
      released = true;
      if (--held.users === 0) {
        held.atlas.dispose();
        byBody.delete(source);
      }
    },
  };
}

/** An all-zero atlas: every layer absent. Used before the real one is built. */
export function emptyLayerAtlas(pages: number): DataArrayTexture {
  const t = new DataArrayTexture(new Uint8Array(4 * pages), 1, 1, pages);
  t.needsUpdate = true;
  return t;
}
