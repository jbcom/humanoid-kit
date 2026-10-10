/**
 * The strand footprint (docs/ARCHITECTURE.md, "Body hair"): how much of a pixel
 * a strand of hair covers, the one function the skin's strand layers
 * (`skinMaterial.ts`) and the coat's shells (`coat.ts`) both draw strands with.
 *
 * A strand `w` wide at `d` from the pixel's centre, measured across it, is
 * filtered by a tent `STRAND_FILTER` pixels either side (`px`, the pixel's
 * width in the strand's own units): the integral of the strand's width under
 * the tent. A box filter a pixel wide, as both used before, turns a strand
 * about a pixel wide from skin to hair within one pixel, a hard dash; under
 * the tent its edges ease over two and a half pixels, so a resolvable strand
 * is a thin soft-edged hair and one finer than a pixel a faint line, never a
 * dot.
 */

/**
 * The tent's half-width, pixels: 1.25, whose deviation (r / √6) is half a
 * pixel's, the Gaussian an antialiasing filter is usually taken as.
 */
export const STRAND_FILTER = 1.25;

export const STRAND_FOOTPRINT = /* glsl */ `
// The tent's weight up to x, for a tent of half-width r centred on 0.
float hkTentCdf( float x, float r ) {
	float t = clamp( x / r, -1.0, 1.0 );
	return t < 0.0 ? 0.5 * ( 1.0 + t ) * ( 1.0 + t ) : 1.0 - 0.5 * ( 1.0 - t ) * ( 1.0 - t );
}
// The share of a pixel px across that a strand w wide covers at d from its axis.
float hkStrandFootprint( float d, float w, float px ) {
	float r = ${STRAND_FILTER.toFixed(2)} * px;
	return hkTentCdf( 0.5 * w - d, r ) - hkTentCdf( - 0.5 * w - d, r );
}
// The same for a strand seen end on, a disc of radius r, at d from its centre:
// its edge under the tent. An edge filtered along the radius alone adds the
// tent's variance to the disc's area (π σ²), so the radius is drawn in to keep
// it, and a disc finer than the tent is dimmed to its area.
float hkDiscFootprint( float d, float r, float px ) {
	float s2 = ${(STRAND_FILTER ** 2 / 6).toFixed(5)} * px * px;
	float inner = sqrt( max( r * r - s2, 0.0 ) );
	return hkTentCdf( inner - d, ${STRAND_FILTER.toFixed(2)} * px ) * min( 1.0, r * r / s2 );
}
`;
