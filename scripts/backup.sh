#!/usr/bin/env bash
# Database backup script for AIBYAI
# Usage: ./scripts/backup.sh [backup_dir]
#
# Environment variables:
#   DATABASE_URL    — PostgreSQL connection string (required)
#   BACKUP_DIR      — Override backup directory (default: ./backups)
#   BACKUP_RETAIN   — Number of backups to retain (default: 7)
#   BACKUP_COMPRESS — Compress with gzip (default: true)

set -euo pipefail

BACKUP_DIR="${1:-${BACKUP_DIR:-./backups}}"
BACKUP_RETAIN="${BACKUP_RETAIN:-7}"
BACKUP_COMPRESS="${BACKUP_COMPRESS:-true}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/aibyai_${TIMESTAMP}.sql"

# Ensure backup directory exists
mkdir -p "${BACKUP_DIR}"

# Parse DATABASE_URL if set, otherwise fall back to docker-compose defaults
if [ -z "${DATABASE_URL:-}" ]; then
  # Try to read from .env
  if [ -f .env ]; then
    DATABASE_URL=$(grep '^DATABASE_URL=' .env | cut -d'=' -f2-)
  fi
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "ERROR: DATABASE_URL not set. Export it or add to .env"
    exit 1
  fi
fi

echo "[$(date -Iseconds)] Starting database backup..."
echo "  Target: ${BACKUP_FILE}"

# Run pg_dump
if [ "${BACKUP_COMPRESS}" = "true" ]; then
  BACKUP_FILE="${BACKUP_FILE}.gz"
  pg_dump "${DATABASE_URL}" --no-owner --no-acl --clean --if-exists | gzip > "${BACKUP_FILE}"
else
  pg_dump "${DATABASE_URL}" --no-owner --no-acl --clean --if-exists > "${BACKUP_FILE}"
fi

FILE_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
echo "[$(date -Iseconds)] Backup complete: ${BACKUP_FILE} (${FILE_SIZE})"

# Prune old backups (keep the most recent N)
PRUNED=0
if [ "${BACKUP_RETAIN}" -gt 0 ]; then
  # List backup files sorted oldest first, skip the newest BACKUP_RETAIN
  for old_file in $(ls -1t "${BACKUP_DIR}"/aibyai_*.sql* 2>/dev/null | tail -n +$((BACKUP_RETAIN + 1))); do
    rm -f "${old_file}"
    PRUNED=$((PRUNED + 1))
  done
fi

if [ "${PRUNED}" -gt 0 ]; then
  echo "[$(date -Iseconds)] Pruned ${PRUNED} old backup(s), retaining last ${BACKUP_RETAIN}"
fi

echo "[$(date -Iseconds)] Done."
