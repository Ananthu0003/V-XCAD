#!/bin/sh
set -e

# ─────────────────────────────────────────────────────────────────────────────
# VexCAD AI Engine — Entrypoint
# Runs as root initially to fix named Docker volume ownership, then drops
# privileges to caduser for the actual application process.
# ─────────────────────────────────────────────────────────────────────────────

mkdir -p /app/outputs
chown -R caduser:caduser /app/outputs 2>/dev/null || true
chmod 777 /app/outputs 2>/dev/null || true

# Drop privileges and execute the main command as caduser.
# runuser(1) is part of util-linux and available in all Debian-based images.
exec runuser -u caduser -- "$@"
