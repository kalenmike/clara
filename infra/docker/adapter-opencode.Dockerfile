# syntax=docker/dockerfile:1.7

# Build the Clara OpenCode adapter. The adapter connects out to the hub over the
# same WebSocket as a browser client. It listens on no inbound port.

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
COPY apps/adapters/opencode/package.json apps/adapters/opencode/package.json
COPY packages/adapters/runtime/package.json packages/adapters/runtime/package.json
COPY packages/contracts/api-contract/package.json packages/contracts/api-contract/package.json
COPY packages/adapters/binding/package.json packages/adapters/binding/package.json
COPY packages/crypto/package.json packages/crypto/package.json
COPY packages/contracts/harness-protocol/package.json packages/contracts/harness-protocol/package.json
COPY packages/orchestration/mcp/package.json packages/orchestration/mcp/package.json
COPY packages/adapters/runner/package.json packages/adapters/runner/package.json
COPY packages/contracts/shared-types/package.json packages/contracts/shared-types/package.json
RUN pnpm install --frozen-lockfile --filter @clara/adapter-opencode...

COPY apps/adapters/opencode apps/adapters/opencode
COPY packages/adapters/runtime packages/adapters/runtime
COPY packages/contracts/api-contract packages/contracts/api-contract
COPY packages/adapters/binding packages/adapters/binding
COPY packages/crypto packages/crypto
COPY packages/contracts/harness-protocol packages/contracts/harness-protocol
COPY packages/orchestration/mcp packages/orchestration/mcp
COPY packages/adapters/runner packages/adapters/runner
COPY packages/contracts/shared-types packages/contracts/shared-types
RUN pnpm --filter @clara/adapter-opencode build
RUN pnpm --filter @clara/adapter-opencode deploy /out --prod --legacy

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV CLARA_ADAPTER_CONFIG_DIR=/config
ENV CLARA_ADAPTER_DATA_DIR=/data

WORKDIR /app
RUN mkdir -p /config /data && chown -R node:node /app /config /data

COPY --from=build --chown=node:node /out/package.json /app/package.json
COPY --from=build --chown=node:node /out/node_modules /app/node_modules
COPY --from=build --chown=node:node /repo/apps/adapters/opencode/dist /app/dist

USER node

ENTRYPOINT ["node", "/app/dist/index.js"]
CMD ["serve"]
