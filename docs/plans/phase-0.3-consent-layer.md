# Phase 0.3: Consent Layer — Implementointisuunnitelma

*Osa Phase 0 Foundation -kokonaisuutta. Ks. [Phase 0 yleiskatsaus](./2026-03-01-phase-0-foundation.md)*

---

## 0.3 Consent Layer

> Lähteet: `docs/research/bbs-aikakaudesta-ai-aikaan.md` (§7.4), masterplan (§0.3), `docs/nextlevel/aimeat-dmz-concept.md`

### 0.3.1 Tavoite

Rakentaa consent-järjestelmä joka hallitsee mitä dataa jaetaan, kenelle, millä ehdoilla ja kuinka kauan. Consent Layer on DMZ-konseptin kulmakivi: se päättää mitä siirtyy Private Zone → DMZ → Federation.

**Consent Layer vastaa kysymyksiin:**
- **Mitä?** — data_pattern (esim. `profile.*.interests`, `iot.temperature.*`)
- **Kenelle?** — recipient (`*` = kaikki, GAII = tietty agentti, `organism.{id}` = ryhmä)
- **Miksi?** — purpose (esim. `discovery`, `marketplace`, `community-service`)
- **Kuinka kauan?** — expires (ISO 8601 tai null = toistaiseksi)
- **Kuka käytti?** — audit trail (kaikki datankäytöt kirjataan)

### 0.3.2 Storage-muutokset

#### Uudet record-tyypit

**Tiedosto:** `src/storage/interface.ts`

```typescript
export interface ConsentRecord {
  id: string;                 // UUID
  ownerGaii: string;          // Kenen dataa (suostumuksen antaja)
  dataPattern: string;        // Glob-pattern: "profile.*.interests", "iot.*"
  recipient: string;          // "*" | GAII | "organism.{id}"
  purpose: string;            // Vapaamuotoinen: "discovery", "marketplace", "research"
  scope: 'private' | 'dmz' | 'federation';  // DMZ-vyöhyke
  expires: string | null;     // ISO 8601 tai null (toistaiseksi)
  status: 'active' | 'revoked' | 'expired';
  grantedAt: string;          // ISO timestamp
  revokedAt: string | null;   // ISO timestamp tai null
  metadata?: Record<string, unknown>;  // Vapaamuotoinen lisätieto
}

export interface ConsentAuditEntry {
  id: string;                 // UUID
  consentId: string;          // Viittaus ConsentRecord.id
  ownerGaii: string;          // Kenen dataa käytettiin
  accessorGaii: string;       // Kuka käytti dataa
  memoryKey: string;          // Mikä avain luettiin
  action: 'read' | 'list' | 'search';  // Mitä tehtiin
  timestamp: string;          // ISO timestamp
  allowed: boolean;           // Salliiko consent tämän?
}
```

#### Uudet Storage-metodit

```typescript
export interface Storage {
  // ... nykyiset metodit ...

  // Consent
  createConsent(record: ConsentRecord): Promise<ConsentRecord>;
  getConsent(id: string): Promise<ConsentRecord | null>;
  listConsents(ownerGaii: string, opts?: {
    status?: 'active' | 'revoked' | 'expired';
    recipient?: string;
  }): Promise<ConsentRecord[]>;
  updateConsent(id: string, updates: Partial<ConsentRecord>): Promise<ConsentRecord | null>;
  deleteConsent(id: string): Promise<boolean>;
  findMatchingConsents(ownerGaii: string, memoryKey: string, accessorGaii: string): Promise<ConsentRecord[]>;

  // Consent Audit
  addConsentAuditEntry(entry: ConsentAuditEntry): Promise<ConsentAuditEntry>;
  listConsentAudit(ownerGaii: string, opts?: {
    days?: number;
    consentId?: string;
    accessorGaii?: string;
  }): Promise<ConsentAuditEntry[]>;
}
```

#### In-memory -toteutus

**Tiedosto:** `src/storage/memory.ts`

