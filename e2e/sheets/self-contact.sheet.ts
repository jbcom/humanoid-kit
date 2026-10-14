/**
 * Issue #117 private self-contact review sheet. It draws the CPU-skinned indexed
 * surface from the exact authored `relaxed` source pose and final solver rotations.
 *
 *   heavy-slot --remote-render --render-host 192.168.1.201 --context gate -- \
 *     pnpm exec playwright test e2e/sheets/self-contact.sheet.ts --project sheets
 *
 * Every page goes through `openSilentGame`; it cannot persist audio changes.
 * The PNG and receipt JSON are test artifacts only and are never committed.
 */
import fs from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { openSilentGame } from "game-harness/playwright";
import { animationsPack } from "../../packs/animations/index.js";
import { sampleClip } from "../../src/animation/clip.ts";
import { loadAnimationLibrary } from "../../src/animation/library.ts";
import { parseHumanoidAssets } from "../../src/format/assetFormat.ts";
import { landmarkAnchors, landmarks } from "../../src/foundation/landmarks.ts";
import { surfacePoser } from "../../src/foundation/posed.ts";
import { type SiteContactFigure, solveSiteContact } from "../../src/interaction/siteContact.ts";
import { HumanoidModel } from "../../src/model/humanoidModel.ts";
import { skinOfEvaluation } from "../../src/model/reservoirSkin.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";
import type { BoneRotations } from "../../src/rig/bones.ts";
import { bodyPoseRotations, restBones, rigData } from "../../src/rig/pose.ts";
import { adultPackData, bodyPackData } from "../../tests/fixtures.ts";

test.use({ screenshot: "off", trace: "off", video: "off" });

const cases = [
  { id: "child-ear-r", label: "child ear R / pinch", expected: "reached" },
  { id: "child-ear-l", label: "seated child ear L / pinch", expected: "reached" },
  { id: "flat-sternum", label: "adult sternum / flat volar palm", expected: "body-collision" },
  {
    id: "flat-source-chest",
    label: "source-flat chest / lifted flat palm",
    expected: "reached",
  },
  { id: "cup-navel", label: "heavy adult navel / cup volar palm", expected: "reached" },
] as const;

interface Receipt {
  id: string;
  source: string;
  label: string;
  status: "reached" | "unreached";
  reason?: string;
  gap: number;
  collision: number;
  anchor:
    | { kind: "finger-pad" }
    | {
        kind: "volar-palm";
        vertex: number;
        centreVertex: number;
        centreToContact: [number, number, number];
      };
}

const model = new HumanoidModel(parseHumanoidAssets(bodyPackData(), adultPackData()), {
  subdivision: 1,
});
const rig = rigData(model.assets);
let standing: BoneRotations = new Float32Array();

test.beforeAll(async () => {
  const library = await loadAnimationLibrary(animationsPack);
  const clip = await library.load("idle1", rig.bones);
  standing = sampleClip(clip, 0.4, new Float32Array(rig.bones.length * 4));
});
const triple = (values: ArrayLike<number>): [number, number, number] => [
  values[0] as number,
  values[1] as number,
  values[2] as number,
];

const scenarioFor = (id: (typeof cases)[number]["id"]) => {
  switch (id) {
    case "child-ear-r":
      return {
        recipe: createRecipe({ macros: { age: 8, gender: 0.5 } }),
        effector: "finger-pad-1.R",
        site: "ear-lobe.R",
        shape: "pinch" as const,
      };
    case "child-ear-l":
      return {
        recipe: createRecipe({ macros: { age: 8, gender: 0.5 } }),
        effector: "finger-pad-1.L",
        site: "ear-lobe.L",
        shape: "pinch" as const,
      };
    case "flat-sternum":
      return {
        recipe: createRecipe({ macros: { age: 30, gender: 0, weight: 0.2 } }),
        effector: "palm.R",
        site: "sternum-notch",
        shape: "flat" as const,
      };
    case "flat-source-chest":
      return {
        recipe: createRecipe({
          macros: { age: 30, gender: 0, weight: 0, muscle: 0 },
          regionalMacros: {
            breastL: { breastPresence: 0, breastSize: 0 },
            breastR: { breastPresence: 0, breastSize: 0 },
          },
        }),
        effector: "palm.R",
        site: "nipple.R",
        shape: "flat" as const,
      };
    case "cup-navel":
      return {
        recipe: createRecipe({ macros: { age: 30, gender: 1, weight: 1 } }),
        effector: "palm.R",
        site: "navel",
        shape: "cup" as const,
      };
  }
};

