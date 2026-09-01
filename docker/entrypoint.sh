#!/bin/sh
set -e

# The data directory is a volume, so it may be empty on first boot and it may
# be a bind mount, in which case nothing the image put there at build time
# survives. Create it here, every time.
DATA="${HEARDZZ_DATA_DIR:-/data}"
mkdir -p "$DATA/audio"

# Ship the library definition, not the audio. A fresh volume gets the records;
# the clips are cut later, from the library screen or npm run fetch-missing.
if [ ! -f "$DATA/solos.json" ] && [ -f /app/seed-library/solos.json ]; then
  cp /app/seed-library/solos.json "$DATA/solos.json"
  echo "heardzz: seeded $DATA/solos.json — the clips still need fetching"
fi

if [ "$NODE_ENV" = "production" ] && [ -z "$ADMIN_PASSWORD" ]; then
  echo "heardzz: ADMIN_PASSWORD is not set, so the library screen stays closed." >&2
fi

exec "$@"
