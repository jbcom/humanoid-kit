"""Cut the phallus and the scrotum out of a CC0 sculpted genital mesh.

Run headless (the adult lane runs it through `heavy`):

    Blender -b --factory-startup --python scripts/blender/cut_male.py -- <src.obj> <out-dir>

The source is a MakeHuman-format mesh in its own coordinates and units (y up,
the figure facing +z; decimetres for a clothes piece, metres for some whole-body
proxies), fitted to the hm08 base. Nothing is moved or scaled
here: a part leaves in the source's coordinates, and the packer binds it to our
base (docs/research/ADULT-SCULPT-PLAN.md, section 6d).

Each part is cut from the surface subdivided twice (Catmull-Clark, the limit
the sculpt was made to be seen at), by a set of half-spaces; what is kept is
the piece connected to a seed point inside the part. A part must come out a
topological disc: one boundary loop (the cut, where it will meet the
reservoir's loop), no non-manifold edge, Euler characteristic 1. The script
fails otherwise.

Writes, per part, `<out-dir>/<part>.obj` (positions and quads, no normals or
UVs) and `<out-dir>/cuts.json` (the source's sha256, the planes, and each
part's topology numbers). Workbench renders of each part, from the front, the
side, below and three-quarter, go to $HK_ADULT_RENDERS (default
~/.cache/hk-adult/cuts): adult images never go where the public site builds from.
"""

import hashlib
import json
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

# Half-spaces are (point, normal): a vertex is kept where (v - point) . normal >= 0.
# Coordinates are the source's (its own units, y up, +z forward).
CUTS = {
    "adult_male_genitalia_breast_fix.obj": {
        # The page: http://www.makehumancommunity.org/proxy/adult_male_genitalia_breast_fix.html
        # (ieroglif, CC0). A whole-body proxy in metres; the flaccid shaft hangs in front of
        # the sac, its back about 1.5 cm forward of the sac's front.
        "phallus": {
            # Across the shaft's own axis (down and a little forward from the root,
            # (0, -0.95, 0.3)) about a centimetre below the root, so the cut is one ring
            # round the free shaft and none of the skin round the root comes with it;
            # and forward of the gap between the shaft and the sac, whose top comes up
            # close behind it.
            "planes": [
                ((0.0, 0.80, 0.115), (0.0, -0.9535, 0.3011)),
                ((0.0, 0.0, 0.097), (0.0, 0.0, 1.0)),
            ],
            # The underside of the glans.
            "seed": (0.0, 0.737, 0.13),
        },
        "scrotum": {
            # The sac hangs free, closed behind as well as in front, from its neck at
            # y 0.785 to 0.80. One plane just below the neck makes the cut one ring round
            # it; the inner thighs' skin, which meets the sac only above the neck, is
            # then not connected to it and stays out. Behind the gap to the shaft too.
            "planes": [
                ((0.0, 0.0, 0.097), (0.0, 0.0, -1.0)),
                ((0.0, 0.783, 0.0), (0.0, -1.0, 0.0)),
            ],
            # The bottom of the sac on the midline.
            "seed": (0.0, 0.737, 0.08),
        },
    },
    "Male_Gen-Heal1.obj": {
        # The page: http://www.makehumancommunity.org/proxy/erect_penis_only_works_with_males.html
        # (Slayer227, CC0). A whole-body proxy in metres; the erect shaft runs forward
        # from z 0.13, above the sac, whose front is at z 0.12.
        "phallus": {
            # Forward of the root's junctions with the pubis and the sac, below the belly.
            "planes": [
                ((0.0, 0.0, 0.135), (0.0, 0.0, 1.0)),
                ((0.0, 0.905, 0.0), (0.0, -1.0, 0.0)),
            ],
            # The tip of the glans.
            "seed": (0.0, 0.855, 0.32),
        },
    },
}

SUBDIVISIONS = 2


def args():
    argv = sys.argv[sys.argv.index("--") + 1 :]
    if len(argv) != 2:
        raise SystemExit("usage: cut_male.py -- <src.obj> <out-dir>")
    return argv[0], argv[1]


def load(src):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # forward Y / up Z is the identity: the source's own coordinates, unconverted.
    bpy.ops.wm.obj_import(filepath=src, forward_axis="Y", up_axis="Z")
    ob = bpy.context.selected_objects[0]
    mod = ob.modifiers.new("subdivide", "SUBSURF")
    mod.levels = SUBDIVISIONS
    mod.render_levels = SUBDIVISIONS
    mod.boundary_smooth = "PRESERVE_CORNERS"
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return ob