function fixtureFor(id: (typeof cases)[number]["id"]) {
  const scenario = scenarioFor(id);
  const ev = model.evaluate(scenario.recipe);
  const topology = ev.surface === "adult" ? model.adultSurface() : model.topology().body;
  if (!topology) throw new Error(`${id}: adult surface is unavailable`);
  const skin = skinOfEvaluation(ev, topology);
  const figure: SiteContactFigure = {
    adult: scenario.recipe.macros.age >= 18,
    generation: ev,
    index: topology.index,
    restBones: restBones(model.assets, Float32Array.from(ev.control)),
    rest: Float32Array.from(ev.positions),
    restNormals: Float32Array.from(ev.normals),
    skinIndex: skin.skinIndex,
    skinWeight: skin.skinWeight,
    anchors: landmarkAnchors(model, ev.surface),
  };
  // This is the former sparse-sample false clear: the exact final hand pass
  // must choose a genuinely clear pose for the seated left-ear pinch.
  const source =
    id === "child-ear-l"
      ? Float32Array.from(bodyPoseRotations(rig, "seated"))
      : Float32Array.from(standing);
  const out = new Float32Array(source.length);
  const report = solveSiteContact({
    figure,
    source,
    effector: scenario.effector,
    site: scenario.site,
    shape: scenario.shape,
    out,
  });
  const expected = cases.find((entry) => entry.id === id)?.expected;
  if (expected === "reached" && report.status !== "reached")
    throw new Error(`${id}: ${report.reason ?? "unreached"}`);
  if (expected === "body-collision" && report.reason !== "body-collision")
    throw new Error(`${id}: expected body collision, got ${report.reason ?? report.status}`);
  const posed = surfacePoser(model, scenario.recipe)(out);
  const frames = landmarks(model, posed) as Record<
    string,
    { position: readonly number[]; normal: readonly number[] }
  >;
  const site = frames[scenario.site];
  const effector = frames[scenario.effector];
  if (!site || !effector) throw new Error(`${id}: contact landmarks are missing`);
  const contact = report.contact;
  const vertex = contact?.vertex;
  return {
    positions: [...posed.positions],
    normals: [...posed.normals],
    index: [...posed.index],
    target: triple(site.position),
    anchor:
      vertex === undefined
        ? triple(effector.position)
        : triple(posed.positions.subarray(vertex * 3, vertex * 3 + 3)),
    normal: contact ? triple(contact.normal) : triple(site.normal),
    ...(contact && {
      centre: triple(
        posed.positions.subarray(contact.centreVertex * 3, contact.centreVertex * 3 + 3),
      ),
    }),
    receipt: {
      id,
      source: "idle1@0.4",
      label: cases.find((entry) => entry.id === id)?.label ?? id,
      status: report.status,
      ...(report.reason && { reason: report.reason }),
      gap: report.gap,
      collision: report.collision,
      anchor:
        vertex === undefined
          ? { kind: "finger-pad" as const }
          : {
              kind: "volar-palm" as const,
              vertex,
              centreVertex: contact?.centreVertex ?? -1,
              centreToContact: contact?.centreToContact ?? [0, 0, 0],
            },
    },
  };
}

