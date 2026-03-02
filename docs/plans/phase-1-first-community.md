# Phase 1: "Ensimmäinen yhteisö" — Kattava implementointisuunnitelma

*2026-03-01 — Yksityiskohtainen toteutussuunnitelma Phase 1 -komponenteille*

---

## Yleiskatsaus

Phase 1 rakentaa ensimmäisen kokonaisen end-to-end -palvelun AIMEAT-federaatioon: **harrastehakemiston**. Samalla rakennetaan ihmiskerroksen infrastruktuuria — email-järjestelmä, web-wizard, GHII-rekisteröinti portaalissa, hakemistot ja tiedon laatusuodatus.

Phase 1 on **vertical slice**: se yhdistää Phase 0:n infrastruktuurin (Schema Locking, CSM, Consent, Profiilit, Semantic Ontology) konkreettiseksi palveluksi jota oikea ihminen voi käyttää. Erkki-polku aukeaa tässä phasessa.

**Prerekvisiitit:** Koko Phase 0 on toteutettu (0.1–0.9).

**Komponentit:**

| # | Komponentti | Riippuvuudet | Arvioitu laajuus |
|---|---|---|---|
| 1.1 | Email-järjestelmä | — | Keskisuuri |
| 1.2 | Web-wizard (node setup) | Phase 0 kokonaisuudessaan | Suuri |
| 1.3 | GHII-rekisteröinti + tietolompakko portaalissa | 1.1 (email), Phase 0.3 (consent), Phase 0.5 (TOTP) | Suuri |
| 1.4 | Hakemistot (paikallinen + temaattinen) | Phase 0.4 (profiilit), Phase 0.3 (consent) | Keskisuuri |
| 1.5 | Tiedon laatusuodatus — pohja | — | Pieni |
| 1.6 | Vertical Slice: Harrastehakemisto | 1.1–1.5, Phase 0.1–0.4, Phase 0.7 | Suuri |
| 1.7 | Semanttinen ontologia (Phase 1 -rakenteet) | Phase 0.7 (ontologia) | Pieni |
| 1.8 | Dokumentaation ylläpito (Phase 1) | Kaikki | Dokumentaatio |
| 1.9 | Testausstrategia (Phase 1) | Kaikki | Keskisuuri |

**Suositeltu toteutusjärjestys:**

```
1.1 Email-järjestelmä ──────────┐
                                ├──→ 1.3 GHII-rekisteröinti + tietolompakko
1.5 Tiedon laatusuodatus ───────┤
                                ├──→ 1.4 Hakemistot ──────────────────┐
1.2 Web-wizard ─────────────────┘                                     ├──→ 1.6 Harrastehakemisto
                                                                      │
1.7 Semanttinen ontologia ───────────────────────────────────────────┘

1.8 Dokumentaation ylläpito ──→ (läpileikkaava, jokaisen komponentin yhteydessä)
1.9 Testausstrategia ─────────→ (testit per komponentti, laajennetaan E2E-suitea)
```

Komponentit 1.1, 1.2 ja 1.5 ovat toisistaan riippumattomia ja voidaan toteuttaa rinnakkain. Komponentti 1.3 riippuu 1.1:stä (email-vahvistus). Komponentti 1.4 riippuu Phase 0.4:stä (profiilit). Komponentti 1.6 yhdistää kaikki edellä olevat.

### Alidokumentit

Jokainen komponentti on dokumentoitu myös omana tiedostonaan yksityiskohtaista implementointityötä varten:

| Komponentti | Tiedosto |
|---|---|
| 1.1 Email-järjestelmä | [phase-1.1-email-system.md](./phase-1.1-email-system.md) |
| 1.2 Web-wizard | [phase-1.2-web-wizard.md](./phase-1.2-web-wizard.md) |
| 1.3 GHII-rekisteröinti + tietolompakko | [phase-1.3-ghii-registration-wallet.md](./phase-1.3-ghii-registration-wallet.md) |
| 1.4 Hakemistot | [phase-1.4-directories.md](./phase-1.4-directories.md) |
| 1.5 Tiedon laatusuodatus | [phase-1.5-data-quality-flags.md](./phase-1.5-data-quality-flags.md) |
| 1.6 Harrastehakemisto (vertical slice) | [phase-1.6-hobby-directory.md](./phase-1.6-hobby-directory.md) |
| 1.7 Semanttinen ontologia (Phase 1) | [phase-1.7-semantic-ontology.md](./phase-1.7-semantic-ontology.md) |
| 1.8 Dokumentaation ylläpito | [phase-1.8-documentation-plan.md](./phase-1.8-documentation-plan.md) |
| 1.9 Testausstrategia | [phase-1.9-testing-strategy.md](./phase-1.9-testing-strategy.md) |

Tämä yleiskatsausdokumentti sisältää kaiken saman sisällön kootusti. Alidokumentit ovat identtisiä kopioita yksittäisten komponenttien implementointia varten.

---

## 1.1 Email-järjestelmä

> Lähde: masterplan (§1.1)

### 1.1.1 Tavoite

Rakentaa email-palvelu joka mahdollistaa käyttäjien vahvistamisen, ilmoitukset ja magic link -kirjautumisen. Email-infra on perusta koko ihmiskerroksen toiminnalle: ilman sitä ei voi vahvistaa identiteettiä, lähettää matchaus-ehdotuksia tai ilmoittaa tapahtumista.

**Suunnitteluperiaate:** Email on *opt-in -infra*. Jos operaattori ei konfiguroi SMTP:tä, kaikki email-ominaisuudet disabloituvat gracefully. Mitään ei hajoa — email-riippuvaiset polut vain näyttävät viestin "Email ei käytettävissä tällä nodella".

### 1.1.2 Uudet riippuvuudet

```bash
cd aimeat
pnpm add nodemailer
pnpm add -D @types/nodemailer
```

| Paketti | Versio | Koko | Tarkoitus |
|---|---|---|---|
| `nodemailer` | ^6.x | ~200KB | SMTP-yhteys ja email-lähetys |
| `@types/nodemailer` | ^6.x | ~15KB | TypeScript-tyypit (dev) |

### 1.1.3 Konfiguraatio

#### MeatConfig-laajennukset

**Tiedosto:** `src/config.ts`

```typescript
export interface MeatConfig {
  // ... nykyiset kentät ...

  // Email (Phase 1.1)
  smtpHost: string | null;
  smtpPort: number;
  smtpUser: string | null;
  smtpPass: string | null;
  smtpFrom: string;
  smtpSecure: boolean;                    // true = TLS, false = STARTTLS
  emailConfirmationRequired: boolean;     // Operaattori päättää: vaaditaanko email-vahvistus
  emailEnabled: boolean;                  // Laskettu: smtpHost !== null
}
```

#### Ympäristömuuttujat

