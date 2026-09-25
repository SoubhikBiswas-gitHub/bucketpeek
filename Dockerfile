# syntax=docker/dockerfile:1

# Deccan Lens: one Node process serving the Next.js standalone build.
# ffmpeg (on-the-fly HLS conversion, video thumbnails) and poppler-utils (PDF thumbnails)
# live only in the runtime image.
#
#   docker build -t deccan-lens .
#   docker run --rm -p 3000:3000 -e SECRET_KEY="$(openssl rand -hex 32)" deccan-lens

ARG NODE_IMAGE=node:24-slim

# ---------------------------------------------------------------- deps
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------------------------------------------------------------- build
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------------------------------------------------------------- runtime
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

# Installed before the app is copied so this layer survives code changes.
# /data/hls holds converted video segments (and grid thumbnails in /data/hls/thumbs); created here
# so a named volume mounted on it is owned by node.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg poppler-utils ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data/hls && chown node:node /data/hls && chmod 700 /data/hls

# Set by CI (docker build --build-arg); served at /api/version to confirm which build is running.
ARG APP_COMMIT=unknown
ARG APP_VERSION=unknown
ENV APP_COMMIT=$APP_COMMIT \
    APP_VERSION=$APP_VERSION

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    LENS_HLS_DIR=/data/hls

# The node image ships an unprivileged "node" user (uid 1000).
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/setup').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "server.js"]
