/** Per-figure bridge from attached-fluid coverage output to SkinMaterial. */
import {
  type BufferGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  NearestFilter,
  NoColorSpace,
  RedFormat,
  UnsignedByteType,
} from "three";
import type { FluidCoverageCell, FluidCoverageSnapshot } from "../fluid/attachedField.ts";
import { SWEAT_ROUGHNESS, SWEAT_SPECULAR } from "../surface/regions/states.ts";
import type { FluidWetFilmProfile, SkinMaterial } from "./skinMaterial.ts";

/** Per-side texels in a figure's binary UV support mask. */
export const FLUID_COVERAGE_TEXTURE_SIZE = 1024;

/** Water and sweat use the existing documented sweat-film roughness/specular choices. */
export const WATER_SWEAT_WET_FILM: Readonly<FluidWetFilmProfile> = Object.freeze({
  roughness: SWEAT_ROUGHNESS,
  specular: SWEAT_SPECULAR,
});

type CoverageTexture = { data: Uint8Array; texture: DataTexture };
type UvPoint = readonly [number, number];
type UvTriangle = {
  readonly triangle: number;
  readonly vertices: readonly [number, number, number];
  readonly points: readonly [UvPoint, UvPoint, UvPoint];
};
type UvAttribute = NonNullable<ReturnType<BufferGeometry["getAttribute"]>>;
type IndexAttribute = NonNullable<ReturnType<BufferGeometry["getIndex"]>>;
type UvTopology = {
  readonly rows: readonly UvTriangle[];
  readonly index: IndexAttribute;
  readonly indexVersion: number;
  readonly indexCount: number;
  readonly uv: UvAttribute;
  readonly uvVersion: number;
  readonly uvCount: number;
};

const materialGeometry = new WeakMap<SkinMaterial, BufferGeometry>();
const geometryMaterial = new WeakMap<BufferGeometry, SkinMaterial>();
const materialCoverage = new WeakMap<SkinMaterial, CoverageTexture>();
const uvTopologies = new WeakMap<BufferGeometry, UvTopology>();
const validatedSupportKeys = new WeakMap<BufferGeometry, string>();
const trackedMaterials = new WeakSet<SkinMaterial>();
const trackedGeometries = new WeakSet<BufferGeometry>();

function assertUnits(snapshot: FluidCoverageSnapshot): void {
  const { units } = snapshot;
  if (
    units.mass !== "kg" ||
    units.area !== "m2" ||
    units.arealMassDensity !== "kg/m2" ||
    units.position !== "m"
  )
    throw new RangeError("fluid coverage snapshot units do not match the wet-film bridge");
}

function claimFigureMaterial(material: SkinMaterial, geometry: BufferGeometry): void {
  const bound = materialGeometry.get(material);
  if (bound && bound !== geometry) releaseFluidWetFilmCoverage(material);
  const owner = geometryMaterial.get(geometry);
  if (owner && owner !== material) releaseFluidWetFilmCoverage(owner);
  if (!trackedMaterials.has(material)) {
    trackedMaterials.add(material);
    material.addEventListener("dispose", () => releaseFluidWetFilmCoverage(material));
  }
  if (!trackedGeometries.has(geometry)) {
    trackedGeometries.add(geometry);
    geometry.addEventListener("dispose", () => {
      uvTopologies.delete(geometry);
      validatedSupportKeys.delete(geometry);
      const boundMaterial = geometryMaterial.get(geometry);
      if (boundMaterial) releaseFluidWetFilmCoverage(boundMaterial);
    });
  }
  materialGeometry.set(material, geometry);
  geometryMaterial.set(geometry, material);
}

function coverageTexture(material: SkinMaterial): CoverageTexture {
  const existing = materialCoverage.get(material);
  if (existing) return existing;
  const data = new Uint8Array(FLUID_COVERAGE_TEXTURE_SIZE ** 2);
  const texture = new DataTexture(
    data,
    FLUID_COVERAGE_TEXTURE_SIZE,
    FLUID_COVERAGE_TEXTURE_SIZE,
    RedFormat,
    UnsignedByteType,
  );
  texture.colorSpace = NoColorSpace;
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  materialCoverage.set(material, { data, texture });
  return { data, texture };
}

function attributeVersion(attribute: UvAttribute): number {
  return "data" in attribute ? attribute.data.version : attribute.version;
}

