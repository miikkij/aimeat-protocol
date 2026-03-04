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

## Reference Implementation Notes

The current implementation provides the endpoint structure and flow scaffolding but has the following limitations:

- **No real SD-JWT parsing.** Verifiable Presentations are accepted as opaque JSON objects. Selective disclosure and signature verification are not yet implemented.
- **FTN integration is a placeholder.** The FTN endpoints accept mock assertions for development. Production use requires registering with a licensed FTN broker.
- **Trusted issuer validation is name-based only.** The node checks issuer IDs against the trusted list but does not resolve or verify issuer DIDs.
- **No revocation checking.** Credential status lists and revocation registries are not queried.

These limitations are documented in the codebase with `// TODO: Phase 3+` comments.

---

*AIMEAT Protocol -- Overscale Solutions Oy, 2026*
