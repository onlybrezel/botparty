#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "restore-db.sh now performs an isolated, non-destructive restore drill." >&2
exec "${SCRIPT_DIR}/restore-drill.sh" "$@"
