/**
 * QA-only overrides of how a shot draws the body, for telling a joint fold's
 * geometry from its shading on a contact sheet (CONTRIBUTING.md, "Contact
 * sheets"), and the notes a shot reports of the folds it draws. `QaShade`
 * applies them each frame from the shot's query:
 *
 * - `?nofold=knee[,hip]` draws the named joints' folds off: the body's slot
 *   attribute of each (`foldSlotAttribute`) points no vertex at a row, as for a
 *   figure the fold was never solved for. The rest of the draw is unchanged.
 * - `?shade=normal` draws the body's smooth normals as colour, `?shade=flat` its
 *   face normals (flat shading), `?shade=wire` the lit body with its triangles
 *   drawn over it, `?shade=matte` the body lit in a plain grey standard material
 *   (no skin shading, no maps), `?shade=nopores` the skin as it is but for its
 *   pores' normal map, and `?shade=norelief` the skin as it is but for its detail
 *   layers' relief (`hkPerturbNormal`: the creases, grooves and bumps that tilt
 *   the normal per pixel). Each QA material skins by the figure's own dual bones
 *   and folds (`applyDualSkinning`), so the shape drawn is the shape the lit body
 *   has.
 *
 * `foldNotes` (`window.hkShotNotes`) reports, per body mesh, how many of its
 * vertices each joint's fold gives a row and the size of that joint's fold
 * texture: the draw's own fold, not a test pack's.
 */
import { FOLD_JOINTS } from "humanoid-kit";
import { applyDualSkinning, type DualBones, foldSlotAttribute } from "humanoid-kit/react";
import {
  type BufferAttribute,
  type Material,
  MeshBasicMaterial,
  MeshNormalMaterial,
  MeshStandardMaterial,
  type Object3D,
  SkinnedMesh,
} from "three";

/** How a shot draws the body (`?shade=`): lit as the stage lights it, or one of the QA modes. */
export type QaShadeMode = "lit" | "normal" | "flat" | "wire" | "matte" | "nopores" | "norelief";

/** The QA draw a shot's query asks for. */
export interface QaDraw {
  /** The fold joints drawn without their fold (`?nofold=`). */
  off: ReadonlySet<string>;
  shade: QaShadeMode;
}

const SHADES: readonly QaShadeMode[] = [
  "lit",
  "normal",
  "flat",
  "wire",
  "matte",
  "nopores",
  "norelief",
];

/** The QA draw `params` asks for; unknown joints and modes are errors, not silently lit. */
export function qaDraw(params: URLSearchParams): QaDraw {
  const joints = new Set<string>(FOLD_JOINTS.map((j) => j.name));
  const off = new Set((params.get("nofold") ?? "").split(",").filter(Boolean));
  for (const name of off)
    if (!joints.has(name))
      throw new Error(`?nofold=${name}: no such fold joint (${[...joints].join(", ")})`);
  const shade = params.get("shade") ?? "lit";
  if (!SHADES.includes(shade as QaShadeMode))
    throw new Error(`?shade=${shade}: not one of ${SHADES.join(", ")}`);
  return { off, shade: shade as QaShadeMode };
}

/** What `foldNotes` reports of one body mesh. */
export interface BodyFoldNote {
  vertices: number;
  visible: boolean;
  /** Per fold joint: vertices with a row, and its texture's texels across and down. */
  joints: Record<string, { slotted: number; texture: [number, number] }>;
  /** How much of the folds shows (`DualBones.foldBlend`); -1 without dual bones. */
  blend: number;
}

/** The figure's dual bones: on the group above the body (`Humanoid`'s `userData.dualBones`). */
export function dualOf(mesh: Object3D): DualBones | null {
  for (let o: Object3D | null = mesh; o; o = o.parent) {
    const dual = o.userData.dualBones as DualBones | null | undefined;
    if (dual) return dual;
  }
  return null;
}

/** Every body mesh under `root` (the base surface's and the adult's). */
export function bodies(root: Object3D): SkinnedMesh[] {
  const out: SkinnedMesh[] = [];
  root.traverse((o) => {
    if (o.userData.hkPart === "body" && (o as SkinnedMesh).isSkinnedMesh)
      out.push(o as SkinnedMesh);
  });
  return out;
}

