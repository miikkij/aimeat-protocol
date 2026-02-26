# T-2: MCP Tool + OAuth E2E Tests

**Gap:** No tests for MCP Streamable HTTP transport or OAuth flow. MCP integration is untested.

**Priority:** Medium

**File:** `test/e2e-mcp.ts`

## Scope

Test the full MCP lifecycle: OAuth 2.1 dynamic client registration → authorization → token exchange → MCP session initialization → tool invocation → resource read → resource subscriptions → session close.

## Prerequisites

- Server running on `:40251`
- Registered owner + agent with keypair (created during test setup)

## Test Phases

### Phase 1 — OAuth 2.1 Discovery & Registration

| # | Test | Method | Endpoint | Assert |
|---|------|--------|----------|--------|
| 1 | OAuth metadata discovery | GET | `/.well-known/oauth-authorization-server` | 200, contains `authorization_endpoint`, `token_endpoint`, `registration_endpoint` |
| 2 | Dynamic client registration | POST | `/v1/mcp/register` | 201, returns `client_id` + `client_secret` |
| 3 | Register without client_name | POST | `/v1/mcp/register` | 400 |

### Phase 2 — OAuth Authorization Flow

| # | Test | Method | Endpoint | Assert |
|---|------|--------|----------|--------|
| 4 | Request auth code (with signature) | GET | `/v1/mcp/authorize?response_type=code&client_id=...&gaii=...&signature=...&timestamp=...` | 200, returns `code` |
| 5 | Auth without signature | GET | `/v1/mcp/authorize?response_type=code&client_id=...` | 400, requires gaii/signature/timestamp |
| 6 | Auth with invalid signature | GET | `/v1/mcp/authorize?...&signature=bad` | 401 |
| 7 | Auth with unknown client_id | GET | `/v1/mcp/authorize?client_id=unknown` | 400 |
| 8 | Unsupported response_type | GET | `/v1/mcp/authorize?response_type=token` | 400 |

### Phase 3 — Token Exchange

| # | Test | Method | Endpoint | Assert |
|---|------|--------|----------|--------|
| 9 | Exchange auth code for tokens | POST | `/v1/mcp/token` | 200, returns `access_token` + `refresh_token` |
| 10 | Code is single-use | POST | `/v1/mcp/token` (same code) | 400, `invalid_grant` |
| 11 | Refresh token exchange | POST | `/v1/mcp/token` | `grant_type=refresh_token` → new access + refresh tokens |
| 12 | Refresh with wrong client | POST | `/v1/mcp/token` | 400, `invalid_grant` |
| 13 | Token revocation | POST | `/v1/mcp/token/revoke` | 200, `{ revoked: true }` |
| 14 | Revoke already-revoked token | POST | `/v1/mcp/token/revoke` | 200 (RFC 7009: always 200) |

### Phase 4 — MCP Session Lifecycle

| # | Test | Method | Endpoint | Assert |
|---|------|--------|----------|--------|
| 15 | Initialize MCP session | POST | `/v1/mcp` | JSON-RPC `initialize` → 200, returns capabilities + `mcp-session-id` header |
| 16 | List tools | POST | `/v1/mcp` | `tools/list` → returns all 14 MEAT tools |
| 17 | List resources | POST | `/v1/mcp` | `resources/list` → lists memory/storage/wallet resources |

### Phase 5 — MCP Tool Invocation

| # | Test | Tool | Assert |
|---|------|------|--------|
| 18 | `meat_memory_write` | Write key via MCP | `{ written: true }` |
| 19 | `meat_memory_read` | Read back | Value matches |
| 20 | `meat_memory_list` | List entries | Contains written key |
| 21 | `meat_catalogue_search` | Search actions | Returns array |
| 22 | `meat_wallet_balance` | Check balance | Returns `{ balance, in_escrow, available }` |
| 23 | `meat_agent_profile` | Get agent | Returns agent info |
| 24 | `meat_board_read` | Read board | Returns posts array |

### Phase 6 — MCP Resource Read

| # | Test | Method | Endpoint | Assert |
|---|------|--------|----------|--------|
| 25 | Read memory resource | POST | `/v1/mcp` | `resources/read` with `meat://memory/{key}` → returns value |
| 26 | Read wallet resource | POST | `/v1/mcp` | `resources/read` with `meat://wallet/{gaii}` → returns balance |
| 27 | Read non-existent resource | POST | `/v1/mcp` | 'Not found' text |

### Phase 7 — SSE & Resource Subscriptions

| # | Test | Method | Endpoint | Assert |
|---|------|--------|----------|--------|
| 28 | Open SSE stream | GET | `/v1/mcp` (with `mcp-session-id`) | 200, SSE connection established |
| 29 | Write memory → receive notification | POST (tool) + GET (SSE) | `/v1/mcp` | SSE receives `notifications/resources/updated` with `meat://memory/...` URI |
| 30 | SSE without session ID | GET | `/v1/mcp` | 400 |

### Phase 8 — Session Close

| # | Test | Method | Endpoint | Assert |
|---|------|--------|----------|--------|
| 31 | Close MCP session | DELETE | `/v1/mcp` | 200, `{ closed: true }` |
| 32 | Request on closed session | POST | `/v1/mcp` (old session-id) | New session or error |

## Implementation Notes

- MCP JSON-RPC requests follow the format: `{ jsonrpc: "2.0", id: 1, method: "...", params: {} }`
- Session ID is returned in `mcp-session-id` response header after `initialize`
- SSE test (Phase 7) requires either `EventSource` or manual chunked response parsing
- All tool calls use the MCP session's Bearer token from Phase 3

## Cleanup

Cascade-delete test owners.
