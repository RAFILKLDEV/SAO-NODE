#!/usr/bin/env sh
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
OUTPUT="${1:-sao-rpg-$(date +%Y%m%d-%H%M%S).dump}"
pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" > "$OUTPUT"
echo "$OUTPUT"
