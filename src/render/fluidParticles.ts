/** Three-only instanced drawing for detached-fluid particle frames. */
import { type BufferGeometry, InstancedMesh, type Material, Matrix4 } from "three";
import type { DetachedFluidParticle } from "../fluid/detachedParticles.ts";

export interface FluidParticleRendererOptions {
  capacity: number;
  /** Caller-owned geometry; its scale is the caller's visual radius choice. */
  geometry: BufferGeometry;
  /** Caller-owned material; this adapter adds no SkinMaterial sampler or uniform. */
  material: Material;
}

/**
 * A narrow renderer adapter for detached particles. It owns only its instance
 * mesh; callers continue to own and dispose the supplied geometry and material.
 */
export class FluidParticleRenderer {
  readonly mesh: InstancedMesh;
  private readonly capacity: number;
  private readonly matrix = new Matrix4();

  constructor(options: FluidParticleRendererOptions) {
    if (!Number.isSafeInteger(options.capacity) || options.capacity < 1)
      throw new RangeError("fluid particle renderer capacity must be a positive safe integer");
    this.capacity = options.capacity;
    this.mesh = new InstancedMesh(options.geometry, options.material, options.capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  /** Writes current particle positions in metres; geometry/material choices remain external. */
  update(particles: readonly DetachedFluidParticle[]): void {
    if (particles.length > this.capacity)
      throw new RangeError("fluid particle renderer capacity cannot draw every particle");
    for (const [index, particle] of particles.entries()) {
      this.matrix.makeTranslation(...particle.positionM);
      this.mesh.setMatrixAt(index, this.matrix);
    }
    this.mesh.count = particles.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Releases only the instanced mesh; callers retain their geometry and material. */
  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
  }
}
