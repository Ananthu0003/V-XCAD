import re
import logging
from typing import Dict, Any, List

logger = logging.getLogger(__name__)

class PostOutputValidator:
    """
    Validates the final generated G-Code text before sending to the client.
    Ensures post-processor bugs don't generate dangerous code.
    """
    
    @staticmethod
    def validate_gcode(gcode: str, operations: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Returns {"valid": bool, "reason": str}
        """
        if not gcode or not gcode.strip():
            return {"valid": False, "reason": "Generated G-Code is empty."}
            
        lines = gcode.split('\n')
        current_z = None
        
        has_tool_change = False
        has_spindle_start = False
        has_tool_offset = False
        coolant_started = False
        coolant_stopped = False
        spindle_stopped = False
        program_ended = False
        
        
        # Check for legacy fallback artifacts
        if "legacy_path" in gcode.lower():
            return {"valid": False, "reason": "Generated G-Code contains blocked legacy_path artifact."}
            
        for line in lines:
            line = line.strip().upper()
            
            # Strip comments
            if '(' in line:
                line = line[:line.find('(')].strip()
                
            if not line:
                continue
                
            if 'M06' in line or 'M6' in line or 'TOOL CALL' in line or 'T=' in line:
                has_tool_change = True
            if 'M03' in line or 'M3' in line or ('TOOL CALL' in line and 'S' in line):
                has_spindle_start = True
            if 'G43' in line or 'D1' in line or ('TOOL CALL' in line and 'Z' in line):
                has_tool_offset = True
                z_match = re.search(r'Z([-\d\.]+)', line)
                if z_match:
                    current_z = float(z_match.group(1))

            if 'M08' in line or 'M8' in line:
                coolant_started = True
            if 'M09' in line or 'M9' in line or 'M30' in line or 'M02' in line or 'M2' in line or 'END PGM' in line:
                coolant_stopped = True
            if 'M05' in line or 'M5' in line or 'M30' in line or 'M02' in line or 'M2' in line or 'END PGM' in line:
                spindle_stopped = True
            if 'M30' in line or 'M02' in line or 'M2' in line or 'END PGM' in line:
                program_ended = True
                
            # Safety check: cutting moves before setup
            if any(cmd in line for cmd in ['G01', 'G1 ', 'G02', 'G2 ', 'G03', 'G3 ', 'G81', 'G83']):
                if not has_tool_change:
                    return {"valid": False, "reason": "Cutting motion found before tool change (M06)."}
                if not has_spindle_start:
                    return {"valid": False, "reason": "Cutting motion found before spindle start (M03)."}
                if not has_tool_offset:
                    return {"valid": False, "reason": "Cutting motion found before tool length offset (G43)."}
                    
                z_match = re.search(r'Z([-\d\.]+)', line)
                if z_match:
                    current_z = float(z_match.group(1))

            # Determine true minimum safe retract height from operations or toolpath segments
            retracts = []
            if operations:
                for op in operations:
                    if not isinstance(op, dict):
                        continue
                    sh = op.get('safe_heights') or op.get('parameters', {}).get('safe_heights')
                    if isinstance(sh, dict):
                        if 'retract' in sh and sh['retract'] is not None:
                            retracts.append(float(sh['retract']))
                        if 'clearance' in sh and sh['clearance'] is not None:
                            retracts.append(float(sh['clearance']))
                    params = op.get('parameters', {})
                    if 'retract_z' in params and params['retract_z'] is not None:
                        retracts.append(float(params['retract_z']))
                    if 'clearance_z' in params and params['clearance_z'] is not None:
                        retracts.append(float(params['clearance_z']))
                    # Inspect actual toolpath segments if present
                    for seg in op.get('toolpaths', []):
                        if isinstance(seg, dict) and seg.get('moveType') in ('retract_clearance', 'rapid_clearance'):
                            end_z = seg.get('end', {}).get('z')
                            if end_z is not None:
                                retracts.append(float(end_z))

            min_retract = min(retracts) if retracts else 0.0

            # Safe Z check for G0 moves (cannot rapid into solid workpiece or fixtures)
            if 'G00' in line or 'G0 ' in line or line.endswith('G0'):
                z_match = re.search(r'Z([-\d\.]+)', line)
                if z_match:
                    z_val = float(z_match.group(1))
                    current_z = z_val

                    if 'G53' in line:
                        if z_val < -500.0:
                            return {"valid": False, "reason": f"Unsafe machine-coordinate rapid move: Z below machine limit on line: {line}"}
                    else:
                        if z_val < (min_retract - 0.05):
                            return {"valid": False, "reason": f"Unsafe G0 rapid plunge below safe retract plane ({z_val} < {min_retract}) at line: {line}"}

                # XY Check
                x_match = re.search(r'X([-\d\.]+)', line)
                y_match = re.search(r'Y([-\d\.]+)', line)
                if (x_match or y_match) and 'G53' not in line:
                    if current_z is None:
                        return {"valid": False, "reason": f"Unsafe rapid XY move before a known safe Z height is established: {line}"}
                    if current_z < (min_retract - 0.05):
                        return {"valid": False, "reason": f"Unsafe rapid XY move while Z ({current_z}) is below safe retract plane ({min_retract}): {line}"}
                    
        # Check trailers
        if not spindle_stopped:
            return {"valid": False, "reason": "Program does not contain spindle stop (M05)."}
        if coolant_started and not coolant_stopped:
            return {"valid": False, "reason": "Coolant was started but never stopped (M09)."}
        if not program_ended:
            return {"valid": False, "reason": "Program does not end with M30."}
            
        return {"valid": True, "reason": None}
