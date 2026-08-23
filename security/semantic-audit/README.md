# Semantic security audit — invariants as source→sink rules

Most of the security-development-dna invariants have the same shape: an untrusted or identity-bearing
**source** must pass a **sanitizer** before it reaches a sensitive **sink**. That shape is exactly
what taint and structural analysis check, so instead of re-reading routes by hand each time, the
invariants that fit are written once as rules and run on every change. The ones that do NOT fit
static analysis are named below with the mechanism that does cover them — no rule is faked to pretend
otherwise.

## Two engines

- **ast-grep** (`ast-grep/*.yml`) — a native binary that runs on Windows too (Semgrep needs WSL or
  Docker, which this project does not use), so it is what runs both locally and in CI. Structural and
  intra-procedural: it matches a pattern and its surroundings, but does not follow a value through a
  variable across statements.
- **Semgrep** (`semgrep/*.yml`) — true interprocedural taint (follows a value through assignments and
  across functions). Stronger for the resolve-identity check. Runs in CI on a Linux runner
  (`semgrep-taint` job), SARIF category `semgrep-taint`.

CI runs the ast-grep rules and uploads the SARIF to GitHub code scanning, so every finding is a
tracked alert on the Security tab with a history — see `.github/workflows/semantic-audit.yml`.
GitHub's CodeQL default setup is also enabled on the repo (2026-08-23), so the generic JS/TS query
suite (injection, prototype pollution, ReDoS, …) lands on the same Security tab beside these rules.

```bash
# Everything, locally (what CI runs):
npx -p @ast-grep/cli ast-grep scan -c security/semantic-audit/sgconfig.yml aimeat/src

# The deeper taint pass for resolve-identity (Linux/macOS):
semgrep --config security/semantic-audit/semgrep aimeat/src/routes
```

## Invariant coverage

Numbers are the invariants in `docs/coding-guidelines/security-development-dna.md`.

| Invariant | Checked by | Rule |
|---|---|---|
| 1 — authorize against the resolved identity | ast-grep rule + Semgrep taint | `resolve-identity` |
| 6 — optionalAuth is not a gate (`if (!req.auth)`) | ast-grep rule | `optional-auth-not-a-gate` |
| 11 — the owner name is not a principal | ast-grep rule (review-level) | `owner-name-is-not-a-principal` |
| 15 — a permission word is enforced on every door | ast-grep rule | `permission-word-on-every-door` |
| 2 — server-read keys unreachable by scoped principals | audit-gate ratchet | `check:trusted-keys` |
| 3 — non-constant outbound HTTP via safeFetch | audit-gate ratchet | `check:outbound-fetch` |
| 4 — every mutating route gated | audit-gate ratchet | `check:route-scopes` |
| 9 — cross-owner / cross-scope denial tests | audit-gate ratchet + guard tier | `check:denial-coverage` |
| "one capability, one implementation" | audit-gate ratchet | `check:shared-impl` |
| MCP name + parameter parity across surfaces | ratchet + unit test | `check:mcp-tools`, `check:mcp-schemas`, `cli-tool-param-forwarding.test` |
| pypi liaison ↔ node schema parity | audit-gate ratchet | `check:liaison-surface` |
| 12 — a role is granted, never inherited at mint | guard tier + mint-list diff | `e2e-account-security-gate`; review when adding a mint |
| 5 — federation verify is unconditional | NOT a clean rule | the conditional-around-verify shape has legitimate forms; review + `e2e-federation` |
| 13 — a gate reads the normalized value | NOT a clean rule | a credential header (fine) and an isolation-claim header (a bug) are structurally identical; review + the subdomain Host-derivation |
| 14 — refuse before you write | NOT static | an ordering property (write-before-check); tests + code review |
| 16 — deprecated is not removed | NOT static | a policy property (a deprecation must name flag+default+version); review |

### The three rules that exist

- **resolve-identity** — `req.auth!.sub` reaching a `storage.*` call without being resolved. On an
  owner session `sub` is the bare owner name, so owner data lands under the wrong key. Sanitizers:
  `resolveIdentity(...)`, inline GHII construction, and the attribution fields that legitimately hold
  a raw principal id.
- **owner-name-is-not-a-principal** — the `owner !== name && !roles.includes('operator')` widening.
  A review prompt: if the guarded door changes the ACCOUNT itself, it needs `requireOwnerPrincipal()`.
