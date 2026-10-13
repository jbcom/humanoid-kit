/**
 * The body's vertex shader fits the GPU's attribute budget. WebGL guarantees 16
 * vertex attributes (`MAX_VERTEX_ATTRIBS`), and a program that declares more fails
 * to link, so the body draws nothing ("Too many attributes"); this limit is the
 * GPU's, not MakeHuman's model's, and the figure's per-vertex data (the skin's
 * eight influences, the occlusion, the folds' slots) is packed to live inside it.
 * The count is read off the shader the material builds, with three's chunks
 * resolved, and the program's own position, normal, uv and skin indices and weights added.
 */
import {
  ShaderChunk,
  ShaderLib,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from "three";
import { describe, expect, it } from "vitest";
import { DualBones } from "../src/render/dualSkinning.ts";
import { SkinMaterial } from "../src/render/skinMaterial.ts";

/** What three's program prefix declares of a skinned material, which the shader chunks do not. */
const PREFIX = ["position", "normal", "uv", "skinIndex", "skinWeight"];
/** WebGL's guaranteed minimum of `MAX_VERTEX_ATTRIBS`. */
const BUDGET = 16;

/** Replaces `#include <chunk>` with the chunk, as three does. */
const resolve = (source: string): string =>
  source.replace(/^[ \t]*#include <(\w+)>/gm, (_, name: string) => {
    const chunk = (ShaderChunk as Record<string, string>)[name];
    if (chunk === undefined) throw new Error(`no shader chunk ${name}`);
    return resolve(chunk);
  });

/** The attribute names `source` declares where `defined` holds, through its `#ifdef` blocks. */
function declaredAttributes(source: string, start: ReadonlySet<string>): string[] {
  const names: string[] = [];
  const defined = new Set(start);
  const live: boolean[] = [true];
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    const open = live.every(Boolean);
    const ifdef = line.match(/^#ifdef\s+(\w+)/)?.[1];
    const ifndef = line.match(/^#ifndef\s+(\w+)/)?.[1];
    const define = line.match(/^#define\s+(\w+)/)?.[1];
    const attribute = line.match(/^attribute\s+\w+\s+(\w+)\s*;/)?.[1];
    if (ifdef) live.push(defined.has(ifdef));
    else if (ifndef) live.push(!defined.has(ifndef));
    else if (line.startsWith("#if")) live.push(false);
    else if (line.startsWith("#elif")) live[live.length - 1] = false;
    else if (line.startsWith("#else")) live[live.length - 1] = !live[live.length - 1];
    else if (line.startsWith("#endif")) live.pop();
    else if (open && define) defined.add(define);
    else if (open && attribute) names.push(attribute);
  }
  return names;
}

function bodyShader(): string {
  const material = new SkinMaterial();
  material.setDualBones(new DualBones(1, 1));
  const shader = {
    uniforms: {},
    vertexShader: ShaderLib.physical.vertexShader,
    fragmentShader: ShaderLib.physical.fragmentShader,
  } as unknown as WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as WebGLRenderer);
  return resolve(shader.vertexShader);
}

describe("the body's vertex attributes", () => {
  it("number no more than the GPU's guaranteed sixteen", () => {
    const declared = declaredAttributes(bodyShader(), new Set(["USE_SKINNING"]));
    // The shared names only once, however a chunk repeats them.
    const all = [...new Set([...PREFIX, ...declared])];
    expect(all.length, all.join(", ")).toBeLessThanOrEqual(BUDGET);
  });

  it("carries the joint folds' slots in one attribute, not one a joint", () => {
    const declared = declaredAttributes(bodyShader(), new Set(["USE_SKINNING"]));
    expect(declared.filter((n) => n.startsWith("hkFoldSlot"))).toEqual(["hkFoldSlots"]);
  });
});
