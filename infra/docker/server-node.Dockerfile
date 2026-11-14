# syntax=docker/dockerfile:1.7

# Node fallback image for the hub. The default image is the Bun sidecar in
# server.Dockerfile; keep this one for one release while the Bun runtime settles.
#
# Build the hub service, its panel, and only its runtime dependencies.
# Build context: repository root.
#
#   docker build -f infra/docker/server.Dockerfile -t clara-server .
#
# The config and data directories are mounted at runtime. The panel listens on
# 0.0.0.0 inside the container and is published on the host loopback only.
#
# The `.git` directory is excluded from the Docker context, so the CLI passes
# CLARA_COMMIT and CLARA_DIRTY from the host checkout for the panel version.
#
#   docker build -f infra/docker/server.Dockerfile \
#     --build-arg CLARA_COMMIT=$(git rev-parse --short=8 HEAD) -t clara-server .

FROM node:22-bookworm-slim AS build

ARG ENABLE_CLOUDFLARE_DEPLOYMENT=false
ENV ENABLE_CLOUDFLARE_DEPLOYMENT=$ENABLE_CLOUDFLARE_DEPLOYMENT

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
# @clara/hub-server and @clara/hub-panel. Missing packages make the build fail to
# resolve imports even though the filtered install succeeds.
COPY apps/hub/server/package.json apps/hub/server/package.json
COPY apps/hub/panel/package.json apps/hub/panel/package.json
COPY packages/crypto/package.json packages/crypto/package.json
COPY packages/sqlite/package.json packages/sqlite/package.json
COPY packages/runtime-state/package.json packages/runtime-state/package.json
COPY packages/contracts/shared-types/package.json packages/contracts/shared-types/package.json
COPY packages/orchestration/control/package.json packages/orchestration/control/package.json
COPY packages/contracts/api-contract/package.json packages/contracts/api-contract/package.json
COPY packages/contracts/harness-protocol/package.json packages/contracts/harness-protocol/package.json
RUN pnpm install --frozen-lockfile --filter @clara/hub-server... --filter @clara/hub-panel...

COPY apps/hub/server apps/hub/server
COPY apps/hub/panel apps/hub/panel
COPY infra/relay infra/relay
COPY tools/build tools/build
COPY packages/crypto packages/crypto
COPY packages/sqlite packages/sqlite
COPY packages/runtime-state packages/runtime-state
COPY packages/contracts/shared-types packages/contracts/shared-types
COPY packages/orchestration/control packages/orchestration/control
COPY packages/contracts/api-contract packages/contracts/api-contract
COPY packages/contracts/harness-protocol packages/contracts/harness-protocol
ARG CLARA_COMMIT=
ARG CLARA_DIRTY=0
ENV CLARA_COMMIT=$CLARA_COMMIT
ENV CLARA_DIRTY=$CLARA_DIRTY
RUN pnpm --filter @clara/hub-server build
RUN pnpm --filter @clara/hub-server deploy /out --prod --legacy

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
COPY --from=build --chown=node:node /repo/apps/hub/server/dist /app/dist

USER node
EXPOSE 8788 8790

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:8790/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["node", "/app/dist/index.js"]
CMD ["serve"]
