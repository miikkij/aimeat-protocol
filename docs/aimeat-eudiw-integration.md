# AIMEAT EUDIW Integration Guide

## Overview

AIMEAT supports EU Digital Identity Wallet (EUDIW) verification to provide Level 3 identity assurance. This integration allows node operators to verify user identities through eIDAS-compliant digital wallets, including the Finnish Trust Network (FTN) as a national implementation.

## Identity Tiers

AIMEAT defines four identity verification levels for GHII (Global Human Identity Identifier) records:

| Level | Name | Method | Trust Score Bonus |
|-------|------|--------|-------------------|
| 0 | Anonymous | No verification | 0 |
| 1 | Email-verified | Email confirmation link | +10 |
| 2 | TOTP-verified | Time-based one-time password setup | +20 |
| 3 | eIDAS-verified | EUDIW or national eID (e.g., FTN) | +50 |

Level 3 verification is the highest tier. Once achieved, the GHII record is annotated with the verification method, timestamp, and issuer country code.

## Verification Flow

The EUDIW verification follows an OpenID4VP (Verifiable Presentation) flow:

```
User (Browser)          AIMEAT Node              EUDIW Wallet App
      |                      |                          |
      |-- GET /v1/eudiw/request -->|                    |
      |                      |-- generate nonce ------->|
      |<-- redirect URI -----|                          |
      |                      |                          |
      |-- open wallet link -------------------------------->|
      |                      |                          |
      |                      |<-- POST /v1/eudiw/callback --|
      |                      |-- validate VP response --|
      |                      |-- update GHII level=3 ---|
      |<-- confirmation -----|                          |
```

For FTN (Finnish Trust Network), a separate flow is used where the user is redirected to the FTN broker, authenticates with their bank credentials, and the broker posts identity attributes back to the callback endpoint.

## Endpoints

### `GET /v1/eudiw/request`

Initiates a verification request. Returns a redirect URI or QR code payload that the user's wallet app can process. Requires authentication.

Query parameters:
- `method` -- `eudiw` (default) or `ftn`

Response includes `request_uri`, `nonce`, and `state` fields.

### `POST /v1/eudiw/verify`

Manually submits a Verifiable Presentation for verification. Used when the wallet app cannot reach the callback URL directly (e.g., same-device flow).

Request body: `{ vp_token, state, nonce }`

### `POST /v1/eudiw/callback`

Receives the wallet's Verifiable Presentation response. This is the redirect target configured in the EUDIW request. The node validates the presentation, extracts identity claims, and updates the GHII verification level.

This endpoint is unauthenticated (called by the wallet infrastructure) but validates the `state` and `nonce` parameters against the original request.

### `POST /v1/ftn/verify`

FTN-specific verification endpoint. Receives the identity assertion from the FTN broker. Extracts `given_name`, `family_name`, `birthdate`, and `personal_identity_code` (hashed, not stored in plaintext).

Request body: FTN broker assertion format.

## Trusted Issuers

Operators can configure which credential issuers are accepted for Level 3 verification.

### `POST /v1/trusted-issuers`

Adds a trusted issuer. Requires `operator` role.

```json
{
  "issuer_id": "did:web:issuer.example.com",
  "name": "Example National eID Provider",
  "country": "FI",
  "trusted_credentials": ["VerifiableId", "EuropeanHealthInsuranceCard"]
}
```

### `GET /v1/trusted-issuers`

Lists all configured trusted issuers. Public endpoint.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `AIMEAT_EUDIW_ENABLED` | `false` | Enable EUDIW verification endpoints |
| `AIMEAT_EUDIW_CLIENT_ID` | -- | Client ID registered with the EUDIW infrastructure |
| `AIMEAT_EUDIW_REDIRECT_URI` | -- | Callback URL for wallet responses |
| `AIMEAT_EUDIW_PRESENTATION_DEF` | built-in | Custom presentation definition JSON path |
| `AIMEAT_FTN_ENABLED` | `false` | Enable Finnish Trust Network verification |
| `AIMEAT_FTN_CLIENT_ID` | -- | FTN broker client ID |
| `AIMEAT_FTN_CLIENT_SECRET` | -- | FTN broker client secret |
| `AIMEAT_FTN_ISSUER_URL` | -- | FTN broker discovery URL |
| `AIMEAT_EUDIW_NONCE_TTL_SECONDS` | `300` | Expiry for verification nonces |

## Implementation Status

The EUDIW integration implements cryptographically complete verification:

- **SD-JWT parsing and signature verification** -- VP tokens are decoded and cryptographically verified against trusted issuer public keys (JWK format). Supports ES256 and EdDSA algorithms.
- **Nonce/state validation** -- All verification flows use database-backed nonces with configurable TTL for CSRF protection and replay prevention.
- **FTN integration** -- Generic OIDC client supporting any FTN broker (Signicat, DVV/Suomi.fi, Telia). Configurable via `AIMEAT_FTN_PROVIDER_URL`, `AIMEAT_FTN_CLIENT_ID`, `AIMEAT_FTN_CLIENT_SECRET`.
- **Multi-country eID support** -- The national PID claim name is configurable via `AIMEAT_NATIONAL_EID_PID_CLAIM` (Finland: `personal_identity_code`, Sweden: `personalNumber`, Denmark: `dk.cpr`).
- **Trusted issuer validation** -- Issuer signatures are verified against public keys stored as JWK in the trusted issuer registry.

**Production deployment requires:**
- Registering with a licensed FTN broker to obtain OIDC client credentials
- Configuring trusted issuers with their real public keys (JWK format)
- For EUDIW: registering as a verifier with the EUDIW infrastructure

**Not yet implemented:**
- Credential revocation checking (status lists)

---

*AIMEAT Protocol -- Overscale Solutions Oy, 2026*
