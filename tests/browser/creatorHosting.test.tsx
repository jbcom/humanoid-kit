/**
 * The whole creator, mounted by a host: the real component over the real worker handler
 * (no Worker), the packs from the dev server, the controls as a person meets them.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { UncoverRequest } from "../../src/editor/cover.ts";
import {
  HumanoidCreator,
  type HumanoidCreatorProps,
} from "../../src/editor/ui/HumanoidCreator.tsx";
import type { WardrobeEntry } from "../../src/editor/wardrobe.ts";
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
