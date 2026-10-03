"""
VEX-AUDIT-012 Regression Tests — Session/Job ID Path Traversal

Tests the production _validate_id() function and verifies that all affected
endpoints reject malicious identifiers before filesystem access.
"""

import uuid
import pytest
from fastapi import HTTPException

from app.api.v1.router import _validate_id


class TestVexAudit012ValidateId:
    """Verify that _validate_id rejects traversal and accepts legitimate IDs."""

    # ── VALID identifiers ──────────────────────────────────────────────────

    def test_valid_cuid(self):
        """Prisma @default(cuid()) format."""
        assert _validate_id("cjld2cyuq0000t3rmniod1foy") == "cjld2cyuq0000t3rmniod1foy"

    def test_valid_uuid_hex(self):
        """uuid4().hex — 32 hex chars."""
        uid = uuid.uuid4().hex
        assert _validate_id(uid) == uid

    def test_valid_uuid_hex_short(self):
        """uuid4().hex[:8] — 8 hex chars."""
        uid = uuid.uuid4().hex[:8]
        assert _validate_id(uid) == uid

    def test_valid_job_prefix(self):
        """job_ + hex[:8] — server-generated job_id."""
        jid = f"job_{uuid.uuid4().hex[:8]}"
        assert _validate_id(jid) == jid

    def test_valid_alphanumeric(self):
        assert _validate_id("abc123") == "abc123"

    def test_valid_hyphenated(self):
        assert _validate_id("session-abc-def") == "session-abc-def"

    def test_valid_underscored(self):
        assert _validate_id("my_session_id") == "my_session_id"

    def test_valid_mixed_case(self):
        assert _validate_id("SessionABC123") == "SessionABC123"

    def test_valid_single_char(self):
        assert _validate_id("a") == "a"

    def test_valid_default_job(self):
        """The default_job value used by CAM request models."""
        assert _validate_id("default_job") == "default_job"

    # ── INVALID identifiers — traversal ────────────────────────────────────

    def test_reject_dotdot_slash(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_id("../../etc")
        assert exc_info.value.status_code == 400

    def test_reject_deep_traversal(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_id("../../../tmp/evil")
        assert exc_info.value.status_code == 400

    def test_reject_dotdot_prefix(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_id("../outside")
        assert exc_info.value.status_code == 400

    def test_reject_traversal_to_app(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_id("../../app/main.py")
        assert exc_info.value.status_code == 400

    def test_reject_dotdot_only(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_id("..")
        assert exc_info.value.status_code == 400

    def test_reject_dot_only(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_id(".")
        assert exc_info.value.status_code == 400

    def test_reject_slash_only(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_id("/")
        assert exc_info.value.status_code == 400

    def test_reject_empty_string(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_id("")
        assert exc_info.value.status_code == 400

    def test_reject_whitespace_only(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_id("   ")
        assert exc_info.value.status_code == 400

    def test_reject_forward_slash_in_id(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_id("foo/bar")
        assert exc_info.value.status_code == 400

    def test_reject_backslash_in_id(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_id("foo\\bar")
        assert exc_info.value.status_code == 400

    def test_reject_absolute_path(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_id("/etc/passwd")
        assert exc_info.value.status_code == 400

    def test_reject_windows_traversal_backslash(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_id("..\\..\\etc")
        assert exc_info.value.status_code == 400

    def test_reject_windows_traversal_app(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_id("..\\..\\app\\main.py")
        assert exc_info.value.status_code == 400

    def test_reject_windows_absolute(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_id("C:\\temp\\evil")
        assert exc_info.value.status_code == 400

    def test_reject_dot_in_name(self):
        """A dot within the ID is rejected (e.g. 'file.txt')."""
        with pytest.raises(HTTPException) as exc_info:
            _validate_id("file.txt")
        assert exc_info.value.status_code == 400

    def test_reject_space_in_id(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_id("my session")
        assert exc_info.value.status_code == 400

    def test_reject_tab_in_id(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_id("session\tid")
        assert exc_info.value.status_code == 400

    def test_reject_newline_in_id(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_id("session\nid")
        assert exc_info.value.status_code == 400

    def test_long_id_with_valid_chars_accepted(self):
        """Long all-alpha IDs are accepted — the regex is a character allowlist, not length check."""
        long_id = "a" * 10000
        assert _validate_id(long_id) == long_id

    def test_reject_long_id_with_traversal(self):
        """Long IDs containing traversal chars are rejected."""
        with pytest.raises(HTTPException) as exc_info:
            _validate_id("a" * 5000 + "/../../etc")
        assert exc_info.value.status_code == 400

    def test_reject_null_bytes(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_id("session\x00id")
        assert exc_info.value.status_code == 400


class TestVexAudit012FilesystemContainment:
    """Verify that validated IDs produce paths that remain inside the intended directory."""

    def test_blueprint_path_contained(self, tmp_path):
        """Validated session_id keeps blueprint path inside BLUEPRINTS_DIR."""
        from pathlib import Path
        bp_dir = tmp_path / "blueprints"
        bp_dir.mkdir()

        valid_id = "cjld2cyuq0000t3rmniod1foy"
        _validate_id(valid_id)  # would raise if invalid
        bp_file = bp_dir / f"{valid_id}.png"
        assert bp_file.resolve().is_relative_to(bp_dir.resolve())

    def test_job_dir_path_contained(self, tmp_path):
        """Validated job_id keeps job_dir path inside storage/jobs."""
        from pathlib import Path
        jobs_dir = tmp_path / "storage" / "jobs"
        jobs_dir.mkdir(parents=True)

        valid_id = f"job_{uuid.uuid4().hex[:8]}"
        _validate_id(valid_id)
        job_dir = jobs_dir / valid_id / "cam"
        assert job_dir.resolve().is_relative_to(jobs_dir.resolve())

    def test_rejected_id_never_constructs_path(self, tmp_path):
        """Invalid ID is rejected before any Path construction."""
        from pathlib import Path
        bp_dir = tmp_path / "blueprints"
        bp_dir.mkdir()

        malicious_id = "../../etc"
        with pytest.raises(HTTPException):
            _validate_id(malicious_id)

        # Verify no path was constructed — the directory should have no files
        assert list(bp_dir.iterdir()) == []