- **permission-word-on-every-door** — `requireRoleOrScope('agent', <scope>)`, where the agent role is
  admitted before the scope, so the scope word is decorative on that door.
- **optional-auth-not-a-gate** — `if (!req.auth)` used as a gate in a route. optionalAuth injects a
  (possibly anonymous) identity, so this admits the anonymous principal; use requireAuth().

## One pane — every audit signal on the Security tab

The audit is not only the three ast-grep rules. Two other families already run, and CI mirrors all of
them onto the same GitHub code-scanning Security tab so "what is checked, and what is currently
regressed" is one view rather than twelve log tails (`.github/workflows/semantic-audit.yml`):

- **ast-grep semantic rules** (this directory) — category `semantic-audit`.
- **audit-gate ratchets + MCP parity** (`checks-to-sarif.mjs` wraps `check:route-scopes`,
  `check:trusted-keys`, `check:shared-impl`, `check:liaison-surface`, `check:mcp-tools`,
  `check:mcp-schemas`, and the rest) — category `audit-gates`. These also gate ci.yml; the Security
  tab is their visibility, not their enforcement.

Both are advisory in this workflow (continue-on-error): a finding surfaces without blocking a merge.
The ratchets still block ci.yml on a NEW violation, which is where enforcement lives.

### Proof-of-concept result (2026-08-21)

First run over `src/routes`: 22 findings across the four rules.

| Rule | Findings | After triage |
|---|---|---|
| resolve-identity | 12 | 0 real — all agent-session branches, attribution fields, or inline GHII construction |
| owner-name-is-not-a-principal | 3 | 2 to confirm (`owners.ts`, `owners/export.ts`), 1 legitimate (instance ownership) |
| permission-word-on-every-door | 4 | 4 to confirm (`organism:invite` doors) |
| optional-auth-not-a-gate | 3 | 3 to confirm (`apps/read.ts`, `stats.ts`) — is requireAuth also present, or is `if (!req.auth)` the only gate? |

No confirmed live defect from the resolve-identity pass — the cross-owner boundary is handled
correctly today. The owner-name and permission-word hits are review candidates, not automatic
defects; that is what the rules are for.

## AI triage and the triage store

The rules over-report by design, so every finding gets triaged exactly once instead of re-read on
every run. `pnpm audit:triage` (aimeat/) runs `claude -p` headless (read-only tools, opus by
default, override with `AIMEAT_TRIAGE_MODEL`; binary resolved from `AIMEAT_CLAUDE_BIN`, PATH, or
the newest Claude Code editor extension):

1. **Finding triage** — each unacknowledged ast-grep finding is classified with its surrounding
   code: `legit` (a known-safe pattern, with a one-sentence reason) or `confirm` (a human must
   look). Verdicts land in `triage-store.json` (committed), keyed by a fingerprint of
   rule + file + matched text — so an acknowledgment survives line drift but dies the moment the
   matched code itself changes.
2. **Non-static invariant review** — the git diff since `lastInvariantReviewCommit` is reviewed
   against invariants 5, 13, 14 and 16 (the ones the table below marks as not statically
   checkable). Concerns are stored as open `invariantFindings` and stay in the report until a
   human closes them in the store.

`pnpm audit:report` renders the store: acknowledged findings collapse with their reasons, and only
unacknowledged or human-pending items count as "katsottavaa". A human resolves a `confirm` entry by
fixing the code or editing the entry (`verdict: "legit"`, `decidedBy: "human"`, reason).
`pnpm audit:full` = triage + report.

## Dependencies and secrets in the same report

The report also runs `pnpm audit --json` (known CVEs in the dependency tree; high/critical turn the
verdict orange) and a full-git-history secret scan with gitleaks (`secrets-scan.mjs`: pinned
version, auto-downloaded once into `secaudit/.tools/`, matches always redacted). A finding a human
has reviewed and accepted is suppressed via `gitleaks-baseline.json` next to this file; anything
outside the baseline turns the verdict red.

## Adding an invariant

When a new invariant is found, decide first whether it is a source→sink/structural property or an
ordering/policy one. If the former, add a rule here (ast-grep, and a Semgrep taint version if it needs
to follow values). If the latter, add a guard-tier test and say so in the table above. The rule set is
the machine-checked half; the table is the honest record of what the machine cannot check.
