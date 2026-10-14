/**
 * The miniature runtime (docs/MINIATURES.md): hundreds of baked figures
 * (`MiniatureBake`) drawn as one `InstancedMesh` per archetype and level of
 * detail.
 *
 * - **Vertex animation textures.** Each archetype's frames live in one
 *   half-float texture (positions) and one byte texture per level (octahedral
 *   normals), texel `frame × vertexCount + vertex`. The vertex shader reads its
 *   two nearest frames by `gl_VertexID` and the instance's clip (`aAnim`: first
 *   frame, frame count (negative for a clip that holds its last frame), frames
 *   per second times speed, and a time offset), and blends them. A static
 *   casting is the one-frame case.
 * - **Colour.** The baked sRGB vertex colour, times the instance's tint for the
 *   vertex's channel (`TINT_CHANNELS`: skin is never tinted).
 * - **Levels of detail against a budget.** Each `update` culls figures outside
 *   the camera's frustum, then gives the nearest figures the finest level their
 *   size on screen warrants while the triangle budget lasts; the rest take the
 *   coarsest. Draw calls are archetypes times levels in use.
 */
import {
  BufferAttribute,
  BufferGeometry,
  type Camera,
  Color,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  FloatType,
  Frustum,
  Group,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  MeshStandardMaterial,
  type MeshStandardMaterialParameters,
  OrthographicCamera,
  PerspectiveCamera,
  RGBAFormat,
  RGFormat,
  Sphere,
  SRGBColorSpace,
  UnsignedByteType,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from "three";
import { octEncode, toHalf } from "../bake/format.ts";
import type { MiniatureAlphaCard, MiniatureBake } from "../bake/miniature.ts";
import { HAIR_ALPHA_CUTOFF } from "./hairMaterial.ts";

/** Linear RGB. */
export type MiniatureTint = readonly [number, number, number];

/** One figure on the table. */
export interface MiniatureFigure {
  /** Index into the crowd's archetypes. */
  archetype: number;
  x: number;
  y?: number;
  z: number;
  /** Turn about the vertical axis, radians (0 faces +z). */
  heading?: number;
  /** Uniform scale (a general at 1.6). Default 1. */
  scale?: number;
  /** The clip to play, by its baked name; default the archetype's first (or its one pose). */
  clip?: string;
  /** Seconds into the clip at time 0, so figures of one archetype do not march in step. */
  phase?: number;
  /** Playback rate. Default 1. */
  speed?: number;
  /** Tints for the `upper`, `lower` and `accessory` channels (linear RGB); default white. */
  tints?: readonly [MiniatureTint, MiniatureTint, MiniatureTint];
}

export interface MiniatureCrowdOptions {
  /** Most figures the crowd holds (default 1024). */
  maxFigures?: number | undefined;
  /** Triangles every figure together may draw (default 250,000, the issue's budget). */
  triangleBudget?: number | undefined;
  /**
   * Per level, finest first, the smallest on-screen height (pixels) at which a
   * figure may take it; default 64 for every level but the coarsest, which
   * takes any size.
   */
  levelPixels?: readonly number[] | undefined;
  /** Overrides for each archetype's `MeshStandardMaterial` (roughness, metalness...). */
  material?: MeshStandardMaterialParameters | undefined;
}

/** What the last `update` drew. */
export interface MiniatureFrameStats {
  /** Figures inside the frustum. */
  visible: number;
  /** Figures per level, finest first, over every archetype. */
  perLevel: number[];
  triangles: number;
  /** Instanced draws issued (meshes with at least one instance), shadows not counted. */
  drawCalls: number;
}

/** The widest a VAT texture is (texels); rows grow instead. 2048 fits every WebGL2 device. */
export const VAT_WIDTH = 2048;

const VAT_VERTEX_HEAD = /* glsl */ `
uniform highp sampler2D hkVatPosition;
uniform highp sampler2D hkVatNormal;
uniform int hkVatWidth;
uniform int hkVertexCount;
uniform float hkTime;
attribute vec4 aAnim;
ivec2 hkVat(int i) { return ivec2(i % hkVatWidth, i / hkVatWidth); }
vec3 hkOct(vec2 e) {
  vec2 s = e * (255.0 / 127.0) - 1.0;
  vec3 n = vec3(s, 1.0 - abs(s.x) - abs(s.y));
  if (n.z < 0.0) n.xy = (1.0 - abs(n.yx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
  return normalize(n);
}
`;

const VERTEX_HEAD = /* glsl */ `
${VAT_VERTEX_HEAD}
attribute vec3 aTint1;
attribute vec3 aTint2;
attribute vec3 aTint3;
attribute float aChannel;
vec3 hkSrgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
`;

/** The vertex's two frames and their blend, shared by position and normal. */
const VERTEX_FRAMES = /* glsl */ `
  float hkFrames = abs(aAnim.y);
  float hkT = (hkTime + aAnim.w) * aAnim.z;
  float hkF = aAnim.y > 0.0 ? mod(hkT, hkFrames) : clamp(hkT, 0.0, hkFrames - 1.0);
  int hkF0 = int(floor(hkF));
  float hkW = hkF - float(hkF0);
  int hkN = int(hkFrames);
  int hkF1 = aAnim.y > 0.0 ? (hkF0 + 1) % hkN : min(hkF0 + 1, hkN - 1);
  int hkI0 = (int(aAnim.x) + hkF0) * hkVertexCount + gl_VertexID;
  int hkI1 = (int(aAnim.x) + hkF1) * hkVertexCount + gl_VertexID;
`;

class MiniatureMaterial extends MeshStandardMaterial {
  readonly hkUniforms: Record<string, { value: unknown }>;
  constructor(
    position: DataTexture,
    normal: DataTexture,
    vertexCount: number,
    params: MeshStandardMaterialParameters,
  ) {
    super({ roughness: 0.85, metalness: 0, vertexColors: true, ...params });
    this.hkUniforms = {
      hkVatPosition: { value: position },
      hkVatNormal: { value: normal },
      hkVatWidth: { value: position.image.width },
      hkVertexCount: { value: vertexCount },
      hkTime: { value: 0 },
    };
  }
  override customProgramCacheKey(): string {
    return "hk-miniature";
  }
  override onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, this.hkUniforms);
    shader.vertexShader = `${VERTEX_HEAD}${shader.vertexShader}`
      .replace(
        "#include <beginnormal_vertex>",
        `${VERTEX_FRAMES}
  vec3 objectNormal = normalize(mix(
    hkOct(texelFetch(hkVatNormal, hkVat(hkI0), 0).xy),
    hkOct(texelFetch(hkVatNormal, hkVat(hkI1), 0).xy), hkW));
  #ifdef USE_TANGENT
  vec3 objectTangent = vec3(1.0, 0.0, 0.0);
  #endif`,
      )
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = mix(
    texelFetch(hkVatPosition, hkVat(hkI0), 0).xyz,
    texelFetch(hkVatPosition, hkVat(hkI1), 0).xyz, hkW);`,
      )
      .replace(
        "#include <color_vertex>",
        `#include <color_vertex>
  vec3 hkTint = aChannel < 0.5 ? vec3(1.0) : aChannel < 1.5 ? aTint1 : aChannel < 2.5 ? aTint2 : aTint3;
  vColor.rgb = hkSrgbToLinear(color.rgb) * hkTint;`,
      );
  };
}

/** The source-card companion material: embedded RGBA alpha is cut out before lighting. */
class AlphaCardMaterial extends MeshStandardMaterial {
  readonly hkUniforms: Record<string, { value: unknown }>;
  constructor(
    position: DataTexture,
    normal: DataTexture,
    vertexCount: number,
    card: MiniatureAlphaCard,
  ) {
    const map = new DataTexture(
      card.texture.rgba,
      card.texture.width,
      card.texture.height,
      RGBAFormat,
      UnsignedByteType,
    );
    // Decoded image rows begin at the top; retain the live source TextureLoader convention.
    map.flipY = true;
    map.magFilter = LinearFilter;
    map.minFilter = LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.colorSpace = SRGBColorSpace;
    map.needsUpdate = true;
    super({
      color: new Color(card.tint[0], card.tint[1], card.tint[2]),
      map,
      roughness: 0.85,
      metalness: 0,
      alphaTest: HAIR_ALPHA_CUTOFF,
      side: DoubleSide,
    });
    this.hkUniforms = {
      hkVatPosition: { value: position },
      hkVatNormal: { value: normal },
      hkVatWidth: { value: position.image.width },
      hkVertexCount: { value: vertexCount },
      hkTime: { value: 0 },
    };
  }
  override customProgramCacheKey(): string {
    return "hk-miniature-alpha-card";
  }
  override onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, this.hkUniforms);
    shader.vertexShader = `${VAT_VERTEX_HEAD}${shader.vertexShader}`
      .replace(
        "#include <beginnormal_vertex>",
        `${VERTEX_FRAMES}
  vec3 objectNormal = normalize(mix(
    texelFetch(hkVatNormal, hkVat(hkI0), 0).xyz,
    texelFetch(hkVatNormal, hkVat(hkI1), 0).xyz, hkW));
  #ifdef USE_TANGENT
  vec3 objectTangent = vec3(1.0, 0.0, 0.0);
  #endif`,
      )
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = mix(
    texelFetch(hkVatPosition, hkVat(hkI0), 0).xyz,
    texelFetch(hkVatPosition, hkVat(hkI1), 0).xyz, hkW);`,
      );
  };
}

/** A texture of `texels` RGBA half floats or RG bytes, `VAT_WIDTH` wide. */
function vatTexture(data: Uint16Array | Uint8Array, texels: number, kind: "position" | "normal") {
  const height = Math.max(1, Math.ceil(texels / VAT_WIDTH));
  const channels = kind === "position" ? 4 : 2;
  const full =
    kind === "position"
      ? new Uint16Array(VAT_WIDTH * height * channels)
      : new Uint8Array(VAT_WIDTH * height * channels);
  full.set(data);
  const t = new DataTexture(
    full,
    VAT_WIDTH,
    height,
    kind === "position" ? RGBAFormat : RGFormat,
    kind === "position" ? HalfFloatType : UnsignedByteType,
  );
  t.needsUpdate = true;
  return t;
}

/** A source-card frame stream stays float precision, separate from opaque miniatures' compact VAT. */
function alphaCardVatTexture(
  values: Float32Array,
  vertexCount: number,
  frameCount: number,
): DataTexture {
  const texels = vertexCount * frameCount;
  const height = Math.max(1, Math.ceil(texels / VAT_WIDTH));
  const data = new Float32Array(VAT_WIDTH * height * 4);
  for (let i = 0; i < texels; i++) data.set(values.subarray(i * 3, i * 3 + 3), i * 4);
  const texture = new DataTexture(data, VAT_WIDTH, height, RGBAFormat, FloatType);
  texture.needsUpdate = true;
  return texture;
}

/** One exact source facial card payload, drawn only at the finest miniature level. */
class AlphaCardArchetype {
  readonly mesh: InstancedMesh;
  readonly triangles: number;
  readonly textureBytes: number;
  private readonly textures: DataTexture[];
  private readonly material: AlphaCardMaterial;
  constructor(card: MiniatureAlphaCard, frameCount: number, capacity: number) {
    const position = alphaCardVatTexture(card.positions, card.vertexCount, frameCount);
    const normal = alphaCardVatTexture(card.normals, card.vertexCount, frameCount);
    this.material = new AlphaCardMaterial(position, normal, card.vertexCount, card);
    this.textures = [position, normal, this.material.map as DataTexture];
    this.textureBytes = this.textures.reduce(
      (sum, texture) => sum + (texture.image.data as ArrayBufferView).byteLength,
      0,
    );
    // The GPU-generated source-map pyramid is resident alongside its embedded base pixels.
    let width = card.texture.width;
    let height = card.texture.height;
    while (width > 1 || height > 1) {
      width = Math.max(1, Math.floor(width / 2));
      height = Math.max(1, Math.floor(height / 2));
      this.textureBytes += width * height * 4;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(card.positions.slice(0, card.vertexCount * 3), 3),
    );
    geometry.setAttribute(
      "normal",
      new BufferAttribute(card.normals.slice(0, card.vertexCount * 3), 3),
    );
    geometry.setAttribute("uv", new BufferAttribute(card.uvs, 2));
    Object.entries(instancedAttributes(capacity)).forEach(([name, attribute]) => {
      geometry.setAttribute(name, attribute);
    });
    geometry.setIndex(
      new BufferAttribute(card.vertexCount > 0xffff ? card.index : Uint16Array.from(card.index), 1),
    );
    this.mesh = new InstancedMesh(geometry, this.material, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.triangles = card.index.length / 3;
  }
  setTime(time: number) {
    (this.material.hkUniforms.hkTime as { value: number }).value = time;
  }
  dispose() {
    this.textures.forEach((texture) => {
      texture.dispose();
    });
    this.material.dispose();
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}

function instancedAttributes(capacity: number) {
  return {
    aAnim: new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(
      DynamicDrawUsage,
    ),
    aTint1: new InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(
      DynamicDrawUsage,
    ),
    aTint2: new InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(
      DynamicDrawUsage,
    ),
    aTint3: new InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(
      DynamicDrawUsage,
    ),
  };
}

/** One archetype on the GPU: its textures, and a mesh per level. */
class Archetype {
  readonly meshes: InstancedMesh[];
  readonly alphaCards: AlphaCardArchetype[];
  readonly triangles: number[];
  readonly alphaCardTriangles: number;
  readonly clips: Map<string, { start: number; frames: number; fps: number; loop: boolean }>;
  readonly height: number;
  readonly radius: number;
  readonly textureBytes: number;
  /** What a figure that names no clip plays: the first clip, or a static casting's one frame. */
  readonly firstClip: { start: number; frames: number; fps: number; loop: boolean };
  private readonly textures: DataTexture[];
  private readonly materials: MiniatureMaterial[];
  constructor(bake: MiniatureBake, capacity: number, params: MeshStandardMaterialParameters) {
    const N = bake.vertexCount;
    const F = bake.frameCount;
    const half = new Uint16Array(F * N * 4);
    for (let i = 0; i < F * N; i++)
      for (let c = 0; c < 3; c++) half[i * 4 + c] = toHalf(bake.positions[i * 3 + c] as number);
    const position = vatTexture(half, F * N, "position");
    const normals = bake.lods.map((l) => {
      const oct = new Uint8Array(F * N * 2);
      for (let i = 0; i < F * N; i++) {
        const [a, b] = octEncode(
          l.normals[i * 3] as number,
          l.normals[i * 3 + 1] as number,
          l.normals[i * 3 + 2] as number,
        );
        // Signed bytes stored offset, as RG8 (a byte's 127 is 0).
        oct[i * 2] = a + 127;
        oct[i * 2 + 1] = b + 127;
      }
      return vatTexture(oct, F * N, "normal");
    });
    this.textures = [position, ...normals];
    // Attributes every level shares: frame 0 (bounds and three's own needs), colour, channel.
    const shared = {
      position: new BufferAttribute(bake.positions.slice(0, N * 3), 3),
      color: new BufferAttribute(bake.colour, 3, true),
      aChannel: new BufferAttribute(Float32Array.from(bake.channel), 1),
    };
    this.materials = normals.map((n) => new MiniatureMaterial(position, n, N, params));
    this.meshes = bake.lods.map((l, k) => {
      const g = new BufferGeometry();
      for (const [name, a] of Object.entries({ ...shared, ...instancedAttributes(capacity) }))
        g.setAttribute(name, a);
      g.setIndex(new BufferAttribute(N > 0xffff ? l.index : Uint16Array.from(l.index), 1));
      const mesh = new InstancedMesh(g, this.materials[k] as MiniatureMaterial, capacity);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      // Figures are culled one by one in `update`; the mesh's own bound is frame 0's.
      mesh.frustumCulled = false;
      mesh.count = 0;
      return mesh;
    });
    this.alphaCards = (bake.alphaCards ?? []).map(
      (card) => new AlphaCardArchetype(card, F, capacity),
    );
    this.textureBytes =
      this.textures.reduce(
        (sum, texture) => sum + (texture.image.data as ArrayBufferView).byteLength,
        0,
      ) + this.alphaCards.reduce((sum, card) => sum + card.textureBytes, 0);
    this.triangles = bake.lods.map((l) => l.index.length / 3);
    this.alphaCardTriangles = this.alphaCards.reduce((sum, card) => sum + card.triangles, 0);
    this.clips = new Map(bake.clips.map((c) => [c.name, c]));
    // `bakeMiniature` includes every alpha-card frame in its public bounds.
    this.height = Math.max(bake.max[1], 1e-3);
    this.radius = Math.hypot(
      Math.max(-bake.min[0], bake.max[0]),
      this.height / 2,
      Math.max(-bake.min[2], bake.max[2]),
    );
    this.firstClip = bake.clips[0] ?? { start: 0, frames: F, fps: 1, loop: true };
  }
  setTime(t: number) {
    // The compiled program holds these uniform objects: set their value, never replace them.
    for (const m of this.materials) (m.hkUniforms.hkTime as { value: number }).value = t;
    this.alphaCards.forEach((card) => {
      card.setTime(t);
    });
  }
  dispose() {
    for (const t of this.textures) t.dispose();
    for (const m of this.materials) m.dispose();
    for (const m of this.meshes) {
      m.geometry.dispose();
      // Frees the instance matrices, which only the mesh's own dispose releases.
      m.dispose();
    }
    this.alphaCards.forEach((card) => {
      card.dispose();
    });
  }
}

const WHITE: MiniatureTint = [1, 1, 1];

/** Many miniature figures of a few baked archetypes; see the module comment. */
export class MiniatureCrowd {
  /** Add this to the scene. */
  readonly object = new Group();
  private readonly archetypes: Archetype[];
  private readonly capacity: number;
  private readonly budget: number;
  private readonly levelPixels: readonly number[];
  private figures: readonly MiniatureFigure[] = [];
  private readonly frustum = new Frustum();
  private readonly matrix = new Matrix4();
  private readonly sphere = new Sphere();
  private readonly v = new Vector3();
  private order = new Int32Array(0);
  private distance = new Float32Array(0);
  private pixels = new Float32Array(0);

  constructor(bakes: readonly MiniatureBake[], options: MiniatureCrowdOptions = {}) {
    if (!bakes.length) throw new RangeError("a crowd needs at least one archetype");
    const levels = (bakes[0] as MiniatureBake).lods.length;
    if (bakes.some((b) => b.lods.length !== levels))
      throw new RangeError("every archetype must have the same number of levels");
    this.capacity = options.maxFigures ?? 1024;
    this.budget = options.triangleBudget ?? 250_000;
    this.levelPixels =
      options.levelPixels ?? Array.from({ length: levels }, (_, k) => (k < levels - 1 ? 64 : 0));
    if (this.levelPixels.length !== levels)
      throw new RangeError(`levelPixels needs one value per level (${levels})`);
    this.archetypes = bakes.map((b) => new Archetype(b, this.capacity, options.material ?? {}));
    for (const a of this.archetypes) {
      for (const m of a.meshes) this.object.add(m);
      for (const card of a.alphaCards) this.object.add(card.mesh);
    }
  }

  /** GPU bytes of every archetype's animation textures. */
  get textureBytes(): number {
    return this.archetypes.reduce((s, a) => s + a.textureBytes, 0);
  }

  /** The figures to draw from the next `update` on (kept by reference). */
  setFigures(figures: readonly MiniatureFigure[]): void {
    if (figures.length > this.capacity)
      throw new RangeError(`${figures.length} figures; the crowd holds ${this.capacity}`);
    for (const f of figures)
      if (!this.archetypes[f.archetype]) throw new RangeError(`no archetype ${f.archetype}`);
    this.figures = figures;
    if (this.order.length < figures.length) {
      this.order = new Int32Array(figures.length);
      this.distance = new Float32Array(figures.length);
      this.pixels = new Float32Array(figures.length);
    }
  }

  /**
   * Culls, chooses each figure's level, and writes the instances, for `camera`
   * at `time` seconds on a viewport `viewportHeight` pixels tall.
   */
  update(camera: Camera, time: number, viewportHeight: number): MiniatureFrameStats {
    camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(
      this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    const eye = this.v.setFromMatrixPosition(camera.matrixWorld);
    const ex = eye.x;
    const ey = eye.y;
    const ez = eye.z;
    let visible = 0;
    for (let i = 0; i < this.figures.length; i++) {
      const f = this.figures[i] as MiniatureFigure;
      const a = this.archetypes[f.archetype] as Archetype;
      const s = f.scale ?? 1;
      this.sphere.center.set(f.x, (f.y ?? 0) + (a.height * s) / 2, f.z);
      this.sphere.radius = a.radius * s;
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      const d = Math.hypot(
        this.sphere.center.x - ex,
        this.sphere.center.y - ey,
        this.sphere.center.z - ez,
      );
      this.order[visible++] = i;
      this.distance[i] = d;
      this.pixels[i] = projectedPixels(camera, a.height * s, d, viewportHeight);
    }
    // Nearest first; equal distances by figure order, so a frame is reproducible.
    const order = this.order.subarray(0, visible);
    order.sort((p, q) => (this.distance[p] as number) - (this.distance[q] as number) || p - q);
    const levels = this.levelPixels.length;
    const coarsest = levels - 1;
    let triangles = 0;
    for (const i of order) {
      const a = this.archetypes[(this.figures[i] as MiniatureFigure).archetype] as Archetype;
      triangles += (a.triangles[coarsest] as number) + (coarsest === 0 ? a.alphaCardTriangles : 0);
    }
    for (const a of this.archetypes) {
      for (const m of a.meshes) m.count = 0;
      for (const card of a.alphaCards) card.mesh.count = 0;
    }
    const perLevel = new Array<number>(levels).fill(0);
    for (const i of order) {
      const f = this.figures[i] as MiniatureFigure;
      const a = this.archetypes[f.archetype] as Archetype;
      let level = coarsest;
      for (let k = 0; k < coarsest; k++) {
        const extra =
          (a.triangles[k] as number) -
          (a.triangles[coarsest] as number) +
          (k === 0 ? a.alphaCardTriangles : 0);
        if (
          (this.pixels[i] as number) >= (this.levelPixels[k] as number) &&
          triangles + extra <= this.budget
        ) {
          level = k;
          triangles += extra;
          break;
        }
      }
      perLevel[level] = (perLevel[level] as number) + 1;
      this.write(a, a.meshes[level] as InstancedMesh, f);
      if (level === 0)
        for (const card of a.alphaCards) {
          this.write(a, card.mesh, f);
        }
    }
    let drawCalls = 0;
    for (const a of this.archetypes) {
      a.setTime(time);
      for (const m of a.meshes) {
        if (m.count === 0) continue;
        drawCalls++;
        m.instanceMatrix.needsUpdate = true;
        for (const name of ["aAnim", "aTint1", "aTint2", "aTint3"])
          (m.geometry.getAttribute(name) as InstancedBufferAttribute).needsUpdate = true;
      }
      for (const card of a.alphaCards) {
        const m = card.mesh;
        if (m.count === 0) continue;
        drawCalls++;
        m.instanceMatrix.needsUpdate = true;
        for (const name of ["aAnim", "aTint1", "aTint2", "aTint3"])
          (m.geometry.getAttribute(name) as InstancedBufferAttribute).needsUpdate = true;
      }
    }
    return { visible, perLevel, triangles, drawCalls };
  }

  private write(a: Archetype, mesh: InstancedMesh, f: MiniatureFigure) {
    const k = mesh.count++;
    const s = f.scale ?? 1;
    const h = f.heading ?? 0;
    const c = Math.cos(h) * s;
    const sn = Math.sin(h) * s;
    // Rotation about y, then scale, then the figure's place.
    this.matrix.set(c, 0, sn, f.x, 0, s, 0, f.y ?? 0, -sn, 0, c, f.z, 0, 0, 0, 1);
    mesh.setMatrixAt(k, this.matrix);
    const clip = (f.clip !== undefined ? a.clips.get(f.clip) : undefined) ?? a.firstClip;
    const anim = (mesh.geometry.getAttribute("aAnim") as InstancedBufferAttribute)
      .array as Float32Array;
    anim[k * 4] = clip.start;
    anim[k * 4 + 1] = clip.loop ? clip.frames : -clip.frames;
    anim[k * 4 + 2] = clip.fps * (f.speed ?? 1);
    anim[k * 4 + 3] = f.phase ?? 0;
    const tints = f.tints ?? [WHITE, WHITE, WHITE];
    for (let t = 0; t < 3; t++) {
      const arr = (mesh.geometry.getAttribute(`aTint${t + 1}`) as InstancedBufferAttribute)
        .array as Float32Array;
      arr.set(tints[t] as MiniatureTint, k * 3);
    }
  }

  /**
   * Frees the GPU resources. The meshes stay in `object`: three uploads them
   * again if the crowd is drawn after (React's StrictMode disposes and reuses).
   */
  dispose(): void {
    for (const a of this.archetypes) a.dispose();
  }
}

/**
 * A key for a crowd's material parameters, by value: a three.js object (a
 * texture, say) by its `uuid`, a colour by its hex, anything else as its JSON,
 * in name order. It never calls an object's `toJSON`, which for a texture
 * would serialise the image. `<Miniatures>` rebuilds its crowd when it changes.
 */
export function miniatureMaterialKey(material: Readonly<Record<string, unknown>>): string {
  return Object.keys(material)
    .sort()
    .map((name) => {
      const value = material[name];
      if (value !== null && typeof value === "object") {
        if ("isColor" in value && "getHexString" in value) {
          return `${name}=#${(value as { getHexString(): string }).getHexString()}`;
        }
        if ("uuid" in value) return `${name}=uuid:${String((value as { uuid: unknown }).uuid)}`;
      }
      return `${name}=${JSON.stringify(value)}`;
    })
    .join(";");
}

/** How tall, in pixels, an object `height` metres tall `distance` metres away appears. */
export function projectedPixels(
  camera: Camera,
  height: number,
  distance: number,
  viewportHeight: number,
): number {
  if (camera instanceof PerspectiveCamera) {
    const span = 2 * Math.max(distance, 1e-6) * Math.tan((camera.fov * Math.PI) / 360);
    return (height / span) * viewportHeight * camera.zoom;
  }
  if (camera instanceof OrthographicCamera)
    return (height / ((camera.top - camera.bottom) / camera.zoom)) * viewportHeight;
  return viewportHeight;
}
