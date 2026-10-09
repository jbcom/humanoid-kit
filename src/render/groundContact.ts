/**
 * One ground shader for every figure's contact shadow.
 *
 * Each figure draws its own contact shadow as a separate soft disc, blended
 * over the ground: where two overlap, the ground is darkened twice. Presence
 * (docs/PRESENCE.md) instead pools every figure's footprint into one field and
 * takes the strongest contact at each point (`sampleGroundOcclusion`), so
 * figures walking together share one shadow that separates as they part. This
 * material evaluates exactly that field in the fragment shader, in a single
 * pass over one quad, from a uniform array of contacts. The formula is the same
 * as `sampleGroundOcclusion`'s (a smoothstep falloff, combined with `max`), and
 * a browser test renders it and compares the pixels with that function.
 */
import { ShaderMaterial, Vector4 } from "three";
import type { ContactPoint } from "../presence/presence.ts";

/**
 * Contacts the shader holds: two feet per figure, so 64 figures. A larger set
 * is cut to its first MAX_CONTACTS; `setContacts` returns how many it used.
 */
export const MAX_CONTACTS = 128;

const vertexShader = /* glsl */ `
varying vec2 vGround;
void main() {
	vGround = ( modelMatrix * vec4( position, 1.0 ) ).xz;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const fragmentShader = /* glsl */ `
#define MAX_CONTACTS ${MAX_CONTACTS}
uniform vec4 uContacts[ MAX_CONTACTS ]; // x, z, radius, strength
uniform int uCount;
varying vec2 vGround;
void main() {
	float shadow = 0.0;
	for ( int i = 0; i < MAX_CONTACTS; i ++ ) {
		if ( i >= uCount ) break;
		vec4 c = uContacts[ i ];
		float d = distance( vGround, c.xy );
		// The strongest contact wins; contacts never add.
		if ( d < c.z ) shadow = max( shadow, c.w * ( 1.0 - smoothstep( 0.0, c.z, d ) ) );
	}
	gl_FragColor = vec4( 0.0, 0.0, 0.0, shadow );
}`;

/** A black, alpha-blended shadow for a horizontal quad in world space. */
export class GroundContactMaterial extends ShaderMaterial {
  constructor() {
    super({
      vertexShader,
      fragmentShader,
      uniforms: {
        uContacts: { value: Array.from({ length: MAX_CONTACTS }, () => new Vector4()) },
        uCount: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
  }

  /** Replaces the contacts; returns how many fit (at most `MAX_CONTACTS`). */
  setContacts(points: readonly ContactPoint[]): number {
    const used = Math.min(points.length, MAX_CONTACTS);
    const slots = this.uniforms.uContacts?.value as Vector4[];
    for (let i = 0; i < used; i++) {
      const p = points[i] as ContactPoint;
      (slots[i] as Vector4).set(p.x, p.z, p.radius, p.strength);
    }
    (this.uniforms.uCount as { value: number }).value = used;
    return used;
  }
}
