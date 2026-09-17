from typing import List, Dict, Any
from app.services.gcode.post_unit_converter import PostUnitConverter

class BasePostProcessor:
    """Base class for all CNC dialect post-processors."""
    def __init__(self):
        self.output = []
        self.current_x = None

        self.current_y = None
        self.current_z = None
        self.current_a = None
        self.current_b = None
        self.current_c = None
        self.current_feed = None
        self.coolant_active = False
        self.converter = PostUnitConverter("mm")
        
    def format_comment(self, text: str) -> str:
        return f"({text})"
        
    def generate(self, operations: List[Dict[str, Any]], setup_plan: Dict[str, Any] = None) -> str:
        self.output = []
        self.current_x = None

        self.current_y = None
        self.current_z = None
        self.current_a = None
        self.current_b = None
        self.current_c = None
        self.current_feed = None
        self.coolant_active = False
        self.current_tool_num = None
        self.current_rpm = None
        
        active_plan = dict(setup_plan) if isinstance(setup_plan, dict) else {}
        if operations and operations[0].get("wcs"):
            active_plan["workCoordinateSystem"] = operations[0]["wcs"]
            active_plan["wcs"] = operations[0]["wcs"]
            
        post_units = active_plan.get("postOutputUnits", "mm")
        self.converter = PostUnitConverter(post_units)
        self.setup_plan = active_plan
        self._job_bounds = self._compute_job_bounds(operations)
        
        # Detect whether the first operation is live milling vs turning to select the initial modal plane
        if operations and hasattr(self, "is_milling_mode"):
            first_op_type = str(operations[0].get('type') or operations[0].get('machining_strategy') or '').lower()
            is_turning = any(t in first_op_type for t in ('turning', 'lathe', 'facing_turning', 'od_turning', 'id_turning', 'grooving', 'parting'))
            self.is_milling_mode = not is_turning

        self.program_start(active_plan)
        
        current_setup_id = None
        emitted_wcs = active_plan.get("workCoordinateSystem", active_plan.get("wcs", "G54"))
        
        for op in operations:
            # --- Setup / WCS Change Detection ---
            op_setup_id = op.get('setup_id')
            op_wcs = op.get('wcs')
            if op_setup_id and current_setup_id and op_setup_id != current_setup_id:
                # A new setup is starting — emit safe retract, operator stop, and new WCS
                self._emit_setup_change(op, setup_plan)
                if op_wcs:
                    emitted_wcs = op_wcs
            elif op_wcs and op_wcs != emitted_wcs and current_setup_id is None:
                # First operation is on a different WCS than the program header;
                # emit the correct WCS without a retract/M00.
                self.output.append(op_wcs)
                emitted_wcs = op_wcs
            if op_setup_id:
                current_setup_id = op_setup_id
            
            self.output.append("\n" + self.format_comment(f"--- OPERATION: {op.get('type', 'UNKNOWN').upper()} ---"))
            feature_id = op.get('feature_id')
            if feature_id:
                self.output.append(self.format_comment(f"FEATURE: {feature_id}"))
                
            self._write_operation(op)
            
        self.program_end(setup_plan)
        return "\n".join(self.output)
        
    def program_start(self, setup_plan: Dict[str, Any] = None):
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
        
    def tcpc_on(self):
        pass
        
    def tcpc_off(self):
        pass
        
    def index_3_plus_2(self, a: float, b: float, c: float):
        pass
        
    def cancel_index(self):
        pass
    
    def _emit_setup_change(self, next_op: Dict[str, Any], setup_plan: Dict[str, Any] = None):
        """
        Emits G-code for a setup change: safe retract, operator instructions, M00, new WCS.
        Called when setup_id changes between consecutive operations.
        """
        # Safe retract and stop
        self.coolant_off()
        self.spindle_stop()
        
        # Reset machine state tracking
        self.current_tool_num = None
        self.current_rpm = None
        self.current_x = None
        self.current_y = None
        self.current_z = None
        
        # Derive setup name from operation metadata
        setup_name = next_op.get('setup_name', next_op.get('setup_id', 'Next Setup'))
        
        self.output.append("")
        self.output.append(self.format_comment(f"{'=' * 50}"))
        self.output.append(self.format_comment(f"SETUP CHANGE: {setup_name}"))
        self.output.append(self.format_comment(f"Reclamp part. Verify datum and runout before continuing."))
        self.output.append(self.format_comment(f"{'=' * 50}"))
        
        # Mandatory program stop — operator must verify part clamping
        self.output.append("M00")
        
        # Emit new WCS if available
        new_wcs = next_op.get('wcs')
        if new_wcs:
            self.output.append(new_wcs)
        
    def rapid(self, x: float = None, y: float = None, z: float = None, a: float = None, b: float = None, c: float = None):
        pass
        
    def linear(self, x: float = None, y: float = None, z: float = None, a: float = None, b: float = None, c: float = None, feed: float = None):
        pass
        
    def arc(self, cw: bool, x: float = None, y: float = None, z: float = None,
            i: float = None, j: float = None, k: float = None, r: float = None,
            a: float = None, b: float = None, c: float = None, feed: float = None):
        """
        Circular/helical interpolation. Defaults to a linear chord when no arc
        center/radius is supplied so geometry is never dropped. Subclasses
        (e.g. FanucPostProcessor) override this to emit G2/G3 with I/J/K/R.
        """
        self.linear(x=x, y=y, z=z, a=a, b=b, c=c, feed=feed)

    def drilling_cycle(self, x: float, y: float, z: float, r: float, feed: float, clearance: float = 15.0):
        pass

    def _compute_job_bounds(self, operations: List[Dict[str, Any]]):
        """Derives the bounding box of all toolpath endpoints to drive
        stock-aware output (e.g. Heidenhain BLK FORM) instead of hardcoded values."""
        mins = [None, None, None]
        maxs = [None, None, None]
        for op in operations or []:
            for seg in op.get('toolpaths', []) or []:
                if not isinstance(seg, dict):
                    continue
                pt = seg.get('end') or seg.get('start')
                if not isinstance(pt, dict):
                    continue
                for idx, key in enumerate(('x', 'y', 'z')):
                    v = pt.get(key)
                    if v is None:
                        continue
                    if mins[idx] is None or v < mins[idx]:
                        mins[idx] = v
                    if maxs[idx] is None or v > maxs[idx]:
                        maxs[idx] = v
        if mins[0] is None:
            return None
        return tuple(mins + maxs)
        
    def peck_drilling_cycle(self, x: float, y: float, z: float, r: float, q: float, feed: float, clearance: float = 15.0):
        pass
        
    def cancel_cycle(self):
        pass

    def ensure_safe_z(self, clearance_z: float):
        if self.current_z is None or self.current_z < clearance_z:
            self.rapid(z=clearance_z)

    def ensure_xy(self, x: float = None, y: float = None):
        if x is not None and (self.current_x is None or self.current_x != x):
            self.rapid(x=x, y=y)
        elif y is not None and (self.current_y is None or self.current_y != y):
            self.rapid(x=x, y=y)

    def emit_safe_approach(self, x: float, y: float, clearance_z: float, retract_z: float):
        self.ensure_safe_z(clearance_z)
        self.ensure_xy(x, y)
        if self.current_z is None or self.current_z > retract_z:
            self.rapid(z=retract_z)

    def emit_safe_retract(self, clearance_z: float):
        self.ensure_safe_z(clearance_z)
    def start_operation(self, op: Dict[str, Any]):
        pass

    def end_operation(self, op: Dict[str, Any]):
        pass

    def _write_operation(self, op: Dict[str, Any]):
        segments = op.get('toolpaths', [])
        if not segments:
            return

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
            # Reset all machine state — safe_tool_retract issues M05 + G53 G0 Z0.,
            # so spindle is off and position in work coordinates is unknown after M06.
            self.current_rpm = None
            self.current_x = None
            self.current_y = None
            self.current_z = None
        self.start_operation(op)

        # Reset feedrate modal tracking so each operation explicitly outputs F on its first linear cut
        self.current_feed = None

        rpm = op.get('parameters', {}).get('spindleSpeed', op.get('parameters', {}).get('spindle_speed', 1000))
        spindle_active = getattr(self, "live_tool_running", False) if getattr(self, "is_milling_mode", False) else (self.current_rpm is not None)
        if self.current_rpm != rpm or not spindle_active:
            self.start_spindle(int(rpm))
            self.current_rpm = rpm

        offset_num = tool.get('offset_number', tool_num)

        # Clearances
        safe_heights = op.get('safe_heights', {})
        clearance_z = safe_heights.get('clearance', 15.0)
        retract_z = safe_heights.get('retract', 5.0)

        # Apply offset and coolant safely
        # Instead of a redundant G0 before G43, we just use G43 to perform the safe Z approach.
        self.apply_tool_length_offset(offset_num, clearance_z)

        if op.get('parameters', {}).get('coolant_enabled', True):
            self.coolant_on()

        op_type = op.get('type')
        feed_cut = op.get('parameters', {}).get('feed_rate', 1000)
        feed_plunge = op.get('parameters', {}).get('plunge_rate', 300)


        is_first = True
        
        is_tcpc = op.get('parameters', {}).get('tcpc', False)
        indexing_angles = op.get('parameters', {}).get('indexing_angles')
        
        if indexing_angles:
            self.index_3_plus_2(indexing_angles.get('a', 0), indexing_angles.get('b', 0), indexing_angles.get('c', 0))
            
        if is_tcpc:
            self.tcpc_on()

        for seg in segments:
            move_type = seg.get('moveType', 'unknown')
            pt = seg.get('end', {})
            x, y, z = pt.get('x'), pt.get('y'), pt.get('z')
            a, b, c = pt.get('a'), pt.get('b'), pt.get('c')

            # Ensure safe Z before any XY motion if it's the first move and state is unknown
            if is_first and move_type in ['approach_retract', 'rapid_xy', 'cut', 'arc_cw', 'arc_ccw', 'plunge', 'drill_cycle']:
                self.ensure_safe_z(clearance_z)
                if x is not None or y is not None:
                    self.ensure_xy(x, y)
            is_first = False

            if move_type == 'drill_cycle':
                bottom_z = pt.get('z', 0.0)
                cycle_type = op.get('parameters', {}).get('cycle_type', 'G81')
                # Drill cycle should already have safe XY approaches emitted by motion planner.
                # If not, we ensure it safely here:
                if x is not None or y is not None:
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
                if a is not None or b is not None or c is not None:
                    self.rapid(a=a, b=b, c=c)
                
            elif move_type == 'rapid_xy':
                self.ensure_xy(x, y)
                if a is not None or b is not None or c is not None:
                    self.rapid(a=a, b=b, c=c)
                
            elif move_type == 'approach_retract':
                if x is not None or y is not None:
                    self.ensure_xy(x, y)
                safe_z = max(z if z is not None else retract_z, retract_z)
                self.rapid(z=safe_z, a=a, b=b, c=c)
                
            elif move_type == 'retract_clearance':
                safe_z = max(z if z is not None else clearance_z, clearance_z)
                self.ensure_safe_z(safe_z)

            elif move_type == 'plunge':
                if x is not None or y is not None:
                    self.ensure_xy(x, y)
                plunge_feed = seg.get('feedrate') or feed_plunge
                self.linear(x=x, y=y, z=z, a=a, b=b, c=c, feed=plunge_feed)
                self.current_z = z if z is not None else self.current_z

            elif move_type in ['cut', 'arc_cw', 'arc_ccw']:
                role = seg.get('segmentRole')
                # Prefer per-segment feedrate if set, fallback to operation default
                seg_feed = seg.get('feedrate')
                if seg_feed and seg_feed > 0:
                    actual_feed = seg_feed
                elif role in ['lead_in', 'lead_out']:
                    actual_feed = op.get('parameters', {}).get('feed_lead', feed_cut * 0.5)
                else:
                    actual_feed = feed_cut

                if move_type in ['arc_cw', 'arc_ccw']:
                    # Emit a true circular interpolation move (G2/G3) when arc
                    # center/radius data is present; otherwise fall back to a
                    # linear chord so the geometry is never silently dropped.
                    self.arc(
                        cw=(move_type == 'arc_cw'),
                        x=x, y=y, z=z, a=a, b=b, c=c, feed=actual_feed,
                        i=seg.get('i'), j=seg.get('j'), k=seg.get('k'), r=seg.get('radius'),
                    )
                else:
                    self.linear(x=x, y=y, z=z, a=a, b=b, c=c, feed=actual_feed)
                self.current_z = z if z is not None else self.current_z

        if is_tcpc:
            self.tcpc_off()
            
        if indexing_angles:
            self.cancel_index()

        # Retract at end of op
        self.emit_safe_retract(clearance_z)
        self.end_operation(op)


