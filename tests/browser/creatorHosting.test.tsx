/**
 * The whole creator, mounted by a host: the real component over the real worker handler
 * (no Worker), the packs from the dev server, the controls as a person meets them.
 */

import { eyesPack } from "humanoid-kit-eyes";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { UncoverRequest } from "../../src/editor/cover.ts";
import {
  HumanoidCreator,
  type HumanoidCreatorProps,
} from "../../src/editor/ui/HumanoidCreator.tsx";
import type { WardrobeEntry } from "../../src/editor/wardrobe.ts";
import { type EyeLibrary, loadEyeLibrary } from "../../src/eyes/library.ts";
import { HumanoidProvider } from "../../src/react/index.ts";
import { createRecipe, type Recipe } from "../../src/recipe/recipe.ts";
import { readyInfo } from "./harness.tsx";
import { inlineWorkerClient } from "./inlineClient.ts";

// Loading the body pack and evaluating a figure in a real browser takes a while.
const LOAD = { timeout: 120_000 };

const client = inlineWorkerClient();
beforeAll(async () => {
  await client.ready;
});
afterAll(() => client.dispose());

const Host = (props: HumanoidCreatorProps) => (
  <HumanoidProvider client={client}>
    <div style={{ width: 1100, height: 720 }}>
      <HumanoidCreator {...props} />
    </div>
  </HumanoidProvider>
);

const thirty = createRecipe({ macros: { age: 30 } });

describe("<HumanoidCreator controls>", () => {
  it(
    "shows only the range, keeps the figure inside it, and tells the host nothing it refused",
    async () => {
      const told: Recipe[] = [];
      const screen = await render(
        <Host
          initialRecipe={createRecipe({ macros: { age: 25 } })}
          controls={{ ranges: { age: { min: 25, max: 60 } } }}
          onChange={(r) => told.push(r)}
        />,
      );
      const age = screen.getByRole("slider", { name: "Age" });
      await expect.element(age, LOAD).toHaveAttribute("min", "25");
      await expect.element(age).toHaveAttribute("max", "60");
      (age.element() as HTMLElement).focus();
      await userEvent.keyboard("{ArrowLeft}{ArrowLeft}{Home}");
      await expect.element(age).toHaveAttribute("aria-valuetext", "25 yr");
      expect(told.every((r) => r.macros.age >= 25)).toBe(true);
      await userEvent.keyboard("{ArrowRight}");
      await expect.poll(() => told.at(-1)?.macros.age).toBeGreaterThan(25);
    },
    LOAD.timeout,
  );

  it(
    "leaves out the sliders, tasks and panels the host hides, in the tabs and in the search",
    async () => {
      const screen = await render(
        <Host
          initialRecipe={thirty}
          controls={{ hide: ["weight"], hideTasks: ["Face"], hidePanels: ["regions"] }}
        />,
      );
      await expect.element(screen.getByRole("tab", { name: "Main" }), LOAD).toBeVisible();
      await expect.element(screen.getByRole("tab", { name: "Face" })).not.toBeInTheDocument();
      await expect.element(screen.getByRole("tab", { name: "Regions" })).not.toBeInTheDocument();
      await expect.element(screen.getByRole("tab", { name: "Skin & eyes" })).toBeVisible();
      await expect.element(screen.getByRole("slider", { name: "Muscle" })).toBeVisible();
      await expect.element(screen.getByRole("slider", { name: "Weight" })).not.toBeInTheDocument();
      await userEvent.fill(screen.getByRole("searchbox", { name: "Search sliders" }), "nose");
      await expect.element(screen.getByText("No sliders match “nose”.")).toBeVisible();
    },
    LOAD.timeout,
  );

  it(
    "refuses through onBeforeChange before anything is drawn, and reports the refusal",
    async () => {
      const told: Recipe[] = [];
      const refused: string[] = [];
      const screen = await render(
        <Host
          initialRecipe={thirty}
          onChange={(r) => told.push(r)}
          onBeforeChange={(p) => (p.macros.muscle > 0.6 ? false : p)}
          onReject={(x) => refused.push(`${x.reason}:${x.cause}`)}
        />,
      );
      const muscle = screen.getByRole("slider", { name: "Muscle" });
      await expect.element(muscle, LOAD).toBeVisible();
      (muscle.element() as HTMLElement).focus();
      await userEvent.keyboard("{End}");
      await expect.poll(() => refused).toEqual(["veto:edit"]);
      expect(told.every((r) => r.macros.muscle <= 0.6)).toBe(true);
      await expect.element(muscle).toHaveAttribute("aria-valuetext", "50%");
    },
    LOAD.timeout,
  );

  it(
    "is controlled by value: the figure shown is the host's",
    async () => {
      const told: Recipe[] = [];
      const screen = await render(<Host value={thirty} onChange={(r) => told.push(r)} />);
      const muscle = screen.getByRole("slider", { name: "Muscle" });
      await expect.element(muscle, LOAD).toBeVisible();
      (muscle.element() as HTMLElement).focus();
      await userEvent.keyboard("{ArrowRight}");
      await expect.poll(() => told.length).toBeGreaterThan(0);
      // The host did not take it: the slider is where the host's figure puts it.
      await expect.element(muscle).toHaveAttribute("aria-valuetext", "50%");
      expect(told.every((r) => r !== thirty)).toBe(true);
    },
    LOAD.timeout,
  );
});