function topology(geometry: BufferGeometry): readonly UvTriangle[] {
  const uvs = geometry.getAttribute("uv");
  const index = geometry.getIndex();
  if (!uvs || !index) throw new RangeError("fluid wet-film coverage requires indexed UV geometry");
  const uvVersion = attributeVersion(uvs);
  const cached = uvTopologies.get(geometry);
  if (
    cached &&
    cached.index === index &&
    cached.indexVersion === index.version &&
    cached.indexCount === index.count &&
    cached.uv === uvs &&
    cached.uvVersion === uvVersion &&
    cached.uvCount === uvs.count
  )
    return cached.rows;
  validatedSupportKeys.delete(geometry);
  const out: UvTriangle[] = [];
  for (let triangle = 0; triangle < index.count / 3; triangle++) {
    const at = triangle * 3;
    const vertices = [index.getX(at), index.getX(at + 1), index.getX(at + 2)] as const;
    out.push({
      triangle,
      vertices,
      points: vertices.map((vertex) => [uvs.getX(vertex), uvs.getY(vertex)] as const) as [
        UvPoint,
        UvPoint,
        UvPoint,
      ],
    });
  }
  const immutable = Object.freeze(out);
  uvTopologies.set(
    geometry,
    Object.freeze({
      rows: immutable,
      index,
      indexVersion: index.version,
      indexCount: index.count,
      uv: uvs,
      uvVersion,
      uvCount: uvs.count,
    }),
  );
  return immutable;
}

const signed = (ax: number, ay: number, bx: number, by: number, x: number, y: number) =>
  (x - ax) * (by - ay) - (y - ay) * (bx - ax);

function signedArea([a, b, c]: readonly [UvPoint, UvPoint, UvPoint]): number {
  return signed(a[0], a[1], b[0], b[1], c[0], c[1]);
}

function pointInTriangle(point: UvPoint, [a, b, c]: readonly [UvPoint, UvPoint, UvPoint]): boolean {
  const ab = signed(a[0], a[1], b[0], b[1], point[0], point[1]);
  const bc = signed(b[0], b[1], c[0], c[1], point[0], point[1]);
  const ca = signed(c[0], c[1], a[0], a[1], point[0], point[1]);
  const epsilon = 1e-10;
  return (
    (ab >= -epsilon && bc >= -epsilon && ca >= -epsilon) ||
    (ab <= epsilon && bc <= epsilon && ca <= epsilon)
  );
}

function properCross(a: UvPoint, b: UvPoint, c: UvPoint, d: UvPoint): boolean {
  const abC = signed(a[0], a[1], b[0], b[1], c[0], c[1]);
  const abD = signed(a[0], a[1], b[0], b[1], d[0], d[1]);
  const cdA = signed(c[0], c[1], d[0], d[1], a[0], a[1]);
  const cdB = signed(c[0], c[1], d[0], d[1], b[0], b[1]);
  return abC * abD < 0 && cdA * cdB < 0;
}

function overlapsInterior(a: UvTriangle, b: UvTriangle): boolean {
  const aBounds = {
    minU: Math.min(...a.points.map(([u]) => u)),
    maxU: Math.max(...a.points.map(([u]) => u)),
    minV: Math.min(...a.points.map(([, v]) => v)),
    maxV: Math.max(...a.points.map(([, v]) => v)),
  };
  const bBounds = {
    minU: Math.min(...b.points.map(([u]) => u)),
    maxU: Math.max(...b.points.map(([u]) => u)),
    minV: Math.min(...b.points.map(([, v]) => v)),
    maxV: Math.max(...b.points.map(([, v]) => v)),
  };
  if (
    aBounds.maxU < bBounds.minU ||
    bBounds.maxU < aBounds.minU ||
    aBounds.maxV < bBounds.minV ||
    bBounds.maxV < aBounds.minV
  )
    return false;
  const centroid = (points: readonly [UvPoint, UvPoint, UvPoint]): UvPoint => [
    (points[0][0] + points[1][0] + points[2][0]) / 3,
    (points[0][1] + points[1][1] + points[2][1]) / 3,
  ];
  if (
    pointInTriangle(centroid(a.points), b.points) ||
    pointInTriangle(centroid(b.points), a.points)
  )
    return true;
  return a.points.some((point, edge) =>
    b.points.some((other, otherEdge) =>
      properCross(
        point,
        a.points[(edge + 1) % 3] as UvPoint,
        other,
        b.points[(otherEdge + 1) % 3] as UvPoint,
      ),
    ),
  );
}

/**
 * The UV support mask depends on render triangle identity, not on per-frame
 * mass or pose values. Keep the identity in the key so a new immutable
 * snapshot can share the expensive selected-by-all overlap result safely.
 */
function supportKey(cells: readonly FluidCoverageCell[]): string {
  return cells.map((cell) => `${cell.triangle}:${cell.sourceVertices.join(",")}`).join("|");
}

