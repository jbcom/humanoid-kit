import { Canvas, useFrame } from "@react-three/fiber";
import { Component, type ReactNode, useRef } from "react";
import type { Group } from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import {
  createPresenceRegistry,
  type FigurePresence,
  type PresenceRegistry,
  type ProximityEvent,
  type PublishedPresence,
} from "../../src/presence/presence.ts";
import {
  Humanoid,
  HumanoidProvider,
  PresenceProvider,
  type PresenceRef,
  usePresence,
  usePresenceRegistry,
  useProximity,
} from "../../src/react/index.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";
import { inlineWorkerClient } from "./inlineClient.ts";

// Loading the body pack and evaluating a figure in a real browser takes a while.
const LOAD = { timeout: 120_000 };

const client = inlineWorkerClient();
beforeAll(async () => {
  await client.ready;
});
afterAll(() => client.dispose());

const average = createRecipe();
const tall = createRecipe({ macros: { height: 1 } });

function Scene({ registry, children }: { registry: PresenceRegistry; children: ReactNode }) {
  return (
    <HumanoidProvider client={client}>
      <div style={{ width: 320, height: 240 }}>
        <Canvas>
          <PresenceProvider registry={registry}>{children}</PresenceProvider>
        </Canvas>
      </div>
    </HumanoidProvider>
  );
}

const published = (registry: PresenceRegistry, id: string) => () =>
  registry.get(id) as FigurePresence | undefined;

describe("<Humanoid presence>", () => {
  it(
    "publishes each figure at its declared ground position, facing and size",
    async () => {
      const registry = createPresenceRegistry();
      await render(
        <Scene registry={registry}>
          <Humanoid
            recipe={average}
            presence={{ id: "a", position: [1, 0, 2], facing: [1, 0, 0] }}
          />
          <Humanoid
            recipe={tall}
            presence={{ id: "b", position: [-2, 0.5, 0], facing: [0, 0, 1] }}
          />
        </Scene>,
      );
      await expect.poll(() => registry.all().length, LOAD).toBe(2);
      const a = registry.get("a") as FigurePresence;
      const b = registry.get("b") as FigurePresence;
      expect(a.position[0]).toBeCloseTo(1, 4);
      expect(a.position[2]).toBeCloseTo(2, 4);
      expect(a.facing[0]).toBeCloseTo(1, 6);
      expect(a.facing[2]).toBeCloseTo(0, 6);
      // The declared position is where the soles meet the floor, whatever the figure's height.
      expect(a.bounds.min[1]).toBeCloseTo(0, 2);
      expect(b.bounds.min[1]).toBeCloseTo(0.5, 2);
      expect(b.anchors.head[1] - 0.5).toBeGreaterThan(a.anchors.head[1]);
      // Turned to +x, the face leads the head along +x.
      expect(a.anchors.face[0]).toBeGreaterThan(a.anchors.head[0]);
      expect(a.adult).toBe(true);
    },
    LOAD.timeout,
  );

  it(
    "follows a figure moved in the scene graph and measures its velocity",
    async () => {
      const registry = createPresenceRegistry();
      function Walker() {
        const ref = useRef<Group>(null);
        useFrame((s) => {
          if (ref.current) ref.current.position.x = s.clock.elapsedTime;
        });
        return (
          <group ref={ref}>
            <Humanoid recipe={average} presence={{ id: "walker" }} />
          </group>
        );
      }
      await render(
        <Scene registry={registry}>
          <Walker />
        </Scene>,
      );
      await expect.poll(published(registry, "walker"), LOAD).toBeDefined();
      const first = (registry.get("walker") as FigurePresence).position[0];
      // One metre a second, on the same clock the registry measures with.
      await expect
        .poll(() => (registry.get("walker")?.position[0] ?? 0) - first, LOAD)
        .toBeGreaterThan(0.5);
      await expect.poll(() => registry.get("walker")?.velocity[0] ?? 0).toBeCloseTo(1, 0);
      // Moving did not lift the figure off the floor.
      expect(registry.get("walker")?.bounds.min[1]).toBeCloseTo(0, 2);
    },
    LOAD.timeout,
  );

  it(
    "removes a figure from the registry when it unmounts",
    async () => {
      const registry = createPresenceRegistry();
      const screen = await render(
        <Scene registry={registry}>
          <Humanoid recipe={average} presence={{ id: "gone", position: [0, 0, 0] }} />
        </Scene>,
      );
      await expect.poll(published(registry, "gone"), LOAD).toBeDefined();
      await screen.rerender(<Scene registry={registry}>{null}</Scene>);
      await expect.poll(() => registry.all().length).toBe(0);
    },
    LOAD.timeout,
  );

  it(
    "publishes only figures that ask for it",
    async () => {
      const registry = createPresenceRegistry();
      await render(
        <Scene registry={registry}>
          <Humanoid recipe={average} presence={{ id: "seen", position: [0, 0, 0] }} />
          <Humanoid recipe={average} position={[2, 0, 0]} />
        </Scene>,
      );
      await expect.poll(published(registry, "seen"), LOAD).toBeDefined();
      await new Promise((r) => setTimeout(r, 500));
      expect(registry.all().map((p) => p.id)).toEqual(["seen"]);
    },
    LOAD.timeout,
  );
});

