FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate
WORKDIR /app

# Build: install all deps, then compile TypeScript.
FROM base AS build
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ src/
COPY bin/ bin/
COPY scripts/ scripts/
RUN pnpm run build

# Production image. Carries the full node_modules from the build stage (better-sqlite3
# native bindings + the pg client for postgres-kysely).
FROM node:24-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json pnpm-lock.yaml ./

# Default SQLite data dir, owned by the runtime user so a mounted named volume
# (see docker-compose.sqlite.yml) inherits writable ownership on first creation.
RUN mkdir -p /data && chown node:node /data

ENV NODE_ENV=production
ENV AIMEAT_PORT=40050
EXPOSE 40050

USER node
CMD ["node", "dist/src/index.js"]