```typescript
private consents = new Map<string, ConsentRecord>();
private consentAudit: ConsentAuditEntry[] = [];

async findMatchingConsents(ownerGaii: string, memoryKey: string, accessorGaii: string): Promise<ConsentRecord[]> {
  const now = new Date().toISOString();
  const results: ConsentRecord[] = [];

  for (const consent of this.consents.values()) {
    if (consent.ownerGaii !== ownerGaii) continue;
    if (consent.status !== 'active') continue;

    // Tarkista vanheneminen
    if (consent.expires && consent.expires < now) {
      consent.status = 'expired';
      continue;
    }

    // Tarkista recipient
    if (consent.recipient !== '*' && consent.recipient !== accessorGaii) continue;

    // Tarkista data_pattern (glob match)
    if (!matchPattern(consent.dataPattern, memoryKey)) continue;

    results.push(consent);
  }

  return results;
}
```

**`matchPattern`-apufunktio:** Yksinkertainen glob-matching memory-avaimille:
- `*` matchaa yhden segmentin (esim. `profile.*.interests` matchaa `profile.alice.interests`)
- `**` matchaa useamman segmentin (esim. `iot.**` matchaa `iot.temperature.living-room`)
- Exact match (esim. `profile.alice.interests` matchaa vain tarkalleen)

```typescript
function matchPattern(pattern: string, key: string): boolean {
  // Muunna glob → regex
  const regex = pattern
    .split('.')
    .map(segment => {
      if (segment === '**') return '.*';
      if (segment === '*') return '[^.]+';
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('\\.');
  return new RegExp(`^${regex}$`).test(key);
}
```

### 0.3.3 Uusi service: Consent Engine

**Uusi tiedosto:** `src/services/consent.ts`

```typescript
/**
 * Tarkistaa onko annetulla agentilla pääsy lukea tietty memory-avain.
 *
 * Logiikka:
 * 1. Jos avain on 'public' → salli aina
 * 2. Jos lukija on avaimen omistaja → salli aina
 * 3. Jos avain on 'owner' → salli jos sama owner
 * 4. Jos avain on 'private' → salli vain omistajalle
 * 5. Muuten: etsi matching consent → salli jos löytyy aktiivinen consent
 */
export async function checkConsentForRead(
  storage: Storage,
  memoryKey: string,
  ownerGaii: string,
  accessorGaii: string,
  visibility: string,
): Promise<{ allowed: boolean; consentId?: string; reason?: string }> { ... }

/**
 * Kirjaa audit-merkinnän datankäytöstä.
 */
export async function auditDataAccess(
  storage: Storage,
  consentId: string | null,
  ownerGaii: string,
  accessorGaii: string,
  memoryKey: string,
  action: 'read' | 'list' | 'search',
  allowed: boolean,
): Promise<void> { ... }

/**
 * Vanhenna expired consents (background job).
 */
export async function expireConsents(storage: Storage): Promise<number> { ... }
```

### 0.3.4 Uusi route: Consent Management

**Uusi tiedosto:** `src/routes/consent.ts`

```typescript
export function consentRouter(config: MeatConfig, storage: Storage): Router
```

#### POST /v1/consent — Myönnä suostumus

| Kenttä | Arvo |
|---|---|
| **Metodi** | POST |
| **Polku** | `/v1/consent` |
| **Auth** | Vaatii JWT |
| **Rooli** | owner (vain oman datan suostumukset) |

**Request body:**

```json
{
  "data_pattern": "profile.*.interests",
  "recipient": "*",
  "purpose": "discovery",
  "scope": "federation",
  "expires": "2027-03-01T00:00:00Z",
  "metadata": {
    "service": "hobby-directory",
    "note": "Kiinnostusprofiili näkyvissä hakemistossa"
  }
}
```

| Kenttä | Tyyppi | Pakollinen | Kuvaus |
|---|---|---|---|
| `data_pattern` | string | Kyllä | Glob-pattern: `profile.*.interests`, `iot.**` |
| `recipient` | string | Kyllä | `*`, GAII, tai `organism.{id}` |
| `purpose` | string | Kyllä | Vapaamuotoinen kuvaus käyttötarkoituksesta |
| `scope` | string | Ei (oletus: `"federation"`) | `private`, `dmz`, `federation` |
| `expires` | string \| null | Ei (oletus: null) | ISO 8601 tai null (toistaiseksi) |
| `metadata` | object | Ei | Vapaamuotoinen lisätieto |

