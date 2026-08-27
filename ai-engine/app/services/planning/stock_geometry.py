from abc import ABC, abstractmethod
from typing import Dict, Any, Tuple
from app.constants import CYLINDRICAL_STOCK_TYPES

class StockGeometry(ABC):
    """
    Abstract interface for stock geometries. 
    Allows the facing planner to operate on the stock's machining envelope 
    without knowing its underlying shape (box, cylinder, etc).
    """
    @abstractmethod
    def get_machining_envelope(self) -> Dict[str, Any]:
        """
        Returns a generic machining envelope containing:
        - min_x, max_x
        - min_y, max_y
        - min_z, max_z
        - center
        - area (optional footprint area)
        """
        pass

class BoxStockGeometry(StockGeometry):
    def __init__(self, setup_resolved_stock: Dict[str, Any]):
        self.stock = setup_resolved_stock

    def get_machining_envelope(self) -> Dict[str, Any]:
        bounds = self.stock.get("bounds", {"min": (0,0,0), "max": (0,0,0)})
        return {
            "min_x": bounds["min"][0],
            "max_x": bounds["max"][0],
            "min_y": bounds["min"][1],
            "max_y": bounds["max"][1],
            "min_z": bounds["min"][2],
            "max_z": bounds["max"][2],
            "center": self.stock.get("center", (0,0,0)),
            "area": (bounds["max"][0] - bounds["min"][0]) * (bounds["max"][1] - bounds["min"][1])
        }

class CylinderStockGeometry(StockGeometry):
    def __init__(self, setup_resolved_stock: Dict[str, Any]):
        self.stock = setup_resolved_stock

    def get_machining_envelope(self) -> Dict[str, Any]:
        bounds = self.stock.get("bounds", {"min": (0,0,0), "max": (0,0,0)})
        # Even for a cylinder, the facing planner operates on its bounding envelope
        import math
        diameter = bounds["max"][0] - bounds["min"][0]
        area = math.pi * ((diameter / 2) ** 2)
        return {
            "min_x": bounds["min"][0],
            "max_x": bounds["max"][0],
            "min_y": bounds["min"][1],
            "max_y": bounds["max"][1],
            "min_z": bounds["min"][2],
            "max_z": bounds["max"][2],
            "center": self.stock.get("center", (0,0,0)),
            "area": area
        }

def create_stock_geometry(setup_resolved_stock: Dict[str, Any]) -> StockGeometry:
    """Factory to instantiate the appropriate StockGeometry based on the CAM setup."""
    if not setup_resolved_stock:
        return BoxStockGeometry({"bounds": {"min": (0,0,0), "max": (0,0,0)}})
        
    stock_type = str(setup_resolved_stock.get("stockType", "box")).lower()
    if stock_type in CYLINDRICAL_STOCK_TYPES:
        return CylinderStockGeometry(setup_resolved_stock)
        
    return BoxStockGeometry(setup_resolved_stock)
