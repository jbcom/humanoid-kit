/** Per-figure bridge from attached-fluid coverage output to SkinMaterial. */
import { type BufferGeometry, Float32BufferAttribute } from "three";
import type { FluidCoverageSnapshot } from "../fluid/attachedField.ts";
import { SWEAT_ROUGHNESS, SWEAT_SPECULAR } from "../surface/regions/states.ts";
import {
  FLUID_COVERAGE_ATTRIBUTE,
  type FluidWetFilmProfile,
  type SkinMaterial,
} from "./skinMaterial.ts";

export { FLUID_COVERAGE_ATTRIBUTE };

/** Water and sweat use the existing documented sweat-film roughness/specular choices. */
export const WATER_SWEAT_WET_FILM: Readonly<FluidWetFilmProfile> = Object.freeze({
  roughness: SWEAT_ROUGHNESS,
  specular: SWEAT_SPECULAR,
});

const materialGeometry = new WeakMap<SkinMaterial, BufferGeometry>();
const geometryMaterial = new WeakMap<BufferGeometry, SkinMaterial>();

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

/**
 * Writes one water/sweat coverage field onto one figure's geometry. It never
 * mutates the shared layer atlas or the immutable fluid snapshot.
 */
export function bindFluidWetFilmCoverage(
  material: SkinMaterial,
  geometry: BufferGeometry,
  snapshot: FluidCoverageSnapshot | null,
  materialId: "water" | "sweat" = "water",
): void {
  claimFigureMaterial(material, geometry);
  if (!snapshot) {
    geometry.deleteAttribute(FLUID_COVERAGE_ATTRIBUTE);
    material.setFluidWetFilm(null);
    return;
  }
  assertUnits(snapshot);
  const coverage = snapshot.materials.find(
    (entry) => entry.materialId === materialId,
  )?.vertexCoverage;
  if (!coverage) {
    geometry.deleteAttribute(FLUID_COVERAGE_ATTRIBUTE);
    material.setFluidWetFilm(null);
    return;
  }
  const vertices = geometry.getAttribute("position").count;
  if (coverage.length !== vertices)
    throw new RangeError(
      `fluid wet-film coverage vertex count ${coverage.length} does not match geometry ${vertices}`,
    );
  if (coverage.some((value) => !Number.isFinite(value) || value < 0 || value > 1))
    throw new RangeError("fluid wet-film coverage must be finite in 0..1");
  const existing = geometry.getAttribute(FLUID_COVERAGE_ATTRIBUTE);
  const attribute =
    existing?.itemSize === 1 &&
    existing.count === vertices &&
    existing.array instanceof Float32Array
      ? existing
      : new Float32BufferAttribute(vertices, 1);
  (attribute.array as Float32Array).set(coverage);
  attribute.needsUpdate = true;
  geometry.setAttribute(FLUID_COVERAGE_ATTRIBUTE, attribute);
  material.setFluidWetFilm(WATER_SWEAT_WET_FILM);
}
