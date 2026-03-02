# 3.3 EUDIW / MyData / W3C VC -integraatiot

*Alidokumentti: [phase-3-polish-future.md](./phase-3-polish-future.md)*

---

> Lähde: masterplan (§3.3), `docs/ghii-identity-and-network-plan.md`, `docs/research/bbs-aikakaudesta-ai-aikaan.md` (§7)

### 3.3.1 Tavoite

Integroida AIMEAT eurooppalaiseen ja kansainväliseen identiteetti- ja data-ekosysteemiin: EU:n digitaalinen identiteettilompakko (eIDAS 2.0), W3C Verifiable Credentials, MyData-periaatteet ja Suomen luottamusverkko (FTN). Tämä mahdollistaa GHII Tier 3:n — vahvimman identiteettivahvistuksen — ja yhteensopivuuden muiden datanhallintatyökalujen kanssa.

### 3.3.2 Standardikartta

| Standardi | Versio | Rooli AIMEAT:ssa | Integraatiotapa |
|---|---|---|---|
| **eIDAS 2.0 (EUDIW)** | EU Regulation 2024/1183 | GHII Tier 3: vahva identiteetti | OpenID4VP -presentaatioiden vastaanotto |
| **OpenID4VP** | Draft 20+ | EUDIW:n esitysprotokolla | Verifier-rooli (AIMEAT vastaanottaa) |
| **SD-JWT** | RFC 9449 | Selective Disclosure -todistukset | Validointi jose-kirjastolla |
| **W3C Verifiable Credentials** | v2.0 (2024) | Attestaatiot GHII:lle | VC-dokumenttien luonti + validointi |
| **MyData** | Principles 2023 | Consent receipt -malli | Integraatio Phase 0.3 audit trailiin |
| **Suomen luottamusverkko (FTN)** | Current | Suomalainen identiteetti | Tunnistautuminen FTN-palveluntarjoajan kautta |

### 3.3.3 GHII Tier 3 -implementaatio

**Nykyinen GHII-tierjärjestelmä:**

| Tier | Vahvistus | Phase |
|---|---|---|
| 0 | Ei vahvistusta (anonyymi) | Phase 0 (nykyinen) |
| 1 | Email + TOTP | Phase 0.5 + 1.3 |
| 2 | Operaattorin vahvistama | Phase 1.3 (manuaalinen) |
| 3 | EU digitaalinen lompakko / FTN | **Phase 3.3** |

**Tier 3 -vahvistusflow:**

```
1. Käyttäjä avaa "Vahvista identiteettisi" -sivun portaalissa
       ↓
2. Valitsee: "EU Digital Identity Wallet" TAI "Suomi.fi tunnistus"
       ↓
3. AIMEAT generoi OpenID4VP Authorization Request
   - Pyydetyt attribuutit: nimi, syntymäaika, kansalaisuus
   - Selective Disclosure: vain tarvittavat kentät
       ↓
4. Käyttäjä vahvistaa EU-lompakossa / Suomi.fi:ssä
       ↓
5. AIMEAT vastaanottaa VP Token (Verifiable Presentation)
       ↓
6. Validointi:
   a. SD-JWT -allekirjoituksen tarkistus
   b. Myöntäjän (issuer) luotettavuus → trusted issuers -lista
   c. Attribuuttien purkaminen
       ↓
7. GHII Level 2 → Level 3, vahvistustiedot tallennetaan
   (ei raakadataa — vain hash + myöntäjä + aikaleima)
```

### 3.3.4 Uudet riippuvuudet

```bash
cd aimeat
pnpm add @sd-jwt/core @sd-jwt/types
```

| Paketti | Versio | Tarkoitus |
|---|---|---|
| `@sd-jwt/core` | ^0.x | SD-JWT -todistusten parsinta ja validointi |
| `@sd-jwt/types` | ^0.x | TypeScript-tyypit SD-JWT:lle |

**Huom:** `jose`-kirjasto (jo käytössä) tukee EdDSA JWT:tä. SD-JWT on laajennus.

### 3.3.5 Uudet endpointit

#### POST /v1/ghii/verify/eudiw

| Kenttä | Arvo |
|---|---|
| **Metodi** | POST |
| **Polku** | `/v1/ghii/verify/eudiw` |
| **Auth** | Vaatii JWT (GHII Level 1+) |
| **Content-Type** | application/json |

**Request body:**
```json
{
  "vp_token": "eyJ...",
  "presentation_submission": {
    "id": "submission-1",
    "definition_id": "aimeat-identity-verification",
    "descriptor_map": [
      { "id": "identity-credential", "format": "vc+sd-jwt", "path": "$" }
    ]
  }
}
```

**Response 200:**
```json
{
  "ok": true,
  "data": {
    "ghii": "erkki62@aimeat-finland-001-genesis",
    "verificationLevel": 3,
    "verificationMethod": "eudiw",
    "verifiedAttributes": ["name", "date_of_birth", "nationality"],
    "issuer": "https://issuer.eudiw.example.eu",
    "verifiedAt": "2026-03-15T10:00:00Z"
  }
}
```

#### GET /v1/ghii/verify/eudiw/request

| Kenttä | Arvo |
|---|---|
| **Metodi** | GET |
| **Polku** | `/v1/ghii/verify/eudiw/request` |
| **Auth** | Vaatii JWT |

**Response 200:**
Palauttaa OpenID4VP Authorization Request -objektin jonka käyttäjä skannaa EU-lompakolla (QR-koodi tai deep link).

#### POST /v1/ghii/verify/ftn

| Kenttä | Arvo |
|---|---|
| **Metodi** | POST |
| **Polku** | `/v1/ghii/verify/ftn` |
| **Auth** | Vaatii JWT |

