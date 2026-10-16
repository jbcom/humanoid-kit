/** Private discrete contact chronology; this is not continuous threshold detection. */
import { type AnimationClip, clipTime } from "./clip.ts";

export interface AnimationTrack {
  clip: AnimationClip;
  /** Unwrapped for a loop; a nonloop holds at either endpoint. */
  time: number;
  speed: number;
}

interface Boundary {
  wall: number;
  time: number;
  /** Original authored key, including an authored duration key at a loop seam. */
  support: number | null;
}

export interface TimelineStep {
  wall: number;
  currentStart: number;
  currentEnd: number;
  previousStart: number | null;
  previousEnd: number | null;
  currentWeight: number;
  previousWeight: number;
  fadeElapsed: number;
  fadeComplete: boolean;
  supportKey: number | null;
  write: boolean;
}

const progressError = () =>
  new RangeError("animation: elapsed interval cannot make finite representable progress");

const supportOrderError = () =>
  new RangeError("animation: distinct authored support events have no representable wall order");

const velocity = (track: AnimationTrack): number => {
  if (
    !track.clip.loop &&
    ((track.time === 0 && track.speed < 0) ||
      (track.time === track.clip.duration && track.speed > 0))
  )
    return 0;
  return track.speed;
};

/** Exact mean smoothstep weight on a fade subinterval; stable even for a short interval late in a fade. */
function fadeMean(elapsed: number, wall: number, duration: number): number {
  const u = elapsed / duration;
  const d = wall / duration;
  return u * u * (3 - 2 * u) + d * (3 * u - 3 * u * u) + d * d * (1 - 2 * u) - 0.5 * d * d * d;
}

/** Canonical clock from a normalized origin; stop before multiplying an overflowing nonloop span. */
function canonical(track: AnimationTrack, origin: number, wall: number): number {
  if (track.speed === 0) return origin;
  if (!track.clip.loop) {
    const stop = track.speed > 0 ? track.clip.duration : 0;
    if (wall >= (stop - origin) / track.speed) return stop;
  }
  const next = origin + wall * track.speed;
  if (!Number.isFinite(next)) throw progressError();
  return track.clip.loop ? next : clipTime(track.clip, next);
}

/** Lift one wrapped source identity without changing it to a nearby frame. */
function liftSupport(clip: AnimationClip, cycle: number, wrapped: number): number {
  const frame = Math.round(wrapped * clip.fps);
  return clip.duration === clip.frames / clip.fps && wrapped === frame / clip.fps
    ? (cycle * clip.frames + frame) / clip.fps
    : cycle * clip.duration + wrapped;
}

/** Distinct source events must survive both clip and inverse-wall representation. */
function validateSupportLifts(
  clip: AnimationClip,
  cycle: number,
  origin: number,
  speed: number,
  time: number,
  final: number,
): void {
  const coordinates = new Map<number, number>();
  const walls = new Map<number, number>();
  const direction = Math.sign(speed);
  for (const track of clip.supportTracks ?? [])
    for (const raw of track.times) {
      if (!clip.loop && (raw < 0 || raw > clip.duration)) continue;
      const key = clip.loop ? clipTime(clip, raw) : raw;
      const target = clip.loop ? liftSupport(clip, cycle, key) : key;
      // An unrelated collision outside this requested represented span cannot
      // invalidate it. Include CURRENT so rounded-away upcoming keys are caught.
      if (direction * (target - time) < 0 || direction * (target - final) > 0) continue;
      const wall = (target - origin) / speed;
      const frame = Math.round(key * clip.fps);
      if (key !== frame / clip.fps) {
        const lastFrame = clip.loop ? clip.frames : clip.frames - 1;
        const boundaries = [
          { phase: 0, time: clip.loop ? liftSupport(clip, cycle, 0) : 0 },
          {
            phase: clip.duration,
            time: clip.loop ? liftSupport(clip, cycle + 1, 0) : clip.duration,
          },
        ];
        for (const index of [frame - 1, frame, frame + 1]) {
          if (index < 0 || index > lastFrame) continue;
          const phase = index / clip.fps;
          if (phase > clip.duration) continue;
          boundaries.push({
            phase,
            time: !clip.loop
              ? phase
              : clip.duration === clip.frames / clip.fps
                ? (cycle * clip.frames + index) / clip.fps
                : cycle * clip.duration + phase,
          });
        }
        for (const { phase, time: boundary } of boundaries) {
          // Source frames and seams are identities, not support declarations. A
          // distinct tiny event cannot round onto one and be treated as visited.
          const boundaryInRange =
            direction * (boundary - time) >= 0 && direction * (boundary - final) <= 0;
          if (
            key !== phase &&
            (target === boundary || (boundaryInRange && wall === (boundary - origin) / speed))
          )
            throw supportOrderError();
        }
      }
      const coordinateKey = coordinates.get(target);
      const wallKey = walls.get(wall);
      if (
        (coordinateKey !== undefined && coordinateKey !== key) ||
        (wallKey !== undefined && wallKey !== key)
      )
        throw supportOrderError();
      coordinates.set(target, key);
      walls.set(wall, key);
    }
}