**Response 201:**

```json
{
  "ok": true,
  "data": {
    "consent": {
      "id": "consent-abc123",
      "data_pattern": "profile.*.interests",
      "recipient": "*",
      "purpose": "discovery",
      "scope": "federation",
      "expires": "2027-03-01T00:00:00Z",
      "status": "active",
      "granted_at": "2026-03-15T10:00:00Z"
    }
  }
}
```

#### GET /v1/consent — Listaa omat suostumukset

| Kenttä | Arvo |
|---|---|
| **Metodi** | GET |
| **Polku** | `/v1/consent` |
| **Auth** | Vaatii JWT |
| **Query** | `?status=active`, `?recipient=app%23bob@node` |

**Response 200:**

```json
{
  "ok": true,
  "data": {
    "consents": [ { ... }, { ... } ],
    "total": 2
  }
}
```

#### GET /v1/consent/{id} — Yksittäinen suostumus

| Kenttä | Arvo |
|---|---|
| **Metodi** | GET |
| **Polku** | `/v1/consent/:id` |
| **Auth** | Vaatii JWT |

#### DELETE /v1/consent/{id} — Peru suostumus

| Kenttä | Arvo |
|---|---|
| **Metodi** | DELETE |
| **Polku** | `/v1/consent/:id` |
| **Auth** | Vaatii JWT |

**Logiikka:**
1. Tarkista consent.ownerGaii === req.auth.sub (vain oma consent)
2. Aseta status = 'revoked', revokedAt = now
3. Palauta päivitetty consent

**HUOM:** Consent ei koskaan poisteta kokonaan — se merkitään `revoked`-tilaan. Tämä on tärkeää audit trailin eheydelle.

#### GET /v1/consent/audit — Auditointiraportti

| Kenttä | Arvo |
|---|---|
| **Metodi** | GET |
| **Polku** | `/v1/consent/audit` |
| **Auth** | Vaatii JWT |
| **Query** | `?days=30`, `?accessor_gaii=...`, `?consent_id=...` |

**Response 200:**

```json
{
  "ok": true,
  "data": {
    "entries": [
      {
        "id": "audit-xyz",
        "consent_id": "consent-abc123",
        "accessor_gaii": "weather-bot#ops@genesis",
        "memory_key": "profile.alice.interests",
        "action": "read",
        "allowed": true,
        "timestamp": "2026-03-15T14:30:00Z"
      }
    ],
    "total": 1,
    "period_days": 30
  }
}
```

### 0.3.5 Muutokset olemassaoleviin tiedostoihin

#### `src/routes/memory.ts` — Consent-tarkistus luku-endpointeissa

**GET /v1/memory/:gaii/:key (public memory read):**

Nykyinen toteutus tarkistaa vain `visibility !== 'public'`. Consent Layer laajentaa tämän:

```typescript
// Nykyinen:
if (!record || record.visibility !== 'public') { ... 404 ... }

// Uusi:
if (!record) { res.status(404)...; return; }

if (record.visibility === 'public') {
  // Aina ok — audit silti
  await auditDataAccess(storage, null, record.ownerGaii, accessorGaii, key, 'read', true);
} else {
  // Tarkista consent
  const consentCheck = await checkConsentForRead(storage, key, record.ownerGaii, accessorGaii, record.visibility);
  await auditDataAccess(storage, consentCheck.consentId ?? null, record.ownerGaii, accessorGaii, key, 'read', consentCheck.allowed);
  if (!consentCheck.allowed) {
    res.status(403).json(error(config.nodeId, 'CONSENT_REQUIRED', 'No active consent for this data'));
    return;
  }
}
```

**Huomautus:** Oman datan luku (`GET /v1/memory/:key` ilman gaiiä) EI tarvitse consent-tarkistusta — käyttäjä lukee omaa dataansa.