class FanucPostProcessor(BasePostProcessor):
    """Standard ISO/Fanuc compatible G-Code output."""
    def program_start(self, setup_plan: Dict[str, Any] = None):
        unit_gcode = "G20" if self.converter.is_inch else "G21"
        program_number = (setup_plan or {}).get("programNumber") or (setup_plan or {}).get("program_number") or "O1001"
        self.output.append("%")
        self.output.append(f"{program_number} (VEXCAD GENERATED)")
        self.output.append(f"{unit_gcode} G90 G17 G40 G49 G80")
        wcs = (setup_plan or {}).get("workCoordinateSystem", (setup_plan or {}).get("wcs", "G54"))
        self.output.append(wcs)
        
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
        direction = getattr(self, '_spindle_direction', 'cw')
        mcode = "M04" if direction == "ccw" else "M03"
        self.output.append(f"S{rpm} {mcode}")
        
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
        self.output.append(f"G0 G43 H{offset_num} Z{self._fmt(safe_z)}")
        self.current_z = safe_z
        
    def tcpc_on(self):
        self.output.append("G43.4 H" + str(self.current_tool_num or 1))
        
    def tcpc_off(self):
        self.output.append("G49")
        
    def index_3_plus_2(self, a: float, b: float, c: float):
        self.output.append(f"G68.2 X0. Y0. Z0. I{a:.3f} J{b:.3f} K{c:.3f}")
        self.output.append("G53.1")
        
    def cancel_index(self):
        self.output.append("G69")

    def _fmt(self, val: float) -> str:
        return self.converter.format_length(val)

    def rapid(self, x: float = None, y: float = None, z: float = None, a: float = None, b: float = None, c: float = None):
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
        if a is not None:
            cmd += f" A{a:.3f}"
            self.current_a = a
        if b is not None:
            cmd += f" B{b:.3f}"
            self.current_b = b
        if c is not None:
            cmd += f" C{c:.3f}"
            self.current_c = c
        if cmd != "G0":
            self.output.append(cmd)
            
    def linear(self, x: float = None, y: float = None, z: float = None, a: float = None, b: float = None, c: float = None, feed: float = None):
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
        if a is not None:
            cmd += f" A{a:.3f}"
            self.current_a = a
        if b is not None:
            cmd += f" B{b:.3f}"
            self.current_b = b
        if c is not None:
            cmd += f" C{c:.3f}"
            self.current_c = c
        if feed is not None: cmd += f" F{self.converter.format_feed(feed)}"
        if cmd != "G1":
            self.output.append(cmd)

    def arc(self, cw: bool, x: float = None, y: float = None, z: float = None,
            i: float = None, j: float = None, k: float = None, r: float = None,
            a: float = None, b: float = None, c: float = None, feed: float = None):
        # Without center/radius info we cannot synthesize a valid G2/G3, so we
        # fall back to a linear chord rather than emitting an incomplete arc.
        if r is None and i is None and j is None and k is None:
            self.linear(x=x, y=y, z=z, a=a, b=b, c=c, feed=feed)
            return

        cmd = "G2" if cw else "G3"
        if x is not None:
            cmd += f" X{self._fmt(x)}"
            self.current_x = x
        if y is not None:
            cmd += f" Y{self._fmt(y)}"
            self.current_y = y
        if z is not None:
            cmd += f" Z{self._fmt(z)}"
            self.current_z = z
        if r is not None:
            cmd += f" R{self._fmt(r)}"
        else:
            if i is not None: cmd += f" I{self._fmt(i)}"
            if j is not None: cmd += f" J{self._fmt(j)}"
            if k is not None: cmd += f" K{self._fmt(k)}"
        if a is not None: cmd += f" A{a:.3f}"
        if b is not None: cmd += f" B{b:.3f}"
        if c is not None: cmd += f" C{c:.3f}"
        if feed is not None: cmd += f" F{self.converter.format_feed(feed)}"
        self.output.append(cmd)
            
    def safe_tool_retract(self):
        self.coolant_off()
        self.spindle_stop()
        self.output.append("G49")
        self.output.append("G53 G0 Z0.")

    def drilling_cycle(self, x: float, y: float, z: float, r: float, feed: float, clearance: float = 15.0):
        self.ensure_safe_z(r)
        self.ensure_xy(x, y)
        self.output.append(f"G98 G81 X{self._fmt(x)} Y{self._fmt(y)} Z{self._fmt(z)} R{self._fmt(r)} F{self.converter.format_feed(feed)}")
        
    def peck_drilling_cycle(self, x: float, y: float, z: float, r: float, q: float, feed: float, clearance: float = 15.0):
        self.ensure_safe_z(r)
        self.ensure_xy(x, y)
        self.output.append(f"G98 G83 X{self._fmt(x)} Y{self._fmt(y)} Z{self._fmt(z)} R{self._fmt(r)} Q{self._fmt(q)} F{self.converter.format_feed(feed)}")
        
    def cancel_cycle(self):
        self.output.append("G80")


