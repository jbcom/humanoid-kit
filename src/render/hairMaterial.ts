/**
 * The material for scalp hair cards: MakeHuman's hair is flat strips painted
 * with strands on an alpha atlas, and this renders them as hair rather than as
 * paper.
 *
 * - **Colour** is the strand map (the atlas's luminance, normalised to a fixed
 *   mean) times the recipe's pigment colour (`hairTint`), so every style takes
 *   every colour, from black to platinum, with the strands' own structure.
 * - **Edges** are alpha-to-coverage when the canvas is multisampled: the cards'
 *   cut-outs are smooth and write depth, so hair needs no sorting and never
 *   shows the halos blending leaves at overlapping cards. Without MSAA the same
 *   cards render with a plain alpha test (hard edges, still correct).
 *   Shadows use the same alpha, so a card's cut-outs cast no shadow.
 * - **Highlights** are anisotropic: a fibre reflects like a brushed cylinder, a
 *   thin band across the strands. Where the strand map's strands run in one
 *   direction (`strand.coherence`), `anisotropy` stretches the highlight across
 *   them; fluffy and curly styles, with no direction, stay isotropic.
 * - **Occlusion** is baked at pack time, one value per vertex (cards under
 *   others and against the scalp are darker) and scales every lighting term
 *   like the eyes' and teeth's (`patchOcclusionFragment`).
 */
import {
  type BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  LinearSRGBColorSpace,
  MeshPhysicalMaterial,
  type WebGLProgramParametersWithUniforms,
} from "three";
import { type HairColour, hairTint } from "../surface/hairTone.ts";
import { patchOcclusionFragment } from "./occlusion.ts";

/** One float per vertex: how open the card is to light. */
export const HAIR_OCCLUSION_ATTRIBUTE = "hkHairOcclusion";

/**
 * Light that still reaches the deepest hair, as a fraction. Far higher than
 * the eyes' and teeth's floor: the bake treats cards as solid, so the inside of
 * a sparse style reads darker than strands with air between them would be.
 */
export const HAIR_OCCLUSION_FLOOR = 0.5;

/** Texels below this alpha are cut out. */
export const HAIR_ALPHA_CUTOFF = 0.4;

/** The most the highlight is stretched, at a style whose strands are all parallel. */
const MAX_ANISOTROPY = 0.7;

/** Puts a style's per-vertex occlusion on its geometry for `HairMaterial`. */
export function setHairOcclusionAttribute(geometry: BufferGeometry, occlusion: Float32Array): void {
  geometry.setAttribute(HAIR_OCCLUSION_ATTRIBUTE, new Float32BufferAttribute(occlusion, 1));
}

export class HairMaterial extends MeshPhysicalMaterial {
  constructor() {
    super({
      side: DoubleSide,
      roughness: 0.45,
      metalness: 0,
      sheen: 0.35,
      sheenRoughness: 0.6,
      alphaTest: HAIR_ALPHA_CUTOFF,
      alphaToCoverage: true,
      transparent: false,
    });
  }

  /** Colours the hair: the strand map is multiplied by this pigment colour's tint. */
  setColour(colour: HairColour): void {
    const [r, g, b] = hairTint(colour);
    this.color.setRGB(r, g, b, LinearSRGBColorSpace);
    // Fibre fuzz at grazing angles takes the hair's own colour.
    this.sheenColor.setRGB(r, g, b, LinearSRGBColorSpace);
  }

  /**
   * Stretches highlights across the strands where they run one way: `angle` is
   * the strands' direction in texture space (radians from U toward V) and
   * `coherence` how parallel they are (0 fluffy, 1 combed). Anisotropy's own
   * direction is across the fibre, so strands along V give rotation 0.
   */
  setStrand(strand: { angle: number; coherence: number }): void {
    this.anisotropy = MAX_ANISOTROPY * strand.coherence;
    this.anisotropyRotation = strand.angle - Math.PI / 2;
    // Frizzy hair scatters light wider than combed hair does.
    this.roughness = 0.7 - 0.3 * strand.coherence;
  }

  /**
   * Chooses how the cut-outs' edges are drawn: alpha-to-coverage on a
   * multisampled target, a plain alpha test otherwise.
   */
  setMultisampled(multisampled: boolean): void {
    if (this.alphaToCoverage === multisampled) return;
    this.alphaToCoverage = multisampled;
    this.needsUpdate = true;
  }

  override onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float ${HAIR_OCCLUSION_ATTRIBUTE};
varying float vHkOcclusion;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
	vHkOcclusion = ${HAIR_OCCLUSION_ATTRIBUTE};`,
      );
    patchOcclusionFragment(shader, HAIR_OCCLUSION_FLOOR);
  };

  override customProgramCacheKey(): string {
    return "humanoid-kit-hair-1";
  }
}

/** Whether the renderer's current framebuffer is multisampled (alpha-to-coverage needs it). */
export function isMultisampled(gl: WebGL2RenderingContext | WebGLRenderingContext): boolean {
  return (gl.getParameter(gl.SAMPLES) as number) > 1;
}