```env
# ── Email / SMTP ─────────────────────────────────────────────
# AIMEAT_SMTP_HOST="smtp.example.com"
# AIMEAT_SMTP_PORT=587
# AIMEAT_SMTP_USER="noreply@example.com"
# AIMEAT_SMTP_PASS="secret"
# AIMEAT_SMTP_FROM="AIMEAT <noreply@example.com>"
# AIMEAT_SMTP_SECURE=false                    # true = TLS (port 465), false = STARTTLS (port 587)
# AIMEAT_EMAIL_CONFIRMATION_REQUIRED=false    # true = GHII Level 1 requires email
```

#### Graceful degradation

`loadConfig()`:ssä:
```typescript
const smtpHost = process.env.AIMEAT_SMTP_HOST || null;
const emailEnabled = smtpHost !== null;

if (!emailEnabled) {
  logger.warn('SMTP not configured — email features disabled');
}
```

### 1.1.4 Uusi service: Email

**Tiedosto:** `src/services/email.ts`

```typescript
export interface EmailService {
  readonly enabled: boolean;

  sendVerificationCode(to: string, code: string, locale?: string): Promise<boolean>;
  sendMagicLink(to: string, loginUrl: string, locale?: string): Promise<boolean>;
  sendNotification(to: string, subject: string, body: string): Promise<boolean>;
  sendMatchSuggestion(to: string, matches: MatchSuggestion[], locale?: string): Promise<boolean>;
}

export interface MatchSuggestion {
  ghii: string;
  displayName: string;
  sharedInterests: string[];
  distance?: string;    // esim. "Tapiolassa"
}

export function createEmailService(config: MeatConfig): EmailService;
```

**Sisäinen toteutus:**

1. **Transporter:** `nodemailer.createTransport()` — luodaan kerran startup-aikana, uudelleenkäytetään
2. **Retry-logiikka:** 3 yritystä, exponential backoff (1s, 3s, 9s)
3. **Template-engine:** Ei ulkoista kirjastoa — HTML-pohjat template literal -funktioina:
   - `verificationEmailHtml(code, locale)` → HTML + plain text fallback
   - `magicLinkEmailHtml(loginUrl, locale)` → HTML + plain text
   - `notificationEmailHtml(subject, body, locale)` → HTML + plain text
   - `matchSuggestionEmailHtml(matches, locale)` → HTML + plain text
4. **Locale-tuki:** `fi` ja `en` aluksi. Fallback: `en`.
5. **Logging:** Jokainen lähetys loggaa (onnistunut/epäonnistunut) winston-loggerilla, ei loggaa sähköpostiosoitteita (yksityisyys)

### 1.1.5 Storage-muutokset

#### Uusi record-tyyppi: EmailVerificationRecord

**Tiedosto:** `src/storage/interface.ts`

```typescript
export interface EmailVerificationRecord {
  id: string;                     // UUID
  ownerName: string;              // Kenelle (viittaa OwnerRecord.name)
  emailHash: string;              // SHA-256 hash of email (ei tallenneta raakaa emailia)
  code: string;                   // 6-numeroinen vahvistuskoodi (hash)
  purpose: 'registration' | 'login' | 'change';
  status: 'pending' | 'verified' | 'expired';
  attempts: number;               // Yrityskerrat (max 5)
  expiresAt: string;              // 15 min voimassa
  createdAt: string;
  verifiedAt: string | null;
}
```

#### Uudet Storage-metodit

```typescript
export interface Storage {
  // ... nykyiset metodit ...

  // Email Verification (Phase 1.1)
  createEmailVerification(record: EmailVerificationRecord): Promise<EmailVerificationRecord>;
  getEmailVerification(id: string): Promise<EmailVerificationRecord | null>;
  getActiveEmailVerification(ownerName: string, purpose: string): Promise<EmailVerificationRecord | null>;
  updateEmailVerification(id: string, updates: Partial<EmailVerificationRecord>): Promise<EmailVerificationRecord | null>;
  deleteExpiredEmailVerifications(): Promise<number>;   // Cleanup-job
}
```

#### In-memory -toteutus

**Tiedosto:** `src/storage/memory.ts`

```typescript
private emailVerifications = new Map<string, EmailVerificationRecord>();
```

### 1.1.6 Turvallisuuskäytännöt

| Käytäntö | Toteutus |
|---|---|
| Email ei tallenneta | Vain SHA-256-hash, ei raakaa osoitetta |
| Verification code | 6 numeroa, SHA-256-hash storagessa |
| Rate limiting | Max 3 koodia/tunti/owner, max 5 yritystä/koodi |
| Vanheneminen | 15 min, automaattinen cleanup |
| Retry | 3 yritystä, exponential backoff |
| SMTP credentials | Ympäristömuuttujista, ei loggata |

### 1.1.7 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | Email-palvelu ilman SMTP-konfiguraatiota | `enabled: false`, ei virheitä |
| 2 | Verification code -lähetys (mocked SMTP) | Email lähetetty, record luotu |
| 3 | Verification code -vahvistus oikealla koodilla | Status → verified |
| 4 | Verification code -vahvistus väärällä koodilla | Attempts +1, status pysyy pending |
| 5 | 5 väärää yritystä | Status → expired, koodi lukittu |
| 6 | Vanhentunut koodi | 401, "Code expired" |
| 7 | Rate limiting: 4. koodi samalle ownerille | 429, "Too many verification requests" |
| 8 | Magic link -lähetys | Email lähetetty, URL oikein |
| 9 | Match suggestion -email | Email sisältää matchit oikein formatoituna |
| 10 | Template locale fi | Suomenkielinen email |
| 11 | Template locale en (fallback) | Englanninkielinen email |
| 12 | SMTP-virhe → retry | 3 yritystä, viimeinen onnistuu |

### 1.1.8 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `src/services/email.ts` — EmailService + templates |
| **Uusi** | `src/services/email-templates.ts` — HTML/plain text templates |
| **Muokataan** | `src/config.ts` — SMTP-konfiguraatio MeatConfigiin |
| **Muokataan** | `src/storage/interface.ts` — EmailVerificationRecord + metodit |
| **Muokataan** | `src/storage/memory.ts` — In-memory toteutus |
| **Muokataan** | `src/server.ts` — EmailService-instanssin luonti |
| **Muokataan** | `.env.example` — SMTP-muuttujat |
| **Muokataan** | `openapi.yaml` — EmailVerification-schema |

---

## 1.2 Web-wizard (node setup)

> Lähde: masterplan (§1.2), `docs/nextlevel/aimeat-personal-node-spec.md`

### 1.2.1 Tavoite

Rakentaa web-pohjainen konfigurointityökalu joka aktivoituu kun AIMEAT-node käynnistetään ensimmäisen kerran ilman konfiguraatiota. Wizard korvaa manuaalisen `.env`-tiedoston muokkauksen graafisella käyttöliittymällä.

**Tunnistus:** Kun `config.json` puuttuu TAI ympäristömuuttuja `AIMEAT_SETUP_MODE=true` → Express servaa wizard-UI:n kaikkien normaalien routejen sijaan.

### 1.2.2 Wizard-flow

5 askelta:

