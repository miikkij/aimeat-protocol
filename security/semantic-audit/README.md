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
  across functions). Stronger for the resolve-identity check; run it on a Linux runner when you want
  the deeper pass. Not wired into CI yet.

CI runs the ast-grep rules and uploads the SARIF to GitHub code scanning, so every finding is a
tracked alert on the Security tab with a history — see `.github/workflows/semantic-audit.yml`.

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
| 11 — the owner name is not a principal | ast-grep rule (review-level) | `owner-name-is-not-a-principal` |
| 15 — a permission word is enforced on every door | ast-grep rule | `permission-word-on-every-door` |
| 12 — a role is granted, never inherited at mint | guard tier + mint-list diff | `e2e-account-security-gate`; review when adding a mint |
| 13 — a gate reads the normalized value | partial / review | header-and-body-as-authz is too broad to gate cleanly; caught by review and the origin-marker tests |
| 14 — refuse before you write | NOT static | an ordering property (write-before-check); covered by tests and code review, not a rule |
| 16 — deprecated is not removed | NOT static | a policy property (a deprecation must name flag+default+version); covered by review |

### The three rules that exist

- **resolve-identity** — `req.auth!.sub` reaching a `storage.*` call without being resolved. On an
  owner session `sub` is the bare owner name, so owner data lands under the wrong key. Sanitizers:
  `resolveIdentity(...)`, inline GHII construction, and the attribution fields that legitimately hold
  a raw principal id.
- **owner-name-is-not-a-principal** — the `owner !== name && !roles.includes('operator')` widening.
  A review prompt: if the guarded door changes the ACCOUNT itself, it needs `requireOwnerPrincipal()`.
- **permission-word-on-every-door** — `requireRoleOrScope('agent', <scope>)`, where the agent role is
  admitted before the scope, so the scope word is decorative on that door.

### Proof-of-concept result (2026-08-21)

First run over `src/routes`: 19 findings across the three rules.

| Rule | Findings | After triage |
|---|---|---|
| resolve-identity | 12 | 0 real — all agent-session branches, attribution fields, or inline GHII construction |
| owner-name-is-not-a-principal | 3 | 2 to confirm (`owners.ts`, `owners/export.ts`), 1 legitimate (instance ownership) |
| permission-word-on-every-door | 4 | 4 to confirm (`organism:invite` doors) |

No confirmed live defect from the resolve-identity pass — the cross-owner boundary is handled
correctly today. The owner-name and permission-word hits are review candidates, not automatic
defects; that is what the rules are for.

## Adding an invariant

When a new invariant is found, decide first whether it is a source→sink/structural property or an
ordering/policy one. If the former, add a rule here (ast-grep, and a Semgrep taint version if it needs
to follow values). If the latter, add a guard-tier test and say so in the table above. The rule set is
the machine-checked half; the table is the honest record of what the machine cannot check.
