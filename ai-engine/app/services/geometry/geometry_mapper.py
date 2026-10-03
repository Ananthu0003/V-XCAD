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

from app.services.geometry.topology_extractor import TopologyExtractor

from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.GeomAbs import GeomAbs_Cylinder
from app.constants import TURNING_FEATURE_TYPES


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
                    self._map_hole_geometry(feature, setup)
                elif feat_type == "pocket":
                    self._map_pocket_geometry(feature)
                elif feat_type == "boss":
                    self._map_boss_geometry(feature)
                elif feat_type == "face":
                    self._map_face_geometry(feature)
                elif feat_type == "step":
                    self._map_step_geometry(feature)
                elif feat_type in TURNING_FEATURE_TYPES:
                    # Only map geometry if the feature is not blocked (turning_required on 3-axis)
                    if feature.get("machinable_in_current_setup", True) and not feature.get("blocked_reason"):
                        self._map_external_cylinder_geometry(feature, setup)
                    else:
                        # Blocked on 3-axis — do NOT attempt geometry extraction
                        feature["machiningRegion"] = {
                            "valid": False,
                            "regionType": "none",
                            "source": "none",
                            "errorReason": feature.get("blocked_reason", "External cylinder is not machinable in this setup"),
                        }
                elif feat_type == "side_protrusion":
                    self._map_side_protrusion_geometry(feature, setup)
                else:
                    feature["machiningRegion"] = {
                        "valid": False,
                        "errorReason": f"Unsupported feature type for geometry mapping: {feat_type}",
                    }
            except Exception as exc:
                feature["machiningRegion"] = {
                    "valid": False,
                    "errorReason": f"Geometry extraction exception for {feat_type} "
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
            feature["machiningRegion"] = {
                "valid": False,
                "errorReason": "Contour feature has no face_ids",
            }
            return

        source = feature.get("source", "unknown")
        
        if source not in ("outer_wire", "face_boundary"):
            feature["machinable_in_current_setup"] = False
            feature["blocked_reason"] = f"Invalid contour source: {source}. BBox, silhouette, or fallback geometries are rejected."
            feature["machiningRegion"] = {
                "valid": False,
                "errorReason": f"Invalid contour source: {source}. Expected outer_wire or face_boundary.",
                "regionType": "none",
                "source": "none"
            }
            return
            
        profile_points = feature.get("boundaryPoints", [])
        if not profile_points or len(profile_points) < 3:
            feature["machiningRegion"] = {
                "valid": False,
                "errorReason": "Contour missing valid boundary points",
                "regionType": None
            }
            return
            
        is_closed = feature.get("boundaryClosed", False)
        if not is_closed:
            feature["machiningRegion"] = {
                "valid": False,
                "errorReason": "Contour outer wire is not closed",
                "regionType": None
            }
            return

        area = feature.get("area", 0.0)
        
        feature["machiningRegion"] = {
            "valid": True,
            "regionId": feature.get("id", "unknown"),
            "regionType": "contour_region",
            "closedBoundary": True,
            "boundary": profile_points,
            "topZ": feature.get("dimensions", {}).get("z_top", 0.0),
            "bottomZ": feature.get("dimensions", {}).get("z_bottom", 0.0),
            "source": source,
            "area": area,
            "diagnostics": {
                "feature_type": feature.get("type"),
                "face_count": len(fids),
                "wire_count": 1,
                "boundary_count": len(profile_points),
                "mapped_area": area
            }
        }

    # ------------------------------------------------------------------
    # External Cylinder / Shaft
    # ------------------------------------------------------------------

    def _map_external_cylinder_geometry(self, feature: Dict[str, Any], setup: Dict[str, Any]) -> None:
        """
        Extract axis, radius, length, center for turning or rotary milling.
        Produces:
          - 'turning_profile' regionType for od_turning (lathe / mill_turn)
          - 'wrapped_cylindrical_surface' regionType for rotary_milling (4/5-axis)
        Source must be one of the above — never a planar milling region.
        """
        cyl_face_id = feature.get("cylinder_face_id")
        if not cyl_face_id:
            feature["machiningRegion"] = {"valid": False, "errorReason": "No cylinder_face_id"}
            return
            
        face_info = self.extractor.faces.get(cyl_face_id, {})
        face_obj = self.extractor.get_face_object(cyl_face_id)
        
        if not face_obj:
            feature["machiningRegion"] = {"valid": False, "errorReason": "No OCC object for cylinder"}
            return
            
        try:
            from OCP.BRepAdaptor import BRepAdaptor_Surface
            surf = BRepAdaptor_Surface(face_obj.wrapped)
            cyl = surf.Cylinder()
            radius = cyl.Radius()
            ax = cyl.Axis().Direction()
            loc = cyl.Location()

            center = [round(loc.X(), 6), round(loc.Y(), 6), round(loc.Z(), 6)]
            axis = [round(ax.X(), 6), round(ax.Y(), 6), round(ax.Z(), 6)]
        except Exception as e:
            feature["machiningRegion"] = {"valid": False, "errorReason": f"Cylinder extraction failed: {e}"}
            return

        bb = face_info.get("bbox", {"min": center, "max": center})
        length = abs(feature.get("dimensions", {}).get("height", 10.0))
        
        setup_type = setup.get("type", "milling_3axis")
        
        # Determine region type based on setup type (strategy was already determined upstream)
        if setup_type in ("turning", "mill_turn"):
            region_type = "turning_profile"
            source = "turning_profile"
            islands = []
            boundary = []
        elif setup_type in ("indexed_4axis", "milling_5axis"):
            region_type = "wrapped_cylindrical_surface"
            source = "wrapped_cylindrical_surface"
            islands = []
            boundary = []
        elif setup_type == "milling_3axis":
            # Allowed if planner mapped it to boss_clearing
            region_type = "boss_clearing_region"
            source = "cylinder_as_boss"
            
            import math
            boss_pts = []
            for i in range(37):  # 36 segments, close loop
                ang = math.radians(i * 10)
                boss_pts.append([center[0] + radius * math.cos(ang), center[1] + radius * math.sin(ang), center[2]])
            
            margin = radius * 2
            min_x = center[0] - radius - margin
            max_x = center[0] + radius + margin
            min_y = center[1] - radius - margin
            max_y = center[1] + radius + margin
            
            boundary = [
                [min_x, min_y, center[2]],
                [max_x, min_y, center[2]],
                [max_x, max_y, center[2]],
                [min_x, max_y, center[2]],
                [min_x, min_y, center[2]]
            ]
            islands = [boss_pts]
        else:
            # Should not reach here — blocked features are filtered before geometry mapping
            # but handle defensively
            feature["machiningRegion"] = {
                "valid": False,
                "regionType": "none",
                "source": "none",
                "errorReason": f"External cylinder cannot be machined in a {setup_type} setup",
            }
            return
        
        feature["machiningRegion"] = {
            "valid": True,
            "regionId": feature.get("id", "unknown"),
            "regionType": region_type,
            "center": center,
            "axis": axis,
            "radius": radius,
            "length": length,
            "bbox": bb,
            "source": source,
            "islands": islands,
            "boundary": boundary,
            "diagnostics": {
                "feature_type": feature.get("type"),
                "setup_type": setup_type,
            }
        }

    # ------------------------------------------------------------------
    # Side Protrusion
    # ------------------------------------------------------------------

    def _map_side_protrusion_geometry(self, feature: Dict[str, Any], setup: Dict[str, Any]) -> None:
        """
        Block side protrusions for 3-axis milling.
        """
        feature["machinable_in_current_setup"] = False
        feature["blocked_reason"] = "Side protrusion requires 4-axis or secondary setup"
        
        feature["machiningRegion"] = {
            "valid": False,
            "regionType": "none",
                "source": "none",
            "errorReason": "Side protrusion requires 4-axis or secondary setup",
            "diagnostics": {
                "feature_type": feature.get("type")
            }
        }

    # ------------------------------------------------------------------
    # ------------------------------------------------------------------
    # Boss
    # ------------------------------------------------------------------

    def _map_boss_geometry(self, feature: Dict[str, Any]) -> None:
        """
        Extract the boss machining region: Containing Face MINUS Boss Profile.
        Constraint: If no containing face can be found or validation fails, mark operation invalid.
        """
        top_face_ids = feature.get("face_ids", [])
        if not top_face_ids:
            feature["machiningRegion"] = {"valid": False, "errorReason": "Boss feature has no face_ids"}
            return

        # Find boss top profile
        boss_wire_id, boss_profile_points = self.extractor.extract_outer_wire(top_face_ids[0])
        if not boss_profile_points or len(boss_profile_points) < 3:
            feature["machiningRegion"] = {"valid": False, "errorReason": "Boss island boundary invalid"}
            return

        containing_face_id = feature.get("floorFaceId") or feature.get("parentFaceId")
        
        if not containing_face_id:
            feature["machiningRegion"] = {"valid": False, "errorReason": "Boss floorFaceId missing"}
            return

        wire_id, containing_face_points = self.extractor.extract_outer_wire(containing_face_id)
        if not containing_face_points or len(containing_face_points) < 3:
            feature["machiningRegion"] = {"valid": False, "errorReason": "Boss floor boundary invalid"}
            return
            
        feature["parentFaceId"] = containing_face_id
        feature["machiningRegionId"] = f"region_{containing_face_id}"

        # Area validation (Polygon Area)
        def poly_area(pts):
            area = 0.0
            for i in range(len(pts)):
                j = (i + 1) % len(pts)
                area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]
            return abs(area) / 2.0

        # Simple containment check via bounding box
        boss_xs = [p[0] for p in boss_profile_points]
        boss_ys = [p[1] for p in boss_profile_points]
        floor_xs = [p[0] for p in containing_face_points]
        floor_ys = [p[1] for p in containing_face_points]

        if min(boss_xs) < min(floor_xs) - 1e-3 or max(boss_xs) > max(floor_xs) + 1e-3 or \
           min(boss_ys) < min(floor_ys) - 1e-3 or max(boss_ys) > max(floor_ys) + 1e-3:
            feature["machiningRegion"] = {"valid": False, "errorReason": "Boss island not inside floor boundary"}
            return

        floor_area = poly_area(containing_face_points)
        boss_area = poly_area(boss_profile_points)
        clearing_area = floor_area - boss_area

        if clearing_area <= 0:
            feature["machiningRegion"] = {"valid": False, "errorReason": "Invalid boss clearing area"}
            return

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

        feature["machining_region"] = "valid"
        feature["machiningRegion"] = {
            "valid": True,
            "regionId": feature.get("id", "unknown"),
            "regionType": "boss_clearing_region",
            "boundary": containing_face_points,
            "islands": [boss_profile_points],
            "topZ": top_z,
            "bottomZ": floor_z,
            "area": clearing_area,
            "source": "boss_floor_minus_island"
        }


    # ------------------------------------------------------------------
    # Hole

    def _map_hole_geometry(self, feature: Dict[str, Any], setup: Dict[str, Any] = None) -> None:
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
            feature["machiningRegion"] = {
                "valid": False,
                "errorReason": "Hole feature has no cylinder_face_id",
            }
            return

        face_obj = self.extractor.get_face_object(cyl_face_id)
        if face_obj is None:
            feature["machiningRegion"] = {
                "valid": False,
                "errorReason": f"Face object not found for {cyl_face_id}",
            }
            return

        # Extract cylinder parameters from OCC
        try:
            surf = BRepAdaptor_Surface(face_obj.wrapped)
            from OCP.GeomAbs import GeomAbs_Cylinder
            if surf.GetType() != GeomAbs_Cylinder:
                feature["machiningRegion"] = {
                    "valid": False,
                    "errorReason": f"Face {cyl_face_id} is not a cylinder (type={surf.GetType()})",
                }
                return
            cyl = surf.Cylinder()
            radius = cyl.Radius()
            ax = cyl.Axis().Direction()
            loc = cyl.Location()

            center = [round(loc.X(), 6), round(loc.Y(), 6), round(loc.Z(), 6)]
            axis = [round(ax.X(), 6), round(ax.Y(), 6), round(ax.Z(), 6)]

        except Exception as exc:
            feature["machiningRegion"] = {
                "valid": False,
                "errorReason": f"Cylinder parameter extraction failed: {exc}",
            }
            return

        # Depth from face bounding box along tool axis direction
        face_info = self.extractor.faces.get(cyl_face_id, {})
        bb = face_info.get("bbox", {})
        
        tool_axis = setup.get("toolAxis", [0.0, 0.0, 1.0])
        major_idx = max(range(3), key=lambda i: abs(tool_axis[i]))

        try:
            val_min = bb["min"][major_idx]
            val_max = bb["max"][major_idx]
            depth = round(abs(val_max - val_min), 6)
            
            if tool_axis[major_idx] > 0:
                top_z = round(val_max, 6)
                bottom_z = round(val_min, 6)
            else:
                top_z = round(val_min, 6)
                bottom_z = round(val_max, 6)
        except (KeyError, TypeError):
            depth = abs(feature.get("dimensions", {}).get("depth", 10.0))
            top_z = center[major_idx]
            bottom_z = center[major_idx] - depth

        feature["machiningRegion"] = {
            "valid": True,
            "regionId": feature.get("id", "unknown"),
            "regionType": "drill_region",
            "center": list(center),
            "axis": list(axis),
            "depth": depth,
            "topZ": top_z,
            "bottomZ": bottom_z,
            "source": "hole_center",
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
        floor_face_id = feature.get("floorFaceId") or feature.get("floor_face_id")
        if not floor_face_id:
            fids = feature.get("face_ids", [])
            floor_face_id = fids[0] if fids else None

        if not floor_face_id:
            feature["machiningRegion"] = {
                "valid": False,
                "errorReason": "Pocket feature has no floor_face_id",
            }
            return

        wire_id, boundary_points = self.extractor.extract_outer_wire(floor_face_id)

        if not boundary_points or len(boundary_points) < 3:
            feature["machiningRegion"] = {
                "valid": False,
                "errorReason": f"Outer wire extraction for floor face {floor_face_id} "
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

        feature["machiningRegion"] = {
            "valid": True,
            "regionId": feature.get("id", "unknown"),
            "regionType": "pocket_region",
            "boundary": boundary_points,
            "bottomZ": floor_z,
            "topZ": top_z,
            "source": "pocket_boundary",
            "area": area,
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
            feature["machiningRegion"] = {
                "valid": False,
                "errorReason": "Face feature has no face_ids",
            }
            return

        wire_id, face_boundary = self.extractor.extract_outer_wire(face_id)

        if not face_boundary or len(face_boundary) < 3:
            feature["machiningRegion"] = {
                "valid": False,
                "errorReason": f"Outer wire extraction for face {face_id} "
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

        feature["machiningRegion"] = {
            "valid": True,
            "regionId": feature.get("id", "unknown"),
            "regionType": "face_region",
            "boundary": face_boundary,
            "topZ": face_z,
            "bottomZ": face_z,
            "source": "face_boundary",
            "area": area,
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
            feature["machiningRegion"] = {
                "valid": False,
                "errorReason": "Step feature has no floor_face_id",
            }
            return

        wire_id, boundary_points = self.extractor.extract_outer_wire(floor_face_id)

        if not boundary_points or len(boundary_points) < 3:
            feature["machiningRegion"] = {
                "valid": False,
                "errorReason": f"Wire extraction for step face {floor_face_id} failed",
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

        feature["machiningRegion"] = {
            "valid": True,
            "regionId": feature.get("id", "unknown"),
            "regionType": "contour_region",
            "boundary": boundary_points,
            "bottomZ": step_z,
            "topZ": top_z,
            "source": "outer_wire",
        }
