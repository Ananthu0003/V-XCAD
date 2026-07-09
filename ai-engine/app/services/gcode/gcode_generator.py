from typing import List, Dict, Any

class BasePostProcessor:
    """Base class for all CNC dialect post-processors."""
    def __init__(self):
        self.output = []
        self.current_x = None
        self.current_y = None
        self.current_z = None
        self.coolant_active = False
        
    def format_comment(self, text: str) -> str:
        return f"({text})"
        
    def generate(self, operations: List[Dict[str, Any]], setup_plan: Dict[str, Any] = None) -> str:
        self.output = []
        self.current_x = None
        self.current_y = None
        self.current_z = None
        self.coolant_active = False
        self.current_tool_num = None
        self.current_rpm = None
        self.program_start()
        
        for op in operations:
            self.output.append("\n" + self.format_comment(f"--- OPERATION: {op.get('type', 'UNKNOWN').upper()} ---"))
            feature_id = op.get('feature_id')
            if feature_id:
                self.output.append(self.format_comment(f"FEATURE: {feature_id}"))
                
            self._write_operation(op)
            
        self.program_end(setup_plan)
        return "\n".join(self.output)
        
    def program_start(self):
        pass
        
    def program_end(self, setup_plan: Dict[str, Any] = None):
        pass
        
    def tool_change(self, tool_num: int, tool_name: str = ""):
        pass
        
    def safe_tool_retract(self):
        pass
        
    def start_spindle(self, rpm: int):
        pass
        
    def spindle_stop(self):
        pass
        
    def coolant_on(self):
        pass
        
    def coolant_off(self):
        pass
        
    def apply_tool_length_offset(self, offset_num: int, safe_z: float):
        pass
        
    def rapid(self, x: float = None, y: float = None, z: float = None):
        pass
        
    def linear(self, x: float = None, y: float = None, z: float = None, feed: float = None):
        pass
        
    def drilling_cycle(self, x: float, y: float, z: float, r: float, feed: float, clearance: float = 15.0):
        pass
        
    def peck_drilling_cycle(self, x: float, y: float, z: float, r: float, q: float, feed: float, clearance: float = 15.0):
        pass
        
    def cancel_cycle(self):
        pass

    def ensure_safe_z(self, clearance_z: float):
        if self.current_z is None or self.current_z < clearance_z:
            self.rapid(z=clearance_z)

    def ensure_xy(self, x: float, y: float):
        if self.current_x != x or self.current_y != y:
            self.rapid(x=x, y=y)

    def emit_safe_approach(self, x: float, y: float, clearance_z: float, retract_z: float):
        self.ensure_safe_z(clearance_z)
        self.ensure_xy(x, y)
        if self.current_z is None or self.current_z > retract_z:
            self.rapid(z=retract_z)

    def emit_safe_retract(self, clearance_z: float):
        self.ensure_safe_z(clearance_z)

    def _write_operation(self, op: Dict[str, Any]):
        tool = op.get('tool', {})
        if not tool:
            return # Blocked earlier, but safe guard

        # Extract tool number correctly
        raw_num = tool.get('number', tool.get('tool_number', '1'))
        if isinstance(raw_num, str) and raw_num.startswith('T'):
            raw_num = raw_num[1:]
        try:
            tool_num = int(raw_num)
        except ValueError:
            tool_num = 1
            
        tool_name = tool.get('name', tool.get('tool_name', 'TOOL'))
        if self.current_tool_num != tool_num:
            self.safe_tool_retract()
            self.tool_change(tool_num, tool_name)
            self.current_tool_num = tool_num

        rpm = op.get('parameters', {}).get('spindle_rpm')
        if not rpm or rpm == 12000:
            tool_diameter = float(tool.get('diameter', 10.0))
            import math
            target_surface_speed = op.get('parameters', {}).get('surface_speed', 100) # m/min
            calculated_rpm = int((target_surface_speed * 1000) / (math.pi * tool_diameter))
            rpm = min(12000, max(500, calculated_rpm))
            
        if self.current_rpm != rpm:
            self.start_spindle(rpm)
            self.current_rpm = rpm

        offset_num = tool.get('length_offset_number', tool_num)
        safe_heights = op.get('safe_heights', {})
        clearance_z = safe_heights.get('clearance', 50.0)
        retract_z = safe_heights.get('retract', 5.0)

        # Apply offset and coolant safely
        # Instead of a redundant G0 before G43, we just use G43 to perform the safe Z approach.
        self.apply_tool_length_offset(offset_num, clearance_z)

        if op.get('parameters', {}).get('coolant_enabled', True):
            self.coolant_on()

        segments = op.get('toolpaths', [])
        if not segments:
            return

        op_type = op.get('type')
        feed_cut = op.get('parameters', {}).get('feed_rate', 1000)
        feed_plunge = op.get('parameters', {}).get('plunge_rate', 300)

        is_first = True

        for seg in segments:
            move_type = seg.get('moveType', 'unknown')
            pt = seg.get('end', {})
            x, y, z = pt.get('x'), pt.get('y'), pt.get('z')

            # Ensure safe Z before any XY motion if it's the first move and state is unknown
            if is_first and move_type in ['approach_retract', 'rapid_xy', 'cut', 'arc_cw', 'arc_ccw', 'plunge', 'drill_cycle']:
                self.ensure_safe_z(clearance_z)
                if x is not None and y is not None:
                    self.ensure_xy(x, y)
            is_first = False

            if move_type == 'drill_cycle':
                bottom_z = pt.get('z', 0.0)
                cycle_type = op.get('parameters', {}).get('cycle_type', 'G81')
                # Drill cycle should already have safe XY approaches emitted by motion planner.
                # If not, we ensure it safely here:
                if x is not None and y is not None:
                    self.ensure_xy(x, y)
                
                if cycle_type == 'G83':
                    peck = op.get('parameters', {}).get('peck_depth', 2.0)
                    self.peck_drilling_cycle(x, y, bottom_z, retract_z, peck, feed_plunge, clearance=clearance_z)
                else:
                    self.drilling_cycle(x, y, bottom_z, retract_z, feed_plunge, clearance=clearance_z)
                self.cancel_cycle()

            elif move_type == 'rapid_clearance':
                safe_z = max(z if z is not None else clearance_z, clearance_z)
                self.ensure_safe_z(safe_z)
                
            elif move_type == 'rapid_xy':
                self.ensure_xy(x, y)
                
            elif move_type == 'approach_retract':
                if x is not None and y is not None:
                    self.ensure_xy(x, y)
                safe_z = max(z if z is not None else retract_z, retract_z)
                self.rapid(z=safe_z)
                
            elif move_type == 'retract_clearance':
                safe_z = max(z if z is not None else clearance_z, clearance_z)
                self.ensure_safe_z(safe_z)

            elif move_type == 'plunge':
                if x is not None and y is not None:
                    self.ensure_xy(x, y)
                self.linear(z=z, feed=feed_plunge)
                current_z = z if z is not None else current_z
                
            elif move_type in ['cut', 'arc_cw', 'arc_ccw']:
                # G2/G3 are not modeled in base linear method perfectly, 
                # but for now we fallback to linear as standard if arcs are not implemented in generator,
                # or use a specialized method if it existed.
                # Assuming `self.linear` works as the basic cut endpoint:
                role = seg.get('segmentRole')
                actual_feed = feed_cut
                if role in ['lead_in', 'lead_out']:
                    actual_feed = op.get('parameters', {}).get('feed_lead', feed_cut * 0.5)
                    
                self.linear(x=x, y=y, z=z, feed=actual_feed)
                current_z = z if z is not None else current_z

        # Retract at end of op
        self.emit_safe_retract(clearance_z)


