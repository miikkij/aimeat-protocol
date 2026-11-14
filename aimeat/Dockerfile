# Build from aimeat/ with the repository root as a second build context named `repo`:
#   docker build --build-context repo=.. .
# docker compose up --build passes it already (additional_contexts in both compose files). The build
# reads files that live at the repository root, outside aimeat/ (see the `build` stage).
#
# Every stage pins the same node:24-alpine image by digest (OpenSSF Scorecard PinnedDependencies).
# To move to a newer image, take the new digest from `docker buildx imagetools inspect node:24-alpine`
# and change it on all three FROM lines together.
FROM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS base
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /app

# Stands in for the `repo` build context. `--build-context repo=..` replaces this stage with the
# repository root; without it this stage runs and stops the build at once with the command to use,
# instead of a missing file deep in `pnpm run build`.
FROM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS repo
RUN echo "ERROR: this build needs the repository root as the build context 'repo'." >&2 && \
    echo "From aimeat/ run: docker build --build-context repo=.. .   (docker compose up --build passes it already)" >&2 && \
    exit 1

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
# scripts/copy-dist-assets.mjs also copies files from the repository root (../ of /app, so / here):
# the two catalogues, the public record contracts it names one by one, and the API contract. Keep
# this list equal to the `../` paths in that script.
COPY --from=repo docs/msm-examples/ /docs/msm-examples/
COPY --from=repo docs/extensions/ /docs/extensions/
COPY --from=repo docs/specs/signals-contract.md docs/specs/visibility-contract.md docs/specs/tracked-response-contract.md docs/specs/package-sale.md docs/specs/datamap.md /docs/specs/
COPY --from=repo openapi.yaml /openapi.yaml
RUN pnpm run build
# The build is done with the dev dependencies (TypeScript, the test runners, the linters), so
# drop them before the production stage copies node_modules.
RUN pnpm prune --prod

# Production image. Carries the build stage's node_modules after the prune: the production
# dependencies only (better-sqlite3 native bindings, the pg client for postgres-kysely and the rest).
FROM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53
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
# Readiness, not /v1/health: GET /v1/health/ready answers 503 while the node boots, while it drains
# after a stop signal and when its database does not answer, with one storage read whatever the
# node holds; /v1/health answers 200 also when degraded. Node's own fetch, so the probe needs no
# tool the image does not carry. A node bound to one address (AIMEAT_BIND_HOST) other than
# 127.0.0.1 needs its own HEALTHCHECK naming that address.
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.AIMEAT_PORT||40050)+'/v1/health/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/src/index.js", "start"]
