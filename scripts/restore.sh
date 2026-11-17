#!/usr/bin/env bash
# Restore a backup into an EMPTY database (a new one, or a dropped-and-recreated one).
#   DATABASE_URL=postgresql://.../leadbook_restored scripts/restore.sh backups/leadbook-XXXX.dump
# Refuses a database that already has tables so a live database is never overwritten by accident.
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL}"
file="${1:?usage: restore.sh <backup.dump>}"
[ -f "$file" ] || { echo "no such file: $file" >&2; exit 1; }
tables="$(psql "$DATABASE_URL" -Atc "select count(*) from information_schema.tables where table_schema='public'")"
if [ "$tables" != "0" ]; then
  echo "refusing: the target database already has $tables tables. Restore into an empty database." >&2
  exit 1
fi
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$DATABASE_URL" "$file"
echo "restored $file"
