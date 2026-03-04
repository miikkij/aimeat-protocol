# REQ-001: OpenClaw Integration — Implementation Plan

**Created:** 2026-03-04  
**Source:** `docs/requirements/REQ-001-openclaw-integration.md`  
**Approach:** Documentation-only — zero code changes to AIMEAT's MCP server

---

## Executive Summary

REQ-001 is **primarily a documentation effort**. Analysis of the existing AIMEAT codebase confirms that all backend infrastructure required for OpenClaw integration is already implemented and tested. No changes are needed to MCP transport, tools, auth, or routes. The work is: write docs, create prompts, extend one route, verify compatibility.

---

## Existing Assets — What We Already Have

| Asset | Location | Status | REQ Coverage |
|-------|----------|--------|--------------|
| **MCP server** (StreamableHTTP) | `src/routes/mcp.ts` | ✅ Complete | R-001-02 |
| **18 MCP tools** (14 user + 4 admin) | `src/routes/mcp.ts` | ✅ Complete | R-001-07 |
| **MCP Resources** (memory, storage, wallet) | `src/routes/mcp.ts` | ✅ Complete | — |
| **Initial OTK** (`/v1/auth/initial-otk`) | `src/routes/auth.ts:389–418` | ✅ Complete | R-001-03, R-001-10, R-001-15 |
| **Anonymous mode** (`AIMEAT_ANONYMOUS=true`) | `src/config.ts`, `src/auth/middleware.ts` | ✅ Complete | R-001-04 |
| **Dev mode** (`AIMEAT_DEV_MODE=true`) | `src/config.ts` | ✅ Complete | R-001-05 |
| **OAuth 2.1 flow** | `src/routes/auth.ts` | ✅ Complete | — |
| **Prompts endpoint** (`/v1/prompts/:tier`) | `src/routes/prompts.ts` | ✅ Complete | R-001-13 (extend) |
| **E2E MCP tests** (35+ cases) | `test/e2e-mcp.ts` | ✅ Complete | R-001-14 (reusable for verify) |
| **MCP session lifecycle** | Per-session transport + `mcp-session-id` header | ✅ Complete | R-001-14 |
| **Bearer JWT + query param auth** | `src/auth/middleware.ts` | ✅ Complete | R-001-15 |
| **Inline MCP auth** (clientInfo.gaii) | `src/routes/mcp.ts` | ✅ Complete | — |

**Bottom line:** 100% of MCP server infrastructure is built and tested. The integration is purely a documentation + verification exercise.

---

## Work Breakdown

### Phase 1: Integration Guide (R-001-01 through R-001-08)

**Deliverable:** `docs/integrations/openclaw-setup.md`

