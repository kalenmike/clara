# syntax=docker/dockerfile:1.7

# Build the Clara web client and serve it as a static site.
# Build context: repository root.
#
#   docker build -f docker/web.Dockerfile -t clara-web .
#
# VITE_CLARA_WS_URL is baked into the bundle at build time. Leave it unset to
# use the relay URL carried by each pairing code; set it only to retarget relay
# rooms to a different relay endpoint.
#
#   docker build -f docker/web.Dockerfile \
#     --build-arg VITE_CLARA_WS_URL=wss://relay.example -t clara-web .

FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
# These manifest and source copies cover the workspace dependency closure of
# @clara/web. Missing packages make the build fail to resolve imports even
# though the filtered install succeeds.
COPY apps/web/package.json apps/web/package.json
COPY packages/api/api-client/package.json packages/api/api-client/package.json
COPY packages/contracts/api-contract/package.json packages/contracts/api-contract/package.json
COPY packages/crypto/package.json packages/crypto/package.json
COPY packages/contracts/shared-types/package.json packages/contracts/shared-types/package.json
RUN pnpm install --frozen-lockfile --filter @clara/web...

COPY apps/web apps/web
COPY packages/api/api-client packages/api/api-client
COPY packages/contracts/api-contract packages/contracts/api-contract
COPY packages/crypto packages/crypto
COPY packages/contracts/shared-types packages/contracts/shared-types

ARG VITE_CLARA_WS_URL=
ENV VITE_CLARA_WS_URL=$VITE_CLARA_WS_URL
RUN pnpm --filter @clara/web build

FROM nginx:alpine AS runtime

COPY docker/web.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
