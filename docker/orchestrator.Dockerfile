# syntax=docker/dockerfile:1.7

# Build the loopback orchestration service and only its runtime dependencies.
# Build context: repository root.
#
#   docker build -f docker/orchestrator.Dockerfile -t clara-orchestrator .
#
# The workspace is mounted at runtime, not baked into the image. Both the
# orchestrator container and the OpenCode container must see the same absolute
# workspace path.

FROM node:22-bookworm-slim AS build

# 1. Install build tools required for native packages like better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY patches patches
# These manifest and source copies must cover the workspace dependency closure
# of @clara/orchestrator. Missing packages make the tsup build fail to resolve
# their imports even though the filtered install succeeds.
COPY apps/orchestrator/package.json apps/orchestrator/package.json
COPY packages/mcp-server/package.json packages/mcp-server/package.json
COPY packages/orchestration/package.json packages/orchestration/package.json
COPY packages/orchestration-control/package.json packages/orchestration-control/package.json
COPY packages/policy/package.json packages/policy/package.json
RUN pnpm install --frozen-lockfile --filter @clara/orchestrator...

COPY apps/orchestrator apps/orchestrator
COPY packages/mcp-server packages/mcp-server
COPY packages/orchestration packages/orchestration
COPY packages/orchestration-control packages/orchestration-control
COPY packages/policy packages/policy
RUN pnpm --filter @clara/orchestrator build
RUN pnpm --filter @clara/orchestrator deploy /out --prod --legacy

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV CLARA_DATA_DIR=/data
ENV CLARA_ORCHESTRATION_HOST=0.0.0.0
ENV CLARA_ORCHESTRATION_PORT=8789
ENV CLARA_ORCHESTRATION_WORKSPACE=/workspace/clara
ENV CLARA_ORCHESTRATION_CONTAINER=1

WORKDIR /app
RUN mkdir -p /data /opt/clara && chown -R node:node /app /data /opt/clara

COPY --from=build --chown=node:node /out/package.json /app/package.json
COPY --from=build --chown=node:node /out/node_modules /app/node_modules
COPY --from=build --chown=node:node /repo/apps/orchestrator/dist /app/dist

USER node
EXPOSE 8789

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:8789/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["node", "/app/dist/index.js"]
CMD ["serve"]
