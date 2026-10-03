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
        rule_ids_seen = set()
        
        # 1. Extract symbols dynamically from the query text + detected_symbols
        symbols_to_check = set(query.detected_symbols or [])
        if query.query:
            for s in SymbolDictionary.extract_symbols(query.query):
                symbols_to_check.add(s["symbol"])
                
        # 2. Deterministic Symbol Lookup
        for symbol in symbols_to_check:
            symbol_info = SymbolDictionary.lookup(symbol)
            if symbol_info:
                node_name = symbol_info.get("ontology_node")
                if node_name:
                    node = self.ontology.get_node(node_name)
                    if node and node not in matched_nodes:
                        matched_nodes.append(node)
                
                rule_id = f"symbol_{symbol}"
                if rule_id not in rule_ids_seen:
                    rule_ids_seen.add(rule_id)
                    matched_rules.append(
                        EngineeringRuleSchema(
                            rule_id=rule_id,
                            source_id="symbol_dictionary",
                            concept=symbol_info.get("concept"),
                            topic=symbol_info.get("ontology_node"),
                            description=symbol_info.get("description"),
                            confidence=1.0,
                            status="active"
                        )
                    )
                
        # 3. Database Search: Match rules from uploaded engineering standard documents
        if query.query and query.query.strip():
            db_rules = self.repository.search_rules(query.query, limit=10)
            for r in db_rules:
                if r.rule_id not in rule_ids_seen:
                    rule_ids_seen.add(r.rule_id)
                    matched_rules.append(r)

        # 4. Ontology Matching
        features_to_check = set(query.feature_candidates or [])
        if query.query:
            for term in ["hole", "thread", "chamfer", "groove", "tolerance", "undercut", "bore", "shaft"]:
                if term in query.query.lower():
                    features_to_check.add(term.capitalize())

        for feature in features_to_check:
            node = self.ontology.get_node(feature)
            if node and node not in matched_nodes:
                matched_nodes.append(node)
            
        return KnowledgeRetrievalResponse(
            rules=matched_rules,
            ontology_nodes=matched_nodes,
            retrieval_confidence=1.0 if matched_rules else 0.5
        )