| Askel | Sisältö | Tallennetaan |
|---|---|---|
| 1. Tervetuloa | Kieli (fi/en), mikä on AIMEAT, mitä wizard tekee | `locale` |
| 2. Node-perustiedot | Noden nimi, tyyppi (personal/full), portti, base URL | `nodeId`, `nodeType`, `port`, `baseUrl` |
| 3. Identiteetti | GHII-identiteetti: luo uusi TAI tuo olemassaoleva (import keypair) | `ownerName`, `displayName`, keypair |
| 4. Ankkurioperaattori | Valinta listalta (genesis-nodet) TAI custom URL | `anchorNodeId`, `anchorUrl` |
| 5. Yhteenveto | Kaikki asetukset yhteenvetona, "Käynnistä" -nappi | → `config.json` + `.env` |

### 1.2.3 Arkkitehtuuri

**Server-side:**

```
Wizard Mode (setup):
  GET  /setup                  → Wizard HTML/JS/CSS (SPA)
  GET  /setup/status           → Nykyinen tila (mikä askel)
  POST /setup/step/:n          → Tallenna askel
  POST /setup/complete         → Kirjoita config + restart
  GET  /setup/discover-anchors → Hae tunnetut genesis-nodet
```

**Toteutustapa:**
- Wizard on **minimaalinen SPA** (Single Page Application) ilman build-steppejä
- HTML + vanilla JS + CSS — ei React/Vue/bundleria
- Yksi `wizard.html` + `wizard.js` + `wizard.css` — servataan Express-staattisina tiedostoina
- Server-side validointi joka stepissä (Zod)
- Wizard-state pidetään muistissa (ei persistoida ennen "Complete")

**Miksi ei bundleria?** Koska:
1. Wizard käytetään kerran — ei tarvitse optimoida
2. Ei lisää build-riippuvuuksia
3. Pidetään deployment yksinkertaisena

### 1.2.4 Storage-muutokset

Wizard ei luo uusia record-tyyppejä. Se kirjoittaa:

1. **`config.json`** — Noden konfiguraatio (JSON, luettavissa startupissa)
2. **`.env`** — Ympäristömuuttujat (generoidaan config.json:n pohjalta)
3. **OwnerRecord** — Ensimmäinen omistaja (wizard kutsuu olemassaolevaa `/v1/owners` -endpointia sisäisesti)
4. **GHIIRecord** — Ensimmäinen GHII-identiteetti (wizard kutsuu `/v1/ghii` -endpointia)

### 1.2.5 Konfiguraatio

#### Uudet ympäristömuuttujat

```env
# ── Setup ─────────────────────────────────────────────────
# AIMEAT_SETUP_MODE=false          # true = pakota wizard-moodi
# AIMEAT_SETUP_ALLOWED_IPS="127.0.0.1,::1"  # Wizard saavutettavissa vain näistä IP:istä
```

#### MeatConfig-laajennukset

```typescript
export interface MeatConfig {
  // ... nykyiset kentät ...

  // Wizard (Phase 1.2)
  setupMode: boolean;
  setupAllowedIps: string[];
}
```

### 1.2.6 Turvallisuuskäytännöt

| Käytäntö | Toteutus |
|---|---|
| IP-rajoitus | Wizard vain localhost:lta (oletuksena), konfiguroitava |
| HTTPS-kehotus | Wizard varoittaa jos ei localhost eikä HTTPS |
| Password-vahvuus | Minimum 12 merkkiä, admin-salasanalle |
| Config-kirjoitus | Atominen: kirjoita temp → rename (ei korruptoidu crashissa) |
| Ei uudelleenaktivoidu | Kun config.json on olemassa, wizard on disabled |

### 1.2.7 Uusi route: Wizard

**Tiedosto:** `src/routes/wizard.ts`

```typescript
export function wizardRouter(config: MeatConfig, storage: Storage): Router {
  const router = Router();

  // Serve wizard SPA
  router.get('/setup', (req, res) => { /* serve wizard.html */ });

  // API endpoints for wizard steps
  router.get('/setup/status', (req, res) => { /* current state */ });
  router.post('/setup/step/:n', (req, res) => { /* validate + save step */ });
  router.post('/setup/complete', (req, res) => { /* write config, signal restart */ });
  router.get('/setup/discover-anchors', (req, res) => { /* known genesis nodes */ });

  return router;
}
```

### 1.2.8 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | GET /setup ilman config.json → wizard HTML | 200, HTML |
| 2 | GET /setup kun config.json on olemassa | 403 tai redirect → / |
| 3 | POST /setup/step/1 kelvollisella datalla | 200, step tallennettu |
| 4 | POST /setup/step/2 puuttuvalla nimellä | 400, validointivirhe |
| 5 | POST /setup/step/3 uudella identiteetillä | 200, keypair generoitu |
| 6 | POST /setup/step/3 importoidulla keypairilla | 200, keypair validoitu |
| 7 | POST /setup/complete kaikki stepit täytetty | 200, config.json kirjoitettu |
| 8 | POST /setup/complete puuttuvilla stepeillä | 400, "Steps 3-4 missing" |
| 9 | GET /setup ei-sallitusta IP:stä | 403 |
| 10 | Discover-anchors palauttaa tunnetut nodet | 200, lista |

### 1.2.9 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `src/routes/wizard.ts` — Wizard-backend |
| **Uusi** | `src/static/wizard.html` — Wizard SPA |
| **Uusi** | `src/static/wizard.js` — Wizard frontend-logiikka |
| **Uusi** | `src/static/wizard.css` — Wizard tyylit |
| **Muokataan** | `src/config.ts` — setupMode, setupAllowedIps |
| **Muokataan** | `src/server.ts` — Wizard-moodi tarkistus, staattisten tiedostojen palvelu |
| **Muokataan** | `.env.example` — SETUP-muuttujat |

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

## 1.4 Hakemistot (paikallinen + temaattinen)

> Lähde: masterplan (§1.4), Phase 0.4 (kiinnostusprofiilit)

### 1.4.1 Tavoite

Rakentaa hakemistojärjestelmä joka indeksoi käyttäjien kiinnostusprofiileista (Phase 0.4) paikallisia ja temaattisia hakemistoja. Hakemiston kautta voi etsiä ihmisiä, ryhmiä ja palveluita maantieteellisesti tai kiinnostusten perusteella.

**Esimerkkejä:**
- "Espoossa 15 jäsentä, 3 ryhmää kiinnostunut lintubongauksesta"
- "Lintubongaus: 28 jäsentä, 5 ryhmää koko federaatiossa"

### 1.4.2 Uudet endpointit

#### GET /v1/catalogue/directory

| Kenttä | Arvo |
|---|---|
| **Metodi** | GET |
| **Polku** | `/v1/catalogue/directory` |
| **Auth** | Tier 0 (julkinen) TAI JWT (henkilökohtaiset tulokset) |
| **Query** | `?type=people&city=Espoo&interest=lintubongaus&radius_km=10&page=1&per_page=20` |

**Query-parametrit:**

