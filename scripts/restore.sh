#!/usr/bin/env sh
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
INPUT="${1:?Usage: restore.sh <backup.dump>}"
pg_restore --clean --if-exists --no-owner --no-acl --dbname="$DATABASE_URL" "$INPUT"
