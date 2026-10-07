"""Reference Resolver — Multi-stage topological and geometric reference resolver."""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple, Union
import build123d as bd

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
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.TopoDS import TopoDS
from OCP.BRep import BRep_Tool
from OCP.TopLoc import TopLoc_Location
from OCP.BRepMesh import BRepMesh_IncrementalMesh

from app.models.cad_modification import GeometricReference, OperationStatus


def _surface_type_str(surf_type: int) -> str:
    mapping = {
        GeomAbs_Plane: "plane",
        GeomAbs_Cylinder: "cylinder",
        GeomAbs_Cone: "cone",
        GeomAbs_Sphere: "sphere",
        GeomAbs_Torus: "torus",
        GeomAbs_BezierSurface: "bezier",
        GeomAbs_BSplineSurface: "bspline",
    }
    return mapping.get(surf_type, "other")


def _curve_type_str(curve_type: int) -> str:
    mapping = {
        GeomAbs_Line: "line",
        GeomAbs_Circle: "circle",
        GeomAbs_Ellipse: "ellipse",
        GeomAbs_BezierCurve: "bezier",
        GeomAbs_BSplineCurve: "bspline",
    }
    return mapping.get(curve_type, "other")


class ReferenceResolver:
    """
    Resolves persistent GeometricReference contracts against a target TopoDS_Shape / build123d.Shape.
    Prevents silent geometric drift or ambiguous topology references.
    """

    @staticmethod
    def extract_face_reference(face: bd.Face, transient_id: str, ref_id: Optional[str] = None) -> GeometricReference:
        """Extract a full geometric signature from a build123d.Face."""
        occ_face = face.wrapped if hasattr(face, "wrapped") else face
        adaptor = BRepAdaptor_Surface(occ_face)
        stype = _surface_type_str(adaptor.GetType())

        # Centroid & Area
        props = GProp_GProps()
        BRepGProp.SurfaceProperties_s(occ_face, props)
        area = float(props.Mass())
        cog = props.CentreOfMass()
        centroid = [float(cog.X()), float(cog.Y()), float(cog.Z())]

        # Bounding box
        bnd = Bnd_Box()
        BRepBndLib.Add_s(occ_face, bnd)
        xmin, ymin, zmin, xmax, ymax, zmax = bnd.Get()
        bbox = {
            "min": [float(xmin), float(ymin), float(zmin)],
            "max": [float(xmax), float(ymax), float(zmax)]
        }

        normal: Optional[List[float]] = None
        axis: Optional[List[float]] = None
        plane_d: Optional[float] = None
        radius: Optional[float] = None

        try:
            if adaptor.GetType() == GeomAbs_Plane:
                pln = adaptor.Plane()
                pos = pln.Position()
                dir_z = pos.Direction()
                normal = [float(dir_z.X()), float(dir_z.Y()), float(dir_z.Z())]
                plane_d = float(- (normal[0] * pos.Location().X() + normal[1] * pos.Location().Y() + normal[2] * pos.Location().Z()))
            elif adaptor.GetType() == GeomAbs_Cylinder:
                cyl = adaptor.Cylinder()
                radius = float(cyl.Radius())
                axis_dir = cyl.Axis().Direction()
                axis = [float(axis_dir.X()), float(axis_dir.Y()), float(axis_dir.Z())]
            elif adaptor.GetType() == GeomAbs_Cone:
                cone = adaptor.Cone()
                radius = float(cone.RefRadius())
                axis_dir = cone.Axis().Direction()
                axis = [float(axis_dir.X()), float(axis_dir.Y()), float(axis_dir.Z())]
            elif adaptor.GetType() == GeomAbs_Sphere:
                sph = adaptor.Sphere()
                radius = float(sph.Radius())
            elif adaptor.GetType() == GeomAbs_Torus:
                tor = adaptor.Torus()
                radius = float(tor.MajorRadius())
        except Exception:
            pass

        triangles: Optional[List[float]] = None
        boundary_points: List[List[float]] = []

        try:
            loc = TopLoc_Location()
            tri = BRep_Tool.Triangulation_s(occ_face, loc)
            if tri is None or tri.NbTriangles() == 0:
                BRepMesh_IncrementalMesh(occ_face, 0.5)
                tri = BRep_Tool.Triangulation_s(occ_face, loc)

            if tri is not None and tri.NbTriangles() > 0:
                nb_tri = tri.NbTriangles()
                nb_nodes = tri.NbNodes()
                trsf = loc.Transformation()
                nodes = []
                for i in range(1, nb_nodes + 1):
                    p = tri.Node(i)
                    p_t = p.Transformed(trsf)
                    nodes.append([round(float(p_t.X()), 4), round(float(p_t.Y()), 4), round(float(p_t.Z()), 4)])

                tri_coords: List[float] = []
                for i in range(1, nb_tri + 1):
                    t = tri.Triangle(i)
                    n1, n2, n3 = t.Get()
                    p1 = nodes[n1 - 1]
                    p2 = nodes[n2 - 1]
                    p3 = nodes[n3 - 1]
                    tri_coords.extend([p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]])
                triangles = tri_coords
        except Exception:
            triangles = None

        try:
            if hasattr(face, "wires"):
                for wire in face.wires():
                    for edge in wire.edges():
                        for v in edge.vertices():
                            boundary_points.append([round(float(v.X), 4), round(float(v.Y), 4), round(float(v.Z), 4)])
        except Exception:
            pass

        return GeometricReference(
            ref_id=ref_id or f"ref_{transient_id}",
            transient_id=transient_id,
            entity_type="face",
            surface_type=stype,
            normal=normal,
            axis=axis,
            plane_d=plane_d,
            centroid=centroid,
            bounding_box=bbox,
            area=area,
            radius=radius,
            confidence=1.0,
            triangles=triangles,
            boundary_points=boundary_points
        )

    @staticmethod
    def extract_edge_reference(edge: bd.Edge, transient_id: str, ref_id: Optional[str] = None) -> GeometricReference:
        """Extract a full geometric signature from a build123d.Edge."""
        occ_edge = edge.wrapped if hasattr(edge, "wrapped") else edge
        adaptor = BRepAdaptor_Curve(occ_edge)
        ctype = _curve_type_str(adaptor.GetType())

        # Length & Centroid
        props = GProp_GProps()
        BRepGProp.LinearProperties_s(occ_edge, props)
        length = float(props.Mass())
        cog = props.CentreOfMass()
        centroid = [float(cog.X()), float(cog.Y()), float(cog.Z())]

        # Bounding box
        bnd = Bnd_Box()
        BRepBndLib.Add_s(occ_edge, bnd)
        xmin, ymin, zmin, xmax, ymax, zmax = bnd.Get()
        bbox = {
            "min": [float(xmin), float(ymin), float(zmin)],
            "max": [float(xmax), float(ymax), float(zmax)]
        }

        radius: Optional[float] = None
        try:
            if adaptor.GetType() == GeomAbs_Circle:
                circ = adaptor.Circle()
                radius = float(circ.Radius())
            elif adaptor.GetType() == GeomAbs_Ellipse:
                ell = adaptor.Ellipse()
                radius = float(ell.MajorRadius())
        except Exception:
            pass

        return GeometricReference(
            ref_id=ref_id or f"ref_{transient_id}",
            transient_id=transient_id,
            entity_type="edge",
            curve_type=ctype,
            centroid=centroid,
            bounding_box=bbox,
            length=length,
            radius=radius,
            confidence=1.0
        )

    @classmethod
    def resolve_face(
        cls, 
        target_shape: bd.Shape, 
        ref: GeometricReference
    ) -> Tuple[Optional[bd.Face], OperationStatus, str]:
        """
        Multi-stage matching of a face reference against target shape faces.
        Returns (matched_face, status, diagnostic_message).
        """
        all_faces = target_shape.faces()
        if not all_faces:
            return None, OperationStatus.INVALID_REFERENCE, "Target shape has no faces."

        candidates: List[Tuple[bd.Face, float, Dict[str, Any]]] = []

        for idx, f in enumerate(all_faces):
            cand_ref = cls.extract_face_reference(f, f"face_{idx}")
            score = cls._score_face_match(ref, cand_ref)
            candidates.append((f, score, cand_ref.model_dump()))

        # Sort descending by match score
        candidates.sort(key=lambda x: x[1], reverse=True)
        top_cand, top_score, _ = candidates[0]

        if top_score < 0.65:
            return None, OperationStatus.INVALID_REFERENCE, f"No matching face found (top score: {top_score:.2f} < 0.65 threshold)."

        # Check for ambiguity
        if len(candidates) > 1:
            second_cand, second_score, _ = candidates[1]
            if (top_score - second_score) < 0.08 and second_score > 0.75:
                return None, OperationStatus.AMBIGUOUS_REFERENCE, f"Ambiguous reference: multiple matching candidate faces ({top_score:.2f} vs {second_score:.2f})."

        return top_cand, OperationStatus.VALID, "Reference resolved uniquely."

    @classmethod
    def resolve_edge(
        cls, 
        target_shape: bd.Shape, 
        ref: GeometricReference
    ) -> Tuple[Optional[bd.Edge], OperationStatus, str]:
        """
        Multi-stage matching of an edge reference against target shape edges.
        """
        all_edges = target_shape.edges()
        if not all_edges:
            return None, OperationStatus.INVALID_REFERENCE, "Target shape has no edges."

        candidates: List[Tuple[bd.Edge, float, Dict[str, Any]]] = []

        for idx, e in enumerate(all_edges):
            cand_ref = cls.extract_edge_reference(e, f"edge_{idx}")
            score = cls._score_edge_match(ref, cand_ref)
            candidates.append((e, score, cand_ref.model_dump()))

        candidates.sort(key=lambda x: x[1], reverse=True)
        top_cand, top_score, _ = candidates[0]

        if top_score < 0.65:
            return None, OperationStatus.INVALID_REFERENCE, f"No matching edge found (top score: {top_score:.2f} < 0.65 threshold)."

        if len(candidates) > 1:
            second_cand, second_score, _ = candidates[1]
            if (top_score - second_score) < 0.08 and second_score > 0.75:
                return None, OperationStatus.AMBIGUOUS_REFERENCE, f"Ambiguous reference: multiple candidate edges ({top_score:.2f} vs {second_score:.2f})."

        return top_cand, OperationStatus.VALID, "Reference resolved uniquely."

    @staticmethod
    def _score_face_match(target: GeometricReference, cand: GeometricReference) -> float:
        """Calculate weighted composite match score between two face signatures."""
        score = 0.0

        # 1. Surface Type (Weight: 0.25)
        if target.surface_type and cand.surface_type:
            if target.surface_type == cand.surface_type:
                score += 0.25
        else:
            score += 0.15

        # 2. Normal vector alignment for planar surfaces (Weight: 0.25)
        if target.normal and cand.normal:
            dot = (target.normal[0]*cand.normal[0] + 
                   target.normal[1]*cand.normal[1] + 
                   target.normal[2]*cand.normal[2])
            norm_score = max(0.0, dot)
            score += 0.25 * norm_score
        elif target.axis and cand.axis:
            dot = abs(target.axis[0]*cand.axis[0] + 
                      target.axis[1]*cand.axis[1] + 
                      target.axis[2]*cand.axis[2])
            score += 0.25 * max(0.0, dot)
        else:
            score += 0.15

        # 3. Centroid Distance (Weight: 0.30)
        dx = target.centroid[0] - cand.centroid[0]
        dy = target.centroid[1] - cand.centroid[1]
        dz = target.centroid[2] - cand.centroid[2]
        dist = math.sqrt(dx*dx + dy*dy + dz*dz)
        dist_score = math.exp(- (dist * dist) / (2.0 * (15.0 ** 2)))
        score += 0.30 * dist_score

        # 4. Area Match (Weight: 0.20)
        if target.area and cand.area and target.area > 0 and cand.area > 0:
            ratio = min(target.area, cand.area) / max(target.area, cand.area)
            score += 0.20 * ratio
        else:
            score += 0.10

        return score

    @staticmethod
    def _score_edge_match(target: GeometricReference, cand: GeometricReference) -> float:
        """Calculate weighted composite match score between two edge signatures."""
        score = 0.0

        # 1. Curve Type (Weight: 0.25)
        if target.curve_type and cand.curve_type:
            if target.curve_type == cand.curve_type:
                score += 0.25
        else:
            score += 0.15

        # 2. Centroid Distance (Weight: 0.40)
        dx = target.centroid[0] - cand.centroid[0]
        dy = target.centroid[1] - cand.centroid[1]
        dz = target.centroid[2] - cand.centroid[2]
        dist = math.sqrt(dx*dx + dy*dy + dz*dz)
        dist_score = math.exp(- (dist * dist) / (2.0 * (10.0 ** 2)))
        score += 0.40 * dist_score

        # 3. Length Match (Weight: 0.35)
        if target.length and cand.length and target.length > 0 and cand.length > 0:
            ratio = min(target.length, cand.length) / max(target.length, cand.length)
            score += 0.35 * ratio
        else:
            score += 0.20

        return score
