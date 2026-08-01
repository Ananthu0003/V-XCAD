import fitz
import uuid
import json
from typing import List, Dict, Any, Tuple
from app.services.knowledge.schemas import EngineeringRuleSchema, KnowledgeDocumentSchema

class KnowledgeIngestionPipeline:
    def __init__(self, llm_gateway=None):
        self.llm = llm_gateway
        
    async def process_pdf(self, file_path: str) -> Tuple[KnowledgeDocumentSchema, List[EngineeringRuleSchema]]:
        doc = fitz.open(file_path)
        
        # 1. Parsing & Chunking
        raw_chunks = self._parse_and_chunk(doc)
        
        # 2. Topic Detection & Extraction (via LLM normalization)
        rules = []
        doc_schema = KnowledgeDocumentSchema(
            id=str(uuid.uuid4()),
            filename=file_path.split("/")[-1],
            pageCount=len(doc)
        )
        
        for chunk in raw_chunks:
            extracted_rules = await self._extract_rules_from_chunk(chunk, doc_schema.id)
            rules.extend(extracted_rules)
            
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
        
    async def _extract_rules_from_chunk(self, chunk: Dict[str, Any], doc_id: str) -> List[EngineeringRuleSchema]:
        if not self.llm:
            # Fallback mock for testing without LLM
            return []
            
        # Here we would call the LLM to normalize text into EngineeringRuleSchema
        # Using a structured extraction approach.
        return []
