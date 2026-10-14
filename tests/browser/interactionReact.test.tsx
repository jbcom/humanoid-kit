import { Canvas } from "@react-three/fiber";
import { type ReactNode, useEffect } from "react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import type { InteractionDefinition } from "../../src/interaction/definition.ts";
import { createInteractions, type Offer } from "../../src/interaction/runtime.ts";
import { createPresenceRegistry, type ObjectPresence } from "../../src/presence/presence.ts";
import {
  Interactable,
  InteractionsProvider,
  useInteraction,
  useInteractionEvents,
} from "../../src/react/interaction.tsx";
import { PresenceProvider } from "../../src/react/presence.tsx";
import { apple, figure } from "../interactionHarness.ts";

const LOOK: InteractionDefinition = {
  id: "look",
  tags: ["social.look"],
  audience: "all",
  roles: [{ name: "viewer", takes: "figure", track: { act: { clip: "look" } } }],
};

function setup() {
  const registry = createPresenceRegistry();
  const runtime = createInteractions(registry, { seed: 1, clipLength: () => 1 });
  runtime.define([LOOK]);
  registry.set(figure("ada", true));
  return { registry, runtime };
}

function Scene({
  registry,
  runtime,
  children,
}: {
  registry: ReturnType<typeof createPresenceRegistry>;
  runtime: ReturnType<typeof createInteractions>;
  children: ReactNode;
}) {
  return (
    <div style={{ height: 80, width: 80 }}>
      <Canvas>
        <PresenceProvider registry={registry}>
          <InteractionsProvider runtime={runtime}>{children}</InteractionsProvider>
        </PresenceProvider>
      </Canvas>
    </div>
  );
}

const object = (): ObjectPresence => apple("apple");
const offer = (by = "apple"): Offer => ({
  id: "eat-apple",
  by,
  definition: "look",
  role: "viewer",
  tags: ["social.look"],
  slots: 1,
});

describe("React interaction bindings", () => {
  it("registers its object and offers, then removes each on replacement and unmount", async () => {
    const { registry, runtime } = setup();
    const registered = object();
    const screen = await render(
      <Scene registry={registry} runtime={runtime}>
        <Interactable object={registered} offers={[offer()]} />
      </Scene>,
    );
    await expect.poll(() => registry.getObject("apple")).toBeDefined();
    expect(runtime.offersFor("ada").map((item) => item.id)).toEqual(["eat-apple"]);

    await screen.rerender(
      <Scene registry={registry} runtime={runtime}>
        <Interactable object={registered} offers={[]} />
      </Scene>,
    );
    await expect.poll(() => registry.getObject("apple")).toBeDefined();
    expect(runtime.offersFor("ada")).toEqual([]);

    await screen.unmount();
    await expect.poll(() => registry.getObject("apple")).toBeUndefined();
  });

  it("uses the latest event listener and removes it on unmount", async () => {
    const { registry, runtime } = setup();
    const first: string[] = [];
    const current: string[] = [];
    function Listener({ seen }: { seen: string[] }) {
      useInteractionEvents("ada", (event) => seen.push(event.type));
      useEffect(() => {
        seen.push("mounted");
      }, [seen]);
      return null;
    }
    const scene = (seen: string[]) => (
      <Scene registry={registry} runtime={runtime}>
        <Listener seen={seen} />
      </Scene>
    );
    const screen = await render(scene(first));
    await expect.poll(() => first).toEqual(["mounted"]);
    await screen.rerender(scene(current));
    await expect.poll(() => current).toEqual(["mounted"]);

    const running = runtime.propose("look", { viewer: "ada" });
    running.cancel();
    expect(first).toEqual(["mounted"]);
    expect(current).toEqual(["mounted", "cancelled"]);

    await screen.unmount();
    runtime.propose("look", { viewer: "ada" }).cancel();
    expect(current).toEqual(["mounted", "cancelled"]);
  });

  it("reads a running interaction without re-rendering on runtime changes", async () => {
    const { registry, runtime } = setup();
    let renders = 0;
    let reference: ReturnType<typeof useInteraction> | undefined;
    function Probe({ id }: { id: string }) {
      renders++;
      reference = useInteraction(id);
      return null;
    }
    const id = "look#0";
    await render(
      <Scene registry={registry} runtime={runtime}>
        <Probe id={id} />
      </Scene>,
    );
    await expect.poll(() => renders).toBe(1);
    const running = runtime.propose("look", { viewer: "ada" });
    expect(running.id).toBe(id);
    expect(reference?.current).toBe(running);
    registry.tick(0);
    expect(reference?.current).toBe(running);
    expect(renders).toBe(1);
    running.cancel();
    expect(reference?.current).toBeUndefined();
    expect(renders).toBe(1);
  });
});
