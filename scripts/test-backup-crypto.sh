#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_IMAGE="node@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

printf 'backup payload %s\n' "$(date -u +%s)" > "${WORK}/plain"
printf 'correct-backup-key-with-at-least-32-characters' > "${WORK}/key"
printf 'wrong-backup-key-with-at-least-32-characters--' > "${WORK}/wrong-key"
chmod 600 "${WORK}/key" "${WORK}/wrong-key"

run_crypto() {
  docker run --rm --user "$(id -u):$(id -g)" \
    --security-opt no-new-privileges:true --cap-drop ALL --network none \
    -v "${ROOT_DIR}/scripts:/scripts:ro" -v "${WORK}:/data" \
    "${NODE_IMAGE}" node /scripts/backup-crypto.mjs "$@"
}

run_crypto encrypt /data/plain /data/encrypted /data/key
run_crypto decrypt /data/encrypted /data/restored /data/key
cmp "${WORK}/plain" "${WORK}/restored"

if run_crypto decrypt /data/encrypted /data/wrong-output /data/wrong-key >/dev/null 2>&1; then
  echo 'Decryption unexpectedly accepted the wrong key.' >&2
  exit 1
fi

cp "${WORK}/encrypted" "${WORK}/damaged"
printf 'x' | dd of="${WORK}/damaged" bs=1 seek=60 conv=notrunc status=none
if run_crypto decrypt /data/damaged /data/damaged-output /data/key >/dev/null 2>&1; then
  echo 'Decryption unexpectedly accepted a damaged archive.' >&2
  exit 1
fi

echo 'Backup encryption integrity tests passed.'