| Parametri | Tyyppi | Oletus | Kuvaus |
|---|---|---|---|
| `type` | string | `people` | `people`, `organisms`, `services`, `all` |
| `city` | string | — | Paikkakunta (profile.*.location.city) |
| `area` | string | — | Alue (profile.*.location.area) |
| `country` | string | `FI` | Maa (ISO 3166-1) |
| `interest` | string | — | Kiinnostus (profile.*.interests contains) |
| `interests` | string[] | — | Useampi kiinnostus (OR-haku) |
| `radius_km` | number | 50 | Maantieteellinen säde (vaatii geo-koordinaatit) |
| `lat` | number | — | Latitude (WGS84) |
| `lon` | number | — | Longitude (WGS84) |
| `page` | number | 1 | Sivu |
| `per_page` | number | 20 | Tuloksia per sivu (max 100) |

**Response 200:**
```json
{
  "ok": true,
  "data": {
    "type": "people",
    "total": 15,
    "results": [
      {
        "ghii": "erkki62@aimeat-finland-001-genesis",
        "displayName": "Erkki",
        "interests": ["lintubongaus", "puutarhanhoito"],
        "location": { "city": "Espoo", "area": "Tapiola" },
        "bio": "Eläkkeellä oleva insinööri, harrastaa lintubongausta",
        "sharedInterests": ["lintubongaus"],
        "distance_km": 2.3
      }
    ],
    "facets": {
      "cities": [{ "name": "Espoo", "count": 15 }, { "name": "Helsinki", "count": 8 }],
      "interests": [{ "name": "lintubongaus", "count": 28 }, { "name": "retro-pelit", "count": 12 }]
    },
    "page": 1,
    "per_page": 20,
    "total_pages": 1
  }
}
```

#### GET /v1/catalogue/directory/stats

| Kenttä | Arvo |
|---|---|
| **Metodi** | GET |
| **Polku** | `/v1/catalogue/directory/stats` |
| **Auth** | Tier 0 (julkinen) |

**Response 200:**
```json
{
  "ok": true,
  "data": {
    "total_people": 142,
    "total_organisms": 12,
    "top_interests": ["lintubongaus", "retro-pelit", "puutarhanhoito", "kalastus", "pyöräily"],
    "top_cities": ["Helsinki", "Espoo", "Tampere", "Turku"],
    "updated_at": "2026-03-15T14:30:00Z"
  }
}
```

### 1.4.3 Uusi service: Directory Index

**Tiedosto:** `src/services/directory.ts`

```typescript
export interface DirectoryService {
  // Indeksoi profiilit hakemistoon (kutsutaan kun profiili päivittyy)
  indexProfile(ownerName: string): Promise<void>;
  removeProfile(ownerName: string): Promise<void>;

  // Haku
  searchPeople(query: DirectoryQuery): Promise<DirectoryResult>;
  getStats(): Promise<DirectoryStats>;

  // Geo-haku
  findNearby(lat: number, lon: number, radiusKm: number, interest?: string): Promise<DirectoryResult>;
}

export interface DirectoryQuery {
  type: 'people' | 'organisms' | 'services' | 'all';
  city?: string;
  area?: string;
  country?: string;
  interests?: string[];
  lat?: number;
  lon?: number;
  radiusKm?: number;
  page: number;
  perPage: number;
}

export interface DirectoryEntry {
  ghii: string;
  displayName: string;
  interests: string[];
  location: { city?: string; area?: string; country?: string; geo?: [number, number] };
  bio?: string;
  sharedInterests?: string[];
  distanceKm?: number;
}

export interface DirectoryResult {
  total: number;
  results: DirectoryEntry[];
  facets: {
    cities: { name: string; count: number }[];
    interests: { name: string; count: number }[];
  };
}
```

**Indeksointilogiikka:**

1. Lue `profile.{owner}.interests` + `profile.{owner}.location` memory-avaimista
2. Tarkista consent: onko profiilille `scope: federation` consent `purpose: discovery` datapatterneille
3. Vain consentoidut profiilit näkyvät hakemistossa
4. Haversine-kaava geo-etäisyyden laskentaan (ei tarvita ulkoista kirjastoa)
5. Facet-aggregaatio: laske kaupungit ja kiinnostukset suoraan indeksistä

**Haversine-implementaatio:**

```typescript
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Maan säde km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
```

### 1.4.4 Storage-muutokset

Hakemisto ei luo uutta record-tyyppiä. Se **lukee** olemassolevia:
- `MemoryRecord` (profile.*.interests, profile.*.location) — Phase 0.4
- `ConsentRecord` (onko profiili consentoitu) — Phase 0.3
- `GHIIRecord` (displayName, bio, avatar)

**In-memory directory index:**

```typescript
// DirectoryService pitää in-memory -indeksiä joka päivittyy
// kun profiili-memory tai consent muuttuu

private index = new Map<string, DirectoryEntry>();

// Rebuild periodically or on memory/consent change hooks
```

### 1.4.5 Integraatio Consent Layeriin

Hakemisto kunnioittaa Phase 0.3 Consent Layeria tiukasti:

1. **Profiili näkyy hakemistossa** vain jos on aktiivinen consent:
   - `dataPattern`: `profile.{owner}.*` tai tarkempi
   - `scope`: `federation` (tai `dmz`)
   - `purpose`: `discovery` (tai laajempi)
   - `status`: `active`

2. **Consent peruttu** → profiili poistuu hakemistosta välittömästi
3. **Consent vanhentunut** → profiili poistuu expiry-tarkistuksessa

### 1.4.6 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | Hakemistohaku ilman parametreja | 200, kaikki consentoidut profiilit |
| 2 | Hakemistohaku kaupungilla (city=Espoo) | 200, vain Espoon profiilit |
| 3 | Hakemistohaku kiinnostuksella (interest=lintubongaus) | 200, vain lintubongaajat |
| 4 | Hakemistohaku kaupunki + kiinnostus | 200, AND-ehto |
| 5 | Hakemistohaku useammalla kiinnostuksella | 200, OR-ehto |
| 6 | Geo-haku (lat, lon, radius_km) | 200, etäisyydet laskettu |
| 7 | Profiili ilman consentia EI näy hakemistossa | Tulos ei sisällä kyseistä profiilia |
| 8 | Consent peruttu → profiili poistuu | Uudelleenhaku ei palauta profiilia |
| 9 | Hakemiston tilastot | 200, oikeat luvut |
| 10 | Facetit (kaupungit, kiinnostukset) | Oikeat luvut per facet |
| 11 | Paginaatio (page=2, per_page=5) | Oikea sivu palautettu |
| 12 | Tyhjä hakemisto | 200, total: 0, results: [] |

### 1.4.7 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `src/services/directory.ts` — DirectoryService + Haversine |
| **Muokataan** | `src/routes/catalogue.ts` — /catalogue/directory, /catalogue/directory/stats |
| **Muokataan** | `src/server.ts` — DirectoryService-instanssin luonti |
| **Muokataan** | `openapi.yaml` — directory-endpointit, DirectoryEntry-schema |

---

## 1.5 Tiedon laatusuodatus — pohja

> Lähde: masterplan (§1.5), Data Description Convention

### 1.5.1 Tavoite

