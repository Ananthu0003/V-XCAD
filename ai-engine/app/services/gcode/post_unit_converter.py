from typing import Optional

class PostUnitConverter:
    """
    A typed converter that handles unit conversions at the post-processing boundary.
    The canonical internal CAM unit is strictly millimeters (mm).
    Converts ONLY length or linear feed semantic values, preserving RPM, angles, etc.
    """
    def __init__(self, post_output_units: str = "mm"):
        self.post_output_units = post_output_units.lower()
        self.is_inch = self.post_output_units == "in"

    def convert_length(self, val: Optional[float]) -> Optional[float]:
        """Converts a length parameter (X, Y, Z, R, Clearance) to the target unit."""
        if val is None:
            return None
        if self.is_inch:
            return val / 25.4
        return val

    def convert_feed(self, val: Optional[float]) -> Optional[float]:
        """Converts a linear feed rate to the target unit."""
        if val is None:
            return None
        if self.is_inch:
            return val / 25.4
        return val

    # Helper formatters to guarantee consistent decimal places based on unit
    def format_length(self, val: Optional[float]) -> str:
        if val is None:
            return ""
        converted = self.convert_length(val)
        if abs(converted) < 0.0005:
            converted = 0.0
        if self.is_inch:
            return f"{converted:.4f}"
        return f"{converted:.3f}"
        
    def format_feed(self, val: Optional[float]) -> str:
        if val is None:
            return ""
        converted = self.convert_feed(val)
        if self.is_inch:
            return f"{converted:.3f}"
        return f"{converted:.1f}"
