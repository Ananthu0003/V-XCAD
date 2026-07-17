"""
CamFeatureRecognition — Topology-driven manufacturing feature recognition.

This module identifies machining *intent* (hole, pocket, contour, face, step)
from B-Rep topology.  It does NOT generate geometry, contours, or toolpaths.

Geometry extraction is the responsibility of GeometryMapper.
"""
import uuid
import math
from typing import List, Dict, Any, Optional
from app.services.io.step_importer import StepImporter
from app.services.geometry.topology_extractor import TopologyExtractor


class CamFeature:
    """Represents a recognized manufacturing feature from B-Rep topology."""

    def __init__(self, feature_type: str, subtype: str = "generic", **kwargs):
        import hashlib
        
        self.type = feature_type
        self.subtype = subtype
        self.face_ids: List[str] = kwargs.get("face_ids", [])
        
        if self.face_ids:
            hash_input = f"{self.type}_{','.join(sorted(self.face_ids))}"
            self.id = f"feat_{hashlib.md5(hash_input.encode()).hexdigest()[:8]}"
        else:
            self.id = f"feat_{uuid.uuid4().hex[:8]}"
            
        self.subtype = subtype
        self.name = (
            subtype.replace("_", " ") if subtype != "generic" else feature_type.replace("_", " ")
        ).title()

        # Topology references — stable string IDs, never OCC objects
        self.edge_ids: List[str] = kwargs.get("edge_ids", [])
        self.cylinder_face_id: Optional[str] = kwargs.get("cylinder_face_id", None)
        self.floor_face_id: Optional[str] = kwargs.get("floor_face_id", None)
        self.wall_face_ids: List[str] = kwargs.get("wall_face_ids", [])

        # Parent/child relationships
        self.parent_feature_id: Optional[str] = kwargs.get("parent_feature_id", None)
        self.child_feature_ids: List[str] = kwargs.get("child_feature_ids", [])

        # Location / orientation (from topology analysis — for UI display)
        self.location = kwargs.get("center", [0, 0, 0])
        self.center = self.location
        self.axis = kwargs.get("axis", [0, 0, 1])

        # Dimensional metadata — for UI info/display ONLY, never for toolpath coords
        self.dimensions: Dict[str, Any] = kwargs.get("dimensions", {})
        self.confidence: float = kwargs.get("confidence", 1.0)
        self.warnings: List[str] = kwargs.get("warnings", [])

        # Area/volume estimates
        self.area: float = kwargs.get("area", 0.0)
        self.volume_estimate: float = kwargs.get("volume_estimate", 0.0)

        # Recommended operation & tool (intent hints for UI)
        if feature_type == "hole":
            self.recommendedToolType = "drill_bit"
            self.recommendedOperation = "drilling"
        elif feature_type == "pocket":
            self.recommendedToolType = "flat_end_mill"
            self.recommendedOperation = "pocketing"
        elif feature_type == "face":
            self.recommendedToolType = "face_mill"
            self.recommendedOperation = "facing"
        elif feature_type == "contour":
            self.recommendedToolType = "flat_end_mill"
            self.recommendedOperation = "2d_contour"
        elif feature_type == "boss":
            self.recommendedToolType = "flat_end_mill"
            self.recommendedOperation = "boss_clearing"
        elif feature_type in ("external_cylinder", "shaft", "turned_od", "side_protrusion"):
            self.recommendedToolType = "lathe_tool"
            self.recommendedOperation = "turning"
        else:
            self.recommendedToolType = "flat_end_mill"
            self.recommendedOperation = "2d_contour"

    def to_dict(self) -> Dict[str, Any]:
        """Serialise to API-safe dict.  No OCC objects."""
        d = {
            "id": self.id,
            "type": self.type,
            "subtype": self.subtype,
            "name": self.name,
            "face_ids": self.face_ids,
            "edge_ids": self.edge_ids,
            "cylinder_face_id": self.cylinder_face_id,
            "floor_face_id": self.floor_face_id,
            "wall_face_ids": self.wall_face_ids,
            "parent_feature_id": self.parent_feature_id,
            "child_feature_ids": self.child_feature_ids,
            "location": self.location,
            "center": self.center,
            "axis": self.axis,
            "dimensions": self.dimensions,
            "confidence": self.confidence,
            "warnings": self.warnings,
            "area": self.area,
            "volume_estimate": self.volume_estimate,
            "recommendedToolType": self.recommendedToolType,
            "recommendedOperation": self.recommendedOperation,
            # Topology references for setup analysis
            "parentFaceId": getattr(self, "parent_face_id_for_boss", None),
            "floorFaceId": self.floor_face_id,
            # Machining region status (set by GeometryMapper)
            "machining_region": None,
            # Setup-aware machinability (set by CamSetupAnalyzer)
            "machinable_in_current_setup": True,
            "requires_reorientation": False,
            "requires_4axis_or_secondary_setup": False,
            "blocked_reason": None,
            "featureGroupId": getattr(self, "featureGroupId", None),
            "centerline": getattr(self, "centerline", None),
            "radius": getattr(self, "radius", None),
            "length": getattr(self, "length", None),
            "machiningStatus": getattr(self, "machiningStatus", "valid"),
            # Required for contour geometry mapping
            "boundaryPoints": getattr(self, "boundaryPoints", []),
            "wireId": getattr(self, "wireId", None),
            "source": getattr(self, "source", None),
            "boundaryClosed": getattr(self, "boundaryClosed", False),
            # Entry face data for setup assignment (holes)
            "possibleEntryFaces": getattr(self, "possibleEntryFaces", []),
        }
        return d


