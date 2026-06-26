import re

with open("app/services/toolpath_engine.py", "r") as f:
    content = f.read()

# Update generate_toolpaths signature and loop
old_generate = """    def generate_toolpaths(self, operations: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        toolpaths = []
        for op in operations:
            if op.get('status') in ('error', 'blocked'):
                op['toolpaths'] = []
                toolpaths.append(op)
                continue

            paths = self._generate_paths_for_op(op)
            if paths:
                op['toolpaths'] = [p.model_dump() for p in paths]
            toolpaths.append(op)
        return toolpaths"""
new_generate = """    def generate_toolpaths(self, operations: List[Dict[str, Any]], setup: Dict[str, Any] = None) -> List[Dict[str, Any]]:
        setup = setup or {}
        toolpaths = []
        for op in operations:
            if op.get('status') in ('error', 'blocked'):
                op['toolpaths'] = []
                toolpaths.append(op)
                continue

            machiningRegion = op.get('machiningRegion')
            tool = op.get('tool')
            paths = self._generate_paths_for_op(op, machiningRegion, tool, setup)
            if paths:
                op['toolpaths'] = [p.model_dump() for p in paths]
            toolpaths.append(op)
        return toolpaths"""
content = content.replace(old_generate, new_generate)

# Update _generate_paths_for_op signature
old_sig = """    def _generate_paths_for_op(self, op: Dict[str, Any]) -> List[ToolpathSegment]:
        geometry = op.get("geometry", {})
        
        # Constraint C6: No fallbacks. Hard failure on missing/failed geometry.
        if not geometry or geometry.get("status") in ("failed", "blocked"):
            if geometry.get("status") != "blocked":
                op["status"] = "error"
                op.setdefault("parameters", {})["error"] = geometry.get(
                    "error", "No geometry mapping available for this operation"
                )
            return []"""
new_sig = """    def _generate_paths_for_op(self, op: Dict[str, Any], machiningRegion: Dict[str, Any], tool: Dict[str, Any], setup: Dict[str, Any]) -> List[ToolpathSegment]:
        if not machiningRegion or not machiningRegion.get("valid"):
            op["status"] = "error"
            op.setdefault("parameters", {})["error"] = "Invalid or missing machiningRegion"
            return []"""
content = content.replace(old_sig, new_sig)

# Change tool getting
content = content.replace('tool = op.get("tool")', '')
content = content.replace('if tool_radius <= 0:', 'if not tool: tool = {}\n        tool_radius = (tool.get("diameter", 0.0) / 2.0) if tool else 1.0\n        if tool_radius <= 0:')

# Replace geometry.get with machiningRegion.get
content = content.replace('geometry.get(', 'machiningRegion.get(')
content = content.replace('geometry[', 'machiningRegion[')
content = content.replace('in geometry', 'in machiningRegion')

# Update method calls
content = content.replace('self._generate_drilling_path(op, geometry,', 'self._generate_drilling_path(op, machiningRegion,')
content = content.replace('self._generate_planar_milling_path(\n                    op, op_type, geometry,', 'self._generate_planar_milling_path(\n                    op, op_type, machiningRegion,')
content = content.replace('self._generate_facing_path(\n                    op, geometry,', 'self._generate_facing_path(\n                    op, machiningRegion,')

# Function definitions
content = content.replace('def _generate_drilling_path(\n        self, op, geometry, clearance, feed_z, top, bottom, add_seg\n    ) -> None:', 'def _generate_drilling_path(\n        self, op, machiningRegion, clearance, feed_z, top, bottom, add_seg\n    ) -> None:')
content = content.replace('def _generate_planar_milling_path(\n        self, op, op_type, geometry, tool_radius, clearance, feed_z, top, bottom, add_seg\n    ) -> None:', 'def _generate_planar_milling_path(\n        self, op, op_type, machiningRegion, tool_radius, clearance, feed_z, top, bottom, add_seg\n    ) -> None:')
content = content.replace('def _generate_facing_path(\n        self, op, geometry, tool_radius, clearance, feed_z, top, bottom, add_seg\n    ) -> None:', 'def _generate_facing_path(\n        self, op, machiningRegion, tool_radius, clearance, feed_z, top, bottom, add_seg\n    ) -> None:')

# Fix variable mappings for planar
content = content.replace('boss_pts = machiningRegion.get("boss_points")', 'boss_pts = machiningRegion.get("islands", [[]])[0]')
content = content.replace('containing_pts = machiningRegion.get("containing_points")', 'containing_pts = machiningRegion.get("boundary")')
content = content.replace('raw_pts_3d = machiningRegion.get("profile_points") or machiningRegion.get("boundary_points")', 'raw_pts_3d = machiningRegion.get("boundary")')
content = content.replace('boundary = machiningRegion.get("face_boundary")', 'boundary = machiningRegion.get("boundary")')

with open("app/services/toolpath_engine.py", "w") as f:
    f.write(content)