Rakentaa perus-flaggausmekanismi jolla käyttäjät voivat raportoida huonolaatuista tai sopimatonta sisältöä. Tämä on pohja joka laajennetaan Phase 2:ssa moderointityökaluiksi.

### 1.5.2 Storage-muutokset

#### Uusi record-tyyppi: FlagRecord

**Tiedosto:** `src/storage/interface.ts`

```typescript
export interface FlagRecord {
  id: string;                     // UUID
  targetType: 'memory' | 'board_post' | 'action' | 'agent';
  targetId: string;               // memory key, post ID, action ID, tai agent GAII
  flaggedBy: string;              // GAII tai GHII joka flaggasi
  reason: 'unreliable' | 'inappropriate' | 'illegal' | 'spam' | 'other';
  description?: string;           // Vapaamuotoinen selitys (max 500 merkkiä)
  status: 'active' | 'dismissed' | 'actioned';
  reviewedBy?: string;            // Moderaattori/operaattori GAII
  reviewedAt?: string;
  createdAt: string;
}

export interface FlagSummary {
  targetType: string;
  targetId: string;
  totalFlags: number;
  byReason: Record<string, number>;   // { unreliable: 2, spam: 1 }
  latestFlag: string;                  // ISO timestamp
}
```

#### Uudet Storage-metodit

```typescript
export interface Storage {
  // ... nykyiset metodit ...

  // Flags (Phase 1.5)
  createFlag(record: FlagRecord): Promise<FlagRecord>;
  getFlag(id: string): Promise<FlagRecord | null>;
  getFlagsByTarget(targetType: string, targetId: string): Promise<FlagRecord[]>;
  getFlagByUser(targetType: string, targetId: string, flaggedBy: string): Promise<FlagRecord | null>;
  getFlagSummary(targetType: string, targetId: string): Promise<FlagSummary | null>;
  updateFlag(id: string, updates: Partial<FlagRecord>): Promise<FlagRecord | null>;
  listFlags(opts?: { status?: string; targetType?: string; page?: number; perPage?: number }): Promise<FlagRecord[]>;
}
```

### 1.5.3 Uudet endpointit

#### POST /v1/flags

| Kenttä | Arvo |
|---|---|
| **Metodi** | POST |
| **Polku** | `/v1/flags` |
| **Auth** | Vaatii JWT (requireAuth) |
| **Rooli** | agent tai owner |
| **Content-Type** | application/json |

**Request body:**
```json
{
  "targetType": "memory",
  "targetId": "profile.someone.interests",
  "reason": "spam",
  "description": "Profiili sisältää mainoksia"
}
```

**Response 201:**
```json
{
  "ok": true,
  "data": {
    "id": "flag-uuid",
    "targetType": "memory",
    "targetId": "profile.someone.interests",
    "reason": "spam",
    "status": "active"
  }
}
```

**Virhetilanteet:**

| HTTP | Koodi | Tilanne |
|---|---|---|
| 400 | INVALID_INPUT | Puuttuvia kenttiä |
| 404 | NOT_FOUND | Kohde ei ole olemassa |
| 409 | ALREADY_FLAGGED | Käyttäjä on jo flaggannut tämän kohteen |

#### GET /v1/flags/summary/:targetType/:targetId

| Kenttä | Arvo |
|---|---|
| **Metodi** | GET |
| **Polku** | `/v1/flags/summary/:targetType/:targetId` |
| **Auth** | Tier 0 (julkinen) |

**Response 200:**
```json
{
  "ok": true,
  "data": {
    "targetType": "memory",
    "targetId": "profile.someone.interests",
    "totalFlags": 3,
    "byReason": { "spam": 2, "unreliable": 1 },
    "latestFlag": "2026-03-15T10:00:00Z"
  }
}
```

#### GET /v1/flags (operaattori)

| Kenttä | Arvo |
|---|---|
| **Metodi** | GET |
| **Polku** | `/v1/flags` |
| **Auth** | Vaatii JWT + operator-rooli |
| **Query** | `?status=active&targetType=memory&page=1&per_page=20` |

#### PUT /v1/flags/:id (operaattori)

| Kenttä | Arvo |
|---|---|
| **Metodi** | PUT |
| **Polku** | `/v1/flags/:id` |
| **Auth** | Vaatii JWT + operator-rooli |
| **Content-Type** | application/json |

**Request body:**
```json
{
  "status": "dismissed"
}
```

### 1.5.4 Integraatio memory-hakuun

**Muutokset `src/routes/memory.ts`:**

Memory GET/search -endpointeissa:
- Lisää query-parametri: `?max_flags=N` (oletus: ei rajoitusta)
- Kun `max_flags=0`: suodata pois kaikki flaggatut
- Kun `max_flags=3`: näytä vain alle 3 flagia saaneet
- Flag-counter haetaan FlagSummary:sta

### 1.5.5 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | Flaggaa memory-avain | 201, flag luotu |
| 2 | Flaggaa sama kohde uudestaan | 409, ALREADY_FLAGGED |
| 3 | Flaggaa ilman authia | 401 |
| 4 | Flag summary (3 flagia) | 200, totalFlags: 3 |
| 5 | Flag summary (ei flageja) | 200, totalFlags: 0 |
| 6 | Memory-haku max_flags=0 (flagattuja on) | Flagatut puuttuvat tuloksista |
| 7 | Memory-haku ilman max_flags | Kaikki näkyvät |
| 8 | Operaattori listaa flagit | 200, flagi-lista |
| 9 | Operaattori dismiss flag | 200, status: dismissed |
| 10 | Ei-operaattori yrittää dismiss flagia | 403 |
| 11 | Flaggaa olematonta kohdetta | 404, NOT_FOUND |

### 1.5.6 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `src/routes/flags.ts` — Flag-endpointit |
| **Muokataan** | `src/storage/interface.ts` — FlagRecord, FlagSummary, flag-metodit |
| **Muokataan** | `src/storage/memory.ts` — In-memory flag-toteutus |
| **Muokataan** | `src/routes/memory.ts` — max_flags-suodatus |
| **Muokataan** | `src/server.ts` — flagsRouter mount |
| **Muokataan** | `openapi.yaml` — Flag-endpointit ja -schemat |

---

## 1.6 Vertical Slice: Harrastehakemisto

> Lähde: masterplan (§1.6)

### 1.6.1 Tavoite

Rakentaa ensimmäinen kokonainen CSM-pohjainen palvelu: **harrastehakemisto**. Tämä on AIMEAT:n "Hello World" — todiste siitä, että protokolla tuottaa oikeaa arvoa oikeille ihmisille.

**Harrastehakemisto yhdistää:**
- Phase 0.1: Schema Locking (profiilien validointi)
- Phase 0.2: CSM (palvelukuvaus)
- Phase 0.3: Consent Layer (datan jakamisen hallinta)
- Phase 0.4: Kiinnostusprofiilit (standardoitu profiilidata)
- Phase 0.7: Semanttinen ontologia (schema.org-annotaatiot)
- Phase 1.1: Email (ilmoitukset)
- Phase 1.3: GHII-rekisteröinti (Erkki-polku)
- Phase 1.4: Hakemistot (maantieteellinen + temaattinen haku)
- Phase 1.5: Flaggaus (sisällön laatu)

