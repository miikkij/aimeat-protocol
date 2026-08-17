FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate
WORKDIR /app

# Build: install all deps, then compile TypeScript.
FROM base AS build
COPY package.json pnpm-lock.yaml ./
# postinstall runs scripts/vendor-libs.mjs, so scripts/ must be present before install.
COPY scripts/ scripts/
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ src/
COPY bin/ bin/
# pnpm run build cpSyncs locales/, public/, docs/ and .env.example into dist/.
COPY locales/ locales/
COPY public/ public/
COPY docs/ docs/
COPY .env.example ./
RUN pnpm run build

# Production image. Carries the full node_modules from the build stage (better-sqlite3
# native bindings + the pg client for postgres-kysely).
FROM node:24-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# bootstrap.ts and msm.ts resolve ../../../docs from dist/src/, which is /app/docs here;
# the dist/docs copy inside dist serves csm.ts, csm-seed.ts and template-bundles.ts.
COPY --from=build /app/docs ./docs
COPY package.json pnpm-lock.yaml ./

# Default SQLite data dir, owned by the runtime user so a mounted named volume
# (see docker-compose.sqlite.yml) inherits writable ownership on first creation.
RUN mkdir -p /data && chown node:node /data

ENV NODE_ENV=production
# Memory audit 2026-08-17: cap the V8 heap (container-aware V8 would size it from host RAM),
# stop glibc spreading freed native memory across per-core arenas that never return to the OS,
# and let an operator take a production heap snapshot with `kill -USR2 <pid>`.
ENV NODE_OPTIONS="--max-old-space-size=2048 --heapsnapshot-signal=SIGUSR2"
ENV MALLOC_ARENA_MAX=2
ENV AIMEAT_PORT=40050
EXPOSE 40050

USER node
CMD ["node", "dist/src/index.js", "start"]