function validateSupport(
  geometry: BufferGeometry,
  cells: readonly FluidCoverageCell[],
): UvTriangle[] {
  const all = topology(geometry);
  const index = geometry.getIndex();
  const uvs = geometry.getAttribute("uv");
  if (!index || !uvs) throw new RangeError("fluid wet-film coverage requires indexed UV geometry");
  const selected = cells.map((cell) => {
    if (!all[cell.triangle])
      throw new RangeError(`fluid wet-film triangle ${cell.triangle} is outside geometry`);
    const at = cell.triangle * 3;
    const vertices = [index.getX(at), index.getX(at + 1), index.getX(at + 2)] as const;
    if (vertices.some((vertex, corner) => vertex !== cell.sourceVertices[corner]))
      throw new RangeError("fluid wet-film source triangle does not match render geometry");
    const triangle: UvTriangle = {
      triangle: cell.triangle,
      vertices,
      points: vertices.map((vertex) => [uvs.getX(vertex), uvs.getY(vertex)] as const) as [
        UvPoint,
        UvPoint,
        UvPoint,
      ],
    };
    if (
      triangle.points.some(
        ([u, v]) => !Number.isFinite(u) || !Number.isFinite(v) || u < 0 || u > 1 || v < 0 || v > 1,
      )
    )
      throw new RangeError("fluid wet-film occupied triangle UVs must be finite in 0..1");
    if (Math.abs(signedArea(triangle.points)) < Number.EPSILON)
      throw new RangeError("fluid wet-film occupied triangle has degenerate UV support");
    return triangle;
  });
  const key = supportKey(cells);
  if (validatedSupportKeys.get(geometry) === key) return selected;
  for (const triangle of selected)
    for (const other of all)
      if (
        other.triangle !== triangle.triangle &&
        Math.abs(signedArea(other.points)) >= Number.EPSILON &&
        overlapsInterior(triangle, other)
      )
        throw new RangeError(
          "fluid wet-film occupied triangle overlaps another triangle in UV space",
        );
  validatedSupportKeys.set(geometry, key);
  return selected;
}

function rasterTriangle(data: Uint8Array, triangle: UvTriangle): void {
  const [[u0, v0], [u1, v1], [u2, v2]] = triangle.points.map(([u, v]) => [
    u * FLUID_COVERAGE_TEXTURE_SIZE,
    v * FLUID_COVERAGE_TEXTURE_SIZE,
  ]) as [[number, number], [number, number], [number, number]];
  const side = FLUID_COVERAGE_TEXTURE_SIZE - 1;
  const minX = Math.max(0, Math.ceil(Math.min(u0, u1, u2) - 0.5));
  const maxX = Math.min(side, Math.floor(Math.max(u0, u1, u2) - 0.5));
  const minY = Math.max(0, Math.ceil(Math.min(v0, v1, v2) - 0.5));
  const maxY = Math.min(side, Math.floor(Math.max(v0, v1, v2) - 0.5));
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      const positive =
        signed(u0, v0, u1, v1, x + 0.5, y + 0.5) >= 0 &&
        signed(u1, v1, u2, v2, x + 0.5, y + 0.5) >= 0 &&
        signed(u2, v2, u0, v0, x + 0.5, y + 0.5) >= 0;
      const negative =
        signed(u0, v0, u1, v1, x + 0.5, y + 0.5) <= 0 &&
        signed(u1, v1, u2, v2, x + 0.5, y + 0.5) <= 0 &&
        signed(u2, v2, u0, v0, x + 0.5, y + 0.5) <= 0;
      if (positive || negative) data[y * FLUID_COVERAGE_TEXTURE_SIZE + x] = 255;
    }
}

/** Releases a figure-local coverage texture before changing that figure's body geometry or material. */
export function releaseFluidWetFilmCoverage(material: SkinMaterial): void {
  const coverage = materialCoverage.get(material);
  coverage?.texture.dispose();
  materialCoverage.delete(material);
  const geometry = materialGeometry.get(material);
  materialGeometry.delete(material);
  if (geometry && geometryMaterial.get(geometry) === material) geometryMaterial.delete(geometry);
  material.setFluidWetFilm(null);
}

/**
 * Writes one water/sweat UV support mask for one figure. Its texel-centre
 * rasterization quantizes occupied snapshot triangles; it is neither an optical
 * alpha nor film thickness, and never mutates the shared layer atlas.
 */
export function bindFluidWetFilmCoverage(
  material: SkinMaterial,
  geometry: BufferGeometry,
  snapshot: FluidCoverageSnapshot | null,
  materialId: "water" | "sweat" = "water",
): void {
  if (!snapshot) {
    releaseFluidWetFilmCoverage(material);
    return;
  }
  assertUnits(snapshot);
  const cells = snapshot.cells.filter((cell) => cell.materialId === materialId);
  if (cells.length === 0) {
    releaseFluidWetFilmCoverage(material);
    return;
  }
  const coverage = snapshot.materials.find((entry) => entry.materialId === materialId);
  if (!coverage || coverage.vertexCoverage.length !== geometry.getAttribute("position").count)
    throw new RangeError("fluid wet-film coverage vertex count does not match geometry");
  if (coverage.vertexCoverage.some((value) => !Number.isFinite(value) || value < 0 || value > 1))
    throw new RangeError("fluid wet-film coverage must be finite in 0..1");
  const support = validateSupport(geometry, cells);
  claimFigureMaterial(material, geometry);
  const field = coverageTexture(material);
  field.data.fill(0);
  for (const triangle of support) rasterTriangle(field.data, triangle);
  field.texture.needsUpdate = true;
  material.setFluidWetFilm(WATER_SWEAT_WET_FILM, field.texture);
}
