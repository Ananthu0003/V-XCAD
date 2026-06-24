"""
CamFeatureRecognition — Topology-driven manufacturing feature recognition.

This module identifies machining *intent* (hole, pocket, contour, face, step)
from B-Rep topology.  It does NOT generate geometry, contours, or toolpaths.

Geometry extraction is the responsibility of GeometryMapper.
"""
import uuid
import math
from typing import List, Dict, Any, Optional
from app.services.step_importer import StepImporter
from app.services.topology_extractor import TopologyExtractor


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

    def recognize_features(self, step_file_path: str) -> List[Dict[str, Any]]:
        """
        Analyse a STEP file and return recognised features.

        Returns list of dicts with stable topology IDs and dimension metadata.
        No OCC objects in output.
        """
        import time

        start_time = time.time()
        self.features = []

        try:
            # Import and heal
            shape, metadata = StepImporter.load_and_heal(step_file_path)

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
            print(f"Feature recognition failed: {e}")

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

            for a in adj:
                adj_f = self.extractor.faces.get(a["adjacent_face"], {})
                if adj_f.get("type") == "plane" and a["transition"] == "concave":
                    has_planar_bottom = True
                elif adj_f.get("type") == "cone" and a["transition"] == "tangent":
                    has_conical_bottom = True

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

            self.features.append(
                CamFeature(
                    feature_type="hole",
                    subtype=subtype,
                    face_ids=[fid],
                    cylinder_face_id=fid,
                    center=list(face.get("location", (0, 0, 0))),
                    axis=list(face.get("axis", (0, 0, 1))),
                    area=face.get("area", 0),
                    dimensions={"diameter": round(radius * 2, 6), "depth": depth},
                    confidence=0.95,
                )
            )

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

            self.features.append(
                CamFeature(
                    feature_type="boss",
                    subtype="cylindrical_boss",
                    face_ids=[fid],
                    cylinder_face_id=fid,
                    center=list(face.get("location", (0, 0, 0))),
                    axis=list(face.get("axis", (0, 0, 1))),
                    area=face.get("area", 0),
                    dimensions={"diameter": round(radius * 2, 6), "height": height},
                    confidence=0.90,
                )
            )

    # ------------------------------------------------------------------
    # Planar feature detection (pockets, faces, steps)
    # ------------------------------------------------------------------

    def _find_planar_features(self) -> None:
        md = self.machining_direction

        for fid, face in self.extractor.faces.items():
            if face["type"] != "plane":
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
                self.features.append(
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
                self.features.append(
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
                self.features.append(
                    CamFeature(
                        feature_type="step",
                        subtype="terrace",
                        face_ids=[fid] + wall_faces,
                        floor_face_id=fid,
                        wall_face_ids=wall_faces,
                        center=list(face["center"]),
                        area=face.get("area", 0),
                        dimensions={"z_level": z_level},
                        confidence=0.8,
                    )
                )

    # ------------------------------------------------------------------
    # Outer profile (intent only — geometry extracted by GeometryMapper)
    # ------------------------------------------------------------------

    def _find_outer_profile(self) -> None:
        """
        Record that the model has an outer profile contour.

        Does NOT extract wire geometry or use Shapely.
        Actual silhouette extraction happens in GeometryMapper using the
        WCS machining plane.
        """
        try:
            bbox = self.shape_bbox()
            center = [
                round((bbox["min"][0] + bbox["max"][0]) / 2, 6),
                round((bbox["min"][1] + bbox["max"][1]) / 2, 6),
                round((bbox["min"][2] + bbox["max"][2]) / 2, 6),
            ]

            # Collect all top-facing planar face IDs as boundary references
            boundary_face_ids = []
            for fid, face in self.extractor.faces.items():
                if face["type"] == "plane":
                    n = face.get("normal", (0, 0, 0))
                    md = self.machining_direction
                    dot = abs(n[0] * md[0] + n[1] * md[1] + n[2] * md[2])
                    if dot > 0.999:
                        boundary_face_ids.append(fid)

            self.features.append(
                CamFeature(
                    feature_type="contour",
                    subtype="outer_profile",
                    face_ids=boundary_face_ids,
                    center=center,
                    dimensions={
                        "width": round(bbox["max"][0] - bbox["min"][0], 6),
                        "length": round(bbox["max"][1] - bbox["min"][1], 6),
                        "depth": round(bbox["max"][2] - bbox["min"][2], 6),
                        "z_top": bbox["max"][2],
                        "z_bottom": bbox["min"][2],
                    },
                    confidence=1.0,
                )
            )
        except Exception:
            pass

    def shape_bbox(self) -> Dict[str, Any]:
        """Return serialisable bounding box of the shape."""
        bb = self.extractor.shape.bounding_box()
        return {
            "min": (round(bb.min.X, 6), round(bb.min.Y, 6), round(bb.min.Z, 6)),
            "max": (round(bb.max.X, 6), round(bb.max.Y, 6), round(bb.max.Z, 6)),
        }
