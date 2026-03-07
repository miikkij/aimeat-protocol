# 08 — Testing Coverage & Compliance

## 8.1 Missing Security Tests

**Files:** `test/e2e-full.ts`

The E2E test suite has 35 tests across 6 phases + GDPR, but **no security-focused tests**:

| Missing Test | Why It Matters |
|-------------|----------------|
| Authorization bypass (agent A reads agent B's memory) | IDOR is the most critical finding |
| CSRF attack simulation | State-changing endpoints may be vulnerable |
| Rate limit enforcement (actual burst test) | Current test only checks header presence |
| Consent enforcement | Consent may be logged but not enforced |
| Scope restriction (scoped agent denied unauthorized operations) | Operator bypass known |
| Extension code execution safety | RCE risk |
| SSRF prevention in federation | Internal network scanning |
| User enumeration via 404 messages | Information disclosure |
| Negative balance / double-spending | Economic system integrity |
| GDPR export completeness | All user data types must be included |
| Cascade delete completeness | Orphaned data after deletion |
| Path traversal in apps endpoint | File inclusion vulnerability |
| Token revocation persistence | Revoked tokens re-accepted after restart |
| Anonymous mode boundary testing | What anonymous users can and cannot access |
| Self-rating prevention | Trust score manipulation |

**Existing security-adjacent tests:**
- Rate limiting headers (lines 861-887) — only checks headers exist, not enforcement
- GDPR export (lines 1643-1657) — only checks `exported_at` field, not completeness
- Scoped agent permissions (lines 1448-1558) — tests some denial paths, not all

---

## 8.2 GDPR Compliance Gaps

### Data Export Incompleteness

**Files:** `openapi.yaml:2603-2643`

GET `/v1/owners/{owner}/export` exists but unclear if comprehensive:

| Data Type | Exported? | Concern |
|-----------|-----------|---------|
| Agents | Likely | Not verified |
| Memory | Likely | Not verified |
| Transactions | Likely | Not verified |
| Board posts | Unknown | Posts by user on other boards? |
| Consents | Likely | Audit trail included? |
| Flags (against user) | Unknown | Flags on user's content? |
| Flags (by user) | Unknown | User's flagging history? |
| Matches | Unknown | Who was matched with user? |
| Organisms/memberships | Unknown | Group membership data? |
| Work history | Unknown | Full work contracts? |
| Disputes | Unknown | Dispute outcomes? |
| Personal node data | Unknown | Mailbox, files? |
| TOTP configuration | Unknown | 2FA status? |

**GDPR Art. 20 — Right to Data Portability:** Requires export of all personal data in machine-readable format. Current implementation may not include all data types.

**Recommendation:** Audit export endpoint against complete data model. Add per-type export verification tests.

### Cascade Delete Incompleteness

**Files:** `src/storage/providers/sqlite/index.ts`

DELETE `/v1/owners/{owner}` only deletes the owner record. See section 03.4 for complete list of missing cascades.

**GDPR Art. 17 — Right to Erasure:** Requires deletion of ALL personal data. Current cascade is incomplete.

**Recommendation:** Implement complete cascade delete. Add E2E test that verifies every data type is deleted. Consider soft-delete with delayed hard-delete for audit requirements.

### Consent Record Retention

Consent audit logs are created but no retention policy is documented:
- How long are audit logs kept?
- Are audit logs included in data export?
- Are audit logs deleted during GDPR erasure?

**Recommendation:** Document retention policy. Include audit logs in export. Delete audit logs during erasure (or anonymize).

---

## 8.3 Dependency Security

**Files:** `package.json`

| Dependency | Version | Status | Note |
|-----------|---------|--------|------|
| express | 5.2.1 | Current | Latest major version |
| typescript | 5.9.3 | Current | |
| @noble/ed25519 | 3.0.0 | Current | Audited library |
| @noble/hashes | 2.0.1 | Current | Audited library |
| jose | 6.1.3 | Current | JWT library by Panva |
| better-sqlite3 | 12.6.2 | Current | Native module |
| ws | 8.19.0 | Current | WebSocket |
| nodemailer | 8.0.1 | Current | |
| isolated-vm | 6.0.2 | Current | V8 sandbox — check for escape CVEs |
| @modelcontextprotocol/sdk | 1.27.1 | Current | New library — monitor |
| prom-client | 15.1.3 | Current | |

**No automated dependency scanning** found in CI/CD configuration.

**Recommendation:**
- Add `pnpm audit` to CI pipeline
- Consider Snyk or Dependabot for automated vulnerability scanning
- Pin dependency versions for reproducible builds
- Review `isolated-vm` security advisories regularly

---

## 8.4 Missing Security Documentation

| Document | Status | Need |
|----------|--------|------|
| Security architecture overview | Missing | How auth/authz/consent layers interact |
| Threat model | Missing | Documented adversaries and attack vectors |
| Incident response plan | Missing | What to do when compromise detected |
| Deployment security checklist | Missing | Required configs for production |
| API security guidelines | Missing | For third-party developers |
| Data classification | Missing | What data is sensitive, PII, public |
| Key management procedures | Missing | Key rotation, compromise recovery |
| Federation security model | Missing | Peer trust levels, verification |

**Recommendation:** Create these documents as part of the security remediation effort. Start with the deployment security checklist since it has immediate production impact.

---

## 8.5 Production Deployment Checklist (Recommended)

Based on audit findings, a production deployment should verify:

```
[ ] AIMEAT_STORAGE is NOT 'memory' (use sqlite file or mongodb)
[ ] AIMEAT_DEV_MODE=false
[ ] AIMEAT_ANONYMOUS=false (unless intentionally public)
[ ] AIMEAT_ADMIN_PASSWORD is strong (12+ chars, random)
[ ] AIMEAT_TOTP_ENCRYPTION_KEY is set
[ ] AIMEAT_BASE_URL uses HTTPS
[ ] Node key file (~/.aimeat/node-key.json) has 0600 permissions
[ ] .env file is NOT committed to version control
[ ] Reverse proxy configured with trust proxy setting
[ ] Rate limits configured for deployment scale
[ ] HSTS header enabled
[ ] Log rotation configured
[ ] Backup strategy for database
[ ] Monitoring/alerting for 500 errors and rate limit hits
[ ] Federation peers manually approved (no auto-approve)
[ ] Extension installation requires explicit operator action
```
