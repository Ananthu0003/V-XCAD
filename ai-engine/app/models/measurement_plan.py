from typing import List, Dict, Any, Optional
from pydantic import BaseModel
from enum import Enum

class MeasurementMethod(str, Enum):
    DIAMETER = "DIAMETER"
    RADIUS = "RADIUS"
    LENGTH = "LENGTH"
    DISTANCE = "DISTANCE"
    ANGLE = "ANGLE"
    POSITION = "POSITION"
    CONCENTRICITY = "CONCENTRICITY"
    COAXIALITY = "COAXIALITY"
    WALL_THICKNESS = "WALL_THICKNESS"

class MeasurementTask(BaseModel):
    task_id: str
    feature_id: str
    geometry_identifier: Dict[str, Any] # Signature to find the geometry in the B-Rep
    method: MeasurementMethod
    expected_nominal: float
    lower_limit: float
    upper_limit: float
    source_characteristic_id: str

class MeasurementPlan(BaseModel):
    """
    Defines exactly what must be measured on the generated STEP file,
    derived deterministically from the EngineeringFeatureGraph and Constraints.
    """
    version: int = 1
    tasks: List[MeasurementTask]
