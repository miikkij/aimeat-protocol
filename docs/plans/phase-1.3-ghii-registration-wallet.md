# Phase 1.3: GHII-rekisteröinti + tietolompakko — Implementointisuunnitelma

*Osa Phase 1 "Ensimmäinen yhteisö" -kokonaisuutta. Ks. [Phase 1 yleiskatsaus](./phase-1-first-community.md)*

---

## 1.3 GHII-rekisteröinti + tietolompakko portaalissa

> Lähde: masterplan (§1.3), `docs/ghii-identity-and-network-plan.md`, Phase 0.3 (consent), Phase 0.5 (TOTP)

### 1.3.1 Tavoite

Rakentaa web-pohjainen rekisteröitymis- ja hallintaportaali jolla ihminen (Erkki-persona) voi:
1. Rekisteröityä GHII-identiteetillä ilman teknistä osaamista
2. Vahvistaa sähköpostinsa (Level 1)
3. Kirjautua magic linkillä TAI TOTP:llä
4. Hallita tietolompakkoaan: nähdä suostumukset, audit trail, peruuttaa jakaminen

### 1.3.2 Rekisteröinti-flow

**Web-lomake → GHII Tier 1:**

```
1. Lomake: nimimerkki, sähköposti, paikkakunta, kiinnostukset (monivalinta)
       ↓
2. POST /v1/ghii/register-web → luo OwnerRecord + GHIIRecord (Level 0)
       ↓
3. Lähetä vahvistuskoodi sähköpostiin (Phase 1.1 EmailService)
       ↓
4. POST /v1/ghii/verify-email → tarkista koodi → Level 0 → Level 1
       ↓
5. Kirjaudu magic linkillä TAI aseta TOTP
       ↓
6. Luo kiinnostusprofiili (Phase 0.4) + consent (Phase 0.3) automaattisesti
```

### 1.3.3 Uudet endpointit

#### POST /v1/ghii/register-web

| Kenttä | Arvo |
|---|---|
| **Metodi** | POST |
| **Polku** | `/v1/ghii/register-web` |
| **Auth** | Ei vaadita (julkinen rekisteröinti) |
| **Content-Type** | application/json |

**Request body:**
```json
{
  "username": "erkki62",
  "displayName": "Erkki",
  "email": "erkki@example.com",
  "locale": "fi",
  "city": "Espoo",
  "area": "Tapiola",
  "interests": ["lintubongaus", "puutarhanhoito", "retro-pelit"]
}
```

**Response 201:**
```json
{
  "ok": true,
  "data": {
    "ghii": "erkki62@aimeat-finland-001-genesis",
    "verificationLevel": 0,
    "emailVerificationSent": true,
    "nextStep": "verify-email"
  },
  "hints": [
    { "description": "Vahvista sähköpostiosoite", "method": "POST", "url": "/v1/ghii/verify-email" }
  ]
}
```

**Virhetilanteet:**

| HTTP | Koodi | Tilanne |
|---|---|---|
| 400 | INVALID_INPUT | Puuttuvia kenttiä tai validointivirhe |
| 409 | NAME_TAKEN | Nimimerkki varattu |
| 429 | RATE_LIMITED | Liian monta rekisteröintiä |
| 503 | EMAIL_UNAVAILABLE | SMTP ei konfiguroitu (jos emailConfirmationRequired) |

**Logiikka:**
1. Validoi input (Zod)
2. Tarkista nimen saatavuus (`getGHII`)
3. Generoi Ed25519-keypair (kuten nykyinen GHII-rekisteröinti)
4. Luo OwnerRecord + GHIIRecord (Level 0)
5. Hash email → tallenna `emailHash` GHIIRecordiin
6. Jos `emailConfirmationRequired` → lähetä vahvistuskoodi
7. Luo oletuskiinnostusprofiili memoryna (Phase 0.4 avainrakenne)
8. Luo oletus-consent: `profile.erkki62.interests` + `profile.erkki62.location` → scope: federation, purpose: discovery

#### POST /v1/ghii/verify-email

| Kenttä | Arvo |
|---|---|
| **Metodi** | POST |
| **Polku** | `/v1/ghii/verify-email` |
| **Auth** | Ei vaadita (käyttää verification ID:tä) |
| **Content-Type** | application/json |

**Request body:**
```json
{
  "verificationId": "uuid-here",
  "code": "482910"
}
```

**Response 200:**
```json
{
  "ok": true,
  "data": {
    "ghii": "erkki62@aimeat-finland-001-genesis",
    "verificationLevel": 1,
    "token": "jwt-token-here"
  },
  "hints": [
    { "description": "Siirry portaaliin", "method": "GET", "url": "/v1/portal/human/dashboard" },
    { "description": "Aseta TOTP-todennus", "method": "POST", "url": "/v1/ghii/totp/setup" }
  ]
}
```

#### POST /v1/ghii/magic-link

| Kenttä | Arvo |
|---|---|
| **Metodi** | POST |
| **Polku** | `/v1/ghii/magic-link` |
| **Auth** | Ei vaadita |
| **Content-Type** | application/json |

