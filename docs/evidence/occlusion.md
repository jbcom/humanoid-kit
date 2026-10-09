# Attachment occlusion that follows the pose

![Open jaw: the pack's own set, then a custom set at load and after its corner bake](./occlusion.webp)

`JawDrop` at 1, close on the mouth, 2026-10-09.

1. The body pack's own attachments (eyes, teeth, tongue), with the pack's
   baked corners: the tongue and lower teeth uncovered by the open jaw are lit.
2. A custom set (`?wear=teeth/base,eyes/high-poly`) just after `ready`. It is
   baked at rest only, so the uncovered teeth still carry their enclosed,
   closed-mouth occlusion and render dark.
3. The same set once `client.posedOcclusion()` has baked its corners in the
   background: the uncovered teeth are lit as in 1.

**Open finding.** Without a tongue (2 and 3), the inside of the mouth renders
as a flat, fully lit, skin-coloured wall. Occlusion is baked for attachments
only, never for the body's own surface, so the oral cavity is never darkened.
The pack's tongue hides it in 1, but any set without a tongue, and the cavity
behind and above the tongue at wider openings, shows it. It needs the body's
mouth interior darkened by pose, either as a keyed occlusion on the body's
cavity region or as a skin layer over it. It is queued with the face work.
