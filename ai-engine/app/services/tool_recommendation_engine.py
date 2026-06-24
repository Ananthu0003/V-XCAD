import os
import json
from typing import Dict, Any, List

class ToolRecommendationEngine:
    """
    Matches planned CAM operations to physical tools from the Tool Library.
    Designed with a DB-ready architecture (PostgreSQL/SQLite) that currently 
    seeds from a JSON file.
    """
    def __init__(self, db_connection=None):
        # Future-proofed for DB connection (Phase 1 SQLite/Postgres integration)
        self.db = db_connection
        self.tools = self._load_seed_data()
        
    def _load_seed_data(self) -> List[Dict[str, Any]]:
        """Loads default tools from JSON seed until DB migration is complete."""
        seed_path = os.path.join(os.path.dirname(__file__), "tool_library.json")
        if os.path.exists(seed_path):
            with open(seed_path, 'r') as f:
                return json.load(f)
        return []

    def recommend_tool(self, operation: Dict[str, Any]) -> Dict[str, Any]:
        """
        Selects the best available tool for the given operation.
        """
        op_type = operation.get('type')
        params = operation.get('parameters', {})
        
        # 1. Drilling operations need a drill bit matching the hole diameter
        if op_type == 'drilling':
            target_dia = params.get('hole_diameter')
            if target_dia:
                # Find exact or slightly smaller drill bit
                suitable_drills = [t for t in self.tools if t['type'] == 'drill' and t['diameter'] <= target_dia]
                if suitable_drills:
                    # Sort by closest diameter
                    suitable_drills.sort(key=lambda t: abs(t['diameter'] - target_dia))
                    return suitable_drills[0]
            # Fallback
            drills = [t for t in self.tools if t['type'] == 'drill']
            if drills: return drills[0]
            
        # 2. Facing operations prefer a Face Mill or large End Mill
        elif op_type == 'facing':
            face_mills = [t for t in self.tools if t['type'] == 'face_mill']
            if face_mills: return face_mills[0]
            # Fallback to end mill
            end_mills = [t for t in self.tools if t['type'] == 'end_mill']
            if end_mills:
                end_mills.sort(key=lambda t: t['diameter'], reverse=True)
                return end_mills[0]
            
        # 3. Pocketing and Contouring prefer an End Mill
        elif op_type in ['pocketing', '2d_contour', 'chamfer_milling']:
            end_mills = [t for t in self.tools if t['type'] == 'end_mill']
            if end_mills:
                # Sort by largest diameter to clear material faster
                # (In production, would check minimum corner radius of the pocket)
                end_mills.sort(key=lambda t: t['diameter'], reverse=True)
                return end_mills[0]
                
        # 4. Turning
        elif op_type == 'od_turning':
            turning_tools = [t for t in self.tools if t['type'] == 'turning_tool']
            if turning_tools: return turning_tools[0]
            
        # Global Fallback
        if self.tools:
            return self.tools[0]
            
        return {}