### 1.6.2 CSM-kuvaus

**Tiedosto:** `docs/csm-examples/hobby-directory.csm.yaml`

```yaml
csm: "1.0"
service:
  name: "Harrastehakemisto"
  type: "directory"
  description: "Löydä harrastuksia ja samanhenkisiä ihmisiä läheltäsi"
  locale: "fi"

schema_mode: "open"

data_schema:
  required:
    interests:
      type: array
      items: { type: string }
      minItems: 1
    location:
      type: object
      properties:
        city: { type: string }
        country: { type: string, default: "FI" }
      required: [city]
  optional:
    bio: { type: string, maxLength: 500 }
    availability: { type: string, enum: ["anytime", "mornings", "evenings", "weekends", "evenings-weekends"] }
    seeking: { type: array, items: { type: string } }

consent_requirements:
  visibility_default: "federation"
  requires_consent: true
  consent_purpose: "community-discovery"
  data_retention: "until_revoked"

moderation:
  flags_enabled: true
  auto_hide_threshold: 5
  appeals_enabled: false

ui_hints:
  list_view: ["displayName", "interests", "location.city"]
  detail_view: ["displayName", "bio", "interests", "location", "availability", "seeking"]
  search_fields: ["interests", "location.city", "location.area"]
```

### 1.6.3 Portaali-UI

**Harrastehakemiston portaali-sivut:**

| Sivu | Polku | Kuvaus |
|---|---|---|
| Etusivu | `/v1/portal/human/hobbies` | Selaa harrastuksia kategorioittain |
| Haku | `/v1/portal/human/hobbies/search` | Hae kiinnostuksen + sijainnin perusteella |
| Profiili | `/v1/portal/human/hobbies/profile/:ghii` | Näe toisen harrastajan profiili |
| Ilmoittaudu | `/v1/portal/human/hobbies/join` | Luo oma profiili + consent |
| Omat tiedot | `/v1/portal/human/hobbies/me` | Muokkaa profiilia, näe ketkä näkee |

**UI-toteutus:** Server-rendered HTML (kuten portal-human.ts). Ei SPA-frameworkia.

### 1.6.4 Toimintalogiikka

#### Erkki-polku (end-to-end):

```
1. Erkki avaa portaalin → /v1/portal/human
       ↓
2. "Rekisteröidy" → /v1/portal/human/register (Phase 1.3)
   - Syöttää: Erkki, erkki@email.fi, Espoo/Tapiola, [lintubongaus, puutarhanhoito]
       ↓
3. Saa vahvistussähköpostin → vahvistaa → Level 1
       ↓
4. Ohjataan harrastehakemistoon → /v1/portal/human/hobbies
       ↓
5. Näkee: "Tapiolassa 3 muuta lintubongaajaa"
       ↓
6. Klikkaa profiilia → näkee Antin profiilin (consent sallii)
       ↓
7. Saa sähköpostin: "Tapiolassa 2 uutta lintubongaajaa tällä viikolla"
```

#### Email-ilmoitukset

**Uusi background-job:** `matchNotificationJob`

Logiikka:
1. Käy läpi hakemiston indeksi
2. Etsi profiilit joilla on uusia matcheja (edellisen ajokierroksen jälkeen lisättyjä)
3. Jos matcheja löytyy JA käyttäjällä on emailHash + consent ilmoituksiin → lähetä email
4. `sendMatchSuggestion()` (Phase 1.1 EmailService)

**Konfiguraatio:**
```env
# AIMEAT_MATCH_NOTIFICATION_INTERVAL_HOURS=24    # Kuinka usein tarkistetaan
# AIMEAT_MATCH_NOTIFICATION_ENABLED=true          # Operaattori voi disabloida
```

### 1.6.5 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | CSM-tiedoston parsinta → schema luotu | Oikeat validoinnit |
| 2 | Rekisteröityminen → profiili näkyy hakemistossa | Erkki löytyy hakemistosta |
| 3 | Haku: city=Espoo, interest=lintubongaus | Erkki löytyy |
| 4 | Profiili näkyy vain consentilla | Ilman consentia ei löydy |
| 5 | Consent peruttu → profiili poistuu hakemistosta | Ei löydy |
| 6 | Flaggaus → auto-hide 5 flagilla | Profiili piilossa |
| 7 | Email-ilmoitus uusista matcheista | Email lähetetty (mocked) |
| 8 | End-to-end: rekisteröinti → haku → profiili → match-email | Koko polku toimii |

### 1.6.6 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `docs/csm-examples/hobby-directory.csm.yaml` — CSM-kuvaus |
| **Uusi** | `src/routes/portal-hobbies.ts` — Harrastehakemiston portaali |
| **Uusi** | `src/services/match-notification.ts` — Match-ilmoitus-job |
| **Muokataan** | `src/routes/portal-human.ts` — Linkki harrastehakemistoon |
| **Muokataan** | `src/server.ts` — portal-hobbies mount, notification-job |
| **Muokataan** | `src/config.ts` — matchNotificationIntervalHours, matchNotificationEnabled |
| **Muokataan** | `.env.example` — MATCH_NOTIFICATION -muuttujat |

---

## 1.7 Semanttinen ontologia (Phase 1 -rakenteet)

> Lähde: Phase 0.7 (ontologia), Phase 0.7b (retrofit), `docs/nextlevel/aimeat-data-description-convention.md`

### 1.7.1 Tavoite

Varmistaa, että kaikki Phase 1:n uudet record-tyypit ja endpointit tukevat Phase 0.7:ssä määriteltyä semanttista ontologiaa. Kaikki uudet rakenteet saavat valinnaisen `semantic?`-kentän.

### 1.7.2 Phase 1 -rakenteiden semanttiset annotaatiot

#### EmailVerificationRecord — ei tarvitse semanttista annotaatiota

Sisäinen tekninen record, ei jaeta federaatiossa eikä katalogissa.

#### FlagRecord

```typescript
// Ei tarvitse semanttista annotaatiota
// Sisäinen moderointityökalu, ei julkista dataa
```

#### DirectoryEntry (hakemiston tuloste)

```json
{
  "semantic": {
    "@context": {
      "schema": "https://schema.org/"
    },
    "@type": "schema:Person",
    "schema:knowsAbout": ["lintubongaus", "puutarhanhoito"],
    "schema:homeLocation": {
      "@type": "schema:Place",
      "schema:address": {
        "@type": "schema:PostalAddress",
        "schema:addressLocality": "Espoo",
        "schema:addressRegion": "Uusimaa",
        "schema:addressCountry": "FI"
      }
    }
  }
}
```

#### CSM-palvelukuvaus (harrastehakemisto)

```json
{
  "semantic": {
    "@context": {
      "schema": "https://schema.org/"
    },
    "@type": "schema:WebApplication",
    "schema:applicationCategory": "DirectoryService",
    "schema:audience": {
      "@type": "schema:PeopleAudience",
      "schema:suggestedAge": "16+"
    }
  }
}
```