Suomen luottamusverkon kautta tunnistautuminen (Suomi.fi). Callback-pohjainen.

### 3.3.6 W3C Verifiable Credentials — AIMEAT Attestation

AIMEAT voi myös **myöntää** Verifiable Credentials GHII-profiileille:

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://aimeat.spechops.com/ns/credentials/v1"
  ],
  "type": ["VerifiableCredential", "AIMEATIdentityCredential"],
  "issuer": "did:web:aimeat-finland-001-genesis.aimeat.example",
  "issuanceDate": "2026-03-15T10:00:00Z",
  "credentialSubject": {
    "id": "did:aimeat:erkki62@aimeat-finland-001-genesis",
    "type": "AIMEATUser",
    "verificationLevel": 3,
    "memberSince": "2026-03-01",
    "trustScore": 87
  }
}
```

**Endpoint:** `GET /v1/ghii/:ghii/credential` — Myönnä VC kyseisestä GHII-profiilista.

### 3.3.7 MyData Consent Receipt -integraatio

MyData consent receipt -malli integroituu Phase 0.3 Consent Layeriin:

```json
{
  "version": "KI-CR-v1.1.0",
  "jurisdiction": "FI",
  "consentTimestamp": "2026-03-15T10:00:00Z",
  "collectionMethod": "web form",
  "consentReceiptID": "consent-001",
  "publicKey": "...",
  "language": "fi",
  "piiPrincipalId": "erkki62@aimeat-finland-001-genesis",
  "piiControllers": [{ "piiController": "aimeat-finland-001-genesis", "onBehalf": false }],
  "services": [
    {
      "service": "AIMEAT Discovery",
      "purposes": [
        {
          "purpose": "community-discovery",
          "consentType": "EXPLICIT",
          "piiCategory": ["interests", "location"],
          "termination": "revocation"
        }
      ]
    }
  ]
}
```

**Endpoint:** `GET /v1/consent/:id/receipt` — Palauttaa MyData Consent Receipt -formaatissa.

### 3.3.8 Storage-muutokset

**GHIIRecord-laajennukset:**

```typescript
export interface GHIIRecord {
  // ... nykyiset kentät ...

  // Phase 3.3 laajennukset
  verifiedAttributes?: string[];        // ["name", "date_of_birth", "nationality"]
  verificationIssuer?: string;          // "https://issuer.eudiw.example.eu"
  verificationCredentialHash?: string;  // SHA-256 hash of the credential
  ftnVerified?: boolean;                // Suomen luottamusverkko
}
```

**Uusi record-tyyppi: TrustedIssuerRecord**

```typescript
export interface TrustedIssuerRecord {
  id: string;                  // UUID
  name: string;                // "EU Digital Identity Wallet - Finland"
  url: string;                 // "https://issuer.eudiw.example.eu"
  publicKey: string;           // Myöntäjän julkinen avain
  type: 'eudiw' | 'ftn' | 'w3c_vc' | 'custom';
  trusted: boolean;
  addedBy: string;             // Operaattori
  createdAt: string;
}
```

### 3.3.9 Konfiguraatio

```env
# ── EUDIW / Identity Verification ──────────────────────────
# AIMEAT_EUDIW_ENABLED=false
# AIMEAT_EUDIW_CLIENT_ID="aimeat-verifier-001"
# AIMEAT_EUDIW_REDIRECT_URI="https://your-node.example/v1/ghii/verify/eudiw/callback"
# AIMEAT_FTN_ENABLED=false
# AIMEAT_FTN_PROVIDER_URL="https://tunnistautuminen.suomi.fi"
# AIMEAT_VC_ISSUER_DID="did:web:your-node.example"
```

### 3.3.10 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | EUDIW: Authorization Request -generointi | Oikea OpenID4VP-rakenne |
| 2 | EUDIW: VP Token -validointi (valid) | Level → 3, attribuutit tallennettu |
| 3 | EUDIW: VP Token -validointi (expired) | 401, "Credential expired" |
| 4 | EUDIW: VP Token tuntemattomalta myöntäjältä | 403, "Untrusted issuer" |
| 5 | EUDIW disabled | 503, "EUDIW verification not available" |
| 6 | FTN: callback-validointi | Level → 3 |
| 7 | W3C VC: credential-myöntäminen | Oikea VC-rakenne |
| 8 | MyData: consent receipt -generointi | Oikea KI-CR-formaatti |
| 9 | Trusted issuer -lisäys (operaattori) | 200, issuer tallennettu |
| 10 | Trusted issuer -listaus | 200, lista |

### 3.3.11 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `src/services/eudiw.ts` — EUDIW / OpenID4VP verifier |
| **Uusi** | `src/services/vc-issuer.ts` — W3C VC credential issuer |
| **Uusi** | `src/services/mydata-receipt.ts` — MyData consent receipt generator |
| **Uusi** | `src/routes/verification.ts` — EUDIW, FTN, VC endpointit |
| **Muokataan** | `src/config.ts` — EUDIW, FTN, VC konfiguraatio |
| **Muokataan** | `src/storage/interface.ts` — GHIIRecord laajennukset, TrustedIssuerRecord |
| **Muokataan** | `src/storage/memory.ts` — In-memory toteutus |
| **Muokataan** | `src/routes/ghii.ts` — Level 3 -vahvistus integraatio |
| **Muokataan** | `openapi.yaml` — Verification-endpointit, VC schema |
| **Muokataan** | `.env.example` — EUDIW, FTN muuttujat |

---

← [Phase 3: Polish + tulevaisuus](./phase-3-polish-future.md)
