#!/usr/bin/env bash
# Deprecated alias: MinIO was replaced by SeaweedFS.
echo "migrate-legacy-media-to-minio.sh is deprecated; forwarding to migrate-legacy-media-to-object-storage.sh" >&2
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/migrate-legacy-media-to-object-storage.sh" "$@"
