/**
 * The whole creator, mounted by a host: the real component over the real worker handler
 * (no Worker), the packs from the dev server, the controls as a person meets them.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  HumanoidCreator,
  type HumanoidCreatorProps,
} from "../../src/editor/ui/HumanoidCreator.tsx";
import { HumanoidProvider } from "../../src/react/index.ts";
import { createRecipe, type Recipe } from "../../src/recipe/recipe.ts";
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
