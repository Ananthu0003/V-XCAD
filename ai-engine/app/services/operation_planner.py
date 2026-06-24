import uuid
from typing import List, Dict, Any

class CamOperation:
    """Represents a planned machining operation linked to a specific feature."""
    def __init__(self, operation_type: str, feature_id: str, setup_id: str = "setup_1"):
        self.id = f"op_{uuid.uuid4().hex[:8]}"
        self.type = operation_type
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
    """
    def __init__(self):
        pass
        
    def plan_operations(self, features: List[Dict[str, Any]], machine_type: str) -> List[Dict[str, Any]]:
        operations = []
        
        # We process each required feature and map to an operation
        for feature in features:
            if not feature.get('requiredMachining', True):
                continue
                
            feat_id = feature.get('id')
            if not feat_id:
                feature["diagnostic"] = "Failed to plan operation: Feature ID is null"
                feature["geometry_status"] = "error"
                continue
                
            op = self._map_feature_to_operation(feature, machine_type)
            if op:
                if op.status == "error":
                    feature["diagnostic"] = f"Failed to plan operation: {op.parameters.get('error', 'Unknown error')}"
                    feature["geometry_status"] = "error"
                else:
                    operations.append(op)
                
        # Optional: Apply strategic sorting 
        sort_order = {
            "facing": 1,
            "drilling": 2,
            "pocketing": 3,
            "2d_contour": 4,
            "od_turning": 1
        }
        
        operations.sort(key=lambda op: sort_order.get(op.type, 99))
        return [op.to_dict() for op in operations]
        
    def _map_feature_to_operation(self, feature: Dict[str, Any], machine_type: str) -> CamOperation:
        feat_type = feature.get('type')
        feat_id = feature.get('id')
        
        op = None
        
        # Logic to map based on feature and machine type
        if feat_type in ['blind_hole', 'through_hole', 'hole']:
            op = CamOperation("drilling", feat_id)
            # Assign default tool id based on operation
            op.tool_id = "tool_drill_1"
            
            z_top = feature.get('dimensions', {}).get('z_top', 0.0)
            depth = feature.get('dimensions', {}).get('depth', 10.0)
            z_bottom = z_top - abs(depth)
            
            op.safe_heights['top'] = z_top
            op.safe_heights['bottom'] = z_bottom
            op.parameters['cycle_type'] = 'G83' if depth > 10 else 'G81'
            if 'diameter' in feature.get('dimensions', {}):
                op.parameters['hole_diameter'] = feature['dimensions']['diameter']
                
            # Basic Setup Validation (assuming Z-up tool axis for standard 3-axis milling)
            # If the hole is horizontal (axis roughly perpendicular to Z), it requires reorientation
            geom = feature.get('geometry', {})
            axis = geom.get('axis')
            if axis and abs(axis[2]) < 0.1: # very little Z component
                op.machinable_in_current_setup = False
                op.requires_reorientation = True
                op.status = "blocked_requires_reorientation"
            
        elif feat_type == 'pocket':
            op = CamOperation("pocketing", feat_id)
            op.tool_id = "tool_flat_end_mill_1"
            op.safe_heights['top'] = feature.get('dimensions', {}).get('z_top', 0.0)
            op.safe_heights['bottom'] = feature.get('dimensions', {}).get('z_bottom', -5.0)
            op.machining_strategy = 'adaptive_clearing'
            
        elif feat_type == 'face':
            op = CamOperation("facing", feat_id)
            op.tool_id = "tool_face_mill_1"
            z_level = feature.get('dimensions', {}).get('z_top', 0.0)
            op.safe_heights['top'] = z_level
            op.safe_heights['bottom'] = z_level
            op.machining_strategy = 'zigzag'
            
        elif feat_type == 'contour':
            op = CamOperation("2d_contour", feat_id)
            op.tool_id = "tool_flat_end_mill_1"
            op.safe_heights['top'] = feature.get('dimensions', {}).get('z_top', 0.0)
            op.safe_heights['bottom'] = feature.get('dimensions', {}).get('z_bottom', -10.0)
            op.machining_strategy = 'outside_climb'
            
        elif feat_type in ['od_diameter', 'shoulder', 'turned_profile']:
            op = CamOperation("od_turning", feat_id)
            op.tool_id = "tool_lathe_turn_1"
            
        elif feat_type == 'boss':
            op = CamOperation("boss_machining", feat_id)
            op.tool_id = "tool_flat_end_mill_1"
            op.safe_heights['top'] = feature.get('dimensions', {}).get('z_top', 0.0)
            op.safe_heights['bottom'] = feature.get('dimensions', {}).get('z_bottom', -10.0)
            op.machining_strategy = 'outside_climb'
            
        elif feat_type == 'step':
            op = CamOperation("2d_contour", feat_id)
            op.tool_id = "tool_flat_end_mill_1"
            
        else:
            op = CamOperation("unknown", feat_id)
            op.status = "error"
            op.parameters['error'] = f"Unsupported feature type: {feat_type}"
            
        if op:
            z_top = op.safe_heights.get('top', 0.0)
            op.safe_heights['clearance'] = z_top + 15.0
            op.safe_heights['retract'] = z_top + 5.0
            op.safe_heights['feed'] = z_top + 2.0
            
            op.geometry = feature.get('geometry', {})
            op.feature_center = feature.get('center', [0, 0, 0])
            
        return op
