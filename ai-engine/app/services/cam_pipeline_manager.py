import json
import os
import shutil
from pathlib import Path
from typing import Dict, Any, List
from .cam_input_router import CamInputRouter
from .step_import_service import StepImportService
from .cam_feature_recognition import CamFeatureRecognition
from .cam_setup_analyzer import CamSetupAnalyzer
from .machine_type_detector import MachineTypeDetector
from .operation_planner import OperationPlanner
from .tool_recommendation_engine import ToolRecommendationEngine
from .toolpath_engine import ToolpathEngine, ALLOWED_SOURCES, BANNED_SOURCES
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
        self.setup_analyzer = CamSetupAnalyzer()
        self.toolpath_engine = ToolpathEngine()
        self.validator = ToolpathValidator()
        self.operation_planner = OperationPlanner()
        self.tool_engine = ToolRecommendationEngine()
        self.coord_validator = CoordinateValidator()
        
    def analyze_features(self, step_file_path: str, job_id: str, cam_run_id: str, setup: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        Performs Phase 2 Analysis: STEP import, B-Rep Analysis, Feature Recognition,
        and Setup-Aware Machinability Analysis.
        Does NOT generate toolpaths or G-code.
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
        
        # 4. Setup-Aware Machinability Analysis
        features = self.setup_analyzer.analyze(features, setup or {})
        
        # 5. Clean API response (Constraint C1 - sanitize OCC objects)
        features = self._sanitize_for_api(features)
        
        # Validate mapped geometry
        validation_status = "ok"
        mapped_count = 0
        failed_count = 0
        blocked_count = 0
        for f in features:
            if not f.get("machinable_in_current_setup", True):
                blocked_count += 1
            elif f.get("geometry", {}).get("status") == "error" or f.get("geometry", {}).get("status") == "failed":
                validation_status = "error"
                failed_count += 1
            else:
                mapped_count += 1
                
        geometry_mapping_summary = {
            "mapped_features": mapped_count,
            "failed_features": failed_count,
            "blocked_features": blocked_count,
            "total_features": len(features)
        }
        
        # 6. Calculate simple stock suggestions
        bounds = topology_info.get("bounds", [0, 0, 0, 100, 100, 20])
        dx = bounds[3] - bounds[0]
        dy = bounds[4] - bounds[1]
        dz = bounds[5] - bounds[2]
        
        stock_suggestions = {
            "type": "box",
            "dimensions": [dx + 10, dy + 10, dz + 2],
            "offset": [5, 5, 2]
        }
        
        # 7. Compute model hash
        import hashlib
        model_hash = None
        if Path(step_file_path).exists():
            with open(step_file_path, 'rb') as f:
                model_hash = hashlib.sha256(f.read()).hexdigest()

        # 8. Write setup analysis debug output
        setup_analysis = {
            "setup": setup or {},
            "feature_analysis": [
                {
                    "featureId": f.get("id"),
                    "featureType": f.get("type"),
                    "axis": f.get("axis"),
                    "center": f.get("center"),
                    "machining_region": f.get("machining_region"),
                    "machinable_in_current_setup": f.get("machinable_in_current_setup", True),
                    "requires_reorientation": f.get("requires_reorientation", False),
                    "requires_4axis_or_secondary_setup": f.get("requires_4axis_or_secondary_setup", False),
                    "blocked_reason": f.get("blocked_reason"),
                }
                for f in features
            ],
            "summary": geometry_mapping_summary,
        }
        
        try:
            job_dir = Path(__file__).resolve().parents[3] / "storage" / "jobs" / (job_id or "default") / "cam"
            job_dir.mkdir(parents=True, exist_ok=True)
            with open(job_dir / "cam_setup_analysis.json", "w") as fp:
                json.dump(setup_analysis, fp, indent=2, default=str)
            with open(job_dir / "cam_features_debug.json", "w") as fp:
                json.dump({"features": features, "modelHash": model_hash}, fp, indent=2, default=str)
        except Exception:
            pass

        return {
            "status": "success",
            "topology": topology_info,
            "features_detected": len(features),
            "features": features,
            "validation_status": validation_status,
            "geometry_mapping_summary": geometry_mapping_summary,
            "stock_suggestions": stock_suggestions,
            "camModelHash": model_hash,
        }
        
    def generate_toolpaths(self, step_file_path: str, job_id: str, cam_run_id: str, setup: Dict[str, Any], tools: List[Dict[str, Any]], operations: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Performs Phase 7: Toolpath Generation based strictly on User Setup, Tools, and Approved Operations.
        No auto-generation or fallback loops allowed.
        """
        from app.services.step_importer import StepImporter
        shape, metadata = StepImporter.load_and_heal(step_file_path)
        
        features = self.feature_recognizer.recognize_features(step_file_path)
        
        # Keep raw features for debug
        import copy
        raw_features = copy.deepcopy(features)
        
        mapper = GeometryMapper(self.feature_recognizer.extractor)
        features = mapper.enrich_features(features, setup)
        
        clean_features = copy.deepcopy(features)
        
        # Run setup analysis on features
        features = self.setup_analyzer.analyze(features, setup)
        
        # Strict operation validation
        feat_map = {f['id']: f for f in features}
        
        for op in operations:
            # Reset operation status and errors from previous runs
            op['status'] = 'planned'
            if 'parameters' in op and 'error' in op['parameters']:
                del op['parameters']['error']
                
            feat_id = op.get('feature_id') or op.get('featureId')
            tool_id = op.get('toolId')
            strategy = op.get('machining_strategy') or op.get('type')
            
            if not feat_id or not tool_id or not strategy:
                raise ValueError("Every operation must include a valid featureId, toolId, and strategy.")
                
            if feat_id not in feat_map:
                raise ValueError(f"Requested operation uses an unknown featureId: {feat_id}.")
            
            # Check if feature is machinable in current setup — skip gracefully
            feat = feat_map[feat_id]
            if not feat.get('machinable_in_current_setup', True):
                blocked_reason = feat.get('blocked_reason', 'Not machinable in current setup')
                op['status'] = 'error'
                op.setdefault('parameters', {})['error'] = f"Blocked: {blocked_reason}"
                continue
            
            # Check if geometry mapping succeeded — skip gracefully
            geom = feat.get('geometry', {})
            if geom.get('status') in ('failed', 'error'):
                op['status'] = 'error'
                op.setdefault('parameters', {})['error'] = f"Geometry mapping failed: {geom.get('error', 'unknown')}"
                continue
                
            if not geom.get('regionType'):
                op['status'] = 'error'
                op.setdefault('parameters', {})['error'] = "Geometry mapping failed: Missing regionType"
                continue
            
            # Check machining region for non-drilling ops — skip gracefully
            feat_type = feat.get('type', '')
            if feat_type not in ('hole', 'blind_hole', 'through_hole'):
                mr = feat.get('machining_region')
                if mr == 'error':
                    op['status'] = 'error'
                    op.setdefault('parameters', {})['error'] = "Machining region is missing or invalid."
                    continue
                
            # Inject geometry into operations
            op['geometry'] = feat.get('geometry', {})
            
        # Ensure mapping of tool to operation
        tool_dict = {t['id']: t for t in tools}
        for op in operations:
            if 'toolId' in op and op['toolId'] in tool_dict:
                op['tool'] = tool_dict[op['toolId']]

        # Generate True 3D Toolpaths using strict engine
        operations = self.toolpath_engine.generate_toolpaths(operations)
        
        # DO NOT apply modelToSetupTransform to ToolpathSegments here.
        # The frontend CadViewport renders the model in Model Space, so the toolpaths
        # must also be in Model Space to overlap correctly. Transformation to Setup Space 
        # should only happen at the G-code generation stage.

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
        
        # Final CAM output validation
        import hashlib
        with open(step_file_path, 'rb') as f:
            model_hash = hashlib.sha256(f.read()).hexdigest()
            
        cam_validation = self._validate_cam_output(features, operations, model_hash)
        
        # Constraint C6: Block G-code if any operation failed
        has_errors = any(op.get('status') == 'error' for op in operations)
        if coord_report.get('status') == 'error':
             has_errors = True
        if cam_validation.get('status') == 'error':
             has_errors = True
             
        # Validate CAM Output & Generate Summary
        operation_summaries = []
        for op in operations:
            if op.get("status") == "error":
                operation_summaries.append({
                    "operationId": op.get("id"),
                    "featureId": op.get("featureId") or op.get("feature_id"),
                    "featureType": next((f.get("type") for f in features if f.get("id") == (op.get("featureId") or op.get("feature_id"))), "unknown"),
                    "operationType": op.get("type"),
                    "strategy": op.get("machining_strategy"),
                    "machiningRegionArea": op.get("parameters", {}).get("diagnostics", {}).get("region_area", 0),
                    "segmentCount": 0,
                    "sourceTypes": [],
                    "status": "error",
                    "errorReason": op.get("parameters", {}).get("error", "Unknown error")
                })
                continue
                
            toolpaths = op.get("toolpaths", [])
            seg_count = len(toolpaths)
            sources = list(set([seg.get("source", "unknown") if isinstance(seg, dict) else getattr(seg, "source", "unknown") for seg in toolpaths]))
            
            error_reason = None
            if not op.get("featureId") and not op.get("feature_id"):
                error_reason = "Missing featureId"
            elif seg_count == 0:
                error_reason = "Segment count is 0"
            
            if error_reason:
                op["status"] = "error"
                op.setdefault("parameters", {})["error"] = error_reason
                has_errors = True
                
            operation_summaries.append({
                "operationId": op.get("id"),
                "featureId": op.get("featureId") or op.get("feature_id"),
                "featureType": next((f.get("type") for f in features if f.get("id") == (op.get("featureId") or op.get("feature_id"))), "unknown"),
                "operationType": op.get("type"),
                "strategy": op.get("machining_strategy"),
                "machiningRegionArea": op.get("parameters", {}).get("diagnostics", {}).get("region_area", 0),
                "segmentCount": seg_count,
                "sourceTypes": sources,
                "status": op.get("status", "planned"),
                "errorReason": error_reason
            })
             
        # Calculate hashes to verify uniqueness per model
        def obj_hash(obj):
            h = __import__('hashlib').md5()
            h.update(json.dumps(obj, sort_keys=True, default=str).encode('utf-8'))
            return h.hexdigest()

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

        # Dump CAM Debug Output — all 6 required files
        # Dump CAM Debug Output
        try:
            with open(job_dir / 'cam_raw_features.json', 'w') as f:
                json.dump({
                    "features": raw_features,
                    "modelHash": model_hash
                }, f, indent=2, default=str)
                
            with open(job_dir / 'cam_clean_features.json', 'w') as f:
                json.dump({
                    "features": clean_features,
                    "modelHash": model_hash
                }, f, indent=2, default=str)
                
            with open(job_dir / 'cam_features_debug.json', 'w') as f:
                json.dump({
                    "features": features,
                    "modelHash": model_hash
                }, f, indent=2, default=str)
                
            with open(job_dir / 'cam_setup_analysis.json', 'w') as f:
                json.dump({
                    "setup": setup,
                    "feature_analysis": [
                        {
                            "featureId": feat.get("id"),
                            "featureType": feat.get("type"),
                            "axis": feat.get("axis"),
                            "center": feat.get("center"),
                            "machining_region": feat.get("machining_region"),
                            "machinable_in_current_setup": feat.get("machinable_in_current_setup", True),
                            "requires_reorientation": feat.get("requires_reorientation", False),
                            "requires_4axis_or_secondary_setup": feat.get("requires_4axis_or_secondary_setup", False),
                            "blocked_reason": feat.get("blocked_reason"),
                        }
                        for feat in features
                    ]
                }, f, indent=2, default=str)
                
            with open(job_dir / 'cam_geometry_mapping.json', 'w') as f:
                json.dump({
                    "features": [
                        {"featureId": feat.get("id"), "geometry": feat.get("geometry", {})}
                        for feat in features
                    ]
                }, f, indent=2, default=str)
                
            with open(job_dir / 'cam_contour_debug.json', 'w') as f:
                contour_debugs = []
                for feat in features:
                    if feat.get("type") == "contour":
                        op_seg_count = 0
                        for op in operations:
                            if (op.get("featureId") == feat.get("id") or op.get("feature_id") == feat.get("id")):
                                op_seg_count = len(op.get("toolpaths", []))
                                break
                        contour_debugs.append({
                            "featureId": feat.get("id"),
                            "selectedFaceId": feat.get("face_ids", [None])[0] if feat.get("face_ids") else None,
                            "selectedFaceArea": feat.get("area", 0.0),
                            "boundarySource": feat.get("source", "unknown"),
                            "boundaryClosed": feat.get("boundaryClosed", False),
                            "boundaryPointCount": len(feat.get("boundaryPoints", [])),
                            "contourArea": feat.get("geometry", {}).get("diagnostics", {}).get("mapped_area", 0.0),
                            "toolpathSegmentCount": op_seg_count,
                            "rejectedReason": feat.get("geometry", {}).get("error", None)
                        })
                json.dump(contour_debugs, f, indent=2, default=str)
                
            with open(job_dir / 'cam_operation_summary.json', 'w') as f:
                json.dump(operation_summaries, f, indent=2, default=str)
                
            with open(job_dir / 'cam_toolpaths.json', 'w') as f:
                all_tp = []
                for op in operations:
                    all_tp.extend(op.get("toolpaths", []))
                json.dump({
                    "toolpath_count": len(all_tp),
                    "toolpaths": all_tp,
                    "camRunId": cam_run_id,
                    "modelHash": model_hash
                }, f, indent=2, default=str)
                
            with open(job_dir / 'cam_validation.json', 'w') as f:
                json.dump({
                    "cam_validation": cam_validation,
                    "pipeline_validation": validation_result,
                    "coordinate_validation": coord_report,
                    "operation_summaries": operation_summaries,
                }, f, indent=2, default=str)
                
        except Exception:
            pass
            
        return {
            "status": "error" if has_errors else "success",
            "operations": operations,
            "validation_status": validation_result.get('status'),
            "coordinate_validation": coord_report,
            "cam_validation": cam_validation,
            "warnings": validation_result.get('warnings', []) + coord_report.get('warnings', []),
            "errors": validation_result.get('errors', []) + coord_report.get('errors', []) + cam_validation.get('errors', []),
            "gcode_blocked": has_errors,
            "gcode_block_reason": "One or more operations failed geometry mapping or coordinate validation" if has_errors else None,
            "camModelHash": model_hash
        }

    def _validate_cam_output(self, features: List[Dict[str, Any]], operations: List[Dict[str, Any]], model_hash: str) -> Dict[str, Any]:
        """
        Final validation gate. Rejects CAM output if:
        - operation featureId is missing
        - successful operation has 0 segments
        - segment source is in the banned list
        - machining region is missing (non-drilling)
        - blocked feature still has toolpaths
        """
        result = {"status": "ok", "errors": [], "warnings": []}
        
        feat_map = {f.get("id"): f for f in features}
        blocked_ids = {f.get("id") for f in features if not f.get("machinable_in_current_setup", True)}
        
        for op in operations:
            op_id = op.get("id", "?")
            feat_id = op.get("featureId") or op.get("feature_id")
            
            # Check featureId exists
            if not feat_id:
                result["errors"].append(f"Operation {op_id}: missing featureId")
                result["status"] = "error"
                continue
            
            # Check blocked feature doesn't have toolpaths
            if feat_id in blocked_ids:
                tp = op.get("toolpaths", [])
                if tp:
                    result["errors"].append(f"Operation {op_id}: blocked feature {feat_id} has {len(tp)} toolpaths — must be 0")
                    result["status"] = "error"
                continue
            if op.get("status") in ("error", "blocked"):
                tp = op.get("toolpaths", [])
                if tp:
                    result["errors"].append(f"Operation {op_id}: blocked or error operation has {len(tp)} toolpaths — must be 0")
                    result["status"] = "error"
                continue
            
            # Check successful operation has segments
            tp = op.get("toolpaths", [])
            if not tp:
                result["errors"].append(f"Operation {op_id}: successful operation has 0 segments")
                result["status"] = "error"
                continue
                
            # Check segment sources
            for seg in tp:
                src = seg.get("source") if isinstance(seg, dict) else getattr(seg, "source", None)
                if src in BANNED_SOURCES:
                    result["errors"].append(f"Operation {op_id}: segment uses banned source '{src}'")
                    result["status"] = "error"
                    break
                if src and src not in ALLOWED_SOURCES:
                    result["errors"].append(f"Operation {op_id}: segment uses unknown source '{src}'")
                    result["status"] = "error"
                    break
            
            # Check machining region for non-drilling
            feat = feat_map.get(feat_id, {})
            feat_type = feat.get("type", "")
            if feat_type not in ("hole", "blind_hole", "through_hole"):
                mr = feat.get("machining_region")
                if mr == "error":
                    result["errors"].append(f"Operation {op_id}: feature {feat_id} has invalid machining region")
                    result["status"] = "error"
        
        return result

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
