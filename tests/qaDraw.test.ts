/**
 * The playground shot's QA draw (playground/src/qaDraw.ts; CONTRIBUTING.md,
 * "Contact sheets"): `?nofold=`, `?shade=` and `?coat=` read strictly, the folds forced off
 * however often they arrive again, the body's material replaced by a QA one
 * skinned as the figure is, and the notes a sheet records of the folds drawn.
 */
import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  Group,
  type Material,
  MeshNormalMaterial,
  MeshStandardMaterial,
  Skeleton,
  SkinnedMesh,
} from "three";
import { describe, expect, it } from "vitest";
import { applyQaDraw, foldNotes, qaDraw } from "../playground/src/qaDraw.ts";
import {
  DualBones,
  FOLD_SLOTS_ATTRIBUTE,
  foldSlotAt,
  makeFoldSlots,
  writeFoldSlots,
} from "../src/react/index.ts";
import { FOLD_JOINTS } from "../src/rig/folds.ts";

const [HIP, KNEE] = FOLD_JOINTS;

/** A figure as `Humanoid` draws one: a group holding its dual bones, a body mesh tagged `body` with each joint's slots. */
function figure(slots: Record<string, number[]>) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(4 * 3), 3));
  const attribute = makeFoldSlots(4);
  for (const joint of FOLD_JOINTS) writeFoldSlots(attribute, joint, slots[joint.name]);
  geometry.setAttribute(FOLD_SLOTS_ATTRIBUTE, attribute);
  const material = new MeshStandardMaterial();
  const body = new SkinnedMesh<BufferGeometry, Material>(geometry, material);
  const bone = new Bone();
  body.add(bone);
  body.bind(new Skeleton([bone]));
  body.userData.hkPart = "body";
  const group = new Group();
  group.userData.dualBones = new DualBones(1, 1);
  group.add(body);
  return { group, body, material, geometry };
}

const params = (query: string) => new URLSearchParams(query);

