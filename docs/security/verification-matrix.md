# AIMEAT Security Verification Matrix

A living record of what has been probed, with what, and what the probe actually proved. It sits next
to [threat-model.md](threat-model.md) (the assets, adversaries and vectors) and
[deployment-checklist.md](deployment-checklist.md) (what an operator must set): the threat model says
what to worry about, the checklist says what to configure, and this file says what was tested and
what the test showed. A row is only "verified" when there is a command next to it and a result under
that command.

Method: external probing of the live node (`aimeat.io`) plus a throwaway local node
(`sqlite :memory:`, dev mode) for the paths that must not depend on the reverse proxy, and the guard
E2E tier for the internal refusals. Active scanners run against the throwaway node, never against the
live paid deployment.

## Standing verification (runs on every merge)

The node's own refusals are not documented here as prose — they are asserted by the guard E2E tier,
which CI refuses to merge without. This is the authoritative internal penetration test, re-run on
every change.

| Surface | Where it is proven | What it asserts |
|---|---|---|
| Cross-owner / cross-scope refusals | `test/e2e-security.ts` (guard tier) | IDOR, scope enforcement, SSRF, path traversal, idempotency, anonymous bypass |
| Static-serving hardening | `test/e2e-static-hardening.ts` (guard tier) | a dotfile path is refused; `.well-known` and real assets are not; baseline headers present |
| Account doors | `test/e2e-account-security-gate.ts` | password, recovery, TOTP, delete/export gated to the owner principal |
| Namespace isolation | `test/e2e-memory-namespaces.ts`, `test/e2e-write-guards.ts` | owner / `ext:` / `eco:` namespaces stay apart |
| MCP surface | `test/e2e-mcp-cross-owner.ts`, `test/e2e-mcp-scopes.ts` | one owner's agent cannot reach another's data; the tool set is filtered by scope |
| Credential lifecycle | `test/e2e-agent-token-revocation.ts` | revoking a credential actually ends it |
| Money | `test/e2e-money-audit.ts` | no path mints, double-spends or bills the wrong account |
| Upload safety | `test/e2e-zip-security.ts` | an archive cannot write outside where it was unpacked |

Run: `pnpm test:e2e:guards:sqlite` and `pnpm test:e2e:guards:postgres-kysely`. The invariants these
enforce are written up in
[coding-guidelines/security-development-dna.md](../coding-guidelines/security-development-dna.md).

## Session verification — 2026-08-21

Focus: intrusion surface, specifically the leftover-secrets-file leak class (`.env~`) and the
external HTTP surface. Live node build at probe time: `version 3.5.0`, `/v1/build` `mt0k4w3a`.

### 1. Dotfile / backup-file exposure — VERIFIED, and hardened

The trigger: a `.env~` backup left readable on a nearby, unrelated system. The equivalent class was
probed here and closed at two layers.

External probe of the live node, apex and an app subdomain:

```bash
for p in /.env /.env~ /.env.bak /.env.old /.env.save /.git/config /.git/HEAD /.gitignore \
         /.npmrc /.DS_Store /package.json /docker-compose.yml /dump.sql /backup.zip; do
  curl -s -o /dev/null -w "%{http_code} $p\n" "https://aimeat.io$p"
done
```

