/** Internal deterministic motion for mass already held in FluidState.detachedKg. */

import type { DetachedFluidRelease } from "./attachedField.ts";
import { FLUID_MASS_EPSILON_KG, type FluidState, FluidStateError } from "./state.ts";

export interface DetachedFluidParticleSpawn {
  release: DetachedFluidRelease;
  /** Caller-selected initial velocity in model-local metres per second. */
  velocityMps: readonly [number, number, number];
}

export interface DetachedFluidParticleOptions {
  maxParticles: number;
  /** Caller-selected acceleration in model-local metres per second squared. */
  gravityMps2: readonly [number, number, number];
}

/** Immutable renderer-neutral particle output. Its mass remains in the state detached ledger. */
export interface DetachedFluidParticle {
  readonly id: number;
  readonly materialId: string;
  /** Conserved mass represented by this particle, in kilograms. */
  readonly massKg: number;
  /** Current model-local position in metres. */
  readonly positionM: readonly [number, number, number];
  /** Current model-local velocity in metres per second. */
  readonly velocityMps: readonly [number, number, number];
}

type MutableParticle = {
  id: number;
  materialId: string;
  massKg: number;
  positionM: [number, number, number];
  velocityMps: [number, number, number];
};

function finiteVector(value: readonly number[], label: string): void {
  if (value.length !== 3 || value.some((component) => !Number.isFinite(component)))
    throw new FluidStateError(`${label} must have three finite components`);
}

function assertSpawn(spawn: DetachedFluidParticleSpawn): void {
  const { release } = spawn;
  if (typeof release.materialId !== "string" || release.materialId.length === 0)
    throw new FluidStateError("fluid particle release materialId must be non-empty");
  if (!Number.isFinite(release.massKg) || release.massKg <= 0)
    throw new FluidStateError("fluid particle release massKg must be finite and > 0");
  finiteVector(release.positionM, "fluid particle release positionM");
  finiteVector(spawn.velocityMps, "fluid particle velocityMps");
}

const freezeParticle = (particle: MutableParticle): DetachedFluidParticle =>
  Object.freeze({
    id: particle.id,
    materialId: particle.materialId,
    massKg: particle.massKg,
    positionM: Object.freeze([...particle.positionM]) as readonly [number, number, number],
    velocityMps: Object.freeze([...particle.velocityMps]) as readonly [number, number, number],
  });

/**
 * Bounded detached-particle motion. It cannot create or reclassify mass: its
 * particle total is checked against FluidState.detachedKg before every change.
 */
export class DetachedFluidParticles {
  private readonly state: FluidState;
  private readonly maxParticles: number;
  private readonly gravityMps2: readonly [number, number, number];
  private readonly particles: MutableParticle[] = [];
  private nextId = 0;

  constructor(state: FluidState, options: DetachedFluidParticleOptions) {
    if (!Number.isSafeInteger(options.maxParticles) || options.maxParticles < 1)
      throw new FluidStateError("fluid particle maxParticles must be a positive safe integer");
    finiteVector(options.gravityMps2, "fluid particle gravityMps2");
    this.state = state;
    this.maxParticles = options.maxParticles;
    this.gravityMps2 = [...options.gravityMps2] as [number, number, number];
  }

  /** Adds exact detach releases with explicit initial velocities; this never debits FluidState again. */
  spawn(spawns: readonly DetachedFluidParticleSpawn[]): readonly DetachedFluidParticle[] {
    this.assertLedger();
    if (this.particles.length + spawns.length > this.maxParticles)
      throw new FluidStateError("fluid particle capacity would discard a detached release");
    for (const spawn of spawns) assertSpawn(spawn);
    const massKg = spawns.reduce((total, spawn) => total + spawn.release.massKg, 0);
    if (!Number.isFinite(massKg)) throw new FluidStateError("fluid particle mass must be finite");
    if (this.massKg() + massKg > this.state.snapshot().ledger.detachedKg + FLUID_MASS_EPSILON_KG)
      throw new FluidStateError("fluid particle releases exceed the detached ledger");
    const created = spawns.map((spawn) => {
      const particle: MutableParticle = {
        id: this.nextId++,
        materialId: spawn.release.materialId,
        massKg: spawn.release.massKg,
        positionM: [...spawn.release.positionM] as [number, number, number],
        velocityMps: [...spawn.velocityMps] as [number, number, number],
      };
      this.particles.push(particle);
      return freezeParticle(particle);
    });
    return Object.freeze(created);
  }

  /** Advances an integer number of FluidState fixed steps with semi-implicit Euler integration. */
  stepFixed(steps: number): void {
    this.assertLedger();
    if (!Number.isSafeInteger(steps) || steps < 0)
      throw new FluidStateError("fluid particle steps must be a non-negative safe integer");
    const seconds = this.state.fixedStepSeconds;
    for (let step = 0; step < steps; step++)
      for (const particle of this.particles)
        for (let axis = 0; axis < 3; axis++) {
          const velocityMps =
            (particle.velocityMps[axis] as number) + (this.gravityMps2[axis] as number) * seconds;
          particle.velocityMps[axis] = velocityMps;
          particle.positionM[axis] = (particle.positionM[axis] as number) + velocityMps * seconds;
        }
    this.state.advanceFixedSteps(steps);
  }

  /** Immutable particles in deterministic creation order. */
  frame(): readonly DetachedFluidParticle[] {
    this.assertLedger();
    return Object.freeze(this.particles.map(freezeParticle));
  }

  /** Conserved particle total, in kilograms; it is bounded by the state detached ledger. */
  massKg(): number {
    return this.particles.reduce((total, particle) => total + particle.massKg, 0);
  }

  private assertLedger(): void {
    const massKg = this.massKg();
    if (massKg - this.state.snapshot().ledger.detachedKg > FLUID_MASS_EPSILON_KG)
      throw new FluidStateError("fluid particle mass exceeds the detached ledger");
  }
}
