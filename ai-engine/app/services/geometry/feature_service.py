"""
FeatureService — Direct B-Rep parametric feature extraction for Manual CAD.

Detects high-level parametric engineering features (holes, bosses, pockets, slots, fillets, chamfers)
from active B-Rep geometry and maps them directly to viewport-selectable transient IDs and editable schemas.
"""
from __future__ import annotations

import hashlib
import math
from typing import Any, Dict, List, Optional, Tuple, Set

import build123d as bd
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.GeomAbs import GeomAbs_Plane, GeomAbs_Cylinder, GeomAbs_Cone, GeomAbs_Torus
from OCP.TopExp import TopExp
from OCP.TopAbs import TopAbs_FACE, TopAbs_EDGE

from app.models.cad_modification import DetectedFeature, FeatureParam
from app.services.geometry.topology_extractor import TopologyExtractor


def _stable_feat_id(kind: str, face_ids: List[str]) -> str:
    sorted_faces = ",".join(sorted(face_ids))
    h = hashlib.md5(f"{kind}_{sorted_faces}".encode()).hexdigest()[:8]
    return f"feat_{h}"


class FeatureService:
    """Extracts detected features with editable parameters from B-Rep geometry."""

    @classmethod
    def detect_features(cls, shape: bd.Shape) -> List[DetectedFeature]:
        extractor = TopologyExtractor(shape)
        extractor.extract_all()

        detected: List[DetectedFeature] = []
        claimed_faces: Set[str] = set()

        # 1. Detect Fillets & Chamfers first so blend faces aren't confused with main walls/cylinders
        fillets, chamfers = cls._detect_blends(shape, extractor)
        for f in fillets + chamfers:
            detected.append(f)
            claimed_faces.update(f.face_ids)

        # 2. Detect Holes (including compound counterbore, countersink, blind, through)
        holes = cls._detect_holes(shape, extractor, claimed_faces)
        for h in holes:
            detected.append(h)
            claimed_faces.update(h.face_ids)

        # 3. Detect Bosses (external cylinders with planar caps)
        bosses = cls._detect_bosses(shape, extractor, claimed_faces)
        for b in bosses:
            detected.append(b)
            claimed_faces.update(b.face_ids)

        # 4. Detect Pockets & Slots
        pockets, slots = cls._detect_pockets_and_slots(shape, extractor, claimed_faces)
        for p in pockets:
            detected.append(p)
            claimed_faces.update(p.face_ids)
        for s in slots:
            detected.append(s)
            claimed_faces.update(s.face_ids)

        return detected

    @classmethod
    def _detect_holes(
        cls, shape: bd.Shape, extractor: TopologyExtractor, claimed_faces: Set[str]
    ) -> List[DetectedFeature]:
        holes: List[DetectedFeature] = []

        # Find all internal cylinder faces
        internal_cyls: List[str] = []
        for fid, f_meta in extractor.faces.items():
            if fid in claimed_faces or f_meta.get("type") != "cylinder":
                continue

            f_obj = extractor.get_face_object(fid)
            if not f_obj:
                continue

            # Check if internal (cylinder normal points inward towards cylinder axis)
            cyl_loc = f_meta.get("location", (0, 0, 0))
            cyl_axis = f_meta.get("axis", (0, 0, 1))

            # Skip cylinders that are tangent to planar walls (slot / rounded pocket arc walls)
            adj = extractor.adjacency.get(fid, [])
            is_pocket_arc = any(
                a.get("transition") == "tangent" and extractor.faces.get(a["adjacent_face"], {}).get("type") == "plane"
                for a in adj
            )
            if is_pocket_arc:
                continue

            try:
                pt = f_obj.center()
                n = f_obj.normal_at(pt)
                v_axis_to_pt = [pt.X - cyl_loc[0], pt.Y - cyl_loc[1], pt.Z - cyl_loc[2]]
                dot_axis = sum(a * b for a, b in zip(v_axis_to_pt, cyl_axis))
                v_radial = [v_axis_to_pt[i] - dot_axis * cyl_axis[i] for i in range(3)]
                dot_n_r = n.X * v_radial[0] + n.Y * v_radial[1] + n.Z * v_radial[2]

                if dot_n_r < 1e-4:  # Normal points inward -> internal cavity
                    internal_cyls.append(fid)
            except Exception:
                continue

        # Group coaxial cylinders (e.g. counterbores, stepped holes)
        processed_cyls: Set[str] = set()

        for fid in internal_cyls:
            if fid in processed_cyls:
                continue

            f_meta = extractor.faces[fid]
            f_obj = extractor.get_face_object(fid)
            axis = list(f_meta.get("axis", (0, 0, 1)))
            loc = list(f_meta.get("location", (0, 0, 0)))
            radius = f_meta.get("radius", 0.0)

            # Project bounds along axis for true depth
            depth = cls._calc_projected_depth(f_obj, axis, f_meta.get("bbox", {}))

            coaxial_group = [fid]
            processed_cyls.add(fid)

            for other_fid in internal_cyls:
                if other_fid in processed_cyls:
                    continue
                o_meta = extractor.faces[other_fid]
                o_axis = list(o_meta.get("axis", (0, 0, 1)))
                o_loc = list(o_meta.get("location", (0, 0, 0)))

                # Check if parallel
                dot_ax = abs(sum(a * b for a, b in zip(axis, o_axis)))
                if dot_ax > 0.999:
                    # Check distance from o_loc to line (loc, axis)
                    v_diff = [o_loc[0] - loc[0], o_loc[1] - loc[1], o_loc[2] - loc[2]]
                    cross = [
                        v_diff[1] * axis[2] - v_diff[2] * axis[1],
                        v_diff[2] * axis[0] - v_diff[0] * axis[2],
                        v_diff[0] * axis[1] - v_diff[1] * axis[0],
                    ]
                    dist_to_axis = math.sqrt(sum(c * c for c in cross))
                    if dist_to_axis < 1e-2:
                        coaxial_group.append(other_fid)
                        processed_cyls.add(other_fid)

            # Check for adjacent coaxial conical faces (countersink)
            csink_cone_fid: Optional[str] = None
            adj = extractor.adjacency.get(fid, [])
            for a in adj:
                afid = a["adjacent_face"]
                ameta = extractor.faces.get(afid, {})
                if ameta.get("type") == "cone":
                    c_axis = list(ameta.get("axis", (0, 0, 1)))
                    if abs(sum(x * y for x, y in zip(axis, c_axis))) > 0.99:
                        csink_cone_fid = afid
                        break

            # Check if blind or through
            has_bottom = False
            for a in adj:
                afid = a["adjacent_face"]
                ameta = extractor.faces.get(afid, {})
                if ameta.get("type") == "plane" and a.get("transition") == "concave":
                    has_bottom = True
                    break

            # Calculate true hole axis center (project surface point onto axis)
            s_pt = f_meta.get("center", (0, 0, 0))
            v_p_l = [s_pt[i] - loc[i] for i in range(3)]
            dot_v_a = sum(v_p_l[i] * axis[i] for i in range(3))
            hole_center = [round(loc[i] + dot_v_a * axis[i], 4) for i in range(3)]

            if csink_cone_fid:
                # Countersink hole
                cone_meta = extractor.faces[csink_cone_fid]
                cone_bb = cone_meta.get("bbox", {})
                csink_diam = round(max(
                    abs(cone_bb.get("max", [0, 0, 0])[0] - cone_bb.get("min", [0, 0, 0])[0]),
                    abs(cone_bb.get("max", [0, 0, 0])[1] - cone_bb.get("min", [0, 0, 0])[1]),
                ), 3)
                if csink_diam < radius * 2:
                    csink_diam = round(radius * 2 * 1.5, 3)

                csink_angle = round(math.degrees(cone_meta.get("angle", math.radians(90))), 1)
                if csink_angle <= 0 or csink_angle > 180:
                    csink_angle = 90.0

                feat_id = _stable_feat_id("hole", [fid, csink_cone_fid])
                all_faces = [fid, csink_cone_fid]
                holes.append(DetectedFeature(
                    feature_id=feat_id,
                    kind="hole",
                    subtype="countersink",
                    name=f"Countersink Ø{radius*2:.1f} / ⌀{csink_diam:.1f}",
                    face_ids=all_faces,
                    edge_ids=[],
                    center=hole_center,
                    axis=axis,
                    bounding_box=f_meta.get("bbox", {}),
                    params=[
                        FeatureParam(key="hole_type", label="Hole Type", value="countersink", type="select", options=["blind", "through", "counterbore", "countersink"]),
                        FeatureParam(key="diameter", label="Diameter", unit="mm", value=round(radius * 2, 3), type="number", min=0.5, max=100.0, step=0.5),
                        FeatureParam(key="depth", label="Depth", unit="mm", value=round(depth, 3), type="number", min=0.5, max=200.0, step=0.5),
                        FeatureParam(key="csink_diameter", label="Countersink ⌀", unit="mm", value=csink_diam, type="number", min=radius * 2, max=150.0, step=0.5),
                        FeatureParam(key="csink_angle", label="Countersink Angle", unit="°", value=csink_angle, type="number", min=30.0, max=160.0, step=1.0),
                    ],
                    editable=True,
                    confidence=0.98,
                ))

            elif len(coaxial_group) > 1:
                # Counterbore hole (2 or more coaxial cylinders)
                cyl_metas = [(cfid, extractor.faces[cfid].get("radius", 0.0)) for cfid in coaxial_group]
                cyl_metas.sort(key=lambda x: x[1])  # sort ascending: small first
                small_fid, small_r = cyl_metas[0]
                large_fid, large_r = cyl_metas[-1]

                large_obj = extractor.get_face_object(large_fid)
                large_depth = cls._calc_projected_depth(large_obj, axis, extractor.faces[large_fid].get("bbox", {}))
                total_depth = depth + large_depth

                feat_id = _stable_feat_id("hole", coaxial_group)
                holes.append(DetectedFeature(
                    feature_id=feat_id,
                    kind="hole",
                    subtype="counterbore",
                    name=f"Counterbore Ø{small_r*2:.1f} / ⌀{large_r*2:.1f}",
                    face_ids=coaxial_group,
                    edge_ids=[],
                    center=hole_center,
                    axis=axis,
                    bounding_box=f_meta.get("bbox", {}),
                    params=[
                        FeatureParam(key="hole_type", label="Hole Type", value="counterbore", type="select", options=["blind", "through", "counterbore", "countersink"]),
                        FeatureParam(key="diameter", label="Diameter", unit="mm", value=round(small_r * 2, 3), type="number", min=0.5, max=100.0, step=0.5),
                        FeatureParam(key="depth", label="Depth", unit="mm", value=round(total_depth, 3), type="number", min=0.5, max=200.0, step=0.5),
                        FeatureParam(key="cbore_diameter", label="C-Bore ⌀", unit="mm", value=round(large_r * 2, 3), type="number", min=small_r * 2, max=150.0, step=0.5),
                        FeatureParam(key="cbore_depth", label="C-Bore Depth", unit="mm", value=round(large_depth, 3), type="number", min=0.5, max=50.0, step=0.5),
                    ],
                    editable=True,
                    confidence=0.98,
                ))

            else:
                # Single cylinder hole (blind or through)
                subtype = "blind" if has_bottom else "through"
                name_str = f"Hole Ø{radius*2:.1f} · {subtype}" if subtype == "through" else f"Hole Ø{radius*2:.1f} × {depth:.1f} · {subtype}"
                feat_id = _stable_feat_id("hole", [fid])

                params = [
                    FeatureParam(key="hole_type", label="Hole Type", value=subtype, type="select", options=["blind", "through", "counterbore", "countersink"]),
                    FeatureParam(key="diameter", label="Diameter", unit="mm", value=round(radius * 2, 3), type="number", min=0.5, max=100.0, step=0.5),
                ]
                if subtype == "blind":
                    params.append(FeatureParam(key="depth", label="Depth", unit="mm", value=round(depth, 3), type="number", min=0.5, max=200.0, step=0.5))

                holes.append(DetectedFeature(
                    feature_id=feat_id,
                    kind="hole",
                    subtype=subtype,
                    name=name_str,
                    face_ids=[fid],
                    edge_ids=[],
                    center=hole_center,
                    axis=axis,
                    bounding_box=f_meta.get("bbox", {}),
                    params=params,
                    editable=True,
                    confidence=0.95,
                ))

        return holes

    @classmethod
    def _detect_bosses(
        cls, shape: bd.Shape, extractor: TopologyExtractor, claimed_faces: Set[str]
    ) -> List[DetectedFeature]:
        bosses: List[DetectedFeature] = []

        for fid, f_meta in extractor.faces.items():
            if fid in claimed_faces or f_meta.get("type") != "cylinder":
                continue

            f_obj = extractor.get_face_object(fid)
            if not f_obj:
                continue

            cyl_loc = f_meta.get("location", (0, 0, 0))
            cyl_axis = f_meta.get("axis", (0, 0, 1))

            try:
                pt = f_obj.center()
                n = f_obj.normal_at(pt)
                v_axis_to_pt = [pt.X - cyl_loc[0], pt.Y - cyl_loc[1], pt.Z - cyl_loc[2]]
                dot_axis = sum(a * b for a, b in zip(v_axis_to_pt, cyl_axis))
                v_radial = [v_axis_to_pt[i] - dot_axis * cyl_axis[i] for i in range(3)]
                dot_n_r = n.X * v_radial[0] + n.Y * v_radial[1] + n.Z * v_radial[2]

                if dot_n_r > 1e-4:  # Normal points outward -> outer cylinder / boss
                    radius = f_meta.get("radius", 0.0)
                    axis = list(cyl_axis)
                    height = cls._calc_projected_depth(f_obj, axis, f_meta.get("bbox", {}))

                    # Check for top planar face (convex transition with the cylinder cap, not concave base)
                    top_fid = None
                    for a in extractor.adjacency.get(fid, []):
                        afid = a["adjacent_face"]
                        ameta = extractor.faces.get(afid, {})
                        if ameta.get("type") == "plane":
                            anormal = ameta.get("normal", (0, 0, 0))
                            if abs(sum(x * y for x, y in zip(axis, anormal))) > 0.99:
                                # Top cap has convex edge with the cylinder wall, whereas base is concave
                                if a.get("transition") == "convex" or top_fid is None:
                                    top_fid = afid
                                    if a.get("transition") == "convex":
                                        break

                    feat_faces = [fid]
                    if top_fid:
                        feat_faces.append(top_fid)

                    feat_id = _stable_feat_id("boss", feat_faces)
                    bosses.append(DetectedFeature(
                        feature_id=feat_id,
                        kind="boss",
                        subtype="cylinder",
                        name=f"Boss Ø{radius*2:.1f} × {height:.1f}",
                        face_ids=feat_faces,
                        edge_ids=[],
                        center=list(f_meta.get("center", (0, 0, 0))),
                        axis=axis,
                        bounding_box=f_meta.get("bbox", {}),
                        params=[
                            FeatureParam(key="diameter", label="Diameter", unit="mm", value=round(radius * 2, 3), type="number", min=0.5, max=150.0, step=0.5),
                            FeatureParam(key="height", label="Height", unit="mm", value=round(height, 3), type="number", min=0.5, max=200.0, step=0.5),
                        ],
                        editable=True,
                        confidence=0.92,
                    ))
            except Exception:
                continue

        return bosses

    @classmethod
    def _detect_pockets_and_slots(
        cls, shape: bd.Shape, extractor: TopologyExtractor, claimed_faces: Set[str]
    ) -> Tuple[List[DetectedFeature], List[DetectedFeature]]:
        pockets: List[DetectedFeature] = []
        slots: List[DetectedFeature] = []

        for fid, f_meta in extractor.faces.items():
            if fid in claimed_faces or f_meta.get("type") != "plane":
                continue

            # A pocket floor must be surrounded by concave transition walls
            adj = extractor.adjacency.get(fid, [])
            concave_walls = [
                a["adjacent_face"] for a in adj if a.get("transition") == "concave" and a["adjacent_face"] not in claimed_faces
            ]

            if len(concave_walls) < 1:
                continue

            floor_bb = f_meta.get("bbox", {})
            dx = abs(floor_bb.get("max", [0, 0, 0])[0] - floor_bb.get("min", [0, 0, 0])[0])
            dy = abs(floor_bb.get("max", [0, 0, 0])[1] - floor_bb.get("min", [0, 0, 0])[1])
            dz = abs(floor_bb.get("max", [0, 0, 0])[2] - floor_bb.get("min", [0, 0, 0])[2])
            dims = sorted([d for d in [dx, dy, dz] if d > 1e-3], reverse=True)
            w = round(dims[0], 2) if len(dims) > 0 else 10.0
            l = round(dims[1], 2) if len(dims) > 1 else w

            # Measure wall height for pocket depth
            wall_depth = 5.0
            for wfid in concave_walls:
                w_obj = extractor.get_face_object(wfid)
                if w_obj:
                    w_axis = f_meta.get("normal", [0, 0, 1])
                    wall_depth = round(cls._calc_projected_depth(w_obj, w_axis, extractor.faces[wfid].get("bbox", {})), 2)
                    if wall_depth > 0.5:
                        break

            # Check if wall has cylindrical arcs (slot / obround)
            cyl_walls = [wfid for wfid in concave_walls if extractor.faces.get(wfid, {}).get("type") == "cylinder"]
            plane_walls = [wfid for wfid in concave_walls if extractor.faces.get(wfid, {}).get("type") == "plane"]

            all_faces = [fid] + concave_walls

            if len(cyl_walls) >= 2 and len(plane_walls) >= 2:
                # Slot (obround)
                feat_id = _stable_feat_id("slot", all_faces)
                slots.append(DetectedFeature(
                    feature_id=feat_id,
                    kind="slot",
                    subtype="obround",
                    name=f"Slot {w:.1f} × {l:.1f} × {wall_depth:.1f}",
                    face_ids=all_faces,
                    edge_ids=[],
                    center=list(f_meta.get("center", (0, 0, 0))),
                    axis=list(f_meta.get("normal", (0, 0, 1))),
                    bounding_box=floor_bb,
                    params=[
                        FeatureParam(key="length", label="Length", unit="mm", value=w, type="number", min=1.0, max=200.0, step=0.5),
                        FeatureParam(key="width", label="Width", unit="mm", value=l, type="number", min=1.0, max=100.0, step=0.5),
                        FeatureParam(key="depth", label="Depth", unit="mm", value=wall_depth, type="number", min=0.5, max=100.0, step=0.5),
                    ],
                    editable=True,
                    confidence=0.90,
                ))
            elif len(cyl_walls) == 1 and len(plane_walls) == 0:
                # Circular pocket
                feat_id = _stable_feat_id("pocket", all_faces)
                r = extractor.faces[cyl_walls[0]].get("radius", w / 2)
                pockets.append(DetectedFeature(
                    feature_id=feat_id,
                    kind="pocket",
                    subtype="circle",
                    name=f"Circular Pocket Ø{r*2:.1f} × {wall_depth:.1f}",
                    face_ids=all_faces,
                    edge_ids=[],
                    center=list(f_meta.get("center", (0, 0, 0))),
                    axis=list(f_meta.get("normal", (0, 0, 1))),
                    bounding_box=floor_bb,
                    params=[
                        FeatureParam(key="profile", label="Profile", value="circle", type="select", options=["circle", "rect"]),
                        FeatureParam(key="diameter", label="Diameter", unit="mm", value=round(r * 2, 2), type="number", min=1.0, max=200.0, step=0.5),
                        FeatureParam(key="depth", label="Depth", unit="mm", value=wall_depth, type="number", min=0.5, max=100.0, step=0.5),
                    ],
                    editable=True,
                    confidence=0.92,
                ))
            elif len(concave_walls) >= 3:
                # Rectangular pocket
                feat_id = _stable_feat_id("pocket", all_faces)
                pockets.append(DetectedFeature(
                    feature_id=feat_id,
                    kind="pocket",
                    subtype="rect",
                    name=f"Pocket {w:.1f} × {l:.1f} × {wall_depth:.1f}",
                    face_ids=all_faces,
                    edge_ids=[],
                    center=list(f_meta.get("center", (0, 0, 0))),
                    axis=list(f_meta.get("normal", (0, 0, 1))),
                    bounding_box=floor_bb,
                    params=[
                        FeatureParam(key="profile", label="Profile", value="rect", type="select", options=["rect", "circle"]),
                        FeatureParam(key="width", label="Width", unit="mm", value=w, type="number", min=1.0, max=200.0, step=0.5),
                        FeatureParam(key="length", label="Length", unit="mm", value=l, type="number", min=1.0, max=200.0, step=0.5),
                        FeatureParam(key="depth", label="Depth", unit="mm", value=wall_depth, type="number", min=0.5, max=100.0, step=0.5),
                        FeatureParam(key="corner_radius", label="Corner R", unit="mm", value=0.0, type="number", min=0.0, max=20.0, step=0.5),
                    ],
                    editable=True,
                    confidence=0.90,
                ))

        return pockets, slots

    @classmethod
    def _detect_blends(
        cls, shape: bd.Shape, extractor: TopologyExtractor
    ) -> Tuple[List[DetectedFeature], List[DetectedFeature]]:
        fillets: List[DetectedFeature] = []
        chamfers: List[DetectedFeature] = []

        for fid, f_meta in extractor.faces.items():
            f_type = f_meta.get("type")
            adj = extractor.adjacency.get(fid, [])

            if f_type in ("cylinder", "torus") and len(adj) >= 2:
                # Fillet check: must be tangent to at least 2 distinct adjacent faces
                distinct_tangent = {
                    a["adjacent_face"] for a in adj
                    if a.get("transition") == "tangent" and a["adjacent_face"] != fid
                }
                radius = f_meta.get("radius", 0.0)

                # Check normal direction: external corner fillets have outward-pointing normals
                f_obj = extractor.get_face_object(fid)
                is_outward = False
                if f_obj and f_type == "cylinder":
                    try:
                        pt = f_obj.center()
                        n = f_obj.normal_at(pt)
                        cyl_loc = f_meta.get("location", (0, 0, 0))
                        cyl_axis = f_meta.get("axis", (0, 0, 1))
                        v_axis_to_pt = [pt.X - cyl_loc[0], pt.Y - cyl_loc[1], pt.Z - cyl_loc[2]]
                        dot_axis = sum(a * b for a, b in zip(v_axis_to_pt, cyl_axis))
                        v_radial = [v_axis_to_pt[i] - dot_axis * cyl_axis[i] for i in range(3)]
                        dot_n_r = n.X * v_radial[0] + n.Y * v_radial[1] + n.Z * v_radial[2]
                        is_outward = dot_n_r > 1e-4
                    except Exception:
                        is_outward = False

                if len(distinct_tangent) >= 2 and (is_outward or f_type == "torus") and f_meta.get("area", 100) < 500:
                    feat_id = _stable_feat_id("fillet", [fid])
                    fillets.append(DetectedFeature(
                        feature_id=feat_id,
                        kind="fillet",
                        subtype="fillet",
                        name=f"Fillet R{radius:.1f}",
                        face_ids=[fid],
                        edge_ids=[],
                        center=list(f_meta.get("center", (0, 0, 0))),
                        axis=list(f_meta.get("axis", (0, 0, 1))) if f_type == "cylinder" else None,
                        bounding_box=f_meta.get("bbox", {}),
                        params=[
                            FeatureParam(key="radius", label="Radius", unit="mm", value=round(radius, 2), type="number", min=0.2, max=50.0, step=0.2),
                        ],
                        editable=True,
                        confidence=0.95,
                    ))

            elif f_type == "plane" and len(adj) >= 2:
                # Chamfer check: narrow planar face between two faces at non-90 deg dihedral (bevel)
                f_norm = f_meta.get("normal")
                if not f_norm:
                    continue

                dihedrals: List[float] = []
                for a in adj:
                    afid = a["adjacent_face"]
                    if afid == fid:
                        continue
                    anorm = extractor.faces.get(afid, {}).get("normal")
                    if anorm:
                        dot = abs(sum(x * y for x, y in zip(f_norm, anorm)))
                        dihedrals.append(dot)

                # Chamfer bevel must have adjacent faces at non-90° (dot != 0) and non-parallel (dot != 1)
                is_beveled = any(0.15 < d < 0.95 for d in dihedrals)

                if is_beveled:
                    bb = f_meta.get("bbox", {})
                    dx = abs(bb.get("max", [0, 0, 0])[0] - bb.get("min", [0, 0, 0])[0])
                    dy = abs(bb.get("max", [0, 0, 0])[1] - bb.get("min", [0, 0, 0])[1])
                    dz = abs(bb.get("max", [0, 0, 0])[2] - bb.get("min", [0, 0, 0])[2])
                    dims = sorted([d for d in [dx, dy, dz] if d > 1e-4])
                    if len(dims) >= 2 and dims[0] < 10.0 and (dims[-1] / max(1e-4, dims[0])) > 1.8:
                        width = round(dims[0], 2)
                        feat_id = _stable_feat_id("chamfer", [fid])
                        chamfers.append(DetectedFeature(
                            feature_id=feat_id,
                            kind="chamfer",
                            subtype="chamfer",
                            name=f"Chamfer {width:.1f} mm",
                            face_ids=[fid],
                            edge_ids=[],
                            center=list(f_meta.get("center", (0, 0, 0))),
                            axis=None,
                            bounding_box=bb,
                            params=[
                                FeatureParam(key="distance", label="Distance", unit="mm", value=width, type="number", min=0.1, max=25.0, step=0.5),
                            ],
                            editable=True,
                            confidence=0.90,
                        ))

        return fillets, chamfers

    @staticmethod
    def _calc_projected_depth(
        face_obj: Optional[bd.Face], axis: List[float], bbox: Dict[str, Any]
    ) -> float:
        if face_obj is not None:
            try:
                pts = [v.center() for v in face_obj.vertices()]
                if pts:
                    projs = [p.X * axis[0] + p.Y * axis[1] + p.Z * axis[2] for p in pts]
                    val = abs(max(projs) - min(projs))
                    if val > 1e-4:
                        return round(val, 4)
            except Exception:
                pass

        # Fallback to bounding box extent along dominant axis
        try:
            dx = abs(bbox["max"][0] - bbox["min"][0])
            dy = abs(bbox["max"][1] - bbox["min"][1])
            dz = abs(bbox["max"][2] - bbox["min"][2])
            ax_abs = [abs(a) for a in axis]
            max_idx = ax_abs.index(max(ax_abs))
            return round([dx, dy, dz][max_idx], 4)
        except Exception:
            return 10.0
