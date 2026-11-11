#!/bin/sh
# The hosted backup, run by a Coolify scheduled task every 30 minutes in the
# "backup" container (compose.coolify.yaml), and once by hand after a deploy.
# Creates and verifies one encrypted backup, then reports its real exit code
# to the dead-man's switch check (POST <check-url>/<exit-code>). The task exits
# with the backup's own code, so Coolify's execution log shows the failure too.
set -u

bun --bun /app/apps/web/.operations/backup.js create
code=$?
bun /app/hosted/heartbeat.ts "$code" || echo "scheduled-backup: heartbeat not delivered" >&2
exit "$code"
