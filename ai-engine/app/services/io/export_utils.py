import tempfile
import pathlib
from build123d import export_step

def build123d_to_step_bytes(shape) -> bytes:
    temp_path = None
    try:
        # Create temp file, close it immediately so export_step can open and write to it
        with tempfile.NamedTemporaryFile(suffix=".step", delete=False) as tf:
            temp_path = pathlib.Path(tf.name)
            
        # Use build123d native exporter
        export_step(shape, str(temp_path))
        
        # Read raw bytes
        with open(temp_path, 'rb') as f:
            return f.read()
    finally:
        # Ensure temp file is always deleted
        if temp_path and temp_path.exists():
            temp_path.unlink(missing_ok=True)
