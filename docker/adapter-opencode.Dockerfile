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
COPY apps/adapter-opencode/package.json apps/adapter-opencode/package.json
COPY packages/adapter/package.json packages/adapter/package.json
COPY packages/api-contract/package.json packages/api-contract/package.json
COPY packages/binding-core/package.json packages/binding-core/package.json
COPY packages/crypto/package.json packages/crypto/package.json
COPY packages/harness-protocol/package.json packages/harness-protocol/package.json
COPY packages/mcp/package.json packages/mcp/package.json
COPY packages/runner/package.json packages/runner/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
RUN pnpm install --frozen-lockfile --filter @clara/adapter-opencode...

COPY apps/adapter-opencode apps/adapter-opencode
COPY packages/adapter packages/adapter
COPY packages/api-contract packages/api-contract
COPY packages/binding-core packages/binding-core
COPY packages/crypto packages/crypto
COPY packages/harness-protocol packages/harness-protocol
COPY packages/mcp packages/mcp
COPY packages/runner packages/runner
COPY packages/shared-types packages/shared-types
RUN pnpm --filter @clara/adapter-opencode build
RUN pnpm --filter @clara/adapter-opencode deploy /out --prod --legacy

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV CLARA_ADAPTER_CONFIG_DIR=/config
ENV CLARA_ADAPTER_DATA_DIR=/data

WORKDIR /app
RUN mkdir -p /config /data && chown -R node:node /app /config /data

COPY --from=build --chown=node:node /out/package.json /app/package.json
COPY --from=build --chown=node:node /out/node_modules /app/node_modules
COPY --from=build --chown=node:node /repo/apps/adapter-opencode/dist /app/dist

USER node

ENTRYPOINT ["node", "/app/dist/index.js"]
CMD ["serve"]
