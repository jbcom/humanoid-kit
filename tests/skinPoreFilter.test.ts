import { LinearFilter, LinearMipmapLinearFilter } from "three";
import { describe, expect, it } from "vitest";
import { SkinMaterial } from "../src/render/skinMaterial.ts";

// The pore normal map tiles 48 times over a UV island, so a back pixel covers a dozen texels.
// A DataTexture samples with Nearest filters unless told otherwise, and Nearest never reads the
// mip chain: the pores then sparkled in the specular as a frosty grain on deep skin.
describe("the pore normal map's filtering", () => {
  const map = new SkinMaterial().normalMap;

  it("is sampled trilinearly from its mip chain", () => {
    expect(map?.generateMipmaps).toBe(true);
    expect(map?.minFilter).toBe(LinearMipmapLinearFilter);
    expect(map?.magFilter).toBe(LinearFilter);
  });

  it("is sampled anisotropically, so a grazing surface keeps its pores' shape", () => {
    expect(map?.anisotropy).toBeGreaterThan(1);
  });
});
