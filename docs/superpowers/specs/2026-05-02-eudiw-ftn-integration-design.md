# EUDIW & FTN Integration Design

**Date:** 2026-05-02
**Status:** Draft
**Scope:** Close the EUDIW/FTN integration gaps -- real SD-JWT verification, OIDC client for FTN, signed VCs, DID Document serving, nonce storage, E2E tests.

## Decisions

| Question | Decision |
|----------|----------|
| Deployment target | Cryptographically complete, tested against sandbox infrastructure (Signicat preprod). Production is a config change. |
| FTN broker | Broker-agnostic OIDC client. Signicat sandbox as documented test target. Any compliant broker works via config. |
| VC signing format | JWT only (`vc+ld+jwt`) using existing Ed25519 node key via `jose`. No Data Integrity Proofs or SD-JWT issuance. |
| Nonce storage | Database (new `verification_nonces` table). Both SQLite and MongoDB backends. |
| Multi-country eID | Single provider config with configurable PID claim name. Multi-provider is future scope. |

## Blast radius

~85% additive (new files), ~15% surgical replacement of scaffold code in 3 existing files. The core system (auth, identity model, trust, economy, consent, federation, frontend) is untouched.

**New files:**

| File | Purpose |
|------|---------|
| `src/services/sd-jwt.ts` | SD-JWT parsing and cryptographic signature verification |
| `src/services/oidc-client.ts` | Generic OIDC RP wrapper (FTN broker communication) |
| `src/services/did-document.ts` | DID Document generation for `did:web` |
| Storage: nonce table + methods | `verification_nonces` in SQLite schema, MongoDB/Prisma, interface |
| `test/unit/sd-jwt.test.ts` | SD-JWT unit tests |
| `test/unit/oidc-client.test.ts` | OIDC client unit tests |
| `test/unit/did-document.test.ts` | DID Document unit tests |
| `test/unit/vc-issuer-signed.test.ts` | VC JWT signing unit tests |
| `test/unit/nonce-storage.test.ts` | Nonce CRUD + expiry unit tests |
| `test/e2e-verification.ts` | Full E2E verification test suite |
| `test/helpers/test-sd-jwt.ts` | Test helper for creating signed SD-JWTs |

**Modified files:**

| File | Change | Untouched |
|------|--------|-----------|
| `src/services/eudiw.ts` | `verifyPresentation()` internals replaced with real SD-JWT verification (~30 lines) | Interface, `generateAuthorizationRequest()`, config handling |
| `src/services/vc-issuer.ts` | Add `issueSignedCredential()` and `getPublicJwk()` methods (~40 lines) | Existing `issueIdentityCredential()`, credential structure |
| `src/routes/verification.ts` | Nonce store/validate in EUDIW endpoints. New FTN authorize/callback endpoints. (~60 lines changed/added) | Route structure, auth middleware, error handling, response shapes |
| `src/storage/interface.ts` | 4 new methods + `VerificationNonceRecord` type | All 100+ existing methods |
| `src/storage/providers/sqlite/schema.ts` | One new `CREATE TABLE` | All existing tables |
| SQLite + MongoDB providers | 4 new method implementations each | All existing implementations |
| `src/config.ts` | ~4 new fields | All existing 200+ fields |
| `src/server-bootstrap/routes-loader.ts` | Wire new services into verification router | All other route wiring |
| `package.json` | 2-3 new dependencies | No version changes to existing deps |
| `.env.example` | ~5 new lines | All existing vars |
| `openapi.yaml` | 2 new FTN endpoints | All existing endpoint definitions |
| `test/unit/eudiw-verifier.test.ts` | Update to use real SD-JWT tokens | Test structure |

---

## Section 1: Dependencies and Shared Infrastructure

### New dependencies

| Package | Version | License | Purpose |
|---------|---------|---------|---------|
| `openid-client` | ^6.x | MIT | Certified OIDC Relying Party. Handles discovery, auth code exchange, token validation. Used for FTN broker communication. |
| `@sd-jwt/decode` | ^0.9.x | Apache-2.0 | Decode SD-JWT tokens into header, payload, disclosures, key binding JWT. |
| `@sd-jwt/verify` | ^0.9.x | Apache-2.0 | Verify SD-JWT issuer signatures against public keys. Peer dependency of decode. |

No other new dependencies. `jose` (already installed) handles VC JWT signing and JWK operations.

