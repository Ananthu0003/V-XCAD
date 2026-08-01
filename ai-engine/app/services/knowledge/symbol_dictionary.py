from typing import Dict, Any, Optional, List

# Deterministic Engineering Symbol Dictionary
# Translates standard symbols to Ontology parameters without LLM reasoning.

SYMBOL_DICTIONARY: Dict[str, Dict[str, Any]] = {
    "Ø": {
        "concept": "Diameter",
        "description": "Indicates a diameter of a cylindrical feature.",
        "ontology_node": "Diameter",
        "applies_to": ["Hole", "Boss", "Shaft", "Cylinder"]
    },
    "R": {
        "concept": "Radius",
        "description": "Indicates a radius of an arc or circular feature.",
        "ontology_node": "Radius",
        "applies_to": ["Fillet", "Arc", "Rounding"]
    },
    "SR": {
        "concept": "Spherical Radius",
        "description": "Radius of a spherical feature.",
        "ontology_node": "Spherical Radius",
        "applies_to": ["Dome", "Spherical Cutout"]
    },
    "SØ": {
        "concept": "Spherical Diameter",
        "description": "Diameter of a spherical feature.",
        "ontology_node": "Spherical Diameter",
        "applies_to": ["Sphere", "Ball"]
    },
    "M": {
        "concept": "Metric Thread",
        "description": "Indicates an ISO metric thread.",
        "ontology_node": "Thread",
        "applies_to": ["Hole", "Shaft"]
    },
    "Ra": {
        "concept": "Surface Roughness",
        "description": "Average surface roughness value (usually in micrometers).",
        "ontology_node": "Surface Finish",
        "applies_to": ["Feature", "Face"]
    },
    "±": {
        "concept": "Bilateral Tolerance",
        "description": "Symmetrical tolerance about the nominal dimension.",
        "ontology_node": "Tolerance",
        "applies_to": ["Dimension"]
    },
    "⌴": {
        "concept": "Counterbore",
        "description": "Flat-bottomed cylindrical enlargement.",
        "ontology_node": "Counterbore",
        "applies_to": ["Hole"]
    },
    "⌵": {
        "concept": "Countersink",
        "description": "Conical enlargement.",
        "ontology_node": "Countersink",
        "applies_to": ["Hole"]
    },
    "↧": {
        "concept": "Depth",
        "description": "Indicates the depth of a feature.",
        "ontology_node": "Depth",
        "applies_to": ["Hole", "Pocket", "Counterbore"]
    }
}

class SymbolDictionary:
    @classmethod
    def lookup(cls, symbol: str) -> Optional[Dict[str, Any]]:
        # Handle exact match
        if symbol in SYMBOL_DICTIONARY:
            return SYMBOL_DICTIONARY[symbol]
        
        # Handle partial match in string
        for key in SYMBOL_DICTIONARY:
            if key in symbol:
                return SYMBOL_DICTIONARY[key]
        return None
        
    @classmethod
    def extract_symbols(cls, text: str) -> List[Dict[str, Any]]:
        found = []
        for key, value in SYMBOL_DICTIONARY.items():
            if key in text:
                found.append({"symbol": key, **value})
        return found
