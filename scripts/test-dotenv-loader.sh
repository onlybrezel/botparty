#!/bin/sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/load-dotenv.sh
. "${SCRIPT_DIR}/load-dotenv.sh"

fixture="$(mktemp)"
marker="${fixture}.executed"
trap 'rm -f "$fixture" "$marker"' EXIT

{
  printf '%s\n' 'PLAIN_VALUE=loaded'
  printf '%s\n' 'SPACED_VALUE=BotParty audit environment'
  printf 'LITERAL_COMMAND=$%s%s%s%s\n' '(' 'touch ' "$marker" ')'
  printf '%s\n' 'EXISTING_VALUE=file-value'
} > "$fixture"

EXISTING_VALUE=environment-value
export EXISTING_VALUE
load_dotenv_file "$fixture"

[ "$PLAIN_VALUE" = loaded ]
[ "$SPACED_VALUE" = 'BotParty audit environment' ]
[ "$EXISTING_VALUE" = environment-value ]
[ "$LITERAL_COMMAND" = "\$(touch $marker)" ]
[ ! -e "$marker" ]

echo 'Literal dotenv loader test passed.'