### Nonce storage

New `verification_nonces` table:

```
id           TEXT PRIMARY KEY     -- UUID
owner        TEXT NOT NULL        -- owner username (who initiated)
type         TEXT NOT NULL        -- 'eudiw' | 'ftn'
state        TEXT NOT NULL UNIQUE -- random state param sent to wallet/broker
nonce        TEXT NOT NULL        -- random nonce for replay protection
redirect_uri TEXT                 -- where to redirect after completion
created_at   TEXT NOT NULL        -- ISO 8601
expires_at   TEXT NOT NULL        -- created_at + nonceTtlSeconds (default 300)
```

Storage interface additions:

```typescript
interface VerificationNonceRecord {
  id: string;
  owner: string;
  type: 'eudiw' | 'ftn';
  state: string;
  nonce: string;
  redirectUri?: string;
  createdAt: string;
  expiresAt: string;
}

// 4 new methods on Storage interface:
createVerificationNonce(nonce: VerificationNonceRecord): Promise<VerificationNonceRecord>;
getVerificationNonce(state: string): Promise<VerificationNonceRecord | null>;
deleteVerificationNonce(state: string): Promise<void>;
cleanExpiredNonces(): Promise<number>;  // returns count deleted
```

`cleanExpiredNonces()` runs on a 5-minute interval from the existing background job infrastructure (same pattern as consent expiry sweep).

### Config additions

New fields in `AimeatConfig`:

```typescript
ftnClientId: string;              // OIDC client_id registered with FTN broker
ftnClientSecret: string;          // OIDC client_secret
nonceTtlSeconds: number;          // TTL for verification nonces (default: 300)
nationalEidPidClaim: string;      // claim name for national PID (default: 'personal_identity_code')
```

The existing `ftnProviderUrl` becomes the OIDC issuer URL (used for `/.well-known/openid-configuration` discovery).

---

## Section 2: SD-JWT Verification (EUDIW flow)

### New service: `src/services/sd-jwt.ts`

Parses and cryptographically verifies SD-JWT tokens received from EU digital wallets.

```typescript
interface SdJwtVerificationResult {
  valid: boolean;
  payload?: Record<string, unknown>;
  disclosedClaims?: Record<string, unknown>;
  issuer?: string;
  keyBinding?: boolean;
  error?: string;
}

interface SdJwtVerifier {
  verify(sdJwtToken: string, trustedIssuerKeys: Map<string, JsonWebKey>): Promise<SdJwtVerificationResult>;
  decode(sdJwtToken: string): SdJwtDecodeResult;
}
```

**Verification steps:**

1. **Decode** -- Uses `@sd-jwt/decode` to split the compact SD-JWT into header, payload, disclosures array, and optional key binding JWT.
2. **Issuer key lookup** -- Extracts `iss` from payload, looks up the issuer's public key from the trusted issuer registry. The `TrustedIssuerRecord.publicKey` field stores a serialized JWK (JSON string).
3. **Signature verification** -- Uses `@sd-jwt/verify` with the issuer's public JWK. Supports `ES256` and `EdDSA` algorithms (matching the presentation definition in `generateAuthorizationRequest()`).
4. **Disclosure processing** -- Reconstructs the full credential subject by applying selective disclosures to the payload, producing the final set of revealed attributes.
5. **Expiry check** -- Validates `exp` claim if present.
6. **Key binding check** -- If the SD-JWT includes a key binding JWT (holder binding), verifies it against the expected nonce and audience. Optional -- not all wallets send it.

### Changes to `src/services/eudiw.ts`

The `verifyPresentation()` method internals are replaced. The current ~50 lines of base64 decode and manual JSON parsing become:

```typescript
async verifyPresentation(vpToken: string, presentationSubmission: Record<string, unknown>): Promise<EudiwVerificationResult> {
  // 1. Build issuer key map from trusted issuers
  const issuers = await storage.listTrustedIssuers({ type: 'eudiw' });
  const keyMap = buildIssuerKeyMap(issuers);

  // 2. Cryptographic SD-JWT verification
  const result = await sdJwtVerifier.verify(vpToken, keyMap);
  if (!result.valid) return { valid: false, error: result.error };

  // 3. Extract identity attributes from disclosed claims
  const attributes = extractIdentityAttributes(result.disclosedClaims);
  return { valid: true, attributes, issuer: result.issuer };
}
```

