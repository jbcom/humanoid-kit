import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Component, type ReactNode, useRef } from "react";
import type { Group, Scene as ThreeScene } from "three";
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
  StudioStage,
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

/** Shows a thrown error's message in place of its children. */
class Boundary extends Component<{ children: ReactNode }, { message: string | null }> {
  override state = { message: null as string | null };
  static getDerivedStateFromError(e: Error) {
    return { message: e.message };
  }
  override render() {
    return this.state.message ?? this.props.children;
  }
}

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
      await expect.poll(() => registry.get("walker")?.velocity[0] ?? 0).toBeCloseTo(1, 1);
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
    "derives a new presence when the recipe changes, without moving the figure",
    async () => {
      const registry = createPresenceRegistry();
      const at = (recipe: typeof average) => (
        <Scene registry={registry}>
          <Humanoid recipe={recipe} presence={{ id: "r", position: [1, 0, 1] }} />
        </Scene>
      );
      const screen = await render(at(average));
      await expect.poll(published(registry, "r"), LOAD).toBeDefined();
      const before = registry.get("r")?.anchors.head[1] as number;
      await screen.rerender(at(tall));
      await expect
        .poll(() => registry.get("r")?.anchors.head[1] ?? 0, LOAD)
        .toBeGreaterThan(before + 0.05);
      expect(registry.get("r")?.position[0]).toBeCloseTo(1, 4);
      expect(registry.get("r")?.bounds.min[1]).toBeCloseTo(0, 2);
    },
    LOAD.timeout,
  );

  it(
    "follows the pose: a kneeling figure's presence comes down and stays on the floor, then stands again",
    async () => {
      const registry = createPresenceRegistry();
      const at = (body?: string) => (
        <Scene registry={registry}>
          <Humanoid
            recipe={average}
            {...(body && { pose: { body } })}
            presence={{ id: "k", position: [1, 0, 1] }}
          />
        </Scene>
      );
      const head = () => registry.get("k")?.anchors.head[1] ?? 0;
      const screen = await render(at());
      await expect.poll(published(registry, "k"), LOAD).toBeDefined();
      const standing = head();
      expect(standing).toBeGreaterThan(1.4);
      // The pose changes with no new evaluation: the presence is derived again from it.
      await screen.rerender(at("benchmark"));
      await expect.poll(head, LOAD).toBeLessThan(standing - 0.25);
      expect(registry.get("k")?.bounds.min[1]).toBeCloseTo(0, 2);
      expect(registry.get("k")?.position[0]).toBeCloseTo(1, 4);
      const kneeling = head();
      await screen.rerender(at("tpose"));
      await expect
        .poll(() => registry.get("k")?.anchors.leftHand[1] ?? 0, LOAD)
        .toBeGreaterThan(1.2);
      expect(head()).toBeGreaterThan(kneeling + 0.25);
      // Back to rest: the standing presence, not the last pose's.
      await screen.rerender(at());
      await expect.poll(head, LOAD).toBeCloseTo(standing, 2);
    },
    LOAD.timeout,
  );

  it(
    "leaves the registry while hidden or tipped over, and rejoins when it is back",
    async () => {
      const registry = createPresenceRegistry();
      const at = (shown: boolean, tipped: boolean) => (
        <Scene registry={registry}>
          <group visible={shown} rotation-x={tipped ? Math.PI / 2 : 0}>
            <Humanoid recipe={average} presence={{ id: "p", position: [0, 0, 0] }} />
          </group>
        </Scene>
      );
      const screen = await render(at(true, false));
      await expect.poll(published(registry, "p"), LOAD).toBeDefined();
      // A hidden figure is not in the world.
      await screen.rerender(at(false, false));
      await expect.poll(published(registry, "p")).toBeUndefined();
      await screen.rerender(at(true, false));
      await expect.poll(published(registry, "p")).toBeDefined();
      // Tipped straight up it has no heading on the ground to publish: gone, not stale.
      await screen.rerender(at(true, true));
      await expect.poll(published(registry, "p")).toBeUndefined();
      await screen.rerender(at(true, false));
      await expect.poll(published(registry, "p")).toBeDefined();
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
      const watched: { all?: PresenceRef<readonly PublishedPresence[]> } = {};
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

  it(
    "explains a body pack that cannot publish presence, and still renders without asking for it",
    async () => {
      const noJoints = inlineWorkerClient({ subdivision: 0 }, { withoutPresenceJoints: true });
      try {
        await noJoints.ready;
        const registry = createPresenceRegistry();
        // Asking for presence is reported through onError (a throw would take the canvas
        // down), the figure still renders, and nothing is published.
        const errors: string[] = [];
        let drawn = false;
        await render(
          <HumanoidProvider client={noJoints}>
            <div style={{ width: 160, height: 120 }}>
              <Canvas>
                <PresenceProvider registry={registry}>
                  <Humanoid
                    recipe={average}
                    presence={{ id: "nope" }}
                    onError={(e) => errors.push(e.message)}
                    onEvaluated={() => (drawn = true)}
                  />
                </PresenceProvider>
              </Canvas>
            </div>
          </HumanoidProvider>,
        );
        await expect.poll(() => drawn, LOAD).toBe(true);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/this pack lacks one/);
        expect(registry.all()).toEqual([]);
        // Not asking for presence is not affected: the figure evaluates as ever.
        let evaluated = false;
        await render(
          <HumanoidProvider client={noJoints}>
            <div style={{ width: 160, height: 120 }}>
              <Canvas>
                <Humanoid recipe={average} onEvaluated={() => (evaluated = true)} />
              </Canvas>
            </div>
          </HumanoidProvider>,
        );
        await expect.poll(() => evaluated, LOAD).toBe(true);
      } finally {
        noJoints.dispose();
      }
    },
    LOAD.timeout,
  );
});

