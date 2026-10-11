# AIMEAT Security Deployment Checklist

## Pre-Deployment

- [ ] Set `AIMEAT_DEV_MODE=false` (never enable in production)
- [ ] Set `AIMEAT_STORAGE=postgres-kysely` or `AIMEAT_STORAGE=sqlite` (never use `memory` in production)
- [ ] Set a strong `AIMEAT_ADMIN_PASSWORD`, or leave it unset and the node generates a random one at start. The node itself checks no strength rule: `aimeat init` asks for at least 8 characters, and anything longer and random is better
- [ ] Set `AIMEAT_BASE_URL` to your HTTPS URL
- [ ] Set `AIMEAT_ENCRYPTION_KEY` for stored secrets and the separate `AIMEAT_TOTP_ENCRYPTION_KEY` where required; follow `.env.example` for their formats
- [ ] Set `AIMEAT_SECURITY_PROFILE=public` for a public deployment (otherwise the node infers `local` or `public` from the base URL host and node type), and read the startup self-check's warnings
- [ ] Confirm app-origin isolation, wildcard DNS and TLS for hosted apps
- [ ] Set `AIMEAT_KEY_PASSPHRASE` to encrypt node keys at rest
- [ ] Run `pnpm audit` to check for known vulnerabilities
- [ ] Run `pnpm typecheck` and build the version you intend to deploy
- [ ] Run `aimeat validate` to check environment configuration

## Updating a Running Node

- [ ] Stop the node, install the new version, start it. That is the whole update: every database change the version brings runs by itself at start, and the node starts whatever its data holds. There is no script to run by hand before or after.
- [ ] After the start, open the admin Security page (or ask an agent with `aimeat_admin_security_overview`). A change that cannot place some data on evidence leaves that data as it is and opens one incident there. For the move of older records to each person's full identity, the incident lists each username whose records are older than the account that holds it now: decide each one on the page, or with `aimeat_admin_incident_resolve` and a `name` and a `resolution`.

## Network Security

- [ ] Deploy behind a reverse proxy (nginx, Caddy, etc.)
- [ ] Enable HTTPS/TLS termination at the proxy
- [ ] Set `AIMEAT_TRUST_PROXY` for the actual proxy path. Prefer a hop count or trusted subnet; unrestricted `true` requires an upstream that overwrites forwarded headers.
- [ ] Restrict direct access to port 40050 (only allow proxy)
- [ ] Configure firewall rules to block inbound connections except via proxy

## Authentication

- [ ] First registered owner automatically gets `operator` role
- [ ] Owners sign in with a password (`POST /v1/ghii/login`), a passkey or a configured identity provider. Registration at `POST /v1/owners` still returns an Ed25519 private key once; signing in with that key (`POST /v1/auth/token` with `owner`) is the legacy owner-key login, deprecated and removed in 4.0.0, and `AIMEAT_OWNER_KEY_LOGIN=false` switches it off now
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
- [ ] Monitor the `aimeat_rate_limit_hits_total` metric (`/v1/metrics`, when metrics are on) for abuse detection

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