#### `src/server.ts` — Route-rekisteröinti + background job

```typescript
import { consentRouter } from './routes/consent.js';

// Route mount (järjestyksellä ei väliä — omat polut /v1/consent/*)
app.use(consentRouter(config, storage));

// Background job: vanhenna expired consents (joka 10 min)
startConsentExpiryJob(storage);
```

#### `src/models/schemas.ts` — Uudet Zod-schemat

```typescript
export const ConsentCreateSchema = z.object({
  data_pattern: z.string().min(1).max(256),
  recipient: z.string().min(1).max(256),
  purpose: z.string().min(1).max(512),
  scope: z.enum(['private', 'dmz', 'federation']).optional().default('federation'),
  expires: z.string().datetime().nullable().optional().default(null),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const ConsentAuditQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(365).optional().default(30),
  accessor_gaii: z.string().optional(),
  consent_id: z.string().optional(),
});
```

### 0.3.6 Konfiguraatio

**Uudet ympäristömuuttujat (`src/config.ts`):**

```typescript
// Consent Layer
consentEnabled: boolean;            // Feature flag (default: true)
consentAuditRetentionDays: number;  // Kuinka kauan audit-merkintöjä säilytetään (default: 365)
consentMaxPerUser: number;          // Max consent-sääntöjä per käyttäjä (default: 100)
```

**Ympäristömuuttujat:**

```env
AIMEAT_CONSENT_ENABLED=true
AIMEAT_CONSENT_AUDIT_RETENTION_DAYS=365
AIMEAT_CONSENT_MAX_PER_USER=100
```

### 0.3.7 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | `POST /v1/consent` ilman authia | 401 AUTH_REQUIRED |
| 2 | `POST /v1/consent` validilla bodyllä | 201, consent luotu |
| 3 | `GET /v1/consent` | Listaa kaikki omat consents |
| 4 | `GET /v1/consent/{id}` | Palauttaa yksittäisen |
| 5 | `DELETE /v1/consent/{id}` | Status → revoked, revokedAt asetettu |
| 6 | Public memory read → salli ilman consenttia | 200, audit-merkintä kirjattu |
| 7 | Private memory read ilman consenttia → hylkää | 403 CONSENT_REQUIRED |
| 8 | Luo consent → lue data → hyväksytään | 200, audit-merkintä "allowed: true" |
| 9 | Peru consent → lue sama data → hylätään | 403 |
| 10 | Aikarajoitettu consent → odota expires → hylätään | 403 (expired) |
| 11 | Recipient-rajattu: oikea GAII → salli | 200 |
| 12 | Recipient-rajattu: väärä GAII → hylkää | 403 |
| 13 | `GET /v1/consent/audit?days=30` | Listaa audit-merkintöjä |
| 14 | Glob-pattern `profile.*.interests` matchaa `profile.alice.interests` | Consent toimii |
| 15 | Glob-pattern `iot.**` matchaa `iot.temp.bedroom` | Consent toimii |
| 16 | Toinen käyttäjä ei voi poistaa toisen consenttia | 403 |
| 17 | `POST /v1/consent` yli max_per_user | 429 tai 413 |

### 0.3.8 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `src/services/consent.ts` |
| **Uusi** | `src/routes/consent.ts` |
| **Muokataan** | `src/storage/interface.ts` — lisää ConsentRecord, ConsentAuditEntry + metodit |
| **Muokataan** | `src/storage/memory.ts` — lisää consents Map, consentAudit[], metodit |
| **Muokataan** | `src/storage/mongodb.ts` — lisää Consent-metodien MongoDB-toteutus |
| **Muokataan** | `src/routes/memory.ts` — lisää consent-tarkistus public read -endpointiin |
| **Muokataan** | `src/models/schemas.ts` — lisää ConsentCreateSchema, ConsentAuditQuerySchema |
| **Muokataan** | `src/config.ts` — lisää consent-konfiguraatio |
| **Muokataan** | `src/server.ts` — consentRouter import + mount + background job |
| **Muokataan** | `test/e2e-full.ts` — consent-testifaasi |

---

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
