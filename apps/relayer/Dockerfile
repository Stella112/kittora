# Kittora relayer (Railway). Build context = repository root:
#   docker build -f apps/relayer/Dockerfile .
# Runs TypeScript directly with Node's type stripping (no build step). node:sqlite and type stripping need Node >= 22.18.
FROM node:24-slim
ENV NODE_ENV=production
RUN corepack enable
WORKDIR /app

# Install only the relayer and its workspace dependency (@kittora/core), from the lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/relayer/package.json apps/relayer/
RUN pnpm install --frozen-lockfile --prod --filter @kittora/relayer...

COPY packages/core/src packages/core/src
COPY apps/relayer/src apps/relayer/src

# /data holds the SQLite file on a VPS volume (named volumes inherit this ownership on first mount).
RUN mkdir -p /data && chown node:node /data
WORKDIR /app/apps/relayer
USER node
# PORT is provided by the platform; every other setting comes from environment variables (see docs/DEPLOY.md).
CMD ["node", "--experimental-strip-types", "src/main.ts"]