function nextBoundary(
  track: AnimationTrack,
  origin: number,
  horizon: number,
  frames: boolean,
): Boundary | null {
  const speed = velocity(track);
  if (speed === 0) return null;
  const direction = Math.sign(speed);
  const { clip, time } = track;
  const final = canonical(track, origin, horizon);
  if (direction * (final - time) <= 0) return null;
  let found: Boundary | null = null;
  const consider = (target: number, support: number | null) => {
    // Compare represented clip targets BEFORE inverse wall arithmetic: a future
    // key can inverse-round to the horizon without actually belonging to it.
    if (direction * (target - time) <= 0 || direction * (target - final) > 0) return;
    const inverse = (target - origin) / track.speed;
    const wall = target === final || inverse > horizon ? horizon : inverse;
    if (!(wall > 0) || !Number.isFinite(wall)) throw progressError();
    if (
      found &&
      wall === found.wall &&
      support !== null &&
      found.support !== null &&
      clipTime(clip, support) !== clipTime(clip, found.support)
    )
      throw supportOrderError();
    if (!found || wall < found.wall || (wall === found.wall && support !== null))
      found = { wall, time: target, support };
  };
  if (frames) {
    const scaled = time * clip.fps;
    let index = direction > 0 ? Math.floor(scaled) + 1 : Math.ceil(scaled) - 1;
    let target = index / clip.fps;
    // A represented frame time can multiply back just below its integer index.
    // Skip that SAME represented time, never add a time epsilon or drop a real interval.
    if (direction * (target - time) <= 0) {
      const next = index + direction;
      if (next === index) throw progressError();
      index = next;
      target = index / clip.fps;
    }
    if (!clip.loop) target = Math.min(clip.duration, Math.max(0, target));
    consider(target, null);
  }
  if (clip.loop && clip.supportTracks?.length) {
    const cycle = Math.floor(time / clip.duration);
    // Check before directional filtering: a rounded-away upcoming key otherwise
    // looks already visited and would silently move into the following cycle.
    validateSupportLifts(clip, cycle, origin, speed, time, final);
    validateSupportLifts(clip, cycle + direction, origin, speed, time, final);
  } else if (!clip.loop && clip.supportTracks?.length) {
    validateSupportLifts(clip, 0, origin, speed, time, final);
  }
  for (const support of clip.supportTracks ?? [])
    for (const key of support.times) {
      let target = key;
      if (clip.loop) {
        const wrapped = clipTime(clip, key);
        let cycle = Math.floor(time / clip.duration);
        target = liftSupport(clip, cycle, wrapped);
        if (direction * (target - time) <= 0) {
          const next = cycle + direction;
          if (next === cycle) throw progressError();
          cycle = next;
          target = liftSupport(clip, cycle, wrapped);
        }
      } else if (key < 0 || key > clip.duration || direction * (target - time) <= 0) continue;
      consider(target, key);
    }
  return found;
}

function endpoint(
  track: AnimationTrack,
  origin: number,
  wallEnd: number,
  boundary: Boundary | null,
  horizon: number,
): number {
  const speed = velocity(track);
  if (speed === 0) return track.time;
  const next =
    wallEnd === horizon
      ? canonical(track, origin, horizon)
      : boundary?.wall === wallEnd
        ? boundary.time
        : canonical(track, origin, wallEnd);
  if (!Number.isFinite(next)) throw progressError();
  return track.clip.loop ? next : clipTime(track.clip, next);
}

/**
 * Pure metadata traversal, run once as preflight before Animator mutates anything,
 * then again to execute it. Work is linear in the traversed checkpoints, without
 * retaining a pose cache or a potentially unbounded array of intervals.
 */