| Task | REQ | Effort | Notes |
|------|-----|--------|-------|
| 1.1 Create `docs/integrations/` directory | — | Trivial | New directory |
| 1.2 Write prerequisites section | R-001-01 | Small | OpenClaw install, AIMEAT node running, versions |
| 1.3 Document MCP server URL config | R-001-02 | Small | `http://host:40050/v1/mcp`, StreamableHTTP transport |
| 1.4 Document anonymous quickstart path | R-001-04 | Small | `AIMEAT_ANONYMOUS=true`, zero-auth config |
| 1.5 Document Initial OTK auth flow | R-001-03 | Medium | Generate OTK → embed in config → agent uses on connect |
| 1.6 Document dev mode config | R-001-05 | Small | `AIMEAT_DEV_MODE=true`, caveats (doesn't bypass MCP auth) |
| 1.7 Provide OpenClaw MCP config snippet | R-001-06 | Small | YAML/JSON block for OpenClaw `mcp_servers` config |
| 1.8 Create MCP tools reference table | R-001-07 | Medium | All 18 tools with descriptions + use cases, already catalogued |
| 1.9 Write 3+ worked examples | R-001-08 | Medium | Memory read/write, board post, work request lifecycle |

**What exists to leverage:**
- Tool names, params, descriptions are all in `mcp.ts` — extract directly
- Auth flow is documented in `auth.ts` — Initial OTK response shape known
- Anonymous mode config is in `config.ts` — exact env var known
- E2E test `test/e2e-mcp.ts` provides working request/response examples

**Estimated total:** ~1 day

---

### Phase 2: Starter Prompts (R-001-09 through R-001-13)

**Deliverables:**
- `docs/init-prompts/openclaw-aimeat-agent.md` — system prompt document
- New tier in `/v1/prompts/openclaw` — API-served prompt

| Task | REQ | Effort | Notes |
|------|-----|--------|-------|
| 2.1 Create `docs/init-prompts/` directory | — | Trivial | New directory |
| 2.2 Write OpenClaw system prompt | R-001-09 | Medium | Agent persona + AIMEAT instructions |
| 2.3 Include auth instructions in prompt | R-001-10 | Small | OTK flow + anonymous fallback |
| 2.4 Include structured key conventions | R-001-11 | Small | `profile.*`, `context.*`, `handoff.*` patterns |
| 2.5 Include cache-first directive | R-001-12 | Small | "Check memory before external lookups" |
| 2.6 Add `openclaw` tier to prompts route | R-001-13 | Small | Extend `switch(tier)` in `src/routes/prompts.ts` |

**What exists to leverage:**
- `/v1/prompts/anonymous` already contains a full system prompt template with boot sequence, memory conventions, key patterns — directly reusable as base
- Tier 1 prompt has economics, trust score references — can adapt
- The `prompts.ts` switch/case structure makes adding a new tier trivial (add one `case 'openclaw':` block)

**Code change required:** Only `src/routes/prompts.ts` — add ~30-line case block for `openclaw` tier. This is the **only code modification** in the entire REQ.

**Estimated total:** ~0.5 day

---

### Phase 3: Compatibility Testing (R-001-14 through R-001-17)

| Task | REQ | Effort | Notes |
|------|-----|--------|-------|
| 3.1 Verify StreamableHTTP with OpenClaw MCP client | R-001-14 | Medium | Manual test: install OpenClaw, configure AIMEAT MCP URL, run tool call |
| 3.2 Verify Initial OTK auth end-to-end | R-001-15 | Small | Generate OTK, embed in OpenClaw config, confirm tool calls authenticate |
| 3.3 Verify concurrent tool calls | R-001-16 | Medium | OpenClaw parallel tool invocation → check no race conditions |
| 3.4 Document version requirements | R-001-17 | Small | Record OpenClaw version tested, any MCP SDK version constraints |

**What exists to leverage:**
- `test/e2e-mcp.ts` already validates the full tool lifecycle — can be used as baseline
- MCP session management (`Map<sessionId, transport>`) already handles concurrency
- The test harness creates owner + agent, generates tokens, runs all tools — reuse this flow to compare with OpenClaw client behavior

**Approach:**
- Primary: Manual smoke test with actual OpenClaw client
- Secondary: Adapt E2E test patterns if automated OpenClaw testing is needed
- Document results in `docs/integrations/openclaw-compatibility.md`

**Estimated total:** ~1 day (depends on OpenClaw setup complexity)

---

### Phase 4: LM Studio Integration (R-001-18 through R-001-20) — OPTIONAL

**Deliverable:** `docs/integrations/lm-studio-setup.md`

| Task | REQ | Effort | Notes |
|------|-----|--------|-------|
| 4.1 Write LM Studio + MCP plugin setup guide | R-001-18 | Medium | LM Studio MCP plugin config → AIMEAT URL |
| 4.2 Document local-only topology | R-001-19 | Small | Both on localhost, no network exposure |
| 4.3 Create LM Studio system prompt template | R-001-20 | Small | Adapt from OpenClaw prompt with LM Studio specifics |

**What exists to leverage:**
- Same MCP server, same tools, same auth — only client config differs
- Prompt templates from Phase 2 are 90% reusable

**Estimated total:** ~0.5 day

---

## Summary: Code Changes Required

| File | Change | Size |
|------|--------|------|
| `src/routes/prompts.ts` | Add `case 'openclaw':` with system prompt | ~30 lines |

**Total code changes: 1 file, ~30 lines.** Everything else is documentation.

---

## Deliverables Checklist

| # | Deliverable | Type | Status |
|---|-------------|------|--------|
| D1 | `docs/integrations/openclaw-setup.md` | Doc | Not started |
| D2 | `docs/init-prompts/openclaw-aimeat-agent.md` | Doc | Not started |
| D3 | `openclaw` tier in `src/routes/prompts.ts` | Code | Not started |
| D4 | `docs/integrations/openclaw-compatibility.md` | Doc | Not started |
| D5 | `docs/integrations/lm-studio-setup.md` | Doc (optional) | Not started |

---

## Requirement Traceability Matrix

| REQ ID | Requirement | Approach | Existing Asset | New Work |
|--------|-------------|----------|----------------|----------|
| R-001-01 | Step-by-step guide | Write doc D1 | — | `openclaw-setup.md` |
| R-001-02 | MCP URL configuration | Document in D1 | MCP at `/v1/mcp` | Config snippet |
| R-001-03 | Initial OTK usage | Document in D1 | `/v1/auth/initial-otk` fully working | Doc section |
| R-001-04 | Anonymous quickstart | Document in D1 | `AIMEAT_ANONYMOUS=true` fully working | Doc section |
| R-001-05 | Dev mode doc | Document in D1 | `AIMEAT_DEV_MODE=true` working | Doc section |
| R-001-06 | Config snippet | Include in D1 | — | YAML/JSON example |
| R-001-07 | 18 tools reference | Include in D1 | All tools in `mcp.ts` | Extract + format |
| R-001-08 | 3+ worked examples | Include in D1 | E2E test examples | Adapt to tutorial style |
| R-001-09 | System prompt | Write doc D2 | `/v1/prompts/anonymous` template | Adapt for OpenClaw |
| R-001-10 | Auth in prompt | Include in D2 | OTK + anon flows | Prompt instructions |
| R-001-11 | Structured keys in prompt | Include in D2 | Key patterns in anonymous prompt | Reuse |
| R-001-12 | Cache-first directive | Include in D2 | — | Prompt clause |
| R-001-13 | `/v1/prompts/openclaw` | Extend D3 | `prompts.ts` switch/case | ~30 lines |
| R-001-14 | StreamableHTTP verify | Manual test → D4 | E2E MCP tests pass | Verify with OpenClaw client |
| R-001-15 | Initial OTK verify | Manual test → D4 | OTK tested in E2E | Verify from OpenClaw |
| R-001-16 | Concurrency verify | Manual test → D4 | Session map handles isolation | Verify parallel calls |
| R-001-17 | Version requirements | Document in D4 | — | Record during testing |
| R-001-18 | LM Studio guide | Write doc D5 | Same MCP server | Adapt from D1 |
| R-001-19 | Local-only setup | Include in D5 | — | Topology doc |
| R-001-20 | LM Studio prompt | Include in D5 | D2 template | Adapt |

---

## Recommended Execution Order

1. **Phase 2 first** — Write the system prompt (D2). This forces you to articulate exactly how OpenClaw should use AIMEAT, which then informs D1.
2. **Phase 1** — Write the integration guide (D1) using the prompt as the "what an agent does" reference.
3. **Phase 2 (code)** — Add the `openclaw` tier to `prompts.ts` (D3) — trivial after D2 is written.
4. **Phase 3** — Compatibility testing (D4) — requires OpenClaw installed.
5. **Phase 4** — LM Studio guide (D5) — optional, adapts from D1/D2.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| OpenClaw MCP client uses different StreamableHTTP semantics | Low | High | Our MCP server uses standard `@modelcontextprotocol/sdk` — should be compatible. E2E tests prove protocol compliance. |
| OpenClaw config format changes between versions | Medium | Low | Document specific version tested; provide generic MCP config pattern |
| Initial OTK not intuitive for OpenClaw users | Low | Medium | Provide anonymous mode as zero-config fallback |
| AIMEAT MCP session isolation issues under concurrent OpenClaw calls | Low | Medium | Already handled — each session gets own transport instance + session ID |

---

## Success Criteria Verification

| Criterion | How We Verify |
|-----------|---------------|
| New user: git clone + aimeat init → working agent in 15 min | Follow own guide end-to-end; time it |
| Zero code changes to MCP server | Only `prompts.ts` changes (prompt serving, not MCP protocol) |
| 3+ end-to-end examples demonstrate real value | D1 includes memory workflow, board interaction, work lifecycle |

---

*Plan generated: 2026-03-04*
