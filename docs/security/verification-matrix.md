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

The node's own refusals are not documented here as prose: they are asserted by the guard E2E tier,
which CI runs after every push; a red run is printed by the session-start hook and `pnpm gate`,
and a release waits for a green one. This is the authoritative internal penetration test, re-run on
every change.

| Surface | Where it is proven | What it asserts |
|---|---|---|
| Cross-owner / cross-scope refusals | `test/e2e-security.ts` (guard tier) | IDOR, scope enforcement, SSRF, path traversal, idempotency, anonymous bypass |
| Static-serving hardening | `test/e2e-static-hardening.ts` (guard tier) | a dotfile path is refused; `.well-known` and real assets are not; baseline headers present |
| Account endpoints | `test/e2e-account-security-gate.ts` | password, recovery, TOTP, delete/export gated to the owner principal |
| Namespace isolation | `test/e2e-memory-namespaces.ts`, `test/e2e-write-guards.ts` | owner / `ext:` / `eco:` namespaces stay apart |
| MCP surface | `test/e2e-mcp-cross-owner.ts`, `test/e2e-mcp-scopes.ts` | one owner's agent cannot reach another's data; the tool set is filtered by scope |
| Credential lifecycle | `test/e2e-agent-token-revocation.ts` | revoking a credential actually ends it |
| Money | `test/e2e-money-audit.ts` | no path mints, double-spends or bills the wrong account |
| Upload safety | `test/e2e-zip-security.ts` | an archive cannot write outside where it was unpacked |

Run: `pnpm test:e2e:guards:sqlite` and `pnpm test:e2e:guards:postgres-kysely`. The invariants these
enforce are written up in
[coding-guidelines/security-development-dna.md](../coding-guidelines/security-development-dna.md).

## What the probe sessions established

The dated probe sessions, with their commands and raw results, are development notes and live on the
node, in the Platform Development Notes workspace of the AIMEAT development organism (session of
2026-08-21: "Security probe session 2026-08-21: dotfiles, committed secrets, external surface, CORS,
headers"). What they established that still holds:

- **Dotfile paths are refused by the node itself**, not only by the reverse proxy: the guard
  middleware in [static-files.ts](../../aimeat/src/server-bootstrap/static-files.ts) answers 403 to any
  path with a dot-segment before the static handlers, with `.well-known/*` the one exception, and
  `test/e2e-static-hardening.ts` asserts it on both backends.
- **No live credential is committed** (gitleaks over the full history and the working tree, every hit
  triaged to a fixture, a vendored library or a placeholder).
- **CORS reflection is by design and depends on one list.** Bearer-token paths reflect any `Origin`
  with credentials allowed (invariant C-1 in [cors.ts](../../aimeat/src/middleware/cors.ts)); the
  cookie-authed paths are fenced to listed origins. That stays safe only while `COOKIE_AUTHED_PATHS`
  is complete: any new route that reads a cookie must be added to it.

## Open items (info-level hardening, no live risk)

Developer-approved before any of these ship; none is a vulnerability.

- **Permissions-Policy** and **X-Permitted-Cross-Domain-Policies: none** are cheap, safe additions to
  the shared security-header middleware if wanted.
- **COOP / COEP / CORP** affect cross-origin isolation and the app-viewer iframe model. Do not add
  without driving the published-app viewer through a real browser first: they can break app embedding.

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
[../pitfalls.md](../pitfalls.md). A new probe session is recorded as a note on the node and its
lasting findings are summarised above.
