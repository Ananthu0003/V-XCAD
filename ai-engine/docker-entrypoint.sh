#!/bin/sh
set -e

# ─────────────────────────────────────────────────────────────────────────────
# VexCAD AI Engine — Entrypoint
# Runs as root initially to fix named Docker volume ownership, then drops
# privileges to caduser for the actual application process.
# ─────────────────────────────────────────────────────────────────────────────

# Fix ownership of the outputs volume for the non-root user.
# The named Docker volume may be root-owned from a previous container run.
# -R is safe here: if files are already owned by caduser it is a no-op.
chown -R caduser:caduser /app/outputs 2>/dev/null || true

# Drop privileges and execute the main command as caduser.
# runuser(1) is part of util-linux and available in all Debian-based images.
exec runuser -u caduser -- "$@"
