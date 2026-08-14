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
- Monitor auth failures (`auth_failures_total` metric)
- Review admin dashboard for unusual patterns
- Check logs for OWNERSHIP_VIOLATION errors

### 2. Containment
- **Compromised owner key:** Operator uses `POST /v1/owners/:name/recover` to regenerate keys
- **Compromised node key:** Rotate node keys, re-establish federation peer connections
- **Compromised JWT:** Revoke via `POST /v1/auth/revoke`, all sessions via `DELETE /v1/auth/sessions`
- **Malicious federation peer:** Emergency de-peer via `DELETE /v1/federation/peer/:nodeId?emergency=true`
- **Malicious extension:** Disable the extension via admin API

### 3. Eradication
- Identify root cause (logs, audit trail)
- Apply security patch
- Run `aimeat validate` to check configuration
- Run security E2E tests (`npx tsx test/e2e-security.ts`)

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
# Revoke all sessions for an owner
curl -X DELETE https://node/v1/auth/sessions -H "Authorization: Bearer $OPERATOR_JWT"

# Emergency de-peer
curl -X DELETE "https://node/v1/federation/peer/malicious-node?emergency=true" -H "Authorization: Bearer $OPERATOR_JWT"

# Check for security audit issues
pnpm audit

# Run security tests
npx tsx test/e2e-security.ts

# Validate environment
node --import tsx src/index.ts validate
```
