#!/bin/sh
set -eu
# Refuse ephemeral storage in production.
grep -qs ' /data ' /proc/mounts || { echo 'Persistent /data volume is required'; exit 1; }
mkdir -p /data
chown node:node /data
chmod 700 /data
exec su-exec node node /app/server.mjs
