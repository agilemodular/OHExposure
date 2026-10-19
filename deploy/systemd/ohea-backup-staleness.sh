#!/bin/sh
# Run hourly from the monitoring agent: exits non-zero (alert) if the last backup failed or is older than 26 hours.
f=$(docker run --rm -v ohea_backups:/b alpine:3.20 cat /b/daily/last-backup.json 2>/dev/null) || { echo "no backup record"; exit 2; }
echo "$f" | grep -q '"ok": true' || { echo "last backup failed: $f"; exit 2; }
at=$(echo "$f" | sed -n 's/.*"at": "\([^"]*\)".*/\1/p'); age=$(( $(date +%s) - $(date -d "$at" +%s) ))
[ "$age" -le 93600 ] || { echo "last backup is $age s old"; exit 2; }
echo "ok: last backup $at"
