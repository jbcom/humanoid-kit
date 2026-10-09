/**
 * How far are the skin shader's scatter approximations from the exact
 * pre-integrated diffusion, on the figure's real curvatures and the measured
 * skin range?
 *
 *   node scripts/research/preintegration.ts
 *
 * The reference is Penner's pre-integration of Burley's profile over a sphere
 * (src/surface/preintegration.ts). Two approximations are measured: the
 * energy-conserving wrap the shader used first (a closed-form fit, kept here
 * as the baseline), and the table it samples now (SCATTER_TABLE). Curvatures
 * come from the default figure's evaluated mesh. Differences are CIEDE2000 of
 * linear radiance with the key at N·L = 1 giving A, without and with a fill
 * light (a fraction of the key, added equally to both, as a studio's ambient
 * light would be). This measurement is why the shader samples a table.
 */
import { deltaE2000, labFromLinear } from "../../e2e/lib/colour.ts";
import { HumanoidModel } from "../../src/model/humanoidModel.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";
import { preintegratedDiffuse } from "../../src/surface/preintegration.ts";
import { SKIN_SCATTER, scatterDistance, scatterTableDiffuse } from "../../src/surface/scatter.ts";
import { MELANIN_ANCHORS, type Rgb } from "../../src/surface/skinTone.ts";
import { loadFixtureAssets } from "../../tests/fixtures.ts";

/** The first shader's fit: McAuley's energy-conserving wrap with w fitted to x. */
const wrapFit = (nDotL: number, x: number) => {
  const y = Math.max(0, x) ** 1.2997;
  const w = (2.0246 * y) / (1 + 1.3543 * y);
  return Math.max(nDotL + w, 0) / ((1 + w) * (1 + w));
};

const model = new HumanoidModel(loadFixtureAssets(), { subdivision: 1 });
const curvature = [...model.evaluate(createRecipe()).curvature].sort((a, b) => a - b);
const q = (p: number) => curvature[Math.floor(p * (curvature.length - 1))] as number;
const quantiles = [0.5, 0.9, 0.99, 0.999];
console.log(
  `figure curvature (m⁻¹): ${quantiles.map((p) => `p${p * 100} ${q(p).toFixed(0)}`).join(", ")}, max ${q(1).toFixed(0)}`,
);

const substrate = MELANIN_ANCHORS[0] as Rgb;
const thetas = Array.from({ length: 23 }, (_, i) => (i * 5 * Math.PI) / 180); // 0°..110°
const approximations = { "wrap fit": wrapFit, table: scatterTableDiffuse };
for (const [label, approx] of Object.entries(approximations)) {
  for (const fill of [0, 0.15]) {
    for (const p of quantiles) {
      const kappa = q(p);
      let worst = 0;
      let where = "";
      for (const [i, anchor] of MELANIN_ANCHORS.entries()) {
        const d = scatterDistance(
          anchor as Rgb,
          SKIN_SCATTER.mfp,
          SKIN_SCATTER.slope,
          SKIN_SCATTER.pigmentDepth,
          substrate,
        );
        const x = d.map((dc) => dc * kappa);
        for (const t of thetas) {
          const c = Math.cos(t);
          const got = anchor.map((a, k) => a * (fill + approx(c, x[k] as number))) as Rgb;
          const ref = anchor.map(
            (a, k) => a * (fill + preintegratedDiffuse(c, x[k] as number, 3000)),
          ) as Rgb;
          const de = deltaE2000(labFromLinear(got), labFromLinear(ref));
          if (de > worst) {
            worst = de;
            where = `melanin ${i / 10} at ${Math.round((t * 180) / Math.PI)}°, x_r ${(x[0] as number).toFixed(3)}`;
          }
        }
      }
      console.log(
        `${label}, fill ${fill}, p${p * 100} curvature ${kappa.toFixed(0)} m⁻¹: worst ΔE00 ${worst.toFixed(2)} (${where})`,
      );
    }
  }
}