class FanucPostProcessor(BasePostProcessor):
    """Standard ISO/Fanuc compatible G-Code output."""
    def program_start(self):
        self.output.append("%")
        self.output.append("O1001 (VEXCAD GENERATED)")
        self.output.append("G21 G90 G17 G40 G49 G80")
        self.output.append("G54")
        
    def program_end(self, setup_plan: Dict[str, Any] = None):
        self.coolant_off()
        self.output.append("M05")
        self.output.append("G49")
        self.output.append("G53 G0 Z0.")
        
        allow_xy_home = setup_plan and setup_plan.get("allowMachineXYHomeAtEnd", False)
        if allow_xy_home:
            self.output.append("G53 G0 X0. Y0.")
            
        self.output.append("M30")
        self.output.append("%")
        
    def tool_change(self, tool_num: int, tool_name: str = ""):
        self.output.append(f"(T{tool_num} - {tool_name})")
        self.output.append(f"T{tool_num} M06")
        
    def start_spindle(self, rpm: int):
        self.output.append(f"S{rpm} M03")
        
    def spindle_stop(self):
        self.output.append("M05")
        
    def coolant_on(self):
        if not getattr(self, 'coolant_active', False):
            self.output.append("M08")
            self.coolant_active = True
        
    def coolant_off(self):
        if getattr(self, 'coolant_active', False):
            self.output.append("M09")
            self.coolant_active = False
        
    def apply_tool_length_offset(self, offset_num: int, safe_z: float):
        self.output.append(f"G0 G43 H{offset_num} Z{safe_z:.3f}")
        self.current_z = safe_z
        
    def _fmt(self, val: float) -> str:
        return f"{0.0 if abs(val) < 0.0005 else val:.3f}"

    def rapid(self, x: float = None, y: float = None, z: float = None):
        cmd = "G0"
        if x is not None: 
            cmd += f" X{self._fmt(x)}"
            self.current_x = x
        if y is not None: 
            cmd += f" Y{self._fmt(y)}"
            self.current_y = y
        if z is not None: 
            cmd += f" Z{self._fmt(z)}"
            self.current_z = z
        if cmd != "G0":
            self.output.append(cmd)
            
    def linear(self, x: float = None, y: float = None, z: float = None, feed: float = None):
        cmd = "G1"
        if x is not None: 
            cmd += f" X{self._fmt(x)}"
            self.current_x = x
        if y is not None: 
            cmd += f" Y{self._fmt(y)}"
            self.current_y = y
        if z is not None: 
            cmd += f" Z{self._fmt(z)}"
            self.current_z = z
        if feed is not None: cmd += f" F{feed:.0f}"
        if cmd != "G1":
            self.output.append(cmd)
            
    def safe_tool_retract(self):
        self.coolant_off()
        self.spindle_stop()
        self.output.append("G49")
        self.output.append("G53 G0 Z0.")

    def drilling_cycle(self, x: float, y: float, z: float, r: float, feed: float, clearance: float = 15.0):
        self.ensure_safe_z(r)
        self.ensure_xy(x, y)
        self.output.append(f"G98 G81 X{self._fmt(x)} Y{self._fmt(y)} Z{self._fmt(z)} R{self._fmt(r)} F{feed:.0f}")
        
    def peck_drilling_cycle(self, x: float, y: float, z: float, r: float, q: float, feed: float, clearance: float = 15.0):
        self.ensure_safe_z(r)
        self.ensure_xy(x, y)
        self.output.append(f"G98 G83 X{self._fmt(x)} Y{self._fmt(y)} Z{self._fmt(z)} R{self._fmt(r)} Q{self._fmt(q)} F{feed:.0f}")
        
    def cancel_cycle(self):
        self.output.append("G80")