describe("the shot's QA draw", () => {
  it("reads the query strictly, lit with every fold by default", () => {
    expect(qaDraw(params(""))).toEqual({
      off: new Set(),
      shade: "lit",
      coat: "lit",
      coatRgb: [0.5, 0.5, 0.5],
    });
    expect(qaDraw(params("nofold=knee,hip&shade=flat&coat=parity&coatrgb=0.2,0.1,0.05"))).toEqual({
      off: new Set(["knee", "hip"]),
      shade: "flat",
      coat: "parity",
      coatRgb: [0.2, 0.1, 0.05],
    });
    // A typo must not quietly draw the folds on, or lit.
    expect(() => qaDraw(params("nofold=kneee"))).toThrow(/no such fold joint/);
    expect(() => qaDraw(params("shade=normals"))).toThrow(/not one of/);
    expect(() => qaDraw(params("coat=nospecular"))).toThrow(/not one of/);
    expect(() => qaDraw(params("coat=parity&coatrgb=1,2"))).toThrow(/three linear values/);
  });

  /** A coat as `CoatMesh` draws one: a skinned mesh whose geometry names its regions. */
  function coatFigure() {
    const { group, body, material: skin } = figure({});
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(3 * 3), 3));
    geometry.userData.hkCoatRegions = ["hair-chest"];
    const material = new MeshStandardMaterial();
    const coat = new SkinnedMesh<BufferGeometry, Material>(geometry, material);
    group.add(coat);
    return { group, coat, material, body, skin };
  }
  const coatShader = () => ({
    vertexShader: "",
    fragmentShader:
      "diffuseColor.a = hkCover;\n#include <aomap_fragment>\nvec3 outgoingLight = x;\n#include <opaque_fragment>",
    uniforms: {},
  });

  it("hides the coat for its bare-skin pair, and changes nothing else", () => {
    const { group, coat, body, skin } = coatFigure();
    applyQaDraw(group, qaDraw(params("coat=off")));
    expect(coat.visible).toBe(false);
    expect(body.visible).toBe(true);
    expect(body.material).toBe(skin);
  });

  it("changes one thing in the coat's shader per mode, once, under its own program key", () => {
    for (const [mode, line] of [
      ["nospec", "reflectedLight.directSpecular = vec3( 0.0 )"],
      ["noindirect", "reflectedLight.indirectDiffuse = vec3( 0.0 )"],
      ["unlit", "outgoingLight = diffuseColor.rgb;"],
      ["alpha", "outgoingLight = vec3( 1.0, 0.0, 1.0 );"],
      ["parity", "diffuseColor = vec4( 0.2000, 0.1000, 0.0500, 1.0 );"],
      ["nan", "isnan( outgoingLight )"],
    ] as const) {
      const { group, material } = coatFigure();
      const draw = qaDraw(params(`coat=${mode}&coatrgb=0.2,0.1,0.05`));
      applyQaDraw(group, draw);
      const version = material.version;
      applyQaDraw(group, draw);
      expect(material.version, mode).toBe(version);
      expect(material.customProgramCacheKey(), mode).toContain(`qa-coat-${mode}`);
      const shader = coatShader();
      material.onBeforeCompile(shader as never, undefined as never);
      expect(shader.fragmentShader, mode).toContain(line);
    }
  });

  it("refuses a coat shader that has lost the lines a mode patches", () => {
    const { group, material } = coatFigure();
    applyQaDraw(group, qaDraw(params("coat=nospec")));
    expect(() =>
      material.onBeforeCompile(
        { vertexShader: "", fragmentShader: "void main() {}", uniforms: {} } as never,
        undefined as never,
      ),
    ).toThrow(/no longer has/);
  });

  it("notes, per body drawn, the vertices each joint's fold gives a row and its texture", () => {
    const { group } = figure({ knee: [0, 1, -1, 2], hip: [-1, -1, -1, 0] });
    const [note] = foldNotes(group);
    expect(note?.vertices).toBe(4);
    expect(note?.joints[KNEE.name]?.slotted).toBe(3);
    expect(note?.joints[HIP.name]?.slotted).toBe(1);
    // No fold set: each joint's texture is its one empty row.
    expect(note?.joints[KNEE.name]?.texture[1]).toBe(1);
    expect(note?.blend).toBe(1);
  });

  it("draws a joint's fold off, again each time the folds arrive, and leaves the other's", () => {
    const { group, geometry } = figure({ knee: [0, 1, -1, 2], hip: [3, -1, -1, 0] });
    const draw = qaDraw(params("nofold=knee"));
    applyQaDraw(group, draw);
    const slotsOf = (joint: (typeof FOLD_JOINTS)[number]) =>
      [0, 1, 2, 3].map((v) => foldSlotAt(geometry, joint, v));
    expect(slotsOf(KNEE)).toEqual([-1, -1, -1, -1]);
    expect(slotsOf(HIP)).toEqual([3, -1, -1, 0]);
    // The folds arrive again (`Humanoid` writes their slots in): forced off again.
    writeFoldSlots(
      geometry.getAttribute(FOLD_SLOTS_ATTRIBUTE) as BufferAttribute,
      KNEE,
      [4, 5, 6, 7],
    );
    applyQaDraw(group, draw);
    expect(slotsOf(KNEE)).toEqual([-1, -1, -1, -1]);
    expect(slotsOf(HIP)).toEqual([3, -1, -1, 0]);
  });

  it("draws normals as colour, smooth or flat, skinned as the figure is, and again if the figure resets it", () => {
    for (const shade of ["normal", "flat"] as const) {
      const { group, body } = figure({});
      applyQaDraw(group, qaDraw(params(`shade=${shade}`)));
      const material = body.material as MeshNormalMaterial;
      expect(material).toBeInstanceOf(MeshNormalMaterial);
      expect(material.flatShading).toBe(shade === "flat");
      // Dual skinning and the folds: the program differs from three's own.
      expect(material.customProgramCacheKey()).toContain("-fold");
      applyQaDraw(group, qaDraw(params(`shade=${shade}`)));
      expect(body.material).toBe(material);
      body.material = new MeshStandardMaterial();
      applyQaDraw(group, qaDraw(params(`shade=${shade}`)));
      expect(body.material).toBeInstanceOf(MeshNormalMaterial);
    }
  });

  it("draws the body matte in a plain standard material, skinned as the figure is", () => {
    const { group, body, material } = figure({});
    applyQaDraw(group, qaDraw(params("shade=matte")));
    const matte = body.material as MeshStandardMaterial;
    expect(matte).toBeInstanceOf(MeshStandardMaterial);
    expect(matte).not.toBe(material);
    expect(matte.normalMap).toBeNull();
    expect(matte.customProgramCacheKey()).toContain("-fold");
  });

  it("draws the skin without its pores' normal map, and nothing else changed", () => {
    const { group, body, material } = figure({});
    material.normalMap = new DataTexture();
    const version = material.version;
    applyQaDraw(group, qaDraw(params("shade=nopores")));
    expect(body.material).toBe(material);
    expect(material.normalMap).toBeNull();
    expect(material.version).toBe(version + 1);
    // Once: the program is not rebuilt every frame.
    applyQaDraw(group, qaDraw(params("shade=nopores")));
    expect(material.version).toBe(version + 1);
  });

  it("draws the skin without its detail relief, and refuses a shader that has none to remove", () => {
    const { group, body, material } = figure({});
    applyQaDraw(group, qaDraw(params("shade=norelief")));
    expect(body.material).toBe(material);
    expect(material.customProgramCacheKey()).toContain("qa-norelief");
    const shader = {
      vertexShader: "",
      fragmentShader:
        "#include <normal_fragment_maps>\n\tnormal = hkPerturbNormal( normal, h, - vViewPosition, faceDirection );\n\tfoo();",
      uniforms: {},
    };
    material.onBeforeCompile(shader as never, undefined as never);
    expect(shader.fragmentShader).toBe("#include <normal_fragment_maps>\n\tfoo();");
    expect(() =>
      material.onBeforeCompile(
        { vertexShader: "", fragmentShader: "void main() {}", uniforms: {} } as never,
        undefined as never,
      ),
    ).toThrow(/no longer tilts the normal/);
  });

  it("draws the triangles over the lit body once, on the body's own skeleton", () => {
    const { group, body, material } = figure({});
    const draw = qaDraw(params("shade=wire"));
    applyQaDraw(group, draw);
    applyQaDraw(group, draw);
    const wires = body.children.filter((c) => (c as SkinnedMesh).isSkinnedMesh);
    expect(wires).toHaveLength(1);
    expect((wires[0] as SkinnedMesh).skeleton).toBe(body.skeleton);
    expect((wires[0] as SkinnedMesh).geometry).toBe(body.geometry);
    expect(body.material).toBe(material);
  });

  it("leaves a lit shot as it is", () => {
    const { group, body, material, geometry } = figure({ knee: [0, 1, 2, 3] });
    applyQaDraw(group, qaDraw(params("")));
    expect(body.material).toBe(material);
    expect(body.children.filter((c) => (c as SkinnedMesh).isSkinnedMesh)).toHaveLength(0);
    expect([0, 1, 2, 3].map((v) => foldSlotAt(geometry, KNEE, v))).toEqual([0, 1, 2, 3]);
  });
});