#### Match-ilmoitus (email-konteksti)

```json
{
  "semantic": {
    "@context": { "schema": "https://schema.org/" },
    "@type": "schema:Message",
    "schema:about": "community-discovery-match",
    "schema:sender": "match-agent@aimeat-finland-001"
  }
}
```

### 1.7.3 Vaikutus endpointeihin

| Endpoint | Semantic-kenttä | Ontologia |
|---|---|---|
| `GET /v1/catalogue/directory` | Valinnainen `semantic` per DirectoryEntry | schema:Person + schema:Place |
| `GET /v1/catalogue/directory/stats` | Ei tarvita | — |
| `POST /v1/flags` | Ei tarvita | — |
| `GET /v1/flags/summary` | Ei tarvita | — |
| Portal-sivut | HTML-metatiedot | schema.org microdata |

### 1.7.4 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | Directory-haku palauttaa semantic-kentän | Oikea @context ja @type |
| 2 | Directory-haku ilman semanttista annotaatiota | Toimii normaalisti (valinnainen) |
| 3 | CSM-parsinta säilyttää semantic-kentän | Semantic passthrough |

### 1.7.5 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Muokataan** | `src/services/directory.ts` — Semantic-annotaatio DirectoryEntryyn |
| **Muokataan** | `openapi.yaml` — DirectoryEntry-schema + semantic |

---

## 1.8 Dokumentaation ylläpito (Phase 1)

> Lähde: Phase 0.8 (dokumentaation ylläpitosuunnitelma)

### 1.8.1 Tavoite

Päivittää kaikki olemassaolevat dokumentit Phase 1 -muutosten mukaisesti.

### 1.8.2 Dokumenttikartta

#### A. Protokolladokumentaatio (docs/)

| Dokumentti | Vaikuttavat komponentit | Tarvittavat muutokset |
|---|---|---|
| `docs/01-core.md` | 1.5 (flaggaus) | Flagging-mekanismi lisätään data quality -osioon |
| `docs/03-boards.md` | 1.5 (flaggaus) | Flagging mahdollisuus board-posteille |
| `docs/05-federation.md` | 1.4 (hakemistot) | Directory-haku federaation kautta |
| `docs/08-human-layer.md` | 1.1, 1.3 (email, rekisteröinti) | Email-vahvistus, magic link, tietolompakko |
| `docs/09-community.md` | 1.6 (harrastehakemisto) | Ensimmäinen CSM-palvelu esimerkkinä |

#### B. Pilaridokumentaatio (docs/nextlevel/)

| Dokumentti | Vaikuttavat komponentit | Tarvittavat muutokset |
|---|---|---|
| `docs/nextlevel/aimeat-personal-node-spec.md` | 1.2 (wizard) | Web-wizard -viittaus |
| `docs/nextlevel/aimeat-data-description-convention.md` | 1.5 (flaggaus) | Flag-mekanismi maininta |
| `docs/ghii-identity-and-network-plan.md` | 1.3 (rekisteröinti) | Web-rekisteröinti, email-vahvistus, magic link |

#### C. Uudet dokumentit

| Dokumentti | Komponentti |
|---|---|
| `docs/csm-spec.md` | 0.2 CSM (jos ei vielä luotu Phase 0:ssa) |
| `docs/csm-examples/hobby-directory.csm.yaml` | 1.6 Harrastehakemisto |

#### D. API-spesifikaatio

**`openapi.yaml`** — Phase 1:n uudet endpointit:

| Endpoint | Komponentti | Tyyppi |
|---|---|---|
| `POST /v1/ghii/register-web` | 1.3 | Uusi |
| `POST /v1/ghii/verify-email` | 1.3 | Uusi |
| `POST /v1/ghii/magic-link` | 1.3 | Uusi |
| `GET /v1/ghii/magic-link/verify` | 1.3 | Uusi |
| `GET /v1/catalogue/directory` | 1.4 | Uusi |
| `GET /v1/catalogue/directory/stats` | 1.4 | Uusi |
| `POST /v1/flags` | 1.5 | Uusi |
| `GET /v1/flags/summary/:type/:id` | 1.5 | Uusi |
| `GET /v1/flags` | 1.5 | Uusi (operator) |
| `PUT /v1/flags/:id` | 1.5 | Uusi (operator) |
| `GET /setup` | 1.2 | Uusi |
| `POST /setup/step/:n` | 1.2 | Uusi |
| `POST /setup/complete` | 1.2 | Uusi |
| `GET /v1/portal/human/wallet` | 1.3 | Uusi |
| `GET /v1/portal/human/hobbies` | 1.6 | Uusi |

**Yhteensä: 15 uutta endpointia.**

**Uusi error code:** `ALREADY_FLAGGED`, `EMAIL_UNAVAILABLE`

#### E. Projektin juuridokumentit

| Dokumentti | Muutokset |
|---|---|
| `README.md` | Phase 1 -ominaisuudet |
| `.env.example` | SMTP, SETUP, MATCH_NOTIFICATION -muuttujat |
| `CLAUDE.md` | Email-service pattern, wizard-arkkitehtuuri |

### 1.8.3 Päivitysjärjestys

