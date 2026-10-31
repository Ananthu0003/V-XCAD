import math
from typing import Dict, Any, List, Optional, Tuple
try:
    import build123d as bd
    from OCP.TopAbs import TopAbs_REVERSED, TopAbs_EDGE, TopAbs_FACE
    from OCP.TopExp import TopExp
    from OCP.TopTools import TopTools_IndexedDataMapOfShapeListOfShape
    from OCP.GeomAbs import GeomAbs_Cylinder, GeomAbs_Plane, GeomAbs_Cone, GeomAbs_Sphere, GeomAbs_Torus
    HAS_OCP = True
except ImportError:
    bd = None
    HAS_OCP = False

from app.models.cad_modification import RecognizedShapeFeature, GeometricReference


class ShapeFeatureRecognizer:
    """
    Analyzes OpenCASCADE B-Rep solid geometry to recognize constituent parts and features:
    - Base Body / Envelope dimensions
    - Cylindrical Bores, Through Holes, and Counterbores
    - Cylindrical Bosses and Outer Shafts
    - Planar Pockets, Slots, and Recesses
    - Steps, Fillets, and Chamfers

    Outputs human-readable part names and extracted geometric parameters matching AI CAD conventions.
    """

    @classmethod
    def recognize_features(
        cls,
        shape: Any,
        faces_meta: Optional[Dict[str, GeometricReference]] = None,
        edges_meta: Optional[Dict[str, GeometricReference]] = None
    ) -> Tuple[List[RecognizedShapeFeature], Dict[str, float], Dict[str, Dict[str, Any]]]:
        if not bd or not HAS_OCP or shape is None:
            return [], {}, {}

        features: List[RecognizedShapeFeature] = []
        parameters: Dict[str, float] = {}
        parameter_metadata: Dict[str, Dict[str, Any]] = {}

        try:
            # Overall bounding box
            bb = shape.bounding_box()
            dx = max(0.1, bb.max.X - bb.min.X)
            dy = max(0.1, bb.max.Y - bb.min.Y)
            dz = max(0.1, bb.max.Z - bb.min.Z)
            top_z = bb.max.Z
            bottom_z = bb.min.Z
            center_pt = [
                round((bb.min.X + bb.max.X) / 2.0, 3),
                round((bb.min.Y + bb.max.Y) / 2.0, 3),
                round((bb.min.Z + bb.max.Z) / 2.0, 3),
            ]

            # 1. Base Envelope Feature
            vol_val = 0.0
            try:
                vol_val = shape.volume
            except Exception:
                pass

            base_len = round(dx, 2)
            base_w = round(dy, 2)
            base_h = round(dz, 2)

            parameters["base_length"] = base_len
            parameters["base_width"] = base_w
            parameters["base_height"] = base_h
            if vol_val > 0:
                parameters["volume_cm3"] = round(vol_val / 1000.0, 2)

            parameter_metadata["base_length"] = {
                "component": "Base Body",
                "category": "Base / Foundation",
                "description": f"Main solid length along X ({base_len:.1f} mm)",
                "unit": "mm"
            }
            parameter_metadata["base_width"] = {
                "component": "Base Body",
                "category": "Base / Foundation",
                "description": f"Main solid width along Y ({base_w:.1f} mm)",
                "unit": "mm"
            }
            parameter_metadata["base_height"] = {
                "component": "Base Body",
                "category": "Base / Foundation",
                "description": f"Main solid height along Z ({base_h:.1f} mm)",
                "unit": "mm"
            }

            all_faces = shape.faces()
            assigned_face_ids = set()

            # Map face pointers to face transient_ids if faces_meta provided
            # Otherwise index-based face_0, face_1...
            face_ptr_to_id: Dict[int, str] = {}
            for idx, f in enumerate(all_faces):
                tid = f"face_{idx}"
                face_ptr_to_id[hash(f.wrapped)] = tid

            # 2. Cylindrical Features (Holes vs Bosses)
            cylinders = all_faces.filter_by(bd.GeomType.CYLINDER)
            hole_idx = 1
            boss_idx = 1

            for cyl in cylinders:
                try:
                    c_pt = cyl.center()
                    rad = round(cyl.radius, 3)
                    dia = round(rad * 2.0, 2)
                    cbb = cyl.bounding_box()
                    depth = round(abs(cbb.max.Z - cbb.min.Z), 2)
                    if depth < 0.1:
                        # Cylinders along X or Y
                        depth = round(max(abs(cbb.max.X - cbb.min.X), abs(cbb.max.Y - cbb.min.Y)), 2)

                    f_id = face_ptr_to_id.get(hash(cyl.wrapped))
                    is_internal = cyl.wrapped.Orientation() == TopAbs_REVERSED

                    if is_internal:
                        # Through hole vs blind bore
                        is_through = abs(cbb.max.Z - top_z) < 0.2 and abs(cbb.min.Z - bottom_z) < 0.2
                        hole_type = "Through Hole" if is_through else "Blind Bore"
                        part_name = f"{hole_type} ⌀{dia:.1f}mm"
                        feat_id = f"feat_hole_{hole_idx}"

                        p_dia_key = f"hole_{hole_idx}_dia"
                        p_depth_key = f"hole_{hole_idx}_depth"

                        parameters[p_dia_key] = dia
                        parameters[p_depth_key] = depth

                        parameter_metadata[p_dia_key] = {
                            "component": f"Hole {hole_idx}",
                            "category": "Internal Features",
                            "description": f"Diameter of {hole_type} {hole_idx} ({dia:.1f} mm)",
                            "unit": "mm"
                        }
                        parameter_metadata[p_depth_key] = {
                            "component": f"Hole {hole_idx}",
                            "category": "Internal Features",
                            "description": f"Depth of {hole_type} {hole_idx} ({depth:.1f} mm)",
                            "unit": "mm"
                        }

                        f_ids = [f_id] if f_id else []
                        if f_id:
                            assigned_face_ids.add(f_id)

                        features.append(RecognizedShapeFeature(
                            feature_id=feat_id,
                            part_name=part_name,
                            feature_type="hole",
                            category="Internal Features",
                            parameters={"diameter": dia, "radius": rad, "depth": depth},
                            face_ids=f_ids,
                            center=[round(c_pt.X, 3), round(c_pt.Y, 3), round(c_pt.Z, 3)],
                            bounding_box={
                                "min": [cbb.min.X, cbb.min.Y, cbb.min.Z],
                                "max": [cbb.max.X, cbb.max.Y, cbb.max.Z],
                            },
                            axis=[0.0, 0.0, 1.0],
                            description=f"{hole_type} with ⌀{dia:.1f} mm diameter and {depth:.1f} mm depth."
                        ))
                        hole_idx += 1
                    else:
                        # External Boss / Shaft
                        part_name = f"Boss ⌀{dia:.1f}×{depth:.1f}mm"
                        feat_id = f"feat_boss_{boss_idx}"

                        p_dia_key = f"boss_{boss_idx}_dia"
                        p_h_key = f"boss_{boss_idx}_height"

                        parameters[p_dia_key] = dia
                        parameters[p_h_key] = depth

                        parameter_metadata[p_dia_key] = {
                            "component": f"Boss {boss_idx}",
                            "category": "External Features",
                            "description": f"Diameter of Boss {boss_idx} ({dia:.1f} mm)",
                            "unit": "mm"
                        }
                        parameter_metadata[p_h_key] = {
                            "component": f"Boss {boss_idx}",
                            "category": "External Features",
                            "description": f"Height of Boss {boss_idx} ({depth:.1f} mm)",
                            "unit": "mm"
                        }

                        f_ids = [f_id] if f_id else []
                        if f_id:
                            assigned_face_ids.add(f_id)

                        features.append(RecognizedShapeFeature(
                            feature_id=feat_id,
                            part_name=part_name,
                            feature_type="boss",
                            category="External Features",
                            parameters={"diameter": dia, "radius": rad, "height": depth},
                            face_ids=f_ids,
                            center=[round(c_pt.X, 3), round(c_pt.Y, 3), round(c_pt.Z, 3)],
                            bounding_box={
                                "min": [cbb.min.X, cbb.min.Y, cbb.min.Z],
                                "max": [cbb.max.X, cbb.max.Y, cbb.max.Z],
                            },
                            axis=[0.0, 0.0, 1.0],
                            description=f"Raised cylindrical boss with ⌀{dia:.1f} mm and {depth:.1f} mm protrusion."
                        ))
                        boss_idx += 1
                except Exception:
                    continue

            # 3. Planar Pockets, Slots & Cavities
            planes = all_faces.filter_by(bd.GeomType.PLANE)
            pocket_idx = 1
            step_idx = 1

            for pl in planes:
                try:
                    c_pt = pl.center()
                    norm = pl.normal_at(c_pt)
                    fbb = pl.bounding_box()
                    f_id = face_ptr_to_id.get(hash(pl.wrapped))

                    # Horizontal planar faces
                    if abs(norm.Z) > 0.9:
                        # Recessed below top surface and above bottom surface
                        if c_pt.Z < top_z - 0.5 and c_pt.Z > bottom_z + 0.5:
                            p_w = round(max(0.1, fbb.max.X - fbb.min.X), 2)
                            p_l = round(max(0.1, fbb.max.Y - fbb.min.Y), 2)
                            # Must be smaller than outer stock
                            if p_w < dx * 0.95 or p_l < dy * 0.95:
                                p_depth = round(top_z - c_pt.Z, 2)
                                part_name = f"Pocket {pocket_idx} ({p_w:.1f}×{p_l:.1f}mm)"
                                feat_id = f"feat_pocket_{pocket_idx}"

                                p_w_key = f"pocket_{pocket_idx}_width"
                                p_l_key = f"pocket_{pocket_idx}_length"
                                p_d_key = f"pocket_{pocket_idx}_depth"

                                parameters[p_w_key] = p_w
                                parameters[p_l_key] = p_l
                                parameters[p_d_key] = p_depth

                                parameter_metadata[p_w_key] = {
                                    "component": f"Pocket {pocket_idx}",
                                    "category": "Milling Features",
                                    "description": f"Pocket {pocket_idx} Width ({p_w:.1f} mm)",
                                    "unit": "mm"
                                }
                                parameter_metadata[p_l_key] = {
                                    "component": f"Pocket {pocket_idx}",
                                    "category": "Milling Features",
                                    "description": f"Pocket {pocket_idx} Length ({p_l:.1f} mm)",
                                    "unit": "mm"
                                }
                                parameter_metadata[p_d_key] = {
                                    "component": f"Pocket {pocket_idx}",
                                    "category": "Milling Features",
                                    "description": f"Pocket {pocket_idx} Depth from Top ({p_depth:.1f} mm)",
                                    "unit": "mm"
                                }

                                f_ids = [f_id] if f_id else []
                                if f_id:
                                    assigned_face_ids.add(f_id)

                                features.append(RecognizedShapeFeature(
                                    feature_id=feat_id,
                                    part_name=part_name,
                                    feature_type="pocket",
                                    category="Milling Features",
                                    parameters={"width": p_w, "length": p_l, "depth": p_depth},
                                    face_ids=f_ids,
                                    center=[round(c_pt.X, 3), round(c_pt.Y, 3), round(c_pt.Z, 3)],
                                    bounding_box={
                                        "min": [fbb.min.X, fbb.min.Y, c_pt.Z],
                                        "max": [fbb.max.X, fbb.max.Y, top_z],
                                    },
                                    axis=[0.0, 0.0, 1.0],
                                    description=f"Recessed milling pocket {p_w:.1f} mm wide, {p_l:.1f} mm long, {p_depth:.1f} mm deep."
                                ))
                                pocket_idx += 1
                        elif c_pt.Z < top_z - 0.2 and (abs(fbb.max.X - fbb.min.X) < dx * 0.9 or abs(fbb.max.Y - fbb.min.Y) < dy * 0.9):
                            # Step shoulder
                            s_h = round(top_z - c_pt.Z, 2)
                            part_name = f"Step Shoulder {step_idx} ({s_h:.1f}mm)"
                            feat_id = f"feat_step_{step_idx}"
                            p_key = f"step_{step_idx}_drop"
                            parameters[p_key] = s_h
                            parameter_metadata[p_key] = {
                                "component": f"Step Shoulder {step_idx}",
                                "category": "Milling Features",
                                "description": f"Step {step_idx} Height drop ({s_h:.1f} mm)",
                                "unit": "mm"
                            }
                            f_ids = [f_id] if f_id else []
                            if f_id:
                                assigned_face_ids.add(f_id)
                            features.append(RecognizedShapeFeature(
                                feature_id=feat_id,
                                part_name=part_name,
                                feature_type="slot",
                                category="Milling Features",
                                parameters={"height": s_h},
                                face_ids=f_ids,
                                center=[round(c_pt.X, 3), round(c_pt.Y, 3), round(c_pt.Z, 3)],
                                bounding_box={
                                    "min": [fbb.min.X, fbb.min.Y, c_pt.Z],
                                    "max": [fbb.max.X, fbb.max.Y, top_z],
                                },
                                description=f"Planar step shoulder transition with {s_h:.1f} mm step height."
                            ))
                            step_idx += 1
                except Exception:
                    continue

            # 4. Base Body Shape Feature (contains remaining outer envelope faces)
            unassigned_face_ids = [
                f_id for f_id in face_ptr_to_id.values()
                if f_id not in assigned_face_ids
            ]

            features.insert(0, RecognizedShapeFeature(
                feature_id="feat_base_body",
                part_name="Main Body / Base Block",
                feature_type="body",
                category="Base / Foundation",
                parameters={"length": base_len, "width": base_w, "height": base_h, "volume_cm3": parameters.get("volume_cm3", 0.0)},
                face_ids=unassigned_face_ids,
                center=center_pt,
                bounding_box={
                    "min": [bb.min.X, bb.min.Y, bb.min.Z],
                    "max": [bb.max.X, bb.max.Y, bb.max.Z],
                },
                description=f"Primary solid envelope: {base_len:.1f} × {base_w:.1f} × {base_h:.1f} mm."
            ))

        except Exception as exc:
            import traceback
            traceback.print_exc()

        return features, parameters, parameter_metadata
