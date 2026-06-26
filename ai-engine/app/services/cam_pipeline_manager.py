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
from .operation_strategy_planner import OperationStrategyPlanner
from .setup_planner import SetupPlanner
from .tool_recommendation_engine import ToolRecommendationEngine
from .toolpath_engine import ToolpathEngine, ALLOWED_SOURCES, BANNED_SOURCES
from .toolpath_validator import ToolpathValidator
from app.models.schemas import MachineCapability
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
        self.setup_analyzer = CamSetupAnalyzer()  # keeping for legacy/fallback
        self.setup_planner = SetupPlanner()
        self.toolpath_engine = ToolpathEngine()
        self.validator = ToolpathValidator()
        self.operation_strategy_planner = OperationStrategyPlanner()
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
        
        # 4. Setup-Aware Machinability Analysis using Setup Planner
        # We need a MachineCapability object. For now, construct one based on setup or defaults.
        caps = MachineCapability()
        setup_plans = self.setup_planner.plan_setups(
            features, 
            caps, 
            stock_orientation=setup.get("stockOrientation", "top_z") if setup else "top_z",
            default_tool_axis=setup.get("toolAxis", [0.0, 0.0, 1.0]) if setup else [0.0, 0.0, 1.0]
        )
        
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
            "setups": [s.model_dump() for s in setup_plans],
            "validation_status": validation_status,
            "geometry_mapping_summary": geometry_mapping_summary,
            "stock_suggestions": stock_suggestions,
            "camModelHash": model_hash,
        }
        
    def auto_plan_cam(self, step_file_path: str, machine_config: Dict[str, Any], job_id: str = "default_job") -> Dict[str, Any]:
        """
        Performs Feature -> Setup Planning -> Tool Recommendation -> Operation Strategy -> Operation.
        Does NOT generate toolpaths.
        """
        # 1. Feature Recognition & Geometry Mapping
        features = self.feature_recognizer.recognize_features(step_file_path)
        mapper = GeometryMapper(self.feature_recognizer.extractor)
        # Assuming default setup for enrichment
        default_setup = {"toolAxis": [0.0, 0.0, 1.0]}
        features = mapper.enrich_features(features, default_setup)
        features = self._sanitize_for_api(features)
        
        # 2. Setup Planning
        caps = MachineCapability(**machine_config.get("machine_capability", {}))
        setup_plans = self.setup_planner.plan_setups(features, caps)
        
        all_tools = []
        all_operations = []
        
        # 3. Tool Recommendation & Operation Strategy Planner per Setup
        for sp in setup_plans:
            # Generate strategy (unassigned tools)
            ops = self.operation_strategy_planner.plan_strategies(features, sp.model_dump())
            
            for op in ops:
                # Find matching feature to get dimensions for tool recommendation
                feat = next((f for f in features if f.get("id") == op.feature_id), None)
                if feat:
                    rec = self.tool_engine.recommend_tool({"type": op.type, "parameters": {"dimensions": feat.get("dimensions", {})}})
                    if "tool" in rec:
                        tool_data = rec["tool"]
                        # Assign tool to operation
                        existing = next((t for t in all_tools if t["id"] == tool_data["id"]), None)
                        if not existing:
                            all_tools.append(tool_data)
                        op.tool_id = tool_data["id"]
                        
                        if "feedsAndSpeeds" in rec:
                            op.parameters.update(rec["feedsAndSpeeds"])
                all_operations.append(op.to_dict())
        # Validation
        operationsForSecondarySetupInActiveSetup = []
        okOperationForUnsupportedFeature = []
        operationSetupMismatch = []
        
        feature_map = {f.get("id"): f for f in features}
        
        duplicateFeatureAssignments = []
        for feat in features:
            fid = feat.get("id")
            setup_count = 0
            for sp in setup_plans:
                if fid in sp.assignedFeatureIds:
                    setup_count += 1
            if setup_count > 1:
                duplicateFeatureAssignments.append(fid)

        for op in all_operations:
            feat = feature_map.get(op.get("feature_id"))
            if not feat:
                continue
                
            machining_info = feat.get("machining_info", {})
            feat_status = machining_info.get("status")
            feat_setup_id = machining_info.get("setupId")
            
            if op.get("setup_id") != feat_setup_id:
                operationSetupMismatch.append({
                    "operationId": op.get("id"),
                    "featureId": op.get("feature_id"),
                    "opSetupId": op.get("setup_id"),
                    "featSetupId": feat_setup_id
                })
                
            if feat_status == "machinable_in_secondary_setup" and op.get("status") not in ("error", "blocked", "pending_secondary_setup"):
                operationsForSecondarySetupInActiveSetup.append({
                    "operationId": op.get("id"),
                    "featureId": op.get("feature_id"),
                })
            
            if feat_status == "unsupported" and op.get("status") not in ("error", "blocked"):
                okOperationForUnsupportedFeature.append({
                    "operationId": op.get("id"),
                    "featureId": op.get("feature_id"),
                })
        
        # Feature-without-operation validation
        all_op_feature_ids = set(op.get("feature_id") for op in all_operations if op.get("feature_id"))
        feature_without_operation = []
        for feat in features:
            fid = feat.get("id")
            if fid and fid not in all_op_feature_ids:
                feature_without_operation.append({
                    "featureId": fid,
                    "featureType": feat.get("type"),
                    "featureSubtype": feat.get("subtype"),
                })
        
        cam_validation = {
            "duplicateFeatureAssignments": duplicateFeatureAssignments,
            "operationsForSecondarySetupInActiveSetup": operationsForSecondarySetupInActiveSetup,
            "okOperationForUnsupportedFeature": okOperationForUnsupportedFeature,
            "operationSetupMismatch": operationSetupMismatch,
            "featureWithoutOperation": feature_without_operation,
            "debugGeometryLeakedToToolpaths": [],
            "invalidViewportPayload": [],
            "bossMappingFailures": []
        }
        
        # Hole-specific validation
        hole_debug = []
        hole_validation = {
            "holeWithoutEntryFaces": [],
            "holeWithoutSetupId": [],
            "duplicateHoleOperations": [],
            "holeInMultipleSetups": [],
        }
        
        hole_op_counts = {}
        hole_setup_assignments = {}
        
        for feat in features:
            if feat.get("type") not in ("hole", "blind_hole", "through_hole"):
                continue
            fid = feat.get("id")
            mi = feat.get("machining_info", {})
            entry_faces = feat.get("possibleEntryFaces", [])
            
            # Build debug record
            hole_debug.append({
                "featureId": fid,
                "subtype": feat.get("subtype"),
                "holeAxis": feat.get("axis"),
                "assignedSetupId": mi.get("setupId"),
                "entryFaceId": entry_faces[0]["faceId"] if entry_faces else None,
                "entryNormal": entry_faces[0]["normal"] if entry_faces else None,
                "possibleEntryFaces": entry_faces,
                "status": mi.get("status"),
                "reason": mi.get("reason"),
            })
            
            if not entry_faces:
                hole_validation["holeWithoutEntryFaces"].append(fid)
            if not mi.get("setupId"):
                hole_validation["holeWithoutSetupId"].append(fid)
            
            sid = mi.get("setupId")
            if sid:
                hole_setup_assignments.setdefault(fid, []).append(sid)
        
        for op in all_operations:
            feat = feature_map.get(op.get("feature_id"))
            if feat and feat.get("type") in ("hole", "blind_hole", "through_hole"):
                key = f"{op.get('feature_id')}:{op.get('type')}"
                hole_op_counts.setdefault(key, []).append(op.get("id"))
        
        for key, op_ids in hole_op_counts.items():
            if len(op_ids) > 1:
                hole_validation["duplicateHoleOperations"].append({"key": key, "operationIds": op_ids})
        
        for fid, sids in hole_setup_assignments.items():
            if len(sids) > 1:
                hole_validation["holeInMultipleSetups"].append({"featureId": fid, "setups": sids})
        
        cam_validation.update(hole_validation)
        
        # Boss-specific validation
        boss_debug = []
        boss_validation = {
            "bossFloorMissing": [],
            "bossBoundaryInvalid": [],
            "bossIslandInvalid": [],
            "bossClearingAreaInvalid": [],
            "duplicateBossFeature": [],
            "duplicateBossOperation": [],
        }

        boss_op_counts = {}
        for feat in features:
            if feat.get("type") == "boss" or feat.get("subtype") == "cylindrical_boss":
                fid = feat.get("id")
                mi = feat.get("machining_info", {})
                mr = feat.get("machiningRegion", {})
                
                bd = {
                    "featureId": fid,
                    "faceIds": feat.get("face_ids"),
                    "axis": feat.get("axis"),
                    "centerline": feat.get("centerline"),
                    "radius": feat.get("radius"),
                    "height": feat.get("dimensions", {}).get("height"),
                    "floorFaceId": feat.get("floor_face_id"),
                    "containingFaceId": mr.get("regionId", "").replace("region_", "") if mr.get("regionId") else None,
                    "floorFaceFound": bool(feat.get("floor_face_id")),
                    "floorNormal": None, # Could lookup from faces if needed
                    "floorBoundaryPointCount": len(mr.get("boundary", [])) if isinstance(mr.get("boundary"), list) else 0,
                    "bossBoundaryPointCount": len(mr.get("islands", [[],])[0]) if mr.get("islands") and isinstance(mr.get("islands")[0], list) else 0,
                    "floorBoundaryClosed": True if mr.get("boundary") else False,
                    "bossBoundaryClosed": True if mr.get("islands") else False,
                    "floorArea": 0, # not explicitly stored
                    "bossIslandArea": 0,
                    "calculatedClearingArea": mr.get("area", 0),
                    "machiningRegion.valid": mr.get("valid"),
                    "machiningRegion.regionType": mr.get("regionType"),
                    "machiningRegion.source": mr.get("source"),
                    "errorReason": mr.get("errorReason")
                }
                boss_debug.append(bd)
                
                if mr.get("errorReason") == "Boss floorFaceId missing":
                    boss_validation["bossFloorMissing"].append(fid)
                elif mr.get("errorReason") == "Boss floor boundary invalid":
                    boss_validation["bossBoundaryInvalid"].append(fid)
                elif mr.get("errorReason") == "Boss island boundary invalid":
                    boss_validation["bossIslandInvalid"].append(fid)
                elif mr.get("errorReason") == "Invalid boss clearing area":
                    boss_validation["bossClearingAreaInvalid"].append(fid)

        # check for duplicate boss features
        boss_axis_map = {}
        for feat in features:
            if feat.get("type") == "boss":
                c = feat.get("centerline", [0,0,0])
                k = f"{c[0]:.2f},{c[1]:.2f}"
                boss_axis_map.setdefault(k, []).append(feat.get("id"))
        for k, fids in boss_axis_map.items():
            if len(fids) > 1:
                boss_validation["duplicateBossFeature"].append({"key": k, "features": fids})

        for op in all_operations:
            feat = feature_map.get(op.get("feature_id"))
            if feat and feat.get("type") == "boss":
                key = f"{op.get('feature_id')}:{op.get('type')}"
                boss_op_counts.setdefault(key, []).append(op.get("id"))
        for key, op_ids in boss_op_counts.items():
            if len(op_ids) > 1:
                boss_validation["duplicateBossOperation"].append({"key": key, "operationIds": op_ids})
                
        cam_validation.update(boss_validation)
        
        # Write Debug artifacts
        try:
            job_dir = Path(__file__).resolve().parents[3] / "storage" / "jobs" / job_id / "cam"
            job_dir.mkdir(parents=True, exist_ok=True)
            with open(job_dir / "cam_setup_plan.json", "w") as fp:
                json.dump([s.model_dump() for s in setup_plans], fp, indent=2, default=str)
            with open(job_dir / "cam_clean_features.json", "w") as fp:
                json.dump(features, fp, indent=2, default=str)
            with open(job_dir / "cam_feature_machining_info.json", "w") as fp:
                json.dump([f.get("machining_info", {}) for f in features], fp, indent=2, default=str)
            with open(job_dir / "cam_operation_plan.json", "w") as fp:
                json.dump(all_operations, fp, indent=2, default=str)
            with open(job_dir / "cam_regions.json", "w") as fp:
                json.dump([f.get("machiningRegion") for f in features if "machiningRegion" in f], fp, indent=2, default=str)
                
            # Compute features without any operation
            op_feature_ids = set(op.get("feature_id") for op in all_operations if op.get("feature_id"))
            feature_without_operation = [f.get("id") for f in features if f.get("id") not in op_feature_ids]
            cam_validation["featureWithoutOperation"] = feature_without_operation
            cam_validation["missingOperationForFeature"] = len(feature_without_operation) > 0
            with open(job_dir / "cam_validation.json", "w") as fp:
                json.dump(cam_validation, fp, indent=2, default=str)
            with open(job_dir / "cam_hole_debug.json", "w") as fp:
                json.dump(hole_debug, fp, indent=2, default=str)
            with open(job_dir / "cam_boss_debug.json", "w") as fp:
                json.dump(boss_debug, fp, indent=2, default=str)
                
            coverage_data = []
            for feat in features:
                fid = feat.get("id")
                ops = [op for op in all_operations if op.get("feature_id") == fid]
                if ops:
                    for op in ops:
                        coverage_data.append({
                            "featureId": fid,
                            "featureType": feat.get("type"),
                            "operationCreated": True,
                            "operationType": op.get("type"),
                            "status": op.get("status"),
                            "reason": op.get("parameters", {}).get("errorReason") or op.get("parameters", {}).get("error", "")
                        })
                else:
                    coverage_data.append({
                        "featureId": fid,
                        "featureType": feat.get("type"),
                        "operationCreated": False,
                        "operationType": None,
                        "status": "missing",
                        "reason": "No operation generated"
                    })
            with open(job_dir / "cam_feature_operation_coverage.json", "w") as fp:
                json.dump(coverage_data, fp, indent=2, default=str)
                
        except Exception:
            pass

        return {
            "status": "success",
            "features": features,
            "setups": [s.model_dump() for s in setup_plans],
            "tools": all_tools,
            "operations": all_operations
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
                raise ValueError(f"Every operation must include a valid featureId, toolId, and strategy. Received: {op}")
                
            if feat_id not in feat_map:
                raise ValueError(f"Requested operation uses an unknown featureId: {feat_id}.")
            
            # Check if feature is machinable in current setup — skip gracefully
            feat = feat_map[feat_id]
            if not feat.get('machinable_in_current_setup', True):
                blocked_reason = feat.get('blocked_reason', 'Not machinable in current setup')
                op['status'] = 'error'
                op.setdefault('parameters', {})['error'] = f"Blocked: {blocked_reason}"
                continue
            
            # Check if machiningRegion mapping succeeded — skip gracefully
            mr = feat.get('machiningRegion')
            if not mr or not mr.get('valid'):
                op['status'] = 'error'
                err_reason = mr.get('errorReason', 'Missing or invalid machining region') if mr else 'No machining region generated'
                op.setdefault('parameters', {})['error'] = f"Geometry mapping failed: {err_reason}"
                op['machiningRegion'] = None
                continue
                
            if not mr.get('regionType') or mr.get('regionType') == "none":
                op['status'] = 'error'
                op.setdefault('parameters', {})['error'] = "Geometry mapping failed: Missing or invalid regionType"
                op['machiningRegion'] = None
                continue
            
            allowed_sources = {"hole_center", "outer_wire", "face_boundary", "pocket_boundary", "boss_floor_minus_island", "turning_profile"}
            if mr.get('source') not in allowed_sources:
                op['status'] = 'error'
                op.setdefault('parameters', {})['error'] = f"Geometry mapping failed: Invalid region source {mr.get('source')}"
                op['machiningRegion'] = None
                continue
                
            # Inject geometry into operations
            op['machiningRegion'] = mr
            
        # Ensure mapping of tool to operation
        tool_dict = {t['id']: t for t in tools}
        for op in operations:
            if 'toolId' in op and op['toolId'] in tool_dict:
                op['tool'] = tool_dict[op['toolId']]

        # Output toolpath engine input debug
        try:
            job_dir = Path(__file__).resolve().parents[3] / "storage" / "jobs" / job_id / "cam"
            job_dir.mkdir(parents=True, exist_ok=True)
            with open(job_dir / 'cam_toolpath_engine_input.json', 'w') as f:
                json.dump({
                    "operations": operations,
                    "setup": setup
                }, f, indent=2, default=str)
        except Exception:
            pass

        # 4. Generate Toolpaths
        from app.services.motion_planner import MotionPlanner
        motion_planner = MotionPlanner()
        toolpath_engine = ToolpathEngine()
        
        for op in operations:
            if op.get("status") in ("error", "blocked"):
                op["toolpaths"] = []
                continue
                
            machiningRegion = op.get("machiningRegion")
            tool = op.get("tool", {})
            try:
                commands = motion_planner.generate_commands(op, machiningRegion, tool, setup)
                segments = toolpath_engine.generate_toolpaths_from_commands(op, commands)
                op["toolpaths"] = [s.model_dump() for s in segments] if segments else []
            except Exception as e:
                op["status"] = "error"
                op.setdefault("parameters", {})["error"] = f"Motion planning or toolpath validation failed: {str(e)}"
                op["toolpaths"] = []
        
        # Validation Step
        invalid_ops = 0
        validation_reasons = []
        TOOLPATH_SOURCES = {"drill", "contour", "pocket", "boss", "face", "turning"}
        REGION_SOURCES = {"hole_center", "outer_wire", "face_boundary", "pocket_boundary", "boss_floor_minus_island", "turning_profile"}

        for op in operations:
            if op.get("status") == "error":
                invalid_ops += 1
                reason = op.get("parameters", {}).get("error", "Unknown validation error")
                validation_reasons.append({"operationId": op.get("id"), "reason": reason})
                op["toolpaths"] = []
                op["debug_toolpaths"] = []
                continue
                
            toolpaths = op.get("toolpaths", [])
            valid_toolpaths = []
            debug_toolpaths = []
            
            for seg in toolpaths:
                seg_dict = seg if isinstance(seg, dict) else seg.model_dump()
                src = seg_dict.get("source")
                # Required fields
                if not src or not seg_dict.get("moveType") or not seg_dict.get("segmentId"):
                    op["status"] = "error"
                    op.setdefault("parameters", {})["error"] = "Segment missing source, moveType, or segmentId"
                    validation_reasons.append({"operationId": op.get("id"), "reason": op["parameters"]["error"]})
                    break
                    
                if src in REGION_SOURCES or src in BANNED_SOURCES:
                    debug_toolpaths.append(seg)
                elif src in TOOLPATH_SOURCES:
                    valid_toolpaths.append(seg)
                else:
                    debug_toolpaths.append(seg)
                
            if op.get("status") == "error":
                op["toolpaths"] = []
                op["debug_toolpaths"] = []
            else:
                op["toolpaths"] = valid_toolpaths
                op["debug_toolpaths"] = debug_toolpaths
        
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
            
            import math
            total_path_length = 0.0
            cut_distance = 0.0
            rapid_distance = 0.0
            plunge_count = 0
            retract_count = 0
            
            for seg in toolpaths:
                seg_dict = seg if isinstance(seg, dict) else seg.model_dump()
                mtype = seg_dict.get("moveType")
                start = seg_dict.get("start", {})
                end = seg_dict.get("end", {})
                dist = math.dist([start.get("x",0), start.get("y",0), start.get("z",0)], [end.get("x",0), end.get("y",0), end.get("z",0)])
                total_path_length += dist
                if mtype == "feed" or mtype == "arc":
                    cut_distance += dist
                elif mtype == "rapid":
                    rapid_distance += dist
                elif mtype == "plunge":
                    plunge_count += 1
                elif mtype == "retract":
                    retract_count += 1

            est_cycle_time = (cut_distance / 800.0) + (rapid_distance / 2000.0) + (plunge_count * 2.0 / 200.0)
            
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
                "machiningRegionArea": op.get("machiningRegion", {}).get("area", 0),
                "totalPathLength": round(total_path_length, 2),
                "cutDistance": round(cut_distance, 2),
                "rapidDistance": round(rapid_distance, 2),
                "plungeCount": plunge_count,
                "retractCount": retract_count,
                "segmentCount": seg_count,
                "estimatedCycleTime": round(est_cycle_time, 2),
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
            except Exception as exc:
                import traceback
                traceback.print_exc()
                if "stale" in str(exc):
                    raise
                print(f"Warning checking hashes: {exc}")
                
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
                
            with open(job_dir / 'cam_regions.json', 'w') as f:
                json.dump({
                    "features": [
                        {"featureId": feat.get("id"), "geometry": feat.get("machiningRegion", {})}
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
                            "contourArea": feat.get("machiningRegion", {}).get("diagnostics", {}).get("mapped_area", 0.0),
                            "toolpathSegmentCount": op_seg_count,
                            "rejectedReason": feat.get("machiningRegion", {}).get("error", None)
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
            with open(job_dir / 'cam_debug_overlay.json', 'w') as f:
                all_debug_tp = []
                for op in operations:
                    all_debug_tp.extend(op.get("debug_toolpaths", []))
                json.dump({
                    "toolpath_count": len(all_debug_tp),
                    "toolpaths": all_debug_tp,
                    "camRunId": cam_run_id,
                    "modelHash": model_hash
                }, f, indent=2, default=str)
                
            with open(job_dir / 'cam_toolpath_overlay_debug.json', 'w') as f:
                overlay_debugs = []
                for op in operations:
                    feat_id = op.get("featureId") or op.get("feature_id")
                    feat = next((f for f in features if f.get("id") == feat_id), {})
                    
                    toolpaths = op.get("toolpaths", [])
                    
                    tp_min = [1e9, 1e9, 1e9]
                    tp_max = [-1e9, -1e9, -1e9]
                    banned_found = False
                    for seg in toolpaths:
                        s_src = seg.get("source", "unknown") if isinstance(seg, dict) else getattr(seg, "source", "unknown")
                        if s_src in BANNED_SOURCES:
                            banned_found = True
                        p1 = seg.get("start", {}) if isinstance(seg, dict) else getattr(seg, "start", None)
                        p2 = seg.get("end", {}) if isinstance(seg, dict) else getattr(seg, "end", None)
                        
                        def update_bb(pt):
                            if not pt: return
                            x = pt.get("x") if isinstance(pt, dict) else getattr(pt, "x", None)
                            y = pt.get("y") if isinstance(pt, dict) else getattr(pt, "y", None)
                            z = pt.get("z") if isinstance(pt, dict) else getattr(pt, "z", None)
                            if x is not None and y is not None and z is not None:
                                tp_min[0] = min(tp_min[0], x)
                                tp_min[1] = min(tp_min[1], y)
                                tp_min[2] = min(tp_min[2], z)
                                tp_max[0] = max(tp_max[0], x)
                                tp_max[1] = max(tp_max[1], y)
                                tp_max[2] = max(tp_max[2], z)
                                
                        update_bb(p1)
                        update_bb(p2)
                        
                    tp_bbox = None
                    if tp_min[0] < 1e8:
                        tp_bbox = {"min": tp_min, "max": tp_max}
                        
                    geom = feat.get("machiningRegion", {})
                    
                    overlay_debugs.append({
                        "featureId": feat_id,
                        "operationId": op.get("id"),
                        "featureType": feat.get("type"),
                        "operationType": op.get("type"),
                        "machiningRegionSource": geom.get("source", feat.get("source", "unknown")),
                        "bannedSourceDetected": banned_found,
                        "rejectionReason": op.get("parameters", {}).get("error"),
                        "toolpathBBox": tp_bbox,
                        "machiningRegionBBox": geom.get("bbox") if geom else None,
                        "modelBBox": setup.get("stockDimensions"),
                        "segmentCount": len(toolpaths),
                        "sourceTypes": list(set([seg.get("source", "unknown") if isinstance(seg, dict) else getattr(seg, "source", "unknown") for seg in toolpaths])),
                        "validationStatus": op.get("status", "planned")
                    })
                json.dump(overlay_debugs, f, indent=2, default=str)
                
            with open(job_dir / 'cam_validation.json', 'w') as f:
                json.dump({
                    "status": "error" if has_errors else "success",
                    "validation_reasons": validation_reasons,
                    "invalid_operations_count": invalid_ops,
                    "cam_validation": cam_validation,
                    "pipeline_validation": validation_result,
                    "coordinate_validation": coord_report,
                    "operation_summaries": operation_summaries,
                }, f, indent=2, default=str)
                
        except Exception as write_exc:
            import traceback
            traceback.print_exc()
            print(f"[CAM] CRITICAL: Failed to write CAM output files to {job_dir}: {write_exc}")
            
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
        Final validation gate for cam_validation.json.
        Checks for all known consistency issues before output is finalized.
        """
        result = {
            "status": "ok",
            "errors": [],
            "warnings": [],
            # Requested validation buckets
            "duplicateFeatures": [],
            "duplicateOperations": [],
            "operationWithoutValidFeature": [],
            "operationWithoutValidRegion": [],
            "duplicateBossOperations": [],
            "invalidToolpathSegments": [],
            "debugGeometryLeakedToToolpaths": [],
            "operationSetupMismatch": [],
            "bossFloorMissing": [],
            "duplicateFeatureAssignments": [],
            "invalidViewportPayload": [],
            "bossMappingFailures": [],
        }

        # ----------------------------------------------------------
        # 1. Duplicate features (same face_ids set appearing twice)
        # ----------------------------------------------------------
        feat_map = {}
        face_sets_seen = {}
        for f in features:
            fid = f.get("id")
            feat_map[fid] = f
            face_key = ",".join(sorted(f.get("face_ids", [])))
            if face_key and face_key in face_sets_seen:
                result["duplicateFeatures"].append({
                    "featureId": fid,
                    "duplicateOf": face_sets_seen[face_key],
                    "faceKey": face_key,
                })
            elif face_key:
                face_sets_seen[face_key] = fid

        # ----------------------------------------------------------
        # 2. Duplicate feature assignments (feature in >1 setup)
        # ----------------------------------------------------------
        feature_setup_map = {}
        for f in features:
            fid = f.get("id")
            mi = f.get("machining_info", {})
            sid = mi.get("setupId")
            if fid and sid:
                feature_setup_map.setdefault(fid, []).append(sid)
        for fid, sids in feature_setup_map.items():
            if len(sids) > 1:
                result["duplicateFeatureAssignments"].append({
                    "featureId": fid,
                    "setups": sids,
                })

        # ----------------------------------------------------------
        # 3. Boss floor missing
        # ----------------------------------------------------------
        for f in features:
            if f.get("type") == "boss":
                floor_id = f.get("floorFaceId") or f.get("floor_face_id") or f.get("parentFaceId")
                if not floor_id:
                    result["bossFloorMissing"].append(f.get("id"))

        # ----------------------------------------------------------
        # 4. Per-operation checks
        # ----------------------------------------------------------
        ops_per_feature = {}
        for op in operations:
            op_id = op.get("id", "?")
            feat_id = op.get("featureId") or op.get("feature_id")
            op_type = op.get("type", "")
            op_setup = op.get("setupId") or op.get("setup_id")

            # 4a. Operation without valid feature
            if not feat_id or feat_id not in feat_map:
                result["operationWithoutValidFeature"].append(op_id)
                result["errors"].append(f"Operation {op_id}: missing or invalid featureId '{feat_id}'")
                result["status"] = "error"
                continue

            feat = feat_map[feat_id]

            # 4b. Operation without valid region
            mr = feat.get("machiningRegion", {})
            if not mr.get("valid", True) is True:
                if op.get("status") not in ("error", "pending_secondary_setup"):
                    result["operationWithoutValidRegion"].append(op_id)

            # 4c. Operation setup mismatch
            feat_mi = feat.get("machining_info", {})
            feat_setup = feat_mi.get("setupId")
            if op_setup and feat_setup and op_setup != feat_setup:
                result["operationSetupMismatch"].append({
                    "operationId": op_id,
                    "opSetup": op_setup,
                    "featureSetup": feat_setup,
                })

            # 4d. Track operations per feature for duplicate detection
            key = f"{feat_id}:{op_type}"
            ops_per_feature.setdefault(key, []).append(op_id)

            # 4e. Blocked/secondary features should have 0 toolpaths
            feat_status = feat_mi.get("status")
            if feat_status != "machinable_in_active_setup":
                tp = op.get("toolpaths", [])
                if tp:
                    result["errors"].append(
                        f"Operation {op_id}: non-active feature {feat_id} has {len(tp)} toolpaths — must be 0"
                    )
                    result["status"] = "error"
                continue

            if op.get("status") in ("error", "blocked", "pending_secondary_setup"):
                tp = op.get("toolpaths", [])
                if tp:
                    result["errors"].append(
                        f"Operation {op_id}: error/pending operation has {len(tp)} toolpaths — must be 0"
                    )
                    result["status"] = "error"
                continue

            # 4f. Successful operation should have segments
            tp = op.get("toolpaths", [])
            if not tp:
                result["errors"].append(f"Operation {op_id}: successful operation has 0 segments")
                result["status"] = "error"
                continue

            # 4g. Segment source / moveType checks
            for seg in tp:
                src = seg.get("source") if isinstance(seg, dict) else getattr(seg, "source", None)
                move = seg.get("moveType") if isinstance(seg, dict) else getattr(seg, "moveType", None)

                if not src or not move:
                    result["invalidToolpathSegments"].append({
                        "operationId": op_id,
                        "reason": f"Missing source={src} or moveType={move}",
                    })

                if src in BANNED_SOURCES:
                    result["debugGeometryLeakedToToolpaths"].append(op_id)
                    result["errors"].append(f"Operation {op_id}: segment uses banned source '{src}'")
                    result["status"] = "error"
                    break
                if src and src not in ALLOWED_SOURCES:
                    result["invalidViewportPayload"].append(op_id)
                    result["errors"].append(f"Operation {op_id}: segment uses unknown source '{src}'")
                    result["status"] = "error"
                    break

            # 4h. Boss machining region check
            feat_type = feat.get("type", "")
            if feat_type == "boss":
                mr_status = feat.get("machining_region")
                if mr_status == "error":
                    result["bossMappingFailures"].append(feat_id)
                    result["errors"].append(f"Operation {op_id}: boss feature {feat_id} has invalid machining region")
                    result["status"] = "error"

        # ----------------------------------------------------------
        # 5. Duplicate operations (same feature + same type)
        # ----------------------------------------------------------
        for key, op_ids in ops_per_feature.items():
            if len(op_ids) > 1:
                result["duplicateOperations"].append({
                    "key": key,
                    "operationIds": op_ids,
                })
                feat_id_part = key.split(":")[0]
                op_type_part = key.split(":")[1] if ":" in key else ""
                if op_type_part == "boss_clearing":
                    result["duplicateBossOperations"].append({
                        "featureId": feat_id_part,
                        "operationIds": op_ids,
                    })

        # Set status to error if any non-empty failure buckets
        for bucket_key in [
            "duplicateFeatures", "duplicateOperations", "operationWithoutValidFeature",
            "operationWithoutValidRegion", "duplicateBossOperations",
            "debugGeometryLeakedToToolpaths", "operationSetupMismatch",
            "bossFloorMissing", "duplicateFeatureAssignments",
        ]:
            if result[bucket_key]:
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
