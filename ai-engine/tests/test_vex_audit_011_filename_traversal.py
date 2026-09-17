"""
VEX-AUDIT-011 Regression Tests — Upload Filename Traversal

Tests that the filename sanitization logic prevents directory traversal
in the legacy upload and knowledge ingest endpoints.

These tests validate the sanitization logic directly without requiring
the full FastAPI stack or build123d dependencies.
"""

import os
from pathlib import Path


def sanitize_upload_filename(filename: str | None, dest_dir: Path) -> tuple[Path, str | None]:
    """
    Replicate the sanitization logic from router.py for testing.
    Returns (resolved_path, error_or_none).
    """
    safe_name = os.path.basename(filename) if filename else ""
    if not safe_name:
        safe_name = "upload"
    candidate = (dest_dir / safe_name).resolve()
    if not candidate.is_relative_to(dest_dir.resolve()):
        return dest_dir, "Invalid filename"
    return candidate, None


class TestVexAudit011FilenameSanitization:
    """Verify that upload filename sanitization prevents traversal."""

    def test_normal_filename_passes(self, tmp_path):
        result, err = sanitize_upload_filename("drawing.pdf", tmp_path)
        assert err is None
        assert result == tmp_path / "drawing.pdf"

    def test_traversal_relative_stripped_safe(self, tmp_path):
        """basename strips '../', leaving only the final component."""
        result, err = sanitize_upload_filename("../evil.pdf", tmp_path)
        assert err is None
        assert result == tmp_path / "evil.pdf"

    def test_traversal_deep_stripped_safe(self, tmp_path):
        result, err = sanitize_upload_filename("../../app/main.py", tmp_path)
        assert err is None
        assert result == tmp_path / "main.py"

    def test_absolute_path_stripped_safe(self, tmp_path):
        """basename strips leading '/', leaving only the final component."""
        result, err = sanitize_upload_filename("/etc/passwd", tmp_path)
        assert err is None
        assert result == tmp_path / "passwd"

    def test_absolute_traversal_stripped_safe(self, tmp_path):
        result, err = sanitize_upload_filename("../../tmp/evil", tmp_path)
        assert err is None
        assert result == tmp_path / "evil"

    def test_nested_component_stripped(self, tmp_path):
        """foo/bar.pdf → basename is bar.pdf."""
        result, err = sanitize_upload_filename("foo/bar.pdf", tmp_path)
        assert err is None
        assert result == tmp_path / "bar.pdf"

    def test_empty_filename_uses_fallback(self, tmp_path):
        result, err = sanitize_upload_filename(None, tmp_path)
        assert err is None
        assert result == tmp_path / "upload"

    def test_empty_string_uses_fallback(self, tmp_path):
        result, err = sanitize_upload_filename("", tmp_path)
        assert err is None
        assert result == tmp_path / "upload"

    def test_slash_only_uses_fallback(self, tmp_path):
        """os.path.basename('/') returns '', so fallback is used."""
        result, err = sanitize_upload_filename("/", tmp_path)
        assert err is None
        assert result == tmp_path / "upload"

    def test_dot_only(self, tmp_path):
        result, err = sanitize_upload_filename(".", tmp_path)
        assert err is None
        assert result == tmp_path / "."

    def test_filename_with_spaces(self, tmp_path):
        result, err = sanitize_upload_filename("my drawing (1).pdf", tmp_path)
        assert err is None
        assert result == tmp_path / "my drawing (1).pdf"

    def test_filename_with_unicode(self, tmp_path):
        result, err = sanitize_upload_filename("图纸_v2.pdf", tmp_path)
        assert err is None
        assert result == tmp_path / "图纸_v2.pdf"

    def test_windows_backslash_literal(self, tmp_path):
        """On Unix, backslash is not a path separator, so it's treated as literal."""
        result, err = sanitize_upload_filename("foo\\bar.pdf", tmp_path)
        assert err is None
        assert result == tmp_path / "foo\\bar.pdf"

    def test_containment_defense_in_depth(self, tmp_path):
        """
        The is_relative_to() check is defense-in-depth.
        Even if basename were bypassed somehow, the containment check catches it.
        """
        result, err = sanitize_upload_filename("../../../etc/shadow", tmp_path)
        assert err is None
        assert result == tmp_path / "shadow"

    def test_multiple_traversal_components_stripped(self, tmp_path):
        result, err = sanitize_upload_filename("../../../../tmp/evil", tmp_path)
        assert err is None
        assert result == tmp_path / "evil"

    def test_dotdot_only_rejected_by_containment(self, tmp_path):
        """os.path.basename('..') returns '..', but resolve() escapes dest_dir."""
        result, err = sanitize_upload_filename("..", tmp_path)
        assert err == "Invalid filename"
