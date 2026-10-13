/**
 * The observer is deliberately driven through R3F's public manual clock. In
 * `frameloop="never"`, `advance` takes the clock's seconds, not DOM
 * `performance.now()` milliseconds. A plain frame/draw witness is kept beside
 * the animation witness so a stopped Canvas cannot look like a swallowed
 * consumer exception.
 */
import { Canvas, type RootState, useFrame, useThree } from "@react-three/fiber";
import { animationsPack } from "humanoid-kit-animations";
import { useEffect } from "react";
import { Vector3 } from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import {
  copyAnimationFrame,
  frameContactWorld,
  type HumanoidAnimationFrame,
} from "../../src/animation/frames.ts";
import { type AnimationLibrary, loadAnimationLibrary } from "../../src/animation/library.ts";
import { createPresenceRegistry } from "../../src/presence/presence.ts";
import { Humanoid, HumanoidProvider, PresenceProvider } from "../../src/react/index.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";
import { inlineWorkerClient } from "./inlineClient.ts";

const LOAD = { timeout: 120_000 };
const STEP = 1 / 60;
const client = inlineWorkerClient();
let library: AnimationLibrary;
beforeAll(async () => {
  await client.ready;
  library = await loadAnimationLibrary(animationsPack);
}, LOAD.timeout);
afterAll(() => client.dispose());

interface Harness {
  get: (() => RootState) | null;
  advance: RootState["advance"] | null;
  frames: number;
  draws: number;
  store: RootState | null;
  delta: number;
  subscribers: number;
  active: boolean;
  size: [number, number];
}

function Probe({ state }: { state: Harness }) {
  const get = useThree((root) => root.get);
  const advance = useThree((root) => root.advance);
  useEffect(() => {
    state.get = get;
    state.advance = advance;
  }, [advance, get, state]);
  useFrame((root, delta) => {
    state.frames++;
    state.store = root;
    state.delta = delta;
    state.subscribers = (root.internal as unknown as { subscribers: unknown[] }).subscribers.length;
    state.active = root.internal.active;
    state.size = [root.size.width, root.size.height];
  });
  return null;
}

function emptyHarness(): Harness {
  return {
    get: null,
    advance: null,
    frames: 0,
    draws: 0,
    store: null,
    delta: Number.NaN,
    subscribers: 0,
    active: false,
    size: [0, 0],
  };
}

/** A monotonic R3F-clock driver: `advance` timestamps are seconds. */
function clockDriver(state: Harness): () => void {
  if (!state.get || !state.advance) throw new Error("animation observer has no Canvas store");
  let time = state.get().clock.elapsedTime;
  return () => {
    time += STEP;
    state.advance?.(time);
  };
}

