# Production deployment

How to run a node on a public address: the reverse proxy in front of it, TLS, the wildcard names its
apps run on, what the proxy must pass through, the process manager, and the health checks. Install
and first start are in [Build and operate a node](../coding-guidelines/getting-started.md#build-and-operate-a-node);
every setting named here is described in the [configuration reference](../b-config.md) and in
`aimeat/.env.example`.

## What the node does and does not do

The node is one Node.js process that listens on plain HTTP on `AIMEAT_PORT`. It does not terminate
TLS, so it always runs behind a reverse proxy (nginx, Caddy, a cloud load balancer) that holds the
certificates. Only the proxy should reach the node's port: block it in the firewall.

## Names and certificates

A public node uses up to four name families. Each is derived from `AIMEAT_BASE_URL` unless set:

| Family | Setting | Derived name | What runs there |
|---|---|---|---|
| The node | `AIMEAT_BASE_URL` | `example.org` | the site, the API, sign-in |
| Apps | `AIMEAT_APP_HOST`, `AIMEAT_APP_ORIGIN_ENABLED` | `apps.example.org`, and `<app>.apps.example.org` per app | every published app, each on its own origin |
| Portfolios | `AIMEAT_PORTFOLIO_HOST`, `AIMEAT_PORTFOLIO_ORIGIN_ENABLED` | `<person>.portfolio.example.org` | published portfolios |
| Companies | `AIMEAT_CO_HOST`, `AIMEAT_CO_ORIGIN_ENABLED` | `<company>.co.example.org` | company front pages |

**Why apps need their own names.** An app on its own origin cannot read the sign-in of the person who
opens it. With the app origin off, apps share the node's origin. The app origin is on by default when
the security profile (`AIMEAT_SECURITY_PROFILE`) is `public`. The admin Security page reports which
of the two the node runs, and what to set.

For each family you turn on:

1. Point the name itself and the wildcard below it at the server: `apps.example.org` and
   `*.apps.example.org`.
2. Get a certificate that covers both. A wildcard certificate needs the DNS-01 challenge.
3. **The wildcard trap.** If the node's own name answers only through a wildcard record of a parent
   (`*.example.org`), give it a record of its own first. Once any name exists below it (an app name,
   or the certificate's challenge record), the parent wildcard stops answering for the node's own
   name, and the node goes off the air. This took a node off the air for about 20 minutes on
   2026-10-05.
4. Set the host and the switch (`AIMEAT_APP_HOST=apps.example.org`, `AIMEAT_APP_ORIGIN_ENABLED=true`)
   and restart. `aimeat validate` reports an app origin that is on with no host.

Names are one label deep: `<app>.apps.example.org`, never `<a>.<b>.apps.example.org`.

### The page host

The HTML pages of workspaces run on one more name, a single host with no family under it:
`AIMEAT_PAGE_HOST`, for example `pages.example.org`. It is never derived; empty (the default), an
HTML page is shown as its text. Every page is served from it by path (`/p/<frame token>/`), so
nothing in DNS, TLS, the proxy or any header grows with the number of pages.

1. Give the name its own DNS record, and a certificate that covers it. A wildcard certificate of the
   parent (`*.example.org`) covers it; a name that only resolves through a parent wildcard record
   still needs a server block, because the proxy must route it.
2. Add a server block for the name that proxies everything to the node with
   `proxy_set_header Host $host`, and serve nothing else on it. The node answers only the page frame
   there (`/p/...`); every other path is 404, and `/` goes to the node's own address. The node reads
   the host from `Host`; it needs no marker header.
3. Set `AIMEAT_PAGE_HOST=pages.example.org` and restart. The SPA's `frame-src` then names the host.
4. Check: `curl -sI https://pages.example.org/` answers 302 to the node, and a page's frame address
   opened in a tab goes to its viewer.

**Why a host of its own.** The page's script runs in an opaque origin (the CSP sandbox), with no
network exit. The host is the second lock: should a response ever lose its sandbox, the page still
runs on an origin that holds nobody's session. Do not point the page host at the node's own name or
an app's.

## What the proxy must pass through

- **The `Host` header, unchanged** (`proxy_set_header Host $host` in nginx). The node decides from the
  raw `Host` which family a request belongs to. A proxy that rewrites `Host` to an internal name makes
  every app, portfolio and company request look like the node's own site. The node does not read
  `X-Forwarded-Host` for this, because any client can send it.
- **`X-Forwarded-For` and `X-Forwarded-Proto`**, and `AIMEAT_TRUST_PROXY` set to match the path to the
  node: a hop count (`1`) or the proxy's address or subnet. Unset, the node trusts loopback when its
  base address is not localhost, which fits a proxy on the same machine. `true` trusts every hop and
  is safe only when the outermost proxy overwrites the forwarded headers; the node logs a warning.
- **Optional family markers.** A proxy may send `X-Subdomain: <label>` and `X-App-Origin`,
  `X-Portfolio-Origin` or `X-Co-Origin`. The node works without them, from `Host`. When they are sent,
  the node honours a marker only on a `Host` in that family and logs `subdomain: origin marker
  dropped` for any other, and it honours `X-Subdomain` only when it names the label of the `Host`
  itself (`blog` for `blog.example.org`, `notes` for `notes.apps.example.org`) and logs
  `subdomain: X-Subdomain dropped` for any other, so a client cannot claim either. There is no
  setting for this. Set `X-Subdomain` from the server name the proxy routed on, never from the
  client: nginx passes a client's header through unchanged unless the location sets it, so set it
  (to the label, or to `""` on the node's own name) and set `X-Forwarded-Host ""` so a client's copy
  is not passed either.
- **WebSocket upgrades** on `/v1/realtime/ws`, `/v1/connect/tunnel` and `/v1/personal/tunnel`. Pass
  `Upgrade` and `Connection`, and give them a long read timeout. The node closes an upgrade on any
  other path.
- **Streams.** Server-sent events (`/v1/events`, `/v1/public/events`, `/v1/agui/...`, the chat turn,
  `/v1/llm/chat/completions`, `/v1/ai/stream`, `/v1/ai/speak`) and the MCP endpoint (`/v1/mcp`, `/mcp`)
  hold a connection open. The node sends `X-Accel-Buffering: no` on its streams, which nginx honours;
  other proxies need buffering turned off for these paths and a long read timeout.
- **Body size.** The node takes JSON up to `AIMEAT_JSON_BODY_LIMIT_MB`, and up to
  `AIMEAT_JSON_BODY_LIMIT_LARGE_MB` under `/v1/apps`, `/v1/extensions`, `/v1/cortex`, `/v1/storage`,
  `/v1/memory/files` and `/v1/mcp`. Uploads through a presigned address (`/v1/upload/`) are raw and
  capped per file by `AIMEAT_STORAGE_MAX_FILE_SIZE_MB`. Set the proxy's limit (`client_max_body_size`)
  at least as high as the largest of these, or the proxy refuses before the node can answer with its
  own `413 QUOTA_EXCEEDED`.
- **Response header size.** An app response's security policy names at most one framing origin, so
  its headers stay under 4 kB however many apps the node has (`aimeat/test/e2e-app-origin.ts` holds
  that line). An earlier version listed every app origin of the owner and, at 76 apps, outgrew
  nginx's default 4 kB `proxy_buffer_size`: every app address answered 502. If your proxy adds headers of its
  own, raise its response-header buffer to leave room.

The node itself sends `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy`, and
`Strict-Transport-Security` when `AIMEAT_BASE_URL` is `https://`. Do not add a second copy of these at
the proxy.

### An nginx starting point

This is a sketch of the requirements above for one family, not a copy of a running deployment. Adapt
names, paths, certificates and limits.

```nginx
map $http_upgrade $connection_upgrade { default upgrade; '' close; }

# The label nginx routed on, taken from the server name, never from the client. Empty on the node's
# own name and on the bare app host; an empty value is not sent.
map $host $aimeat_label {
    ~^(?<label>[a-z0-9-]+)\.apps\.example\.org$  $label;
    default                                      "";
}

server {
    listen 443 ssl http2;
    server_name example.org apps.example.org *.apps.example.org;
    ssl_certificate     /etc/ssl/example.org/fullchain.pem;
    ssl_certificate_key /etc/ssl/example.org/privkey.pem;

    client_max_body_size 64m;          # at least the largest node limit you set
    proxy_buffer_size    16k;          # room for headers the proxy adds

    location / {
        proxy_pass         http://127.0.0.1:40050;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;            # verbatim, required
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   X-Subdomain       $aimeat_label;     # from the server name, replaces a client's
        proxy_set_header   X-Forwarded-Host  "";                # a client's copy is not passed
        proxy_set_header   Upgrade           $http_upgrade;     # WebSocket paths
        proxy_set_header   Connection        $connection_upgrade;
        proxy_read_timeout 3600s;                               # streams and tunnels
    }
}
```

## Process manager

- **systemd:** [`aimeat/deploy/aimeat.service`](../../aimeat/deploy/aimeat.service) carries the start
  command, restart on failure with a back-off, the memory limits, the jemalloc preload and the heap
  ceiling (`NODE_OPTIONS`). `LD_PRELOAD` must be in the unit or the environment; a `.env` read by Node
  is too late for it.
- **Docker:** `aimeat/Dockerfile` with `aimeat/docker-compose.yml` (PostgreSQL) or
  `aimeat/docker-compose.sqlite.yml` (SQLite). **Neither compose file keeps the node's key directory
  on a volume.** Mount one at the key path, or set `AIMEAT_NODE_KEY_PATH` to a file on a volume, or a
  new container starts without the node's identity (see [backup and restore](backup-and-restore.md)).
  The image has no `HEALTHCHECK`; add one that calls `/v1/health`.

On `SIGTERM` or `SIGINT` the node flushes its buffered counters and audit rows, closes its tunnels and
exits; it gives itself a few seconds before it exits anyway. Give the process manager a stop timeout
longer than that (the systemd unit uses 30 seconds).

## Health checks

| Route | Answers | Use it for |
|---|---|---|
| `GET /v1/health` | `status` (`healthy` or `degraded`), uptime, memory, a storage probe under `subsystems.storage`, and the running build | liveness and readiness. **It answers 200 even when degraded**: a check must read `status`, not only the HTTP code |
| `GET /v1/build` | the running version, when this process started (`build`, base-36 milliseconds), the commit, and whether the build matches its source | proving which code is live after a deploy; never cached |

Both answer in maintenance mode, and neither needs a sign-in. Metrics for Prometheus are in the
[observability guide](../../aimeat/docs/observability-guide.md).

## Before the first public start

Run through the [security deployment checklist](../security/deployment-checklist.md) and
`aimeat validate`. Then take the first [backup](backup-and-restore.md) before anyone signs up.