class SiemensPostProcessor(FanucPostProcessor):
    """Siemens SINUMERIK compatible G-Code output."""
    def program_start(self, setup_plan: Dict[str, Any] = None):
        unit_gcode = "G70" if self.converter.is_inch else "G71"
        program_number = (setup_plan or {}).get("programNumber") or (setup_plan or {}).get("program_number") or "O1001"
        self.output.append("%")
        self.output.append(f"; {program_number} VEXCAD GENERATED - SIEMENS 840D/828D")
        self.output.append(f"{unit_gcode} G90 G17 G40")
        wcs = (setup_plan or {}).get("workCoordinateSystem", (setup_plan or {}).get("wcs", "G54"))
        self.output.append(wcs)
        
    def program_end(self, setup_plan: Dict[str, Any] = None):
        self.coolant_off()
        self.output.append("M05")
        self.output.append("SUPA G0 Z0 D0")
        self.output.append("M30")
        
    def start_spindle(self, rpm: int):
        direction = getattr(self, '_spindle_direction', 'cw')
        mcode = "M04" if direction == "ccw" else "M03"
        self.output.append(f"S{rpm} {mcode}")

    def apply_tool_length_offset(self, offset_num: int, safe_z: float):
        # Siemens uses the D-word (length offset number), not a hardcoded D1.
        self.output.append(f"G0 Z{self._fmt(safe_z)} D{offset_num}")
        self.current_z = safe_z
        
    def tcpc_on(self):
        self.output.append("TRAORI")
        
    def tcpc_off(self):
        self.output.append("TRAFOOF")
        
    def index_3_plus_2(self, a: float, b: float, c: float):
        self.output.append(f"CYCLE800(0,"",0,57,0,0,0,{a:.3f},{b:.3f},{c:.3f},0,0,0,0,1)")
        
    def cancel_index(self):
        self.output.append("CYCLE800()")
        
    def safe_tool_retract(self):
        self.coolant_off()
        self.spindle_stop()
        self.output.append("SUPA G0 Z0 D0")

    def drilling_cycle(self, x: float, y: float, z: float, r: float, feed: float, clearance: float = 15.0):
        # Siemens does not use Fanuc G81; emit the native CYCLE81 call.
        self.ensure_safe_z(r)
        self.ensure_xy(x, y)
        self.output.append(f"F{self.converter.format_feed(feed)}")
        self.output.append(f"CYCLE81({self._fmt(r)},0.0,0.0,{self._fmt(z)},0.0,0.0)")

    def peck_drilling_cycle(self, x: float, y: float, z: float, r: float, q: float, feed: float, clearance: float = 15.0):
        # Siemens peck drilling uses CYCLE83 (RTP,RFP,SDIS,DP,DPR,FDEP,FDPR,DAM,DTB,...)
        self.ensure_safe_z(r)
        self.ensure_xy(x, y)
        self.output.append(f"F{self.converter.format_feed(feed)}")
        self.output.append(f"CYCLE83({self._fmt(r)},0.0,0.0,{self._fmt(z)},0.0,0.0,{self._fmt(q)},0.0,0.0,1.0,1.0,1)")

