"""
TopologyExtractor — B-Rep topology analysis with stable IDs and geometry sampling.

All OCC/build123d objects are kept internal.  Public-facing data consists of
stable string IDs, sampled coordinate tuples, axis vectors, and scalar metadata.
"""
import math
import build123d as bd
from typing import Dict, List, Any, Tuple, Optional

from OCP.BRepAdaptor import BRepAdaptor_Surface, BRepAdaptor_Curve
from OCP.GeomAbs import (
    GeomAbs_Plane, GeomAbs_Cylinder, GeomAbs_Cone, GeomAbs_Sphere,
    GeomAbs_Torus, GeomAbs_BezierSurface, GeomAbs_BSplineSurface,
    GeomAbs_Line, GeomAbs_Circle, GeomAbs_Ellipse, GeomAbs_BSplineCurve,
    GeomAbs_BezierCurve,
)
from OCP.TopExp import TopExp
from OCP.TopTools import TopTools_IndexedDataMapOfShapeListOfShape
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE
from OCP.BRepTools import BRepTools_WireExplorer
from OCP.BRep import BRep_Tool
from OCP.TopoDS import TopoDS


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
_SAMPLE_INTERVAL_MM = 0.5      # 1 point per 0.5 mm of edge length
_MAX_POINTS_PER_EDGE = 200
_MIN_POINTS_PER_EDGE = 2