**Request body:**
```json
{
  "email": "erkki@example.com"
}
```

**Logiikka:**
1. Hash email → etsi GHIIRecord emailHash-kentällä
2. Generoi JWT (lyhyt TTL: 15 min) jossa `purpose: "magic_link"`
3. Lähetä email linkillä: `{baseUrl}/v1/ghii/magic-link/verify?token={jwt}`
4. GET-endpoint validoi tokenin → palauttaa normaalin JWT-tokenin

#### GET /v1/ghii/magic-link/verify

| Kenttä | Arvo |
|---|---|
| **Metodi** | GET |
| **Polku** | `/v1/ghii/magic-link/verify` |
| **Auth** | Query param: `?token={magic_link_jwt}` |

**Response:** Redirect portaaliin JWT-tokenin kanssa TAI HTML-sivu joka asettaa tokenin.

### 1.3.4 Tietolompakko-näkymä

**Portaalin "Tietolompakkoni" -sivu:**

Uusi endpoint: `GET /v1/portal/human/wallet`

Näyttää:

1. **Aktiiviset suostumukset** (kutsuu `GET /v1/consent` taustalla)
   - Mitä dataa jaetaan
   - Kenelle
   - Milloin myönnetty
   - Peru-nappi (kutsuu `DELETE /v1/consent/{id}`)

2. **Auditointiraportti** (kutsuu `GET /v1/consent/audit?days=30` taustalla)
   - Kuka on käyttänyt dataasi
   - Milloin
   - Mitä avainta

3. **GDPR-toiminnot**
   - "Vie kaikki tiedot" (kutsuu `GET /v1/gdpr/export` — nykyinen endpoint)
   - "Poista kaikki tiedot" (linkki cascade delete -toimintoon)

**Toteutus:** Server-rendered HTML (kuten nykyinen portal-human.ts), ei SPA-frameworkia.

### 1.3.5 GHIIRecord-laajennukset

**Tiedosto:** `src/storage/interface.ts`

```typescript
export interface GHIIRecord {
  // ... nykyiset kentät ...

  // Phase 1.3 laajennukset
  emailHash?: string;                     // SHA-256 hash of verified email
  emailVerifiedAt?: string;               // ISO timestamp
  verificationMethod?: 'email' | 'phone' | 'operator' | 'eidas';
  magicLinkEnabled?: boolean;             // Oletuksena true kun email vahvistettu
  lastLoginAt?: string;                   // Viimeisin kirjautuminen
  loginCount?: number;                    // Kirjautumiskertojen laskuri
}
```

#### Uudet Storage-metodit

```typescript
export interface Storage {
  // ... nykyiset GHII-metodit ...

  // Phase 1.3 laajennukset
  getGHIIByEmailHash(emailHash: string): Promise<GHIIRecord | null>;
}
```

### 1.3.6 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | Web-rekisteröinti kelvollisella datalla | 201, GHII luotu Level 0 |
| 2 | Web-rekisteröinti ilman emailia (email ei vaadittu) | 201, Level 0, ei verification-emailia |
| 3 | Web-rekisteröinti ilman emailia (email vaadittu) | 400, "Email required" |
| 4 | Email-vahvistus oikealla koodilla | 200, Level 0→1 |
| 5 | Email-vahvistus väärällä koodilla | 401, "Invalid code" |
| 6 | Magic link -pyyntö tunnetulla emaililla | 200, email lähetetty |
| 7 | Magic link -pyyntö tuntemattomalla emaililla | 200 (ei paljasta onko olemassa) |
| 8 | Magic link -tokenin vahvistus | 200, JWT palautettu |
| 9 | Vanhentunut magic link | 401, "Token expired" |
| 10 | Tietolompakko: listaa suostumukset | 200, consent-lista |
| 11 | Tietolompakko: peru suostumus | 200, consent revoked |
| 12 | Tietolompakko: audit trail | 200, viimeisimmät käytöt |
| 13 | GDPR-export | 200, JSON-tiedosto kaikesta datasta |
| 14 | Kiinnostusprofiili luotu automaattisesti rekisteröinnissä | memory-avaimet olemassa |
| 15 | Oletus-consent luotu automaattisesti | consent-recordit olemassa |

### 1.3.7 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `src/routes/portal-wallet.ts` — Tietolompakko-näkymä |
| **Uusi** | `src/services/registration.ts` — Web-rekisteröinti-logiikka |
| **Muokataan** | `src/routes/ghii.ts` — register-web, verify-email, magic-link endpointit |
| **Muokataan** | `src/routes/portal-human.ts` — Linkki tietolompakkoon |
| **Muokataan** | `src/storage/interface.ts` — GHIIRecord laajennukset, getGHIIByEmailHash |
| **Muokataan** | `src/storage/memory.ts` — emailHash-indeksi, getGHIIByEmailHash |
| **Muokataan** | `openapi.yaml` — register-web, verify-email, magic-link schemat |

---

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
