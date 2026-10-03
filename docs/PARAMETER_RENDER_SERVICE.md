# Parameter Render Service - Technical Documentation

## Overview

The `ParameterRenderService` class executes build123d scripts in an isolated environment and exports 3D models to STEP and STL formats.

## Architecture

```
Script + Parameters
      ↓
Subprocess with build123d
      ↓
Result Shape
      ↓
Export STEP + STL
```

## Key Features

| Feature | Description |
|---------|-------------|
| **Process Isolation** | Each render runs in a separate subprocess |
| **Environment Injection** | Parameters via environment variables |
| **Robustness Wrappers** | Monkey-patching for AI hallucinations |
| **Error Parsing** | Detailed error messages from subprocess |

## Class Reference

### ParameterRenderService

#### `__init__(outputs_dir: Optional[Path] = None)`

Initialize the Parameter Render Service.

**Parameters:**
- `outputs_dir`: Directory for output files. Defaults to `<project_root>/outputs`

#### `render_to_outputs(parameters: Dict[str, Any], script: str, output_basename: str) -> Dict[str, str]`

Execute a build123d script and export 3D models.

**Parameters:**
- `parameters`: Dictionary of parameters for the script
- `script`: Python build123d script to execute
- `output_basename`: Base name for output files

**Returns:**
```python
{
    "stl_path": "/path/to/output.stl",
    "step_path": "/path/to/output.step"
}
```

**Raises:**
- `RuntimeError`: If rendering fails with details about the error

#### `_parse_worker_error(log: str) -> str`

Parse error messages from subprocess output.

**Parameters:**
- `log`: Combined stdout/stderr from subprocess

**Returns:**
- Human-readable error message

**Error Types:**
1. Python traceback - extracts last exception
2. RENDER_ERROR - geometry rendering errors
3. EXPORT_ERROR - file export errors

#### `clear_outputs() -> None`

Remove all previous output files from the outputs directory.

#### `_log_fail(script: str, params: dict, log: str) -> None`

Log failed render attempts for debugging.

## Harness Template

The `RENDER_HARNESS_TEMPLATE` is a Python script that:

1. **Loads Parameters** - From `CAD_PARAMETERS_JSON` environment variable
2. **Pre-loads Symbols** - All build123d classes/functions
3. **Adds AI Fallbacks** - For common AI hallucinations:
   - `Vector.position` returns self
   - `BuildLine @ 0` returns wire()
   - Case-insensitive function names
4. **Wraps Operations** - Robust error handling for fillet, chamfer, extrude
5. **Cleans Script** - Regex fixes for common issues
6. **Exports** - STEP and STL to configured output directory

## Error Handling

### Error Categories

| Category | Subcategory | User Feedback |
|----------|-------------|---------------|
| Execution | Python Syntax | Line number + message |
| Execution | NameError | Show variable name |
| Execution | Topology | Specific failure reason |
| Render | Timeout | "Geometry too complex" |
| Render | Empty Shape | "No exportable shape found" |
| Export | Invalid Type | Format: "got <type>, expected <expected>" |

### Error Messages

- **Script Error**: `Script error: <line content>`
- **Geometry Error**: `Geometry error: <message>`
- **Export Error**: `Export error: <message>`
- **Fallback**: `Geometry engine failed. Review script logic and parameter values.`

## Utility Functions

### `extract_parameters_from_script(script: str) -> Dict[str, Any]`

Extract PARAMETERS dictionary from a build123d script.

**Parameters:**
- `script`: The build123d script content

**Returns:**
- Dictionary of extracted parameters, or empty dict if not found

### `validate_script_syntax(script: str) -> tuple[bool, Optional[str]]`

Validate Python syntax without executing.

**Returns:**
- Tuple of (is_valid, error_message)

### `get_build123d_version() -> str`

Get the installed build123d version.

## Usage Example

```python
from app.services.parameter_render import ParameterRenderService, extract_parameters_from_script

# Initialize service
service = ParameterRenderService()

# Parameters from script
parameters = {
    "diameter": 10.0,
    "height": 20.0,
    "fillet_radius": 1.0
}

# Build123d script
script = """
from build123d import *

PARAMETERS = {
    "diameter": 10.0,
    "height": 20.0,
    "fillet_radius": 1.0
}

def build_model(params: dict) -> Part:
    with BuildPart() as p:
        Cylinder(params["diameter"]/2, params["height"])
        try:
            fillet(p.edges(), radius=params["fillet_radius"])
        except:
            pass
    return p.part
"""

# Render
paths = service.render_to_outputs(
    parameters=parameters,
    script=script,
    output_basename="my_part"
)

print(f"STL: {paths['stl_path']}")
print(f"STEP: {paths['step_path']}")
```

## Output Files

Files are written to the configured `outputs_dir`:

```
outputs/
├── <output_basename>.step
└── <output_basename>.stl
```

## Diagnostics

Failed renders are logged to `logs/render_v3_fail_<uuid>.json`:

```json
{
    "script": "from build123d import *...",
    "parameters": {"diameter": 10.0, "height": 20.0},
    "log": "---TRACEBACK_START---\n..."
}
```

## Robustness Wrappers

### Monkey-Patched Functions

| Original | Wrapper Behavior |
|----------|------------------|
| `fillet()` | Returns None on empty selection, topology errors |
| `chamfer()` | Returns None on empty selection, type mismatches |
| `extrude()` | Returns None on empty/invalid geometry |
| `Vector.position` | Returns self (property) |
| `BuildLine.__matmul__` | Returns wire() |
| `BuildLine.__mod__` | Returns wire() % val |

### Regex Fixes Applied

1. `Polygon(..., close=True/False)` → `Polygon(...)`
2. `extrude(...)` outside BuildPart → placeholder for correction
3. Case-insensitive function names (Extrude, Revolve)
