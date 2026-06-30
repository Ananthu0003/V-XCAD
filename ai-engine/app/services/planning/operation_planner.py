import uuid
from typing import List, Dict, Any

class CamOperation:
    """Represents a planned machining operation linked to a specific feature."""
    def __init__(self, operation_type: str, feature_id: str, setup_id: str = "setup_1"):
        self.id = f"op_{uuid.uuid4().hex[:8]}"
        self.type = operation_type
        self.name = f"{operation_type} Operation"
        self.feature_id = feature_id
        self.setup_id = setup_id
        self.tool_id = None
        self.machining_strategy = "default"
        self.status = "planned"
        
        # Phase 3: Machinability Validation
        self.machinable_in_current_setup = True
        self.requires_reorientation = False
        
        # Standard Safe Height System (Z coordinates)
        self.safe_heights = {
            "clearance": 15.0,  # Rapid height between operations
            "retract": 5.0,     # Height to lift tool out of cut
            "feed": 2.0,        # Height to switch from Rapid to Feed rate
            "top": 0.0,         # Top of stock or feature
            "bottom": -10.0     # Final cutting depth
        }
        self.parameters = {}
        self.toolpaths = []
        self.feature_center = [0, 0, 0]
        self.geometry = {}
        
    def to_dict(self):
        return self.__dict__

class OperationPlanner:
    """
    Translates extracted B-Rep features into an ordered list of concrete 
    CNC operations. Preserves full traceability.
    
    Strict rules:
    - Do not create operations for blocked features.
    - Do not create operations where featureId is None.
    - Do not create operations where geometry mapping failed.
    - Only map from valid feature type → operation type whitelist.
    """
    
    # Valid feature type → operation type mapping
    FEATURE_TO_OPERATION = {
        "hole": "drilling",
        "blind_hole": "drilling",
        "through_hole": "drilling",
        "boss": "boss_clearing",
        "pocket": "pocketing",
        "contour": "2d_contour",
        "face": "facing",
        "step": "2d_contour",
        "external_cylinder": "od_turning",
        "shaft": "od_turning",
        "side_protrusion": "rotary_milling",
        "turned_od": "od_turning",
    }
    
    def __init__(self):
        pass
        
    def plan_operations(self, features: List[Dict[str, Any]], machine_type: str) -> List[Dict[str, Any]]:
        operations = []
        
        for feature in features:
            if not feature.get('requiredMachining', True):
                continue
            
            feat_id = feature.get('id')
            
            # Strict: Skip features with no ID
            if not feat_id:
                feature["diagnostic"] = "Skipped: Feature ID is null"
                feature["geometry_status"] = "error"
                continue
            
            # Strict: Skip features blocked by setup analysis
            if not feature.get('machinable_in_current_setup', True):
                blocked_reason = feature.get('blocked_reason', 'Not machinable in current setup')
                feature["diagnostic"] = f"Blocked: {blocked_reason}"
                continue
            
            # Strict: Skip features where geometry mapping failed
            geom = feature.get('geometry', {})
            if geom.get('status') == 'failed' or geom.get('status') == 'error':
                feature["diagnostic"] = f"Skipped: Geometry mapping failed — {geom.get('error', 'unknown')}"
                feature["geometry_status"] = "error"
                continue
            
            # Strict: Skip features with missing machining region (non-drilling)
            feat_type = feature.get('type', '')
            machining_region = feature.get('machining_region')
            if feat_type not in ('hole', 'blind_hole', 'through_hole') and machining_region == 'error':
                feature["diagnostic"] = "Skipped: Machining region is missing or invalid"
                feature["geometry_status"] = "error"
                continue
                
            op = self._map_feature_to_operation(feature, machine_type)
            if op:
                if op.status == "error":
                    feature["diagnostic"] = f"Failed to plan operation: {op.parameters.get('error', 'Unknown error')}"
                    feature["geometry_status"] = "error"
                else:
                    operations.append(op)
                
        # Apply strategic sorting 
        sort_order = {
            "facing": 1,
            "drilling": 2,
            "pocketing": 3,
            "boss_clearing": 4,
            "2d_contour": 5,
        }
        
        operations.sort(key=lambda op: sort_order.get(op.type, 99))
        return [op.to_dict() for op in operations]
        
    def _map_feature_to_operation(self, feature: Dict[str, Any], machine_type: str) -> CamOperation:
        feat_type = feature.get('type')
        feat_id = feature.get('id')
        
        # Use the strict whitelist
        op_type = self.FEATURE_TO_OPERATION.get(feat_type)
        if not op_type:
            # Unsupported feature type — skip entirely, do not create fallback
            feature["diagnostic"] = f"Skipped: Unsupported feature type '{feat_type}'"
            return None
        
        op = CamOperation(op_type, feat_id)
        
        if op_type == "drilling":
            op.tool_id = "tool_drill_1"
            
            z_top = feature.get('dimensions', {}).get('z_top', 0.0)
            depth = feature.get('dimensions', {}).get('depth', 10.0)
            z_bottom = z_top - abs(depth)
            
            op.safe_heights['top'] = z_top
            op.safe_heights['bottom'] = z_bottom
            op.parameters['cycle_type'] = 'G83' if depth > 10 else 'G81'
            if 'diameter' in feature.get('dimensions', {}):
                op.parameters['hole_diameter'] = feature['dimensions']['diameter']
                
            # Setup validation for drilling: check hole axis alignment
            geom = feature.get('geometry', {})
            axis = geom.get('axis')
            if axis and abs(axis[2]) < 0.1:
                op.machinable_in_current_setup = False
                op.requires_reorientation = True
                op.status = "blocked_requires_reorientation"
            
        elif op_type == "pocketing":
            op.tool_id = "tool_flat_end_mill_1"
            op.safe_heights['top'] = feature.get('dimensions', {}).get('z_top', 0.0)
            op.safe_heights['bottom'] = feature.get('dimensions', {}).get('z_bottom', -5.0)
            op.machining_strategy = 'adaptive_clearing'
            
        elif op_type == "facing":
            op.tool_id = "tool_face_mill_1"
            z_level = feature.get('dimensions', {}).get('z_top', 0.0)
            op.safe_heights['top'] = z_level
            op.safe_heights['bottom'] = z_level
            op.machining_strategy = 'zigzag'
            
        elif op_type == "2d_contour":
            op.tool_id = "tool_flat_end_mill_1"
            op.safe_heights['top'] = feature.get('dimensions', {}).get('z_top', 0.0)
            op.safe_heights['bottom'] = feature.get('dimensions', {}).get('z_bottom', -10.0)
            op.machining_strategy = 'outside_climb'
            
        elif op_type == "boss_clearing":
            op.tool_id = "tool_flat_end_mill_1"
            op.safe_heights['top'] = feature.get('dimensions', {}).get('z_top', 0.0)
            op.safe_heights['bottom'] = feature.get('dimensions', {}).get('z_bottom', -10.0)
            op.machining_strategy = 'outside_climb'
        
        if op:
            z_top = op.safe_heights.get('top', 0.0)
            op.safe_heights['clearance'] = z_top + 15.0
            op.safe_heights['retract'] = z_top + 5.0
            op.safe_heights['feed'] = z_top + 2.0
            
            op.geometry = feature.get('geometry', {})
            op.feature_center = feature.get('center', [0, 0, 0])
            
        return op
