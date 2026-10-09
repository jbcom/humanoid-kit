/**
 * The skin layers' field atlas (src/surface/layers.ts): every layer's mask and
 * coordinate rasterised once into the body's UV space and shared by every
 * figure, since the fields depend on the base mesh alone.
 *
 * Four channels per page of an array texture, laid out by an `AtlasPlan`: each
 * layer's mask, the coordinate of each layer whose shader reads one, and one
 * coordinate between the layers of a coordinate group. Texels outside the UV islands are filled from the
 * nearest covered texel (`uvRaster.ts`), so bilinear filtering at an island's
 * edge never blends in empty texels and draws a seam.
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
import { type AtlasPlan, OWNER_GRID, vertexOwners } from "../surface/atlasPlan.ts";
import type { LayerFieldsExtra, LayerFieldsUpdate } from "../surface/layers.ts";
import {
  COVER_FRAGMENT,
  NEAREST_COVERED,
  QUAD_VERTEX,
  UV_RASTER_VERTEX as RASTER_VERTEX,
} from "./uvRaster.ts";

/** What a skin material reads the layers' fields from: the atlas, the owner maps and the plan that lays them out. */
export interface SkinLayerAtlas {
  texture: Texture;
  /** One owner map per shared channel, four to a page (`OWNER_GRID`² cells, read exactly). */
  owners: Texture;
  plan: AtlasPlan;
}

export interface LayerAtlas extends SkinLayerAtlas {
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

const RASTER_FRAGMENT = /* glsl */ `
precision highp float;
in vec4 vFields;
out vec4 color;
void main() { color = vFields; }`;

const DILATE_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D fields;
uniform sampler2D cover;
uniform float texel;
in vec2 vUv;
out vec4 color;
${NEAREST_COVERED}
void main() { color = hkNearestCovered(fields, cover, vUv, texel); }`;

/** What a channel holds: the masks (field 0) or the coordinates (field 1) of the layers that share it. */
interface Held {
  field: 0 | 1;
  layers: number[];
}

/** The holder of each channel of the plan. */
function channelHolders(plan: AtlasPlan): (Held | undefined)[] {
  const out: (Held | undefined)[] = new Array(plan.channels).fill(undefined);
  const add = (channels: Int16Array, field: 0 | 1) =>
    channels.forEach((c, l) => {
      if (c < 0) return;
      const held = out[c];
      if (held) held.layers.push(l);
      else out[c] = { field, layers: [l] };
    });
  add(plan.value, 0);
  add(plan.coord, 1);
  return out;
}

/**
 * Writes one channel's values per vertex into component `k` of the raster's
 * `fields`. A channel several layers share holds, at each vertex, the field of
 * the layer that vertex belongs to (their supports are apart: `vertexOwners`).
 */
function fillChannel(fields: Float32Array, k: number, source: LayerAtlasSource, held: Held): void {
  const n = source.vertexCount;
  const f = source.layerFields;
  const [only] = held.layers;
  if (held.layers.length === 1 && only !== undefined) {
    for (let v = 0; v < n; v++) fields[v * 4 + k] = f[(only * n + v) * 2 + held.field] as number;
    return;
  }
  const owners = vertexOwners(source, held.layers);
  for (let v = 0; v < n; v++) {
    const member = owners[v] as number;
    const l = member < 0 ? undefined : held.layers[member];
    fields[v * 4 + k] = l === undefined ? 0 : (f[(l * n + v) * 2 + held.field] as number);
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

/**
 * The source with extra triangles after the body's: their vertices follow the
 * body's, each layer's block holds the body's fields and then the extra's (zero
 * for a layer the update does not hold).
 */
export function withExtra(
  source: LayerAtlasSource,
  at: readonly number[],
  extra: LayerFieldsExtra,
): LayerAtlasSource {
  const n = source.vertexCount;
  const ne = extra.uvs.length / 2;
  const total = n + ne;
  const layers = source.layers.length;
  const uvs = new Float32Array(total * 2);
  uvs.set(source.uvs);
  uvs.set(extra.uvs, n * 2);
  const index = new Uint32Array(source.index.length + extra.index.length);
  index.set(source.index);
  extra.index.forEach((v, i) => {
    index[source.index.length + i] = v + n;
  });
  const layerFields = new Float32Array(layers * total * 2);
  for (let l = 0; l < layers; l++) {
    layerFields.set(source.layerFields.subarray(l * n * 2, (l + 1) * n * 2), l * total * 2);
    const k = at.indexOf(l);
    if (k >= 0)
      layerFields.set(
        extra.layerFields.subarray(k * ne * 2, (k + 1) * ne * 2),
        (l * total + n) * 2,
      );
  }
  return { ...source, uvs, index, vertexCount: total, layerFields };
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
  const owners = ownerTexture(source.plan);
  return {
    texture: atlas.texture,
    owners,
    plan: source.plan,
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
        touched.add((source.plan.value[l] as number) >> 2);
        const coord = source.plan.coord[l] as number;
        if (coord >= 0) touched.add(coord >> 2);
      }
      // The islands' triangles are drawn with the body's, from the same fields' layout.
      const drawn = update.extra ? withExtra(source, at, update.extra) : source;
      rasterisePages(renderer, drawn, atlas, [...touched], size);
    },
    dispose() {
      atlas.dispose();
      owners.dispose();
    },
  };
}

/** The plan's owner maps as an array texture, four to a page, ids in the channels. */
function ownerTexture(plan: AtlasPlan): DataArrayTexture {
  const cells = OWNER_GRID * OWNER_GRID;
  const pages = Math.max(1, Math.ceil(plan.ownerChannels / 4));
  const data = new Uint8Array(pages * cells * 4).fill(255);
  for (let c = 0; c < plan.ownerChannels; c++) {
    const page = c >> 2;
    const component = c & 3;
    for (let i = 0; i < cells; i++)
      data[(page * cells + i) * 4 + component] = plan.ownerMaps[c * cells + i] as number;
  }
  const t = new DataArrayTexture(data, OWNER_GRID, OWNER_GRID, pages);
  t.minFilter = NearestFilter;
  t.magFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
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
): SkinLayerAtlas & { refresh(update: LayerFieldsUpdate): void; release(): void } {
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
    owners: held.atlas.owners,
    plan: held.atlas.plan,
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

/** An owner texture that owns no cell (every cell 255): one page, for a material without an atlas. */
export function emptyOwners(): DataArrayTexture {
  const t = new DataArrayTexture(new Uint8Array(4).fill(255), 1, 1, 1);
  t.minFilter = NearestFilter;
  t.magFilter = NearestFilter;
  t.needsUpdate = true;
  return t;
}
