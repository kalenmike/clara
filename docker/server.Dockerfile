# syntax=docker/dockerfile:1.7

# Build the hub service, its panel, and only its runtime dependencies.
# Build context: repository root.
#
#   docker build -f docker/server.Dockerfile -t clara-server .
#
# The config and data directories are mounted at runtime. The panel listens on
# 0.0.0.0 inside the container and is published on the host loopback only.

FROM node:22-bookworm-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
# These manifest and source copies cover the workspace dependency closure of
# @clara/server and @clara/panel. Missing packages make the build fail to
# resolve imports even though the filtered install succeeds.
COPY apps/server/package.json apps/server/package.json
COPY apps/panel/package.json apps/panel/package.json
COPY packages/crypto/package.json packages/crypto/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/orchestration-control/package.json packages/orchestration-control/package.json
COPY packages/api-contract/package.json packages/api-contract/package.json
COPY packages/harness-protocol/package.json packages/harness-protocol/package.json
RUN pnpm install --frozen-lockfile --filter @clara/server... --filter @clara/panel...

COPY apps/server apps/server
COPY apps/panel apps/panel
COPY packages/crypto packages/crypto
COPY packages/shared-types packages/shared-types
COPY packages/orchestration-control packages/orchestration-control
COPY packages/api-contract packages/api-contract
COPY packages/harness-protocol packages/harness-protocol
RUN pnpm --filter @clara/server build
RUN pnpm --filter @clara/server deploy /out --prod --legacy

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV CLARA_CONFIG_DIR=/config
ENV CLARA_DATA_DIR=/data
ENV CLARA_LOCAL_BIND_HOST=0.0.0.0
ENV CLARA_LOCAL_HOST=127.0.0.1
ENV CLARA_PANEL_BIND_HOST=0.0.0.0
ENV CLARA_PANEL_ALLOW_REMOTE=1
ENV CLARA_PANEL_PORT=8790
ENV CLARA_SERVER_CONTAINER=1
ENV CLARA_ORCHESTRATION_HOST=orchestrator
ENV CLARA_ORCHESTRATION_PORT=8789

WORKDIR /app
RUN mkdir -p /config /data && chown -R node:node /app /config /data

COPY --from=build --chown=node:node /out/package.json /app/package.json
COPY --from=build --chown=node:node /out/node_modules /app/node_modules
COPY --from=build --chown=node:node /repo/apps/server/dist /app/dist

USER node
EXPOSE 8788 8790

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:8790/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["node", "/app/dist/index.js"]
CMD ["serve"]
