/**
 * The skin layers' field atlas (src/surface/layers.ts): every layer's mask and
 * coordinate rasterised once into the body's UV space and shared by every
 * figure, since the fields depend on the base mesh alone.
 *
 * Four channels per page of an array texture, laid out by an `AtlasPlan`: each
 * layer's mask, the coordinate of each layer whose shader reads one, and one
 * coordinate between the layers of a coordinate group. Texels outside the UV islands are filled from the
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
import type { AtlasPlan } from "../surface/atlasPlan.ts";
import type { LayerFieldsUpdate } from "../surface/layers.ts";

/** Texels of gutter filled around each UV island. */
export const GUTTER = 4;

export interface LayerAtlas {
  /** Stays the same object for the atlas's life, refreshes included. */
  texture: Texture;
  pages: number;
  /**
   * Replaces some layers' fields in place and re-rasterises only the pages
   * that hold them (the other layers on those pages keep the source's fields):
   * no new texture, so no shader recompile, and nothing is re-evaluated. This
   * is how the adult anatomy's fields, which arrive after the atlas exists,
   * reach it. The source's `layerFields` are updated too. Throws `RangeError`
   * for a layer the atlas does not hold or fields of the wrong length.
   */
  refresh(update: LayerFieldsUpdate): void;
  dispose(): void;
}

export interface LayerAtlasSource {
  uvs: Float32Array;
  index: Uint32Array | Uint16Array;
  vertexCount: number;
  /** `layers.length` blocks of `vertexCount` (mask, coord) pairs. */
  layerFields: Float32Array;
  layers: readonly string[];
  /** Where each layer's fields go: `planAtlas` of the layers, which the skin material is built from too. */
  plan: AtlasPlan;
}

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

/** What a channel holds: one layer's mask, or the coordinate of the layers that share it. */
type Held = { mask: number } | { coord: number[] };

/** The holder of each channel of the plan. */
function channelHolders(plan: AtlasPlan): (Held | undefined)[] {
  const out: (Held | undefined)[] = new Array(plan.channels).fill(undefined);
  plan.mask.forEach((c, l) => {
    out[c] = { mask: l };
  });
  plan.coord.forEach((c, l) => {
    if (c < 0) return;
    const held = out[c];
    if (held && "coord" in held) held.coord.push(l);
    else out[c] = { coord: [l] };
  });
  return out;
}

/**
 * Writes one channel's values per vertex into component `k` of the raster's
 * `fields`. A shared coordinate takes, at each vertex, the value of the layer
 * whose mask is strongest there: the layers agree wherever more than one reaches.
 */
function fillChannel(fields: Float32Array, k: number, source: LayerAtlasSource, held: Held): void {
  const n = source.vertexCount;
  const f = source.layerFields;
  if ("mask" in held) {
    for (let v = 0; v < n; v++) fields[v * 4 + k] = f[(held.mask * n + v) * 2] as number;
    return;
  }
  for (let v = 0; v < n; v++) {
    let best = held.coord[0] as number;
    let strongest = -1;
    for (const l of held.coord) {
      const m = f[(l * n + v) * 2] as number;
      if (m > strongest) {
        strongest = m;
        best = l;
      }
    }
    fields[v * 4 + k] = f[(best * n + v) * 2 + 1] as number;
  }
}

/**
 * Rasterises the given pages of the atlas from the source's fields (each page
 * holds four channels, laid out by the source's plan; the others are not touched). Its scratch targets, cover
 * mask and materials live for this call only.
 */
function rasterisePages(
  renderer: WebGLRenderer,
  source: LayerAtlasSource,
  atlas: WebGLArrayRenderTarget,
  pageList: readonly number[],
  size: number,
): void {
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
    const holders = channelHolders(source.plan);
    for (const p of pageList) {
      fields.fill(0);
      for (let k = 0; k < 4; k++) {
        const held = holders[p * 4 + k];
        if (held) fillChannel(fields, k, source, held);
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
}

/** Rasterises the fields; the caller owns the result and disposes it. */
export function buildLayerAtlas(
  renderer: WebGLRenderer,
  source: LayerAtlasSource,
  size = 1024,
): LayerAtlas {
  const pages = source.plan.pages;
  const atlas = new WebGLArrayRenderTarget(size, size, pages, {
    type: UnsignedByteType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    generateMipmaps: false,
    depthBuffer: false,
  });
  rasterisePages(
    renderer,
    source,
    atlas,
    Array.from({ length: pages }, (_, p) => p),
    size,
  );
  return {
    texture: atlas.texture,
    pages,
    refresh(update) {
      const n = source.vertexCount;
      const at = update.layers.map((id) => {
        const l = source.layers.indexOf(id);
        if (l < 0) throw new RangeError(`layer atlas: no layer ${id}`);
        return l;
      });
      if (update.layerFields.length !== at.length * n * 2)
        throw new RangeError(
          `layer atlas: fields for ${at.length} layers need ${at.length * n * 2} values, got ${update.layerFields.length}`,
        );
      // The source keeps the new fields, so an atlas built from it later agrees.
      at.forEach((l, k) => {
        source.layerFields.set(update.layerFields.subarray(k * n * 2, (k + 1) * n * 2), l * n * 2);
      });
      // The pages of each updated layer's mask and of the coordinate it reads.
      const touched = new Set<number>();
      for (const l of at) {
        touched.add((source.plan.mask[l] as number) >> 2);
        const coord = source.plan.coord[l] as number;
        if (coord >= 0) touched.add(coord >> 2);
      }
      rasterisePages(renderer, source, atlas, [...touched], size);
    },
    dispose: () => atlas.dispose(),
  };
}

const shared = new WeakMap<
  WebGLRenderer,
  WeakMap<
    LayerAtlasSource,
    { atlas: LayerAtlas; users: number; applied: WeakSet<LayerFieldsUpdate> }
  >
>();

/**
 * The atlas for `source` on `renderer`, built on first use and shared by every
 * figure drawing the same body; call `release` when done with it, and the last
 * release disposes it. `refresh` applies an update to the shared atlas once,
 * however many figures hand over the same one (the worker's answer is shared).
 */
export function acquireLayerAtlas(
  renderer: WebGLRenderer,
  source: LayerAtlasSource,
): { texture: Texture; refresh(update: LayerFieldsUpdate): void; release(): void } {
  let byBody = shared.get(renderer);
  if (!byBody) {
    byBody = new WeakMap();
    shared.set(renderer, byBody);
  }
  let entry = byBody.get(source);
  if (!entry) {
    entry = { atlas: buildLayerAtlas(renderer, source), users: 0, applied: new WeakSet() };
    byBody.set(source, entry);
  }
  entry.users++;
  const held = entry;
  let released = false;
  return {
    texture: held.atlas.texture,
    refresh(update) {
      if (released || held.applied.has(update)) return;
      held.applied.add(update);
      held.atlas.refresh(update);
    },
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