describe("<Humanoid animation onFrame>", () => {
  it(
    "uses the Canvas clock, draws and exposes a consumer throw after root carry",
    async () => {
      const presence = createPresenceRegistry();
      const canvas = emptyHarness();
      const ref = { current: null as import("three").Group | null };
      const observed: { frame: HumanoidAnimationFrame; at: [number, number] }[] = [];
      const sentinel = new Error("observer sentinel");
      let throwNext = false;
      let started = false;
      let settled = false;
      await render(
        <HumanoidProvider client={client}>
          <div style={{ width: 160, height: 160 }}>
            <Canvas frameloop="never">
              <Probe state={canvas} />
              <PresenceProvider registry={presence}>
                <Humanoid
                  ref={ref}
                  recipe={createRecipe()}
                  presence={{ id: "walker" }}
                  onSettled={() => {
                    settled = true;
                  }}
                  animation={{
                    library,
                    clip: "walk_normal",
                    onStart: () => {
                      started = true;
                    },
                    onFrame: (frame) => {
                      observed.push({
                        frame: copyAnimationFrame(frame),
                        at: [ref.current?.position.x ?? NaN, ref.current?.position.z ?? NaN],
                      });
                      if (throwNext) throw sentinel;
                    },
                  }}
                />
              </PresenceProvider>
              <mesh
                onAfterRender={() => {
                  canvas.draws++;
                }}
              >
                <boxGeometry />
                <meshBasicMaterial />
              </mesh>
            </Canvas>
          </div>
        </HumanoidProvider>,
      );
      await expect.poll(() => canvas.get && canvas.advance, LOAD).toBeTruthy();
      await expect.poll(() => ref.current, LOAD).not.toBeNull();
      await expect.poll(() => settled && started, LOAD).toBe(true);
      const drive = clockDriver(canvas);
      drive();
      expect(canvas.frames, "manual advance reaches a same-store useFrame subscriber").toBe(1);
      expect(canvas.draws, "manual advance draws the Canvas").toBeGreaterThan(0);
      expect(canvas.store, "useFrame receives the Canvas store captured by Probe").toBe(
        canvas.get?.(),
      );
      expect(canvas.delta, "manual clock delta is in seconds").toBeCloseTo(STEP, 8);
      expect(canvas.subscribers).toBeGreaterThan(1);
      expect(canvas.active).toBe(true);
      expect(canvas.size).toEqual([160, 160]);
      expect(observed).toHaveLength(1);
      expect(presence.get("walker")).toBeDefined();
      const first = observed[0] as (typeof observed)[number];
      expect(first.at[0]).toBeCloseTo(first.frame.root[0], 6);
      expect(first.at[1]).toBeCloseTo(first.frame.root[1], 6);

      throwNext = true;
      expect(drive, "an observer exception is synchronous to the manual frame").toThrow(sentinel);
      const thrown = observed[1] as (typeof observed)[number];
      expect(thrown.at[0]).toBeCloseTo(thrown.frame.root[0], 6);
      expect(thrown.at[1]).toBeCloseTo(thrown.frame.root[1], 6);
    },
    LOAD.timeout,
  );

  it(
    "keeps the outer observer frame coherent when it reenters the public manual clock",
    async () => {
      const presence = createPresenceRegistry();
      const canvas = emptyHarness();
      const ref = { current: null as import("three").Group | null };
      const observed: HumanoidAnimationFrame[] = [];
      let drive: (() => void) | null = null;
      let started = false;
      let settled = false;
      await render(
        <HumanoidProvider client={client}>
          <div style={{ width: 160, height: 160 }}>
            <Canvas frameloop="never">
              <Probe state={canvas} />
              <PresenceProvider registry={presence}>
                <Humanoid
                  ref={ref}
                  recipe={createRecipe()}
                  presence={{ id: "walker" }}
                  onSettled={() => {
                    settled = true;
                  }}
                  animation={{
                    library,
                    clip: "walk_normal",
                    onStart: () => {
                      started = true;
                    },
                    onFrame: (frame) => {
                      // The figure reuses its frame: the reentrant frame would overwrite a kept reference.
                      observed.push(copyAnimationFrame(frame));
                      if (observed.length === 2) drive?.();
                    },
                  }}
                />
              </PresenceProvider>
              <mesh onAfterRender={() => canvas.draws++}>
                <boxGeometry />
                <meshBasicMaterial />
              </mesh>
            </Canvas>
          </div>
        </HumanoidProvider>,
      );
      await expect.poll(() => canvas.get && canvas.advance, LOAD).toBeTruthy();
      await expect.poll(() => ref.current, LOAD).not.toBeNull();
      await expect.poll(() => settled && started, LOAD).toBe(true);
      drive = clockDriver(canvas);
      drive();
      drive();
      expect(canvas.frames, "the Canvas frame witness ran for outer and nested advances").toBe(3);
      expect(canvas.draws).toBeGreaterThanOrEqual(3);
      expect(observed).toHaveLength(3);
      expect((observed[1] as HumanoidAnimationFrame).time).toBeLessThan(
        (observed[2] as HumanoidAnimationFrame).time,
      );
      expect(ref.current?.position.x).toBeCloseTo(
        (observed[2] as HumanoidAnimationFrame).root[0],
        6,
      );
      expect(ref.current?.position.z).toBeCloseTo(
        (observed[2] as HumanoidAnimationFrame).root[1],
        6,
      );
      expect(presence.get("walker")?.position[2]).toBeCloseTo(ref.current?.position.z ?? NaN, 6);
    },
    LOAD.timeout,
  );
});

/** One recipe for every render, so a rerender is not a new evaluation. */
const RECIPE = createRecipe();

/** A walker under a turned, moved parent, in a registry, on the given client. */
function Walker({
  on,
  mounted,
  presence,
  canvas,
  figure,
  onFrame,
}: {
  on: ReturnType<typeof inlineWorkerClient>;
  mounted: boolean;
  presence: ReturnType<typeof createPresenceRegistry>;
  canvas: Harness;
  figure: { current: import("three").Group | null };
  onFrame: (frame: Readonly<HumanoidAnimationFrame>) => void;
}) {
  return (
    <HumanoidProvider client={on}>
      <div style={{ width: 160, height: 160 }}>
        <Canvas frameloop="never">
          <Probe state={canvas} />
          <PresenceProvider registry={presence}>
            <group position={[0.5, 0, -0.25]} rotation={[0, 0.6, 0]}>
              {mounted && (
                <Humanoid
                  ref={figure}
                  recipe={RECIPE}
                  presence={{ id: "walker" }}
                  animation={{ library, clip: "walk_normal", onFrame }}
                />
              )}
            </group>
          </PresenceProvider>
        </Canvas>
      </div>
    </HumanoidProvider>
  );
}

