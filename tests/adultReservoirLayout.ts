import { reservoirLayout } from "../scripts/lib/adultReservoirs.ts";
import { AUTHORING_FIGURE } from "../scripts/lib/control/mound.ts";
import { maleParts } from "../scripts/lib/detail/sculpt.ts";
import { placeVulva } from "../scripts/lib/detail/vulva.ts";
import { type AdultSurfacePatch, parseHumanoidAssets } from "../src/format/assetFormat.ts";
import type { AdultDetailLattice } from "../src/model/humanoidModel.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { adultManifest, adultPackData, bodyPackData, loadFixtureAssets } from "./fixtures.ts";

/**
 * The adult pack's reservoirs as the packer lays them out, from the shipped pack's
 * own refinement and the authoring figure: the generator's whole input, so a test can
 * run it as often as it likes (`tests/adultReservoirs.test.ts`, which holds the result
 * to the shipped pack, and `tests/adultReservoirsRounding.test.ts`, which holds it to
 * itself under another platform's rounding).
 */
export function generateReservoirLayout(): ReturnType<typeof reservoirLayout> {
  const assets = loadFixtureAssets(true);
  const model = new HumanoidModel(assets, { subdivision: 1 });
  const parts = maleParts(assets, model.controlShape(AUTHORING_FIGURE).control);
  const surface = adultManifest.anatomy?.surface;
  if (!surface) throw new Error("no surface");
  // The generator lays the reservoirs out on the refinement before any patch, and
  // names them on the refinement with its patches (scripts/lib/detail/smoothLoop.ts).
  const latticeWith = (patches: AdultSurfacePatch[]): AdultDetailLattice => {
    const manifest = structuredClone(adultManifest);
    const anatomy = manifest.anatomy as NonNullable<typeof manifest.anatomy>;
    anatomy.surface = { faces: surface.faces, levels: surface.levels, patches };
    delete anatomy.reservoirs;
    delete anatomy.detail;
    const on = new HumanoidModel(
      parseHumanoidAssets(bodyPackData(), { ...adultPackData(), manifest }),
      { subdivision: 1 },
    ).adultDetailLattice(AUTHORING_FIGURE);
    if (!on) throw new Error("no adult surface");
    return on;
  };
  const openings = placeVulva(assets, model.controlShape(AUTHORING_FIGURE).control);
  return reservoirLayout(latticeWith([]), parts, openings, latticeWith);
}
