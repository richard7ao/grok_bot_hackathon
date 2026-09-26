#!/bin/sh
# SQLite and uploads live on the container disk: they reset on each deploy,
# and the backend re-seeds the 8 drops on start. Fine for a demo.
set -e
(cd backend && PORT=3000 DB_PATH=/tmp/dropquest.db UPLOADS_DIR=/tmp/uploads bun server.ts) &
sleep 1
cd web && PORT="${PORT:-8080}" API_URL=http://127.0.0.1:3000 exec bun dev.ts