The `EudiwVerificationResult` interface stays identical. `generateAuthorizationRequest()` stays identical. The `EudiwService` factory takes `SdJwtVerifier` as an additional parameter.

### Nonce validation in EUDIW routes

**`GET /v1/ghii/verify/eudiw/request`:**
- After generating `state` and `nonce`, stores them via `storage.createVerificationNonce()` with the owner's username and TTL.
- Response shape unchanged.

**`POST /v1/ghii/verify/eudiw`** (same-device flow, user submits VP directly):
- Before calling `verifyPresentation()`, validates `state` against stored nonce.
- Checks nonce ownership matches `req.auth!.owner`.
- Checks nonce expiry.
- Deletes nonce after successful verification (single-use).

**`POST /v1/ghii/verify/eudiw/callback`** (cross-device flow, wallet posts VP):
- This endpoint is called by wallet infrastructure, not the user's browser. Auth changes from `requireAuth()` to unauthenticated -- the `state` parameter is the authentication (maps to the owner who initiated the request via the stored nonce).
- Validates `state` against stored nonce. Retrieves the `owner` from the nonce record.
- Checks nonce expiry.
- Deletes nonce after successful verification (single-use).

### Trusted issuer `publicKey` format

The `publicKey` field in `TrustedIssuerRecord` currently stores an opaque string. For SD-JWT verification, operators store a JWK as a JSON string. The storage schema is already `TEXT`, so no column change needed. The `buildIssuerKeyMap()` helper parses with `JSON.parse()` and validates JWK structure.

---

## Section 3: FTN/OIDC Client (Finnish Trust Network flow)

### New service: `src/services/oidc-client.ts`

A generic OIDC Relying Party wrapper built on `openid-client` v6. Not FTN-specific -- works with any standard OIDC provider.

```typescript
interface OidcClientConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

interface OidcAuthRequest {
  authorizationUrl: string;
  state: string;
  nonce: string;
}

interface OidcTokenResult {
  valid: boolean;
  claims?: Record<string, unknown>;
  error?: string;
}

interface OidcClient {
  initialize(): Promise<void>;
  createAuthRequest(): Promise<OidcAuthRequest>;
  exchangeCode(code: string, state: string, nonce: string): Promise<OidcTokenResult>;
}
```

**Behavior:**

1. **Discovery** -- On `initialize()`, fetches `/.well-known/openid-configuration` from the configured issuer URL. Caches the result. Called once at server startup when `ftnEnabled` is true.
2. **Auth request** -- Generates an authorization URL with `response_type: 'code'`, random `state` and `nonce`, and the configured scopes. For FTN, the critical scope is `personal_identity_code` (Finnish national ID).
3. **Code exchange** -- Exchanges the authorization code for tokens. Validates the `id_token` signature against the issuer's JWKS (handled by `openid-client` internally). Returns decoded claims.

Lazy-initialized: created at startup but `initialize()` only called if `ftnEnabled` is true. If the broker is unreachable, logs a warning and FTN endpoints return 503.

### FTN claims and PID hashing

FTN brokers return standardized claims in the `id_token`:

| Claim | Type | Description |
|-------|------|-------------|
| `name` | string | Full name |
| `given_name` | string | First name |
| `family_name` | string | Family name |
| `birthdate` | string | YYYY-MM-DD |
| `personal_identity_code` | string | Finnish hetu (e.g., `010190-123A`) |

The PID claim name is configurable via `nationalEidPidClaim` (default: `personal_identity_code`). For Swedish BankID this would be `personalNumber`, for Danish MitID `dk.cpr`.

The PID value is **hashed with SHA-256 before storage**. The hash goes into `verificationCredentialHash`. The plaintext is never persisted.

### Route changes

**New: `GET /v1/ghii/verify/ftn/authorize`**
- Calls `oidcClient.createAuthRequest()`.
- Stores `state` + `nonce` via `storage.createVerificationNonce()` (type: `'ftn'`).
- Returns `{ authorizationUrl, state }`.

**New: `GET /v1/ghii/verify/ftn/callback`**
- OIDC redirect URI. FTN broker redirects user's browser here with `?code=...&state=...`.
- Validates `state` against stored nonce.
- Calls `oidcClient.exchangeCode()` to get identity claims.
- Hashes PID claim with SHA-256.
- Updates GHII to Level 3 with `ftnVerified: true`, stores verified attributes and credential hash.
- Redirects user back to profile (or returns JSON depending on `Accept` header).