class HaasPostProcessor(FanucPostProcessor):
    """Haas-specific dialect."""
    def program_start(self):
        self.output.append("%")
        self.output.append("O1001 (HAAS VEXCAD GENERATED)")
        self.output.append("G21 G90 G17 G40 G49 G80")
        self.output.append("G54")

class HeidenhainISOPostProcessor(FanucPostProcessor):
    """Heidenhain ISO compatible G-Code output."""
    def program_start(self):
        self.output.append("%")
        self.output.append("O1001 (HEIDENHAIN ISO VEXCAD GENERATED)")
        self.output.append("G21 G90 G17 G40 G49 G80")
        self.output.append("G54")

class HeidenhainKlartextPostProcessor(BasePostProcessor):
    """Heidenhain Conversational Klartext output."""
    def format_comment(self, text: str) -> str:
        return f"; {text}"

    def program_start(self):
        self.output.append("BEGIN PGM 1001 MM")
        self.output.append("; VEXCAD GENERATED KLARTEXT")
        self.output.append("; SETUP NOTE:")
        self.output.append("; Z0 = STOCK TOP")
        self.output.append("; XY ZERO = SETUP ORIGIN FROM VEXCAD")
        self.output.append("; OPERATOR MUST CONFIRM ACTIVE HEIDENHAIN PRESET BEFORE RUNNING")
        self.output.append("BLK FORM 0.1 Z X-100 Y-100 Z-50")
        self.output.append("BLK FORM 0.2 X+100 Y+100 Z+0")
        
    def program_end(self, setup_plan: Dict[str, Any] = None):
        self.coolant_off()
        self.output.append("M5")
        self.output.append("L Z+0 R0 FMAX M91")
        allow_xy_home = setup_plan and setup_plan.get("allowMachineXYHomeAtEnd", False)
        if allow_xy_home:
            self.output.append("L X+0 Y+0 R0 FMAX M91")
        self.output.append("M30")
        self.output.append("END PGM 1001 MM")
        
    def tool_change(self, tool_num: int, tool_name: str = ""):
        self.output.append(f"; T{tool_num} - {tool_name}")
        self.output.append(f"TOOL CALL {tool_num} Z")
        
    def start_spindle(self, rpm: int):
        last_line = self.output[-1] if self.output else ""
        if last_line.startswith("TOOL CALL ") and " S" not in last_line:
            self.output[-1] = f"{last_line} S{rpm}"
        else:
            self.output.append(f"TOOL CALL Z S{rpm}")
        self.output.append("M3")
        
    def spindle_stop(self):
        self.output.append("M5")
        
    def coolant_on(self):
        if not getattr(self, 'coolant_active', False):
            self.output.append("M8")
            self.coolant_active = True
        
    def coolant_off(self):
        if getattr(self, 'coolant_active', False):
            self.output.append("M9")
            self.coolant_active = False
        
    def apply_tool_length_offset(self, offset_num: int, safe_z: float):
        self.output.append(f"L Z+{safe_z:.3f} R0 FMAX")
        self.current_z = safe_z
        
    def rapid(self, x: float = None, y: float = None, z: float = None):
        cmd = "L"
        changed = False
        if x is not None and (self.current_x is None or round(x, 3) != round(self.current_x, 3)):
            cmd += f" X+{x:.3f}" if x >= 0 else f" X{x:.3f}"
            self.current_x = x
            changed = True
        if y is not None and (self.current_y is None or round(y, 3) != round(self.current_y, 3)):
            cmd += f" Y+{y:.3f}" if y >= 0 else f" Y{y:.3f}"
            self.current_y = y
            changed = True
        if z is not None and (self.current_z is None or round(z, 3) != round(self.current_z, 3)):
            cmd += f" Z+{z:.3f}" if z >= 0 else f" Z{z:.3f}"
            self.current_z = z
            changed = True
            
        if changed or getattr(self, 'current_feed', None) != "MAX":
            if cmd == "L":
                # We need to output something to set FMAX if it's not already MAX
                # but if nothing changed, just L FMAX is valid.
                cmd += " I" # Incremental 0 move? Actually Heidenhain allows just L FMAX? No, let's just force X if empty?
                # Usually we don't rapid to the exact same spot.
                pass
            cmd += " R0 FMAX"
            self.current_feed = "MAX"
            self.output.append(cmd.replace("L I", "L"))
            
    def linear(self, x: float = None, y: float = None, z: float = None, feed: float = None):
        cmd = "L"
        changed = False
        if x is not None and (self.current_x is None or round(x, 3) != round(self.current_x, 3)):
            cmd += f" X+{x:.3f}" if x >= 0 else f" X{x:.3f}"
            self.current_x = x
            changed = True
        if y is not None and (self.current_y is None or round(y, 3) != round(self.current_y, 3)):
            cmd += f" Y+{y:.3f}" if y >= 0 else f" Y{y:.3f}"
            self.current_y = y
            changed = True
        if z is not None and (self.current_z is None or round(z, 3) != round(self.current_z, 3)):
            cmd += f" Z+{z:.3f}" if z >= 0 else f" Z{z:.3f}"
            self.current_z = z
            changed = True
            
        # Must output if feed changed
        feed_changed = feed is not None and getattr(self, 'current_feed', None) != feed
        
        if changed or feed_changed:
            if cmd != "L":
                cmd += " R0"
            if feed_changed: 
                cmd += f" F{feed:.0f}"
                self.current_feed = feed
            
            if cmd != "L":
                self.output.append(cmd)
            
    def safe_tool_retract(self):
        self.coolant_off()
        self.spindle_stop()
        self.output.append("L Z+0 R0 FMAX M91")

    def drilling_cycle(self, x: float, y: float, z: float, r: float, feed: float, clearance: float = 15.0):
        self.ensure_safe_z(r)
        self.ensure_xy(x, y)
        self.output.append("CYCL DEF 200 DRILLING ~")
        self.output.append(f"    Q200={r:.3f} ; SET-UP CLEARANCE ~")
        self.output.append(f"    Q201={z:.3f} ; DEPTH ~")
        self.output.append(f"    Q206={feed:.0f} ; FEED RATE FOR PLNG. ~")
        
        q202 = min(abs(z) * 0.5, 5.0)
        if q202 <= 0.0: q202 = 0.001
        self.output.append(f"    Q202={q202:.3f} ; PLUNGING DEPTH ~")
        
        self.output.append(f"    Q210=0 ; DWELL TIME AT TOP ~")
        self.output.append(f"    Q203=0.000 ; SURFACE COORDINATE ~")
        self.output.append(f"    Q204={clearance:.3f} ; 2ND SET-UP CLEARANCE ~")
        self.output.append(f"    Q211=0 ; DWELL TIME AT DEPTH")
        self.output.append("CYCL CALL M8")
        
    def peck_drilling_cycle(self, x: float, y: float, z: float, r: float, q: float, feed: float, clearance: float = 15.0):
        self.ensure_safe_z(r)
        self.ensure_xy(x, y)
        self.output.append("CYCL DEF 205 UNIVERSAL PECKING ~")
        self.output.append(f"    Q200={r:.3f} ; SET-UP CLEARANCE ~")
        self.output.append(f"    Q201={z:.3f} ; DEPTH ~")
        self.output.append(f"    Q206={feed:.0f} ; FEED RATE FOR PLNG. ~")
        self.output.append(f"    Q202={q:.3f} ; PLUNGING DEPTH ~")
        surf_z = self.current_z if self.current_z is not None else 0
        self.output.append(f"    Q203=0.000 ; SURFACE COORDINATE ~")
        self.output.append(f"    Q204={clearance:.3f} ; 2ND SET-UP CLEARANCE")
        self.output.append("CYCL CALL M8")
        
    def cancel_cycle(self):
        pass