export function* animationTimeline(
  current: AnimationTrack,
  previous: AnimationTrack | null,
  fade: { elapsed: number; duration: number },
  dt: number,
  skeleton: boolean,
): Generator<TimelineStep> {
  const cur = {
    ...current,
    time: current.clip.loop ? current.time : clipTime(current.clip, current.time),
  };
  let prev = previous && {
    ...previous,
    time: previous.clip.loop ? previous.time : clipTime(previous.clip, previous.time),
  };
  const curOrigin = cur.time;
  const prevOrigin = prev?.time ?? 0;
  const fadeOrigin = fade.elapsed;
  const fadeEnd = previous ? fade.duration - fadeOrigin : 0;
  // Whole-call representability is atomic. A generated cadence slice may
  // legitimately leave one clock unchanged while another track/wall advances.
  for (const track of [cur, prev])
    if (track) {
      const activeWall = track === prev ? Math.min(dt, fadeEnd) : dt;
      const final = canonical(track, track.time, activeWall);
      if (velocity(track) !== 0 && activeWall > 0 && final === track.time) throw progressError();
    }
  const fadeTerminalWall = Math.min(dt, fadeEnd);
  if (
    prev &&
    fadeTerminalWall > 0 &&
    (dt >= fadeEnd ? fade.duration : fadeOrigin + dt) === fadeOrigin
  )
    throw progressError();
  let elapsed = fade.elapsed;
  let wallTime = 0;
  while (wallTime < dt) {
    const moving = velocity(cur) !== 0 || (prev !== null && velocity(prev) !== 0);
    const contacts =
      skeleton && (cur.clip.grounded || Boolean(prev?.clip.grounded)) && (moving || prev !== null);
    const rootFade = skeleton && prev !== null && (cur.clip.rootMotion || prev.clip.rootMotion);
    const curBoundary = nextBoundary(cur, curOrigin, dt, contacts || rootFade);
    const prevBoundary =
      prev && nextBoundary(prev, prevOrigin, Math.min(dt, fadeEnd), contacts || rootFade);
    let wallEnd = dt;
    if (contacts) {
      let limit = 1 / 60;
      for (const track of [cur, prev])
        if (track && velocity(track) !== 0)
          limit = Math.min(limit, 0.5 / track.clip.fps / Math.abs(velocity(track)));
      wallEnd = Math.min(wallEnd, wallTime + limit);
    }
    if (curBoundary) wallEnd = Math.min(wallEnd, curBoundary.wall);
    if (prevBoundary) wallEnd = Math.min(wallEnd, prevBoundary.wall);
    if (prev) wallEnd = Math.min(wallEnd, fadeEnd);
    let curEnd = endpoint(cur, curOrigin, wallEnd, curBoundary, dt);
    let prevEnd = prev
      ? endpoint(prev, prevOrigin, wallEnd, prevBoundary, Math.min(dt, fadeEnd))
      : null;
    const terminalWall = prev ? Math.min(dt, fadeEnd) : dt;
    const terminalCurrent = canonical(cur, curOrigin, terminalWall);
    const terminalPrevious = prev ? canonical(prev, prevOrigin, terminalWall) : null;
    const terminalFade = prev
      ? terminalWall === fadeEnd
        ? fade.duration
        : fadeOrigin + terminalWall
      : elapsed;
    const proposedFade = prev
      ? wallEnd === fadeEnd
        ? fade.duration
        : fadeOrigin + wallEnd
      : elapsed;
    // Coalesce only equivalent terminal STATES, never a time epsilon. There
    // must be no further eligible key for either participating track before it.
    if (
      wallEnd < terminalWall &&
      curEnd === terminalCurrent &&
      prevEnd === terminalPrevious &&
      proposedFade === terminalFade &&
      nextBoundary({ ...cur, time: curEnd }, curOrigin, terminalWall, contacts || rootFade) ===
        null &&
      (!prev ||
        nextBoundary(
          { ...prev, time: prevEnd as number },
          prevOrigin,
          terminalWall,
          contacts || rootFade,
        ) === null)
    ) {
      wallEnd = terminalWall;
      curEnd = terminalCurrent;
      prevEnd = terminalPrevious;
    }
    const wall = wallEnd - wallTime;
    if (!(wall > 0) || !(wallEnd > wallTime) || !Number.isFinite(wallEnd)) throw progressError();
    const fadeComplete = prev !== null && wallEnd === fadeEnd;
    const nextElapsed = prev ? (fadeComplete ? fade.duration : fadeOrigin + wallEnd) : elapsed;
    const weight = prev ? fadeMean(elapsed, wall, fade.duration) : 1;
    // Clock rounding may reach a key before its inverse wall coordinate.
    // Judge the represented clip crossing, not inverse-wall equality alone.
    const candidateSupport = nextBoundary(cur, curOrigin, dt, false);
    const direction = Math.sign(velocity(cur));
    let supportKey: number | null = null;
    if (
      candidateSupport &&
      direction * (candidateSupport.time - cur.time) > 0 &&
      direction * (candidateSupport.time - curEnd) <= 0
    ) {
      const following = nextBoundary({ ...cur, time: candidateSupport.time }, curOrigin, dt, false);
      if (following && direction * (following.time - curEnd) <= 0) throw supportOrderError();
      supportKey = candidateSupport.support;
    }
    yield {
      wall,
      currentStart: cur.time,
      currentEnd: curEnd,
      previousStart: prev?.time ?? null,
      previousEnd: prevEnd,
      currentWeight: weight,
      previousWeight: prev ? 1 - weight : 0,
      fadeElapsed: nextElapsed,
      fadeComplete,
      supportKey,
      write: contacts || supportKey !== null || wallEnd === dt || fadeComplete,
    };
    cur.time = curEnd;
    if (prev && prevEnd !== null) prev.time = prevEnd;
    elapsed = nextElapsed;
    if (fadeComplete) prev = null;
    wallTime = wallEnd;
  }
}