class CamFeatureRecognition:
    """
    Topology-driven feature recognition engine.

    Scans OpenCASCADE topology to identify manufacturing features.
    Stores stable face/edge IDs as references — does NOT extract geometry.
    """

    def __init__(self):
        self.extractor: Optional[TopologyExtractor] = None
        self.features: List[CamFeature] = []
        self.machining_direction = [0, 0, 1]  # Default Z-up

    def recognize_features(self, step_file_path: Optional[str] = None, shape: Optional[Any] = None) -> List[Dict[str, Any]]:
        """
        Analyse a STEP file or Shape and return recognised features.

        Returns list of dicts with stable topology IDs and dimension metadata.
        No OCC objects in output.
        """
        import time

        start_time = time.time()
        self.features = []

        try:
            if shape is not None:
                self.extractor = TopologyExtractor(shape)
            elif step_file_path:
                shape, _ = StepImporter.load_and_heal(step_file_path)
                self.extractor = TopologyExtractor(shape)
            else:
                raise ValueError("Must provide either step_file_path or shape.")

            # Safety: limit face count
            faces = shape.faces()
            if len(faces) > 1500:
                print("Warning: Model exceeds 1500 faces. Truncating extraction.")
                return []

            # Topology extraction
            self.extractor = TopologyExtractor(shape)
            self.extractor.extract_all()

            # Feature rules
            self._find_holes()
            self._find_bosses()
            self._find_planar_features()
            self._find_outer_profile()

            elapsed = time.time() - start_time
            if elapsed > 30.0:
                print(f"Warning: Extraction took {elapsed:.2f}s (>30s).")

        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"Feature recognition failed: {e}")

        # Cleanup, group, and finalize feature classification
        self._cleanup_features()

        return [f.to_dict() for f in self.features]

    def get_extractor(self) -> Optional[TopologyExtractor]:
        """Return the topology extractor for use by GeometryMapper."""
        return self.extractor

    # ------------------------------------------------------------------
    # Hole detection
    # ------------------------------------------------------------------

    def _find_holes(self) -> None:
        internal_cylinders = []

        for fid, face in self.extractor.faces.items():
            if face["type"] != "cylinder":
                continue

            # Determine if cylinder faces inward (internal = hole)
            face_obj = self.extractor.get_face_object(fid)
            if face_obj is None:
                continue

            cyl_loc = face.get("location", (0, 0, 0))
            cyl_axis = face.get("axis", (0, 0, 1))

            try:
                pt = face_obj.center()
                n = face_obj.normal_at(pt)

                # Radial vector from axis to surface point
                v_axis_to_pt = [
                    pt.X - cyl_loc[0],
                    pt.Y - cyl_loc[1],
                    pt.Z - cyl_loc[2],
                ]
                dot_axis = sum(a * b for a, b in zip(v_axis_to_pt, cyl_axis))
                v_radial = [
                    v_axis_to_pt[i] - dot_axis * cyl_axis[i] for i in range(3)
                ]
                dot_n_r = n.X * v_radial[0] + n.Y * v_radial[1] + n.Z * v_radial[2]

                if dot_n_r < -1e-5:
                    internal_cylinders.append(fid)
            except Exception:
                continue

        for fid in internal_cylinders:
            adj = self.extractor.adjacency.get(fid, [])
            face = self.extractor.faces[fid]
            radius = face.get("radius", 0)

            has_planar_bottom = False
            has_conical_bottom = False
            possible_entry_faces = []

            hole_axis = list(face.get("axis", (0, 0, 1)))
            hole_axis_len = math.sqrt(sum(v*v for v in hole_axis))
            if hole_axis_len > 1e-6:
                hole_axis = [v / hole_axis_len for v in hole_axis]

            for a in adj:
                adj_fid = a["adjacent_face"]
                adj_f = self.extractor.faces.get(adj_fid, {})
                if adj_f.get("type") == "plane" and a["transition"] == "concave":
                    has_planar_bottom = True
                elif adj_f.get("type") == "cone" and a["transition"] == "tangent":
                    has_conical_bottom = True

                # Detect entry/exit faces: planar faces adjacent to the hole
                # whose normals are parallel to the hole axis, and the transition is convex
                if adj_f.get("type") == "plane" and a.get("transition") == "convex":
                    adj_normal = adj_f.get("normal", (0, 0, 0))
                    dot_parallel = abs(sum(ha * an for ha, an in zip(hole_axis, adj_normal)))
                    if dot_parallel > 0.98:
                        # This face is an entry or exit face
                        adj_bb = adj_f.get("bbox", {})
                        z_level = None
                        try:
                            z_level = round((adj_bb["min"][2] + adj_bb["max"][2]) / 2, 6)
                        except Exception:
                            pass
                        possible_entry_faces.append({
                            "faceId": adj_fid,
                            "normal": list(adj_normal),
                            "zLevel": z_level,
                        })

            subtype = "through_hole"
            if has_planar_bottom or has_conical_bottom:
                subtype = "blind_hole"

            # Depth estimate from bounding box Z extent
            depth = 10.0
            try:
                bb = face["bbox"]
                depth = round(abs(bb["max"][2] - bb["min"][2]), 6)
            except Exception:
                pass

            feat = CamFeature(
                feature_type="hole",
                subtype=subtype,
                face_ids=[fid],
                cylinder_face_id=fid,
                center=list(face.get("location", (0, 0, 0))),
                axis=hole_axis,
                area=face.get("area", 0),
                dimensions={"diameter": round(radius * 2, 6), "depth": depth},
                confidence=0.95,
            )
            feat.possibleEntryFaces = possible_entry_faces
            self.features.append(feat)

    # ------------------------------------------------------------------
    # Boss / Shaft detection
    # ------------------------------------------------------------------

    def _find_bosses(self) -> None:
        external_cylinders = []

        for fid, face in self.extractor.faces.items():
            if face["type"] != "cylinder":
                continue

            # Determine if cylinder faces outward (external = boss/shaft)
            face_obj = self.extractor.get_face_object(fid)
            if face_obj is None:
                continue

            cyl_loc = face.get("location", (0, 0, 0))
            cyl_axis = face.get("axis", (0, 0, 1))

            try:
                pt = face_obj.center()
                n = face_obj.normal_at(pt)

                # Radial vector from axis to surface point
                v_axis_to_pt = [
                    pt.X - cyl_loc[0],
                    pt.Y - cyl_loc[1],
                    pt.Z - cyl_loc[2],
                ]
                dot_axis = sum(a * b for a, b in zip(v_axis_to_pt, cyl_axis))
                v_radial = [
                    v_axis_to_pt[i] - dot_axis * cyl_axis[i] for i in range(3)
                ]
                dot_n_r = n.X * v_radial[0] + n.Y * v_radial[1] + n.Z * v_radial[2]

                if dot_n_r > 1e-5:
                    external_cylinders.append(fid)
            except Exception:
                continue

        for fid in external_cylinders:
            face = self.extractor.faces[fid]
            radius = face.get("radius", 0)

            # Height estimate from bounding box
            height = 10.0
            try:
                bb = face["bbox"]
                dx = abs(bb["max"][0] - bb["min"][0])
                dy = abs(bb["max"][1] - bb["min"][1])
                dz = abs(bb["max"][2] - bb["min"][2])
                height = round(max(dx, dy, dz), 6)
            except Exception:
                pass

            axis = list(face.get("axis", (0, 0, 1)))

            feat = CamFeature(
                feature_type="external_cylinder",
                subtype="shaft",  # Default subtype, will be refined in cleanup
                face_ids=[fid],
                cylinder_face_id=fid,
                center=list(face.get("location", (0, 0, 0))),
                axis=axis,
                area=face.get("area", 0),
                dimensions={"diameter": round(radius * 2, 6), "height": height},
                confidence=0.90,
            )
            self.features.append(feat)

    # ------------------------------------------------------------------
    # Planar feature detection (pockets, faces, steps)
    # ------------------------------------------------------------------

    def _find_planar_features(self) -> None:
        md = self.machining_direction

        planar_features = []

        for fid, face in self.extractor.faces.items():
            if face["type"] != "plane":
                continue
            
            # Ignore micro faces/sliver faces
            if face.get("area", 0) < 0.1:
                continue

            n = face.get("normal", (0, 0, 0))
            dot = n[0] * md[0] + n[1] * md[1] + n[2] * md[2]

            if dot <= 0.999:
                continue  # Not facing up

            adj = self.extractor.adjacency.get(fid, [])
            has_concave_wall_up = False
            has_convex_wall_down = False
            wall_faces: List[str] = []

            for a in adj:
                adj_fid = a["adjacent_face"]
                adj_f = self.extractor.faces.get(adj_fid, {})

                if adj_f.get("type") in ("plane", "cylinder"):
                    if adj_f["type"] == "plane":
                        adj_n = adj_f.get("normal", (0, 0, 0))
                        adj_dot = abs(sum(a2 * b2 for a2, b2 in zip(adj_n, md)))
                        if adj_dot < 0.1:  # Vertical wall
                            wall_faces.append(adj_fid)
                            if a["transition"] == "concave":
                                has_concave_wall_up = True
                            elif a["transition"] == "convex":
                                has_convex_wall_down = True

                    elif adj_f["type"] == "cylinder":
                        adj_axis = adj_f.get("axis", (0, 0, 0))
                        axis_dot = abs(sum(a3 * b3 for a3, b3 in zip(adj_axis, md)))
                        if axis_dot > 0.999:  # Vertical cylinder wall
                            wall_faces.append(adj_fid)
                            if a["transition"] == "concave":
                                has_concave_wall_up = True
                            elif a["transition"] == "convex":
                                has_convex_wall_down = True

            # Z level from bounding box
            try:
                bb = face["bbox"]
                z_level = bb["max"][2]
            except Exception:
                z_level = 0

            if has_concave_wall_up and not has_convex_wall_down:
                # Pocket
                planar_features.append(
                    CamFeature(
                        feature_type="pocket",
                        subtype="closed_pocket",
                        face_ids=[fid] + wall_faces,
                        floor_face_id=fid,
                        wall_face_ids=wall_faces,
                        center=list(face["center"]),
                        area=face.get("area", 0),
                        dimensions={"z_bottom": z_level},
                        confidence=0.9,
                    )
                )
            elif has_convex_wall_down and not has_concave_wall_up:
                # Top face
                planar_features.append(
                    CamFeature(
                        feature_type="face",
                        subtype="top_face",
                        face_ids=[fid],
                        center=list(face["center"]),
                        area=face.get("area", 0),
                        dimensions={"z_top": z_level},
                        confidence=0.9,
                    )
                )
            elif has_concave_wall_up and has_convex_wall_down:
                # Step / terrace
                planar_features.append(
                    CamFeature(
                        feature_type="step",
                        subtype="open_step",
                        face_ids=[fid] + wall_faces,
                        floor_face_id=fid,
                        wall_face_ids=wall_faces,
                        center=list(face["center"]),
                        area=face.get("area", 0),
                        dimensions={"z_bottom": z_level},
                        confidence=0.8,
                    )
                )

        # Consolidate duplicate planar features sharing same Z-height and boundary (area)
        seen = set()
        for feat in planar_features:
            z_top = feat.dimensions.get("z_top")
            z_bottom = feat.dimensions.get("z_bottom")
            z_val = z_top if z_top is not None else z_bottom
            if z_val is None:
                z_val = 0.0
                
            key = (feat.type, round(z_val, 4), round(feat.area, 2))
            if key not in seen:
                seen.add(key)
                self.features.append(feat)

    # ------------------------------------------------------------------
    # Outer profile (intent only — geometry extracted by GeometryMapper)
    # ------------------------------------------------------------------

    def _find_outer_profile(self) -> None:
        """
        Record that the model has an outer profile contour.
        Extract the outer wire from the setup-facing face with largest valid area.
        """
        try:
            bbox = self.shape_bbox()
            md = self.machining_direction
            
            # Find the largest setup-facing planar face
            largest_face = None
            max_area = 0.0
            largest_face_id = None
            
            for fid, face in self.extractor.faces.items():
                if face["type"] == "plane":
                    n = face.get("normal", (0, 0, 0))
                    dot = n[0] * md[0] + n[1] * md[1] + n[2] * md[2]
                    if dot > 0.999:
                        area = face.get("area", 0.0)
                        if area > max_area:
                            max_area = area
                            largest_face = face
                            largest_face_id = fid

            if not largest_face:
                return

            # Extract the actual outer wire
            wire_id, boundary_points = self.extractor.extract_outer_wire(largest_face_id)
            
            # Since we got points back from extract_outer_wire, it means there is a wire
            # and the first/last point check can tell us if it's closed
            is_closed = False
            if boundary_points and len(boundary_points) >= 3:
                import math
                dist = math.hypot(
                    boundary_points[0][0] - boundary_points[-1][0], 
                    boundary_points[0][1] - boundary_points[-1][1]
                )
                is_closed = dist < 1e-3
            
            if not is_closed or len(boundary_points) < 3:
                return
                
            center = [
                round(sum(p[0] for p in boundary_points) / len(boundary_points), 6),
                round(sum(p[1] for p in boundary_points) / len(boundary_points), 6),
                round(sum(p[2] for p in boundary_points) / len(boundary_points), 6),
            ]
            
            z_top = largest_face.get("location", [0,0,0])[2]
            
            self.features.append(
                CamFeature(
                    feature_type="contour",
                    subtype="outer_profile",
                    face_ids=[largest_face_id],
                    center=center,
                    dimensions={
                        "width": round(bbox["max"][0] - bbox["min"][0], 6),
                        "length": round(bbox["max"][1] - bbox["min"][1], 6),
                        "depth": round(bbox["max"][2] - bbox["min"][2], 6),
                        "z_top": z_top,
                        "z_bottom": bbox["min"][2],
                    },
                    confidence=1.0,
                )
            )
            # Attach boundary info for geometry mapper
            self.features[-1].boundaryPoints = boundary_points
            self.features[-1].wireId = wire_id
            self.features[-1].source = "outer_wire"
            self.features[-1].boundaryClosed = is_closed
            self.features[-1].area = max_area
        except Exception as e:
            print(f"Error in outer profile extraction: {e}")
            pass

    def shape_bbox(self) -> Dict[str, Any]:
        """Return serialisable bounding box of the shape."""
        bb = self.extractor.shape.bounding_box()
        return {
            "min": [bb.min.X, bb.min.Y, bb.min.Z],
            "max": [bb.max.X, bb.max.Y, bb.max.Z],
        }

    # ------------------------------------------------------------------
    # Feature Cleanup
    # ------------------------------------------------------------------

    def _cleanup_features(self) -> None:
        """
        Merge duplicate/split cylindrical features and classify them properly.
        """
        import math
        
        cleaned = []
        cylindrical_features = []
        planar_features = []
        
        for f in self.features:
            if f.type in ("hole", "external_cylinder", "boss", "side_protrusion", "shaft", "turned_od"):
                cylindrical_features.append(f)
            else:
                planar_features.append(f)
                
        # Group cylindrical features by axis and centerline
        groups = []
        
        def is_same_line(p1, v1, p2, v2, tol=1e-3):
            # Check parallel
            dot = sum(a * b for a, b in zip(v1, v2))
            if abs(abs(dot) - 1.0) > 1e-3:
                return False
                
            # Check distance between lines
            dp = [p2[i] - p1[i] for i in range(3)]
            dp_dot_v1 = sum(dp[i] * v1[i] for i in range(3))
            perp = [dp[i] - dp_dot_v1 * v1[i] for i in range(3)]
            dist = math.sqrt(sum(x*x for x in perp))
            return dist < tol

        for f in cylindrical_features:
            placed = False
            for g in groups:
                rep = g[0]
                if is_same_line(f.center, f.axis, rep.center, rep.axis):
                    r1 = f.dimensions.get("diameter", 0) / 2
                    r2 = rep.dimensions.get("diameter", 0) / 2
                    if abs(r1 - r2) < 0.1:
                        # Check for shared edges (adjacency)
                        shared_edges = set(f.edge_ids).intersection(set(rep.edge_ids))
                        
                        # Calculate axial overlap
                        v_axis = rep.axis
                        d_axial = abs(sum((f.center[i] - rep.center[i]) * v_axis[i] for i in range(3)))
                        
                        l1 = f.dimensions.get("height", f.dimensions.get("depth", 0))
                        l2 = rep.dimensions.get("height", rep.dimensions.get("depth", 0))
                        
                        # 1mm tolerance for axial touching
                        is_overlapping = d_axial <= (l1 + l2) / 2 + 1.0
                        
                        if shared_edges or is_overlapping:
                            g.append(f)
                            placed = True
                            break
            if not placed:
                groups.append([f])
                
        for group in groups:
            rep = group[0]
            
            # Skip tiny fillet cylinders
            total_area = sum(f.area for f in group)
            total_length = sum(f.dimensions.get("height", f.dimensions.get("depth", 0)) for f in group)
            avg_radius = sum(f.dimensions.get("diameter", 0) / 2 for f in group) / len(group)
            
            if total_area < 5.0 or total_length < 0.5 or avg_radius < 0.1:
                continue
                
            # Merge fields
            merged_face_ids = []
            merged_edge_ids = []
            valid_floor = None
            for f in group:
                merged_face_ids.extend(f.face_ids)
                merged_edge_ids.extend(f.edge_ids)
                if f.floor_face_id:
                    valid_floor = f.floor_face_id
                
            rep.face_ids = list(set(merged_face_ids))
            rep.edge_ids = list(set(merged_edge_ids))
            rep.area = total_area
            rep.centerline = rep.center
            rep.radius = rep.dimensions.get("diameter", 0) / 2
            rep.length = sum(f.dimensions.get("height", f.dimensions.get("depth", 0)) for f in group)
            rep.featureGroupId = f"group_{rep.id}"
            
            # Determine classification
            is_hole = any(f.type == "hole" for f in group)
            
            axis_dot = abs(sum(a * b for a, b in zip(rep.axis, self.machining_direction)))
            is_z_aligned = axis_dot > 0.98
            
            if is_hole:
                rep.type = "hole"
            elif not is_hole:
                # Floor detection for external cylinders
                floor_face_id = None
                
                if is_z_aligned:
                    # Find maximum Z of the cylinder to ensure floor is below it
                    # We compute Z levels along the machining direction
                    cyl_z_levels = []
                    for fid in rep.face_ids:
                        f_info = self.extractor.faces.get(fid, {})
                        if "bbox" in f_info:
                            bb = f_info["bbox"]
                            # Convert bounding box to machining direction (dot product roughly matches Z if 0,0,1)
                            # Actually, dot product with machining_direction gives the height.
                            cyl_z_levels.append(bb["min"][2])
                            cyl_z_levels.append(bb["max"][2])
                    
                    cyl_top_z = max(cyl_z_levels) if cyl_z_levels else 0.0
                    
                    for fid in rep.face_ids:
                        adj = self.extractor.adjacency.get(fid, [])
                        for a in adj:
                            adj_f = self.extractor.faces.get(a["adjacent_face"], {})
                            if adj_f.get("type") == "plane":
                                n = adj_f.get("normal", (0, 0, 1))
                                # Convert candidate floor face normal into setup coordinates (dot product)
                                n_dot = sum(x * y for x, y in zip(n, self.machining_direction))
                                if abs(n_dot) > 0.98:
                                    # Convert candidate floor face Z-level into setup coordinates
                                    # For a simple plane, Z is essentially the bounding box Z
                                    pz_min = adj_f.get("bbox", {}).get("min", [0,0,0])[2]
                                    pz_max = adj_f.get("bbox", {}).get("max", [0,0,0])[2]
                                    pz = (pz_min + pz_max) / 2.0
                                    
                                    # Use dot product to see if it's below top
                                    # Since we usually assume machining_direction is +Z, pz < cyl_top_z
                                    if pz < cyl_top_z - 1e-3:
                                        floor_face_id = a["adjacent_face"]
                                        break
                        if floor_face_id:
                            break
                            
                if floor_face_id:
                    rep.type = "boss"
                    rep.subtype = "cylindrical_boss"
                    rep.floor_face_id = floor_face_id
                    rep.parent_face_id_for_boss = floor_face_id
                else:
                    rep.type = "external_cylinder"
                    rep.subtype = "shaft" if is_z_aligned else "side_protrusion"
                rep.machiningStatus = "recognized_but_requires_turning_or_special_strategy"
                rep.blocked_reason = "Vertical shaft requires turning or special multi-axis strategy"
                rep.machinable_in_current_setup = False
            else:
                rep.type = "side_protrusion"
                rep.machiningStatus = "requires_secondary_setup_or_4axis"
                rep.blocked_reason = "Side protrusion requires 4-axis or secondary setup"
                rep.machinable_in_current_setup = False
                
            cleaned.append(rep)
            
        self.features = planar_features + cleaned
