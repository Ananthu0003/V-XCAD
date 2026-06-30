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
        * Prismatic milling part
        * Turned lathe part
        * Mill-turn part
        * Unknown
        """
        if not topology_info:
            return "Prismatic milling part"
            
        base_recommendation = topology_info.get('recommended_machine_type', '3_axis_mill')
        is_rotational = base_recommendation in ['lathe', 'mill_turn']
        
        if not features:
            if is_rotational:
                return "Turned lathe part"
            return "Prismatic milling part"
            
        non_z_features = 0
        unique_tool_vectors = set()
        
        for f in features:
            axis = f.get('axis', [0, 0, 1])
            vector = (round(axis[0], 2), round(axis[1], 2), round(axis[2], 2))
            unique_tool_vectors.add(vector)
            if abs(axis[2]) < 0.99:
                non_z_features += 1
                
        if is_rotational:
            if non_z_features > 0:
                return "Mill-turn part"
            return "Turned lathe part"
            
        if len(unique_tool_vectors) > 2:
            return "Prismatic milling part"
        elif len(unique_tool_vectors) == 2:
            return "Prismatic milling part"
            
        return "Prismatic milling part"
