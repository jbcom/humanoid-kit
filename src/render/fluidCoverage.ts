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
import type { FluidCoverageSnapshot } from "../fluid/attachedField.ts";
import { SWEAT_ROUGHNESS, SWEAT_SPECULAR } from "../surface/regions/states.ts";
import type { FluidWetFilmProfile, SkinMaterial } from "./skinMaterial.ts";

/** Per-side texels in a figure's exact UV support mask. */
export const FLUID_COVERAGE_TEXTURE_SIZE = 1024;

/** Water and sweat use the existing documented sweat-film roughness/specular choices. */
export const WATER_SWEAT_WET_FILM: Readonly<FluidWetFilmProfile> = Object.freeze({
  roughness: SWEAT_ROUGHNESS,
  specular: SWEAT_SPECULAR,
});

type CoverageTexture = { data: Uint8Array; texture: DataTexture };

const materialGeometry = new WeakMap<SkinMaterial, BufferGeometry>();
const geometryMaterial = new WeakMap<BufferGeometry, SkinMaterial>();
const materialCoverage = new WeakMap<SkinMaterial, CoverageTexture>();

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
  if (bound && bound !== geometry)
    throw new RangeError("fluid wet-film coverage requires a distinct SkinMaterial per figure");
  const owner = geometryMaterial.get(geometry);
  if (owner && owner !== material)
    throw new RangeError("fluid wet-film coverage requires a distinct geometry per figure");
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

function rasterTriangle(data: Uint8Array, geometry: BufferGeometry, triangle: number): void {
  const uvs = geometry.getAttribute("uv");
  const index = geometry.getIndex();
  if (!uvs || !index) throw new RangeError("fluid wet-film coverage requires indexed UV geometry");
  const at = triangle * 3;
  if (at + 2 >= index.count)
    throw new RangeError(`fluid wet-film triangle ${triangle} is outside geometry`);
  const vertices = [index.getX(at), index.getX(at + 1), index.getX(at + 2)] as const;
  const points = vertices.map((vertex) => [uvs.getX(vertex), uvs.getY(vertex)] as const);
  if (points.some(([u, v]) => !Number.isFinite(u) || !Number.isFinite(v)))
    throw new RangeError("fluid wet-film coverage UVs must be finite");
  const scale = FLUID_COVERAGE_TEXTURE_SIZE - 1;
  const [[u0, v0], [u1, v1], [u2, v2]] = points.map(([u, v]) => [u * scale, v * scale]) as [
    [number, number],
    [number, number],
    [number, number],
  ];
  const signed = (ax: number, ay: number, bx: number, by: number, x: number, y: number) =>
    (x - ax) * (by - ay) - (y - ay) * (bx - ax);
  if (Math.abs(signed(u0, v0, u1, v1, u2, v2)) < Number.EPSILON) return;
  const minX = Math.max(0, Math.ceil(Math.min(u0, u1, u2) - 0.5));
  const maxX = Math.min(scale, Math.floor(Math.max(u0, u1, u2) - 0.5));
  const minY = Math.max(0, Math.ceil(Math.min(v0, v1, v2) - 0.5));
  const maxY = Math.min(scale, Math.floor(Math.max(v0, v1, v2) - 0.5));
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

/**
 * Writes one water/sweat UV support mask for one figure. The mask is an exact
 * rasterization of occupied snapshot triangles, not an optical alpha or film
 * thickness, and never mutates the shared layer atlas.
 */
export function bindFluidWetFilmCoverage(
  material: SkinMaterial,
  geometry: BufferGeometry,
  snapshot: FluidCoverageSnapshot | null,
  materialId: "water" | "sweat" = "water",
): void {
  claimFigureMaterial(material, geometry);
  if (!snapshot) {
    material.setFluidWetFilm(null);
    return;
  }
  assertUnits(snapshot);
  const cells = snapshot.cells.filter((cell) => cell.materialId === materialId);
  if (cells.length === 0) {
    material.setFluidWetFilm(null);
    return;
  }
  const coverage = snapshot.materials.find((entry) => entry.materialId === materialId);
  if (!coverage || coverage.vertexCoverage.length !== geometry.getAttribute("position").count)
    throw new RangeError("fluid wet-film coverage vertex count does not match geometry");
  if (coverage.vertexCoverage.some((value) => !Number.isFinite(value) || value < 0 || value > 1))
    throw new RangeError("fluid wet-film coverage must be finite in 0..1");
  const field = coverageTexture(material);
  field.data.fill(0);
  for (const cell of cells) rasterTriangle(field.data, geometry, cell.triangle);
  field.texture.needsUpdate = true;
  material.setFluidWetFilm(WATER_SWEAT_WET_FILM, field.texture);
}