// The worker is the point of these: every recipe it is ever sent is recorded.
const sent: Recipe[] = [];
const clothed = inlineWorkerClient(
  { subdivision: 0 },
  {
    clothing: true,
    onRequest: (request) => {
      if ("recipe" in request) sent.push(request.recipe as Recipe);
    },
  },
);
const wardrobe = readyInfo(false, true).wardrobe;
const SUIT = wardrobe.find((g) => g.kind === "clothes") as WardrobeEntry;
const suitIds = new Set(wardrobe.filter((g) => g.kind === "clothes").map((g) => g.id));
const uncovered = (r: Recipe) => !(r.outfit ?? []).some((id) => suitIds.has(id));
const suited = createRecipe({ macros: { age: 30 }, outfit: [SUIT.id] });

function defer<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

describe("<HumanoidCreator coverPolicy>", () => {
  beforeAll(async () => {
    await clothed.ready;
  });
  afterAll(() => clothed.dispose());
  beforeEach(() => {
    sent.length = 0;
  });

  const Clothed = (props: HumanoidCreatorProps) => (
    <HumanoidProvider client={clothed}>
      <div style={{ width: 1100, height: 720 }}>
        <HumanoidCreator {...props} />
      </div>
    </HumanoidProvider>
  );

  it(
    "sends the worker nothing for an uncovered starting figure until the policy allows it",
    async () => {
      const answer = defer<boolean>();
      const asked: UncoverRequest[] = [];
      const screen = await render(
        <Clothed
          initialRecipe={thirty}
          coverPolicy={{
            allowUncover: (r) => {
              asked.push(r);
              return answer.promise;
            },
          }}
        />,
      );
      await expect.element(screen.getByText("Waiting for confirmation…"), LOAD).toBeVisible();
      expect(asked.map((r) => r.cause)).toEqual(["initial"]);
      // Time enough for an evaluation, were one going to be made.
      await pause(1500);
      expect(sent).toEqual([]);
      answer.resolve(true);
      await expect.poll(() => sent.some(uncovered), LOAD).toBe(true);
      await expect.element(screen.getByText("Waiting for confirmation…")).not.toBeInTheDocument();
    },
    LOAD.timeout,
  );

  it(
    "keeps drawing the covered figure while an uncovering is asked about, and refuses it",
    async () => {
      const answers = [defer<boolean>(), defer<boolean>()];
      let asked = 0;
      const screen = await render(
        <Clothed
          initialRecipe={suited}
          coverPolicy={{
            allowUncover: () => (answers[asked++] as { promise: Promise<boolean> }).promise,
          }}
        />,
      );
      await expect.poll(() => sent.length, LOAD).toBeGreaterThan(0);
      expect(sent.every((r) => !uncovered(r))).toBe(true);
      await screen.getByRole("tab", { name: "Wardrobe" }).click();
      const chip = screen.getByRole("button", { name: SUIT.label });
      await expect.element(chip).toHaveAttribute("aria-pressed", "true");
      await chip.click();
      await expect.element(screen.getByText("Waiting for confirmation…")).toBeVisible();
      // The controls are inert while the host is asked.
      expect(
        screen.getByRole("tab", { name: "Wardrobe" }).element().closest("[inert]"),
      ).not.toBeNull();
      await pause(1000);
      expect(sent.some(uncovered)).toBe(false);
      (answers[0] as { resolve: (v: boolean) => void }).resolve(false);
      await expect.element(screen.getByText("Waiting for confirmation…")).not.toBeInTheDocument();
      await expect.element(chip).toHaveAttribute("aria-pressed", "true");
      await pause(1000);
      expect(sent.some(uncovered)).toBe(false);
      // Asked again, and allowed this time.
      await chip.click();
      (answers[1] as { resolve: (v: boolean) => void }).resolve(true);
      await expect.element(chip).toHaveAttribute("aria-pressed", "false");
      await expect.poll(() => sent.some(uncovered), LOAD).toBe(true);
    },
    LOAD.timeout,
  );

  it(
    "does not offer taking off what a policy with no one to ask would refuse",
    async () => {
      const screen = await render(<Clothed initialRecipe={suited} coverPolicy={{}} />);
      await screen.getByRole("tab", { name: "Wardrobe" }).click();
      await expect.element(screen.getByRole("button", { name: SUIT.label }), LOAD).toBeDisabled();
      const other = wardrobe.find((g) => g.kind === "shoes") as WardrobeEntry;
      await expect.element(screen.getByRole("button", { name: other.label })).toBeEnabled();
    },
    LOAD.timeout,
  );
});

