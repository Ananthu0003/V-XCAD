import json
import os
import shutil
from pathlib import Path
from typing import Dict, Any, List
from .cam_input_router import CamInputRouter
from .step_import_service import StepImportService
from .cam_feature_recognition import CamFeatureRecognition
from .machine_type_detector import MachineTypeDetector
from .operation_planner import OperationPlanner
from .tool_recommendation_engine import ToolRecommendationEngine
from .toolpath_engine import ToolpathEngine
from .toolpath_validator import ToolpathValidator
from .gcode_generator import PostProcessorFactory
from .topology_extractor import TopologyExtractor
from .geometry_mapper import GeometryMapper
from .coordinate_validator import CoordinateValidator

class CamPipelineManager:
    """
    Orchestrates the execution of the entire CAM pipeline.
    Ensures data flows correctly from STEP import -> Analysis -> Path Generation -> G-Code.
    """
    def __init__(self):
        self.step_importer = StepImportService()
        self.feature_recognizer = CamFeatureRecognition()
        self.toolpath_engine = ToolpathEngine()
        self.validator = ToolpathValidator()
        self.operation_planner = OperationPlanner()
        self.tool_engine = ToolRecommendationEngine()
        self.coord_validator = CoordinateValidator()
        
    def analyze_features(self, step_file_path: str, job_id: str, cam_run_id: str, setup: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        Performs Phase 2 Analysis: STEP import, B-Rep Analysis, and Feature Recognition.
        Does NOT detect machine type or generate toolpaths.
        """
        from app.services.step_importer import StepImporter
        
        # 1. Import and Validate Topology
        topology_info = self.step_importer.import_and_validate(step_file_path)
        
        # 1a. Validate Coordinate System (Constraint C5)
        shape, metadata = StepImporter.load_and_heal(step_file_path)
        if metadata:
             self.coord_validator.validate_step_units(metadata)
        
        # 2. Extract B-Rep Features (Topology Extraction + Recognition)
        features = self.feature_recognizer.recognize_features(step_file_path)
        
        # 3. Geometry Mapping (Constraint C3)
        mapper = GeometryMapper(self.feature_recognizer.extractor)
        features = mapper.enrich_features(features, setup or {})
        
        # 4. Clean API response (Constraint C1 - sanitize OCC objects)
        features = self._sanitize_for_api(features)
        
        # 5. Calculate simple stock suggestions
        bounds = topology_info.get("bounds", [0, 0, 0, 100, 100, 20])
        dx = bounds[3] - bounds[0]
        dy = bounds[4] - bounds[1]
        dz = bounds[5] - bounds[2]
        
        stock_suggestions = {
            "type": "box",
            "dimensions": [dx + 10, dy + 10, dz + 2],
            "offset": [5, 5, 2]
        }
        
        return {
            "status": "success",
            "topology": topology_info,
            "features_detected": len(features),
            "features": features,
            "stock_suggestions": stock_suggestions,
        }
        
    def generate_toolpaths(self, step_file_path: str, job_id: str, cam_run_id: str, setup: Dict[str, Any], tools: List[Dict[str, Any]], operations: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Performs Phase 7: Toolpath Generation based strictly on User Setup, Tools, and Approved Operations.
        No auto-generation or fallback loops allowed.
        """
        from app.services.step_importer import StepImporter
        shape, metadata = StepImporter.load_and_heal(step_file_path)
        
        features = self.feature_recognizer.recognize_features(step_file_path)
        
        mapper = GeometryMapper(self.feature_recognizer.extractor)
        features = mapper.enrich_features(features, setup)
        
        # Inject geometry into operations
        feat_map = {f['id']: f for f in features}
        for op in operations:
            feat = feat_map.get(op.get('feature_id'))
            if feat:
                op['geometry'] = feat.get('geometry', {})
        
        # Ensure mapping of tool to operation
        tool_dict = {t['id']: t for t in tools}
        for op in operations:
            if 'toolId' in op and op['toolId'] in tool_dict:
                op['tool'] = tool_dict[op['toolId']]
                
        # Reject any operation with featureId = null
        for op in operations:
            if not op.get("feature_id"):
                op["status"] = "error"
                op.setdefault("parameters", {})["error"] = "Operation rejected: featureId is null or missing."

        # Generate True 3D Toolpaths using strict engine
        operations = self.toolpath_engine.generate_toolpaths(operations)
        
        # Apply modelToSetupTransform to every ToolpathSegment before serialization
        transform = setup.get("modelToSetupTransform")
        if transform and len(transform) == 16:
            m00, m01, m02, m03 = transform[0:4]
            m10, m11, m12, m13 = transform[4:8]
            m20, m21, m22, m23 = transform[8:12]
            
            for op in operations:
                if op.get("status") == "error": continue
                for seg in op.get("toolpaths", []):
                    # Start Point
                    sx, sy, sz = seg.start.x, seg.start.y, seg.start.z
                    seg.start.x = m00*sx + m01*sy + m02*sz + m03
                    seg.start.y = m10*sx + m11*sy + m12*sz + m13
                    seg.start.z = m20*sx + m21*sy + m22*sz + m23
                    # End Point
                    ex, ey, ez = seg.end.x, seg.end.y, seg.end.z
                    seg.end.x = m00*ex + m01*ey + m02*ez + m03
                    seg.end.y = m10*ex + m11*ey + m12*ez + m13
                    seg.end.z = m20*ex + m21*ey + m22*ez + m23

        # Clean operations (Constraint C1)
        operations = self._sanitize_for_api(operations)
        features = self._sanitize_for_api(features)
        
        # Validate coordinate frame (Constraint C5)
        all_segments = []
        for op in operations:
             if op.get("status") != "error":
                 all_segments.extend(op.get('toolpaths', []))
             
        model_bbox = metadata.get('bbox', {}) if metadata else {}
        coord_report = self.coord_validator.validate_toolpath_in_model_frame(all_segments, model_bbox)
        
        # Validate full feature-operation-toolpath chain (Constraint C4, C6)
        validation_result = self.validator.validate_pipeline(features, operations)
        
        # Constraint C6: Block G-code if any operation failed
        has_errors = any(op.get('status') == 'error' for op in operations)
        if coord_report.get('status') == 'error':
             has_errors = True
             
        # Calculate hashes to verify uniqueness per model
        import hashlib
        def obj_hash(obj):
            h = hashlib.md5()
            h.update(json.dumps(obj, sort_keys=True, default=str).encode('utf-8'))
            return h.hexdigest()
            
        with open(step_file_path, 'rb') as f:
            model_hash = hashlib.sha256(f.read()).hexdigest()

        feature_hash = obj_hash(features)
        operation_hash = obj_hash(operations)
        
        # Ensure job directory exists
        job_dir = Path(__file__).resolve().parents[3] / "storage" / "jobs" / job_id / "cam"
        if job_dir.exists():
            shutil.rmtree(job_dir)
        job_dir.mkdir(parents=True, exist_ok=True)
        
        # Read previous hashes to detect stale identical output
        cache_file = job_dir / "cam_hashes.json"
        if cache_file.exists():
            try:
                with open(cache_file, 'r') as f:
                    prev_hashes = json.load(f)
                    
                if prev_hashes.get('modelHash') != model_hash:
                    if (prev_hashes.get('featureHash') == feature_hash and
                        prev_hashes.get('operationHash') == operation_hash):
                        raise Exception("CAM generation may be reusing stale, fallback, or cached data.")
            except Exception as e:
                if "stale" in str(e):
                    raise
                print(f"Warning checking hashes: {e}")
                
        with open(cache_file, 'w') as f:
            json.dump({
                "modelHash": model_hash,
                "featureHash": feature_hash,
                "operationHash": operation_hash
            }, f)

        # Dump CAM Debug Output
        try:
            with open(job_dir / 'cam_features.json', 'w') as f:
                json.dump({
                    "features": features,
                    "operations": operations,
                    "validation": validation_result,
                    "coordinate_validation": coord_report,
                    "camRunId": cam_run_id,
                    "modelHash": model_hash
                }, f, indent=2, default=str)
        except Exception:
            pass
            
        return {
            "status": "error" if has_errors else "success",
            "operations": operations,
            "validation_status": validation_result.get('status'),
            "coordinate_validation": coord_report,
            "warnings": validation_result.get('warnings', []) + coord_report.get('warnings', []),
            "errors": validation_result.get('errors', []) + coord_report.get('errors', []),
            "gcode_blocked": has_errors,
            "gcode_block_reason": "One or more operations failed geometry mapping or coordinate validation" if has_errors else None,
            "camModelHash": model_hash
        }

    def _sanitize_for_api(self, data: Any) -> Any:
        """
        Recursively strip non-serializable objects (like OCC pointers) from dicts/lists.
        Constraint C1: OCC objects must remain backend-internal only.
        """
        if isinstance(data, dict):
            clean_dict = {}
            for k, v in data.items():
                # Explicitly exclude OCC object references we might have missed
                if k in ("object", "edge_obj", "wire_obj", "face_obj"):
                    continue
                # If it's a known OCC type that snuck in, skip it
                if str(type(v)).find("OCP") != -1 or str(type(v)).find("build123d") != -1:
                    continue
                clean_dict[k] = self._sanitize_for_api(v)
            return clean_dict
        elif isinstance(data, list):
            return [self._sanitize_for_api(i) for i in data]
        elif isinstance(data, tuple):
             return tuple(self._sanitize_for_api(i) for i in data)
        else:
            return data

