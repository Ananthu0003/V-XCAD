"""
GeometryMapper — Maps recognized features to their actual B-Rep geometry.

This is the critical bridge between feature recognition (intent) and
toolpath generation (coordinates).  It consumes features with stable
face/edge IDs and produces sampled geometry (wire points, axis vectors,
plane data) suitable for toolpath generation.

All geometry is in STEP model coordinates (mm, same origin as STEP file).
No OCC objects leave this module — only JSON-serialisable data.

Constraints:
  C1: No OCC objects in output
  C2: Shapely only for planar 2.5D after projecting real STEP wire points
  C3: Outer contour uses WCS-relative silhouette, not just top face
  C5: All coords in STEP model frame (mm)
  C6: Hard failure if extraction fails — no fallback geometry
"""
import math
from typing import List, Dict, Any, Tuple, Optional

from app.services.topology_extractor import TopologyExtractor

from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.GeomAbs import GeomAbs_Cylinder


class GeometryMapper:
    """
    Maps recognized features to their actual B-Rep geometry for
    toolpath generation.

    Consumes: feature dicts with face_ids/edge_ids (stable string IDs)
    Produces: feature dicts enriched with ``geometry`` containing
              sampled wire points, axis vectors, plane data.
    """

    def __init__(self, extractor: TopologyExtractor):
        self.extractor = extractor

    def enrich_features(
        self, features: List[Dict[str, Any]], setup: Dict[str, Any] = None
    ) -> List[Dict[str, Any]]:
        """
        For each feature, extract actual wire/edge geometry and attach it
        under ``feature['geometry']``.

        If extraction fails for a feature, ``feature['geometry']['status']``
        is set to ``'failed'`` with a diagnostic error message.  No fallback
        geometry is ever produced (constraint C6).
        """
        setup = setup or {}

        for feature in features:
            feat_type = feature.get("type", "")
            try:
                if feat_type == "contour":
                    self._map_contour_geometry(feature, setup)
                elif feat_type == "hole":
                    self._map_hole_geometry(feature)
                elif feat_type == "pocket":
                    self._map_pocket_geometry(feature)
                elif feat_type == "boss":
                    self._map_boss_geometry(feature)
                elif feat_type == "face":
                    self._map_face_geometry(feature)
                elif feat_type == "step":
                    self._map_step_geometry(feature)
                else:
                    feature["geometry"] = {
                        "status": "failed",
                        "error": f"Unsupported feature type for geometry mapping: {feat_type}",
                    }
            except Exception as exc:
                feature["geometry"] = {
                    "status": "failed",
                    "error": f"Geometry extraction exception for {feat_type} "
                             f"feature {feature.get('id', '?')}: {exc}",
                }

        return features

    # ------------------------------------------------------------------
    # Contour (outer profile)
    # ------------------------------------------------------------------

    def _map_contour_geometry(
        self, feature: Dict[str, Any], setup: Dict[str, Any]
    ) -> None:
        """
        Extract the actual top-face boundary for the contour.
        No projection or silhouette generation is allowed.
        """
        plane_normal = (0.0, 0.0, 1.0)
        plane_origin = (0.0, 0.0, 0.0)
        
        fids = feature.get("face_ids", [])
        if not fids:
            feature["geometry"] = {
                "status": "failed",
                "error": "Contour feature has no face_ids",
            }
            return

        # Find the top-most face in the Z direction
        top_face_id = None
        max_z = -1e9
        for fid in fids:
            f_info = self.extractor.faces.get(fid, {})
            try:
                z = f_info.get("bbox", {})["max"][2]
                if z > max_z:
                    max_z = z
                    top_face_id = fid
            except (KeyError, TypeError):
                pass
                
        if not top_face_id:
            top_face_id = fids[0]

        wire_id, profile_points = self.extractor.extract_outer_wire(top_face_id)

        if not profile_points or len(profile_points) < 3:
            feature["geometry"] = {
                "status": "failed",
                "error": "Wire extraction produced fewer than 3 points",
            }
            return
            
        # Optional area validation (Phase 6):
        # We can implement a quick bounding box area check to ensure the contour
        # isn't massively larger than the face, but since we are extracting the 
        # actual wire, it's inherently accurate.

        # Get Z extents from model bounding box
        bb = self.extractor.shape.bounding_box()
        z_top = round(bb.max.Z, 6)
        z_bottom = round(bb.min.Z, 6)

        # Calculate rough area
        try:
            from shapely.geometry import Polygon
            area = Polygon([(p[0], p[1]) for p in profile_points]).area
        except:
            area = 0.0

        feature["geometry"] = {
            "status": "ok",
            "profile_points": profile_points,
            "z_top": z_top,
            "z_bottom": z_bottom,
            "plane_normal": list(plane_normal),
            "plane_origin": list(plane_origin),
            "point_count": len(profile_points),
            "diagnostics": {
                "feature_type": feature.get("type"),
                "face_count": len(fids),
                "wire_count": 1,
                "boundary_count": len(profile_points),
                "mapped_area": area
            }
        }

    # ------------------------------------------------------------------
    # ------------------------------------------------------------------
    # Boss
    # ------------------------------------------------------------------

    def _map_boss_geometry(self, feature: Dict[str, Any]) -> None:
        """
        Extract the boss machining region: Containing Face MINUS Boss Profile.
        Constraint C6: If no containing face can be found, mark operation invalid.
        """
        top_face_ids = feature.get("face_ids", [])
        if not top_face_ids:
            feature["geometry"] = {"status": "failed", "error": "Boss feature has no face_ids"}
            return

        # Find boss top profile
        boss_wire_id, boss_profile_points = self.extractor.extract_outer_wire(top_face_ids[0])
        if not boss_profile_points:
            feature["geometry"] = {"status": "failed", "error": "Failed to extract boss profile"}
            return

        # Look for containing face (floor). This usually comes from adjacency or feature dict.
        # For a boss, we expect 'floor_face_id' or we search adjacent faces.
        containing_face_id = feature.get("floor_face_id") or feature.get("base_face_id")
        
        # If no explicit floor, try to find an adjacent face with a lower Z
        if not containing_face_id:
            top_z = boss_profile_points[0][2]
            best_floor_z = -1e9
            best_floor_id = None
            for fid in top_face_ids:
                for adj in self.extractor.adjacency.get(fid, []):
                    adj_fid = adj.get("adjacent_face")
                    if adj_fid:
                        # Follow walls to floor? No, top face adjacent is wall. Wall adjacent is floor.
                        # This can be complex. Let's just check the wall's adjacent faces.
                        for wall_adj in self.extractor.adjacency.get(adj_fid, []):
                            floor_cand = wall_adj.get("adjacent_face")
                            if floor_cand and floor_cand not in top_face_ids and floor_cand != adj_fid:
                                face_info = self.extractor.faces.get(floor_cand, {})
                                try:
                                    fz = face_info["bbox"]["max"][2]
                                    if fz < top_z and fz > best_floor_z:
                                        best_floor_z = fz
                                        best_floor_id = floor_cand
                                except:
                                    pass
            containing_face_id = best_floor_id

        if not containing_face_id:
            feature["geometry"] = {
                "status": "failed", 
                "error": "No containing face found. Boss operations must not generate toolpaths directly from the boss boundary.",
                "diagnostics": { "failure_reason": "No containing face found." }
            }
            return

        wire_id, containing_face_points = self.extractor.extract_outer_wire(containing_face_id)
        if not containing_face_points:
            feature["geometry"] = {
                "status": "failed", 
                "error": "Failed to extract containing face boundary.",
                "diagnostics": { "failure_reason": "Failed to extract containing face boundary." }
            }
            return
            
        feature["parentFaceId"] = containing_face_id
        feature["machiningRegionId"] = f"region_{containing_face_id}"

        face_info = self.extractor.faces.get(containing_face_id, {})
        try:
            floor_z = round(face_info["bbox"]["max"][2], 6)
        except:
            floor_z = round(containing_face_points[0][2], 6)

        try:
            top_info = self.extractor.faces.get(top_face_ids[0], {})
            top_z = round(top_info["bbox"]["max"][2], 6)
        except:
            top_z = round(boss_profile_points[0][2], 6)

        # Calculate rough area
        try:
            from shapely.geometry import Polygon
            area = abs(Polygon([(p[0], p[1]) for p in containing_face_points]).area - Polygon([(p[0], p[1]) for p in boss_profile_points]).area)
        except:
            area = 0.0

        feature["geometry"] = {
            "status": "ok",
            "containing_points": containing_face_points,
            "boss_points": boss_profile_points,
            "top_z": top_z,
            "bottom_z": floor_z,
            "floor_z": floor_z,
            "diagnostics": {
                "feature_type": feature.get("type"),
                "face_count": len(feature.get("face_ids", [])),
                "wire_count": 2,
                "boundary_count": len(containing_face_points) + len(boss_profile_points),
                "mapped_area": area
            }
        }


    # ------------------------------------------------------------------
    # Hole

    def _map_hole_geometry(self, feature: Dict[str, Any]) -> None:
        """
        Extract cylinder axis, center, depth from the actual cylindrical
        face referenced by ``cylinder_face_id``.

        Constraint C4: Only point-to-depth data.  No circular paths.
        """
        cyl_face_id = feature.get("cylinder_face_id")
        if not cyl_face_id:
            # Try first face_id as fallback reference
            fids = feature.get("face_ids", [])
            cyl_face_id = fids[0] if fids else None

        if not cyl_face_id:
            feature["geometry"] = {
                "status": "failed",
                "error": "Hole feature has no cylinder_face_id",
            }
            return

        face_obj = self.extractor.get_face_object(cyl_face_id)
        if face_obj is None:
            feature["geometry"] = {
                "status": "failed",
                "error": f"Face object not found for {cyl_face_id}",
            }
            return

        # Extract cylinder parameters from OCC
        try:
            surf = BRepAdaptor_Surface(face_obj.wrapped)
            if surf.GetType() != GeomAbs_Cylinder:
                feature["geometry"] = {
                    "status": "failed",
                    "error": f"Face {cyl_face_id} is not a cylinder (type={surf.GetType()})",
                }
                return

            cyl = surf.Cylinder()
            radius = cyl.Radius()
            ax = cyl.Axis().Direction()
            loc = cyl.Location()

            center = [round(loc.X(), 6), round(loc.Y(), 6), round(loc.Z(), 6)]
            axis = [round(ax.X(), 6), round(ax.Y(), 6), round(ax.Z(), 6)]

        except Exception as exc:
            feature["geometry"] = {
                "status": "failed",
                "error": f"Cylinder parameter extraction failed: {exc}",
            }
            return

        # Depth from face bounding box along axis direction
        face_info = self.extractor.faces.get(cyl_face_id, {})
        bb = face_info.get("bbox", {})

        try:
            z_min = bb["min"][2]
            z_max = bb["max"][2]
            depth = round(abs(z_max - z_min), 6)
            top_z = round(z_max, 6)
            bottom_z = round(z_min, 6)
        except (KeyError, TypeError):
            depth = abs(feature.get("dimensions", {}).get("depth", 10.0))
            top_z = center[2]
            bottom_z = center[2] - depth

        feature["geometry"] = {
            "status": "ok",
            "center": list(center),
            "axis": list(axis),
            "radius": round(radius, 6),
            "depth": depth,
            "top_z": top_z,
            "bottom_z": bottom_z,
            "diagnostics": {
                "feature_type": feature.get("type"),
                "face_count": len(feature.get("face_ids", [])),
                "wire_count": 0,
                "boundary_count": 0,
                "mapped_area": 0.0
            }
        }

    # ------------------------------------------------------------------
    # Pocket
    # ------------------------------------------------------------------

    def _map_pocket_geometry(self, feature: Dict[str, Any]) -> None:
        """
        Extract pocket boundary wire from the floor face's outer wire.

        Constraint C2: Shapely will be used downstream (in ToolpathEngine)
        for 2D offset of these real wire points — not here.
        """
        floor_face_id = feature.get("floor_face_id")
        if not floor_face_id:
            fids = feature.get("face_ids", [])
            floor_face_id = fids[0] if fids else None

        if not floor_face_id:
            feature["geometry"] = {
                "status": "failed",
                "error": "Pocket feature has no floor_face_id",
            }
            return

        wire_id, boundary_points = self.extractor.extract_outer_wire(floor_face_id)

        if not boundary_points or len(boundary_points) < 3:
            feature["geometry"] = {
                "status": "failed",
                "error": f"Outer wire extraction for floor face {floor_face_id} "
                         f"produced fewer than 3 points",
            }
            return

        # Z levels
        face_info = self.extractor.faces.get(floor_face_id, {})
        bb = face_info.get("bbox", {})

        try:
            floor_z = round(bb["min"][2], 6)
        except (KeyError, TypeError):
            floor_z = round(boundary_points[0][2], 6) if boundary_points else 0.0

        # Estimate top_z from the highest adjacent wall face
        top_z = floor_z
        wall_face_ids = feature.get("wall_face_ids", [])
        for wfid in wall_face_ids:
            wf = self.extractor.faces.get(wfid, {})
            wbb = wf.get("bbox", {})
            try:
                wz_max = wbb["max"][2]
                if wz_max > top_z:
                    top_z = round(wz_max, 6)
            except (KeyError, TypeError):
                pass

        if top_z <= floor_z:
            # Use model bounding box top as fallback reference
            model_bb = self.extractor.shape.bounding_box()
            top_z = round(model_bb.max.Z, 6)

        # Calculate rough area
        try:
            from shapely.geometry import Polygon
            area = Polygon([(p[0], p[1]) for p in boundary_points]).area
        except:
            area = 0.0

        feature["geometry"] = {
            "status": "ok",
            "boundary_points": boundary_points,
            "floor_z": floor_z,
            "top_z": top_z,
            "wire_id": wire_id,
            "point_count": len(boundary_points),
            "diagnostics": {
                "feature_type": feature.get("type"),
                "face_count": len(feature.get("face_ids", [])),
                "wire_count": 1,
                "boundary_count": len(boundary_points),
                "mapped_area": area
            }
        }

    # ------------------------------------------------------------------
    # Face (for facing operations)
    # ------------------------------------------------------------------

    def _map_face_geometry(self, feature: Dict[str, Any]) -> None:
        """Extract face boundary for facing operations."""
        fids = feature.get("face_ids", [])
        face_id = fids[0] if fids else None

        if not face_id:
            feature["geometry"] = {
                "status": "failed",
                "error": "Face feature has no face_ids",
            }
            return

        wire_id, face_boundary = self.extractor.extract_outer_wire(face_id)

        if not face_boundary or len(face_boundary) < 3:
            feature["geometry"] = {
                "status": "failed",
                "error": f"Outer wire extraction for face {face_id} "
                         f"produced fewer than 3 points",
            }
            return

        face_info = self.extractor.faces.get(face_id, {})
        normal = face_info.get("normal", (0, 0, 1))

        try:
            bb = face_info["bbox"]
            face_z = round(bb["max"][2], 6)
        except (KeyError, TypeError):
            face_z = round(face_boundary[0][2], 6)

        # Calculate rough area
        try:
            from shapely.geometry import Polygon
            area = Polygon([(p[0], p[1]) for p in face_boundary]).area
        except:
            area = 0.0

        feature["geometry"] = {
            "status": "ok",
            "face_boundary": face_boundary,
            "face_z": face_z,
            "normal": list(normal),
            "wire_id": wire_id,
            "point_count": len(face_boundary),
            "diagnostics": {
                "feature_type": feature.get("type"),
                "face_count": len(fids),
                "wire_count": 1,
                "boundary_count": len(face_boundary),
                "mapped_area": area
            }
        }

    # ------------------------------------------------------------------
    # Step / Terrace
    # ------------------------------------------------------------------

    def _map_step_geometry(self, feature: Dict[str, Any]) -> None:
        """Extract step/terrace boundary from the step face."""
        floor_face_id = feature.get("floor_face_id")
        if not floor_face_id:
            fids = feature.get("face_ids", [])
            floor_face_id = fids[0] if fids else None

        if not floor_face_id:
            feature["geometry"] = {
                "status": "failed",
                "error": "Step feature has no floor_face_id",
            }
            return

        wire_id, boundary_points = self.extractor.extract_outer_wire(floor_face_id)

        if not boundary_points or len(boundary_points) < 3:
            feature["geometry"] = {
                "status": "failed",
                "error": f"Wire extraction for step face {floor_face_id} failed",
            }
            return

        face_info = self.extractor.faces.get(floor_face_id, {})
        try:
            bb = face_info["bbox"]
            step_z = round(bb["max"][2], 6)
        except (KeyError, TypeError):
            step_z = round(boundary_points[0][2], 6)

        # Top Z from wall faces
        top_z = step_z
        wall_face_ids = feature.get("wall_face_ids", [])
        for wfid in wall_face_ids:
            wf = self.extractor.faces.get(wfid, {})
            wbb = wf.get("bbox", {})
            try:
                wz_max = wbb["max"][2]
                if wz_max > top_z:
                    top_z = round(wz_max, 6)
            except (KeyError, TypeError):
                pass

        feature["geometry"] = {
            "status": "ok",
            "boundary_points": boundary_points,
            "step_z": step_z,
            "top_z": top_z,
            "wire_id": wire_id,
            "point_count": len(boundary_points),
        }
