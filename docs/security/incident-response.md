# AIMEAT Incident Response Plan

## Severity Levels

| Level | Description | Response Time | Examples |
|-------|-------------|---------------|----------|
| P0 | Active exploitation, data breach | Immediate | Key compromise, unauthorized data access |
| P1 | Vulnerability with no known exploitation | 24 hours | Auth bypass, SSRF, injection |
| P2 | Security weakness, defense-in-depth gap | 1 week | Missing rate limit, weak validation |
| P3 | Hardening improvement | 1 month | Header misconfiguration, logging gap |

## Response Steps

### 1. Detection
- Monitor rate limit hits (`rate_limit_hits_total` metric)
- Monitor auth failures (`auth_failures_total` metric): it counts every 401 the node answers, a wrong password at sign-in included. The sign-in tarpit's own counters (`login_tarpit_delayed_total`, `login_tarpit_blocked_total`) show password guessing slowed down or stopped
- Review admin dashboard for unusual patterns
- Read the refusal log: the Security page, `GET /v1/admin/auth-refusals`, or the file `data/auth-failures.log`. It has one line for every 401 and 403, whichever route answered it, with the code the caller received: `ACCESS_DENIED`, `FORBIDDEN` or `CROSS_OWNER_FORBIDDEN` for a refused owner, `SCOPE_DENIED` for a missing permission, `AUTH_REQUIRED`, `INVALID_TOKEN` or `CREDENTIAL_REFUSED` for a refused credential, and `INVALID_CODE` (status 400) for a wrong password reset code. An MCP tool's refusal is a tool answer, not an HTTP status: it shows on the agent's card as a refusal to grant
- Search the node log for `[mcp-fault]` (an MCP tool that failed inside the node) and `[500]` (a REST request that failed inside the node). Each line carries the request id the caller was shown
- Read the account events of an affected account: a password reset or change (`password_changed`), a reused sign-in token (`session_token_reused`), and an operator's act in the account (`operator_acted`) are recorded there. An operator's setting change is a usage row `config.set` in that operator's own calls (`GET /v1/admin/usage/calls?surface=operator`)

### 2. Containment
- **Compromised owner account:** The owner key signs no one in since 4.0.0. The operator disables the account (`aimeat_admin_owner_*`), resets its two-step sign-in, and revokes its sessions (`DELETE /v1/auth/sessions` as the owner, or the admin routes)
- **Compromised node key:** Rotate node keys, re-establish federation peer connections
- **Compromised JWT:** Revoke via `POST /v1/auth/revoke`, the authenticated owner's human sessions via `DELETE /v1/auth/sessions`. Revoke agent and ecosystem credentials through their own management routes
- **Malicious federation peer:** Emergency de-peer via `DELETE /v1/federation/peers/:nodeId?emergency=true`
- **Malicious extension:** Disable the extension via admin API

### 3. Eradication
- Identify root cause (logs, audit trail)
- Apply security patch
- Run `aimeat validate` to check configuration
- Run security E2E tests (`pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=security`)

### 4. Recovery
- Re-enable affected services
- Notify affected users if data was accessed
- Generate GDPR export for affected users if needed

### 5. Post-Incident
- Document incident timeline
- Update threat model if new vector discovered
- Add regression test to `test/e2e-security.ts`
- Review and update this document

## Key Commands

```bash
# Revoke the authenticated owner's human sessions, including the current session
curl -X DELETE https://node/v1/auth/sessions -H "Authorization: Bearer $OWNER_JWT"

# Emergency de-peer
curl -X DELETE "https://node/v1/federation/peers/malicious-node?emergency=true" -H "Authorization: Bearer $OPERATOR_JWT"

# Check for security audit issues
pnpm audit

# Run security tests
pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=security

# Validate environment
aimeat validate
```
