#!/bin/sh

# Import literal KEY=VALUE entries without evaluating shell syntax. Existing
# environment values always win over the file.
load_dotenv_file() {
  dotenv_file="$1"
  [ -f "$dotenv_file" ] || return 0

  while IFS= read -r dotenv_line || [ -n "$dotenv_line" ]; do
    dotenv_line="${dotenv_line%"$(printf '\r')"}"
    case "$dotenv_line" in
      ''|'#'*) continue ;;
    esac
    dotenv_key=${dotenv_line%%=*}
    dotenv_value=${dotenv_line#*=}
    case "$dotenv_key" in
      ''|*[!A-Za-z0-9_]*) continue ;;
    esac
    case "$dotenv_key" in
      [0-9]*) continue ;;
    esac
    printenv "$dotenv_key" >/dev/null 2>&1 && continue
    case "$dotenv_value" in
      \"*\") dotenv_value=${dotenv_value#\"}; dotenv_value=${dotenv_value%\"} ;;
      \'*\') dotenv_value=${dotenv_value#\'}; dotenv_value=${dotenv_value%\'} ;;
    esac
    export "$dotenv_key=$dotenv_value"
  done < "$dotenv_file"
  unset dotenv_file dotenv_line dotenv_key dotenv_value
}
