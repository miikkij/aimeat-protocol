# Identity wallet verification: implementation status

**EUDIW verification is off by default and not yet tested with a production wallet.**
Setting `AIMEAT_EUDIW_ENABLED=true`, or `eudiw.enabled` in the admin settings, switches it on.
From 2026-09-01 to 2026-11-19 the node refused that setting, because the SD-JWT path did not
verify holder binding, the request nonce and the verifier audience. The
[setting check](../aimeat/src/config/eudiw-guard.ts) records why the refusal existed and why
it was removed. The earlier guide's claim of complete verification was incorrect when it was made.

This page describes the code that exists. It does not establish certification or
compatibility with a wallet provider: test with the organisation's own wallet before relying on it.

**Signing a PDF with a wallet is a different feature** and works: its settings are
`docsign.eudi_*` (`AIMEAT_DOCSIGN_EUDI_*`), never `AIMEAT_EUDIW_*`. See
[document-signing.md](document-signing.md).

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

## What the node checks in a presentation

[sd-jwt.ts](../aimeat/src/services/sd-jwt.ts) and [eudiw.ts](../aimeat/src/services/eudiw.ts)
accept a wallet presentation only when all of these hold:

- the issuer's signature verifies against a trusted issuer of type `eudiw`;
- every disclosure matches a digest in the issuer-signed payload;
- a Key Binding JWT is present, has typ `kb+jwt` and is signed by the key in the credential's
  `cnf.jwk`, which ties the presentation to the wallet the credential was issued to;
- the Key Binding JWT's `iat` is at most five minutes old, and its `sd_hash` covers exactly the
  presented issuer JWT and disclosures;
- its `nonce` equals the nonce of this node's own request, and the request round and the nonce
  are each accepted once;
- its `aud` equals `AIMEAT_EUDIW_CLIENT_ID`.

A refused presentation answers 400 with `EUDIW_HOLDER_BINDING`, `EUDIW_NONCE_MISMATCH`,
`EUDIW_AUDIENCE_MISMATCH` or `EUDIW_REPLAY`. `GET /v1/ghii/verify/eudiw/request` answers 503
`EUDIW_NO_TRUSTED_ISSUER` when no trusted `eudiw` issuer is registered, so nobody is sent to a
wallet whose answer the node would refuse. The tests in `aimeat/test/unit/eudiw-presentation.test.ts`
and `aimeat/test/unit/eudiw-verifier.test.ts` cover accepted, rejected and replayed presentations
with generated keys.

## Configuration that exists

See [config.ts](../aimeat/src/config.ts) and
[the field schema](../aimeat/src/services/config/schema.ts).

| Variable | Purpose |
|---|---|
| `AIMEAT_EUDIW_ENABLED` | Defaults to false; true switches wallet verification on |
| `AIMEAT_EUDIW_CLIENT_ID` | Verifier client identifier; a presentation's `aud` must equal it |
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

Change the status line at the top when the path has been tested with a production EU wallet,
and record which wallet and issuer were used. Change the check list above in the same commit
as any change to the checks in `sd-jwt.ts` or `eudiw.ts`.

Issuing a node credential is a separate capability. See
[verifiable credentials](aimeat-vc-spec.md).