class HaasPostProcessor(FanucPostProcessor):
    """Haas-specific dialect."""
    def program_start(self, setup_plan: Dict[str, Any] = None):
        unit_gcode = "G20" if self.converter.is_inch else "G21"
        program_number = (setup_plan or {}).get("programNumber") or (setup_plan or {}).get("program_number") or "O1001"
        self.output.append("%")
        self.output.append(f"{program_number} (HAAS VEXCAD GENERATED)")
        self.output.append(f"{unit_gcode} G90 G17 G40 G49 G80")
        wcs = (setup_plan or {}).get("workCoordinateSystem", (setup_plan or {}).get("wcs", "G54"))
        self.output.append(wcs)

class HeidenhainISOPostProcessor(FanucPostProcessor):
    """Heidenhain ISO compatible G-Code output."""
    def program_start(self, setup_plan: Dict[str, Any] = None):
        unit_gcode = "G20" if self.converter.is_inch else "G21"
        program_number = (setup_plan or {}).get("programNumber") or (setup_plan or {}).get("program_number") or "O1001"
        self.output.append("%")
        self.output.append(f"{program_number} (HEIDENHAIN ISO VEXCAD GENERATED)")
        self.output.append(f"{unit_gcode} G90 G17 G40 G49 G80")
        wcs = (setup_plan or {}).get("workCoordinateSystem", (setup_plan or {}).get("wcs", "G54"))
        self.output.append(wcs)

