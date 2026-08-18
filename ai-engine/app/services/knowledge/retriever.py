from typing import List, Dict, Any
from app.services.knowledge.schemas import KnowledgeRetrievalQuery, KnowledgeRetrievalResponse, EngineeringRuleSchema
from app.services.knowledge.symbol_dictionary import SymbolDictionary
from app.services.knowledge.ontology import EngineeringOntology
from app.services.knowledge.repository import KnowledgeRepository

class KnowledgeRetriever:
    def __init__(self, repository: KnowledgeRepository = None):
        self.repository = repository or KnowledgeRepository()
        self.ontology = EngineeringOntology()
        
    def retrieve(self, query: KnowledgeRetrievalQuery) -> KnowledgeRetrievalResponse:
        matched_rules = []
        matched_nodes = []
        
        # 1. Deterministic Symbol Lookup
        for symbol in query.detected_symbols:
            symbol_info = SymbolDictionary.lookup(symbol)
            if symbol_info:
                # Direct ontology mapping
                node_name = symbol_info.get("ontology_node")
                if node_name:
                    node = self.ontology.get_node(node_name)
                    if node and node not in matched_nodes:
                        matched_nodes.append(node)
                
                # We can also construct a deterministic rule directly from the symbol dictionary
                rule = EngineeringRuleSchema(
                    rule_id=f"symbol_{symbol}",
                    source_id="dictionary",
                    concept=symbol_info.get("concept"),
                    description=symbol_info.get("description"),
                    confidence=1.0,
                    status="active"
                )
                matched_rules.append(rule)
                
        # 2. Ontology / Keyword Matching
        for feature in query.feature_candidates:
            node = self.ontology.get_node(feature)
            if node and node not in matched_nodes:
                matched_nodes.append(node)
                
        # 3. Vector / Semantic Fallback (Mocked here since we'd query pgvector)
        # If no strict symbols or ontology nodes match, we'd query the DB for embeddings
        if not matched_rules and query.query:
            pass # TODO: Semantic search via pgvector
            
        return KnowledgeRetrievalResponse(
            rules=matched_rules,
            ontology_nodes=matched_nodes,
            retrieval_confidence=1.0 if matched_rules else 0.5
        )
