# Fluid posed adapter

The internal adapter uses `foundation/posed.ts`'s `posedSurface`: CPU
`skinPositions` and `skinNormals` with the same fold handling as the renderer.
Its coordinates are model-local and precede the React ground lift and all world
transforms. It rejects a model whose loaded body topology or hash differs from
the fluid state.
