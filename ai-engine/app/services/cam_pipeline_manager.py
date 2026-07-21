import json
import os
import shutil
from pathlib import Path
from typing import Dict, Any, List
from app.services.cam_input_router import CamInputRouter
from app.services.io.step_import_service import StepImportService
from app.services.geometry.cam_feature_recognition import CamFeatureRecognition
from app.services.planning.cam_setup_analyzer import CamSetupAnalyzer
from app.services.gcode.machine_type_detector import MachineTypeDetector
from app.services.planning.operation_planner import OperationPlanner
from app.services.planning.operation_strategy_planner import OperationStrategyPlanner
from app.services.planning.setup_planner import SetupPlanner
from app.services.tooling.tool_recommendation_engine import ToolRecommendationEngine
from app.services.toolpath.toolpath_engine import ToolpathEngine, ALLOWED_SOURCES, BANNED_SOURCES
from app.services.validation.toolpath_validator import ToolpathValidator
from app.models.schemas import MachineCapability
from app.models.manufacturing import MachineProfile, MaterialProfile, ToolProfile, FeatureDecision
from app.services.validation.manufacturing_capability_matrix import ManufacturingCapabilityMatrix
from app.services.planning.manufacturing_strategy_planner import ManufacturingStrategyPlanner
from app.services.gcode.gcode_generator import PostProcessorFactory
from app.services.geometry.topology_extractor import TopologyExtractor
from app.services.geometry.geometry_mapper import GeometryMapper
from app.services.validation.coordinate_validator import CoordinateValidator

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
        self.coord_validator = CoordinateValidator()
        
    def analyze_features(self, step_file_path: str, job_id: str, cam_run_id: str, setup: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        Performs Phase 2 Analysis: STEP import, B-Rep Analysis, Feature Recognition,
        and Setup-Aware Machinability Analysis.
        Does NOT generate toolpaths or G-code.
        """
        from app.services.io.step_importer import StepImporter
        
        # 1. Import and Validate Topology
        topology_info = self.step_importer.import_and_validate(step_file_path)
        
        # 1a. Validate Coordinate System (Constraint C5)
        shape, metadata = StepImporter.load_and_heal(step_file_path)
        if metadata:
             self.coord_validator.validate_step_units(metadata)
        
        from app.services.geometry.setup_coordinate_resolver import SetupCoordinateResolver
        
        resolver = SetupCoordinateResolver(shape, setup or {})
        shape_in_setup = resolver.create_setup_space_copy()
        setup_metadata = resolver.get_setup_metadata()
        
        # 2. Extract B-Rep Features (Topology Extraction + Recognition)
        features = self.feature_recognizer.recognize_features(shape=shape_in_setup)
        
        # 3. Geometry Mapping (Constraint C3)
        mapper = GeometryMapper(self.feature_recognizer.extractor)
        features = mapper.enrich_features(features, setup or {})
        
        # 4. Setup-Aware Machinability Analysis using Setup Planner
        # We need a MachineCapability object. For now, construct one based on setup or defaults.
        caps = MachineCapability()
        base_wcs = setup.get("wcs") if setup else "G54"
        setup_plans = self.setup_planner.plan_setups(
            features, 
            caps, 
            stock_orientation=setup.get("stockOrientation", "top_z") if setup else "top_z",
            base_wcs=base_wcs,
            default_tool_axis=setup.get("toolAxis", [0.0, 0.0, 1.0]) if setup else [0.0, 0.0, 1.0],
            topology_info=topology_info
        )
        
        # Override the planner's heuristic transform with the exact one used for extraction
        if setup_plans and setup_metadata.get("modelToSetupTransform"):
            flat_matrix = setup_metadata["modelToSetupTransform"]
            if len(flat_matrix) == 16:
                matrix_4x4 = [
                    flat_matrix[0:4],
                    flat_matrix[4:8],
                    flat_matrix[8:12],
                    flat_matrix[12:16]
                ]
                setup_plans[0].modelToSetupTransform = matrix_4x4
        
        # Validate feature depths to prevent cutting deeper than physical stock
        self._validate_feature_depths_against_stock(features, setup_metadata)
        
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
                f["status"] = "not_machinable"
                f["statusReason"] = f.get("blocked_reason", "Not machinable in current setup")
            elif f.get("geometry", {}).get("status") == "error" or f.get("geometry", {}).get("status") == "failed":
                validation_status = "error"
                failed_count += 1
                f["status"] = "not_machinable"
                f["statusReason"] = "Geometry extraction failed"
            else:
                mapped_count += 1
                if "status" not in f:
                    f["status"] = "machinable"
                
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
            "setup_metadata": setup_metadata
        }
        
    def _generate_stock_boundary(self, setup_metadata: Dict[str, Any]) -> list:
        stock = setup_metadata.get("resolvedStock", {})
        bounds = stock.get("bounds", {"min": [0,0,0], "max": [0,0,0]})
        s_min_x, s_min_y, _ = bounds["min"]
        s_max_x, s_max_y, _ = bounds["max"]
        
        if stock.get("stockType") == "cylinder":
            # Generate a circular polygon for cylindrical stock
            import math
            cx = (s_min_x + s_max_x) / 2.0
            cy = (s_min_y + s_max_y) / 2.0
            radius = min(s_max_x - s_min_x, s_max_y - s_min_y) / 2.0
            points = []
            num_points = 64
            for i in range(num_points):
                angle = 2 * math.pi * i / num_points
                points.append([cx + radius * math.cos(angle), cy + radius * math.sin(angle)])
            return points
            
        # Default box boundary
        return [
            [s_min_x, s_min_y],
            [s_max_x, s_min_y],
            [s_max_x, s_max_y],
            [s_min_x, s_max_y]
        ]

    def auto_plan_cam(self, step_file_path: str, machine_config: Dict[str, Any], job_id: str = "default_job") -> Dict[str, Any]:
        """
        Production-Grade Auto Generate Operations Pipeline.
        """
        # 1. Initialize Manufacturing Profiles
        machine = MachineProfile(**machine_config.get("machine_profile", {
            "machine_id": "m1", "machine_name": "Default 3-Axis", "machine_type": "3_axis_mill",
            "axis_count": 3,
            "supported_operations": ["drilling", "facing", "pocket_milling", "2d_contour", "boss_clearing", "slot_milling", "chamfer_milling"]
        }))
        material = MaterialProfile(**machine_config.get("material_profile", {
            "material_id": "mat1", "material_name": "Aluminum 6061", "cutting_speed": 300, "feed_per_tooth": 0.08
        }))
        # Create default tools if not provided
        default_tools = [
            ToolProfile(tool_id="t1", name="1/4 Flat End Mill", type="flat_end_mill", diameter=6.35, flute_count=3, cutting_length=20.0, stickout=30.0),
            ToolProfile(tool_id="t2", name="1/2 Flat End Mill", type="flat_end_mill", diameter=12.7, flute_count=3, cutting_length=30.0, stickout=40.0),
            ToolProfile(tool_id="t3", name="1/4 Drill", type="drill", diameter=6.35, flute_count=2, cutting_length=25.0, stickout=35.0),
            ToolProfile(tool_id="t4", name="Turning Tool", type="turning_tool", diameter=0, flute_count=1, cutting_length=0, stickout=0),
            ToolProfile(tool_id="t5", name="1/4 Reamer", type="reamer", diameter=6.35, flute_count=6, cutting_length=20.0, stickout=30.0),
            ToolProfile(tool_id="t6", name="M6 Tap", type="tap", diameter=6, flute_count=3, cutting_length=20.0, stickout=30.0),
            ToolProfile(tool_id="t7", name="10mm Boring Bar", type="boring_bar", diameter=10, flute_count=1, cutting_length=30.0, stickout=40.0),
            ToolProfile(tool_id="t8", name="2in Face Mill", type="face_mill", diameter=50.8, flute_count=5, cutting_length=10.0, stickout=25.0),
            ToolProfile(tool_id="t9", name="3mm Cut-off Tool", type="cut_off_tool", diameter=3, flute_count=1, cutting_length=20.0, stickout=30.0)
        ]
        tool_library = [ToolProfile(**t) for t in machine_config.get("tool_library", [])] if machine_config.get("tool_library") else default_tools
        tool_engine = ToolRecommendationEngine(tool_library)

        # 2. Feature Recognition & Geometry Mapping
        from app.services.io.step_importer import StepImporter
        from app.services.geometry.setup_coordinate_resolver import SetupCoordinateResolver
        
        topology_info = self.step_importer.import_and_validate(step_file_path)
        shape, metadata = StepImporter.load_and_heal(step_file_path)
        
        user_setup = machine_config.get("setup", {})
        default_setup = user_setup if user_setup else {"toolAxis": [0.0, 0.0, 1.0]}
        if "toolAxis" not in default_setup:
            default_setup["toolAxis"] = [0.0, 0.0, 1.0]
            
        resolver = SetupCoordinateResolver(shape, default_setup)
        shape_in_setup = resolver.create_setup_space_copy()
        setup_metadata = resolver.get_setup_metadata()
        
        features = self.feature_recognizer.recognize_features(shape=shape_in_setup)
        
        # Synthesize Roughing Features based on Stock Dimensions
        if "resolvedStock" in setup_metadata:
            import uuid
            stock_bounds = setup_metadata["resolvedStock"]["bounds"]
            model_bb = shape_in_setup.bounding_box()
            tol = 0.1
            
            # Stock bounds are already transformed into setup space by the coordinate resolver
            s_max_x, s_max_y, s_max_z = stock_bounds["max"]
            s_min_x, s_min_y, s_min_z = stock_bounds["min"]
            
            # Facing: if stock max Z > model max Z
            if s_max_z > model_bb.max.Z + tol:
                features.insert(0, {
                    "id": f"feat_synthetic_face_{uuid.uuid4().hex[:6]}",
                    "type": "face",
                    "name": "Face Top of Stock",
                    "geometry": {"status": "synthetic"},
                    "machiningRegion": {
                        "topZ": s_max_z,
                        "bottomZ": model_bb.max.Z,
                        "valid": True,
                        "boundary": self._generate_stock_boundary(setup_metadata)
                    }
                })
                
            # Boundary Roughing: if stock X or Y > model X or Y
            if (s_max_x > model_bb.max.X + tol or 
                s_min_x < model_bb.min.X - tol or
                s_max_y > model_bb.max.Y + tol or 
                s_min_y < model_bb.min.Y - tol):
                # Clamp depth to not exceed the stock boundary
                bottom_z = max(model_bb.min.Z, s_min_z)
                depth = s_max_z - bottom_z
                features.insert(1, {
                    "id": f"feat_synthetic_rough_{uuid.uuid4().hex[:6]}",
                    "type": "contour",
                    "subtype": "outer_profile",
                    "name": "Rough Outer Boundary",
                    "geometry": {"status": "synthetic"},
                    "dimensions": {"depth": depth},
                    "machiningRegion": {
                        "topZ": s_max_z,
                        "bottomZ": bottom_z,
                        "valid": True,
                        "boundary": self._generate_stock_boundary(setup_metadata)
                    }
                })
                
        mapper = GeometryMapper(self.feature_recognizer.extractor)
        
        # Filter out synthetic features from being enriched by OCP mapper
        core_features = [f for f in features if f.get("geometry", {}).get("status") != "synthetic"]
        synthetic_features = [f for f in features if f.get("geometry", {}).get("status") == "synthetic"]
        
        core_features = mapper.enrich_features(core_features, default_setup)
        features = synthetic_features + core_features
        
        # Validate feature depths to prevent cutting deeper than physical stock
        self._validate_feature_depths_against_stock(features, setup_metadata)
        
        features = self._sanitize_for_api(features)
        
        for f in features:
            if not f.get("machinable_in_current_setup", True):
                f["status"] = "not_machinable"
                f["statusReason"] = f.get("blocked_reason", "Not machinable in current setup")
            elif f.get("geometry", {}).get("status") == "error" or f.get("geometry", {}).get("status") == "failed":
                f["status"] = "not_machinable"
                f["statusReason"] = "Geometry extraction failed"
            else:
                if "status" not in f:
                    f["status"] = "machinable"
        
        validation_status = "success"
        geometry_mapping_summary = {"status": "success", "warnings": [], "errors": []}
        stock_suggestions = {}
        cam_validation = {}
        
        # 3. Setup Planning
        caps = MachineCapability(**machine_config.get("machine_capability", {}))
        base_wcs = machine_config.get("setup", {}).get("wcs") or "G54"
        setup_plans = self.setup_planner.plan_setups(
            features, caps, topology_info=topology_info, base_wcs=base_wcs
        )
        
        # Override the planner's basic Z-shift with the precise coordinate resolver matrix
        for sp in setup_plans:
            sp.modelToSetupTransform = setup_metadata.get("modelToSetupTransform", sp.modelToSetupTransform)

        
        all_operations = []
        decision_trace = []
        
        # Pipeline execution per setup
        for sp in setup_plans:
            setup_id = sp.setupId
            # Process ONLY assigned features for this setup to prevent duplicate blocked operations
            all_setup_features = [f for f in features if f.get("id") in sp.assignedFeatureIds]
            setup_decisions = []
            
            for feature in all_setup_features:
                # 3.0 Transform feature to setup-local coordinates
                local_feature = self._transform_feature_to_setup_local(feature, sp)
                
                decision = FeatureDecision(feature_id=feature.get("id"), feature_type=feature.get("type", ""))
                decision.setup_assignment = setup_id
                
                if not feature.get("machinable_in_current_setup", True):
                    decision.status = "blocked"
                    decision.operation_type = "blocked"
                    decision.reason = feature.get("blocked_reason", "Exceeds physical stock boundaries")
                    setup_decisions.append(decision)
                    continue
                
                # 3a. Manufacturing Capability Validation
                is_capable, cap_reason, rec_machine = ManufacturingCapabilityMatrix.evaluate_capability(feature, machine, sp.toolAxis)
                decision.machine_capability_result = is_capable
                
                # 3b. Manufacturing Strategy
                strategy = ManufacturingStrategyPlanner.determine_strategy(feature, machine.machine_type, sp.toolAxis)
                decision.manufacturing_strategy = strategy
                decision.operation_type = strategy
                
                if strategy == "unknown_strategy":
                    decision.status = "blocked"
                    decision.reason = f"No strategy mapped for feature type: {decision.feature_type}"
                    setup_decisions.append(decision)
                    continue

                if not is_capable:
                    decision.status = "blocked"
                    decision.reason = cap_reason
                    decision.recommended_machine = rec_machine
                    setup_decisions.append(decision)
                    continue
                
                # 3c. Tool Selection & Feeds/Speeds (ONLY if capable)
                tool, t_status, t_reason, feeds = tool_engine.recommend_tool(strategy, feature, machine, material)
                if not tool:
                    decision.status = "blocked"
                    decision.reason = t_reason
                    setup_decisions.append(decision)
                    continue
                    
                decision.selected_tool = tool.model_dump()
                decision.tool_selection_reason = t_reason
                decision.feeds_and_speeds = feeds
                decision.status = t_status
                decision.reason = "Ready for toolpath generation" if t_status == "ready" else "Ready with warnings"
                
                # Attach local feature to decision for downstream use
                decision.parameters["setup_local_feature"] = local_feature.model_dump() if hasattr(local_feature, "model_dump") else local_feature
                setup_decisions.append(decision)
                
            decision_trace.extend([d.model_dump() for d in setup_decisions])
            
            # 3d. Operation Planning (Ordering and Generation)
            ops = self.operation_strategy_planner.plan_operations(setup_decisions, setup_id)
            for op in ops:
                # Attach the local feature directly to the operation
                local_feat_dict = next((d.parameters.get("setup_local_feature") for d in setup_decisions if d.feature_id == op.feature_id), None)
                if local_feat_dict:
                    op.parameters["setup_local_feature"] = local_feat_dict
                all_operations.append(op.to_dict())
                
        # 4. Feature Coverage Validation & Fallback Planning
        feature_ids = {f.get("id") for f in features if f.get("id") and f.get("requiredMachining", True)}
        decision_feature_ids = {d.get("feature_id") for d in decision_trace}
        missing_features_ids = list(feature_ids - decision_feature_ids)
        
        # Only fallback for truly orphaned features (not handled by assigned or unassigned loops)
        missing_decisions = []
        for feat_id in missing_features_ids:
            feature = next((f for f in features if f.get("id") == feat_id), None)
            if not feature: continue
            
            decision = FeatureDecision(feature_id=feat_id, feature_type=feature.get("type", ""))
            
            info = feature.get("machining_info", {})
            decision.status = "unsupported"
            decision.operation_type = "unsupported_feature"
            decision.reason = info.get("reason") or "Unsupported feature type or configuration"
            
            decision.setup_assignment = setup_plans[0].setupId if setup_plans else "setup_1"
            missing_decisions.append(decision)
            
        decision_trace.extend([d.model_dump() for d in missing_decisions])
        
        if missing_decisions:
            ops = self.operation_strategy_planner.plan_operations(missing_decisions, setup_plans[0].setupId if setup_plans else "setup_1")
            for op in ops:
                all_operations.append(op.to_dict())

        # Re-compute missing features after fallback
        decision_feature_ids_final = {d.get("feature_id") for d in decision_trace}
        final_missing = list(feature_ids - decision_feature_ids_final)
        
        # Write Debug and Traces
        job_dir = Path(__file__).resolve().parents[3] / "storage" / "jobs" / job_id / "cam"
        job_dir.mkdir(parents=True, exist_ok=True)
        
        with open(job_dir / "cam_decision_trace.json", "w") as fp:
            json.dump(decision_trace, fp, indent=2, default=str)
            
        with open(job_dir / "cam_operation_report.json", "w") as fp:
            json.dump(all_operations, fp, indent=2, default=str)
            
        cam_validation = {
            "totalFeatures": len(feature_ids),
            "totalDecisions": len(decision_trace),
            "missingDecisionFeatures": final_missing,
            "unsupportedFeatures": [d.get("feature_id") for d in decision_trace if d.get("status") == "unsupported"],
            "blockedFeatures": [d.get("feature_id") for d in decision_trace if d.get("status") == "blocked"],
            "readyOperations": sum(1 for op in all_operations if op.get("status") == "ready"),
            "warningOperations": sum(1 for op in all_operations if op.get("status") == "warning"),
            "errorOperations": sum(1 for op in all_operations if op.get("status") in ("error", "blocked", "unsupported")),
            "featureCoveragePassed": len(final_missing) == 0
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
        
        feature_map = {f.get("id"): f for f in features}
        
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
                mr = feat.get("machiningRegion") or {}
                
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
                            "reason": (op.get("parameters") or {}).get("errorReason") or (op.get("parameters") or {}).get("error", "")
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
            "setups": [s.model_dump() for s in setup_plans] if setup_plans else [],
            "validation": {
                "status": validation_status,
                "summary": geometry_mapping_summary
            },
            "stock_suggestions": stock_suggestions,
            "setup_metadata": setup_metadata,
            "tools": [t.model_dump() for t in tool_library],
            "operations": all_operations,
            "cam_validation": cam_validation
        }
        

    def clear_downstream_cache(self, job_dir: Path, changed_keys: List[str] = None):
        """
        Deletes old generated toolpath outputs and operation status caches,
        but preserves current CamOperation definitions.
        If changed_keys is provided, performs dependency-based invalidation.
        For example, if only 'postProcessor' changed, it preserves toolpaths.
        """
        import shutil
        files_to_remove = set([
            "cam_gcode.nc",
            "cam_simulation.json",
            "cam_validation.json",
            "cam_operation_summary.json",
            "cam_toolpaths.json",
            "cam_decision_trace.json",
            "cam_setup_plan.json",
            "cam_regions.json",
            "cam_feature_machining_info.json",
            "cam_operation_plan.json"
        ])
        
        if changed_keys:
            # If only postProcessorId or controllerId changed, we ONLY need to invalidate G-code
            non_gcode_changes = [k for k in changed_keys if k not in ["postProcessor", "postProcessorId", "controller", "controllerId"]]
            if not non_gcode_changes:
                # Keep toolpaths and simulation intact
                files_to_remove -= {"cam_toolpaths.json", "cam_simulation.json", "cam_validation.json", "cam_setup_plan.json"}
        # Do NOT delete cam_toolpath_engine_input.json or cam_features.json
        for fname in files_to_remove:
            p = job_dir / fname
            if p.exists():
                try:
                    p.unlink()
                except Exception as e:
                    print(f"Warning: failed to delete {fname}: {e}")
                    
        # If there are simulation or preview subdirectories, clear them too
        for dname in ["preview_cache"]:
            d = job_dir / dname
            if d.exists() and d.is_dir():
                try:
                    shutil.rmtree(d)
                except Exception as e:
                    print(f"Warning: failed to delete {dname}: {e}")
                    
    def generate_toolpaths(self, step_file_path: str, job_id: str, cam_run_id: str, setup: Dict[str, Any], setups: List[Dict[str, Any]], tools: List[Dict[str, Any]], operations: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Performs Phase 7: Toolpath Generation based strictly on User Setup, Tools, and Approved Operations.
        No auto-generation or fallback loops allowed.
        """
        from app.services.io.step_importer import StepImporter
        from app.services.geometry.setup_coordinate_resolver import SetupCoordinateResolver
        
        shape, metadata = StepImporter.load_and_heal(step_file_path)
        
        resolver = SetupCoordinateResolver(shape, setup)
        shape_in_setup = resolver.create_setup_space_copy()
        setup_metadata = resolver.get_setup_metadata()
        
        features = self.feature_recognizer.recognize_features(shape=shape_in_setup)
        
        # Re-inject synthetic features with the exact IDs requested by the operations
        if "resolvedStock" in setup_metadata:
            synthetic_face_op = next((op for op in operations if str(op.get("feature_id", "")).startswith("feat_synthetic_face")), None)
            if synthetic_face_op:
                features.insert(0, {
                    "id": synthetic_face_op["feature_id"],
                    "type": "face",
                    "name": "Face Top of Stock",
                    "geometry": {"status": "synthetic"}
                })
                
            synthetic_rough_op = next((op for op in operations if str(op.get("feature_id", "")).startswith("feat_synthetic_rough")), None)
            if synthetic_rough_op:
                features.insert(1, {
                    "id": synthetic_rough_op["feature_id"],
                    "type": "contour",
                    "subtype": "outer_profile",
                    "name": "Rough Outer Boundary",
                    "geometry": {"status": "synthetic"}
                })
        
        # Keep raw features for debug
        import copy
        raw_features = copy.deepcopy(features)
        
        mapper = GeometryMapper(self.feature_recognizer.extractor)
        
        feat_map = {f['id']: f for f in features}
        setup_map = {s.get("setupId", s.get("id")): s for s in (setups or [])}
        
        for op in operations:
            # Reset operation status and errors from previous runs
            op['status'] = 'planned'
            if 'parameters' in op and 'error' in op['parameters']:
                del op['parameters']['error']
                
            feat_id = op.get('feature_id') or op.get('featureId')
            tool_id = op.get('toolId') or op.get('tool_id')
            strategy = op.get('machining_strategy') or op.get('type')
            op_type = op.get('type', '')
            
            # Blocked/unsupported operations have no tool and no geometry — skip all validation
            if op_type in ('turning_required', 'unsupported_feature') or \
               strategy in ('turning_required', 'unsupported_feature') or \
               (not tool_id and op_type not in ('drilling', 'pocketing', '2d_contour', '2d_contour_outer',
                    'facing', 'boss_clearing', 'slot_milling', 'chamfer_milling', 'od_turning',
                    'rotary_milling', 'indexed_4axis_milling', 'indexed_5axis_milling', 'multi_axis_surface_milling', 'tapping')):
                op['status'] = 'unsupported'
                op['toolpaths'] = []
                op['machiningRegion'] = None
                continue
            
            if not feat_id or not strategy:
                raise ValueError(f"Every operation must include a valid featureId and strategy. Received: {op}")
                
            if feat_id not in feat_map:
                raise ValueError(f"Requested operation uses an unknown featureId: {feat_id}.")
            
            op_setup_id = op.get('setup_id') or op.get('setupId')
            op_setup = setup_map.get(op_setup_id, setup)
            
            # Isolate feature and analyze/map geometry specifically for its target setup
            feat_clone = copy.deepcopy(feat_map[feat_id])
            
            if feat_clone.get("geometry", {}).get("status") == "synthetic":
                bounds = setup_metadata.get("resolvedStock", {}).get("bounds", {"min": [0,0,0], "max": [100,100,10]})
                # Stock bounds are already transformed into setup space by the coordinate resolver
                s_max_x, s_max_y, s_max_z = bounds["max"]
                s_min_x, s_min_y, s_min_z = bounds["min"]
                model_bb = shape_in_setup.bounding_box()
                feat_clone["machinable_in_current_setup"] = True
                stock_type = setup.get("stockType") or setup_metadata.get("resolvedStock", {}).get("stockType", "box")
                if stock_type == "cylinder":
                    import math
                    cx = (s_max_x + s_min_x) / 2.0
                    cy = (s_max_y + s_min_y) / 2.0
                    r = (s_max_x - s_min_x) / 2.0
                    pts = []
                    for i in range(33): # 32 segments, close the loop
                        angle = i * (2 * math.pi / 32)
                        pts.append([cx + r * math.cos(angle), cy + r * math.sin(angle), s_max_z])
                else:
                    pts = [
                        [s_min_x, s_min_y, s_max_z],
                        [s_max_x, s_min_y, s_max_z],
                        [s_max_x, s_max_y, s_max_z],
                        [s_min_x, s_max_y, s_max_z],
                        [s_min_x, s_min_y, s_max_z]
                    ]
                if feat_clone["type"] == "face":
                    feat_clone["machiningRegion"] = {
                        "valid": True,
                        "regionType": "face_boundary",
                        "source": "face_boundary",
                        "boundary": pts,
                        "topZ": s_max_z,
                        "bottomZ": model_bb.max.Z
                    }
                elif feat_clone["type"] == "contour":
                    if stock_type == "cylinder":
                        import math
                        c_cx = (model_bb.max.X + model_bb.min.X) / 2.0
                        c_cy = (model_bb.max.Y + model_bb.min.Y) / 2.0
                        c_r = max((model_bb.max.X - model_bb.min.X) / 2.0, (model_bb.max.Y - model_bb.min.Y) / 2.0)
                        contour_pts = []
                        for i in range(33):
                            angle = i * (2 * math.pi / 32)
                            contour_pts.append([c_cx + c_r * math.cos(angle), c_cy + c_r * math.sin(angle), s_max_z])
                    else:
                        contour_pts = [
                            [model_bb.min.X, model_bb.min.Y, s_max_z],
                            [model_bb.max.X, model_bb.min.Y, s_max_z],
                            [model_bb.max.X, model_bb.max.Y, s_max_z],
                            [model_bb.min.X, model_bb.max.Y, s_max_z],
                            [model_bb.min.X, model_bb.min.Y, s_max_z]
                        ]
                    feat_clone["machiningRegion"] = {
                        "valid": True,
                        "regionType": "outer_wire",
                        "source": "outer_wire",
                        "boundary": contour_pts,
                        "topZ": s_max_z,
                        "bottomZ": max(model_bb.min.Z, s_min_z)
                    }
            else:
                mapper.enrich_features([feat_clone], op_setup)
                self.setup_analyzer.analyze([feat_clone], op_setup)
            
            # Check if feature is machinable in current setup — skip gracefully
            if not feat_clone.get('machinable_in_current_setup', True):
                blocked_reason = feat_clone.get('blocked_reason', 'Not machinable in current setup')
                op['status'] = 'error'
                op.setdefault('parameters', {})['error'] = f"Blocked: {blocked_reason}"
                continue
            
            # Check if machiningRegion mapping succeeded — skip gracefully
            mr = feat_clone.get('machiningRegion')
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
            
            allowed_sources = {
                "hole_center", "outer_wire", "face_boundary", "pocket_boundary",
                "boss_floor_minus_island", "turning_profile", "wrapped_cylindrical_surface", "cylinder_as_boss"
            }
            if mr.get('source') not in allowed_sources:
                op['status'] = 'error'
                op.setdefault('parameters', {})['error'] = f"Geometry mapping failed: Invalid region source {mr.get('source')}"
                op['machiningRegion'] = None
                continue
                
            # Inject geometry into operations
            op['machiningRegion'] = mr
            
        # 1. Pre-process and fix inverted Z coordinates, then determine global max Z
        max_z_top = 0.0
        for op in operations:
            mr = op.get('machiningRegion')
            if mr:
                z_top = mr.get('topZ')
                z_bottom = mr.get('bottomZ')
                if z_top is not None and z_bottom is not None and z_bottom > z_top:
                    mr['topZ'], mr['bottomZ'] = z_bottom, z_top
                
                if mr.get('topZ') is not None:
                    max_z_top = max(max_z_top, mr.get('topZ'))

        # 2. Assign safe heights using global clearance
        for op in operations:
            if not op.get('machiningRegion'):
                continue
            mr = op.get('machiningRegion')
            
            # Extract basic depth if z_top and z_bottom are zero
            z_top = mr.get('topZ', 0.0)
            z_bottom = mr.get('bottomZ', -10.0)
            
            # If Z top and bottom evaluate to 0, use feature properties as fallback
            if z_top == 0.0 and z_bottom == 0.0:
                # Find feature
                f_id = op.get('feature_id')
                feat = next((f for f in features if f.get('id') == f_id), None)
                if feat:
                    f_depth = feat.get('depth') or feat.get('dimensions', {}).get('depth') or 0.0
                    f_height = feat.get('height') or feat.get('dimensions', {}).get('height') or 0.0
                    
                    if f_depth > 0:
                        z_bottom = -f_depth
                    elif f_height > 0:
                        z_bottom = -f_height

                mr['topZ'] = z_top
                mr['bottomZ'] = z_bottom

            clearance_offset = setup.get('clearanceHeight', 15.0)
            retract_offset = setup.get('retractHeight', 5.0)
            feed_offset = setup.get('feedHeight', 2.0)
            
            op['safe_heights'] = {
                "top": z_top,
                "bottom": z_bottom,
                "clearance": max_z_top + clearance_offset,
                "retract": z_top + retract_offset,
                "feed": z_top + feed_offset
            }
            
        # Ensure mapping of tool to operation
        tool_dict = {t.get('id', t.get('tool_id')): t for t in tools if t.get('id') or t.get('tool_id')}
        for op in operations:
            tool_id_ref = op.get('toolId') or op.get('tool_id')
            if tool_id_ref and tool_id_ref in tool_dict:
                op['tool'] = tool_dict[tool_id_ref]

        # Output toolpath engine input debug
        job_dir = Path(__file__).resolve().parents[3] / "storage" / "jobs" / job_id / "cam"
        job_dir.mkdir(parents=True, exist_ok=True)
        self.clear_downstream_cache(job_dir)
        try:
            with open(job_dir / 'cam_toolpath_engine_input.json', 'w') as f:
                json.dump({
                    "operations": operations,
                    "setup": setup,
                    "tools": tools
                }, f, indent=2, default=str)
        except Exception as e:
            import traceback
            print(f"[ERROR] Failed to write cam_toolpath_engine_input.json: {e}")
            traceback.print_exc()

        # 4. Generate Toolpaths
        from app.services.toolpath.motion_planner import MotionPlanner
        motion_planner = MotionPlanner()
        toolpath_engine = ToolpathEngine()
        
        for op in operations:
            if op.get("status") in ("error", "blocked", "unsupported"):
                op["toolpaths"] = []
                continue
                
            machiningRegion = op.get("machiningRegion")
            tool = op.get("tool", {})
            try:
                # Transform machiningRegion to Setup Space
                transform = setup.get("modelToSetupTransform") if setup else None
                if transform and machiningRegion and machiningRegion.get("valid"):
                    import copy
                    machiningRegion = copy.deepcopy(machiningRegion)
                    
                    def transform_pt(pt):
                        x, y, z = pt[0], pt[1], pt[2] if len(pt) > 2 else 0.0
                        
                        # Flatten transform to handle both 1D and 2D arrays
                        if transform and isinstance(transform[0], list):
                            e = [item for sublist in transform for item in sublist]
                        else:
                            e = transform or [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]
                            
                        if len(e) == 16:
                            # The matrix is row-major (from setup_coordinate_resolver.py)
                            # e = [m11, m12, m13, tx,  m21, m22, m23, ty,  m31, m32, m33, tz,  0, 0, 0, 1]
                            nx = e[0]*x + e[1]*y + e[2]*z + e[3]
                            ny = e[4]*x + e[5]*y + e[6]*z + e[7]
                            nz = e[8]*x + e[9]*y + e[10]*z + e[11]
                        else:
                            nx, ny, nz = x, y, z
                            
                        return [nx, ny, nz] if len(pt) > 2 else [nx, ny]

                    if "boundary" in machiningRegion and machiningRegion["boundary"]:
                        machiningRegion["boundary"] = [transform_pt(p) for p in machiningRegion["boundary"]]
                    if "islands" in machiningRegion and machiningRegion["islands"]:
                        machiningRegion["islands"] = [[transform_pt(p) for p in isl] for isl in machiningRegion["islands"]]
                    if "center" in machiningRegion and machiningRegion["center"]:
                        machiningRegion["center"] = transform_pt(machiningRegion["center"])
                    if machiningRegion.get("topZ") is not None:
                        e = [item for sublist in transform for item in sublist] if (transform and isinstance(transform[0], list)) else (transform or [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1])
                        machiningRegion["topZ"] = (e[10] * machiningRegion["topZ"]) + e[14]
                    if machiningRegion.get("bottomZ") is not None:
                        e = [item for sublist in transform for item in sublist] if (transform and isinstance(transform[0], list)) else (transform or [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1])
                        machiningRegion["bottomZ"] = (e[10] * machiningRegion["bottomZ"]) + e[14]
                    if "axis" in machiningRegion and machiningRegion["axis"]:
                        x, y, z = machiningRegion["axis"]
                        e = [item for sublist in transform for item in sublist] if (transform and isinstance(transform[0], list)) else (transform or [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1])
                        if len(e) == 16:
                            nx = e[0]*x + e[4]*y + e[8]*z
                            ny = e[1]*x + e[5]*y + e[9]*z
                            nz = e[2]*x + e[6]*y + e[10]*z
                        else:
                            nx, ny, nz = x, y, z
                        mag = (nx**2 + ny**2 + nz**2)**0.5
                        if mag > 0:
                            machiningRegion["axis"] = [nx/mag, ny/mag, nz/mag]

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
        REGION_SOURCES = {"hole_center", "outer_wire", "face_boundary", "pocket_boundary", "boss_floor_minus_island", "turning_profile", "wrapped_cylindrical_surface"}
        BANNED_SOURCES = set()  # Reserved for future use

        for op in operations:
            if op.get("status") in ("error", "blocked", "unsupported"):
                invalid_ops += 1
                reason = (op.get("parameters") or {}).get("error", (op.get("parameters") or {}).get("errorReason", "Blocked or unsupported"))
                validation_reasons.append({"operationId": op.get("id"), "reason": reason})
                op["toolpaths"] = op.get("toolpaths", [])
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
                
        # Deduplicate drilling operations
        operations = self._deduplicate_drilling_operations(operations, features, setup)


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
        
        # Fetch machine limits
        machine_limits = None
        if setup:
            machine_type = setup.get("machineType", "MILL_3X_VMC")
            machine_profile_id = setup.get("machineProfileId") or setup.get("machineProfile") or "generic_mill_3x_vmc"
            
            import json
            matrix_path = Path(__file__).resolve().parents[3] / "web-ui" / "lib" / "cam" / "cam_machine_matrix.json"
            if matrix_path.exists():
                try:
                    with open(matrix_path, "r") as mf:
                        matrix_data = json.load(mf)
                        for profile in matrix_data.get("machineProfiles", []):
                            if profile.get("id") == machine_profile_id:
                                machine_limits = profile.get("limits")
                                break
                except Exception as e:
                    print(f"Warning: Failed to load machine limits: {e}")

        # Build ToolAssemblies mapping
        from app.models.tool_assembly import ToolAssembly
        tool_assemblies = {}
        for t in tools:
            ta = ToolAssembly.from_cam_tool(t)
            tool_assemblies[ta.tool_id] = ta

        # Validate full feature-operation-toolpath chain (Constraint C4, C6, and Phase 8)
        validation_result = self.validator.validate_pipeline(
            features, operations, 
            setup_metadata=setup_metadata, 
            engine_setup=setup, 
            machine_limits=machine_limits, 
            tool_assemblies=tool_assemblies
        )
        
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
                    "machiningRegionArea": (op.get("parameters") or {}).get("diagnostics", {}).get("region_area", 0),
                    "segmentCount": 0,
                    "sourceTypes": [],
                    "status": "error",
                    "errorReason": (op.get("parameters") or {}).get("error", "Unknown error"),
                    "tool_id": op.get("toolId") or op.get("tool_id"),
                    "toolId": op.get("toolId") or op.get("tool_id")
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
            elif seg_count == 0 and op.get("status") not in ("unsupported", "blocked", "error"):
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
                "machiningRegionArea": (op.get("machiningRegion") or {}).get("area", 0),
                "totalPathLength": round(total_path_length, 2),
                "cutDistance": round(cut_distance, 2),
                "rapidDistance": round(rapid_distance, 2),
                "plungeCount": plunge_count,
                "retractCount": retract_count,
                "segmentCount": seg_count,
                "estimatedCycleTime": round(est_cycle_time, 2),
                "sourceTypes": sources,
                "status": op.get("status", "planned"),
                "errorReason": error_reason,
                "tool_id": op.get("toolId") or op.get("tool_id"),
                "toolId": op.get("toolId") or op.get("tool_id")
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
        
        # Clear downstream artifacts to prevent stale cache usage
        try:
            for file_to_remove in ["cam_gcode.nc", "cam_simulation.json", "cam_validation.json", "cam_operation_summary.json"]:
                p = job_dir / file_to_remove
                if p.exists():
                    p.unlink()
        except Exception as e:
            print(f"Warning: failed to remove downstream artifact: {e}")
        
        # Read previous hashes to detect stale identical output
        cache_file = job_dir / "cam_hashes.json"
        if cache_file.exists():
            try:
                with open(cache_file, 'r') as f:
                    prev_hashes = json.load(f)

                if prev_hashes.get('toolpath_schema_version') != 'semantic_v1':
                    print("Toolpath schema version mismatch. Forcing regeneration.")
                    # Let it overwrite to force update

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
                "operationHash": operation_hash,
                "toolpath_schema_version": "semantic_v1"
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
                    "features": features,
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
                            "contourArea": (feat.get("machiningRegion") or {}).get("diagnostics", {}).get("mapped_area", 0.0),
                            "toolpathSegmentCount": op_seg_count,
                            "rejectedReason": (feat.get("machiningRegion") or {}).get("error", None)
                        })
                json.dump(contour_debugs, f, indent=2, default=str)
                
            with open(job_dir / 'cam_operation_summary.json', 'w') as f:
                json.dump(operation_summaries, f, indent=2, default=str)
                

            import datetime
            import datetime
            generated_at = datetime.datetime.now().isoformat()
            with open(job_dir / 'cam_toolpaths.json', 'w') as f:
                all_tp = []
                for op in operations:
                    op["toolpath_schema_version"] = "semantic_v1"
                    for tp in op.get("toolpaths", []):
                        tp["toolpath_schema_version"] = "semantic_v1"
                        tp["generated_at"] = generated_at
                        all_tp.append(tp)
                json.dump({
                    "toolpath_count": len(all_tp),
                    "toolpaths": all_tp,
                    "camRunId": cam_run_id,
                    "modelHash": model_hash,
                    "toolpath_schema_version": "semantic_v1",
                    "generated_at": generated_at
                }, f, indent=2, default=str)
                
            with open(job_dir / 'cam_operations.json', 'w') as f:
                json.dump({
                    "operations": operations,
                    "camRunId": cam_run_id,
                    "modelHash": model_hash,
                    "toolpath_schema_version": "semantic_v1",
                    "generated_at": generated_at
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
                        
                    geom = feat.get("machiningRegion") or {}
                    
                    overlay_debugs.append({
                        "featureId": feat_id,
                        "operationId": op.get("id"),
                        "featureType": feat.get("type"),
                        "operationType": op.get("type"),
                        "machiningRegionSource": geom.get("source", feat.get("source", "unknown")),
                        "bannedSourceDetected": banned_found,
                        "rejectionReason": (op.get("parameters") or {}).get("error"),
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
            "camModelHash": model_hash,
            "setup_metadata": setup_metadata
        }

    def _transform_feature_to_setup_local(self, feature: Dict[str, Any], setup_plan) -> Any:
        from app.models.schemas import SetupLocalFeature
        
        # Features were extracted from shape_in_setup, so they are ALREADY in setup space.
        z_shift = 0.0
        
        center = feature.get("center", [0, 0, 0])
        axis = feature.get("axis", [0, 0, 1])
        
        local_center = [center[0], center[1], center[2] + z_shift]
        
        # Calculate local bounds from machiningRegion or dimensions
        region = feature.get("machiningRegion", {})
        dims = feature.get("dimensions", {})
        
        if "topZ" in region and "bottomZ" in region:
            top_z = region.get("topZ", 0.0) + z_shift
            bottom_z = region.get("bottomZ", -10.0) + z_shift
        else:
            top_z = dims.get("z_top", 0.0) + z_shift
            bottom_z = dims.get("z_bottom", -10.0) + z_shift
            
        depth = top_z - bottom_z
        
        local_feat = SetupLocalFeature(
            featureId=feature.get("id", ""),
            setupId=setup_plan.setupId,
            featureType=feature.get("type", ""),
            localCenter=local_center,
            localAxis=axis,
            localTopZ=top_z,
            localBottomZ=bottom_z,
            depth=depth,
            parameters=feature.get("parameters", {})
        )
        
        # Transform machining region if present
        region = feature.get("machining_region", {})
        if region:
            local_region = dict(region)
            local_region["topZ"] = region.get("topZ", top_z - z_shift) + z_shift
            local_region["bottomZ"] = region.get("bottomZ", bottom_z - z_shift) + z_shift
            if "center" in region:
                rc = region["center"]
                local_region["center"] = [rc[0], rc[1], rc[2] + z_shift]
            local_feat.machiningRegion = local_region
            
        return local_feat

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

    def _validate_feature_depths_against_stock(self, features: List[Dict[str, Any]], setup_metadata: Dict[str, Any]) -> None:
        """
        Validates feature depths against the resolved stock boundaries.
        If a feature extends below the physical stock, it is marked as blocked.
        """
        if "resolvedStock" not in setup_metadata:
            return
            
        stock_bounds = setup_metadata["resolvedStock"]["bounds"]
        stock_min_z = stock_bounds["min"][2] - 0.01 # tiny tolerance
        stock_height = stock_bounds["max"][2] - stock_bounds["min"][2] + 0.01
        
        for f in features:
            is_blocked = False
            
            # Skip synthetic features as they are already constrained to the stock
            if f.get("geometry", {}).get("status") == "synthetic":
                continue
                
            if "dimensions" in f and "depth" in f["dimensions"]:
                f_depth = f["dimensions"]["depth"]
                z_top = f["dimensions"].get("z_top")
                
                # If z_top is known, we can accurately check the absolute depth
                if z_top is not None:
                    if z_top - f_depth < stock_min_z:
                        is_blocked = True
                else:
                    # If z_top isn't known, fallback to checking total stock height
                    if f_depth > stock_height:
                        is_blocked = True
            
            # Machining region depth (used by drills and some other ops)
            if not is_blocked and "machiningRegion" in f and isinstance(f["machiningRegion"], dict):
                mr = f["machiningRegion"]
                if "depth" in mr:
                    mr_depth = mr["depth"]
                    z_top = mr.get("topZ")
                    if z_top is not None:
                        if z_top - mr_depth < stock_min_z:
                            is_blocked = True
                    else:
                        if mr_depth > stock_height:
                            is_blocked = True
                            
            if is_blocked:
                f["machinable_in_current_setup"] = False
                f["blocked_reason"] = "Feature extends below the physical stock boundaries."

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

    def _deduplicate_drilling_operations(self, operations: List[Dict[str, Any]], features: List[Dict[str, Any]] = None, setup: Dict[str, Any] = None) -> List[Dict[str, Any]]:
        deduped = []
        # Group by dedupeKey
        seen_drills = []
        for op in operations:
            if op.get("status") == "error" or op.get("type") != "drilling":
                deduped.append(op)
                continue
                
            local_feat = op.get("parameters", {}).get("setup_local_feature", {})
            if not local_feat:
                deduped.append(op)
                continue
                
            setup_id = op.get("setupId") or op.get("setup_id")
            tool_id = op.get("toolId") or op.get("tool_id")
            
            # Extract coordinates and params
            center = local_feat.get("localCenter", [0, 0, 0])
            cx, cy = center[0], center[1]
            final_z = local_feat.get("localBottomZ", 0.0)
            
            # Tool diameter
            tool = op.get("tool") or {}
            diameter = tool.get("geometry", {}).get("DC", 0.0)
            
            # Check against seen drills
            is_duplicate = False
            
            # Use dynamic tolerance from setup if available, fallback to 0.01 for general positions
            base_tol = setup.get("tolerance", 0.01) if setup else 0.01
            tolerance = float(base_tol)
            
            for seen in seen_drills:
                if (seen["setup_id"] == setup_id and 
                    seen["tool_id"] == tool_id and 
                    abs(seen["cx"] - cx) <= tolerance and 
                    abs(seen["cy"] - cy) <= tolerance and 
                    abs(seen["final_z"] - final_z) <= tolerance and 
                    abs(seen["diameter"] - diameter) <= tolerance):
                    
                    is_duplicate = True
                    # Merge metadata
                    seen_op = seen["op"]
                    if "dedupedFromCount" not in seen_op.get("parameters", {}):
                        seen_op.setdefault("parameters", {})["dedupedFromCount"] = 1
                        seen_op.setdefault("parameters", {})["sourceFeatureIds"] = [seen_op.get("featureId") or seen_op.get("feature_id")]
                        seen_op.setdefault("parameters", {})["dedupeReason"] = f"Merged colinear/duplicate drilling cycles within {tolerance}mm tolerance"
                    
                    seen_op["parameters"]["dedupedFromCount"] += 1
                    fid = op.get("featureId") or op.get("feature_id")
                    if fid not in seen_op["parameters"]["sourceFeatureIds"]:
                        seen_op["parameters"]["sourceFeatureIds"].append(fid)
                    break
                    
            if not is_duplicate:
                seen_drills.append({
                    "setup_id": setup_id,
                    "tool_id": tool_id,
                    "cx": cx,
                    "cy": cy,
                    "final_z": final_z,
                    "diameter": diameter,
                    "op": op
                })
                deduped.append(op)
                
        # Validate that if multiple drilling ops collapse to same X/Y, they must actually be concentric
        for op in deduped:
            if op.get("type") == "drilling" and op.get("status") != "error":
                source_fids = op.get("parameters", {}).get("sourceFeatureIds", [])
                if len(source_fids) > 1 and features is not None:
                    # Check original features
                    feat_map = {f.get("id") or f.get("feature_id"): f for f in features}
                    original_centers = []
                    for fid in source_fids:
                        if fid in feat_map:
                            original_centers.append(feat_map[fid].get("center", [0,0,0]))
                            
                    if original_centers:
                        first_orig = original_centers[0]
                        # Use dynamic tolerance / 10 for co-linear center validations
                        tolerance = float(setup.get("tolerance", 0.01) if setup else 0.01) / 10.0
                        all_orig_same_xy = all(
                            abs(c[0] - first_orig[0]) < tolerance and
                            abs(c[1] - first_orig[1]) < tolerance
                            for c in original_centers
                        )
                        
                        if not all_orig_same_xy:
                            op["status"] = "error"
                            op.setdefault("parameters", {})["error"] = "Drill center mapping failed"

        return deduped