/** The folds each body mesh under `root` draws (`BodyFoldNote`). */
export function foldNotes(root: Object3D): BodyFoldNote[] {
  return bodies(root).map((mesh) => {
    const dual = dualOf(mesh);
    const joints: BodyFoldNote["joints"] = {};
    for (const joint of FOLD_JOINTS) {
      const slots = mesh.geometry.getAttribute(foldSlotAttribute(joint)) as
        | BufferAttribute
        | undefined;
      let slotted = 0;
      if (slots) for (let v = 0; v < slots.count; v++) if (slots.getX(v) >= 0) slotted++;
      const image = dual?.folds[joint.name].value.image as
        | { width: number; height: number }
        | undefined;
      joints[joint.name] = { slotted, texture: [image?.width ?? 0, image?.height ?? 0] };
    }
    return {
      vertices: mesh.geometry.getAttribute("position").count,
      visible: mesh.visible,
      joints,
      blend: dual?.foldBlend.value ?? -1,
    };
  });
}

/** Each slot attribute forced off, at the version it was forced at. */
const forced = new WeakMap<BufferAttribute, number>();

/**
 * Applies `draw` to every body mesh under `root`. The folds arrive (and arrive
 * again) after the figure, rewriting the slots, so it is called every frame and
 * does nothing where it has already been applied.
 */
export function applyQaDraw(root: Object3D, draw: QaDraw): void {
  for (const mesh of bodies(root)) {
    for (const joint of FOLD_JOINTS) {
      if (!draw.off.has(joint.name)) continue;
      const slots = mesh.geometry.getAttribute(foldSlotAttribute(joint)) as
        | BufferAttribute
        | undefined;
      if (!slots || forced.get(slots) === slots.version) continue;
      (slots.array as Float32Array).fill(-1);
      slots.needsUpdate = true;
      forced.set(slots, slots.version);
    }
    if (draw.shade === "lit") continue;
    const dual = dualOf(mesh);
    if (!dual) continue;
    if (draw.shade === "wire") {
      if (mesh.userData.qaWire) continue;
      const material = new MeshBasicMaterial({
        color: 0x000000,
        wireframe: true,
        transparent: true,
        opacity: 0.45,
      });
      applyDualSkinning(material, dual, true);
      const wire = new SkinnedMesh(mesh.geometry, material);
      wire.bind(mesh.skeleton, mesh.bindMatrix);
      wire.frustumCulled = false;
      wire.renderOrder = 10;
      mesh.add(wire);
      mesh.userData.qaWire = wire;
      continue;
    }
    // The figure may set its own material again (a recipe swapped in): each time, it is replaced again.
    if ((mesh.material as Material).userData.qaShade === draw.shade) continue;
    if (draw.shade === "nopores") {
      const skin = mesh.material as Material & { normalMap?: unknown };
      skin.normalMap = null;
      skin.userData.qaShade = draw.shade;
      skin.needsUpdate = true;
      continue;
    }
    if (draw.shade === "norelief") {
      withoutRelief(mesh.material as Material);
      continue;
    }
    const material =
      draw.shade === "matte"
        ? new MeshStandardMaterial({ color: 0xb0b0b0, roughness: 0.6, metalness: 0 })
        : new MeshNormalMaterial({ flatShading: draw.shade === "flat" });
    material.userData.qaShade = draw.shade;
    applyDualSkinning(material, dual, true);
    mesh.material = material;
  }
}

/** The skin shader's line that tilts the normal by the detail layers' relief. */
const RELIEF = /\n\tnormal = hkPerturbNormal\([^\n]*\);/;

/** Draws `skin` without its detail layers' relief; throws at compile if the skin shader no longer has it. */
function withoutRelief(skin: Material): void {
  const before = skin.onBeforeCompile;
  const key = skin.customProgramCacheKey;
  skin.onBeforeCompile = (shader, renderer) => {
    before.call(skin, shader, renderer);
    if (!RELIEF.test(shader.fragmentShader))
      throw new Error(
        "?shade=norelief: the skin shader no longer tilts the normal by hkPerturbNormal",
      );
    shader.fragmentShader = shader.fragmentShader.replace(RELIEF, "");
  };
  skin.customProgramCacheKey = () => `${key.call(skin)}|qa-norelief`;
  skin.userData.qaShade = "norelief";
  skin.needsUpdate = true;
}
