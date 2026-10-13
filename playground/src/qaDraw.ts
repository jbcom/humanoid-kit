/**
 * QA-only overrides of how a shot draws the body, for telling a joint fold's
 * geometry from its shading on a contact sheet (CONTRIBUTING.md, "Contact
 * sheets"), and the notes a shot reports of the folds it draws. `QaShade`
 * applies them each frame from the shot's query:
 *
 * - `?nofold=knee[,hip]` draws the named joints' folds off: the body's slots
 *   of each (`FOLD_SLOTS_ATTRIBUTE`) point no vertex at a row, as for a
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
 * - `?coat=<mode>` draws the coat (body hair's shells) one way changed
 *   (`QaCoatMode`): off, without specular, without indirect light, unlit, its
 *   alpha alone, opaque in a given colour, or flagging non-numbers.
 *
 * `foldNotes` (`window.hkShotNotes`) reports, per body mesh, how many of its
 * vertices each joint's fold gives a row and the size of that joint's fold
 * texture: the draw's own fold, not a test pack's.
 */
import { FOLD_JOINTS } from "humanoid-kit";
import {
  applyDualSkinning,
  type DualBones,
  FOLD_SLOTS_ATTRIBUTE,
  foldSlotAt,
  writeFoldSlots,
} from "humanoid-kit/react";
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

/**
 * How a shot draws the coat (`?coat=`), each mode changing one thing so a
 * sheet can tell the coat's shading from its geometry:
 *
 * - `lit`: as the figure draws it.
 * - `off`: not at all (the bare skin under it, the same camera and light).
 * - `nospec`: without any specular (three's GGX, the strand lobes, the environment's).
 * - `noindirect`: without the environment's and the hemisphere's light (direct light only).
 * - `unlit`: its albedo at its alpha, no light at all.
 * - `alpha`: magenta at its alpha: where and how much it covers.
 * - `parity`: opaque wherever it draws, in the colour `?coatrgb=r,g,b` (linear),
 *   so lit as the coat is lit, it can be set beside skin of that albedo lit as skin.
 * - `nan`: as drawn, but green where its light is not a number and blue where negative.
 */
export type QaCoatMode =
  | "lit"
  | "off"
  | "nospec"
  | "noindirect"
  | "unlit"
  | "alpha"
  | "parity"
  | "nan";

/** The QA draw a shot's query asks for. */
export interface QaDraw {
  /** The fold joints drawn without their fold (`?nofold=`). */
  off: ReadonlySet<string>;
  shade: QaShadeMode;
  coat: QaCoatMode;
  /** The `parity` mode's colour, linear RGB. */
  coatRgb: readonly [number, number, number];
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
  const coat = params.get("coat") ?? "lit";
  if (!COAT_MODES.includes(coat as QaCoatMode))
    throw new Error(`?coat=${coat}: not one of ${COAT_MODES.join(", ")}`);
  const rgb = (params.get("coatrgb") ?? "0.5,0.5,0.5").split(",").map(Number);
  if (rgb.length !== 3 || !rgb.every((c) => c >= 0 && c <= 1))
    throw new Error(`?coatrgb=${params.get("coatrgb")}: not three linear values in 0..1`);
  return {
    off,
    shade: shade as QaShadeMode,
    coat: coat as QaCoatMode,
    coatRgb: rgb as [number, number, number],
  };
}

const COAT_MODES: readonly QaCoatMode[] = [
  "lit",
  "off",
  "nospec",
  "noindirect",
  "unlit",
  "alpha",
  "parity",
  "nan",
];

/** Whether `draw` changes anything a frame must apply. */
export const qaDrawActive = (draw: QaDraw): boolean =>
  draw.off.size > 0 || draw.shade !== "lit" || draw.coat !== "lit";

/** Where the coat's fragment has its lights summed, and where it writes its colour. */
const COAT_ANCHORS = {
  lights: "#include <aomap_fragment>",
  out: "#include <opaque_fragment>",
} as const;

