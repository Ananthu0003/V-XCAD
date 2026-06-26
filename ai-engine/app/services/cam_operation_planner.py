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
        
        # Standard Safe Height System (Z coordinates)
        self.safe_heights = {
            "clearance": 15.0,  # Rapid height between operations
            "retract": 5.0,     # Height to lift tool out of cut
            "feed": 2.0,        # Height to switch from Rapid to Feed rate
            "top": 0.0,         # Top of stock or feature
            "bottom": -10.0     # Final cutting depth (will be dynamically calculated)
        }
        self.parameters = {}
        self.machiningRegion = None
        
    def to_dict(self):
        return self.__dict__

class CamOperationPlanner:
    """
    Translates extracted B-Rep features into an ordered list of concrete 
    CNC operations (drilling, pocketing, facing, etc.).
    """
    def __init__(self):
        pass
        
    def plan_operations(self, features: List[Dict[str, Any]], step_file_path: str = None) -> List[Dict[str, Any]]:
        operations = []
        
        # Inject Universal 3D Waterline Roughing for complete material clearing
        if step_file_path:
            op = CamOperation("3d_waterline_roughing", "universal_rough")
            op.parameters['step_file_path'] = step_file_path
            # These will be dynamically refined by the toolpath engine
            op.safe_heights['top'] = 100.0
            op.safe_heights['bottom'] = -100.0
            operations.append(op)
            
        for feature in features:
            op = self._map_feature_to_operation(feature)
            if op:
                operations.append(op)
                
        # Optional: Apply strategic sorting 
        # (e.g. Facing first -> Spot Drilling -> Drilling -> Pocketing -> Contouring)
        sort_order = {
            "3d_waterline_roughing": 0,
            "facing": 1,
            "drilling": 2,
            "pocketing": 3,
            "2d_contour": 4,
            "chamfer_milling": 5,
            "od_turning": 1
        }
        
        operations.sort(key=lambda op: sort_order.get(op.type, 99))
        return [op.to_dict() for op in operations]
        
    def _map_feature_to_operation(self, feature: Dict[str, Any]) -> CamOperation:
        feat_type = feature.get('type')
        feat_id = feature.get('id')
        machining_status = feature.get('machiningStatus', 'valid')
        blocked_reason = feature.get('blocked_reason')
        
        # If the feature is known to be blocked/unmachinable in current setup, 
        # still create an operation for UI visibility but mark it as blocked.
        if not feature.get('machinable_in_current_setup', True) or machining_status != 'valid':
            op = CamOperation("blocked", feat_id)
            op.parameters['error'] = blocked_reason or "Feature is not machinable in current setup."
            op.machining_strategy = "blocked"
            # It will fail validation and generate 0 segments
            return op
            
        if feat_type in ['hole', 'blind_hole', 'through_hole']:
            op = CamOperation("drilling", feat_id)
            z_top = feature.get('z_top', 0.0)
            z_bottom = feature.get('z_bottom', -abs(feature.get('depth', 10.0)))
            op.safe_heights['top'] = z_top
            op.safe_heights['bottom'] = z_bottom
            depth = z_top - z_bottom
            # Use peck drilling (G83) for deep holes, standard (G81) for shallow
            op.parameters['cycle_type'] = 'G83' if depth > 10 else 'G81'
            if 'diameter' in feature:
                op.parameters['hole_diameter'] = feature['diameter']
                
        elif feat_type == 'pocket':
            op = CamOperation("pocketing", feat_id)
            op.safe_heights['top'] = feature.get('z_top', 0.0)
            op.safe_heights['bottom'] = feature.get('z_bottom', -abs(feature.get('depth', 5.0)))
            op.machining_strategy = 'adaptive_clearing'
            
        elif feat_type == 'face':
            op = CamOperation("facing", feat_id)
            z_level = feature.get('z_level', 0.0)
            op.safe_heights['top'] = z_level
            op.safe_heights['bottom'] = z_level # Facing usually cuts exactly at the Z plane
            op.machining_strategy = 'zigzag'
            
        elif feat_type == 'contour':
            op = CamOperation("2d_contour", feat_id)
            op.safe_heights['top'] = feature.get('z_top', 0.0)
            op.safe_heights['bottom'] = feature.get('z_bottom', -abs(feature.get('depth', 10.0)))
            op.machining_strategy = 'outside_climb'
            
        elif feat_type == 'boss':
            op = CamOperation("boss_clearing", feat_id)
            op.safe_heights['top'] = feature.get('z_top', 0.0)
            op.safe_heights['bottom'] = feature.get('z_bottom', -abs(feature.get('height', 10.0)))
            op.machining_strategy = 'adaptive_clearing'
            
        elif feat_type in ['external_cylinder', 'shaft', 'turned_od', 'od_diameter', 'shoulder', 'turned_profile']:
            # If it got here and is valid, it implies we are in a turning setup (since milling_3axis blocks it)
            op = CamOperation("turning", feat_id)
            
        elif feat_type == 'step':
            op = CamOperation("2d_contour", feat_id)
            
        else:
            op = CamOperation("unknown", feat_id)
            
        if op and op.type != "blocked":
            z_top = op.safe_heights.get('top', 0.0)
            op.safe_heights['clearance'] = z_top + 15.0
            op.safe_heights['retract'] = z_top + 5.0
            op.safe_heights['feed'] = z_top + 2.0
            
            # Pass geometric data forward for toolpath generation
            op.feature_center = feature.get('center', [0, 0, 0])
            if 'raw_points' in feature:
                op.raw_points = feature['raw_points']
            if 'width' in feature:
                op.feature_width = feature['width']
                
            op.machiningRegion = feature.get('machiningRegion')
            
        return op