describe("presence hooks", () => {
  it(
    "reports proximity enter and leave to useProximity, and reads figures live with usePresence",
    async () => {
      const registry = createPresenceRegistry();
      const events: ProximityEvent[] = [];
      const watched: { b?: PresenceRef<PublishedPresence | undefined> } = {};
      function Watcher() {
        useProximity(1.5, (e) => events.push(e));
        watched.b = usePresence("b");
        return null;
      }
      const at = (bx: number) => (
        <Scene registry={registry}>
          <Watcher />
          <Humanoid recipe={average} presence={{ id: "a", position: [0, 0, 0] }} />
          <Humanoid recipe={average} presence={{ id: "b", position: [bx, 0, 0] }} />
        </Scene>
      );
      const screen = await render(at(4));
      await expect.poll(() => registry.all().length, LOAD).toBe(2);
      expect(events).toEqual([]);
      expect(watched.b?.current?.position[0]).toBeCloseTo(4, 4);
      await screen.rerender(at(1));
      await expect.poll(() => events.map((e) => e.type)).toEqual(["enter"]);
      expect(events[0]?.ids).toEqual(["a", "b"]);
      expect(watched.b?.current?.position[0]).toBeCloseTo(1, 4);
      await screen.rerender(at(4));
      await expect.poll(() => events.map((e) => e.type)).toEqual(["enter", "leave"]);
    },
    LOAD.timeout,
  );

  it(
    "lists every figure when no id is given",
    async () => {
      const registry = createPresenceRegistry();
      const watched: { all?: PresenceRef<PublishedPresence[]> } = {};
      function Watcher() {
        watched.all = usePresence();
        return null;
      }
      await render(
        <Scene registry={registry}>
          <Watcher />
          <Humanoid recipe={average} presence={{ id: "a", position: [0, 0, 0] }} />
          <Humanoid recipe={average} presence={{ id: "b", position: [1, 0, 0] }} />
        </Scene>,
      );
      await expect.poll(() => watched.all?.current.length, LOAD).toBe(2);
    },
    LOAD.timeout,
  );

  it("explains a missing provider instead of failing later", async () => {
    // Hooks that need the registry say so; so does a figure asking to be published without one.
    class Boundary extends Component<{ children: ReactNode }, { message: string | null }> {
      override state = { message: null as string | null };
      static getDerivedStateFromError(e: Error) {
        return { message: e.message };
      }
      override render() {
        return this.state.message ?? this.props.children;
      }
    }
    function NeedsRegistry() {
      usePresenceRegistry();
      return null;
    }
    const hook = await render(
      <Boundary>
        <NeedsRegistry />
      </Boundary>,
    );
    await expect.element(hook.getByText(/inside <PresenceProvider>/)).toBeVisible();
    const figure = await render(
      <HumanoidProvider client={client}>
        <Boundary>
          <Humanoid recipe={average} presence={{ id: "orphan" }} />
        </Boundary>
      </HumanoidProvider>,
    );
    await expect.element(figure.getByText(/Humanoid presence> must be used inside/)).toBeVisible();
  });
});
