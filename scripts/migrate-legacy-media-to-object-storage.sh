#!/usr/bin/env bash
# One-shot import of host-local legacy media folders into SeaweedFS (S3 API).
# Replaces the former migrate-legacy-media-to-minio.sh helper.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
DATA_DIR="$ROOT_DIR/data"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename "$ROOT_DIR")}"
NETWORK_NAME="${PROJECT_NAME}_frontend"
AWS_CLI_IMAGE="${AWS_CLI_IMAGE:-amazon/aws-cli:2.27.50@sha256:48c3d4212e2f5b0e24bdc6af7708f9412ce65425a79575e0f78b8f8c0dcd70ab}"

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

ACCESS_KEY="$(read_env OBJECT_STORAGE_ACCESS_KEY_ID 2>/dev/null || true)"
if [[ -z "${ACCESS_KEY}" ]]; then
  ACCESS_KEY="$(read_env THUMBNAIL_S3_ACCESS_KEY_ID)"
fi
ENDPOINT="$(read_env THUMBNAIL_S3_ENDPOINT)"
RECORDINGS_BUCKET="$(read_env LIVEKIT_RECORDINGS_S3_BUCKET)"
THUMBNAILS_BUCKET="$(read_env THUMBNAIL_S3_BUCKET)"
SECRET_FILE="${ROOT_DIR}/docker/secrets/object_storage_secret_access_key"
if [[ ! -r "$SECRET_FILE" ]]; then
  die "Missing readable secret file: $SECRET_FILE"
fi

docker run --rm \
  --network "$NETWORK_NAME" \
  --entrypoint /bin/sh \
  -e AWS_ACCESS_KEY_ID="$ACCESS_KEY" \
  -e AWS_DEFAULT_REGION=us-east-1 \
  -e ENDPOINT="$ENDPOINT" \
  -e RECORDINGS_BUCKET="$RECORDINGS_BUCKET" \
  -e THUMBNAILS_BUCKET="$THUMBNAILS_BUCKET" \
  -v "$SECRET_FILE:/run/secrets/object_storage_secret_access_key:ro" \
  -v "$DATA_DIR:/migration:ro" \
  "$AWS_CLI_IMAGE" \
  -eu -c '
    export AWS_SECRET_ACCESS_KEY="$(cat /run/secrets/object_storage_secret_access_key)"
    endpoint="${ENDPOINT:-http://seaweedfs:8333}"

    if [ -d /migration/livekit-recordings ]; then
      for file in /migration/livekit-recordings/*.mp4; do
        [ -e "$file" ] || continue
        aws --endpoint-url "$endpoint" s3 cp "$file" "s3://$RECORDINGS_BUCKET/$(basename "$file")"
      done
    fi

    if [ -d /migration/robot-thumbnails ]; then
      for file in /migration/robot-thumbnails/*; do
        [ -f "$file" ] || continue
        base=$(basename "$file")
        robot_id=${base%.*}
        extension=${base##*.}
        aws --endpoint-url "$endpoint" s3 cp "$file" "s3://$THUMBNAILS_BUCKET/robot-thumbnails/${robot_id}/legacy.${extension}"
      done
    fi

    echo "recording_objects=$(aws --endpoint-url "$endpoint" s3 ls "s3://$RECORDINGS_BUCKET" 2>/dev/null | wc -l)"
    thumbnail_objects=$(aws --endpoint-url "$endpoint" s3 ls "s3://$THUMBNAILS_BUCKET/robot-thumbnails/" --recursive 2>/dev/null | wc -l || true)
    echo "thumbnail_objects=${thumbnail_objects:-0}"
  '