const frames = (page: Page, count = 4) =>
  page.evaluate(
    (n) =>
      new Promise<void>((done) => {
        let seen = 0;
        const tick = () => (++seen >= n ? done() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    count,
  );

async function cell(
  page: Page,
  id: (typeof cases)[number]["id"],
): Promise<{ png: string; receipt: Receipt }> {
  const fixture = fixtureFor(id);
  await page.addInitScript((input) => {
    window.hkSelfContactFixture = input;
  }, fixture);
  await openSilentGame(page, `/?scene=self-contact&case=${id}`, {}, { markerTimeout: 120_000 });
  await page.waitForFunction(
    () => {
      const figure = document.querySelector<HTMLElement>("[data-figure]");
      if (figure?.dataset.figure === "error") throw new Error(figure.textContent ?? "lab error");
      return figure?.dataset.figure === "ready";
    },
    undefined,
    { timeout: 300_000 },
  );
  await expect
    .poll(() => page.evaluate(() => window.hkSelfContact?.() ?? null), { timeout: 30_000 })
    .not.toBeNull();
  await frames(page);
  const receipt = await page.evaluate(() => {
    const value = window.hkSelfContact?.();
    if (!value) throw new Error("self-contact lab did not publish its solved receipt");
    return value;
  });
  const expected = cases.find((entry) => entry.id === id)?.expected;
  expect(expected, `${id}: fixture expectation`).toBeDefined();
  expect(receipt.status, `${id}: solver status`).toBe(
    expected === "reached" ? "reached" : "unreached",
  );
  if (expected === "body-collision")
    expect(receipt.reason, `${id}: collision reason`).toBe("body-collision");
  expect(receipt.gap, `${id}: anchor gap`).toBeLessThanOrEqual(0.004);
  if (expected === "reached")
    expect(receipt.collision, `${id}: indexed final-body collision shortfall`).toBe(0);
  else expect(receipt.collision, `${id}: collision is not hidden`).toBeGreaterThan(0);
  if (receipt.anchor.kind === "volar-palm") {
    expect(receipt.anchor.kind, `${id}: broad contact is a volar palm patch`).toBe("volar-palm");
    expect(Number.isInteger(receipt.anchor.vertex), `${id}: source render vertex`).toBe(true);
  } else expect(receipt.anchor.kind, `${id}: child pinch uses its finger pad`).toBe("finger-pad");
  return { png: (await page.locator("canvas").screenshot()).toString("base64"), receipt };
}

async function composite(
  page: Page,
  cells: readonly { label: string; png: string; receipt: Receipt }[],
): Promise<string> {
  return page.evaluate(async (input) => {
    const decode = async (b64: string) =>
      createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const images = await Promise.all(input.map((cell) => decode(cell.png)));
    const first = images[0];
    if (!first) throw new Error("self-contact sheet has no cells");
    const columns = 2;
    const title = 42;
    const caption = 62;
    const canvas = document.createElement("canvas");
    canvas.width = columns * first.width;
    canvas.height = title + Math.ceil(images.length / columns) * (first.height + caption);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("self-contact sheet has no 2D canvas");
    ctx.fillStyle = "#14202c";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fff";
    ctx.font = "600 18px system-ui, sans-serif";
    ctx.fillText(
      "Issue #117: actual self-contact — magenta support, cyan support normal, yellow site, violet palm centre",
      12,
      27,
    );
    ctx.font = "12px ui-monospace, monospace";
    input.forEach((cell, index) => {
      const x = (index % columns) * first.width;
      const y = title + Math.floor(index / columns) * (first.height + caption);
      ctx.drawImage(images[index] as ImageBitmap, x, y);
      const anchor =
        cell.receipt.anchor.kind === "volar-palm"
          ? `volar-palm v${cell.receipt.anchor.vertex}`
          : "finger-pad";
      ctx.fillStyle = "#d9e4ef";
      ctx.fillText(cell.label, x + 8, y + first.height + 18);
      ctx.fillText(
        `${cell.receipt.status}${cell.receipt.reason ? `/${cell.receipt.reason}` : ""}; ${anchor}`,
        x + 8,
        y + first.height + 37,
      );
      ctx.fillText(
        `gap ${(cell.receipt.gap * 1000).toFixed(2)} mm; collision ${(cell.receipt.collision * 1000).toFixed(3)} mm`,
        x + 8,
        y + first.height + 53,
      );
    });
    return canvas.toDataURL("image/png").split(",")[1] as string;
  }, cells);
}

test("issue 117 solved self-contact review sheet", async ({ page }, info) => {
  await page.setViewportSize({ width: 480, height: 480 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Outdated Optimize Dep"))
      errors.push(message.text());
  });
  const cells: { label: string; png: string; receipt: Receipt }[] = [];
  for (const scenario of cases)
    cells.push({ label: scenario.label, ...(await cell(page, scenario.id)) });
  const png = Buffer.from(await composite(page, cells), "base64");
  const image = info.outputPath("self-contact.png");
  const receipt = info.outputPath("self-contact.receipt.json");
  fs.writeFileSync(image, png);
  fs.writeFileSync(
    receipt,
    `${JSON.stringify(
      cells.map(({ receipt: item }) => item),
      null,
      2,
    )}\n`,
  );
  await info.attach("self-contact", { path: image, contentType: "image/png" });
  await info.attach("self-contact-receipt", { path: receipt, contentType: "application/json" });
  expect(errors, "page errors while drawing self-contact sheet").toEqual([]);
});
