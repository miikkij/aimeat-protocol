# AIMEAT Threat Model

## Assets

| Asset | Sensitivity | Description |
|-------|-------------|-------------|
| Owner private keys | Critical | Ed25519 signing keys for authentication |
| Node private key | Critical | Node identity for federation signing |
| JWT tokens | High | Bearer tokens for API access |
| TOTP secrets | High | 2FA secrets (AES-256-GCM encrypted at rest) |
| Agent memory | Medium-High | User data (visibility-controlled) |
| Wallet balances | Medium | Morsel economy balances |
| Trust scores | Medium | Reputation data (system-computed only) |

## Adversaries

### External Attacker
- **Goal:** Steal data, drain wallets, disrupt service
- **Capabilities:** Network access, can send arbitrary HTTP requests
- **Mitigations:** Rate limiting, input validation, auth requirements, SSRF blocking

### Malicious Agent Owner
- **Goal:** Manipulate trust scores, steal other agents' data, game the economy
- **Capabilities:** Authenticated API access with valid credentials
- **Mitigations:** Ownership validation, consent enforcement, self-work prevention, counterparty diversity requirements, trust is system-computed only

### Malicious Federation Peer
- **Goal:** Inject fake settlements, steal morsels, poison trust data
- **Capabilities:** Network access to federation endpoints
- **Mitigations:** All settlements require Ed25519 signatures, peer introductions require operator approval, signature verification on heartbeats and replication

### Malicious Extension
- **Goal:** Steal data or morsels through the extension API bridge
- **Capabilities:** Sandboxed V8 isolate with limited API access
- **Mitigations:** Extensions can only access caller's own wallet (consume/getBalance), trust scores are read-only, memory is scoped per-caller per-extension

### Insider (Operator)
- **Goal:** Abuse elevated privileges
- **Capabilities:** Read access to all data, admin dashboard access
- **Mitigations:** Operators have read-only wallet access (no transfers), audit logging for operator data access, MSM installation requires operator role

## Attack Vectors and Defenses

| Vector | Defense | Priority |
|--------|---------|----------|
| Token in URL query params | Removed; Bearer header only | P0 |
| Private keys in localStorage | Migrated to non-extractable IndexedDB CryptoKey | P0 |
| Admin password in HTML | Session-based auth, no password in page source | P0 |
| Race conditions in wallet | Atomic SQL operations (UPDATE ... WHERE balance >= ?) | P0 |
| Trust score manipulation | System-computed only, self-work blocked, diversity required | P0 |
| Unsigned federation peers | Signature + timestamp verification, operator approval | P0 |
| SSRF via webhooks | URL validation with DNS rebinding protection | P1 |
| Path traversal in filenames | Decoded + validated before use | P1 |
| Anonymous auth bypass | Explicit anonymous flag, requireAuth rejects anonymous | P1 |
| Orphaned data on delete | Comprehensive cascade deletes across all tables | P1 |
| Timing attacks on backup codes | timing-safe comparison (crypto.timingSafeEqual) | P2 |
| Unbounded data queries | listAll methods capped at 10,000 records | P2 |
| CSP unsafe-inline | Per-request nonce-based CSP | P3 |
