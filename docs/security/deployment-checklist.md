# AIMEAT Security Deployment Checklist

## Pre-Deployment

- [ ] Set `AIMEAT_DEV_MODE=false` (never enable in production)
- [ ] Set `AIMEAT_STORAGE=postgres-kysely` or `AIMEAT_STORAGE=sqlite` (never use `memory` in production)
- [ ] Set a strong `AIMEAT_ADMIN_PASSWORD` (minimum 8 chars, mixed case + numbers)
- [ ] Set `AIMEAT_BASE_URL` to your HTTPS URL
- [ ] Set `AIMEAT_ENCRYPTION_KEY` for stored secrets and the separate `AIMEAT_TOTP_ENCRYPTION_KEY` where required; follow `.env.example` for their formats
- [ ] Set and verify the public security profile for a public deployment
- [ ] Confirm app-origin isolation, wildcard DNS and TLS for hosted apps
- [ ] Set `AIMEAT_KEY_PASSPHRASE` to encrypt node keys at rest
- [ ] Run `pnpm audit` to check for known vulnerabilities
- [ ] Run `pnpm typecheck` and build the version you intend to deploy
- [ ] Run `aimeat validate` to check environment configuration

## Network Security

- [ ] Deploy behind a reverse proxy (nginx, Caddy, etc.)
- [ ] Enable HTTPS/TLS termination at the proxy
- [ ] Set `AIMEAT_TRUST_PROXY` for the actual proxy path. Prefer a hop count or trusted subnet; unrestricted `true` requires an upstream that overwrites forwarded headers.
- [ ] Restrict direct access to port 40050 (only allow proxy)
- [ ] Configure firewall rules to block inbound connections except via proxy

## Authentication

- [ ] First registered owner automatically gets `operator` role
- [ ] Private keys are shown only once during registration - store securely
- [ ] Enable TOTP for operator accounts
- [ ] Set `AIMEAT_JWT_TTL` to appropriate value (default: 3600s)
- [ ] Token revocation persists across restarts (requires sqlite/postgres-kysely)

## Federation

- [ ] Peer introductions require operator approval (no auto-approve)
- [ ] All peer introductions must be signed with Ed25519
- [ ] All settlements must be signed
- [ ] Review `AIMEAT_DEPEERING_GRACE_HOURS` setting
- [ ] SSRF protection blocks all outbound requests to private/reserved IPs

## Rate Limiting

- [ ] Global rate limit is configured (`AIMEAT_RL_GLOBAL`, default 300 requests per second before role multipliers)
- [ ] Critical endpoints have dedicated stricter limits
- [ ] Monitor `rate_limit_hits_total` metric for abuse detection

## Data Protection

- [ ] GDPR export endpoint (`GET /v1/owners/:name/export`) is functional
- [ ] GDPR delete endpoint (`DELETE /v1/owners/:name`) cascades properly
- [ ] Consent enforcement is enabled (`AIMEAT_CONSENT_ENABLED=true`)
- [ ] Memory and storage quotas are configured appropriately

## Monitoring

- [ ] Log level set to `info` or `warn` in production (not `debug`)
- [ ] Sensitive fields are masked in logs (token, password, private_key, etc.)
- [ ] Monitor admin dashboard for unusual activity
- [ ] Set up alerts for repeated auth failures
