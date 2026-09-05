# Heardzz.
#
# The app shells out to yt-dlp and ffmpeg to cut clips, so both have to exist
# in the image — a plain Node base will build fine and then fail the moment a
# record is confirmed.
#
# Pulling a clip apart into stems needs a third tool, and that one is a
# gigabyte. It is NOT in the image: `scripts/separate.mjs` builds it into
# /data on first use, where it survives deploys the way the clips do. What
# the image does carry is python3-venv, ~7 MB, without which that build
# cannot start — `python3 -m venv` on this base fails on a missing ensurepip,
# and it fails at the moment somebody splits a record rather than at build.
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
# Git does not carry empty directories, so a clone may arrive without public/.
# Nothing static lives there today, but the copy below must not depend on that.
RUN mkdir -p public && npm run build

FROM node:24-slim AS runtime
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates curl \
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

COPY docker/entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/entrypoint

VOLUME ["/data"]
EXPOSE 3000

ENTRYPOINT ["entrypoint"]
CMD ["npm", "run", "start"]
