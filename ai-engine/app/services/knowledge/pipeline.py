import fitz
import uuid
import re
from typing import List, Dict, Any, Tuple
from app.services.knowledge.schemas import EngineeringRuleSchema, KnowledgeDocumentSchema
from app.services.knowledge.symbol_dictionary import SymbolDictionary
from app.services.knowledge.repository import KnowledgeRepository

class KnowledgeIngestionPipeline:
    def __init__(self, llm_gateway=None, repository=None):
        self.llm = llm_gateway
        self.repository = repository or KnowledgeRepository()
        
    async def process_pdf(self, file_path: str) -> Tuple[KnowledgeDocumentSchema, List[EngineeringRuleSchema]]:
        doc = fitz.open(file_path)
        
        # 1. Parsing & Chunking
        raw_chunks = self._parse_and_chunk(doc)
        
        # 2. Topic Detection & Extraction
        rules = []
        doc_schema = KnowledgeDocumentSchema(
            id=str(uuid.uuid4()),
            filename=file_path.replace("\\", "/").split("/")[-1],
            pageCount=len(doc),
            status="active"
        )
        
        for idx, chunk in enumerate(raw_chunks):
            extracted_rules = await self._extract_rules_from_chunk(chunk, doc_schema.id, idx)
            rules.extend(extracted_rules)
            
        # 3. Persist to database
        self.repository.save_document(doc_schema)
        if rules:
            self.repository.save_rules(rules)
            
        return doc_schema, rules

    def _parse_and_chunk(self, doc: fitz.Document) -> List[Dict[str, Any]]:
        chunks = []
        current_chunk = ""
        current_pages = []
        
        for page_num in range(len(doc)):
            page = doc.load_page(page_num)
            text = page.get_text("text").strip()
            
            # Simple heuristic to strip likely headers/footers
            lines = text.split('\n')
            if len(lines) > 2:
                if lines[0].isdigit() or "chapter" in lines[0].lower():
                    lines = lines[1:]
                if lines[-1].isdigit():
                    lines = lines[:-1]
            text = "\n".join(lines).strip()
            
            if not text:
                continue
                
            current_chunk += "\n" + text
            current_pages.append(page_num + 1)
            
            if len(current_chunk) > 1000:
                chunks.append({
                    "text": current_chunk.strip(),
                    "pages": current_pages.copy()
                })
                current_chunk = ""
                current_pages = []
                
        if current_chunk:
            chunks.append({
                "text": current_chunk.strip(),
                "pages": current_pages
            })
            
        return chunks
        
    async def _extract_rules_from_chunk(self, chunk: Dict[str, Any], doc_id: str, chunk_idx: int = 0) -> List[EngineeringRuleSchema]:
        rules: List[EngineeringRuleSchema] = []
        text = chunk.get("text", "")
        
        # 1. Extract standard symbols detected in chunk
        symbols = SymbolDictionary.extract_symbols(text)
        for s in symbols:
            rule_id = f"rule_{doc_id[:8]}_{s['symbol']}_{chunk_idx}_{len(rules)}"
            rules.append(
                EngineeringRuleSchema(
                    rule_id=rule_id,
                    source_id=doc_id,
                    topic=s.get("ontology_node", "General"),
                    concept=s.get("concept", "Symbol"),
                    description=s.get("description", ""),
                    confidence=0.95,
                    status="active"
                )
            )

        # 2. Extract technical engineering sentences (tolerances, threads, fits, dimensions)
        keywords = ["tolerance", "thread", "chamfer", "groove", "radius", "diameter", "hole", "surface", "undercut", "fit", "iso", "din"]
        for line in text.split("\n"):
            clean_line = line.strip()
            if 15 <= len(clean_line) <= 250 and any(kw in clean_line.lower() for kw in keywords):
                concept_match = next((kw.capitalize() for kw in keywords if kw in clean_line.lower()), "Manufacturing Standard")
                rule_id = f"rule_{doc_id[:8]}_{chunk_idx}_{len(rules)}"
                rules.append(
                    EngineeringRuleSchema(
                        rule_id=rule_id,
                        source_id=doc_id,
                        topic=concept_match,
                        concept=concept_match,
                        description=clean_line,
                        confidence=0.9,
                        status="active"
                    )
                )
                if len(rules) >= 50: # sensible limit per chunk
                    break

        return rules

