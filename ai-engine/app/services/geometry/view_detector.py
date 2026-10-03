from typing import List, Dict, Any

class ViewDetector:
    def detect_views(self, blueprint_image_path: str) -> List[Dict[str, Any]]:
        """
        Uses deterministic CV to find orthographic view bounding boxes.
        Returns a list of views (e.g. Front, Top, Side) with their pixel coordinates.
        """
        raise NotImplementedError("View detection not yet implemented.")
