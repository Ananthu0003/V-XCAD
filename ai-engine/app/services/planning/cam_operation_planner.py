import uuid
from typing import List, Dict, Any
from app.constants import TURNING_FEATURE_TYPES
from app.services.planning.operation_planner import CamOperation

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
                
        # Strategic sorting for logical manufacturing workflow
        # Facing -> OD Turning -> OD Finishing -> Center Drill/Drilling -> ID Boring -> Grooving -> Parting -> 2.5D Milling
        sort_order = {
            "3d_waterline_roughing": 0,
            "facing": 1,
            "facing_turning": 1,
            "od_turning": 2,
            "od_finish_turning": 3,
            "drilling": 4,
            "id_boring": 5,
            "grooving": 6,
            "parting_off": 7,
            "pocketing": 8,
            "boss_clearing": 9,
            "2d_contour": 10,
            "chamfer_milling": 11,
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
        if not feature.get('machinable_in_current_setup', True):
            op = CamOperation("blocked", feat_id)
            op.parameters['error'] = blocked_reason or "Feature is not machinable in current setup."
            op.machining_strategy = "blocked"
            return op
        if machining_status not in ('valid', 'recognized'):
            op = CamOperation("blocked", feat_id)
            op.parameters['error'] = blocked_reason or f"Feature machining status is '{machining_status}'."
            op.machining_strategy = "blocked"
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
            machining_region = feature.get('machiningRegion', {})
            z_top = machining_region.get('topZ', feature.get('dimensions', {}).get('z_top', feature.get('z_level', 0.0)))
            z_bottom = machining_region.get('bottomZ', z_top)
            op.safe_heights['top'] = z_top
            op.safe_heights['bottom'] = z_bottom
            op.machining_strategy = feature.get('machining_strategy', 'zigzag')
            if 'traceability' in feature:
                op.traceability = feature['traceability']
            
        elif feat_type == 'contour':
            op = CamOperation("2d_contour", feat_id)
            op.safe_heights['top'] = feature.get('z_top', 0.0)
            op.safe_heights['bottom'] = feature.get('z_bottom', -abs(feature.get('depth', 10.0)))
            op.machining_strategy = 'outside_climb'
            
        elif feat_type == 'boss':
            op = CamOperation("boss_clearing", feat_id)
            op.safe_heights['top'] = feature.get('z_top', 0.0)
            op.safe_heights['bottom'] = feature.get('z_bottom', -abs(feature.get('height', 10.0)))
            op.machining_strategy = feature.get('preferred_strategy', 'offset_clearing')
            
        elif feat_type in TURNING_FEATURE_TYPES or feat_type in ['external_cylinder', 'shaft', 'turned_od', 'turned_profile']:
            op = CamOperation("od_turning", feat_id)
            machining_region = feature.get('machiningRegion', {})
            z_top = machining_region.get('topZ', feature.get('dimensions', {}).get('z_top', 0.0))
            height = feature.get('dimensions', {}).get('height', feature.get('dimensions', {}).get('depth', 10.0))
            z_bottom = machining_region.get('bottomZ', z_top - abs(height))
            op.safe_heights['top'] = z_top
            op.safe_heights['bottom'] = z_bottom
            op.machining_strategy = 'lathe_roughing'
            if 'dimensions' in feature:
                op.parameters['diameter'] = feature['dimensions'].get('diameter', 0.0)
                op.parameters['length'] = height
            
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