describe("the stage's pooled contact shadow", () => {
  const out: { scene?: ThreeScene } = {};
  function Probe() {
    out.scene = useThree((s) => s.scene);
    return null;
  }
  const quad = () => out.scene?.getObjectByName("hk-ground-contact");

  it(
    "follows the figures wherever they are, and leaves the floor below a raised one alone",
    async () => {
      const registry = createPresenceRegistry();
      const at = (x: number, y: number) => (
        <Scene registry={registry}>
          <Probe />
          <StudioStage />
          <Humanoid recipe={average} presence={{ id: "s", position: [x, y, 0] }} />
        </Scene>
      );
      // Far beyond any fixed ground: the quad moves to the figure.
      const screen = await render(at(30, 0));
      await expect.poll(() => quad()?.visible, LOAD).toBe(true);
      await expect.poll(() => Math.abs((quad()?.position.x ?? 0) - 30)).toBeLessThan(0.4);
      // Standing half a metre up, it casts no shadow on this floor.
      await screen.rerender(at(30, 0.5));
      await expect.poll(() => quad()?.visible).toBe(false);
      // A little off the floor it still casts, more faintly.
      await screen.rerender(at(30, 0.1));
      await expect.poll(() => quad()?.visible).toBe(true);
      await screen.rerender(at(-12, 0));
      await expect.poll(() => Math.abs((quad()?.position.x ?? 0) + 12)).toBeLessThan(0.4);
    },
    LOAD.timeout,
  );

  it(
    "shadows only the figures that publish presence",
    async () => {
      const registry = createPresenceRegistry();
      await render(
        <Scene registry={registry}>
          <Probe />
          <StudioStage />
          <Humanoid recipe={average} position={[0, 0.82, 0]} />
        </Scene>,
      );
      await new Promise((r) => setTimeout(r, 1500));
      expect(quad()).toBeDefined();
      expect(quad()?.visible).toBe(false);
    },
    LOAD.timeout,
  );
});
