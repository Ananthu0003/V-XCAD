import pytest
from unittest.mock import AsyncMock, MagicMock

@pytest.fixture
def mock_db_session():
    """Provides a mocked database session."""
    session = AsyncMock()
    yield session

@pytest.fixture
def mock_external_api():
    """Provides a mocked external API client."""
    api_client = AsyncMock()
    yield api_client
