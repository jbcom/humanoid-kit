/**
 * The figure's coat (docs/ARCHITECTURE.md, "The coat"): shells on the body's own
 * geometry and skeleton, drawn where a painted region grows, with as many
 * shells as the figure's size on screen earns.
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { type BufferGeometry, Matrix4, type Skeleton, SkinnedMesh, Vector3 } from "three";
import { isAdult } from "../recipe/agePolicy.ts";
import type { Recipe } from "../recipe/recipe.ts";
import { CoatMaterial, coatGeometry } from "../render/coat.ts";
import { applyDualSkinning, type DualBones } from "../render/dualSkinning.ts";
import {
  type CoatFields,
  coatPainted,
  coatShellCount,
  coatTriangles,
  paintCoat,
} from "../surface/coat.ts";
import { COAT_REGIONS } from "../surface/regions/index.ts";

/** The coat's paint input from a recipe: what body hair is painted from. */
function coatInput(recipe: Recipe) {
  const s = recipe.skin;
  return {
    tone: {
      melanin: s.melanin,
      haemoglobin: s.haemoglobin,
      undertone: s.undertone,
      override: s.override,
    },
    flush: s.flush,
    lips: s.lips,
    areola: s.areola,
    signals: {},
    age: recipe.macros.age,
    gender: recipe.macros.gender,
    adult: isAdult(recipe),
    ...(recipe.hair && { hairColour: recipe.hair.colour }),
    ...(recipe.bodyHair && { bodyHair: recipe.bodyHair }),
  };
}

/** The figure's height on screen is about its world height over this many metres. */
const FIGURE_HEIGHT = 1.8;
const centre = new Vector3();

export function CoatMesh({
  body,
  fields,
  recipe,
  skeleton,
  dual,
  visible,
  shape,
}: {
  /** The body surface's geometry the coat shares (the base's or the adult's). */
  body: BufferGeometry;
  fields: CoatFields;
  recipe: Recipe;
  skeleton: Skeleton;
  dual: DualBones | null;
  visible: boolean;
  /** Changes whenever the figure is re-evaluated (and its outfit's index may change). */
  shape: object;
}) {
  const paint = useMemo(() => paintCoat(COAT_REGIONS, coatInput(recipe)), [recipe]);
  const material = useMemo(() => {
    const m = new CoatMaterial();
    if (dual) applyDualSkinning(m, dual);
    return m;
  }, [dual]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => material.setPaint(paint), [material, paint]);
  // Which regions grow is what decides the triangles; their length and colour are uniforms.
  const growing = useMemo(
    () => COAT_REGIONS.map((_, k) => (paint[k * 8] as number) > 0).join(","),
    [paint],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: shape re-reads the body's (outfit-masked) index; growing stands for paint's regions
  const geometry = useMemo(() => {
    const index = body.getIndex();
    if (!index || !coatPainted(paint)) return null;
    const triangles = coatTriangles(index.array, fields.masks, paint);
    return triangles.length ? coatGeometry(body, fields, triangles, coatShellCount(0)) : null;
  }, [body, fields, growing, shape]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  const mesh = useMemo(() => {
    if (!geometry) return null;
    const m = new SkinnedMesh(geometry, material);
    m.bind(skeleton, new Matrix4());
    // Shells cast no shadows (the body does), and lie on the body, which is culled itself.
    m.castShadow = false;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.renderOrder = 1;
    // A pick on the figure is a pick on its skin under the hair.
    m.raycast = () => {};
    return m;
  }, [geometry, material, skeleton]);
  // As many shells as the figure's size on screen earns, every frame.
  useFrame(({ camera, size }) => {
    if (!mesh || !geometry) return;
    mesh.getWorldPosition(centre);
    const distance = Math.max(0.1, camera.position.distanceTo(centre));
    const fov = "fov" in camera ? ((camera.fov as number) * Math.PI) / 180 : Math.PI / 4;
    const pixels = (FIGURE_HEIGHT / (2 * distance * Math.tan(fov / 2))) * size.height;
    const shells = coatShellCount(pixels);
    geometry.instanceCount = shells;
    material.setShells(shells);
  });
  if (!mesh) return null;
  mesh.visible = visible;
  return <primitive object={mesh} />;
}
