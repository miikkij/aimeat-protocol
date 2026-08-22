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

# Memory trace 2026-08-17, round 7: jemalloc returns freed pages to the OS within seconds
# (dirty_decay_ms), so RSS tracks actual use instead of parking at the boot peak — measured
# steady state fell from 1.4 GB to 250-450 MB with bursts unchanged. LD_PRELOAD has to be
# process environment, never a .env entry: the dynamic linker consumes it before node starts.
# (The MALLOC_ARENA_MAX=2 this replaces was a glibc knob that never did anything on this
# musl-based image.)
RUN apk add --no-cache jemalloc
ENV LD_PRELOAD=/usr/lib/libjemalloc.so.2
ENV MALLOC_CONF="background_thread:true,dirty_decay_ms:10000,muzzy_decay_ms:10000"

ENV NODE_ENV=production
# Cap the V8 heap (container-aware V8 would size it from host RAM) and let an operator take
# a production heap snapshot with `kill -USR2 <pid>`. Since 2026-08-21 this is the ONLY place the
# ceiling is set for a container — the npm script used to pass it as a CLI argument, which wins
# over NODE_OPTIONS and made the value unchangeable from the environment. Keep it UNDER the
# container's --memory limit, or the kernel kills the process instead of V8 collecting garbage.
ENV NODE_OPTIONS="--max-old-space-size=2048 --heapsnapshot-signal=SIGUSR2"
ENV AIMEAT_PORT=40050
EXPOSE 40050

USER node
CMD ["node", "dist/src/index.js", "start"]
