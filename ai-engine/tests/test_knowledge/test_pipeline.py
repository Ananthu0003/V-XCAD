import pytest
from app.services.knowledge.pipeline import KnowledgeIngestionPipeline

def test_parse_and_chunk():
    # Mock PyMuPDF Document
    class MockPage:
        def __init__(self, text):
            self.text = text
        def get_text(self, *args, **kwargs):
            return self.text
            
    class MockDoc:
        def __init__(self, pages):
            self.pages = [MockPage(p) for p in pages]
        def __len__(self):
            return len(self.pages)
        def load_page(self, num):
            return self.pages[num]

    # Create dummy text that spans multiple pages and needs chunking
    text_page1 = "Chapter 1\n" + "A" * 1100 + "\n1"
    text_page2 = "2\n" + "B" * 500 + "\n2"
    
    doc = MockDoc([text_page1, text_page2])
    
    pipeline = KnowledgeIngestionPipeline()
    chunks = pipeline._parse_and_chunk(doc)
    
    assert len(chunks) == 2
    assert "A" * 1100 in chunks[0]["text"]
    assert "B" * 500 in chunks[1]["text"]
    assert "Chapter 1" not in chunks[0]["text"] # Header stripped
    assert chunks[0]["pages"] == [1]
    assert chunks[1]["pages"] == [2]
