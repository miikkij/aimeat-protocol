---
paths:
  - "**/aimeat/src/{routes,auth,services,storage,mcp,middleware,utils,commerce,server-bootstrap,cli}/**"
  - "**/aimeat/src/config.ts"
  - "**/aimeat/.env.example"
---

<!-- Moved verbatim from CLAUDE.md on 2026-09-13. It loads when Claude reads a file matching `paths`, not at session start. -->

## Identity in code

**Every route that stores or retrieves by identity uses `resolveIdentity(req.auth!, config.nodeId)`** from `src/utils/gaii.ts`, never raw `req.auth!.sub`. Owner sessions turn the bare name into a GHII; agent and ecosystem sessions return `sub` as-is. Skip it and owner data lands under bare `alice`, invisible to list, search and update. Compare ownership against the resolved identity.

**A session from another node is a visitor, decided where the token is read.** `verifyJWT()` gives it role `federated` and its home GHII (`alice@home-node`) as `sub` and `owner`, so no door can take it for the local account sharing its local part. Ask `isForeignPrincipal(auth)`, never `auth.federated` inline; shorten an identity to an account name with `localAccountName()` (a lookup) or `localAccountOf()` (a decision), never `split('@')[0]`, which turns a visitor back into the local namesake; `pnpm check:identity-shortening` refuses a new cut. Ruled 2026-09-24 after the September audit found the door-by-door fixes and the four gates still leaving doors that decided on the role or the name alone. → `docs/coding-guidelines/identity-model.md`

Key files: `src/utils/gaii.ts`, `src/routes/ghii.ts`, `src/routes/agents.ts`, `src/auth/middleware.ts`, `src/routes/libs.ts`.

## Gates for this area

- **The owner sees everything their own agents hold.** A person's agents and apps act in their name, in their account, on permissions they granted and can pull, so a file or a record one of them stored is that person's own and `authorizeRead` lets the owner GHII read it. ONE DIRECTION, and the asymmetry is the point: an agent reading its OWNER's private data still goes through the ordinary visibility and consent checks, because a scoped agent must not ride the human's ownership. Ruled 2026-09-08, after an exact-identity match had hidden a person's own attachment from them and answered 403 on a file their own agent had sent in their name.
- **Six rules the August 2026 audit had to be written to discover.** Full text and the evidence for each: `docs/coding-guidelines/security-development-dna.md` invariants 11 to 16.
  - **The owner name is not a principal.** `req.auth!.owner` carries the human's name on app grants, ecosystem apps, agent JWTs and PATs alike, so `owner !== name` refuses a different PERSON and admits everything acting in this person's name. Naming the principal is the check. A change to the account itself goes behind `requireOwnerPrincipal()`, and `requireRole('owner')` is not that test.
  - **A role is granted, never inherited at mint time.** One mint copied the owner's roles onto the agent's token, and two calls then turned a scope-limited agent into an unscoped operator credential. When you add a mint, diff its role list against the other mints.
  - **A gate reads the normalized value, never the raw request.** A webhook allowlist read `body.source.type` while the builder defaulted a missing type to the same value, so omitting the field skipped the gate and built the record it would have refused. Same shape as an origin marker taken from a request header.
  - **Refuse before you write.** Three defects, one shape: bytes written before the name was claimed, a paywall standing down before comparing the coordinate, a response sent before the work it announced. Read the ORDER, not just the presence of the check.
  - **A permission word is enforced on every door or it does not exist.** `organism:write` deletes the tool from an agent's MCP surface and is bypassed on the HTTP route, so an owner was told they controlled something they did not.
  - **Deprecated is not removed.** Deprecating names the flag, the default and the removal version. Three Tier 0.5 write paths were marked deprecated in the RFC, behind no flag, live on every node.
- **Security**, on any change to `src/routes/`, `src/auth/`, `src/services/`, `src/storage/`, federation, extensions or an AI path: authorize against `resolveIdentity(req.auth!, …)` and never a client-supplied id; keep server-trusted config and secrets out of principal-writable namespaces; route non-constant outbound HTTP through `safeFetch`; gate every mutation with `requireScope`/`requireRole`; verify federation Ed25519 signatures unconditionally. Anything whose safe value differs between localhost and the public internet goes in `.env.example` with a safe public default and a documented local override. Identity-touching features ship with cross-owner and cross-scope "→403" tests. → `docs/coding-guidelines/security-development-dna.md`
