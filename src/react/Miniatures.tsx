/**
 * Miniatures in React Three Fiber (docs/MINIATURES.md): a `MiniatureCrowd`
 * over baked archetypes, updated every frame against the scene's camera, so a
 * table of hundreds of figures is a handful of instanced draws.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import type { MiniatureBake } from "../bake/miniature.ts";
import {
  MiniatureCrowd,
  type MiniatureCrowdOptions,
  type MiniatureFigure,
  type MiniatureFrameStats,
} from "../render/miniature.ts";

export interface MiniaturesProps extends MiniatureCrowdOptions {
  /** The baked archetypes (`bakeMiniature` or `decodeMiniature`); a new array builds a new crowd. */
  archetypes: readonly MiniatureBake[];
  /** The figures to draw; `MiniatureFigure.archetype` indexes `archetypes`. */
  figures: readonly MiniatureFigure[];
  /** Called after each frame's update with what was drawn. */
  onFrame?: (stats: MiniatureFrameStats) => void;
}

/** Draws `figures` of the baked `archetypes`; see `MiniatureCrowd`. */
export function Miniatures({ archetypes, figures, onFrame, ...options }: MiniaturesProps) {
  const { maxFigures, triangleBudget, levelPixels, material } = options;
  const crowd = useMemo(
    () => new MiniatureCrowd(archetypes, { maxFigures, triangleBudget, levelPixels, material }),
    [archetypes, maxFigures, triangleBudget, levelPixels, material],
  );
  useEffect(() => () => crowd.dispose(), [crowd]);
  useEffect(() => crowd.setFigures(figures), [crowd, figures]);
  const size = useThree((s) => s.size);
  useFrame(({ camera, clock }) => {
    const stats = crowd.update(camera, clock.elapsedTime, size.height);
    onFrame?.(stats);
  });
  return <primitive object={crowd.object} />;
}
