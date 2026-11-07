# Builds the mini app with production settings, then serves it with Caddy (automatic HTTPS).
# Build context = repository root (docker-compose.yml sets it).
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @kittora/web...
COPY packages/core/src packages/core/src
COPY apps/web apps/web

ARG DOMAIN
ARG VITE_NIM_VALIDATOR=""
# Public values only (Vite bakes them into the bundle). Contracts: Polygon mainnet, BUILD_LOG.md Nov 6.
ENV VITE_RELAYER_URL=https://api.${DOMAIN} \
    VITE_PUBLIC_URL=https://${DOMAIN} \
    VITE_VAULT_ADDRESS=0x2583FE752256afB1F863a2D5EEea5241BD2B4bDb \
    VITE_GROUP_KITTY_ADDRESS=0x19d8687607fD86A25F8e80a535e5A9c6A848A4a7 \
    VITE_CHAIN_ID=137 \
    VITE_NIM_VALIDATOR="${VITE_NIM_VALIDATOR}"
RUN test -n "$DOMAIN" && pnpm --filter @kittora/web build

FROM caddy:2.10.2-alpine
# deploy/vps/Caddyfile (Caddy owns 80/443, automatic HTTPS) or Caddyfile.behind-proxy (nginx in front)
ARG CADDYFILE=deploy/vps/Caddyfile
COPY ${CADDYFILE} /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
