"""Knowledge base and manufacturing standards endpoints."""
from __future__ import annotations

import tempfile
import traceback
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.api.v1.routers.common import (
    MAX_UPLOAD_SIZE,
    sanitize_safe_filename,
    validate_safe_id,
)

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


@router.get("/documents")
async def list_knowledge_documents():
    """List all ingested manufacturing standard documents."""
    try:
        from app.services.knowledge.repository import KnowledgeRepository
        repo = KnowledgeRepository()
        docs = repo.list_documents()
        return {"documents": [d.model_dump() for d in docs]}
    except Exception as exc:
        print(f"[Knowledge] List documents error: {exc}")
        return {"documents": []}


@router.post("/documents/ingest")
async def ingest_knowledge_document(file: UploadFile = File(...)):
    """Ingest a PDF standard or technical handbook into the neural RAG knowledge base."""
    try:
        from app.services.knowledge.pipeline import KnowledgeIngestionPipeline

        temp_dir = Path(tempfile.gettempdir()) / "vexcad_knowledge"
        temp_dir.mkdir(parents=True, exist_ok=True)
        safe_filename = sanitize_safe_filename(file.filename)
        temp_file = temp_dir / safe_filename

        content = await file.read()
        if len(content) > MAX_UPLOAD_SIZE:
            raise HTTPException(status_code=413, detail="File too large (max 50MB)")
        temp_file.write_bytes(content)

        pipeline = KnowledgeIngestionPipeline()
        doc_schema, rules = await pipeline.process_pdf(str(temp_file))

        temp_file.unlink(missing_ok=True)
        return {
            "success": True,
            "document": doc_schema.model_dump(),
            "rules_count": len(rules),
        }
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail={"error": {"message": f"Knowledge ingestion failed: {exc}"}},
        )


@router.post("/retrieve")
async def retrieve_knowledge(query: Dict[str, Any]):
    """Query engineering rules matching features, symbols, and standard requirements."""
    try:
        from app.services.knowledge.retriever import KnowledgeRetriever
        from app.services.knowledge.schemas import KnowledgeRetrievalQuery

        q = KnowledgeRetrievalQuery(
            query=query.get("query", ""),
            detected_symbols=query.get("detected_symbols", []),
            feature_candidates=query.get("feature_candidates", []),
            active_standards=query.get("active_standards", ["ISO", "DIN", "ASME"]),
        )
        retriever = KnowledgeRetriever()
        res = retriever.retrieve(q)
        return res.model_dump()
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": {"message": f"Knowledge retrieval failed: {exc}"}},
        )


@router.delete("/documents/{doc_id}")
async def delete_knowledge_document(doc_id: str):
    """Delete an ingested knowledge document by ID."""
    safe_doc_id = validate_safe_id(doc_id, "doc_id")
    try:
        from app.services.knowledge.repository import KnowledgeRepository
        repo = KnowledgeRepository()
        repo.delete_document(safe_doc_id)
        return {"success": True, "deleted": safe_doc_id}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": {"message": f"Failed to delete document: {exc}"}},
        )