describe("<HumanoidCreator eyeMaterials>", () => {
  /** The real pack, which records the textures the figure asks for. */
  async function recordingLibrary() {
    const real = await loadEyeLibrary(eyesPack);
    const asked: string[] = [];
    const library: EyeLibrary = {
      manifest: real.manifest,
      entry: (id) => real.entry(id),
      textureUrl: (id) => {
        asked.push(id);
        return real.textureUrl(id);
      },
    };
    return { library, asked };
  }

  it(
    "gives the figure the library, so it wears the material its recipe names",
    async () => {
      const { library, asked } = await recordingLibrary();
      await render(
        <Host
          eyeMaterials={library}
          initialRecipe={createRecipe({
            macros: { age: 30 },
            eyes: { material: "bobby_03_diffuse_blue_eyes" },
          })}
        />,
      );
      await expect.poll(() => asked, LOAD).toContain("bobby_03_diffuse_blue_eyes");
    },
    LOAD.timeout,
  );

  it(
    "offers the pack in Appearance, and the figure wears what is picked",
    async () => {
      const { library, asked } = await recordingLibrary();
      const told: Recipe[] = [];
      const screen = await render(
        <Host eyeMaterials={library} initialRecipe={thirty} onChange={(r) => told.push(r)} />,
      );
      await screen.getByRole("tab", { name: "Skin & eyes" }).click({ timeout: LOAD.timeout });
      expect(asked).toEqual([]);
      await screen.getByRole("button", { name: "Green cat eyes", exact: true }).click();
      await expect.poll(() => told.at(-1)?.eyes.material).toBe("nyloseth_green_cat_eyes");
      await expect.poll(() => asked, LOAD).toContain("nyloseth_green_cat_eyes");
    },
    LOAD.timeout,
  );

  it(
    "offers no choice without the library",
    async () => {
      const screen = await render(<Host initialRecipe={thirty} />);
      await screen.getByRole("tab", { name: "Skin & eyes" }).click({ timeout: LOAD.timeout });
      await expect.element(screen.getByRole("group", { name: "Iris colour" })).toBeVisible();
      await expect
        .element(screen.getByRole("group", { name: "Eye texture" }))
        .not.toBeInTheDocument();
    },
    LOAD.timeout,
  );
});

describe("<HumanoidCreator background>", () => {
  const root = () => document.querySelector(".hk-creator") as HTMLElement;
  const canvas = () => document.querySelector(".hk-stage canvas") as HTMLCanvasElement;
  const backgroundOf = (el: Element) => getComputedStyle(el).backgroundColor;

  /** The canvas's alpha at a corner, and whether anything opaque is drawn down its middle. */
  function pixels(): { corner: number; figure: boolean } {
    const c = canvas();
    const copy = document.createElement("canvas");
    copy.width = 64;
    copy.height = 64;
    const ctx = copy.getContext("2d") as CanvasRenderingContext2D;
    ctx.drawImage(c, 0, 0, 64, 64);
    const column = ctx.getImageData(32, 0, 1, 64).data;
    return {
      corner: ctx.getImageData(2, 2, 1, 1).data[3] as number,
      figure: Array.from({ length: 64 }, (_, y) => column[y * 4 + 3]).includes(255),
    };
  }

  /** Waits until the figure has been drawn, so an empty canvas does not pass for a transparent one. */
  async function drawn(screen: Awaited<ReturnType<typeof render>>) {
    await expect.element(screen.getByText("Loading figure…"), LOAD).not.toBeInTheDocument();
    await expect.poll(() => pixels().figure, LOAD).toBe(true);
  }

  it(
    "shows the stage in --hk-bg, by leaving the canvas transparent over it",
    async () => {
      const screen = await render(<Host initialRecipe={thirty} />);
      await drawn(screen);
      expect(backgroundOf(root())).toBe("rgb(27, 37, 48)");
      expect(pixels().corner).toBe(0);
      // Nothing between the canvas and the root paints over it.
      for (let el: Element | null = canvas(); el && el !== root(); el = el.parentElement)
        expect(backgroundOf(el), el.className || el.tagName).toBe("rgba(0, 0, 0, 0)");
    },
    LOAD.timeout,
  );

  it(
    "follows a host's stylesheet, and a change of the variable at run time",
    async () => {
      const screen = await render(
        <>
          <style>{".hk-creator.themed { --hk-bg: rgb(59, 42, 85); }"}</style>
          <Host initialRecipe={thirty} className="themed" />
        </>,
      );
      await drawn(screen);
      expect(backgroundOf(root())).toBe("rgb(59, 42, 85)");
      expect(pixels().corner).toBe(0);
      // No render: the variable alone moves the stage.
      root().style.setProperty("--hk-bg", "rgb(200, 180, 20)");
      expect(backgroundOf(root())).toBe("rgb(200, 180, 20)");
    },
    LOAD.timeout,
  );

  it(
    "takes a colour as a prop",
    async () => {
      const screen = await render(<Host initialRecipe={thirty} background="rgb(10, 200, 30)" />);
      await drawn(screen);
      expect(backgroundOf(root())).toBe("rgb(10, 200, 30)");
      expect(pixels().corner).toBe(0);
    },
    LOAD.timeout,
  );
});