describe("a figure's frames in its presence registry", () => {
  it(
    "publishes the onFrame frame under the presence id, placed in the world through every parent, and releases it on unmount",
    async () => {
      const presence = createPresenceRegistry();
      const canvas = emptyHarness();
      const figure = { current: null as import("three").Group | null };
      const fromChannel: HumanoidAnimationFrame[] = [];
      const releases: string[] = [];
      /** Worst gap between the frame's world contacts and the group's own `localToWorld`, metres. */
      let worstPlacement = 0;
      /** The lowest world contact of each frame: a walking figure stands on the ground. */
      const lowest: number[] = [];
      let sameObject = true;
      let lastChannelFrame: Readonly<HumanoidAnimationFrame> | null = null;
      const stop = presence.frames.observe(
        "walker",
        (frame) => {
          lastChannelFrame = frame;
          fromChannel.push(copyAnimationFrame(frame));
          const g = figure.current;
          if (!g) return;
          g.updateWorldMatrix(true, false);
          let low = Number.POSITIVE_INFINITY;
          for (let k = 0; k < frame.contacts.length; k++) {
            const world = frameContactWorld(frame, k);
            const local = frame.contacts[k]?.position ?? [NaN, NaN, NaN];
            const expected = g.localToWorld(new Vector3(local[0], local[1], local[2]));
            worstPlacement = Math.max(
              worstPlacement,
              Math.hypot(world[0] - expected.x, world[1] - expected.y, world[2] - expected.z),
            );
            low = Math.min(low, world[1]);
          }
          lowest.push(low);
        },
        (reason) => releases.push(reason),
      );
      const onFrame = (frame: Readonly<HumanoidAnimationFrame>) => {
        if (frame !== lastChannelFrame) sameObject = false;
      };
      const screen = await render(
        <Walker
          on={client}
          mounted
          presence={presence}
          canvas={canvas}
          figure={figure}
          onFrame={onFrame}
        />,
      );
      await expect.poll(() => canvas.get && canvas.advance, LOAD).toBeTruthy();
      const drive = clockDriver(canvas);
      await expect
        .poll(() => {
          drive();
          return fromChannel.length;
        }, LOAD)
        .toBeGreaterThan(0);
      for (let k = 0; k < 30; k++) drive();
      expect(fromChannel.length).toBeGreaterThan(30);
      expect(sameObject, "onFrame receives the very frame the channel published").toBe(true);
      expect(new Set(fromChannel.map((f) => f.figure))).toEqual(new Set(["walker"]));
      expect(worstPlacement, "toWorld is the group's world matrix after the carry").toBeLessThan(
        1e-5,
      );
      expect(Math.max(...lowest.map(Math.abs)), "the lowest sole is on the ground").toBeLessThan(
        1e-4,
      );
      // The parent turned the figure: its world carry is along the parent's heading.
      const first = fromChannel[0] as HumanoidAnimationFrame;
      const last = fromChannel[fromChannel.length - 1] as HumanoidAnimationFrame;
      const dx = (last.toWorld[12] as number) - (first.toWorld[12] as number);
      const dz = (last.toWorld[14] as number) - (first.toWorld[14] as number);
      expect(Math.hypot(dx, dz)).toBeGreaterThan(0.2);
      expect(Math.atan2(dx, dz)).toBeCloseTo(0.6, 1);

      await screen.rerender(
        <Walker
          on={client}
          mounted={false}
          presence={presence}
          canvas={canvas}
          figure={figure}
          onFrame={onFrame}
        />,
      );
      expect(releases).toEqual(["released"]);
      const before = fromChannel.length;
      for (let k = 0; k < 10; k++) drive();
      expect(fromChannel.length, "no frame after unmount").toBe(before);
      stop();
    },
    LOAD.timeout,
  );

  it(
    "publishes no frame of the old client after the client is replaced, and a higher generation from the new one",
    async () => {
      const presence = createPresenceRegistry();
      const canvas = emptyHarness();
      const figure = { current: null as import("three").Group | null };
      const second = inlineWorkerClient();
      const frames: HumanoidAnimationFrame[] = [];
      const releases: string[] = [];
      presence.frames.observe(
        "walker",
        (frame) => frames.push(copyAnimationFrame(frame)),
        (reason) => releases.push(reason),
      );
      const screen = await render(
        <Walker
          on={client}
          mounted
          presence={presence}
          canvas={canvas}
          figure={figure}
          onFrame={() => {}}
        />,
      );
      await expect.poll(() => canvas.get && canvas.advance, LOAD).toBeTruthy();
      const drive = clockDriver(canvas);
      await expect
        .poll(() => {
          drive();
          return frames.length;
        }, LOAD)
        .toBeGreaterThan(2);
      const old = Math.max(...frames.map((f) => f.generation));
      const swappedAt = frames.length;
      await screen.rerender(
        <Walker
          on={second}
          mounted
          presence={presence}
          canvas={canvas}
          figure={figure}
          onFrame={() => {}}
        />,
      );
      expect(releases, "the old client's binding is released at the swap").toEqual(["released"]);
      await expect
        .poll(() => {
          drive();
          return frames.length - swappedAt;
        }, LOAD)
        .toBeGreaterThan(5);
      const after = frames.slice(swappedAt);
      expect(
        after.filter((f) => f.generation <= old),
        "a frame of the old client after the swap",
      ).toEqual([]);
      // The new client's figure walks from where it stands, on the ground.
      for (const f of after) {
        let low = Number.POSITIVE_INFINITY;
        for (let k = 0; k < f.contacts.length; k++) low = Math.min(low, frameContactWorld(f, k)[1]);
        expect(Math.abs(low)).toBeLessThan(1e-4);
      }
      await screen.unmount();
      second.dispose();
    },
    LOAD.timeout,
  );
});