**Existing `POST /v1/ghii/verify/ftn` stays** as a manual/API path for cases where the frontend handles the OIDC flow itself and posts the result. Backward compatible.

### OpenAPI additions

Two new endpoints added to `openapi.yaml` under the existing Phase 3.3 tag:
- `GET /v1/ghii/verify/ftn/authorize` -- returns `{ authorizationUrl, state }`
- `GET /v1/ghii/verify/ftn/callback` -- OIDC callback, query params `code` + `state`

### Multi-country support

The OIDC client is broker-agnostic. Other countries' national eID schemes (Swedish BankID, Danish MitID, Norwegian BankID) use OIDC or OIDC-bridged SAML. An operator in any country can configure:
- `ftnProviderUrl` -- their country's broker OIDC issuer URL
- `ftnClientId` / `ftnClientSecret` -- their broker credentials
- `nationalEidPidClaim` -- their country's PID claim name

Multi-provider support (one node accepting multiple national eIDs simultaneously) is future scope -- requires an array of OIDC provider configs instead of a single one. The generic OIDC client design makes this a config/routing change, not an architectural one.

---

## Section 4: VC Signing and DID Document

### Changes to `src/services/vc-issuer.ts`

New methods added to the service:

```typescript
interface VcIssuerService {
  issueIdentityCredential(ghiiRecord: GHIIRecord): VerifiableCredential;   // existing, unchanged
  issueSignedCredential(ghiiRecord: GHIIRecord): Promise<string>;           // new: vc+ld+jwt
  getIssuerDid(): string;
  getPublicJwk(): JsonWebKey;
}
```

**Signing flow:**

1. Build the credential payload (same as `issueIdentityCredential()`).
2. Wrap in JWT with `jose.SignJWT`:
   - Header: `{ alg: 'EdDSA', typ: 'vc+ld+jwt', kid: '{did}#key-1' }`
   - Payload: `{ iss: issuerDid, sub: subjectDid, nbf: now, exp: now + validityDays, vc: credentialPayload }`
3. Sign with the node's Ed25519 private key via `jose.importJWK()` + `sign()`.

The factory takes the node keypair as a parameter. Zero new dependencies.

**Route change in `GET /v1/ghii/:ghii/credential`:**

The `format` query parameter determines the response:
- `?format=json` (default) -- unsigned JSON (backward compatible)
- `?format=jwt` -- signed `vc+ld+jwt` string

### New service: `src/services/did-document.ts`

Generates a DID Document for the node's `did:web` identifier.

```typescript
interface DidDocumentService {
  getDocument(): DidDocument;
}
```

Document structure:

```json
{
  "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/jwk/v1"],
  "id": "did:web:node-001.aimeat.example",
  "verificationMethod": [{
    "id": "did:web:node-001.aimeat.example#key-1",
    "type": "JsonWebKey",
    "controller": "did:web:node-001.aimeat.example",
    "publicKeyJwk": { "kty": "OKP", "crv": "Ed25519", "x": "..." }
  }],
  "authentication": ["did:web:node-001.aimeat.example#key-1"],
  "assertionMethod": ["did:web:node-001.aimeat.example#key-1"]
}
```

Public key JWK derived from the node's Ed25519 keypair at startup. Static for the server's lifetime.

### New route: `GET /.well-known/did.json`

Per the `did:web` specification, the DID Document is served at `/.well-known/did.json`. Public, unauthenticated endpoint. Added to `server.ts` directly (well-known URI, not part of the verification router).

External verifiers resolve the issuer DID by fetching this endpoint, extract the public key, and verify the VC JWT signature.

---

## Section 5: E2E Tests and Test Infrastructure

### Unit tests (vitest)

| File | Coverage |
|------|----------|
| `test/unit/sd-jwt.test.ts` | SD-JWT decode, signature verification (valid/invalid/expired), disclosure processing, ES256 + EdDSA |
| `test/unit/oidc-client.test.ts` | Discovery parsing, auth URL generation, code exchange with mocked HTTP, broker-unreachable error handling |
| `test/unit/did-document.test.ts` | DID Document structure, key derivation, `did:web` formatting |
| `test/unit/vc-issuer-signed.test.ts` | JWT signing, `vc+ld+jwt` header, round-trip verify with `jose`, expiry claims |
| `test/unit/nonce-storage.test.ts` | Create, retrieve, delete, expiry, uniqueness constraint on `state` |

