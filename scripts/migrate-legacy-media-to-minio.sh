#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
DATA_DIR="$ROOT_DIR/data"
RECORDINGS_DIR="$DATA_DIR/livekit-recordings"
THUMBNAILS_DIR="$DATA_DIR/robot-thumbnails"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename "$ROOT_DIR")}"
NETWORK_NAME="${PROJECT_NAME}_frontend"

die() {
  echo "Error: $*" >&2
  exit 1
}

read_env() {
  local key="$1"
  local value
  value="$(grep "^${key}=" "$ENV_FILE" | head -n 1 | cut -d= -f2-)"
  if [[ -z "$value" ]]; then
    die "Missing ${key} in $ENV_FILE"
  fi
  printf '%s' "$value"
}

if [[ ! -f "$ENV_FILE" ]]; then
  die "Missing $ENV_FILE"
fi

if [[ ! -d "$DATA_DIR" ]]; then
  die "Missing $DATA_DIR"
fi

MINIO_ROOT_USER="$(read_env MINIO_ROOT_USER)"
MINIO_ROOT_PASSWORD="$(read_env MINIO_ROOT_PASSWORD)"
RECORDINGS_BUCKET="$(read_env LIVEKIT_RECORDINGS_S3_BUCKET)"
THUMBNAILS_BUCKET="$(read_env THUMBNAIL_S3_BUCKET)"

docker run --rm \
  --network "$NETWORK_NAME" \
  --entrypoint /bin/sh \
  -e MINIO_ROOT_USER="$MINIO_ROOT_USER" \
  -e MINIO_ROOT_PASSWORD="$MINIO_ROOT_PASSWORD" \
  -e RECORDINGS_BUCKET="$RECORDINGS_BUCKET" \
  -e THUMBNAILS_BUCKET="$THUMBNAILS_BUCKET" \
  -v "$DATA_DIR:/migration:ro" \
  minio/mc:latest \
  -eu -c '
    mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"

    if [ -d /migration/livekit-recordings ]; then
      for file in /migration/livekit-recordings/*.mp4; do
        [ -e "$file" ] || continue
        mc cp "$file" "local/$RECORDINGS_BUCKET/$(basename "$file")"
      done
    fi

    if [ -d /migration/robot-thumbnails ]; then
      for file in /migration/robot-thumbnails/*; do
        [ -f "$file" ] || continue
        base=$(basename "$file")
        robot_id=${base%.*}
        extension=${base##*.}
        mc cp "$file" "local/$THUMBNAILS_BUCKET/robot-thumbnails/${robot_id}/legacy.${extension}"
      done
    fi

    echo "recording_objects=$(mc ls local/$RECORDINGS_BUCKET | wc -l)"
    thumbnail_objects=$(mc ls --recursive "local/$THUMBNAILS_BUCKET/robot-thumbnails" 2>/dev/null | wc -l || true)
    echo "thumbnail_objects=$thumbnail_objects"
  '