def topology(bm):
    boundary = [e for e in bm.edges if e.is_boundary]
    seen = set()
    loops = []
    for e in boundary:
        if e in seen:
            continue
        # Walk one boundary loop.
        length = 0
        stack = [e]
        while stack:
            x = stack.pop()
            if x in seen:
                continue
            seen.add(x)
            length += 1
            for v in x.verts:
                stack.extend(y for y in v.link_edges if y.is_boundary and y not in seen)
        loops.append(length)
    return {
        "vertices": len(bm.verts),
        "faces": len(bm.faces),
        "edges": len(bm.edges),
        "boundaryLoops": len(loops),
        "boundaryLoopEdges": loops,
        "nonManifoldEdges": sum(1 for e in bm.edges if not e.is_manifold and not e.is_boundary),
        "euler": len(bm.verts) - len(bm.edges) + len(bm.faces),
    }


def cut(ob, spec):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for point, normal in spec["planes"]:
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(
            bm, geom=geom, dist=1e-6, plane_co=Vector(point), plane_no=Vector(normal), clear_outer=False, clear_inner=True
        )
    # Keep the piece connected to the seed.
    seed = min(bm.verts, key=lambda v: (v.co - Vector(spec["seed"])).length)
    keep = {seed}
    stack = [seed]
    while stack:
        v = stack.pop()
        for e in v.link_edges:
            w = e.other_vert(v)
            if w not in keep:
                keep.add(w)
                stack.append(w)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v not in keep], context="VERTS")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    return bm


def write_obj(bm, path, header):
    bm.verts.index_update()
    with open(path, "w") as f:
        f.write(header)
        for v in bm.verts:
            f.write("v %.6f %.6f %.6f\n" % tuple(v.co))
        for face in bm.faces:
            f.write("f " + " ".join(str(v.index + 1) for v in face.verts) + "\n")


def render(bm, stem):
    mesh = bpy.data.meshes.new(stem)
    bm.to_mesh(mesh)
    ob = bpy.data.objects.new(stem, mesh)
    scene = bpy.context.scene
    for o in list(scene.collection.objects):
        o.hide_render = True
    scene.collection.objects.link(ob)
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "SINGLE"
    scene.display.shading.show_backface_culling = False
    scene.render.resolution_x = 480
    scene.render.resolution_y = 480
    co = [v.co for v in mesh.vertices]
    lo = Vector([min(c[i] for c in co) for i in range(3)])
    hi = Vector([max(c[i] for c in co) for i in range(3)])
    centre = (lo + hi) / 2
    size = max(hi - lo)
    cam_data = bpy.data.cameras.new(stem + "-cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = size * 1.3
    cam = bpy.data.objects.new(stem + "-cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    # Source frame: y up, +z the figure's front, +x its left.
    views = {
        "front": (Vector((0, 0, 1)), Vector((0, 1, 0))),
        "side": (Vector((1, 0, 0)), Vector((0, 1, 0))),
        "below": (Vector((0, -1, 0)), Vector((0, 0, 1))),
        "threequarter": (Vector((0.6, 0.25, 0.75)), Vector((0, 1, 0))),
    }
    renders = os.environ.get("HK_ADULT_RENDERS", os.path.expanduser("~/.cache/hk-adult/cuts"))
    os.makedirs(renders, exist_ok=True)
    for name, (d, up) in views.items():
        d = d.normalized()
        cam.location = centre + d * size * 4
        # The camera looks down its -z with its +y up: build that basis from the view's own
        # up, since the source is y up and Blender's tracking assumes z up.
        y = (up - d * up.dot(d)).normalized()
        cam.rotation_euler = Matrix((y.cross(d), y, d)).transposed().to_euler()
        scene.render.filepath = os.path.join(renders, f"{stem}-{name}.png")
        bpy.ops.render.render(write_still=True)
    ob.hide_render = True


def main():
    src, out = args()
    name = os.path.basename(src)
    if name not in CUTS:
        raise SystemExit(f"cut_male.py: no cuts for {name}")
    with open(src, "rb") as f:
        sha = hashlib.sha256(f.read()).hexdigest()
    os.makedirs(out, exist_ok=True)
    ob = load(src)
    report = {"source": name, "sha256": sha, "subdivisions": SUBDIVISIONS, "parts": {}}
    failed = []
    for part, spec in CUTS[name].items():
        bm = cut(ob, spec)
        t = topology(bm)
        ok = t["boundaryLoops"] == 1 and t["nonManifoldEdges"] == 0 and t["euler"] == 1
        report["parts"][part] = {"planes": spec["planes"], "seed": spec["seed"], **t, "disc": ok}
        print(f"CUT {part}: {json.dumps(t)} disc={ok}")
        if not ok:
            failed.append(part)
        header = (
            f"# {part}, cut by scripts/blender/cut_male.py from {name} (sha256 {sha})\n"
            "# CC0: the source's page states CC0; see packs/adult-anatomy/source/PROVENANCE.md\n"
        )
        write_obj(bm, os.path.join(out, f"{part}.obj"), header)
        render(bm, f"{os.path.splitext(name)[0]}-{part}")
        bm.free()
    with open(os.path.join(out, "cuts.json"), "w") as f:
        json.dump(report, f, indent=2)
        f.write("\n")
    if failed:
        raise SystemExit(f"cut_male.py: not a disc: {', '.join(failed)}")


main()
