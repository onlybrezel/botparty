#!/bin/sh

set -eu

upstream_dir=/tmp/nginx-upstreams
mkdir -p "$upstream_dir"

if [ ! -s "$upstream_dir/api.conf" ]; then
  printf '%s\n' 'server api:4000 resolve;' > "$upstream_dir/api.conf"
fi
if [ ! -s "$upstream_dir/web.conf" ]; then
  printf '%s\n' 'server web:3000 resolve;' > "$upstream_dir/web.conf"
fi

exec nginx -g 'daemon off;'