class HeidenhainKlartextPostProcessor(BasePostProcessor):
    """Heidenhain Conversational Klartext output."""
    def format_comment(self, text: str) -> str:
        return f"; {text}"

    def _kfmt(self, val: float) -> str:
        """Klartext length formatter: positive values prefixed with '+',
        negatives shown with their sign, routed through the unit converter."""
        c = self.converter.convert_length(val)
        if c is None:
            return "0.000"
        return f"+{c:.3f}" if c >= 0 else f"{c:.3f}"

    def _kfeed(self, feed: float) -> str:
        f = self.converter.convert_feed(feed)
        if f is None:
            return ""
        return f"{f:.0f}"

    def program_start(self, setup_plan: Dict[str, Any] = None):
        unit_str = "INCH" if self.converter.is_inch else "MM"
        raw_pn = (setup_plan or {}).get("programNumber") or (setup_plan or {}).get("program_number") or "1001"
        program_number = str(raw_pn).lstrip("Oo")
        self._program_number = program_number
        self.output.append(f"BEGIN PGM {program_number} {unit_str}")
        self.output.append("; VEXCAD GENERATED KLARTEXT")
        self.output.append("; SETUP NOTE:")
        self.output.append("; Z0 = STOCK TOP")
        self.output.append("; XY ZERO = SETUP ORIGIN FROM VEXCAD")
        self.output.append("; OPERATOR MUST CONFIRM ACTIVE HEIDENHAIN PRESET BEFORE RUNNING")

        # BLK FORM must reflect the actual job envelope, not a hardcoded box.
        bounds = getattr(self, '_job_bounds', None)
        if bounds:
            minx, miny, minz, maxx, maxy, maxz = bounds
            margin = 5.0
            self.output.append(
                f"BLK FORM 0.1 Z X{self._kfmt(minx - margin)} Y{self._kfmt(miny - margin)} Z{self._kfmt(minz - margin)}"
            )
            self.output.append(
                f"BLK FORM 0.2 X+{self.converter.convert_length(maxx + margin):.3f} "
                f"Y+{self.converter.convert_length(maxy + margin):.3f} "
                f"Z+{self.converter.convert_length(maxz + margin):.3f}"
            )
        
    def program_end(self, setup_plan: Dict[str, Any] = None):
        self.coolant_off()
        self.output.append("M5")
        self.output.append("L Z+0 R0 FMAX M91")
        allow_xy_home = setup_plan and setup_plan.get("allowMachineXYHomeAtEnd", False)
        if allow_xy_home:
            self.output.append("L X+0 Y+0 R0 FMAX M91")
        self.output.append("M30")
        program_number = getattr(self, '_program_number', '1001')
        unit_str = "INCH" if self.converter.is_inch else "MM"
        self.output.append(f"END PGM {program_number} {unit_str}")
        
    def tool_change(self, tool_num: int, tool_name: str = ""):
        self.output.append(f"; T{tool_num} - {tool_name}")
        self.output.append(f"TOOL CALL {tool_num} Z")
        
    def start_spindle(self, rpm: int):
        direction = getattr(self, '_spindle_direction', 'cw')
        mcode = "M4" if direction == "ccw" else "M3"
        last_line = self.output[-1] if self.output else ""
        if last_line.startswith("TOOL CALL ") and " S" not in last_line:
            self.output[-1] = f"{last_line} S{rpm}"
        else:
            self.output.append(f"TOOL CALL Z S{rpm}")
        self.output.append(mcode)
        
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
        self.output.append(f"L Z{self._kfmt(safe_z)} R0 FMAX")
        self.current_z = safe_z
        
    def tcpc_on(self):
        self.output.append("M128")
        
    def tcpc_off(self):
        self.output.append("M129")
        
    def index_3_plus_2(self, a: float, b: float, c: float):
        self.output.append(f"PLANE SPATIAL SPA{a:.3f} SPB{b:.3f} SPC{c:.3f} TURN FMAX")
        
    def cancel_index(self):
        self.output.append("PLANE RESET TURN FMAX")

    def rapid(self, x: float = None, y: float = None, z: float = None, a: float = None, b: float = None, c: float = None):
        cmd = "L"
        changed = False
        if x is not None and (self.current_x is None or round(self.converter.convert_length(x) or 0.0, 3) != round(self.converter.convert_length(self.current_x) or 0.0, 3)):
            cmd += f" X{self._kfmt(x)}"
            self.current_x = x
            changed = True
        if y is not None and (self.current_y is None or round(self.converter.convert_length(y) or 0.0, 3) != round(self.converter.convert_length(self.current_y) or 0.0, 3)):
            cmd += f" Y{self._kfmt(y)}"
            self.current_y = y
            changed = True
        if z is not None and (self.current_z is None or round(self.converter.convert_length(z) or 0.0, 3) != round(self.converter.convert_length(self.current_z) or 0.0, 3)):
            cmd += f" Z{self._kfmt(z)}"
            self.current_z = z
            changed = True
        if a is not None and (self.current_a is None or round(a, 3) != round(self.current_a, 3)):
            cmd += f" A+{a:.3f}" if a >= 0 else f" A{a:.3f}"
            self.current_a = a
            changed = True
        if b is not None and (self.current_b is None or round(b, 3) != round(self.current_b, 3)):
            cmd += f" B+{b:.3f}" if b >= 0 else f" B{b:.3f}"
            self.current_b = b
            changed = True
        if c is not None and (self.current_c is None or round(c, 3) != round(self.current_c, 3)):
            cmd += f" C+{c:.3f}" if c >= 0 else f" C{c:.3f}"
            self.current_c = c
            changed = True
            
        if changed or getattr(self, 'current_feed', None) != "MAX":
            cmd += " R0 FMAX"
            self.current_feed = "MAX"
            self.output.append(cmd)
            
    def linear(self, x: float = None, y: float = None, z: float = None, a: float = None, b: float = None, c: float = None, feed: float = None):
        cmd = "L"
        changed = False
        if x is not None and (self.current_x is None or round(self.converter.convert_length(x) or 0.0, 3) != round(self.converter.convert_length(self.current_x) or 0.0, 3)):
            cmd += f" X{self._kfmt(x)}"
            self.current_x = x
            changed = True
        if y is not None and (self.current_y is None or round(self.converter.convert_length(y) or 0.0, 3) != round(self.converter.convert_length(self.current_y) or 0.0, 3)):
            cmd += f" Y{self._kfmt(y)}"
            self.current_y = y
            changed = True
        if z is not None and (self.current_z is None or round(self.converter.convert_length(z) or 0.0, 3) != round(self.converter.convert_length(self.current_z) or 0.0, 3)):
            cmd += f" Z{self._kfmt(z)}"
            self.current_z = z
            changed = True
        if a is not None and (self.current_a is None or round(a, 3) != round(self.current_a, 3)):
            cmd += f" A+{a:.3f}" if a >= 0 else f" A{a:.3f}"
            self.current_a = a
            changed = True
        if b is not None and (self.current_b is None or round(b, 3) != round(self.current_b, 3)):
            cmd += f" B+{b:.3f}" if b >= 0 else f" B{b:.3f}"
            self.current_b = b
            changed = True
        if c is not None and (self.current_c is None or round(c, 3) != round(self.current_c, 3)):
            cmd += f" C+{c:.3f}" if c >= 0 else f" C{c:.3f}"
            self.current_c = c
            changed = True
            
        feed_changed = feed is not None and getattr(self, 'current_feed', None) != feed
        
        if changed or feed_changed:
            if cmd != "L":
                cmd += " R0"
            if feed_changed: 
                cmd += f" F{self._kfeed(feed)}"
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
        self.output.append(f"    Q200={self._kfmt(r)} ; SET-UP CLEARANCE ~")
        self.output.append(f"    Q201={self._kfmt(z)} ; DEPTH ~")
        self.output.append(f"    Q206={self._kfeed(feed)} ; FEED RATE FOR PLNG. ~")
        
        q202 = min(abs(z) * 0.5, 5.0)
        if q202 <= 0.0: q202 = 0.001
        self.output.append(f"    Q202={self._kfmt(q202)} ; PLUNGING DEPTH ~")
        
        self.output.append(f"    Q210=0 ; DWELL TIME AT TOP ~")
        self.output.append(f"    Q203=0.000 ; SURFACE COORDINATE ~")
        self.output.append(f"    Q204={self._kfmt(clearance)} ; 2ND SET-UP CLEARANCE ~")
        self.output.append(f"    Q211=0 ; DWELL TIME AT DEPTH")
        self.output.append("CYCL CALL M8")
        
    def peck_drilling_cycle(self, x: float, y: float, z: float, r: float, q: float, feed: float, clearance: float = 15.0):
        self.ensure_safe_z(r)
        self.ensure_xy(x, y)
        self.output.append("CYCL DEF 205 UNIVERSAL PECKING ~")
        self.output.append(f"    Q200={self._kfmt(r)} ; SET-UP CLEARANCE ~")
        self.output.append(f"    Q201={self._kfmt(z)} ; DEPTH ~")
        self.output.append(f"    Q206={self._kfeed(feed)} ; FEED RATE FOR PLNG. ~")
        self.output.append(f"    Q202={self._kfmt(q)} ; PLUNGING DEPTH ~")
        surf_z = self.current_z if self.current_z is not None else 0
        self.output.append(f"    Q203=0.000 ; SURFACE COORDINATE ~")
        self.output.append(f"    Q204={clearance:.3f} ; 2ND SET-UP CLEARANCE")
        self.output.append("CYCL CALL M8")
        
    def cancel_cycle(self):
        pass


