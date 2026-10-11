# Node identity credentials and consent receipts

This page describes the current implementation in
[vc-issuer.ts](../aimeat/src/services/vc-issuer.ts),
[verification.ts](../aimeat/src/routes/verification.ts) and
[mydata-receipt.ts](../aimeat/src/services/mydata-receipt.ts).
Declaring a standards context in JSON does not, by itself, prove conformance.

## Request your identity credential

`GET /v1/ghii/{ghii}/credential` requires `requireOwnerPrincipal` authority and checks that the
requested GHII belongs to the caller's owner account. This includes the owner and
an external principal explicitly granted account-security permission; app grants
are excluded (see [account-security.ts](../aimeat/src/auth/account-security.ts)). An operator cannot use this route to obtain
another owner's credential.

- Default, or `?format=json`: an unsigned object in `data.credential`.
- `?format=jwt`: an Ed25519-signed JWT in `data.credential`, with
  `data.format: "vc+ld+jwt"`.
- The JWT lifetime is fixed to 365 days in the issuer. There is no implemented
  `validity_days` query option.

The unsigned payload has this shape:

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://aimeat.io/ns/credentials/v1"
  ],
  "type": ["VerifiableCredential", "AIMEATIdentityCredential"],
  "issuer": "did:web:example.com",
  "issuanceDate": "2026-09-16T00:00:00.000Z",
  "credentialSubject": {
    "id": "did:aimeat:alice@example-node",
    "type": "AIMEATUser",
    "verificationLevel": 1,
    "memberSince": "2026-09-01",
    "displayName": "Alice"
  }
}
```

The second context is the node's own namespace, `https://aimeat.io/ns/`
([vc-context.ts](../aimeat/src/services/vc-context.ts)). It defines the credential's
type names and the subject fields `verificationLevel`, `memberSince` and `displayName`.
Every node serves the context document at `GET /ns/credentials/v1` as
`application/ld+json`, with CORS, and aimeat.io answers the canonical address.

Releases up to 3.26.1 issued the credential with the context
`https://aimeat.spechops.com/ns/credentials/v1`. A signed credential is valid for 365 days,
so the node still accepts that context when it verifies a credential it issued. Nothing
serves that old address, so an external JSON-LD processor cannot fetch it.

## Verifying a credential

The issuer's `verifyIdentityCredential(jwt)` checks a signed credential this node issued: the
Ed25519 signature against the node key, `typ: vc+ld+jwt`, the issuer DID, the type
`AIMEATIdentityCredential`, and a context list of exactly the W3C context followed by one of
the two AIMEAT contexts above. Any other context is refused. No HTTP route exposes it yet.

## Issuer configuration

`AIMEAT_VC_ISSUER_DID` overrides the issuer DID. Without it, the implementation
uses `did:web:{nodeId}.aimeat.example`, which is a placeholder. Configure and verify
an issuer identifier before depending on external verification.

The node exposes its public DID document at `/.well-known/did.json`.
The old guide listed separate VC enable, validity and context environment variables;
the implementation does not read those settings.

## Consent receipts

`GET /v1/consent/{id}/receipt` requires authentication and `consent:manage`.
The handler permits the consent owner's account, including consent attributed to
its agents, or an operator.

The response is in `data.receipt`. It contains the receipt id, consent timestamp,
principal, controller, purpose, data categories and termination condition.
The implementation emits `version: "KI-CR-v1.1.0"`, jurisdiction `FI`,
language `fi` and the node id as controller. These are implementation constants;
the receipt is not an operator-specific legal assessment.

## Limits

Credential revocation lists, selective-disclosure issuance and Data Integrity proofs
are not implemented here. EUDIW verification is separately blocked at startup:
see [the identity wallet status](aimeat-eudiw-integration.md).
