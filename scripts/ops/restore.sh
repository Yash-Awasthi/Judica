#!/usr/bin/env bash
# Database restore script for AIBYAI
# Usage: ./scripts/restore.sh <backup_file>
#
# Environment variables:
#   DATABASE_URL — PostgreSQL connection string (required)

set -euo pipefail

BACKUP_FILE="${1:-}"

if [ -z "${BACKUP_FILE}" ]; then
  echo "Usage: ./scripts/restore.sh <backup_file>"
  echo ""
  echo "Available backups:"
  ls -1t backups/aibyai_*.sql* 2>/dev/null || echo "  (none found in ./backups/)"
  exit 1
fi

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "ERROR: Backup file not found: ${BACKUP_FILE}"
  exit 1
fi

# Parse DATABASE_URL
if [ -z "${DATABASE_URL:-}" ]; then
  if [ -f .env ]; then
    DATABASE_URL=$(grep '^DATABASE_URL=' .env | cut -d'=' -f2-)
  fi
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "ERROR: DATABASE_URL not set. Export it or add to .env"
    exit 1
  fi
fi

echo "WARNING: This will overwrite the current database with the backup."
echo "  Backup:   ${BACKUP_FILE}"
echo "  Database:  ${DATABASE_URL%%@*}@***"
echo ""
read -p "Are you sure? (yes/no): " CONFIRM

if [ "${CONFIRM}" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

echo "[$(date -Iseconds)] Starting database restore..."

if [[ "${BACKUP_FILE}" == *.gz ]]; then
  gunzip -c "${BACKUP_FILE}" | psql "${DATABASE_URL}" --single-transaction
else
  psql "${DATABASE_URL}" --single-transaction < "${BACKUP_FILE}"
fi

echo "[$(date -Iseconds)] Restore complete."