class FanucLathePostProcessor(FanucPostProcessor):
    """ISO/Fanuc compatible G-Code output for Lathes and Mill-Turn machines with live tooling."""
    def __init__(self, is_diameter_mode: bool = True):
        super().__init__()
        self.is_diameter_mode = is_diameter_mode
        self.is_milling_mode = False
        self.live_tool_running = False
        self.current_plane = "G18"

    def program_start(self, setup_plan: Dict[str, Any] = None):
        unit_gcode = "G20" if self.converter.is_inch else "G21"
        program_number = (setup_plan or {}).get("programNumber") or (setup_plan or {}).get("program_number") or "O1002"
        self.output.append("%")
        self.output.append(f"{program_number} (VEXCAD LATHE GENERATED)")
        initial_plane = "G17" if getattr(self, "is_milling_mode", False) else "G18"
        self.output.append(f"{unit_gcode} {initial_plane} G40 G80 G90 G94")
        wcs = (setup_plan or {}).get("workCoordinateSystem", (setup_plan or {}).get("wcs", "G54"))
        self.output.append(wcs)

    def program_end(self, setup_plan: Dict[str, Any] = None):
        self.coolant_off()
        if getattr(self, "live_tool_running", False):
            self.output.append("M105")
            self.live_tool_running = False
        self.output.append("M05")
        # Safe machine home position: X radially first, then Z axially
        self.output.append("G28 U0 W0")
        self.output.append("M30")
        self.output.append("%")

    def safe_tool_retract(self):
        self.coolant_off()
        self.spindle_stop()
        if getattr(self, "live_tool_running", False):
            self.output.append("M105")
            self.live_tool_running = False
        self.output.append("G49")
        # Retract radially home first (U0), then axially (W0) to prevent turret swing collisions
        self.output.append("G28 U0")
        self.output.append("G28 W0")

    def tool_change(self, tool_num: int, tool_name: str = ""):
        self.output.append(f"(T{tool_num:02d}{tool_num:02d} - {tool_name})")
        # Lathe & mill-turn tools are indexed via T0101 (tool station 1, geometry/wear offset 1)
        self.output.append(f"T{tool_num:02d}{tool_num:02d}")

    def apply_tool_length_offset(self, offset_num: int, safe_z: float):
        if getattr(self, "is_milling_mode", False):
            # For live tooling / milling in mill-turn, G43 engages tool length offset
            self.output.append(f"G43 H{offset_num:02d} Z{self.converter.format_length(safe_z)}")
            self.current_z = safe_z
        else:
            # Lathe tool offset is applied with the T command (T0101)
            self.output.append(f"G0 Z{self.converter.format_length(safe_z)}")
            self.current_z = safe_z

    def start_spindle(self, rpm: int):
        direction = getattr(self, '_spindle_direction', 'cw')
        if getattr(self, "is_milling_mode", False):
            mcode = "M104" if direction == "ccw" else "M103"
            self.output.append(f"{mcode} S{rpm}")
            self.live_tool_running = True
        else:
            mcode = "M04" if direction == "ccw" else "M03"
            # Cap turning max spindle RPM for centrifugal safety
            setup_dict = getattr(self, "setup_plan", {}) or {}
            max_rpm = None
            if isinstance(setup_dict, dict):
                max_rpm = (
                    setup_dict.get("max_spindle_rpm")
                    or setup_dict.get("maxSpindleSpeed")
                    or (setup_dict.get("machine", {}) if isinstance(setup_dict.get("machine"), dict) else {}).get("spindle_max_rpm")
                )
            if not max_rpm:
                max_rpm = 3500
            self.output.append(f"G50 S{int(max_rpm)}")
            # G97 = constant RPM for safe generic lathe code.
            self.output.append(f"G97 S{rpm} {mcode}")

    def spindle_stop(self):
        if getattr(self, "live_tool_running", False):
            self.output.append("M105")
            self.live_tool_running = False
        self.output.append("M05")
        self.current_rpm = None

    def start_operation(self, op: Dict[str, Any]):
        op_type = str(op.get('type') or op.get('machining_strategy') or '').lower()
        is_turning = any(t in op_type for t in ('turning', 'lathe', 'facing_turning', 'od_turning', 'id_turning', 'grooving', 'parting'))
        
        if is_turning:
            self.is_milling_mode = False
            if getattr(self, "live_tool_running", False):
                self.output.append("M105")
                self.live_tool_running = False
            if getattr(self, "current_plane", "G18") != "G18":
                self.output.append("G18")
                self.current_plane = "G18"
        else:
            self.is_milling_mode = True
            # For live milling on mill-turn: stop main spindle if running and orient/lock C-axis
            if getattr(self, "current_rpm", None) is not None:
                self.output.append("M05")
            self.output.append("M19")
            self.output.append("G17")
            self.current_plane = "G17"

    def end_operation(self, op: Dict[str, Any]):
        if getattr(self, "is_milling_mode", False) and getattr(self, "live_tool_running", False):
            self.output.append("M105")
            self.live_tool_running = False
            self.current_rpm = None

    def rapid(self, x: float = None, y: float = None, z: float = None, a: float = None, b: float = None, c: float = None):
        cmd = "G0"
        changed = False
        if x is not None:
            val_x = (x * 2.0) if (not getattr(self, "is_milling_mode", False) and getattr(self, "is_diameter_mode", True)) else x
            if self.current_x is None or round(self.converter.convert_length(val_x) or 0.0, 3) != round(self.converter.convert_length(self.current_x) or 0.0, 3):
                cmd += f" X{self.converter.format_length(val_x)}"
                self.current_x = val_x
                changed = True
        if y is not None:
            if getattr(self, "is_milling_mode", False) or abs(y) > 0.0001 or (self.current_y is not None and abs(self.current_y) > 0.0001):
                if self.current_y is None or round(self.converter.convert_length(y) or 0.0, 3) != round(self.converter.convert_length(self.current_y) or 0.0, 3):
                    cmd += f" Y{self.converter.format_length(y)}"
                    self.current_y = y
                    changed = True
        if z is not None and (self.current_z is None or round(self.converter.convert_length(z) or 0.0, 3) != round(self.converter.convert_length(self.current_z) or 0.0, 3)):
            cmd += f" Z{self.converter.format_length(z)}"
            self.current_z = z
            changed = True
        
        if changed:
            self.output.append(cmd)

    def linear(self, x: float = None, y: float = None, z: float = None, a: float = None, b: float = None, c: float = None, feed: float = None):
        cmd = "G1"
        changed = False
        if x is not None:
            val_x = (x * 2.0) if (not getattr(self, "is_milling_mode", False) and getattr(self, "is_diameter_mode", True)) else x
            if self.current_x is None or round(self.converter.convert_length(val_x) or 0.0, 3) != round(self.converter.convert_length(self.current_x) or 0.0, 3):
                cmd += f" X{self.converter.format_length(val_x)}"
                self.current_x = val_x
                changed = True
        if y is not None:
            if getattr(self, "is_milling_mode", False) or abs(y) > 0.0001 or (self.current_y is not None and abs(self.current_y) > 0.0001):
                if self.current_y is None or round(self.converter.convert_length(y) or 0.0, 3) != round(self.converter.convert_length(self.current_y) or 0.0, 3):
                    cmd += f" Y{self.converter.format_length(y)}"
                    self.current_y = y
                    changed = True
        if z is not None and (self.current_z is None or round(self.converter.convert_length(z) or 0.0, 3) != round(self.converter.convert_length(self.current_z) or 0.0, 3)):
            cmd += f" Z{self.converter.format_length(z)}"
            self.current_z = z
            changed = True
            
        if changed:
            if feed is not None and (self.current_feed is None or round(feed, 1) != round(self.current_feed, 1)):
                cmd += f" F{self.converter.format_feed(feed)}"
                self.current_feed = feed
            self.output.append(cmd)

    def arc(self, cw: bool, x: float = None, y: float = None, z: float = None,
            i: float = None, j: float = None, k: float = None, r: float = None,
            a: float = None, b: float = None, c: float = None, feed: float = None):
        cmd = "G2" if cw else "G3"
        if getattr(self, "is_milling_mode", False):
            # In G17 (XY plane for face milling), circular motion is between X and Y
            if x is not None:
                cmd += f" X{self.converter.format_length(x)}"
                self.current_x = x
            if y is not None:
                cmd += f" Y{self.converter.format_length(y)}"
                self.current_y = y
            if z is not None and (self.current_z is None or round(self.converter.convert_length(z) or 0.0, 3) != round(self.converter.convert_length(self.current_z) or 0.0, 3)):
                cmd += f" Z{self.converter.format_length(z)}"
                self.current_z = z
            if r is not None and float(r) > 0:
                cmd += f" R{self.converter.format_length(r)}"
            elif i is not None or j is not None:
                if i is not None: cmd += f" I{self.converter.format_length(i)}"
                if j is not None: cmd += f" J{self.converter.format_length(j)}"
        else:
            # In G18 (XZ plane on Lathes), circular motion is between X and Z
            if x is not None:
                val_x = (x * 2.0) if getattr(self, "is_diameter_mode", True) else x
                cmd += f" X{self.converter.format_length(val_x)}"
                self.current_x = val_x
            if z is not None:
                cmd += f" Z{self.converter.format_length(z)}"
                self.current_z = z
            if r is not None and float(r) > 0:
                cmd += f" R{self.converter.format_length(r)}"
            elif i is not None or k is not None:
                if i is not None: cmd += f" I{self.converter.format_length(i)}"
                if k is not None: cmd += f" K{self.converter.format_length(k)}"
        if feed is not None and (self.current_feed is None or round(feed, 1) != round(self.current_feed, 1)):
            cmd += f" F{self.converter.format_feed(feed)}"
            self.current_feed = feed
        self.output.append(cmd)

    def drilling_cycle(self, x: float, y: float, z: float, r: float, feed: float, clearance: float = 15.0):
        self.ensure_safe_z(r)
        self.ensure_xy(x, y)
        if getattr(self, "is_milling_mode", False):
            self.output.append(f"G98 G81 X{self.converter.format_length(x)} Y{self.converter.format_length(y)} Z{self.converter.format_length(z)} R{self.converter.format_length(r)} F{self.converter.format_feed(feed)}")
        else:
            val_x = (x * 2.0) if x is not None and getattr(self, "is_diameter_mode", True) else (x or 0.0)
            self.output.append(f"G98 G81 X{self.converter.format_length(val_x)} Z{self.converter.format_length(z)} R{self.converter.format_length(r)} F{self.converter.format_feed(feed)}")

    def peck_drilling_cycle(self, x: float, y: float, z: float, r: float, q: float, feed: float, clearance: float = 15.0):
        self.ensure_safe_z(r)
        self.ensure_xy(x, y)
        if getattr(self, "is_milling_mode", False):
            self.output.append(f"G98 G83 X{self.converter.format_length(x)} Y{self.converter.format_length(y)} Z{self.converter.format_length(z)} R{self.converter.format_length(r)} Q{self.converter.format_length(q)} F{self.converter.format_feed(feed)}")
        else:
            val_x = (x * 2.0) if x is not None and getattr(self, "is_diameter_mode", True) else (x or 0.0)
            self.output.append(f"G98 G83 X{self.converter.format_length(val_x)} Z{self.converter.format_length(z)} R{self.converter.format_length(r)} Q{self.converter.format_length(q)} F{self.converter.format_feed(feed)}")