class PostProcessorFactory:
    """Factory to instantiate the correct dialect post-processor."""
    @staticmethod
    def create(post_id: str) -> BasePostProcessor:
        post_id = post_id.upper() if post_id else ""
        if "HAAS" in post_id:
            return HaasPostProcessor()
        elif "HEIDENHAIN_KLARTEXT" in post_id:
            return HeidenhainKlartextPostProcessor()
        elif "HEIDENHAIN" in post_id:
            return HeidenhainISOPostProcessor()
        else:
            return FanucPostProcessor() # Default ISO/Fanuc for all others currently implemented

# Legacy compatibility removed intentionally to enforce operation-based paths
class GCodeGenerator:
    def __init__(self, **kwargs):
        pass
        
    def generate(self, operations: List[Dict[str, Any]], setup_plan: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        Generates G-Code and validates it.
        Returns a dict matching GCodeResponse schema.
        """
        from app.models.schemas import GCodeValidationReport, ToolpathSegment
        
        post_id = "fanuc"
        if setup_plan and "postProcessor" in setup_plan:
            if setup_plan["postProcessor"] != "AUTO":
                post_id = setup_plan["postProcessor"]
            elif "controller" in setup_plan:
                post_id = setup_plan["controller"]
                
        post = PostProcessorFactory.create(post_id)
        
        report = GCodeValidationReport(status="passed")
        
        # Pre-posting validation (Controller-neutral)
        for op in operations:
            for seg_dict in op.get("toolpaths", []):
                move_type = seg_dict.get("moveType")
                end_pt = seg_dict.get("end", {})
                z = end_pt.get("z")
                
                # If it's a rapid move and goes below Z0
                if move_type in ["rapid_clearance", "rapid_xy", "approach_retract"] and z is not None and z < 0:
                    # Very conservative: block any rapid below Z0
                    report.status = "failed"
                    report.issues.append({
                        "type": "unsafe_rapid",
                        "message": f"Rapid move below Z0 detected at Z={z:.3f} in operation {op.get('name', 'Unknown')}"
                    })

        if report.status == "failed":
            report.status = "error"
            return {"gcode": "", "validation": report.model_dump()}
            
        # Post-processor generation
        gcode_text = post.generate(operations, setup_plan)
        
        # Post-posting validation (Dialect specific)
        lines = gcode_text.split('\n')
        for i, line in enumerate(lines):
            line_upper = line.upper()
            
            # Fanuc/ISO specific validation
            if isinstance(post, FanucPostProcessor) and not isinstance(post, HeidenhainKlartextPostProcessor):
                if "G0 " in line_upper or "G00 " in line_upper:
                    # Check if Z is negative
                    parts = line_upper.split()
                    for p in parts:
                        if p.startswith("Z") and "-" in p:
                            report.status = "failed"
                            report.issues.append({"type": "unsafe_rapid_g0", "message": f"Unsafe Fanuc rapid Z move on line {i+1}: {line}"})
                            
                if "G53 G0 Z0" in line_upper or "G53 Z0" in line_upper:
                    # This is allowed but must be a retract. Ensure no X/Y on same line unless safe.
                    if "X" in line_upper or "Y" in line_upper:
                        report.status = "failed"
                        report.issues.append({"type": "unsafe_g53", "message": f"G53 Z0 combined with XY move on line {i+1}: {line}"})
                        
            # Heidenhain specific validation
            if isinstance(post, HeidenhainKlartextPostProcessor):
                if "FMAX" in line_upper and "Z-" in line_upper:
                    report.status = "failed"
                    report.issues.append({"type": "unsafe_rapid_fmax", "message": f"Unsafe Heidenhain FMAX Z move on line {i+1}: {line}"})

        return {
            "gcode": gcode_text if report.status == "passed" else None,
            "validation": report.model_dump(),
            "toolpaths": []
        }
        
    def generate_from_toolpaths(self, toolpaths, **kwargs):
        raise ValueError("legacy_path generation is permanently blocked. Use generate(operations) instead.")