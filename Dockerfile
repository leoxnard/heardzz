# Heardzz.
#
# The app shells out to yt-dlp and ffmpeg to cut clips, so both have to exist
# in the image — a plain Node base will build fine and then fail the moment a
# record is confirmed.
#
# Everything written at runtime lives under /data: the library file, the
# pending suggestions and the clips. Mount a volume there, or a deploy will
# take the library with it.

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-slim AS runtime
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates curl \
 && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
 && chmod +x /usr/local/bin/yt-dlp \
 && apt-get purge -y curl \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HEARDZZ_DATA_DIR=/data
ENV PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/scripts ./scripts
# The library definition ships with the image; the audio it names does not.
# `npm run fetch-missing` rebuilds the clips into the volume.
COPY --from=build /app/data/solos.json /app/seed-library/solos.json

RUN mkdir -p /data/audio \
 && printf '%s\n' '#!/bin/sh' 'set -e' \
      '[ -f /data/solos.json ] || cp /app/seed-library/solos.json /data/solos.json' \
      'exec "$@"' > /usr/local/bin/entrypoint \
 && chmod +x /usr/local/bin/entrypoint

VOLUME ["/data"]
EXPOSE 3000

ENTRYPOINT ["entrypoint"]
CMD ["npm", "run", "start"]