1. `openapi.yaml` — Contract-first (15 uutta endpointia)
2. `src/storage/interface.ts` — Record-tyypit
3. `src/config.ts` — Konfiguraatio
4. Route- ja service-tiedostot
5. Speksidokumentit (docs/*.md)
6. `.env.example`
7. `CLAUDE.md`
8. `README.md`

### 1.8.4 Dokumentaation Definition of Done

- [ ] `openapi.yaml` päivitetty 15 uudella endpointilla
- [ ] Jokainen uusi endpoint dokumentoitu (request/response esimerkit)
- [ ] `.env.example` päivitetty kaikilla uusilla ympäristömuuttujilla
- [ ] `CLAUDE.md` päivitetty Phase 1 -konventioilla
- [ ] Speksidokumentit viittaavat Phase 1 -ominaisuuksiin

---

## 1.9 Testausstrategia (Phase 1)

> Lähde: Phase 0.9 (testausstrategia)

### 1.9.1 Tavoite

Laajentaa Phase 0.9:ssä määriteltyä testausjärjestelmää Phase 1 -komponenteille.

### 1.9.2 E2E-testit

Laajennetaan `test/e2e-full.ts` -tiedostoa Phase 1:n testeillä.

| Testifaasi | Komponentti | Testejä | Riippuvuudet |
|---|---|---|---|
| Phase 10: Email System | 1.1 Email | 6 | SMTP mock |
| Phase 11: Web Wizard | 1.2 Wizard | 5 | — |
| Phase 12: GHII Registration + Wallet | 1.3 Rekisteröinti | 10 | Phase 10 |
| Phase 13: Directories | 1.4 Hakemistot | 8 | Phase 0.4 profiilit |
| Phase 14: Data Quality Flags | 1.5 Flaggaus | 7 | — |
| Phase 15: Hobby Directory | 1.6 Harrastehakemisto | 6 | Phase 10-14 |
| Phase 16: Semantic (Phase 1) | 1.7 Ontologia | 3 | — |
| **Yhteensä Phase 1** | | **45** | |

**Kokonaistestimäärä:** Phase 0: ~111 E2E + Phase 1: 45 E2E = **~156 E2E-testiä**

### 1.9.3 Yksikkötestit (vitest)

| Testitiedosto | Komponentti | Testejä |
|---|---|---|
| `test/unit/email-service.test.ts` | 1.1 | ~12 |
| `test/unit/email-templates.test.ts` | 1.1 | ~8 |
| `test/unit/registration.test.ts` | 1.3 | ~10 |
| `test/unit/directory.test.ts` | 1.4 | ~14 |
| `test/unit/haversine.test.ts` | 1.4 | ~6 |
| `test/unit/flags.test.ts` | 1.5 | ~8 |
| `test/unit/match-notification.test.ts` | 1.6 | ~6 |
| **Yhteensä Phase 1** | | **~64** |

### 1.9.4 SMTP-mock E2E-testeissä

```typescript
// test/helpers/smtp-mock.ts

import { createServer } from 'net';

export class SmtpMock {
  private server: ReturnType<typeof createServer>;
  public receivedEmails: { to: string; subject: string; body: string }[] = [];

  async start(port: number): Promise<void>;
  async stop(): Promise<void>;
  getLastEmail(): { to: string; subject: string; body: string } | null;
  clear(): void;
}
```

**Vaihtoehto:** Käytä `nodemailer.createTestAccount()` + Ethereal-emailia E2E-testeissä. Yksinkertaisempi, ei tarvitse omaa SMTP-mockia.

### 1.9.5 Regressiotestaus

| Riski | Kuvaus | Mitigaatio |
|---|---|---|
| Korkea | GHII-rekisteröinti rikkoo olemassaolevan | E2E Phase 2 (identity) ajettava |
| Korkea | Memory-haku max_flags rikkoo olemassaolevan | E2E Phase 3 (memory) ajettava |
| Keskitaso | Catalogue-laajennukset rikkovat olemassaolevan | E2E Phase 1 (bootstrap) ajettava |
| Matala | Wizard-reitti ei häiritse normaalia moodia | server.ts:ssä guard-ehto |

### 1.9.6 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Muokataan** | `test/e2e-full.ts` — 45 uutta E2E-testiä (Phase 10-16) |
| **Uusi** | `test/unit/email-service.test.ts` |
| **Uusi** | `test/unit/email-templates.test.ts` |
| **Uusi** | `test/unit/registration.test.ts` |
| **Uusi** | `test/unit/directory.test.ts` |
| **Uusi** | `test/unit/haversine.test.ts` |
| **Uusi** | `test/unit/flags.test.ts` |
| **Uusi** | `test/unit/match-notification.test.ts` |
| **Uusi** | `test/helpers/smtp-mock.ts` (tai Ethereal-integraatio) |

---

## Riippuvuuskaavio (kokonaiskuva)

```
Phase 0 (valmis):
  0.1 Schema Locking ──────┐
                            ├──→ 0.2 CSM ──────────┐
  0.3 Consent Layer ────────┤                       ├──→ 0.7 Semantic ──→ 0.7b Retrofit
                            ├──→ 0.4 Profiilit ────┘
  0.5 OTP/TOTP ─────────────┤
                            └──→ 0.6 DMZ

Phase 1 (tämä dokumentti):
  1.1 Email ────────────────┐
                            ├──→ 1.3 GHII-rekisteröinti ──┐
  1.5 Flaggaus ─────────────┤                              │
                            ├──→ 1.4 Hakemistot ───────────┼──→ 1.6 Harrastehakemisto
  1.2 Web-wizard ───────────┘                              │
  1.7 Semantic (Ph1) ──────────────────────────────────────┘

  1.8 Dokumentaatio ──→ (läpileikkaava)
  1.9 Testausstrategia ──→ (läpileikkaava)
```

---

## Yhteenveto

| # | Komponentti | Uudet tiedostot | Muokatut tiedostot | Uudet endpointit | E2E-testit | Yksikkötestit |
|---|---|---|---|---|---|---|
| 1.1 | Email-järjestelmä | 2 | 6 | 0 (internal) | 6 | ~20 |
| 1.2 | Web-wizard | 4 | 3 | 5 | 5 | 0 |
| 1.3 | GHII-rekisteröinti + lompakko | 2 | 5 | 5 | 10 | ~10 |
| 1.4 | Hakemistot | 1 | 3 | 2 | 8 | ~20 |
| 1.5 | Flaggaus | 1 | 5 | 4 | 7 | ~8 |
| 1.6 | Harrastehakemisto | 3 | 4 | 1 (portal) | 6 | ~6 |
| 1.7 | Semanttinen ontologia | 0 | 2 | 0 | 3 | 0 |
| 1.8 | Dokumentaatio | 1 | ~10 | 0 | 0 | 0 |
| 1.9 | Testausstrategia | 8 | 1 | 0 | 45 | ~64 |
| **Yhteensä** | | **~22** | **~39** | **~17** | **45** | **~64** |

## Definition of Done

### Per komponentti:
- [ ] Kaikki endpointit implementoitu ja vastaavat openapi.yaml-spesifikaatiota
- [ ] Storage-muutokset tehty interface.ts + memory.ts:iin
- [ ] Konfiguraatio lisätty config.ts + .env.example:en
- [ ] E2E-testit kirjoitettu ja menevät läpi
- [ ] Yksikkötestit kirjoitettu ja menevät läpi
- [ ] `npx tsc --noEmit` menee läpi
- [ ] openapi.yaml päivitetty

### Phase 1 kokonaisuutena:
- [ ] Kaikki 9 komponenttia valmis
- [ ] Erkki-polku toimii end-to-end: rekisteröinti → vahvistus → hakemisto → match-email
- [ ] Wizard toimii: tyhjä node → config.json → normaali käynnistys
- [ ] Tietolompakko näyttää suostumukset + audit trail
- [ ] Flaggaus toimii kaikille targeettityypeille
- [ ] Hakemistohaku toimii maantieteellisesti + temaattisesti
- [ ] 156+ E2E-testiä (Phase 0 + Phase 1) menevät läpi
- [ ] ~64 yksikkötestiä menevät läpi
- [ ] Dokumentaatio päivitetty (openapi.yaml, speksit, README, CLAUDE.md)
- [ ] Semantic-annotaatiot DirectoryEntryissä

---

## Seuraava vaihe: Phase 2

Phase 1 valmistuttua siirrytään Phase 2:een — markkinapaikka + yhteisötyökalut.

→ **[Phase 2: "Markkinapaikka + yhteisötyökalut" — Kattava implementointisuunnitelma](./phase-2-marketplace-community.md)**

Phase 2 rakentaa: AI-matchaus-agentin (2.1), Organismit/ryhmät (2.2), Collaborative workspaces (2.3), Advanced moderoinnin (2.4), CSM-templatekirjaston (2.5), ja yhdistää kaiken Markkinapaikka-vertikaalisliceksi (2.6).

---

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
