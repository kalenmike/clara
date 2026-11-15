# syntax=docker/dockerfile:1.7

# Build the Clara hub as one Bun executable with the panel embedded.
# Build context: repository root.
#
#   docker build -f infra/docker/server.Dockerfile -t clara-server .
#
# The config and data directories are mounted at runtime. The panel listens on
# 0.0.0.0 inside the container and is published on the host loopback only.
#
# `infra/docker/server-node.Dockerfile` keeps the previous Node image for one
# release as a fallback.

FROM node:22-bookworm-slim AS build

ARG ENABLE_CLOUDFLARE_DEPLOYMENT=false
ENV ENABLE_CLOUDFLARE_DEPLOYMENT=$ENABLE_CLOUDFLARE_DEPLOYMENT
ENV HUSKY=0

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    python3 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:/usr/local/bin:$PATH
RUN corepack enable && bun --version

WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
# These manifest copies cover the workspace dependency closure of the hub
# desktop sidecar. Missing packages make the build fail to resolve imports even
# though the filtered install succeeds.
COPY apps/hub/server/package.json apps/hub/server/package.json
COPY apps/hub/panel/package.json apps/hub/panel/package.json
COPY packages/panel/package.json packages/panel/package.json
COPY apps/hub/desktop/package.json apps/hub/desktop/package.json
COPY packages/sqlite/package.json packages/sqlite/package.json
COPY packages/runtime-state/package.json packages/runtime-state/package.json
COPY packages/crypto/package.json packages/crypto/package.json
COPY packages/contracts/shared-types/package.json packages/contracts/shared-types/package.json
COPY packages/orchestration/control/package.json packages/orchestration/control/package.json
COPY packages/contracts/api-contract/package.json packages/contracts/api-contract/package.json
COPY packages/contracts/harness-protocol/package.json packages/contracts/harness-protocol/package.json
COPY packages/adapters/install/package.json packages/adapters/install/package.json
RUN pnpm install --frozen-lockfile \
      --filter @clara/hub-desktop... \
      --filter @clara/hub-panel...

COPY apps/hub/server apps/hub/server
COPY apps/hub/panel apps/hub/panel
COPY packages/panel packages/panel
COPY apps/hub/desktop apps/hub/desktop
COPY infra/relay infra/relay
COPY tools/build tools/build
COPY packages/sqlite packages/sqlite
COPY packages/runtime-state packages/runtime-state
COPY packages/crypto packages/crypto
COPY packages/contracts/shared-types packages/contracts/shared-types
COPY packages/orchestration/control packages/orchestration/control
COPY packages/contracts/api-contract packages/contracts/api-contract
COPY packages/contracts/harness-protocol packages/contracts/harness-protocol
COPY packages/adapters/install packages/adapters/install

ARG CLARA_COMMIT=
ARG CLARA_DIRTY=0
ENV CLARA_COMMIT=$CLARA_COMMIT
ENV CLARA_DIRTY=$CLARA_DIRTY
RUN node apps/hub/desktop/scripts/build-sidecar.mjs

FROM debian:bookworm-slim AS runtime
# Keep the 1000:1000 IDs the previous Node image used. Existing
# clara-server-config and clara-server-data volumes were created by the `node`
# user, and a different UID makes the hub fail with EACCES in /data.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1000 clara \
    && useradd --uid 1000 --gid 1000 --home-dir /app \
               --no-create-home --shell /usr/sbin/nologin clara

ENV CLARA_CONFIG_DIR=/config
ENV CLARA_DATA_DIR=/data
ENV CLARA_CACHE_DIR=/tmp/clara
ENV CLARA_RUNTIME_FILE=/data/runtime.json
ENV CLARA_LOCAL_BIND_HOST=0.0.0.0
ENV CLARA_LOCAL_HOST=127.0.0.1
ENV CLARA_LOCAL_PORT=8788
ENV CLARA_PANEL_BIND_HOST=0.0.0.0
ENV CLARA_PANEL_ALLOW_REMOTE=1
ENV CLARA_PANEL_PORT=8790
ENV CLARA_SERVER_CONTAINER=1
ENV CLARA_ORCHESTRATION_HOST=orchestrator
ENV CLARA_ORCHESTRATION_PORT=8789

WORKDIR /app
RUN mkdir -p /config /data /tmp/clara && chown -R clara:clara /app /config /data /tmp/clara

COPY --from=build /repo/apps/hub/desktop/src-tauri/binaries/clara-server-* /app/clara-server
RUN chmod +x /app/clara-server && chown clara:clara /app/clara-server

USER clara
EXPOSE 8788 8790

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=6 \
  CMD ["/app/clara-server", "health"]

ENTRYPOINT ["/app/clara-server"]
CMD ["serve"]
