from app.models.graphs import ViewCorrespondenceGraph
from typing import List, Dict, Any

class ProjectionReasoner:
    def build_correspondence_graph(self, views: List[Dict[str, Any]]) -> ViewCorrespondenceGraph:
        """
        Aligns the bounding boxes mathematically and creates links between matching features
        across orthogonal views (e.g. circle in Top, hidden lines in Front).
        """
        raise NotImplementedError("Deterministic projection reasoning not yet implemented.")
