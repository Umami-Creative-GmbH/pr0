#!/bin/sh
# The migrate job of the hosted upgrade sequence (compose.coolify.yaml).
# Runs the single migration coordinator, then records this release as the one
# that last completed the schema. Backups read that record through
# PR0_BACKUP_RELEASE_FILE, so a backup taken before the next upgrade names the
# release that wrote its data. A failed migration records nothing.
set -eu

release="${PR0_BACKUP_RELEASE:?Set PR0_BACKUP_RELEASE to this deployment's release}"
record="${PR0_BACKUP_RELEASE_FILE:?Set PR0_BACKUP_RELEASE_FILE to the release record}"

bun --bun apps/web/.operations/accounts.js migrate

printf '%s\n' "$release" > "$record.tmp"
mv "$record.tmp" "$record"
printf '{"event":"release_recorded","release":"%s"}\n' "$release"
