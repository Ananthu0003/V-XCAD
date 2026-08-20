import os
import psycopg2
from psycopg2.extras import Json
from typing import List, Dict, Any, Optional
from app.services.knowledge.schemas import EngineeringRuleSchema, KnowledgeDocumentSchema, OntologyNodeSchema

class KnowledgeRepository:
    def __init__(self, database_url: str = None):
        self.db_url = database_url or os.environ.get("DATABASE_URL", "postgresql://cad_user:cad_pass@127.0.0.1:5433/cad_db")
        
    def _get_connection(self):
        return psycopg2.connect(self.db_url)
        
    def save_document(self, doc: KnowledgeDocumentSchema):
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO "KnowledgeDocument" (id, filename, version, "pageCount", status, "updatedAt")
                    VALUES (%s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (id) DO UPDATE SET 
                        status = EXCLUDED.status, 
                        "updatedAt" = NOW()
                    """,
                    (doc.id, doc.filename, doc.version, doc.pageCount, doc.status)
                )
            conn.commit()
            
    def save_rules(self, rules: List[EngineeringRuleSchema]):
        if not rules:
            return
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                for rule in rules:
                    cur.execute(
                        """
                        INSERT INTO "EngineeringRule" (id, rule_id, version, source_id, topic, confidence, status, description, "updatedAt")
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
                        ON CONFLICT (rule_id) DO UPDATE SET
                            description = EXCLUDED.description,
                            "updatedAt" = NOW()
                        """,
                        (rule.rule_id, rule.rule_id, rule.version, rule.source_id, rule.topic, rule.confidence, rule.status, rule.description)
                    )
            conn.commit()

    def get_document(self, doc_id: str) -> Optional[KnowledgeDocumentSchema]:
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute('SELECT id, filename, version, "pageCount", status FROM "KnowledgeDocument" WHERE id = %s', (doc_id,))
                row = cur.fetchone()
                if row:
                    return KnowledgeDocumentSchema(id=row[0], filename=row[1], version=row[2], pageCount=row[3], status=row[4])
        return None
        
    def list_documents(self) -> List[KnowledgeDocumentSchema]:
        docs = []
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute('SELECT id, filename, version, "pageCount", status FROM "KnowledgeDocument" ORDER BY "createdAt" DESC')
                for row in cur.fetchall():
                    docs.append(KnowledgeDocumentSchema(id=row[0], filename=row[1], version=row[2], pageCount=row[3], status=row[4]))
        return docs

    def delete_document(self, doc_id: str) -> bool:
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute('DELETE FROM "EngineeringRule" WHERE source_id = %s', (doc_id,))
                cur.execute('DELETE FROM "KnowledgeDocument" WHERE id = %s', (doc_id,))
            conn.commit()
        return True

    def search_rules(self, query_text: str, limit: int = 15) -> List[EngineeringRuleSchema]:
        rules = []
        if not query_text or not query_text.strip():
            return rules
            
        words = [w.strip() for w in query_text.split() if len(w.strip()) > 2]
        if not words:
            return rules

        with self._get_connection() as conn:
            with conn.cursor() as cur:
                conditions = []
                params = []
                for w in words:
                    conditions.append('("description" ILIKE %s OR "topic" ILIKE %s)')
                    params.extend([f"%{w}%", f"%{w}%"])
                
                sql = f'''
                    SELECT rule_id, version, source_id, topic, confidence, status, description 
                    FROM "EngineeringRule" 
                    WHERE {" OR ".join(conditions)}
                    ORDER BY confidence DESC
                    LIMIT %s
                '''
                params.append(limit)
                cur.execute(sql, tuple(params))
                for row in cur.fetchall():
                    rules.append(EngineeringRuleSchema(
                        rule_id=row[0], version=row[1], source_id=row[2], topic=row[3], 
                        confidence=row[4], status=row[5], description=row[6]
                    ))
        return rules

    def get_rules_by_topic(self, topic: str) -> List[EngineeringRuleSchema]:
        rules = []
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute('SELECT rule_id, version, source_id, topic, confidence, status, description FROM "EngineeringRule" WHERE topic = %s', (topic,))
                for row in cur.fetchall():
                    rules.append(EngineeringRuleSchema(
                        rule_id=row[0], version=row[1], source_id=row[2], topic=row[3], 
                        confidence=row[4], status=row[5], description=row[6]
                    ))
        return rules