class TopologyExtractor:
    """
    Extracts and classifies all faces, edges, wires, and adjacency from
    a build123d Shape.  Provides sampling utilities for wire/edge geometry.

    Stable IDs
    ----------
    Every face gets ``face_<N>`` and every edge gets ``edge_<N>`` where *N*
    is a deterministic counter based on enumeration order of the OCC shape.
    These IDs are session-stable and safe for API responses.
    """

    def __init__(self, shape: bd.Shape):
        self.shape = shape
        self.faces: Dict[str, Dict[str, Any]] = {}
        self.edges: Dict[str, Dict[str, Any]] = {}
        self.adjacency: Dict[str, List[Dict[str, Any]]] = {}

        # Internal OCC-object lookup — never serialised
        self._face_obj_map: Dict[str, bd.Face] = {}
        self._edge_obj_map: Dict[str, bd.Edge] = {}
        self._occ_to_stable_face: Dict[int, str] = {}
        self._occ_to_stable_edge: Dict[int, str] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def extract_all(self) -> None:
        """Run the full extraction pipeline."""
        self._classify_surfaces()
        self._classify_edges()
        self._build_adjacency_graph()

    # ------------------------------------------------------------------
    # Stable ID helpers
    # ------------------------------------------------------------------

    def _face_id(self, idx: int) -> str:
        return f"face_{idx}"

    def _edge_id(self, idx: int) -> str:
        return f"edge_{idx}"

    def _occ_hash(self, topo_obj) -> int:
        """Return a Python-session-stable hash for an OCC wrapped pointer."""
        return id(topo_obj.wrapped)

    # ------------------------------------------------------------------
    # Face classification
    # ------------------------------------------------------------------

    def _classify_surfaces(self) -> None:
        faces = self.shape.faces()
        for idx, f in enumerate(faces):
            fid = self._face_id(idx)
            occ_key = self._occ_hash(f)
            self._occ_to_stable_face[occ_key] = fid
            self._face_obj_map[fid] = f

            surf = BRepAdaptor_Surface(f.wrapped)
            stype = surf.GetType()

            info: Dict[str, Any] = {
                "id": fid,
                "area": f.area,
                "center": (round(f.center().X, 6), round(f.center().Y, 6), round(f.center().Z, 6)),
                "is_outer": False,
            }

            # Bounding box as serialisable dict
            bb = f.bounding_box()
            info["bbox"] = {
                "min": (round(bb.min.X, 6), round(bb.min.Y, 6), round(bb.min.Z, 6)),
                "max": (round(bb.max.X, 6), round(bb.max.Y, 6), round(bb.max.Z, 6)),
            }

            if stype == GeomAbs_Plane:
                info["type"] = "plane"
                try:
                    n = f.normal_at(f.center())
                    info["normal"] = (round(n.X, 6), round(n.Y, 6), round(n.Z, 6))
                except Exception:
                    info["normal"] = (0, 0, 0)

            elif stype == GeomAbs_Cylinder:
                info["type"] = "cylinder"
                try:
                    cyl = surf.Cylinder()
                    info["radius"] = round(cyl.Radius(), 6)
                    ax = cyl.Axis().Direction()
                    info["axis"] = (round(ax.X(), 6), round(ax.Y(), 6), round(ax.Z(), 6))
                    loc = cyl.Location()
                    info["location"] = (round(loc.X(), 6), round(loc.Y(), 6), round(loc.Z(), 6))
                except Exception:
                    info["radius"] = 0
                    info["axis"] = (0, 0, 1)
                    info["location"] = (0, 0, 0)

            elif stype == GeomAbs_Cone:
                info["type"] = "cone"
            elif stype == GeomAbs_Sphere:
                info["type"] = "sphere"
            elif stype == GeomAbs_Torus:
                info["type"] = "torus"
            elif stype in (GeomAbs_BezierSurface, GeomAbs_BSplineSurface):
                info["type"] = "bspline"
            else:
                info["type"] = "unknown"

            # Wire metadata (IDs + lengths — no OCC objects)
            wires_meta: List[Dict[str, Any]] = []
            if hasattr(f, "wires"):
                for wi, w in enumerate(f.wires()):
                    try:
                        wires_meta.append({
                            "id": f"{fid}_wire_{wi}",
                            "length": round(w.length, 6),
                        })
                    except Exception:
                        pass
            info["wires"] = wires_meta

            self.faces[fid] = info
            self.adjacency[fid] = []

    # ------------------------------------------------------------------
    # Edge classification
    # ------------------------------------------------------------------

    def _classify_edges(self) -> None:
        edges = self.shape.edges()
        for idx, e in enumerate(edges):
            eid = self._edge_id(idx)
            occ_key = self._occ_hash(e)
            self._occ_to_stable_edge[occ_key] = eid
            self._edge_obj_map[eid] = e

            info: Dict[str, Any] = {
                "id": eid,
                "length": round(e.length, 6),
            }

            try:
                info.update(self.classify_edge_geometry(e))
            except Exception:
                info["geom_type"] = "unknown"

            self.edges[eid] = info

    # ------------------------------------------------------------------
    # Adjacency graph
    # ------------------------------------------------------------------

    def _build_adjacency_graph(self) -> None:
        edge_to_faces = TopTools_IndexedDataMapOfShapeListOfShape()
        TopExp.MapShapesAndAncestors_s(
            self.shape.wrapped, TopAbs_EDGE, TopAbs_FACE, edge_to_faces
        )

        for i in range(1, edge_to_faces.Extent() + 1):
            edge_occ = edge_to_faces.FindKey(i)
            faces_ocp = edge_to_faces.FindFromIndex(i)

            if faces_ocp.Extent() != 2:
                continue

            f1 = bd.Face(faces_ocp.First())
            f2 = bd.Face(faces_ocp.Last())
            edge = bd.Edge(edge_occ)

            fid1 = self._occ_to_stable_face.get(self._occ_hash(f1))
            fid2 = self._occ_to_stable_face.get(self._occ_hash(f2))
            eid = self._occ_to_stable_edge.get(self._occ_hash(edge))

            if not fid1 or not fid2:
                continue

            # Convexity
            transition = "unknown"
            try:
                pt = edge.position_at(0.5)
                n1 = f1.normal_at(pt)
                n2 = f2.normal_at(pt)
                tangent_vec = edge.tangent_at(0.5)

                dot = max(-1.0, min(1.0, n1.dot(n2)))
                angle = math.acos(dot)

                if angle < 1e-3:
                    transition = "tangent"
                else:
                    cross = n1.cross(n2)
                    if cross.dot(tangent_vec) > 0:
                        transition = "convex"
                    else:
                        transition = "concave"
            except Exception:
                pass

            edge_info = {
                "edge_id": eid or f"edge_adj_{i}",
                "transition": transition,
            }

            self.adjacency[fid1].append({"adjacent_face": fid2, **edge_info})
            self.adjacency[fid2].append({"adjacent_face": fid1, **edge_info})

    # ==================================================================
    # Geometry sampling utilities
    # ==================================================================

    @staticmethod
    def classify_edge_geometry(edge: bd.Edge) -> Dict[str, Any]:
        """
        Classify an edge's underlying curve and return native parameters.

        Returns dict with keys: geom_type, and type-specific data
        (center, radius, start/end for arcs, etc.).
        """
        adaptor = BRepAdaptor_Curve(edge.wrapped)
        ctype = adaptor.GetType()

        result: Dict[str, Any] = {}

        if ctype == GeomAbs_Line:
            result["geom_type"] = "line"
            p1 = edge.position_at(0)
            p2 = edge.position_at(1)
            result["start"] = (round(p1.X, 6), round(p1.Y, 6), round(p1.Z, 6))
            result["end"] = (round(p2.X, 6), round(p2.Y, 6), round(p2.Z, 6))

        elif ctype == GeomAbs_Circle:
            result["geom_type"] = "circle"
            circ = adaptor.Circle()
            c = circ.Location()
            result["center"] = (round(c.X(), 6), round(c.Y(), 6), round(c.Z(), 6))
            result["radius"] = round(circ.Radius(), 6)
            ax = circ.Axis().Direction()
            result["axis"] = (round(ax.X(), 6), round(ax.Y(), 6), round(ax.Z(), 6))
            p1 = edge.position_at(0)
            p2 = edge.position_at(1)
            result["start"] = (round(p1.X, 6), round(p1.Y, 6), round(p1.Z, 6))
            result["end"] = (round(p2.X, 6), round(p2.Y, 6), round(p2.Z, 6))

        elif ctype == GeomAbs_Ellipse:
            result["geom_type"] = "ellipse"

        elif ctype in (GeomAbs_BSplineCurve, GeomAbs_BezierCurve):
            result["geom_type"] = "bspline"

        else:
            result["geom_type"] = "other"

        return result

    def sample_edge_points(
        self, edge: bd.Edge, interval_mm: float = _SAMPLE_INTERVAL_MM
    ) -> List[Tuple[float, float, float]]:
        """
        Sample an edge at adaptive intervals based on geometry type.
        Returns ordered list of (x, y, z) tuples in model coordinates.
        """
        length = edge.length
        if length < 1e-9:
            return []
            
        geom_info = self.classify_edge_geometry(edge)
        geom_type = geom_info.get("geom_type", "unknown")
        
        # Phase 7: Optimization - Straight lines only need start and end points
        if geom_type == "line":
            return [geom_info["start"], geom_info["end"]]
            
        # Arc preservation: use a larger interval for smooth arcs/circles, but ensure a minimum of ~36 points per full circle.
        if geom_type in ("circle", "ellipse"):
            # Default to 4x standard interval or 2.0mm, but cap it so we get at least 36 segments for the perimeter
            base_interval = max(2.0, interval_mm * 4)
            arc_interval = max(0.01, length / 36.0)
            interval_mm = min(base_interval, arc_interval)

        n_pts = max(_MIN_POINTS_PER_EDGE, min(_MAX_POINTS_PER_EDGE, int(length / interval_mm) + 1))
        points = []
        for i in range(n_pts):
            t = i / max(1, n_pts - 1)
            try:
                pt = edge.position_at(t)
                points.append((round(pt.X, 6), round(pt.Y, 6), round(pt.Z, 6)))
            except Exception:
                pass
        return points

    def extract_wire_points(
        self, wire_obj: bd.Wire
    ) -> List[Tuple[float, float, float]]:
        """
        Walk a wire's edges in topological order using BRepTools_WireExplorer
        and sample actual 3D coordinates.  Returns an ordered point list.
        """
        explorer = BRepTools_WireExplorer(wire_obj.wrapped)
        all_points: List[Tuple[float, float, float]] = []

        while explorer.More():
            edge = bd.Edge(explorer.Current())
            pts = self.sample_edge_points(edge)

            # Avoid duplicating the junction point between consecutive edges
            if all_points and pts and len(all_points) > 0:
                last = all_points[-1]
                first_new = pts[0]
                dist = math.sqrt(sum((a - b) ** 2 for a, b in zip(last, first_new)))
                if dist < 0.01:
                    pts = pts[1:]

            all_points.extend(pts)
            explorer.Next()

        return all_points

    def extract_outer_wire(
        self, face_id: str
    ) -> Tuple[Optional[str], List[Tuple[float, float, float]]]:
        """
        Extract the outer wire of a face (the wire with the largest bounding
        box diagonal).

        Returns (wire_id, sampled_points).  Returns (None, []) if the face
        has no wires or extraction fails.
        """
        face_obj = self._face_obj_map.get(face_id)
        if face_obj is None:
            return None, []

        wires = []
        try:
            for w in face_obj.wires():
                bb = w.bounding_box()
                diag = math.sqrt(
                    (bb.max.X - bb.min.X) ** 2
                    + (bb.max.Y - bb.min.Y) ** 2
                    + (bb.max.Z - bb.min.Z) ** 2
                )
                wires.append((w, diag))
        except Exception:
            return None, []

        if not wires:
            return None, []

        # Outer wire = largest bounding diagonal
        outer_wire_obj = max(wires, key=lambda x: x[1])[0]
        points = self.extract_wire_points(outer_wire_obj)

        # Find wire id from face metadata
        face_info = self.faces.get(face_id, {})
        wire_id = face_info.get("wires", [{}])[0].get("id") if face_info.get("wires") else None

        return wire_id, points

    def extract_face_wire_points(
        self, face_id: str
    ) -> List[List[Tuple[float, float, float]]]:
        """
        Extract ALL wires of a face as separate point lists.
        First wire is the outer boundary, subsequent wires are holes/islands.
        """
        face_obj = self._face_obj_map.get(face_id)
        if face_obj is None:
            return []

        result = []
        try:
            wires_with_diag = []
            for w in face_obj.wires():
                bb = w.bounding_box()
                diag = math.sqrt(
                    (bb.max.X - bb.min.X) ** 2
                    + (bb.max.Y - bb.min.Y) ** 2
                    + (bb.max.Z - bb.min.Z) ** 2
                )
                wires_with_diag.append((w, diag))

            # Sort: largest (outer) first
            wires_with_diag.sort(key=lambda x: -x[1])

            for w, _ in wires_with_diag:
                pts = self.extract_wire_points(w)
                if pts:
                    result.append(pts)
        except Exception:
            pass

        return result



    # ------------------------------------------------------------------
    # Internal object access (for GeometryMapper — never crosses API)
    # ------------------------------------------------------------------

    def get_face_object(self, face_id: str) -> Optional[bd.Face]:
        """Return the internal build123d Face object.  Backend use only."""
        return self._face_obj_map.get(face_id)

    def get_edge_object(self, edge_id: str) -> Optional[bd.Edge]:
        """Return the internal build123d Edge object.  Backend use only."""
        return self._edge_obj_map.get(edge_id)
