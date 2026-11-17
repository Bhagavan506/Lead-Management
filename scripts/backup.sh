#!/usr/bin/env bash
# Logical backup of the Leadbook database: a compressed pg_dump file, then old files pruned.
#   DATABASE_URL=postgresql://... BACKUP_DIR=/backups KEEP_DAYS=14 scripts/backup.sh
# Exit status is non-zero on any failure so a scheduler can alert. Copy the files OFF the database host.
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
umask 077
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
tmp="$BACKUP_DIR/.leadbook-$stamp.dump.partial"
out="$BACKUP_DIR/leadbook-$stamp.dump"
trap 'rm -f "$tmp"' ERR
pg_dump --format=custom --no-owner --no-privileges --file="$tmp" "$DATABASE_URL"
# A dump that cannot be listed is not a backup.
pg_restore --list "$tmp" >/dev/null
mv "$tmp" "$out"
find "$BACKUP_DIR" -name 'leadbook-*.dump' -type f -mtime "+$KEEP_DAYS" -delete
echo "backup written: $out ($(wc -c <"$out") bytes)"
