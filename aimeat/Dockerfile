FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate
WORKDIR /app

# Build: install all deps, then compile TypeScript. `pnpm build` no longer runs
# `prisma generate` (MongoDB + legacy Prisma-PG are deprecated); prisma/ is copied
# BEFORE install so the @prisma/client postinstall generates the MongoDB client —
# tsc still compiles the deprecated Prisma providers until they are removed.
FROM base AS build
COPY package.json pnpm-lock.yaml ./
COPY prisma/ prisma/
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ src/
COPY bin/ bin/
COPY scripts/ scripts/
RUN pnpm run build

# Production image. Carries the full node_modules from the build stage. The primary
# backends (postgres-kysely, sqlite) need nothing Prisma-related at runtime; prisma/
# and the prisma CLI ride along only so the DEPRECATED MongoDB backend (startup
# `prisma db push` via findPrismaSchema()) keeps limping until it is removed.
FROM node:24-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json pnpm-lock.yaml ./

# Default SQLite data dir, owned by the runtime user so a mounted named volume
# (see docker-compose.sqlite.yml) inherits writable ownership on first creation.
RUN mkdir -p /data && chown node:node /data

ENV NODE_ENV=production
ENV AIMEAT_PORT=40050
EXPOSE 40050

USER node
CMD ["node", "dist/src/index.js"]
