#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "backup-db.sh has been consolidated into the release backup format." >&2
exec "${SCRIPT_DIR}/backup-release.sh" "$@"