/** The GLSL each coat mode adds, before the lights are summed and before the colour is written. */
function coatPatch(draw: QaDraw): { lights: string; out: string } {
  switch (draw.coat) {
    case "nospec":
      return {
        lights:
          "reflectedLight.directSpecular = vec3( 0.0 ); reflectedLight.indirectSpecular = vec3( 0.0 );",
        out: "",
      };
    case "noindirect":
      return {
        lights:
          "reflectedLight.indirectDiffuse = vec3( 0.0 ); reflectedLight.indirectSpecular = vec3( 0.0 );",
        out: "",
      };
    case "unlit":
      return { lights: "", out: "outgoingLight = diffuseColor.rgb;" };
    case "alpha":
      return { lights: "", out: "outgoingLight = vec3( 1.0, 0.0, 1.0 );" };
    case "nan":
      return {
        lights: "",
        out: `if ( any( isnan( outgoingLight ) ) || any( isinf( outgoingLight ) ) ) { outgoingLight = vec3( 0.0, 1.0, 0.0 ); diffuseColor.a = 1.0; }
	else if ( any( lessThan( outgoingLight, vec3( 0.0 ) ) ) ) { outgoingLight = vec3( 0.0, 0.0, 1.0 ); diffuseColor.a = 1.0; }`,
      };
    default:
      return { lights: "", out: "" };
  }
}

/** The coat's colour line (`src/render/coat.ts`): `parity` replaces the colour and alpha after it. */
const COAT_COLOUR = "diffuseColor.a = hkCover;";

/** Applies `draw.coat` to one coat material; throws at compile if an anchor moved. */
function patchCoat(material: Material, draw: QaDraw): void {
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey;
  const patch = coatPatch(draw);
  const [r, g, b] = draw.coatRgb.map((c) => c.toFixed(4));
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    for (const anchor of [...Object.values(COAT_ANCHORS), COAT_COLOUR])
      if (!shader.fragmentShader.includes(anchor))
        throw new Error(`?coat=${draw.coat}: the coat shader no longer has ${anchor}`);
    shader.fragmentShader = shader.fragmentShader
      .replace(COAT_ANCHORS.lights, `${patch.lights}\n\t${COAT_ANCHORS.lights}`)
      .replace(COAT_ANCHORS.out, `${patch.out}\n\t${COAT_ANCHORS.out}`);
    if (draw.coat === "parity")
      shader.fragmentShader = shader.fragmentShader.replace(
        COAT_COLOUR,
        `${COAT_COLOUR}\n\t\tdiffuseColor = vec4( ${r}, ${g}, ${b}, 1.0 );`,
      );
  };
  material.customProgramCacheKey = () => `${key.call(material)}|qa-coat-${draw.coat}`;
  material.userData.qaCoat = draw.coat;
  material.needsUpdate = true;
}

/** Applies `draw.coat` to every coat mesh under `root` (geometry tagged `hkCoatRegions`). */
function applyQaCoat(root: Object3D, draw: QaDraw): void {
  if (draw.coat === "lit") return;
  root.traverse((o) => {
    const mesh = o as SkinnedMesh;
    if (!mesh.isSkinnedMesh || !mesh.geometry?.userData.hkCoatRegions) return;
    if (draw.coat === "off") {
      mesh.visible = false;
      return;
    }
    const material = mesh.material as Material;
    if (material.userData.qaCoat !== draw.coat) patchCoat(material, draw);
  });
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
      const slots = mesh.geometry.getAttribute(FOLD_SLOTS_ATTRIBUTE) as BufferAttribute | undefined;
      let slotted = 0;
      if (slots)
        for (let v = 0; v < slots.count; v++)
          if (foldSlotAt(mesh.geometry, joint, v) >= 0) slotted++;
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
  applyQaCoat(root, draw);
  for (const mesh of bodies(root)) {
    // One attribute holds every joint's slots, so they are forced together, once a version.
    const slots = mesh.geometry.getAttribute(FOLD_SLOTS_ATTRIBUTE) as BufferAttribute | undefined;
    if (slots && forced.get(slots) !== slots.version) {
      for (const joint of FOLD_JOINTS)
        if (draw.off.has(joint.name)) writeFoldSlots(slots, joint, undefined);
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
