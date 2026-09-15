# Identity wallet verification: implementation status

**EUDIW verification cannot be enabled in this release.**
Setting `AIMEAT_EUDIW_ENABLED=true` makes configuration loading fail.
The [startup guard](../aimeat/src/config-eudiw-guard.ts) records why: the SD-JWT path
does not yet verify holder binding, the request nonce and the verifier audience together.
The earlier guide's claim of complete verification was incorrect.

This page describes the code that exists. It is not an instruction to enable EUDIW
and does not establish certification or compatibility with a wallet provider.

## Existing routes

The routes are defined in [verification.ts](../aimeat/src/routes/verification.ts).
Use [OpenAPI](../openapi.yaml) for request and response fields.

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/ghii/verify/eudiw/request` | Construct a wallet verification request |
| POST | `/v1/ghii/verify/eudiw` | Submit a presentation |
| POST | `/v1/ghii/verify/eudiw/callback` | Receive a wallet response |
| GET | `/v1/ghii/verify/ftn/authorize` | Begin the separate FTN OIDC flow |
| GET | `/v1/ghii/verify/ftn/callback` | Receive the FTN authorization response |
| POST | `/v1/ghii/verify/ftn` | Submit an FTN assertion |
| POST | `/v1/trusted-issuers` | Operator registers a trusted issuer |
| GET | `/v1/trusted-issuers` | List issuers |

Owner-facing verification routes require an owner session. Callback routes validate
their flow state. FTN is a separate, optional integration; a configured provider and
successful provider verification are required before treating it as operational.

## Configuration that exists

See [config.ts](../aimeat/src/config.ts) and
[the field schema](../aimeat/src/services/config-schema.ts).

| Variable | Purpose |
|---|---|
| `AIMEAT_EUDIW_ENABLED` | Defaults to false; true is refused at startup |
| `AIMEAT_EUDIW_CLIENT_ID` | Verifier client identifier |
| `AIMEAT_EUDIW_REDIRECT_URI` | Wallet callback address |
| `AIMEAT_FTN_ENABLED` | Enable the separate FTN integration |
| `AIMEAT_FTN_PROVIDER_URL` | FTN OIDC provider address |
| `AIMEAT_FTN_CLIENT_ID` | Provider client identifier |
| `AIMEAT_FTN_CLIENT_SECRET` | Provider client secret |
| `AIMEAT_NATIONAL_EID_PID_CLAIM` | Claim containing the national identifier |
| `AIMEAT_VC_ISSUER_DID` | Issuer identifier for credentials this node issues |

The old presentation-definition, nonce-TTL and FTN issuer-URL settings listed here
were not implemented under those names.

## When this page must change

Remove the blocked status only after the startup guard is removed through an approved,
tested implementation of holder binding, nonce consumption and audience validation.
Test rejected and replayed presentations as well as successful verification.

Issuing a node credential is a separate capability. See
[verifiable credentials](aimeat-vc-spec.md).