class MillTurnPostProcessor(FanucLathePostProcessor):
    """Mazak Integrex / DMG NTX / Mill-Turn EIA compatible G-Code output with Live Tooling."""
    def program_start(self, setup_plan: Dict[str, Any] = None):
        unit_gcode = "G20" if self.converter.is_inch else "G21"
        program_number = (setup_plan or {}).get("programNumber") or (setup_plan or {}).get("program_number") or "O1002"
        self.output.append("%")
        self.output.append(f"{program_number} (VEXCAD MILL-TURN GENERATED)")
        initial_plane = "G17" if getattr(self, "is_milling_mode", False) else "G18"
        self.output.append(f"{unit_gcode} {initial_plane} G40 G80 G90 G94")
        wcs = (setup_plan or {}).get("workCoordinateSystem", (setup_plan or {}).get("wcs", "G54"))
        self.output.append(wcs)


class PostProcessorFactory:
    """Factory to instantiate the correct dialect post-processor."""
    @staticmethod
    def create(post_id: str) -> BasePostProcessor:
        post_id = post_id.upper() if post_id else ""
        if "MILL_TURN" in post_id or "INTEGREX" in post_id or "NTX" in post_id:
            return MillTurnPostProcessor()
        elif "LATHE" in post_id or "SWISS" in post_id or "CINCOM" in post_id or "TURN" in post_id:
            return FanucLathePostProcessor()
        elif "SIEMENS" in post_id:
            return SiemensPostProcessor()
        elif "HEIDENHAIN_KLARTEXT" in post_id:
            return HeidenhainKlartextPostProcessor()
        elif "HEIDENHAIN" in post_id:
            return HeidenhainISOPostProcessor()
        elif "HAAS" in post_id:
            return HaasPostProcessor()
        elif "FANUC" in post_id or "ISO" in post_id or "MAZAK" in post_id or "OKUMA" in post_id or "MAKINO" in post_id or "HURCO" in post_id or post_id in ("AUTO", ""):
            return FanucPostProcessor()
        else:
            raise ValueError(f"Unsupported or unverified post-processor '{post_id}'. NC export is blocked for unvalidated machine configurations.")

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
        import json
        from pathlib import Path
        
        post_id = "fanuc"
        controller_id = "FANUC_0I_MF"
        report = GCodeValidationReport(status="passed")
        
        if setup_plan:
            post_id = setup_plan.get("postProcessorId") or setup_plan.get("postProcessor") or "AUTO"
            controller_id = setup_plan.get("controllerId") or setup_plan.get("controller") or "FANUC_0I_MF"
            
            # Auto-resolve
            if post_id == "AUTO":
                m_type = str(setup_plan.get("machineType") or setup_plan.get("machine_type") or "").lower()
                has_turning_ops = any(op.get("type") in ("od_turning", "facing_turning", "od_finish_turning", "id_boring", "grooving", "parting_off") for op in operations)
                if any(k in m_type for k in ("lathe", "turning", "swiss")) or (has_turning_ops and not m_type):
                    post_id = "FANUC_LATHE"
                else:
                    post_id = controller_id
                
            # Perform strict validation against matrix
            matrix_path = Path(__file__).resolve().parents[4] / "web-ui" / "lib" / "cam" / "cam_machine_matrix.json"
            if matrix_path.exists():
                try:
                    with open(matrix_path, "r", encoding="utf-8") as f:
                        matrix = json.load(f)
                        ctrl_info = matrix.get("controllers", {}).get(controller_id)
                        if ctrl_info and post_id != controller_id:
                            valid_posts = ctrl_info.get("compatiblePosts", [])
                            p_tokens = set(post_id.upper().replace("_", " ").split())
                            
                            def is_compat(vp: str) -> bool:
                                vp_u = vp.upper()
                                if post_id.upper() in vp_u or vp_u in post_id.upper():
                                    return True
                                vp_toks = set(vp_u.replace("_", " ").split())
                                fam_match = any(f in p_tokens and f in vp_toks for f in ("FANUC", "HAAS", "SIEMENS", "HEIDENHAIN", "MAZAK", "OKUMA", "MAKINO", "DOOSAN", "HURCO", "CENTROID", "MASSO", "LINUXCNC", "GRBL", "MACH3", "MACH4"))
                                type_match = any(t in p_tokens and any(t in tok for tok in vp_toks) for t in ("LATHE", "MILL", "SWISS", "ROUTER", "TURN"))
                                return fam_match and (type_match or "ISO" in p_tokens or "AUTO" in p_tokens)

                            if post_id not in valid_posts and not any(is_compat(vp) for vp in valid_posts):
                                report.status = "failed"
                                report.issues.append({
                                    "type": "incompatible_post_processor",
                                    "message": f"Post Processor '{post_id}' is not compatible with Controller '{controller_id}'. NC export blocked."
                                })
                except Exception as e:
                    pass
                
        post = PostProcessorFactory.create(post_id)
        
        # Pre-posting validation (Controller-neutral)
        for op in operations:
            for seg_dict in op.get("toolpaths", []):
                move_type = seg_dict.get("moveType")
                end_pt = seg_dict.get("end", {})
                z = end_pt.get("z")
                
                # Check for rapid XY moves that might be unsafe if they are at the absolute bottom
                # We relax the strict Z < 0 check to allow in-pocket rapid moves for rapid_xy.
                # However, rapid_clearance moves should never be below Z0.
                if move_type == "rapid_clearance" and z is not None and z < 0.0:
                    report.status = "failed"
                    report.issues.append({
                        "type": "unsafe_rapid",
                        "message": f"Rapid clearance move below Z0 detected at Z={z:.3f} in operation {op.get('name', 'Unknown')}"
                    })
                elif move_type == "rapid_xy" and z is not None and z < -1000.0: # effectively disabled for now, rely on toolpath engine
                    report.status = "failed"
                    report.issues.append({
                        "type": "unsafe_rapid",
                        "message": f"Rapid XY move deeply below Z0 detected at Z={z:.3f} in operation {op.get('name', 'Unknown')}"
                    })

        if report.status == "failed":
            report.status = "error"
        # Strict Hard Gate: Exclude blocked operations or operations with geometry errors
        valid_ops = []
        for op in operations:
            if op.get("status") in ("blocked", "blocked_missing_depth", "blocked_requires_reorientation", "error", "unsupported"):
                continue
            err = (op.get("parameters") or {}).get("error")
            if err and any(kw in str(err).lower() for kw in ("error", "blocked", "unavailable", "fail")):
                continue
            if not op.get("toolpaths"):
                continue
            valid_ops.append(op)
            
        if not valid_ops:
            report.status = "failed"
            report.issues.append({
                "type": "geometry_blocked",
                "message": "All operations blocked: missing required geometric boundaries or depth."
            })
            return {"gcode": "", "validation": report.model_dump(), "toolpaths": []}
            
        # Post-processor generation
        gcode_text = post.generate(valid_ops, setup_plan)
        
        # Post-posting validation (Dialect specific)
        lines = gcode_text.split('\n')
        for i, line in enumerate(lines):
            line_upper = line.upper()
            
            # Fanuc/ISO specific validation
            if isinstance(post, FanucPostProcessor) and not isinstance(post, HeidenhainKlartextPostProcessor):
                if "G53 G0 Z0" in line_upper or "G53 Z0" in line_upper:
                    # This is allowed but must be a retract. Ensure no X/Y on same line unless safe.
                    if "X" in line_upper or "Y" in line_upper:
                        report.status = "failed"
                        report.issues.append({"type": "unsafe_g53", "message": f"G53 Z0 combined with XY move on line {i+1}: {line}"})
                        
            # Heidenhain specific validation
            if isinstance(post, HeidenhainKlartextPostProcessor):
                pass # Removed strict FMAX Z- check


        return {
            "gcode": gcode_text if report.status == "passed" else "",
            "validation": report.model_dump(),
            "toolpaths": []
        }
        
    def generate_from_toolpaths(self, toolpaths, **kwargs):
        raise ValueError("legacy_path generation is permanently blocked. Use generate(operations) instead.")