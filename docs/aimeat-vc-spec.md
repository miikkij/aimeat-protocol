# AIMEAT Verifiable Credentials Specification

## Overview

AIMEAT nodes can issue W3C Verifiable Credentials (VC) v2.0 to represent verified identity attributes of registered users. These credentials follow the W3C data model and use AIMEAT-specific vocabulary for protocol-level claims.

## Credential Type

The primary credential type issued by AIMEAT nodes is `AIMEATIdentityCredential`. This credential attests to a user's verification level, display name, and membership status on a specific node.

## Context URLs

Every issued credential includes two JSON-LD context references:

| Context | URL | Purpose |
|---------|-----|---------|
| W3C VC v2.0 | `https://www.w3.org/ns/credentials/v2` | Base credential data model |
| AIMEAT | `https://aimeat.example/contexts/v1` | AIMEAT-specific vocabulary |

## Credential Structure

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://aimeat.example/contexts/v1"
  ],
  "type": ["VerifiableCredential", "AIMEATIdentityCredential"],
  "issuer": {
    "id": "did:web:node-001.aimeat.example",
    "name": "AIMEAT Node node-001"
  },
  "validFrom": "2026-01-15T10:00:00Z",
  "validUntil": "2027-01-15T10:00:00Z",
  "credentialSubject": {
    "id": "did:aimeat:ghii:abc123-def456",
    "verificationLevel": 2,
    "displayName": "J. Example",
    "memberSince": "2026-01-10T08:30:00Z",
    "nodeId": "node-001"
  }
}
```

Field descriptions are provided in the Credential Subject Fields section below.

## Issuer DID

The issuer is identified by a DID (Decentralized Identifier). AIMEAT supports two formats:

- **Automatic:** `did:web:{nodeId}.aimeat.example` -- derived from the node's configured ID.
- **Custom:** Set via the `AIMEAT_VC_ISSUER_DID` environment variable for operators who manage their own DID infrastructure.

The issuer DID is included in every credential and should resolve to a DID Document containing the node's public signing key.

## Credential Subject Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | The subject's DID, derived from GHII: `did:aimeat:ghii:{ghii}` |
| `verificationLevel` | integer | Identity tier (0-3). See EUDIW integration guide for tier definitions |
| `displayName` | string | User's chosen display name from their GHII profile |
| `memberSince` | string | ISO 8601 timestamp of initial registration on the node |
| `nodeId` | string | Identifier of the issuing AIMEAT node |

## Credential Endpoint

### `GET /v1/ghii/:ghii/credential`

Issues or retrieves an `AIMEATIdentityCredential` for the specified GHII. Requires authentication. The requesting user must be the GHII owner or have the `operator` role.

Query parameters:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `format` | `json` | Response format: `json` (plain object) or `jwt` (signed JWT, when implemented) |
| `validity_days` | `365` | Credential validity period in days |

Response: A JSON object conforming to the credential structure above.

Error responses:
- `404` -- GHII not found
- `403` -- Not authorized to request credential for this GHII

## MyData Consent Receipts

AIMEAT implements consent receipts following the Kantara Initiative Consent Receipt Specification v1.1.0. Each consent record can produce a machine-readable receipt documenting what data was shared, with whom, and for what purpose.

### Receipt Structure

Consent receipts include the following sections:

| Section | Content |
|---------|---------|
| Header | Receipt version, jurisdiction, timestamp, receipt ID |
| Data Controller | Node operator identity and contact |
| Purpose | Purpose specification per the CSM service definition |
| PII | Categories of personal data covered by the consent |
| Sensitive Data | Whether sensitive categories (health, biometric) are included |

### `GET /v1/consent/:id/receipt`

Returns a KI-CR v1.1.0 formatted consent receipt for the specified consent record. Requires authentication as the consent subject or an operator.

Response: A JSON object with receipt fields per the KI-CR specification.

Error responses:
- `404` -- Consent record not found
- `403` -- Not authorized to view this consent receipt

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `AIMEAT_VC_ENABLED` | `false` | Enable credential issuance endpoints |
| `AIMEAT_VC_ISSUER_DID` | auto-generated | Custom issuer DID |
| `AIMEAT_VC_DEFAULT_VALIDITY_DAYS` | `365` | Default credential validity period |
| `AIMEAT_VC_CONTEXT_URL` | `https://aimeat.example/contexts/v1` | AIMEAT JSON-LD context URL |

## Reference Implementation Notes

The current implementation has the following limitations:

- **Plain JSON only.** Credentials are returned as unsigned JSON objects. Signed JWT (`vc+ld+jwt`) and Data Integrity proof formats are not yet implemented.
- **No DID resolution.** The `did:web` issuer DID is asserted but not resolvable. No DID Document is published.
- **No status list.** Credential revocation via W3C Bitstring Status List is not yet implemented.
- **Consent receipts are simplified.** The KI-CR output covers core fields but omits optional sections like third-party disclosures.

These items are tracked for future phases.

---

*AIMEAT Protocol -- Overscale Solutions Oy, 2026*
