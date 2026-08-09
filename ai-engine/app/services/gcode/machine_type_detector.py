from typing import List, Dict, Any

class MachineTypeDetector:
    """
    Detects the optimal CNC machine type for a given part based on its B-Rep topology 
    and extracted manufacturing features.
    """
    def __init__(self):
        pass

    def detect_machine(self, topology_info: Dict[str, Any], features: List[Dict[str, Any]]) -> str:
        """
        Analyzes the part to recommend one of:
        * 3_axis_mill (Prismatic milling part)
        * lathe (Turned lathe part)
        * mill_turn (Mill-turn part)
        """
        if not topology_info and not features:
            return "3_axis_mill"
            
        base_recommendation = topology_info.get('recommended_machine_type', '3_axis_mill')
        is_rotational = base_recommendation in ['lathe', 'mill_turn']
        
        # Check if features have any cylindrical turning features
        if not is_rotational and features:
            turning_keywords = ('cylinder', 'shaft', 'turned', 'dia', 'bore', 'groove', 'turn')
            for f in features:
                feat_type = f.get('type', '').lower()
                if any(kw in feat_type for kw in turning_keywords):
                    is_rotational = True
                    break
        
        if not features:
            if is_rotational:
                return "lathe"
            return "3_axis_mill"
            
        non_z_features = 0
        unique_tool_vectors = set()
        
        for f in features:
            # Skip turning-only features from axis counting if we want, but it's safe to include them
            axis = f.get('axis', [0, 0, 1])
            vector = (round(axis[0], 2), round(axis[1], 2), round(axis[2], 2))
            unique_tool_vectors.add(vector)
            if abs(axis[2]) < 0.99:
                non_z_features += 1
                
        if is_rotational:
            if non_z_features > 0:
                return "mill_turn"
            return "lathe"
            
        if len(unique_tool_vectors) > 2:
            return "3_axis_mill"
        elif len(unique_tool_vectors) == 2:
            return "3_axis_mill"
            
        return "3_axis_mill"