Existing `test/unit/eudiw-verifier.test.ts` updated to use real SD-JWT tokens instead of base64 helper.

### E2E test suite: `test/e2e-verification.ts`

Runs against a live server, follows existing phase pattern:

| Phase | Tests |
|-------|-------|
| 1. Setup | Register owner, configure trusted issuer with known JWK |
| 2. EUDIW request | Generate auth request, verify nonce stored, verify OpenID4VP structure |
| 3. EUDIW verify | Valid SD-JWT (test-signed with known key) -- Level 3 upgrade. Wrong key -- rejected. Expired -- rejected. Unknown issuer -- rejected. Replay same state -- rejected (single-use). |
| 4. FTN authorize | Request FTN auth URL, verify nonce stored, verify OIDC parameters |
| 5. FTN callback | Valid OIDC callback (mocked broker) -- Level 3 + ftnVerified. Invalid state -- rejected. Expired nonce -- rejected. |
| 6. VC issuance | `?format=json` -- unsigned JSON. `?format=jwt` -- valid JWT, verify sig against `/.well-known/did.json`. |
| 7. DID Document | Fetch `/.well-known/did.json`, verify structure, verify public key matches node key. |
| 8. Nonce cleanup | Create nonce, advance past TTL, run cleanup, verify deleted. |
| 9. Cleanup | Cascade delete test owner. |

### Test SD-JWT construction helper

```typescript
// test/helpers/test-sd-jwt.ts
async function createTestSdJwt(
  claims: Record<string, unknown>,
  signingKey: CryptoKeyPair,
  issuer: string,
): Promise<string> { ... }
```

Tests register a trusted issuer with the test key's public JWK, then create SD-JWTs signed with the private key. Tests the real verification path without an external wallet.

### Mocked OIDC broker for FTN tests

FTN E2E tests start a tiny HTTP server on a random port serving:
- `/.well-known/openid-configuration`
- JWKS endpoint
- Token endpoint

Test configures `ftnProviderUrl` to point at this mock. Tests the real OIDC client code path against a spec-compliant local provider.

### Test commands

No new commands needed. Existing infrastructure picks up new files:

```bash
pnpm test:unit                     # all unit tests
pnpm test:e2e:mongodb              # all E2E suites including verification
pnpm test:e2e:sqlite               # same on SQLite
pnpm test:e2e:mongodb -- --grep "verification"   # just this suite
```

---

## Implementation phases (Approach 3)

### Phase 1: Shared infrastructure
- Add dependencies (`openid-client`, `@sd-jwt/decode`, `@sd-jwt/verify`)
- Add `VerificationNonceRecord` to storage interface
- Implement nonce table in SQLite and MongoDB backends
- Add config fields (`ftnClientId`, `ftnClientSecret`, `nonceTtlSeconds`, `nationalEidPidClaim`)
- Add nonce cleanup to background job scheduler
- Unit tests for nonce storage

### Phase 2a: EUDIW (SD-JWT verification)
- Create `src/services/sd-jwt.ts`
- Rewrite `eudiw.ts` `verifyPresentation()` to use real SD-JWT verification
- Add nonce store/validate to EUDIW routes
- Create `test/helpers/test-sd-jwt.ts`
- Unit tests for SD-JWT service
- Update existing EUDIW unit tests

### Phase 2b: FTN (OIDC client)
- Create `src/services/oidc-client.ts`
- Add FTN authorize + callback routes
- Wire OIDC client initialization at startup
- Unit tests for OIDC client
- Update OpenAPI spec with new FTN endpoints

### Phase 3: VC signing + DID Document
- Add `issueSignedCredential()` + `getPublicJwk()` to vc-issuer service
- Create `src/services/did-document.ts`
- Add `GET /.well-known/did.json` route
- Add `?format=jwt` support to credential endpoint
- Unit tests for VC signing and DID Document

### Phase 4: E2E tests + integration
- Create `test/e2e-verification.ts` with all 9 phases
- Create mock OIDC broker for FTN tests
- Run full E2E suite on both backends
- Update `.env.example` and documentation

Phases 2a and 2b are independent and can be parallelized.
