# agentMotoride for several riders: the MCP tools over HTTP (ADR 0027). One image, one data volume.
# Build:  docker build -t agent-motoride .
# Run:    see deploy/docker-compose.yml (with Caddy for HTTPS) and docs/guide/self-hosting.md
FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    RIDE_DATA_DIR=/data \
    RIDE_SERVER_HOST=0.0.0.0 \
    RIDE_SERVER_PORT=8788

WORKDIR /app

# Only what runs: no dev tools, no git hooks (the prepare script needs them), no tests.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY src ./src
COPY assets ./assets

# The riders' libraries and the registry live here; mount a volume on it.
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME /data
USER node

EXPOSE 8788

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.RIDE_SERVER_PORT || 8788) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# `docker compose exec ride node src/admin.ts add alice@example.org` runs the administration inside.
CMD ["node", "src/serve.ts"]
