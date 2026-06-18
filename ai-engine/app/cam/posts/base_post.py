from typing import List, Dict, Any, Tuple
import datetime

class BasePostProcessor:
    """Base class for CNC Post Processors."""
    
    def __init__(self, post_data: Dict[str, Any]):
        self.setup = post_data.get("setup", {})
        self.operations = post_data.get("operations", [])
        self.gcode_lines: List[str] = []
        
        # Backward compatibility for old tests
        if not self.operations and "feed_rate" in post_data:
            self.operations = [{
                "name": "Default Profile",
                "type": post_data.get("strategy", "profile"),
                "tool": {
                    "id": "t1",
                    "number": 1,
                    "type": "endmill",
                    "diameter": post_data.get("tool_diameter", 3.175),
                    "flutes": 2,
                    "lengthOffset": 1
                },
                "parameters": {
                    "feedRate": post_data.get("feed_rate", 800.0),
                    "plungeRate": post_data.get("plunge_rate", 200.0),
                    "spindleSpeed": 12000,
                    "coolant": "flood",
                    "safeHeight": 50.0
                },
                "toolpaths": [] # will be injected in generate_gcode
            }]

    def validate_operation(self, op: Dict) -> None:
        params = op.get("parameters", {})
        tool = op.get("tool", {})
        
        if params.get("feedRate", 0) <= 0:
            raise ValueError(f"Operation '{op.get('name')}' must have a feed rate > 0")
        if params.get("spindleSpeed", 0) <= 0:
            raise ValueError(f"Operation '{op.get('name')}' must have spindle speed > 0")
            
        tool_num_raw = tool.get("number", 0)
        tool_num = 0
        if isinstance(tool_num_raw, str):
            try:
                tool_num = int(tool_num_raw.replace('T', '').replace('t', '').strip())
            except ValueError:
                pass
        elif isinstance(tool_num_raw, (int, float)):
            tool_num = int(tool_num_raw)
            
        if not tool or tool_num <= 0:
            raise ValueError(f"Operation '{op.get('name')}' must have a valid tool assigned")

    def format_program_header(self) -> List[str]:
        return [
            "%",
            "O1001",
            "(PROGRAM NAME: VEXCAD_PART)",
            f"(MATERIAL: {self.setup.get('material', 'UNKNOWN')})",
            f"(DATE: {datetime.datetime.now().strftime('%Y-%m-%d')})",
            "G17 (XY PLANE)",
            "G21 (METRIC)",
            "G40 (CANCEL CUTTER COMP)",
            "G49 (CANCEL TOOL LENGTH OFFSET)",
            "G80 (CANCEL CANNED CYCLES)",
            "G90 (ABSOLUTE COORDS)",
            "G94 (FEED PER MINUTE)"
        ]

    def format_program_footer(self) -> List[str]:
        return [
            "M09 (COOLANT OFF)",
            "M05 (SPINDLE STOP)",
            "G91 G28 Z0 (HOME Z)",
            "G28 X0 Y0 (HOME XY)",
            "G90 (RESTORE ABSOLUTE)",
            "M30 (END PROGRAM)",
            "%"
        ]

    def format_tool_change(self, tool_number: int, length_offset: int, safe_z: float) -> List[str]:
        return [
            "M09 (COOLANT OFF BEFORE TOOL CHANGE)",
            "M05 (SPINDLE STOP)",
            f"T{tool_number} M06",
            f"G43 H{length_offset} Z{safe_z:.3f}"
        ]

    def format_rapid_move(self, x: float = None, y: float = None, z: float = None) -> str:
        parts = ["G00"]
        if x is not None: parts.append(f"X{x:.3f}")
        if y is not None: parts.append(f"Y{y:.3f}")
        if z is not None: parts.append(f"Z{z:.3f}")
        return " ".join(parts)

    def format_linear_feed(self, x: float = None, y: float = None, z: float = None, feed: float = None) -> str:
        parts = ["G01"]
        if x is not None: parts.append(f"X{x:.3f}")
        if y is not None: parts.append(f"Y{y:.3f}")
        if z is not None: parts.append(f"Z{z:.3f}")
        if feed is not None: parts.append(f"F{feed:.1f}")
        return " ".join(parts)

    def format_spindle_coolant(self, rpm: float, coolant: str) -> List[str]:
        lines = [f"S{int(rpm)} M03"]
        if coolant == "flood":
            lines.append("M08 (FLOOD COOLANT ON)")
        elif coolant == "mist":
            lines.append("M07 (MIST COOLANT ON)")
        return lines

    def generate_gcode(self, toolpaths_or_operations: List[Any]) -> str:
        # Check if legacy flat list was passed
        if toolpaths_or_operations and isinstance(toolpaths_or_operations[0], list):
            self.operations[0]["toolpaths"] = toolpaths_or_operations
            ops = self.operations
        else:
            ops = toolpaths_or_operations

        self.gcode_lines = self.format_program_header()
        
        # Determine Work Coordinate System
        wcs = self.setup.get("wcs", "G54")
        self.gcode_lines.append(f"{wcs} (WORK OFFSET)")

        current_tool = -1

        for op in ops:
            self.validate_operation(op)
            tool = op.get("tool", {})
            params = op.get("parameters", {})
            safe_z = params.get("safeHeight", 50.0)
            
            tool_num_raw = tool.get("number", 1)
            tool_number = 1
            if isinstance(tool_num_raw, str):
                try:
                    tool_number = int(tool_num_raw.replace('T', '').replace('t', '').strip())
                except ValueError:
                    pass
            elif isinstance(tool_num_raw, (int, float)):
                tool_number = int(tool_num_raw)
                
            if tool_number != current_tool:
                self.gcode_lines.extend(self.format_tool_change(
                    tool_number=tool_number, 
                    length_offset=tool.get("lengthOffset", tool_number), 
                    safe_z=safe_z
                ))
                current_tool = tool_number
            
            self.gcode_lines.append(f"({op.get('name').upper()})")
            
            self.gcode_lines.extend(self.format_spindle_coolant(
                rpm=params.get("spindleSpeed", 12000), 
                coolant=params.get("coolant", "flood")
            ))

            feed_rate = params.get("feedRate", 1000.0)
            plunge_rate = params.get("plungeRate", 300.0)

            for idx, path in enumerate(op.get("toolpaths", [])):
                if not path:
                    continue
                
                # Rapid to start pos above Z
                start_x, start_y, start_z = path[0]
                self.gcode_lines.append(self.format_rapid_move(x=start_x, y=start_y, z=safe_z))
                
                # Plunge
                self.gcode_lines.append(self.format_linear_feed(z=start_z, feed=plunge_rate))
                
                # Cutting Feed
                for pt in path[1:]:
                    pt_x, pt_y, pt_z = pt
                    self.gcode_lines.append(self.format_linear_feed(x=pt_x, y=pt_y, z=pt_z, feed=feed_rate))
                
                # Retract
                self.gcode_lines.append(self.format_rapid_move(x=pt_x, y=pt_y, z=safe_z))
        
        self.gcode_lines.extend(self.format_program_footer())
        return "\n".join(self.gcode_lines)
