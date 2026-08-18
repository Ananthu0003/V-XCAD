import pytest
from app.services.knowledge.ontology import EngineeringOntology
from app.services.knowledge.symbol_dictionary import SymbolDictionary

def test_symbol_lookup():
    result = SymbolDictionary.lookup("Ø10")
    assert result is not None
    assert result["concept"] == "Diameter"
    assert result["ontology_node"] == "Diameter"

def test_extract_symbols():
    text = "Machine M10 thread with Ra 3.2 finish."
    symbols = SymbolDictionary.extract_symbols(text)
    assert len(symbols) == 2
    assert any(s["symbol"] == "M" for s in symbols)
    assert any(s["symbol"] == "Ra" for s in symbols)

def test_ontology():
    ontology = EngineeringOntology()
    hole = ontology.get_node("Hole")
    assert hole is not None
    assert hole.parent_id == "Feature"
    
    children = ontology.get_children("Hole")
    names = [c.name for c in children]
    assert "Diameter" in names
    assert "Thread" in names