Result: every one returned **403** (the refusal is nginx's). `budjetti.apps.aimeat.io` behaves the
same. `/v1/admin/config` and `/v1/admin/stats` return **401**, not their contents.

Defense-in-depth added this session: the node itself now refuses any dotfile path, so a personal
node run without that nginx rule cannot leak a leftover `.env~` either.

- Guard middleware in [static-files.ts](../../aimeat/src/server-bootstrap/static-files.ts) 403s any
  request whose path has a dot-segment (`/.env`, `/.env~`, `/.git/config`, `/.htpasswd`, ...), before
  the static handlers. `serve-static`'s own `dotfiles: 'deny'` cannot do this alone: its 403 is
  swallowed by the default fallthrough (it calls `next()` and the request lands on the JSON 404), so
  the refusal is made explicitly where it is visible and testable. `.well-known/*` (agent discovery,
  ACME) is the one allowed exception; the API namespaces `/v1` and `/local` are skipped so their own,
  more specific validation (e.g. `400 INVALID_FILENAME` for a `../` traversal) is not masked.
- Asserted by `test/e2e-static-hardening.ts`: 19 assertions, green on both backends.

```
=== Static Hardening E2E Results: 19 passed, 0 failed out of 19 ===   (sqlite and postgres-kysely)
```

### 2. Committed-secret exposure — VERIFIED clean

Tool: gitleaks 8.30.1, full history (4758 commits, 154 MB) and working tree.

```bash
gitleaks git . --report-format json --report-path history.json --redact
gitleaks dir . --report-format json --report-path dir.json --redact
```

Raw: 108 history hits, 43 working-tree hits. Every one triaged to a non-secret:

- test fixtures and mock keys under `test/` (the bulk),
- minified vendored libraries (`p5.min.js`, base64 false positives),
- documentation placeholders (`<strong-random-password>`, `Bearer <token>` against `example.com`),
- two history-only files now gone from the tree: `.aimeat-manifest.json` (an asset-integrity hash
  map, untracked since commit 898bf522) and a `.tmp_ocean_c2d.html` scratch file.

No live credential is committed. No `.env`, `.pem`, `.key` or `id_rsa` is tracked.

### 3. External HTTP surface — VERIFIED, no real finding

Tool: nuclei 3.11.1, template set v10.4.7 (2356 templates: exposures, misconfiguration, config,
disclosure, default-login), against the throwaway local node.

```bash
nuclei -u http://127.0.0.1:40060 -tags exposure,misconfig,config,disclosure,default-login \
       -severity info,low,medium,high,critical -jsonl -o nuclei.jsonl
```

Result: **0 findings at low or above.** Nine `info` matches, each triaged:

| Match | Verdict |
|---|---|
| `cors-misconfig / arbitrary-origin` | By design (C-1), verified safe on prod — see below |
| `http-missing-security-headers` (HSTS) | False positive on local http; HSTS is present on prod https |
| `http-missing-security-headers` (Permissions-Policy, COOP, COEP, CORP, X-Permitted-Cross-Domain-Policies) | Optional hardening, absent on prod — see Open items |
| `llms-file-enum` `/llms.txt` | Intentional feature (agent discovery) |
| `openapi` `/openapi.json` | Intentional — the public API contract is meant to be readable |

### 4. CORS reflection — VERIFIED correct

The node reflects an arbitrary `Origin` with `Access-Control-Allow-Credentials: true` on Bearer-token
paths. This is the deliberate C-1 decision (apps attach from arbitrary browser origins; the API is
Bearer-token, so there is no ambient credential for a hostile origin to steal). The load-bearing
control is that the three cookie-authed paths are fenced to explicitly-listed origins. Verified on
prod:

```bash
# Cookie path + auth + hostile origin -> refused
curl -si -X OPTIONS -H "Origin: https://evil.example" -H "Authorization: Bearer bogus" \
     -H "Access-Control-Request-Method: POST" https://aimeat.io/v1/auth/refresh
# -> 403, no CORS headers

# Bearer path + hostile origin -> reflected, by design
curl -si -X OPTIONS -H "Origin: https://evil.example" -H "Authorization: Bearer bogus" \
     -H "Access-Control-Request-Method: POST" https://aimeat.io/v1/memory/test
# -> 204, Access-Control-Allow-Origin: https://evil.example, Allow-Credentials: true
```

The cookie-authed path refuses the hostile origin; the Bearer path reflects it. Both match
[cors.ts](../../aimeat/src/middleware/cors.ts) invariant C-1. The residual maintenance dependency:
the safety of reflecting `Allow-Credentials: true` on Bearer paths rests entirely on
`COOKIE_AUTHED_PATHS` staying complete. Any new route that reads a cookie must be added to that set.

### 5. Security headers on prod — recorded

```bash
curl -sI https://aimeat.io/
```

| Header | Status |
|---|---|
| Strict-Transport-Security | present (`max-age=31536000; includeSubDomains`) |
| Content-Security-Policy | present (nonce-based) |
| X-Content-Type-Options | present (`nosniff`) |
| X-Frame-Options | present (`SAMEORIGIN`) |
| Referrer-Policy | present (`strict-origin-when-cross-origin`) |
| Permissions-Policy | absent (Open items) |
| Cross-Origin-Opener/Embedder/Resource-Policy | absent (Open items) |
| X-Permitted-Cross-Domain-Policies | absent (Open items) |

## Open items (info-level hardening, no live risk)

Developer-approved before any of these ship — none is a vulnerability.

- **Permissions-Policy** and **X-Permitted-Cross-Domain-Policies: none** are cheap, safe additions to
  the shared security-header middleware if wanted.
- **COOP / COEP / CORP** affect cross-origin isolation and the app-viewer iframe model. Do not add
  without driving the published-app viewer through a real browser first — they can break app embedding.

## How to re-run

Tools are not vendored into the repo; fetch the prebuilt binaries.

- **gitleaks** (committed secrets): `gitleaks git .` and `gitleaks dir .`
- **nuclei** (external exposure): update templates once, then
  `nuclei -u <target> -tags exposure,misconfig,config,disclosure,default-login`. Run against a
  throwaway node, not the live deployment.
- **Guard tier** (internal refusals): `pnpm test:e2e:guards:sqlite` and
  `pnpm test:e2e:guards:postgres-kysely`.
- **pnpm audit** (dependency CVEs): part of the deployment checklist.

When a probe finds something real, it becomes a P-level in
[incident-response.md](incident-response.md) and, if it is a repeatable trap, an entry in
[../pitfalls.md](../pitfalls.md).
