# Phase 0: Foundation — Kattava implementointisuunnitelma

*2026-03-01 — Yksityiskohtainen toteutussuunnitelma Phase 0 -komponenteille*

---

## Yleiskatsaus

Phase 0 rakentaa perusinfrastruktuurin, jonka päälle kaikki myöhemmät ominaisuudet (hakemistot, markkinapaikka, organismit, web-wizard, AI-matchaus) rakentuvat. Phase 0 ei tuota näkyvää palvelua loppukäyttäjälle — se tuottaa infraa.

**Komponentit:**

| # | Komponentti | Riippuvuudet | Arvioitu laajuus |
|---|---|---|---|
| 0.1 | JSON Schema Locking | — | Keskisuuri |
| 0.2 | CSM — Community Service Manifest | 0.1 (schema) | Keskisuuri |
| 0.3 | Consent Layer | — | Suuri |
| 0.4 | Kiinnostusprofiili-standardi | 0.1 (schema), 0.3 (consent) | Pieni |
| 0.5 | OTP/TOTP-tuki | — | Keskisuuri |
| 0.6 | DMZ-arkkitehtuurin formalisointi | 0.3 (consent) | Dokumentaatio |
| 0.7 | Semanttinen ontologia (uudet rakenteet) | 0.1 (schema), 0.2 (CSM), 0.4 (profiilit) | Keskisuuri |
| 0.7b | Semanttinen retrofit (olemassaolevat API:t) | 0.7 | Suuri |
| 0.8 | Dokumentaation ylläpitosuunnitelma | Kaikki | Dokumentaatio |
| 0.9 | Testausstrategia | Kaikki | Keskisuuri |

**Suositeltu toteutusjärjestys:**

```
0.1 Schema Locking ──────┐
                         ├──→ 0.2 CSM ──────────────┐
0.3 Consent Layer ───────┤                           ├──→ 0.7 Semantic Ontology ──→ 0.7b Semantic Retrofit
                         ├──→ 0.4 Kiinnostusprofiilit┘
0.5 OTP/TOTP ────────────┤
                         └──→ 0.6 DMZ-formalisointi

0.8 Dokumentaation ylläpito ──→ (läpileikkaava, jokaisen komponentin yhteydessä)
0.9 Testausstrategia ─────────→ (pystytetään vitest ensin, sitten testit per komponentti)
```

Komponentit 0.1, 0.3 ja 0.5 ovat toisistaan riippumattomia ja voidaan toteuttaa rinnakkain. Komponentit 0.2, 0.4 ja 0.6 riippuvat edeltävistä. 0.7 riippuu 0.1:stä, 0.2:sta ja 0.4:stä. 0.7b riippuu 0.7:stä ja retrofittaa olemassaolevat rajapinnat. 0.8 ja 0.9 ovat läpileikkaavia.

### Alidokumentit

Jokainen komponentti on dokumentoitu myös omana tiedostonaan yksityiskohtaista implementointityötä varten:

| Komponentti | Tiedosto |
|---|---|
| 0.1 Schema Locking | [phase-0.1-schema-locking.md](./phase-0.1-schema-locking.md) |
| 0.2 CSM | [phase-0.2-csm.md](./phase-0.2-csm.md) |
| 0.3 Consent Layer | [phase-0.3-consent-layer.md](./phase-0.3-consent-layer.md) |
| 0.4 Kiinnostusprofiilit | [phase-0.4-interest-profiles.md](./phase-0.4-interest-profiles.md) |
| 0.5 OTP/TOTP | [phase-0.5-otp-totp.md](./phase-0.5-otp-totp.md) |
| 0.6 DMZ-arkkitehtuuri | [phase-0.6-dmz-architecture.md](./phase-0.6-dmz-architecture.md) |
| 0.7 Semanttinen ontologia (uudet) | [phase-0.7-semantic-ontology.md](./phase-0.7-semantic-ontology.md) |
| 0.7b Semantic retrofit (olemassa olevat) | [phase-0.7b-semantic-retrofit.md](./phase-0.7b-semantic-retrofit.md) |
| 0.8 Dokumentaation ylläpito | [phase-0.8-documentation-plan.md](./phase-0.8-documentation-plan.md) |
| 0.9 Testausstrategia | [phase-0.9-testing-strategy.md](./phase-0.9-testing-strategy.md) |

Tämä yleiskatsausdokumentti sisältää kaiken saman sisällön kootusti. Alidokumentit ovat identtisiä kopioita yksittäisten komponenttien implementointia varten.

---

## 0.1 JSON Schema Locking

> Lähde: `docs/nextlevel/aimeat-json-schema-locking.md`

### 0.1.1 Tavoite

Mahdollistaa JSON Schema -pohjainen validointi memory-kirjoituksille. Kun avaimeen on asetettu schema, kaikki kirjoitukset validoidaan sen kautta. Tämä estää AI-agentteja ja sovelluksia korruptoimasta jaettua dataa.

### 0.1.2 Uudet riippuvuudet

```bash
cd aimeat
pnpm add ajv ajv-formats
```

| Paketti | Versio | Koko | Tarkoitus |
|---|---|---|---|
| `ajv` | ^8.x | ~120KB | JSON Schema -validaattori (draft-07 + 2019-09 + 2020-12) |
| `ajv-formats` | ^3.x | ~15KB | Format-validaattorit (date-time, email, uri, jne.) |

### 0.1.3 Storage-muutokset

#### Uusi record-tyyppi: `SchemaRecord`

**Tiedosto:** `src/storage/interface.ts`

```typescript
export interface SchemaRecord {
  keyPattern: string;         // memory-avaimen nimi tai prefiksi
  applyTo: 'exact' | 'prefix'; // 'exact' = vain tämä avain, 'prefix' = tämä ja kaikki aliavaimet
  schemaJson: Record<string, unknown>; // JSON Schema objekti
  schemaMode: 'open' | 'strict';      // open = additionalProperties: true, strict = false
  lockedBy: string;           // GAII tai GHII joka asetti scheman
  setAt: string;              // ISO timestamp
  updatedAt: string;          // ISO timestamp
}
```

#### Uudet Storage-metodit

```typescript
export interface Storage {
  // ... nykyiset metodit ...

  // Schema Locking
  setSchema(record: SchemaRecord): Promise<SchemaRecord>;
  getSchema(keyPattern: string, applyTo?: 'exact' | 'prefix'): Promise<SchemaRecord | null>;
  deleteSchema(keyPattern: string): Promise<boolean>;
  listSchemas(prefix?: string): Promise<SchemaRecord[]>;
  findApplicableSchema(memoryKey: string): Promise<SchemaRecord | null>;
}
```

#### In-memory -toteutus

**Tiedosto:** `src/storage/memory.ts`

```typescript
private schemas = new Map<string, SchemaRecord>(); // key = `${applyTo}:${keyPattern}`

async setSchema(record: SchemaRecord): Promise<SchemaRecord> {
  const storageKey = `${record.applyTo}:${record.keyPattern}`;
  this.schemas.set(storageKey, record);
  return record;
}

async getSchema(keyPattern: string, applyTo?: 'exact' | 'prefix'): Promise<SchemaRecord | null> {
  if (applyTo) {
    return this.schemas.get(`${applyTo}:${keyPattern}`) ?? null;
  }
  // Hae ensin exact, sitten prefix
  return this.schemas.get(`exact:${keyPattern}`) ?? this.schemas.get(`prefix:${keyPattern}`) ?? null;
}

async deleteSchema(keyPattern: string): Promise<boolean> {
  const deleted1 = this.schemas.delete(`exact:${keyPattern}`);
  const deleted2 = this.schemas.delete(`prefix:${keyPattern}`);
  return deleted1 || deleted2;
}

async listSchemas(prefix?: string): Promise<SchemaRecord[]> {
  const results: SchemaRecord[] = [];
  for (const record of this.schemas.values()) {
    if (!prefix || record.keyPattern.startsWith(prefix)) {
      results.push(record);
    }
  }
  return results;
}

async findApplicableSchema(memoryKey: string): Promise<SchemaRecord | null> {
  // 1. Exact match — korkein prioriteetti
  const exact = this.schemas.get(`exact:${memoryKey}`);
  if (exact) return exact;

  // 2. Wildcard pattern match — tukee profile.*.interests -tyyppisiä schemoja
  // Etsii pisin matchaava pattern (eniten segmenttejä)
  let bestWildcard: SchemaRecord | null = null;
  let bestSegments = 0;
  for (const record of this.schemas.values()) {
    if (record.applyTo !== 'prefix') continue;
    if (!record.keyPattern.includes('*')) continue;
    if (matchWildcardPattern(record.keyPattern, memoryKey)) {
      const segments = record.keyPattern.split('.').length;
      if (segments > bestSegments) {
        bestWildcard = record;
        bestSegments = segments;
      }
    }
  }
  if (bestWildcard) return bestWildcard;

  // 3. Simple prefix match — pisin prefiksi voittaa
  const parts = memoryKey.split('.');
  for (let i = parts.length - 1; i >= 1; i--) {
    const prefix = parts.slice(0, i).join('.');
    const prefixSchema = this.schemas.get(`prefix:${prefix}`);
    if (prefixSchema) return prefixSchema;
  }

  return null; // Ei schemaa → vapaa kirjoitus
}

// Erillinen apufunktio (luokan ulkopuolella):

/**
 * Wildcard pattern matching: tukee '*' (yksi segmentti) ja '**' (useita segmenttejä)
 * Esim: 'profile.*.interests' matchaa 'profile.alice.interests'
 *       'iot.**' matchaa 'iot.temperature.living-room'
 */
function matchWildcardPattern(pattern: string, key: string): boolean {
  const patternParts = pattern.split('.');
  const keyParts = key.split('.');

  let pi = 0, ki = 0;
  while (pi < patternParts.length && ki < keyParts.length) {
    if (patternParts[pi] === '**') {
      // ** matchaa loput
      return true;
    }
    if (patternParts[pi] === '*') {
      // * matchaa yhden segmentin
      pi++;
      ki++;
      continue;
    }
    if (patternParts[pi] !== keyParts[ki]) {
      return false;
    }
    pi++;
    ki++;
  }
  return pi === patternParts.length && ki === keyParts.length;
}
```

### 0.1.4 Uusi service: Schema Validator

**Uusi tiedosto:** `src/services/schema-validator.ts`

```typescript
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { Storage } from '../storage/interface.js';

const ajv = new Ajv({ allErrors: true, verbose: true });
addFormats(ajv);

// Compiled validator cache — avain = JSON.stringify(schema)
const validatorCache = new Map<string, ReturnType<typeof ajv.compile>>();

function getValidator(schema: Record<string, unknown>) {
  const key = JSON.stringify(schema);
  if (!validatorCache.has(key)) {
    validatorCache.set(key, ajv.compile(schema));
  }
  return validatorCache.get(key)!;
}

export function clearValidatorCache(): void {
  validatorCache.clear();
}

export function removeFromCache(schema: Record<string, unknown>): void {
  validatorCache.delete(JSON.stringify(schema));
}

export interface ValidationResult {
  valid: boolean;
  errors?: Array<{
    path: string;
    message: string;
    schema_rule: string;
    params?: Record<string, unknown>;
  }>;
  schemaKey?: string;
}

export async function validateMemoryWrite(
  memoryKey: string,
  value: unknown,
  storage: Storage
): Promise<ValidationResult> {
  const schemaRecord = await storage.findApplicableSchema(memoryKey);

  if (!schemaRecord) {
    return { valid: true }; // Ei schemaa = ei validointia
  }

  // Sovella schema_mode: 'strict' → lisää additionalProperties: false
  const schemaToValidate = { ...schemaRecord.schemaJson };
  if (schemaRecord.schemaMode === 'strict' && schemaToValidate.type === 'object') {
    (schemaToValidate as Record<string, unknown>).additionalProperties = false;
  }

  const validate = getValidator(schemaToValidate);
  const isValid = validate(value);

  if (isValid) {
    return { valid: true };
  }

  return {
    valid: false,
    errors: (validate.errors ?? []).map(err => ({
      path: err.instancePath || '/',
      message: err.message ?? 'Unknown validation error',
      schema_rule: err.keyword,
      params: err.params as Record<string, unknown>,
    })),
    schemaKey: schemaRecord.keyPattern,
  };
}

/**
 * Validoi schema itsessään — onko annettu objekti validi JSON Schema?
 * Palauttaa null jos ok, virheilmoituksen jos ei.
 */
export function validateSchemaItself(schema: Record<string, unknown>): string | null {
  try {
    ajv.compile(schema);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}
```

### 0.1.5 Uusi route: Schema Management

**Uusi tiedosto:** `src/routes/schemas.ts`

```typescript
export function schemaRouter(config: MeatConfig, storage: Storage): Router
```

**Endpointit:**

#### PUT /v1/memory/{key}/schema — Aseta schema

| Kenttä | Arvo |
|---|---|
| **Metodi** | PUT |
| **Polku** | `/v1/memory/:key/schema` |
| **Auth** | Vaatii JWT (requireAuth) |
| **Rooli** | owner tai operator (ei pelkkä agent) |
| **Content-Type** | application/json |

**Request body:**

```json
{
  "schema": {
    "type": "object",
    "required": ["temperature", "unit"],
    "properties": {
      "temperature": { "type": "number" },
      "unit": { "type": "string", "enum": ["C", "F", "K"] }
    }
  },
  "apply_to": "exact",
  "schema_mode": "open"
}
```

| Kenttä | Tyyppi | Pakollinen | Kuvaus |
|---|---|---|---|
| `schema` | object | Kyllä | Validi JSON Schema (draft-07+) |
| `apply_to` | `"exact"` \| `"prefix"` | Kyllä | Kohdistus |
| `schema_mode` | `"open"` \| `"strict"` | Ei (oletus: `"open"`) | `strict` = additionalProperties: false |

**Response 200:**

```json
{
  "ok": true,
  "data": {
    "status": "schema_set",
    "key": "iot.temperature.living-room",
    "apply_to": "exact",
    "schema_mode": "open",
    "locked_by": "app#alice@aimeat-local-001",
    "set_at": "2026-03-01T14:30:00Z"
  }
}
```

**Virhetilanteet:**

| HTTP | Koodi | Tilanne |
|---|---|---|
| 400 | `INVALID_SCHEMA` | Annettu schema ei ole validi JSON Schema |
| 400 | `INVALID_INPUT` | Puuttuva/väärä `apply_to` tai `schema` |
| 403 | `SCHEMA_LOCKED_BY_OTHER` | Schema asetettu toisen toimesta, ei voi päivittää |
| 401 | `AUTH_REQUIRED` | Ei JWT:tä |

**Logiikka:**

1. Validoi request body (Zod-schemalla)
2. Kokeile `ajv.compile(schema)` — epäonnistuminen = 400
3. Tarkista onko olemassa schema → Jos on, tarkista `lockedBy` matchaa `req.auth.sub`
4. Jos olemassa ja eri lukitsija → 403 (paitsi operator voi ylikirjoittaa)
5. Tallenna `SchemaRecord` storageen
6. Tyhjennä validator cache kyseiselle schemalle

#### GET /v1/memory/{key}/schema — Lue schema

| Kenttä | Arvo |
|---|---|
| **Metodi** | GET |
| **Polku** | `/v1/memory/:key/schema` |
| **Auth** | Ei vaadita (Tier 0 endpoint) |

**Response 200 (schema olemassa):**

```json
{
  "ok": true,
  "data": {
    "key": "iot.temperature.living-room",
    "has_schema": true,
    "schema": { ... },
    "apply_to": "exact",
    "schema_mode": "open",
    "locked_by": "app#alice@aimeat-local-001",
    "set_at": "2026-03-01T14:30:00Z"
  }
}
```

**Response 200 (ei schemaa):**

```json
{
  "ok": true,
  "data": {
    "key": "iot.temperature.living-room",
    "has_schema": false
  }
}
```

**Logiikka:**

1. `storage.findApplicableSchema(key)` — etsii exact + prefix matchin
2. Palauta schema tai `has_schema: false`

#### DELETE /v1/memory/{key}/schema — Poista schema

| Kenttä | Arvo |
|---|---|
| **Metodi** | DELETE |
| **Polku** | `/v1/memory/:key/schema` |
| **Auth** | Vaatii JWT |
| **Rooli** | Scheman asettaja TAI operator |

**Response 200:**

```json
{
  "ok": true,
  "data": { "status": "schema_removed", "key": "iot.temperature.living-room" }
}
```

**Virhetilanteet:**

| HTTP | Koodi | Tilanne |
|---|---|---|
| 404 | `NO_SCHEMA` | Avaimella ei ole schemaa |
| 403 | `NOT_SCHEMA_OWNER` | Ei ole scheman asettaja eikä operator |

**Logiikka:**

1. Hae schema storagesta
2. Tarkista oikeudet (lockedBy match TAI req.auth.roles includes 'operator')
3. Poista storagesta
4. Tyhjennä validator cache (`clearValidatorCache()`)

#### GET /v1/schemas — Listaa schemat

| Kenttä | Arvo |
|---|---|
| **Metodi** | GET |
| **Polku** | `/v1/schemas` |
| **Auth** | Ei vaadita (Tier 0) |
| **Query** | `?prefix=iot` — suodata prefiksillä |

**Response 200:**

```json
{
  "ok": true,
  "data": {
    "schemas": [
      {
        "key": "iot.temperature",
        "apply_to": "prefix",
        "schema_mode": "strict",
        "locked_by": "app#alice@aimeat-local-001",
        "set_at": "2026-03-01T14:30:00Z"
      }
    ],
    "total": 1
  }
}
```

### 0.1.6 Muutokset olemassaoleviin tiedostoihin

#### `src/routes/memory.ts` — Validointi-integraatio

Muutos `POST /v1/memory` -handleriin ja `PUT /v1/memory/:key` -handleriin:

```typescript
import { validateMemoryWrite } from '../services/schema-validator.js';

// Lisätään ENNEN storage.setMemory()-kutsua molemmissa endpointeissa:

// Schema validation
const validation = await validateMemoryWrite(key, value, storage);
if (!validation.valid) {
  res.status(422).json(error(config.nodeId, 'SCHEMA_VALIDATION_FAILED',
    'Value does not match the schema for this key', 422, {
      key,
      violations: validation.errors,
      schema_url: `/v1/memory/${encodeURIComponent(validation.schemaKey!)}/schema`,
    }));
  return;
}
```

**Huom:** Validointi tulee JÄLKEEN quota-tarkistuksen ja ENNEN `storage.setMemory()` -kutsua.

#### `src/models/schemas.ts` — Uudet Zod-schemat

```typescript
export const SchemaSetSchema = z.object({
  schema: z.record(z.string(), z.unknown()),
  apply_to: z.enum(['exact', 'prefix']),
  schema_mode: z.enum(['open', 'strict']).optional().default('open'),
});

export const SchemaListQuerySchema = z.object({
  prefix: z.string().optional(),
});
```

#### `src/server.ts` — Route-rekisteröinti

```typescript
import { schemaRouter } from './routes/schemas.js';

// Lisää ENNEN memoryRouter-mounttausta (koska /v1/memory/:key/schema
// pitää rekisteröidä ennen /v1/memory/:key):
app.use(schemaRouter(config, storage));
```

**KRIITTINEN:** Schema-reitit (`/v1/memory/:key/schema`) PITÄÄ rekisteröidä ENNEN yleistä `/v1/memory/:key` -reittiä. Muuten Express kaappaa pyynnön väärään handleriin. Tämä tarkoittaa, että `schemaRouter` mountataan ennen `memoryRouter`:a `server.ts`:ssä.

### 0.1.7 Konfiguraatio

Ei uusia ympäristömuuttujia Phase 0.1:ssä. Schema locking on aina enabled kun koodi on deployattu.

### 0.1.8 Testitapaukset

E2E-testit lisätään `test/e2e-full.ts` -tiedostoon uutena testifaasina:

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | `PUT /v1/memory/test.key/schema` ilman authia | 401 AUTH_REQUIRED |
| 2 | `PUT /v1/memory/test.key/schema` validilla schemalla | 200, schema_set |
| 3 | `POST /v1/memory` validilla datalla schema-avaimeen | 200/201, kirjoitus onnistuu |
| 4 | `POST /v1/memory` väärällä tyypillä schema-avaimeen | 422 SCHEMA_VALIDATION_FAILED |
| 5 | `POST /v1/memory` puuttuvalla pakollisella kentällä | 422, virheilmoitus kertoo mikä puuttuu |
| 6 | `POST /v1/memory` ylimääräisellä kentällä strict-schemaan | 422, "additional property not allowed" |
| 7 | `POST /v1/memory` ylimääräisellä kentällä open-schemaan | 200, hyväksytään |
| 8 | `GET /v1/memory/test.key/schema` | 200, palauttaa scheman |
| 9 | `GET /v1/memory/no-schema-key/schema` | 200, `has_schema: false` |
| 10 | Prefix-schema: aseta `iot.temp` + kirjoita `iot.temp.bedroom` | 200, validoituu prefix-schemaa vasten |
| 11 | Exact overrides prefix: aseta molemmat, exact voittaa | 200, exact-schema käytössä |
| 12 | Toinen käyttäjä yrittää muokata schemaa | 403 SCHEMA_LOCKED_BY_OTHER |
| 13 | Operator ylikirjoittaa toisen scheman | 200, hyväksytään |
| 14 | `DELETE /v1/memory/test.key/schema` scheman asettajana | 200, schema_removed |
| 15 | Kirjoita avaimeen scheman poiston jälkeen ilman validointia | 200, vapaa kirjoitus |
| 16 | `GET /v1/schemas?prefix=iot` | 200, listaa prefix-matchaavat |
| 17 | `PUT /v1/memory/test.key/schema` invalidi JSON Schema | 400 INVALID_SCHEMA |
| 18 | `PUT /v1/memory/:key` (optimistic locking update) schemaa vasten | 422 jos invalidi, 200 jos validi |

### 0.1.9 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `src/services/schema-validator.ts` |
| **Uusi** | `src/routes/schemas.ts` |
| **Muokataan** | `src/storage/interface.ts` — lisää `SchemaRecord` + metodit |
| **Muokataan** | `src/storage/memory.ts` — lisää schemas Map + metodit |
| **Muokataan** | `src/storage/mongodb.ts` — lisää Schema-metodien MongoDB-toteutus |
| **Muokataan** | `src/routes/memory.ts` — lisää validation POST/PUT:iin |
| **Muokataan** | `src/models/schemas.ts` — lisää SchemaSetSchema, SchemaListQuerySchema |
| **Muokataan** | `src/server.ts` — lisää schemaRouter import + mount (ENNEN memoryRouter) |
| **Muokataan** | `test/e2e-full.ts` — lisää schema locking -testifaasi |

---

## 0.2 CSM — Community Service Manifest

### 0.2.1 Tavoite

Luoda uusi YAML-formaatti (CSM = Community Service Manifest) joka kuvaa yhteisöpalveluja (hakemisto, markkinapaikka, foorumi, treffisivusto, jne.). CSM on erillinen MSM:stä (MEAT Service Manifest), joka kuvaa ulkoisia API-integraatioita.

**CSM vs MSM:**

| | MSM | CSM |
|---|---|---|
| **Tarkoitus** | Ulkoinen API (Stripe, Wolt, OpenWeather) | Sisäinen yhteisöpalvelu |
| **Data** | API-vastaukset, transformaatiot | Memory-avaimet, schemat, profiilit |
| **Hinnoittelu** | Per API-kutsu | Morsel-ekonomia, vapaaehtoiset |
| **Moderointi** | Ei | Flaggaus, auto-hide, appeals |
| **Consent** | API-avaimet | AIMEAT consent layer |
| **UI** | Ei | UI hints palvelun näyttämiseen |

### 0.2.2 Uudet riippuvuudet

```bash
cd aimeat
pnpm add yaml
```

| Paketti | Versio | Koko | Tarkoitus |
|---|---|---|---|
| `yaml` | ^2.x | ~60KB | YAML-parseri (JS-natiivi, TypeScript-tyypit) |

### 0.2.3 CSM-spesifikaatio

**Uusi dokumentti:** `docs/csm-spec.md`

CSM-tiedoston rakenne:

```yaml
# CSM — Community Service Manifest
csm: "1.0"                  # CSM-version

service:
  name: "Harrastehakemisto"  # Palvelun nimi
  type: "directory"          # Palvelutyyppi (ks. alla)
  description: "Löydä harrastuksia ja samanhenkisiä läheltäsi"
  version: "1.0"
  author: "app#alice@aimeat-local-001"  # GAII palvelun tekijästä

# Tuetut palvelutyypit:
# directory    — hakemisto (henkilöt, yritykset, harrastukset)
# marketplace  — kauppapaikka (myynti-ilmoitukset, transaktiot)
# forum        — keskustelupalsta (ketjut, vastaukset)
# dating       — tutustumispalvelu (profiilit, matchaus)
# news         — uutissyöte (artikkelit, lähteet)
# opinion      — mielipidepalsta (äänet, kommentit)
# auction      — huutokauppa (tuotteet, tarjoukset, aikarajat)
# media        — mediahakemisto (videot, kuvat, äänet)

schema_mode: "open"          # open | strict — palvelun tekijä päättää

# Data schema — mitä kenttiä palvelun listaukset sisältävät
data_schema:
  required:
    name:
      type: string
      min: 1
      max: 200
    category:
      type: string
      enum: ["luonto", "urheilu", "taide", "musiikki", "teknologia", "ruoka", "muu"]
    location:
      type: object
      properties:
        city:
          type: string
        area:
          type: string
          required: false
        geo:
          type: array
          items: number
          minItems: 2
          maxItems: 2
          required: false
  optional:
    description:
      type: string
      max: 2000
    contact:
      type: string
    image_url:
      type: string
      format: uri
    website:
      type: string
      format: uri

# Consent-vaatimukset — mitä consent-tietoa palvelu tarvitsee
consent_requirements:
  visibility_default: "federation"  # private | federation | public
  requires_consent: true             # vaatiiko palvelu käyttäjän suostumuksen
  consent_purpose: "community-discovery"  # vapaata tekstiä, kertoo miksi
  data_retention: "until_revoked"   # until_revoked | 30d | 90d | 1y

# Moderointi
moderation:
  flags_enabled: true
  auto_hide_threshold: 5     # piilota automaattisesti N flagin jälkeen
  appeals_enabled: false     # Phase 2

# UI-vihjeet — auttaa portaalin renderöinnissä
ui_hints:
  list_view: ["name", "category", "location.city"]
  detail_view: ["name", "description", "category", "location", "contact", "website"]
  search_fields: ["name", "category", "location.city"]
  sort_options: ["name", "category", "created_at"]
  card_image_field: "image_url"  # mikä kenttä näytetään korttikuvana
```

### 0.2.4 CSM-parseri

**Uusi tiedosto:** `src/services/csm-parser.ts`

Vastuualueet:
1. Parsii YAML-tiedoston → TypeScript-objekti
2. Validoi CSM-rakenteen (onko `csm`, `service`, `data_schema` olemassa ja oikeaa tyyppiä)
3. Generoi JSON Schema CSM:n `data_schema` -kentästä (→ käytetään 0.1 Schema Lockingissa)
4. Palauttaa parsitun `CsmDefinition`-objektin

```typescript
import { parse as parseYaml } from 'yaml';

export interface CsmDefinition {
  version: string;
  service: {
    name: string;
    type: CsmServiceType;
    description: string;
    version: string;
    author?: string;
  };
  schemaMode: 'open' | 'strict';
  dataSchema: {
    required: Record<string, CsmFieldDef>;
    optional: Record<string, CsmFieldDef>;
  };
  consentRequirements: {
    visibilityDefault: 'private' | 'federation' | 'public';
    requiresConsent: boolean;
    consentPurpose: string;
    dataRetention: string;
  };
  moderation: {
    flagsEnabled: boolean;
    autoHideThreshold: number;
    appealsEnabled: boolean;
  };
  uiHints: {
    listView: string[];
    detailView: string[];
    searchFields: string[];
    sortOptions?: string[];
    cardImageField?: string;
  };
}

export type CsmServiceType =
  'directory' | 'marketplace' | 'forum' | 'dating' |
  'news' | 'opinion' | 'auction' | 'media';

export interface CsmFieldDef {
  type: string;
  min?: number;
  max?: number;
  enum?: string[];
  format?: string;
  items?: string | CsmFieldDef;
  properties?: Record<string, CsmFieldDef & { required?: boolean }>;
  required?: boolean;
}

export function parseCsm(yamlContent: string): CsmDefinition { ... }
export function validateCsm(def: CsmDefinition): string[] { ... } // palauttaa virhelistauksen
export function csmToJsonSchema(def: CsmDefinition): Record<string, unknown> { ... } // generoi JSON Schema
```

**`csmToJsonSchema`-funktio:** Muuntaa CSM:n `data_schema`-kentän JSON Schemaksi, joka voidaan rekisteröidä Schema Lockingiin. Tämä mahdollistaa: CSM → JSON Schema → Schema Locking → memory-kirjoitusten validointi.

### 0.2.5 CSM-esimerkit

**Uusi hakemisto:** `docs/csm-examples/`

| Tiedosto | Kuvaus |
|---|---|
| `hobby-directory.csm.yaml` | Harrastehakemisto (Phase 1 vertical slice) |
| `marketplace.csm.yaml` | Markkinapaikka (Phase 2 vertical slice) |
| `dating-directory.csm.yaml` | Tutustumishakemisto |
| `news-feed.csm.yaml` | Uutissyöte |
| `opinion-board.csm.yaml` | Mielipidepalsta |
| `auction.csm.yaml` | Huutokauppa |
| `video-directory.csm.yaml` | Videohakemisto |

Jokainen esimerkki on täysi CSM YAML -tiedosto yllä kuvatun rakenteen mukaisesti.

### 0.2.6 CSM Management -endpointit

Phase 0.2:ssa CSM:t ovat staattisia tiedostoja joita parsitaan ja validoidaan. Runtime-endpointit CSM:n lataamiseen ja hallintaan:

#### POST /v1/csm — Rekisteröi CSM-palvelu

| Kenttä | Arvo |
|---|---|
| **Metodi** | POST |
| **Polku** | `/v1/csm` |
| **Auth** | Vaatii JWT, owner-rooli |
| **Content-Type** | `text/yaml` tai `application/json` |

**Logiikka:**
1. Parsii YAML/JSON → CsmDefinition
2. Validoi rakenne
3. Generoi JSON Schema → rekisteröi Schema Lockingiin (`PUT /v1/memory/csm.{service.name}/schema`)
4. Tallenna CSM-metadata memory-avaimeen `_csm.{service.name}`
5. Palauta rekisteröity palvelukuvaus

#### GET /v1/csm — Listaa rekisteröidyt CSM-palvelut

#### GET /v1/csm/{name} — Yksittäinen CSM-palvelu

#### DELETE /v1/csm/{name} — Poista CSM-palvelu

### 0.2.7 Storage-muutokset

CSM-palvelut tallennetaan memory-avaimina prefiksillä `_csm.`:

```
_csm.hobby-directory → { csm_definition, json_schema_key, registered_at, ... }
_csm.marketplace     → { csm_definition, json_schema_key, registered_at, ... }
```

Vaihtoehtoisesti erillinen `CsmRecord`:

```typescript
export interface CsmRecord {
  name: string;           // palvelun nimi (unique)
  definition: CsmDefinition;
  jsonSchemaKey: string;  // viittaus Schema Locking -avaimeen
  registeredBy: string;   // GAII
  registeredAt: string;
  updatedAt: string;
}
```

**Päätös implementaatiovaiheessa:** Jos CSM:iä on vähän (alle 50), memory-avaimet riittävät. Jos tarvitaan tehokasta hakua, erillinen storage-taulukko.

### 0.2.8 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | Parsii validi hobby-directory.csm.yaml | CsmDefinition ilman virheitä |
| 2 | Parsii invalidi YAML (puuttuva `service`) | Virhelista sisältää "service is required" |
| 3 | `csmToJsonSchema` generoi validin JSON Scheman | AJV:llä compileattavissa |
| 4 | `POST /v1/csm` YAML-bodyllä | 201, CSM rekisteröity |
| 5 | `GET /v1/csm` | Listaa rekisteröidyt CSM:t |
| 6 | Kirjoita dataa CSM:n data_schema:n mukaan → onnistuu | 200 |
| 7 | Kirjoita dataa joka rikkoo CSM:n schemaa → hylätään | 422 |
| 8 | `DELETE /v1/csm/{name}` poistaa myös scheman | 200, schema poistettu |

### 0.2.9 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `docs/csm-spec.md` — CSM-spesifikaatio |
| **Uusi** | `docs/csm-examples/hobby-directory.csm.yaml` |
| **Uusi** | `docs/csm-examples/marketplace.csm.yaml` |
| **Uusi** | `docs/csm-examples/dating-directory.csm.yaml` |
| **Uusi** | `docs/csm-examples/news-feed.csm.yaml` |
| **Uusi** | `docs/csm-examples/opinion-board.csm.yaml` |
| **Uusi** | `docs/csm-examples/auction.csm.yaml` |
| **Uusi** | `docs/csm-examples/video-directory.csm.yaml` |
| **Uusi** | `src/services/csm-parser.ts` |
| **Uusi** | `src/routes/csm.ts` |
| **Muokataan** | `src/storage/interface.ts` — (valinnainen CsmRecord) |
| **Muokataan** | `src/storage/memory.ts` — (valinnainen CsmRecord) |
| **Muokataan** | `src/models/schemas.ts` — CsmRegistrationSchema |
| **Muokataan** | `src/server.ts` — csmRouter import + mount |

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

## 0.4 Kiinnostusprofiili-standardi

> Lähde: `docs/research/soluuntuminen-ja-discovery.md` (§6-7), masterplan (§0.4)

### 0.4.1 Tavoite

Standardoida memory-avainrakenne ihmisprofiileille niin, että hakemistot, AI-matchaus ja discovery-mekanismit löytävät profiilit yhtenäisellä tavalla. Ei uusia endpointeja — hyödyntää Schema Lockingia (0.1) ja Consent Layeriä (0.3).

### 0.4.2 Standardoidut memory-avaimet

```
profile.{owner}.interests    → string[]          # ["lintubongaus", "retro-pelit", "kokkaus"]
profile.{owner}.location     → LocationObject     # { country, city, area, geo }
profile.{owner}.bio          → string             # "Teknologiasta kiinnostunut luontoharrastaja"
profile.{owner}.availability → string             # "evenings-weekends", "anytime", "by-appointment"
profile.{owner}.seeking      → string[]           # ["samanhenkiset harrastajat", "projektikumppanit"]
profile.{owner}.languages    → string[]           # ["fi", "en", "sv"]
```

**Nimeämispäätös:** Käytetään `{owner}` (owner-nimi, esim. `alice`) eikä GHII:tä (esim. `alice@aimeat-local-001`). Syyt:
- Owner-nimi on lyhyempi ja selkeämpi avaimissa
- Memory on jo sidottu agentin GAII:hin `ownerGaii`-kentän kautta
- Esimerkki: `profile.alice.interests` (ei `profile.alice@aimeat-local-001.interests`)

**HUOM:** Masterplan käytti `{ghii}`-notaatiota — tämä poikkeama on tietoinen. Phase 1+ dokumentit tulee päivittää käyttämään `{owner}`-notaatiota.

**display_name ja avatar:** Näitä EI tallennneta profile-avaimina koska ne ovat jo GHIIRecordissa (`displayName`, `avatar`). Duplikointi aiheuttaisi synkronointiongelmia.

### 0.4.3 JSON Schemat profiiliavaimille

Phase 0.4 rekisteröi seuraavat schemat Schema Lockingin kautta:

#### `profile.*.interests` (prefix-schema)

```json
{
  "type": "array",
  "items": {
    "type": "string",
    "minLength": 1,
    "maxLength": 100
  },
  "minItems": 1,
  "maxItems": 50
}
```

#### `profile.*.location` (prefix-schema)

```json
{
  "type": "object",
  "required": ["city"],
  "properties": {
    "country": { "type": "string", "minLength": 2, "maxLength": 3 },
    "city": { "type": "string", "minLength": 1, "maxLength": 100 },
    "area": { "type": "string", "maxLength": 100 },
    "geo": {
      "type": "array",
      "items": { "type": "number" },
      "minItems": 2,
      "maxItems": 2,
      "description": "[latitude, longitude]"
    }
  },
  "additionalProperties": true
}
```

#### `profile.*.bio` (prefix-schema)

```json
{
  "type": "string",
  "minLength": 1,
  "maxLength": 500
}
```

#### `profile.*.seeking` (prefix-schema)

```json
{
  "type": "array",
  "items": {
    "type": "string",
    "maxLength": 200
  },
  "maxItems": 20
}
```

#### `profile.*.availability` (prefix-schema)

```json
{
  "type": "string",
  "enum": ["anytime", "evenings", "weekends", "evenings-weekends", "by-appointment", "not-available"],
  "description": "When the person is available for contact/activities"
}
```

#### `profile.*.languages` (prefix-schema)

```json
{
  "type": "array",
  "items": {
    "type": "string",
    "minLength": 2,
    "maxLength": 5,
    "pattern": "^[a-z]{2,3}(-[A-Z]{2})?$",
    "description": "ISO 639-1 language code, optionally with region (e.g. fi, en, sv, en-US)"
  },
  "minItems": 1,
  "maxItems": 20
}
```

### 0.4.4 Profiilin consent-malli

Kun käyttäjä luo kiinnostusprofiilin, tarvitaan consent jotta muut näkevät sen:

```json
{
  "data_pattern": "profile.alice.*",
  "recipient": "*",
  "purpose": "discovery",
  "scope": "federation",
  "expires": null
}
```

**Granulaarinen vaihtoehto:** Käyttäjä voi myöntää consent vain osalle profiilista:

```json
{
  "data_pattern": "profile.alice.interests",
  "recipient": "*",
  "purpose": "discovery",
  "scope": "federation"
}
```

(Bio ja sijainti pysyvät piilotettuina — vain kiinnostukset näkyvissä.)

### 0.4.5 Seed-schemat

**Uusi tiedosto:** `src/services/profile-schemas.ts`

```typescript
/**
 * Rekisteröi standardoidut profiili-schemat Schema Lockingiin.
 * Kutsutaan kerran noden käynnistyksen yhteydessä.
 */
export async function seedProfileSchemas(storage: Storage, lockedBy: string): Promise<void> {
  const schemas = [
    { field: 'interests', schema: interestsSchema },
    { field: 'location', schema: locationSchema },
    { field: 'bio', schema: bioSchema },
    { field: 'seeking', schema: seekingSchema },
    { field: 'availability', schema: availabilitySchema },
    { field: 'languages', schema: languagesSchema },
  ];

  for (const s of schemas) {
    const keyPattern = `profile.*.${s.field}`;
    const existing = await storage.getSchema(keyPattern, 'prefix');
    if (!existing) {
      await storage.setSchema({
        keyPattern,
        applyTo: 'prefix',
        schemaJson: s.schema,
        schemaMode: 'open',
        lockedBy,
        setAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }
}
```

**Kutsutaan `src/server.ts`:ssa:**

```typescript
// Seed profile schemas after storage is ready
import { seedProfileSchemas } from './services/profile-schemas.js';
await seedProfileSchemas(storage, `system@${config.nodeId}`);
```

### 0.4.6 Olemassaolevien endpointien hyödyntäminen

Profiilien kirjoitus ja luku tapahtuu **olemassaolevien** memory-endpointien kautta:

```
POST /v1/memory  { "key": "profile.alice.interests", "value": ["lintubongaus"], "visibility": "public" }
GET  /v1/memory/profile.alice.interests
GET  /v1/memory?prefix=profile.alice
```

Ei uusia endpointeja Phase 0.4:ssä. Phase 1.4 (hakemistot) lisää uuden discovery-endpointin.

### 0.4.7 Dokumentaatio

**Uusi tiedosto:** `docs/aimeat-interest-profile-spec.md`

Sisältö:
- Standardoidut avainnimet ja niiden schemat
- Esimerkkejä profiilin luomisesta
- Consent-mallin kuvaus
- Ohje hakemistojen ja AI-matchauksen hyödyntämiseen (Phase 1-2 preview)

### 0.4.8 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | Noden käynnistys → profiilic schemat rekisteröity | `GET /v1/schemas?prefix=profile` palauttaa 4+ schemaa |
| 2 | Kirjoita validi interests-taulukko | 200, tallennettu |
| 3 | Kirjoita interests ei-taulukkona (string) | 422 SCHEMA_VALIDATION_FAILED |
| 4 | Kirjoita location ilman citya | 422 |
| 5 | Kirjoita validi location geolla | 200 |
| 6 | Kirjoita bio yli 500 merkkiä | 422 |
| 7 | Luo consent profile.alice.* → lue profiilit toisena agenttina | 200 |
| 8 | Ilman consenttia → yritä lukea → hylätty | 403 |

### 0.4.9 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `src/services/profile-schemas.ts` |
| **Uusi** | `docs/aimeat-interest-profile-spec.md` |
| **Muokataan** | `src/server.ts` — kutsu seedProfileSchemas() |

---

## 0.5 OTP/TOTP-tuki

> Lähde: `docs/research/otp-totp-integraatio.md`

### 0.5.1 Tavoite

Lisätä TOTP (Time-based One-Time Password) -tuki GHII-kirjautumiseen. Tämä on kriittinen turvallisuusominaisuus ihmiskäyttäjille joiden ainoa autentikaatiotekijä on salasana.

### 0.5.2 Uudet riippuvuudet

```bash
cd aimeat
pnpm add otpauth qrcode
pnpm add -D @types/qrcode
```

| Paketti | Versio | Koko | Tarkoitus |
|---|---|---|---|
| `otpauth` | ^9.x | ~8KB | TOTP-generointi ja -validointi (0 riippuvuutta, TypeScript) |
| `qrcode` | ^1.x | ~30KB | QR-koodien generointi (data URL, SVG, terminaali) |
| `@types/qrcode` | ^1.x | — | TypeScript-tyypit qrcodelle |

### 0.5.3 Storage-muutokset

#### GHIIRecord-laajennukset

**Tiedosto:** `src/storage/interface.ts`

```typescript
export interface GHIIRecord {
  // ... nykyiset kentät (username, nodeId, ghii, displayName, bio, avatar,
  //     locale, passwordHash, verificationLevel, ownerName, createdAt, updatedAt) ...

  // Uudet TOTP-kentät:
  totpSecret?: string;          // AES-256-GCM salattu TOTP secret (Base32)
  totpEnabled: boolean;         // Onko TOTP aktivoitu (default: false)
  totpBackupCodes?: string[];   // SHA-256 hash:atut varakoodit
  totpLastUsedAt?: string;      // Viimeksi käytetyn koodin aikaleima (replay-suojaus)
  totpLastUsedCode?: string;    // Viimeksi käytetty koodi (replay-suojaus)
  totpFailedAttempts?: number;  // Epäonnistuneet yritykset (rate limiting)
  totpLockedUntil?: string;     // Lukittu tähän asti (rate limiting)
}
```

**HUOM:** `totpEnabled` on boolean jota EI voi asettaa ` optional`:ksi — se tarvitsee default-arvon `false`. Kaikki nykyiset GHIIRecordit saavat `totpEnabled: false` implisiittisesti.

### 0.5.4 Uusi service: TOTP

**Uusi tiedosto:** `src/services/totp.ts`

```typescript
import { TOTP, Secret } from 'otpauth';
import QRCode from 'qrcode';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

// ── TOTP-konfiguraatio ──

export interface TotpConfig {
  issuer: string;           // "AIMEAT" (näkyy sovelluksessa)
  algorithm: 'SHA1';        // Ainoa joka toimii kaikissa (Google Auth, MS Auth)
  digits: 6;                // 6-numeroinen koodi
  period: 30;               // 30 sekunnin ikkuna
  window: 1;                // ±1 ikkuna toleranssi
  backupCodeCount: number;  // 10 varakoodia
  encryptionKey?: Buffer;   // AES-256-GCM -avain secretin salaamiseen
}

// ── Secret-generointi ──

export interface TotpSetupResult {
  secret: string;           // Base32-enkoodattu secret (näytetään vain kerran)
  uri: string;              // otpauth:// URI
  qrDataUrl: string;        // data:image/png;base64,...
  backupCodes: string[];    // 10 × 8-merkkistä varakoodia (selkokieliset, näytetään vain kerran)
  encryptedSecret: string;  // Salattu versio storageen tallennettavaksi
  hashedBackupCodes: string[]; // SHA-256 hash:atut varakoodit storageen
}

export async function setupTotp(
  username: string,
  config: TotpConfig,
): Promise<TotpSetupResult> {
  const secret = new Secret({ size: 20 });
  const totp = new TOTP({
    issuer: config.issuer,
    label: username,
    algorithm: config.algorithm,
    digits: config.digits,
    period: config.period,
    secret,
  });

  const uri = totp.toString();
  const qrDataUrl = await QRCode.toDataURL(uri);

  // Varakoodit: 10 × 8-merkkinen satunnainen koodi
  const backupCodes: string[] = [];
  const hashedBackupCodes: string[] = [];
  for (let i = 0; i < config.backupCodeCount; i++) {
    const code = randomBytes(4).toString('hex'); // 8 hex-merkkiä
    backupCodes.push(code);
    hashedBackupCodes.push(createHash('sha256').update(code).digest('hex'));
  }

  // Salaa secret storagea varten
  const encryptedSecret = config.encryptionKey
    ? encryptSecret(secret.base32, config.encryptionKey)
    : secret.base32; // Ei salausta → tallennetaan sellaisenaan (dev-moodi)

  return {
    secret: secret.base32,
    uri,
    qrDataUrl,
    backupCodes,
    encryptedSecret,
    hashedBackupCodes,
  };
}

// ── Validointi ──

export function validateTotpCode(
  encryptedSecret: string,
  code: string,
  config: TotpConfig,
): { valid: boolean; delta: number | null } {
  const secretBase32 = config.encryptionKey
    ? decryptSecret(encryptedSecret, config.encryptionKey)
    : encryptedSecret;

  const totp = new TOTP({
    issuer: config.issuer,
    algorithm: config.algorithm,
    digits: config.digits,
    period: config.period,
    secret: Secret.fromBase32(secretBase32),
  });

  const delta = totp.validate({ token: code, window: config.window });
  return { valid: delta !== null, delta };
}

// ── Varakoodi-validointi ──

export function validateBackupCode(
  code: string,
  hashedCodes: string[],
): { valid: boolean; index: number } {
  const hashed = createHash('sha256').update(code).digest('hex');
  const index = hashedCodes.indexOf(hashed);
  return { valid: index !== -1, index };
}

// ── AES-256-GCM salaus/purku ──

function encryptSecret(secret: string, key: Buffer): string { ... }
function decryptSecret(data: string, key: Buffer): string { ... }
```

### 0.5.5 Uusi route: TOTP Management

**Uusi tiedosto:** `src/routes/totp.ts`

```typescript
export function totpRouter(config: MeatConfig, storage: Storage): Router
```

#### POST /v1/ghii/totp/setup — Aloita TOTP-setup

| Kenttä | Arvo |
|---|---|
| **Metodi** | POST |
| **Polku** | `/v1/ghii/totp/setup` |
| **Auth** | Vaatii JWT (GHII-käyttäjä) |

**Response 200:**

```json
{
  "ok": true,
  "data": {
    "totp_secret": "JBSWY3DPEHPK3PXP",
    "totp_uri": "otpauth://totp/AIMEAT:alice?secret=JBSWY3DPEHPK3PXP&issuer=AIMEAT&algorithm=SHA1&digits=6&period=30",
    "qr_data_url": "data:image/png;base64,...",
    "backup_codes": ["a1b2c3d4", "e5f6g7h8", ...],
    "note": "Scan the QR code with your authenticator app. Save the backup codes securely. They cannot be shown again."
  }
}
```

**Logiikka:**
1. Hae GHIIRecord käyttäjän perusteella
2. Jos `totpEnabled === true` → 409 TOTP_ALREADY_ENABLED
3. Generoi TOTP setup (`setupTotp()`)
4. **Tallenna salattu secret tilapäisesti** (vielä EI aktivoi):
   - Aseta `totpSecret = encryptedSecret` storageen
   - `totpEnabled` pysyy `false` — aktivoidaan vasta verify-vaiheessa
   - `totpBackupCodes = hashedBackupCodes` storageen
5. Palauta secret, URI, QR-koodi ja varakoodit

#### POST /v1/ghii/totp/verify — Vahvista ja aktivoi TOTP

| Kenttä | Arvo |
|---|---|
| **Metodi** | POST |
| **Polku** | `/v1/ghii/totp/verify` |
| **Auth** | Vaatii JWT |

**Request body:**

```json
{ "code": "123456" }
```

**Logiikka:**
1. Hae GHIIRecord
2. Jos `totpSecret` puuttuu → 400 TOTP_NOT_SETUP
3. Jos `totpEnabled === true` → 409 TOTP_ALREADY_ENABLED
4. Validoi koodi `validateTotpCode()`
5. Jos validi → aseta `totpEnabled = true` → 200
6. Jos invalidi → 401 INVALID_TOTP

#### DELETE /v1/ghii/totp — Poista TOTP käytöstä

| Kenttä | Arvo |
|---|---|
| **Metodi** | DELETE |
| **Polku** | `/v1/ghii/totp` |
| **Auth** | Vaatii JWT |

**Request body:**

```json
{ "code": "123456" }
```

Vaatii voimassaolevan TOTP-koodin TAI varakoodin poistamiseen. Asettaa `totpEnabled = false`, tyhjentää `totpSecret` ja `totpBackupCodes`.

#### POST /v1/ghii/totp/backup-codes — Generoi uudet varakoodit

| Kenttä | Arvo |
|---|---|
| **Metodi** | POST |
| **Polku** | `/v1/ghii/totp/backup-codes` |
| **Auth** | Vaatii JWT |

**Request body:**

```json
{ "code": "123456" }
```

Vaatii voimassaolevan TOTP-koodin. Generoi 10 uutta varakoodia ja korvaa vanhat. Palauttaa uudet varakoodit selkokielisinä (näytetään vain kerran).

**Response 200:**

```json
{
  "ok": true,
  "data": {
    "backup_codes": ["a1b2c3d4", "e5f6g7h8", ...],
    "note": "Save these codes securely. The previous codes are no longer valid."
  }
}
```

### 0.5.6 Muutokset olemassaoleviin tiedostoihin

#### `src/routes/ghii.ts` — Login-flow-muutos

**POST /v1/ghii/login:**

```typescript
// Nykyisen password-tarkistuksen JÄLKEEN, ENNEN avainten generointia:

// TOTP-tarkistus
const ghiiRecord = await storage.getGHII(ghii);
if (ghiiRecord?.totpEnabled) {
  const { totp_code, backup_code } = req.body;

  if (!totp_code && !backup_code) {
    res.status(401).json(error(config.nodeId, 'TOTP_REQUIRED',
      'TOTP code is required for this account', 401, {
        totp_required: true,
      }));
    return;
  }

  // Rate limiting: tarkista lukitus
  if (ghiiRecord.totpLockedUntil && new Date(ghiiRecord.totpLockedUntil) > new Date()) {
    res.status(429).json(error(config.nodeId, 'TOTP_LOCKED',
      'Too many failed attempts. Try again later.'));
    return;
  }

  let totpValid = false;

  if (totp_code) {
    // Replay-suojaus
    if (ghiiRecord.totpLastUsedCode === totp_code) {
      res.status(401).json(error(config.nodeId, 'TOTP_REPLAY', 'This code has already been used'));
      return;
    }

    const result = validateTotpCode(ghiiRecord.totpSecret!, totp_code, totpConfig);
    totpValid = result.valid;

    if (totpValid) {
      await storage.updateGHII(ghii, {
        totpLastUsedCode: totp_code,
        totpLastUsedAt: new Date().toISOString(),
        totpFailedAttempts: 0,
      });
    }
  } else if (backup_code) {
    const result = validateBackupCode(backup_code, ghiiRecord.totpBackupCodes ?? []);
    totpValid = result.valid;

    if (totpValid) {
      // Poista käytetty varakoodi
      const codes = [...(ghiiRecord.totpBackupCodes ?? [])];
      codes.splice(result.index, 1);
      await storage.updateGHII(ghii, { totpBackupCodes: codes });
    }
  }

  if (!totpValid) {
    // Kasvata failed attempts
    const attempts = (ghiiRecord.totpFailedAttempts ?? 0) + 1;
    const updates: Partial<GHIIRecord> = { totpFailedAttempts: attempts };
    if (attempts >= 5) {
      updates.totpLockedUntil = new Date(Date.now() + 5 * 60_000).toISOString(); // 5 min lukitus
      updates.totpFailedAttempts = 0;
    }
    await storage.updateGHII(ghii, updates);

    res.status(401).json(error(config.nodeId, 'INVALID_TOTP', 'Invalid TOTP code'));
    return;
  }
}

// ... jatka normaalisti avainten generointiin ja JWT:n luontiin ...
```

#### `src/config.ts` — Uudet konfiguraatiokentät

```typescript
// TOTP
totpEnabled: boolean;                    // Feature flag (default: true)
totpIssuer: string;                      // QR-koodissa näkyvä nimi (default: 'AIMEAT')
totpAlgorithm: 'SHA1';                   // Ainoa joka toimii kaikkialla
totpDigits: 6;                           // Koodin pituus
totpPeriod: number;                      // Sekuntia (default: 30)
totpWindow: number;                      // ±N ikkunaa toleranssi (default: 1)
totpBackupCodeCount: number;             // Varakoodien määrä (default: 10)
totpSecretEncryptionKey: string | null;  // AES-256-avain (hex, 64 merkkiä) tai null
totpMaxFailedAttempts: number;           // Max yrityksiä ennen lukitusta (default: 5)
totpLockoutSeconds: number;             // Lukitusaika sekunteina (default: 300)
```

**Ympäristömuuttujat:**

```env
AIMEAT_TOTP_ENABLED=true
AIMEAT_TOTP_ISSUER=AIMEAT
AIMEAT_TOTP_PERIOD=30
AIMEAT_TOTP_WINDOW=1
AIMEAT_TOTP_BACKUP_CODE_COUNT=10
AIMEAT_TOTP_SECRET_ENCRYPTION_KEY=       # Tyhjä = ei salausta (vain dev)
AIMEAT_TOTP_MAX_FAILED_ATTEMPTS=5
AIMEAT_TOTP_LOCKOUT_SECONDS=300
```

### 0.5.7 Turvallisuuskäytännöt

| Uhka | Suojaus |
|---|---|
| Brute force | 5 yritystä → 5 min lukitus |
| Replay attack | Viimeksi käytetty koodi + aikaleima tallennetaan |
| Secret-vuoto | AES-256-GCM -salaus at rest |
| Puhelimen katoaminen | 10 kertakäyttöistä varakoodia |
| Man-in-the-middle | HTTPS (TLS) pakollinen tuotannossa |
| Aikasynkronointi | ±1 ikkunan toleranssi (±30s) |

### 0.5.8 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | `POST /v1/ghii/totp/setup` ilman authia | 401 |
| 2 | `POST /v1/ghii/totp/setup` autentikoituna | 200, secret + QR + varakoodit |
| 3 | `POST /v1/ghii/totp/verify` oikealla koodilla | 200, totpEnabled = true |
| 4 | `POST /v1/ghii/totp/verify` väärällä koodilla | 401 INVALID_TOTP |
| 5 | Login ilman TOTP:a kun enabled | 401 TOTP_REQUIRED (body: totp_required: true) |
| 6 | Login oikealla TOTP-koodilla | 200, normaalit avaimet + JWT |
| 7 | Login väärällä TOTP-koodilla | 401 INVALID_TOTP |
| 8 | Login varakoodilla | 200, varakoodi poistetaan listalta |
| 9 | Sama varakoodi uudestaan | 401 (jo käytetty) |
| 10 | 5 väärää yritystä → lukitus | 429 TOTP_LOCKED |
| 11 | Odota lukitusajan → yritä uudelleen | 200 (lukitus ohi) |
| 12 | `DELETE /v1/ghii/totp` oikealla koodilla | 200, TOTP disabled |
| 13 | `POST /v1/ghii/totp/setup` kun jo enabled | 409 TOTP_ALREADY_ENABLED |
| 14 | Login saman koodin kahdesti 30s sisällä | 401 TOTP_REPLAY |
| 15 | TOTP_ENABLED=false → setup-endpoint palauttaa 503 | 503 FEATURE_DISABLED |
| 16 | `POST /v1/ghii/totp/backup-codes` oikealla TOTP-koodilla | 200, 10 uutta varakoodia |
| 17 | `POST /v1/ghii/totp/backup-codes` väärällä koodilla | 401 INVALID_TOTP |
| 18 | Vanhat varakoodit eivät toimi uusien generoinnin jälkeen | 401 |

### 0.5.9 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `src/services/totp.ts` |
| **Uusi** | `src/routes/totp.ts` |
| **Muokataan** | `src/storage/interface.ts` — GHIIRecord TOTP-kentät |
| **Muokataan** | `src/storage/memory.ts` — GHIIRecord default-arvot |
| **Muokataan** | `src/storage/mongodb.ts` — GHIIRecord TOTP-kentät MongoDB:lle |
| **Muokataan** | `src/routes/ghii.ts` — login-flow TOTP-tarkistus |
| **Muokataan** | `src/config.ts` — TOTP-konfiguraatio |
| **Muokataan** | `src/models/schemas.ts` — TotpSetupSchema, TotpVerifySchema |
| **Muokataan** | `src/server.ts` — totpRouter import + mount |
| **Muokataan** | `test/e2e-full.ts` — TOTP-testifaasi |

---

## 0.6 DMZ-arkkitehtuurin formalisointi

> Lähde: `docs/nextlevel/aimeat-dmz-concept.md`

### 0.6.1 Tavoite

Formalisoida DMZ-konsepti osaksi AIMEAT-protokollan arkkitehtuuridokumentaatiota ja yhdistää se Phase 0.3 Consent Layeriin. Tämä on pääasiassa dokumentaatio-tehtävä — koodissa DMZ ilmenee consent-sääntöjen ja visibility-kontrollien kautta.

### 0.6.2 Uusi dokumentti

**Uusi tiedosto:** `docs/aimeat-dmz-architecture.md`

Sisältö:

#### 1. Johdanto — DMZ-metafora

- Verkkoturvallisuuden DMZ → AIMEAT:n tiedon DMZ
- Kuva: Private Zone → DMZ → Federation (päivitetty kaavio alkuperäisestä konseptista)

#### 2. Kolme vyöhykettä

| Vyöhyke | Kuvaus | Kuka päättää | Consent-rooli |
|---|---|---|---|
| **Private Zone** | Käyttäjän kone, paikallinen AI, private memory | Käyttäjä | Ei tarvita — data ei poistu |
| **DMZ** | Controlled sharing layer: federation-visible memory, actions, work queue | Käyttäjä consent-sääntöjen kautta | **Consent Layer hallitsee** |
| **Federation** | Muut nodet, agentit, palvelut | Protokolla (salaus, autentikointi) | Consent tarkistetaan lukuhetkellä |

#### 3. Datan virtaus vyöhykkeittäin

```
┌─────────────────────────────────────────────────────────────────┐
│                     DATA FLOW                                    │
│                                                                  │
│  ┌──────────────┐    CONSENT     ┌──────────┐    PROTOCOL    ┌──────────┐
│  │              │    RULES       │          │    ENCRYPTION  │          │
│  │  PRIVATE     │───────────────►│   DMZ    │───────────────►│FEDERATION│
│  │  ZONE        │  user decides  │          │  authenticated │          │
│  │              │  what crosses  │          │  & encrypted   │          │
│  │  visibility: │                │ visibility:│               │          │
│  │  "private"   │                │ "owner"/  │               │  Other   │
│  │              │                │ "federation"│              │  nodes   │
│  └──────────────┘                └──────────┘               └──────────┘
│                                       │                                  │
│                          ┌────────────┴────────────┐                    │
│                          │  CONSENT LAYER decides:  │                    │
│                          │  • WHO can read           │                    │
│                          │  • WHAT data patterns     │                    │
│                          │  • HOW LONG (expires)     │                    │
│                          │  • FOR WHAT PURPOSE       │                    │
│                          │  • AUDIT: who accessed    │                    │
│                          └───────────────────────────┘                    │
│                                                                          │
│  INBOUND: Outside → Inside = NEVER (by architecture)                    │
│  Only: requests arrive → queued → user/agent decides to respond          │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 4. Visibility → Vyöhyke -mapping

| Memory visibility | Vyöhyke | Consent tarvitaan? |
|---|---|---|
| `private` | Private Zone | Ei — vain omistaja näkee |
| `owner` | DMZ (rajoitettu) | Kyllä — consent päättää kuka lukee |
| `public` | Federation | Ei — kaikki näkevät |
| `federation` (tuleva) | DMZ (consent-ohjattu) | Kyllä — consent + scope |

**HUOM:** Nykyinen `visibility` on `private | owner | public`. Phase 0.3 Consent Layer lisää hienomman kontrollin `owner`-visibilityyn. Myöhemmin (Phase 1+) harkitaan `federation`-visibilityn lisäämistä.

#### 5. Consent + DMZ -integraatio

Taulukko joka näyttää miten consent-sääntö kartoittuu DMZ-vyöhykkeisiin:

```
Consent { scope: "dmz" }         → data näkyy vain DMZ:n kautta (saman noden sisällä)
Consent { scope: "federation" }  → data näkyy myös federaation kautta (muut nodet)
Consent { scope: "private" }     → ei varsinaista hyötyä — data pysyy privaattina
```

#### 6. Turvallisuusperiaatteet

1. **Outside → Inside = NEVER** — ulkomaailma ei koskaan pääse suoraan privaattiin dataan
2. **Consent on revocable** — käyttäjä voi peruuttaa suostumuksen milloin tahansa
3. **Audit trail** — kaikki datankäytöt kirjataan
4. **Encryption in transit** — federaatio-liikenne salataan
5. **Identity required** — datankäyttö vaatii aina tunnistetun identiteetin (GAII/GHII)

#### 7. Vaikutus myöhempiin phaseeihin

| Phase | Miten DMZ vaikuttaa |
|---|---|
| Phase 1 — Hakemistot | Hakemisto näyttää vain consent-ohjatut profiilit |
| Phase 1 — Tietolompakko | Portaalin UI näyttää DMZ-vyöhykkeen datan |
| Phase 2 — AI-matchaus | Matchaus lukee vain consent-sallitut profiilit |
| Phase 2 — Organismit | Organismi-jäsenyyden consent = shared workspace access |
| Phase 3 — EUDIW | EU-lompakko → GHII Tier 3 = DMZ-tason vahva identiteetti |

### 0.6.3 Koodimuutokset

Phase 0.6 on ensisijaisesti dokumentaatiotehtävä. Koodissa DMZ ilmenee:

1. **Memory visibility** (`private | owner | public`) — jo olemassa
2. **Consent Layer** (Phase 0.3) — hallitsee DMZ-vyöhykettä
3. **Federation encryption** — jo olemassa peering-mekanismissa

Ainoa mahdollinen koodimuutos:

**`src/routes/memory.ts`** — Lisää response-kenttä `zone` joka kertoo mihin vyöhykkeeseen data kuuluu:

```typescript
// GET /v1/memory/:key response:
{
  ...existingFields,
  zone: visibility === 'private' ? 'private' : visibility === 'public' ? 'federation' : 'dmz',
}
```

### 0.6.4 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | Private memory → zone = "private" | Vastaus sisältää `zone: "private"` |
| 2 | Owner memory → zone = "dmz" | Vastaus sisältää `zone: "dmz"` |
| 3 | Public memory → zone = "federation" | Vastaus sisältää `zone: "federation"` |

### 0.6.5 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `docs/aimeat-dmz-architecture.md` — DMZ-arkkitehtuuridokumentti |
| **Muokataan** | `src/routes/memory.ts` — lisää `zone`-kenttä vastauksiin (valinnainen) |

---

## 0.7 Semanttinen ontologia — Data Description Semantic Layer

> Lähteet: W3C JSON-LD, Schema.org, QUDT, SenML (RFC 8428), W3C WoT Thing Description, SAREF (ETSI), `docs/nextlevel/aimeat-data-description-convention.md`

### 0.7.1 Tavoite

Lisätä AIMEAT:n datakuvauksiin vapaaehtoinen semanttinen kerros, joka mahdollistaa AI-agenttien ymmärtää datan **merkityksen** — ei vain rakenteen (JSON Schema) eikä vain metadatan (Data Description Convention), vaan myös: mitä tämä data **edustaa**, missä **yksiköissä**, miten se **liittyy** tunnettuihin ontologioihin, ja miten AI voi **käyttää** sitä päätöksenteossa.

**Miksi Phase 0:ssa?** Ontologia on konventio — ei pakollinen, ei riko mitään. Mutta jos se otetaan mukaan *alusta asti*, kaikki myöhemmät komponentit (hakemistot, matchaus, marketplace, AI-agentit) voivat hyödyntää sitä. Jälkikäteen lisääminen on aina vaikeampaa kuin alusta mukaan suunnittelu.

**Laajuus:** Ontologiaa ei käytetä vain IoT/lämpötila-datassa. Se kattaa:

| Käyttökohde | Esimerkki | Hyöty agentille |
|---|---|---|
| **IoT-sensorit** | Lämpötila, kosteus, paine | Yksikön ymmärtäminen, konversiot, vertailtavuus |
| **Henkilöprofiilit** | Taidot, kiinnostukset, roolit | Schema.org Person -tyypitys → AI matchaus |
| **CSM-palvelut** | Hakemisto, marketplace, huutokauppa | Schema.org Service/Product/Action → palvelun luonteen ymmärtäminen |
| **API-toiminnot** | Action catalogue, work queue | Schema.org Action + EntryPoint → mitä action tekee |
| **Sisällön kuvaus** | Kieli, genre, formaatti | Schema.org CreativeWork → sisällön luokittelu |
| **Marketplace-listaukset** | Tuotteet, tarjoukset, hinnat | Schema.org Offer/Product → kaupankäynnin semantiikka |
| **Maantieteellinen data** | Sijainnit, alueet | Schema.org Place/GeoCoordinates → paikkatietoisuus |
| **Ajallinen data** | Tapahtumat, aikataulut | Schema.org Event/Schedule → aikataulujen ymmärtäminen |

### 0.7.2 Arkkitehtuuripäätös: JSON-LD-yhteensopiva `semantic`-kenttä

AIMEAT ei pakota täyttä JSON-LD-prosessointia. Sen sijaan Data Description Convention laajennetaan uudella **`semantic`-osiolla** joka on JSON-LD-yhteensopiva mutta ei vaadi JSON-LD-prosessoria.

**Perusrakenne:**

```json
{
  "meta": {
    "description": "...",
    "category": "...",
    "semantic": {
      "@context": {
        "schema": "https://schema.org/",
        "qudt": "http://qudt.org/schema/qudt/",
        "unit": "http://qudt.org/vocab/unit/",
        "saref": "https://saref.etsi.org/core/"
      },
      "@type": "...",
      "properties": { ... }
    }
  }
}
```

**Periaatteet:**
1. **Vapaaehtoinen** — `semantic` puuttuu → ei vaikutusta, kaikki toimii
2. **JSON-LD-yhteensopiva** — kenttä ON validi JSON-LD, mutta AIMEAT ei vaadi `@context` -resoluutiota
3. **Ihmisluettava** — prefiksit (`schema:`, `qudt:`, `unit:`) selittävät merkityksen
4. **Agentti-optimoitu** — AI voi päätellä merkityksen kontekstista ilman HTTP-lookuppeja

### 0.7.3 Ontologiakirjastot ja käyttökohteet

#### A. Schema.org — Laaja yleisontologia

Schema.org kattaa valtaosan AIMEAT:n käyttötapauksista:

| Schema.org -tyyppi | AIMEAT-käyttökohde | Esimerkki |
|---|---|---|
| `schema:Person` | GHII-profiili, interest profiles | `profile.*.interests`, `profile.*.bio` |
| `schema:Organization` | Organismit, yhteisöt | Phase 2 organismit |
| `schema:Service` | CSM-palvelut, action catalogue | `csm.hobby-directory`, `csm.marketplace` |
| `schema:Product` | Marketplace-listaukset | Myynti-ilmoitukset |
| `schema:Offer` | Hinnoittelu, morsel-ekonomia | Action pricing, marketplace hinnat |
| `schema:Action` | AIMEAT actions, work queue | `speech-to-text`, `translate` |
| `schema:Event` | Tapahtumahakemistot | Yhteisötapahtumat |
| `schema:Place` | Sijainnit, alueet | `profile.*.location` |
| `schema:CreativeWork` | Sisältö: artikkelit, media | Board-viestit, uutiset |
| `schema:SoftwareApplication` | AI-agentit, sovellukset | Agenttien kuvaus |

#### B. QUDT — Yksiköt ja suureet (IoT, mittaukset)

[QUDT](http://qudt.org) standardoi yksiköt URI-pohjaisesti:

| QUDT URI | Merkitys | SenML-vastaavuus |
|---|---|---|
| `unit:DEG_C` | Celsius-aste | `Cel` |
| `unit:DEG_F` | Fahrenheit-aste | — |
| `unit:K` | Kelvin | `K` |
| `unit:PA` | Pascal (paine) | `Pa` |
| `unit:PERCENT_RH` | Suhteellinen kosteus | `%RH` |
| `unit:LUX` | Valaistusvoimakkuus | `lx` |
| `unit:M-PER-SEC` | Tuulen nopeus | `m/s` |
| `unit:KiloW-HR` | Energiankulutus | `kWh` |

#### C. SAREF — IoT-laitteet ja mittaukset

[SAREF](https://saref.etsi.org) kuvaa IoT-laitteiden ominaisuuksia:

- `saref:Temperature`, `saref:Humidity`, `saref:Pressure`
- `saref:Measurement` — yksittäinen mittaus
- `saref:Sensor`, `saref:Actuator` — laitteen tyyppi

#### D. SenML (RFC 8428) — Kompakti sensoridata

SenML-yksikkökoodit ovat kompakteja ja standardoituja. AIMEAT voi tukea SenML-viittauksia `semantic`-kentässä:

```json
"semantic": {
  "@type": "saref:Measurement",
  "senml_unit": "Cel",
  "senml_name": "urn:dev:ow:10e2073a01080063"
}
```

### 0.7.4 Konkreettiset esimerkit

#### A. IoT-lämpötilamitta

```json
{
  "key": "iot.temperature.living-room",
  "value": { "celsius": 21.5, "measured_at": "2026-03-01T14:30:00Z" },
  "meta": {
    "description": "Olohuoneen lämpötila, Ruuvi RH-001",
    "quality": "sensor",
    "accuracy": "±0.3°C",
    "semantic": {
      "@context": {
        "saref": "https://saref.etsi.org/core/",
        "qudt": "http://qudt.org/schema/qudt/",
        "unit": "http://qudt.org/vocab/unit/"
      },
      "@type": "saref:Measurement",
      "saref:measuresProperty": "saref:Temperature",
      "qudt:unit": "unit:DEG_C",
      "operational_range": { "min": -40, "max": 85, "unit": "unit:DEG_C" },
      "senml_unit": "Cel"
    }
  }
}
```

#### B. Henkilöprofiili (interest profile)

```json
{
  "key": "profile.alice.interests",
  "value": ["lintubongaus", "retro-pelit", "kokkaus"],
  "meta": {
    "semantic": {
      "@context": { "schema": "https://schema.org/" },
      "@type": "schema:Person",
      "schema:interestCount": 3,
      "schema:knowsAbout": ["ornithology", "retro-gaming", "cooking"]
    }
  }
}
```

#### C. CSM-palvelukuvaus (hakemisto)

```yaml
# hobby-directory.csm.yaml
service:
  name: "Harrastehakemisto"
  type: "directory"
  description: "Löydä harrastuksia ja samanhenkisiä läheltäsi"
  semantic:
    "@context":
      schema: "https://schema.org/"
    "@type": "schema:WebApplication"
    "schema:applicationCategory": "DirectoryService"
    "schema:featureList":
      - "schema:SearchAction"
      - "schema:DiscoverAction"
    "schema:audience":
      "@type": "schema:PeopleAudience"
      "schema:geographicArea": "Finland"
```

#### D. Action Catalogue -toiminto

```json
{
  "action": "speech-to-text-secure",
  "meta": {
    "semantic": {
      "@context": { "schema": "https://schema.org/" },
      "@type": "schema:ConsumeAction",
      "schema:instrument": {
        "@type": "schema:SoftwareApplication",
        "schema:applicationCategory": "AI/ML",
        "schema:operatingSystem": "Linux"
      },
      "schema:object": {
        "@type": "schema:AudioObject"
      },
      "schema:result": {
        "@type": "schema:TextDigitalDocument"
      }
    }
  }
}
```

#### E. Marketplace-listaus

```json
{
  "key": "csm.marketplace.listing.bike-01",
  "value": { "name": "Trek Marlin 6", "price": 450, "condition": "good" },
  "meta": {
    "semantic": {
      "@context": { "schema": "https://schema.org/" },
      "@type": "schema:Offer",
      "schema:itemOffered": {
        "@type": "schema:Product",
        "schema:category": "Bicycles",
        "schema:productionDate": "2023"
      },
      "schema:priceCurrency": "EUR",
      "schema:availability": "schema:InStock",
      "schema:itemCondition": "schema:UsedCondition"
    }
  }
}
```

#### F. Board-viesti (foorumi/uutiset)

```json
{
  "key": "board.local-news.post-42",
  "value": { "title": "Uusi koirapuisto avattu", "body": "..." },
  "meta": {
    "semantic": {
      "@context": { "schema": "https://schema.org/" },
      "@type": "schema:NewsArticle",
      "schema:about": {
        "@type": "schema:Place",
        "schema:name": "Tapiolan koirapuisto"
      },
      "schema:inLanguage": "fi",
      "schema:datePublished": "2026-03-01"
    }
  }
}
```

### 0.7.5 Muutokset olemassaoleviin dokumentteihin

#### A. Data Description Convention v1.1

**Tiedosto:** `docs/nextlevel/aimeat-data-description-convention.md`

Lisätään uusi **§3.6 Semantic (Ontology)**:

```markdown
### 3.6 Semantic (Ontology)

For data where machine understanding matters — AI agents, automated discovery, cross-system interop.

| Field | Type | Example | Description |
|---|---|---|---|
| `semantic` | object | `{ "@context": {...}, "@type": "..." }` | JSON-LD-compatible semantic annotation |
| `semantic.@context` | object | `{ "schema": "https://schema.org/" }` | Namespace prefixes for ontology URIs |
| `semantic.@type` | string | `"schema:Measurement"` | The semantic type of this data |
| `semantic.properties` | object | `{ "unit": "unit:DEG_C" }` | Type-specific semantic properties |

Recommended ontologies:
- **Schema.org** (`schema:`) — People, services, products, actions, events, places
- **QUDT** (`qudt:`, `unit:`) — Physical quantities and units
- **SAREF** (`saref:`) — IoT devices and measurements
- **SenML** — Compact sensor unit codes (Cel, K, Pa, %RH, etc.)

The semantic field is JSON-LD-compatible but does not require JSON-LD processing.
AI agents can use the @type and property values directly for reasoning.
```

#### B. CSM-spesifikaatio

**Tiedosto:** `docs/csm-spec.md` (Phase 0.2)

CSM YAML -formaattiin lisätään valinnainen `semantic`-kenttä:

```yaml
service:
  name: "..."
  type: "directory"
  semantic:              # Valinnainen
    "@context":
      schema: "https://schema.org/"
    "@type": "schema:WebApplication"
    "schema:applicationCategory": "DirectoryService"
```

#### C. Interest Profile Spec

**Tiedosto:** `docs/aimeat-interest-profile-spec.md` (Phase 0.4)

Lisätään suositus käyttää `schema:Person`-ontologiaa profiilikuvauksissa:

```json
{
  "key": "profile.alice.interests",
  "value": ["lintubongaus"],
  "meta": {
    "semantic": {
      "@context": { "schema": "https://schema.org/" },
      "@type": "schema:Person",
      "schema:knowsAbout": ["ornithology"]
    }
  }
}
```

### 0.7.6 SchemaRecord-laajennusehdotus

Harkitaan `SchemaRecord`:iin vapaaehtoista `semanticContext`-kenttää:

```typescript
export interface SchemaRecord {
  // ... nykyiset kentät ...
  semanticContext?: {
    '@context'?: Record<string, string>;
    '@type'?: string;
    properties?: Record<string, unknown>;
  };
}
```

**Tämä mahdollistaa:** Kun schema lukitaan avaimeen, voidaan samalla kiinnittää semanttinen tyyppi. Kaikki kyseisen avaimen datapisteet perivät saman ontologiatyypin ilman, että jokaisen kirjoituksen pitää toistaa se.

**Päätös:** Implementaatiovaiheessa arvioidaan tarvitaanko tätä Phase 0:ssa vai onko `meta.semantic` memory-kirjoituksissa riittävä.

### 0.7.7 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | Memory-kirjoitus `meta.semantic` -kentällä → tallentuu oikein | 200, semantic säilyy value/meta:ssa |
| 2 | Memory-luku → semantic-kenttä palautuu | 200, `meta.semantic` mukana |
| 3 | CSM-parseri tukee `semantic`-kenttää YAML:ssa | Parsittu `CsmDefinition` sisältää semantic |
| 4 | Schema locking ei estä semantic-metatietoa (open mode) | 200, ylimääräiset kentät sallittu |

### 0.7.8 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Muokataan** | `docs/nextlevel/aimeat-data-description-convention.md` — lisää §3.6 Semantic |
| **Muokataan** | `docs/csm-spec.md` — lisää semantic-kenttä CSM-formaattiin |
| **Muokataan** | `docs/aimeat-interest-profile-spec.md` — lisää ontologia-suositukset |
| **Muokataan** | `src/storage/interface.ts` — valinnainen `semanticContext` SchemaRecordiin |
| **Muokataan** | `src/services/csm-parser.ts` — tukee semantic-kenttää |

---

## 0.8 Dokumentaation ylläpitosuunnitelma

### 0.8.1 Tavoite

Määritellä kaikki dokumentit ja artefaktit joita Phase 0 -muutokset edellyttävät päivitettäväksi. Tämä varmistaa, ettei yksikään dokumentti jää päivittämättä implementoinnin yhteydessä.

### 0.8.2 Dokumenttikartta

#### A. Protokolladokumentaatio (RFC / Core)

| Dokumentti | Vaikuttavat komponentit | Tarvittavat muutokset |
|---|---|---|
| `docs/01-core.md` | 0.1, 0.3, 0.7 | +Schema Locking -osio, +Consent Layer -perusteet, +Semantic-viittaus |
| `docs/02-identity.md` | 0.5 | +TOTP-tuki GHII-identiteetissä, +MFA-osio |
| `docs/03-economy.md` | — | Ei muutoksia Phase 0:ssa |
| `docs/04-trust.md` | 0.3 | +Consent ja audit trail -viittaus |
| `docs/05-federation.md` | 0.3, 0.6 | +DMZ-arkkitehtuuri, +consent-ohjattu datan jakaminen |
| `docs/06-actions.md` | 0.7 | +Semantic-annotaatiot action-kuvauksissa |
| `docs/07-boards.md` | 0.7 | +Semantic-tyypitys board-viesteissä |
| `docs/08-personal-node.md` | 0.6 | +DMZ-vyöhykkeet personal nodessa |
| `docs/09-community.md` | 0.2, 0.7 | +CSM-viittaus, +semantic-tyypitys yhteisöpalveluissa |

#### B. Pilaridokumentaatio (nextlevel/)

| Dokumentti | Vaikuttavat komponentit | Tarvittavat muutokset |
|---|---|---|
| `docs/nextlevel/aimeat-json-schema-locking.md` | 0.1 | Päivitys vastaamaan toteutettua versiota (wildcard patterns, semantic) |
| `docs/nextlevel/aimeat-data-description-convention.md` | 0.7 | +§3.6 Semantic (Ontology) |
| `docs/nextlevel/aimeat-dmz-concept.md` | 0.6 | Päivitys linkittämään DMZ-arkkitehtuuridokumenttiin |
| `docs/nextlevel/aimeat-personal-node-spec.md` | 0.5, 0.6 | +TOTP-setup personal nodessa, +DMZ-vyöhykkeet |
| `docs/research/otp-totp-integraatio.md` | 0.5 | Merkkaus "implementoitu" + viittaus toteutukseen |

#### C. Uudet dokumentit (luodaan Phase 0:ssa)

| Dokumentti | Komponentti | Luonti |
|---|---|---|
| `docs/csm-spec.md` | 0.2 | CSM-spesifikaatio |
| `docs/csm-examples/*.csm.yaml` (7 kpl) | 0.2 | CSM-esimerkit |
| `docs/aimeat-interest-profile-spec.md` | 0.4 | Kiinnostusprofiili-spesifikaatio |
| `docs/aimeat-dmz-architecture.md` | 0.6 | DMZ-arkkitehtuuridokumentti |

#### D. API-spesifikaatio

| Tiedosto | Muutokset |
|---|---|
| `openapi.yaml` | +17 uutta endpointia (schema 4, CSM 4, consent 5, TOTP 4) |
| | +Uudet request/response schemat jokaiselle endpointille |
| | +Error-koodit (SCHEMA_VALIDATION_FAILED, CONSENT_DENIED, TOTP_ALREADY_ENABLED, jne.) |
| | +Security schemes (Bearer JWT laajennukset) |

**TÄRKEÄÄ:** `openapi.yaml` on kanoninen API-sopimus josta generoidaan:
- TypeScript-tyypit (client SDK)
- API-dokumentaatio (Swagger UI / Redoc)
- Mahdolliset client-kirjastot

Jokainen uusi endpoint PITÄÄ lisätä `openapi.yaml`:iin ennen kuin implementaatio katsotaan valmiiksi.

#### E. Projektin juuridokumentit

| Tiedosto | Muutokset |
|---|---|
| `README.md` | +Phase 0 -komponenttien maininta, +uudet ympäristömuuttujat |
| `aimeat/.env.example` | +10 uutta ympäristömuuttujaa (consent, TOTP) |
| `CLAUDE.md` | +Uudet route-tiedostot, +uudet service-tiedostot, +uudet testifaasit |

#### F. Masterplan ja Phase-dokumentit

| Tiedosto | Muutokset |
|---|---|
| `docs/plans/2026-03-01-cellularization-masterplan-design.md` | +Phase 0 status päivitys, +ontologia-viittaus |
| Phase 1-3 dokumentit (tulevat) | +Viittaukset Phase 0:n tuottamiin rajapintoihin |

### 0.8.3 Päivitysjärjestys

Dokumenttien päivitysjärjestys seuraa implementointijärjestystä:

```
1. openapi.yaml           ← Ensin API-sopimus (contract-first)
2. Uudet spesifikaatiot   ← csm-spec.md, interest-profile-spec.md, dmz-architecture.md
3. .env.example           ← Ympäristömuuttujat
4. RFC/Core-dokumentit    ← 01-core.md ... 09-community.md (vain viittaukset)
5. Pilaridokumentit       ← nextlevel/ (päivitykset vastaamaan toteutusta)
6. README.md              ← Projektikuvaus
7. CLAUDE.md              ← AI-assistentin ohjeet
8. Masterplan             ← Status-päivitys
```

### 0.8.4 Dokumentaation Definition of Done

Jokaisen Phase 0 -komponentin implementoinnin yhteydessä:

- [ ] `openapi.yaml` päivitetty uusilla endpointeilla
- [ ] Komponentin oma spesifikaatio luotu/päivitetty
- [ ] `.env.example` päivitetty uusilla ympäristömuuttujilla
- [ ] Vaikuttavat RFC-dokumentit päivitetty (vähintään viittaukset)
- [ ] `CLAUDE.md` päivitetty uusilla tiedostoilla ja komennoilla
- [ ] TypeScript-tyypitykset vastaavat `openapi.yaml`:a

---

## 0.9 Testausstrategia

### 0.9.1 Tavoite

Määritellä kattava testausstrategia Phase 0:lle joka varmistaa: (1) jokainen komponentti toimii itsenäisesti, (2) komponentit toimivat yhdessä, (3) olemassaolevat ominaisuudet eivät rikkoudu.

### 0.9.2 Testaustasot

```
┌─────────────────────────────────────────────────────────┐
│                    E2E-testit (integraatio)              │
│     Koko järjestelmä, HTTP-kutsut, live server           │
│     Tiedosto: test/e2e-full.ts                           │
├─────────────────────────────────────────────────────────┤
│                    Yksikkötestit (unit)                   │
│     Yksittäiset funktiot, ei serveriä                     │
│     Tiedostot: test/unit/*.test.ts                        │
├─────────────────────────────────────────────────────────┤
│                    TypeScript-tyyppitarkistus             │
│     npx tsc --noEmit                                     │
│     Varmistaa tyyppiturvallisuuden                        │
└─────────────────────────────────────────────────────────┘
```

### 0.9.3 E2E-testit (nykyinen `test/e2e-full.ts`)

Nykyinen E2E-testisarja (35 testiä, 6 faasia + GDPR) laajennetaan Phase 0 -testifaaseilla:

| Testifaasi | Komponentti | Testejä | Riippuvuudet |
|---|---|---|---|
| Phase 7: Schema Locking | 0.1 | 18 | — |
| Phase 8: CSM | 0.2 | 8 | Phase 7 (schema locking) |
| Phase 9: Consent | 0.3 | 17 | — |
| Phase 10: Interest Profiles | 0.4 | 8 | Phase 7 + 9 |
| Phase 11: TOTP | 0.5 | 18 | — |
| Phase 12: DMZ | 0.6 | 3 | Phase 9 |
| Phase 13: Semantic | 0.7 | 4 | Phase 7 |

**Yhteensä:** 35 (nykyiset) + 76 (uudet) = **111 E2E-testiä**

**E2E-testiympäristö:**
```bash
# Käynnistä testiserveri (port 40251)
cd aimeat
AIMEAT_PORT=40251 AIMEAT_DEV_MODE=true pnpm dev

# Aja testit (toisessa terminaalissa)
npx tsx test/e2e-full.ts
```

### 0.9.4 Yksikkötestit (uusi)

Phase 0 tuo mukanaan tarpeeksi puhdasta liiketoimintalogiikkaa (schema validation, CSM parsing, consent matching, TOTP, pattern matching) jotta yksikkötestit ovat perusteltuja.

**Testiframework:** `vitest` (nopea, TypeScript-natiivi, ESM-tuki)

```bash
cd aimeat
pnpm add -D vitest
```

**`aimeat/vitest.config.ts`:**
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    globals: true,
  },
});
```

**`aimeat/package.json` scripts:**
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "tsx test/e2e-full.ts",
    "test:all": "vitest run && tsx test/e2e-full.ts"
  }
}
```

#### Yksikkötestien suunnitelma

| Testitiedosto | Testaa | Testejä (arvio) |
|---|---|---|
| `test/unit/schema-validator.test.ts` | AJV-validointi, cache, schema mode | 12 |
| `test/unit/wildcard-pattern.test.ts` | `matchWildcardPattern()` | 10 |
| `test/unit/csm-parser.test.ts` | YAML-parsinta, validointi, JSON Schema -generointi | 15 |
| `test/unit/consent-matching.test.ts` | `matchPattern()`, consent logic, expiration | 12 |
| `test/unit/totp-service.test.ts` | TOTP setup, validation, backup codes, encryption | 10 |
| `test/unit/profile-schemas.test.ts` | Profiilit-schemojen validointi | 8 |
| `test/unit/semantic-validation.test.ts` | Semantic-kenttien parsinta ja säilyvyys | 5 |

**Yhteensä:** ~72 yksikkötestiä

#### Esimerkkiyksikkötesti

```typescript
// test/unit/wildcard-pattern.test.ts
import { describe, it, expect } from 'vitest';
import { matchWildcardPattern } from '../../src/storage/memory.js';

describe('matchWildcardPattern', () => {
  it('exact match', () => {
    expect(matchWildcardPattern('profile.alice.interests', 'profile.alice.interests')).toBe(true);
  });

  it('single wildcard *', () => {
    expect(matchWildcardPattern('profile.*.interests', 'profile.alice.interests')).toBe(true);
    expect(matchWildcardPattern('profile.*.interests', 'profile.bob.interests')).toBe(true);
  });

  it('* does not match multiple segments', () => {
    expect(matchWildcardPattern('profile.*.interests', 'profile.alice.deep.interests')).toBe(false);
  });

  it('double wildcard **', () => {
    expect(matchWildcardPattern('iot.**', 'iot.temperature.living-room')).toBe(true);
    expect(matchWildcardPattern('iot.**', 'iot.humidity')).toBe(true);
  });

  it('no match', () => {
    expect(matchWildcardPattern('profile.*.interests', 'iot.temperature')).toBe(false);
  });
});
```

### 0.9.5 TypeScript-tyyppitarkistus

```bash
# Ajetaan aina ennen commitia
cd aimeat
npx tsc --noEmit
```

Tämä on jo käytäntö — Phase 0 ei muuta sitä. Varmistettava:
- Uudet record-tyypit (`SchemaRecord`, `ConsentRecord`, etc.) compileaavat
- Storage-interfacen uudet metodit on implementoitu kaikissa toteutuksissa
- Uudet route-handlerit noudattavat Express 5 -tyyppejä

### 0.9.6 Regressiotestaus

**Periaate:** Olemassaoleva E2E-sarja (35 testiä) ajetaan AINA Phase 0 -testien lisäksi. Jos jokin nykyinen testi rikkoutuu Phase 0 -muutosten takia, se korjataan välittömästi.

**Regressioriski-analyysi:**

| Muutos | Regressioriski | Mitigaatio |
|---|---|---|
| Schema validation memory-kirjoituksissa | Korkea — voi rikkoa nykyisiä testejä jos schema on asetettu | Schemat asetetaan vasta Phase 0 -testifaaseissa, ei kosketa nykyisiä testejä |
| Consent check memory-lukuihin | Keskitaso — voi estää lukuja jos consent vaaditaan | Consent-tarkistus aktivoidaan vain `owner`-visibility-avaimille, ei `public/private` |
| TOTP-kentät GHIIRecordissa | Matala — uudet optional-kentät, oletusarvo false | Ei vaikuta nykyiseen login-flowiin |
| `zone`-kenttä memory-vastauksissa | Matala — uusi kenttä, ei muuta nykyisiä | Nykyiset testit eivät tarkista `zone`-kentän puuttumista |

### 0.9.7 CI/CD-integraatio (suositus)

Phase 0:n jälkeen suositellaan seuraavaa CI-putkea:

```yaml
# .github/workflows/test.yml (esimerkki)
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
      - run: cd aimeat && pnpm install
      - run: cd aimeat && npx tsc --noEmit        # Tyyppicheck
      - run: cd aimeat && pnpm test                # Yksikkötestit
      - run: |                                      # E2E-testit
          cd aimeat
          AIMEAT_PORT=40251 AIMEAT_DEV_MODE=true node dist/server.js &
          sleep 3
          npx tsx test/e2e-full.ts
```

### 0.9.8 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `aimeat/vitest.config.ts` |
| **Uusi** | `test/unit/schema-validator.test.ts` |
| **Uusi** | `test/unit/wildcard-pattern.test.ts` |
| **Uusi** | `test/unit/csm-parser.test.ts` |
| **Uusi** | `test/unit/consent-matching.test.ts` |
| **Uusi** | `test/unit/totp-service.test.ts` |
| **Uusi** | `test/unit/profile-schemas.test.ts` |
| **Uusi** | `test/unit/semantic-validation.test.ts` |
| **Muokataan** | `aimeat/package.json` — lisää vitest, test scripts |
| **Muokataan** | `test/e2e-full.ts` — lisää Phase 7-13 testifaasit |

---

## Yhteenvetotaulukko: kaikki Phase 0 -muutokset

### Uudet tiedostot

| Tiedosto | Komponentti | Tyyppi |
|---|---|---|
| `src/services/schema-validator.ts` | 0.1 | Palvelulogiikka |
| `src/routes/schemas.ts` | 0.1 | Express-reitit |
| `src/services/csm-parser.ts` | 0.2 | Palvelulogiikka |
| `src/routes/csm.ts` | 0.2 | Express-reitit |
| `docs/csm-spec.md` | 0.2 | Dokumentaatio |
| `docs/csm-examples/*.csm.yaml` (7 kpl) | 0.2 | Esimerkit |
| `src/services/consent.ts` | 0.3 | Palvelulogiikka |
| `src/routes/consent.ts` | 0.3 | Express-reitit |
| `src/services/profile-schemas.ts` | 0.4 | Palvelulogiikka |
| `docs/aimeat-interest-profile-spec.md` | 0.4 | Dokumentaatio |
| `src/services/totp.ts` | 0.5 | Palvelulogiikka |
| `src/routes/totp.ts` | 0.5 | Express-reitit |
| `docs/aimeat-dmz-architecture.md` | 0.6 | Dokumentaatio |
| `aimeat/vitest.config.ts` | 0.9 | Testikonfiguraatio |
| `test/unit/schema-validator.test.ts` | 0.9, 0.1 | Yksikkötesti |
| `test/unit/wildcard-pattern.test.ts` | 0.9, 0.1 | Yksikkötesti |
| `test/unit/csm-parser.test.ts` | 0.9, 0.2 | Yksikkötesti |
| `test/unit/consent-matching.test.ts` | 0.9, 0.3 | Yksikkötesti |
| `test/unit/totp-service.test.ts` | 0.9, 0.5 | Yksikkötesti |
| `test/unit/profile-schemas.test.ts` | 0.9, 0.4 | Yksikkötesti |
| `test/unit/semantic-validation.test.ts` | 0.9, 0.7 | Yksikkötesti |

### Muokattavat tiedostot

| Tiedosto | Komponentit | Muutokset |
|---|---|---|
| `src/storage/interface.ts` | 0.1, 0.3, 0.5 | +SchemaRecord, +ConsentRecord, +ConsentAuditEntry, +TOTP-kentät GHIIRecordiin, +metodit |
| `src/storage/memory.ts` | 0.1, 0.3, 0.5 | +schemas Map, +consents Map, +consentAudit[], +TOTP defaults, +metodit |
| `src/storage/mongodb.ts` | 0.1, 0.3, 0.5 | Sama kuin memory.ts — toteuttaa samat uudet Storage-interface-metodit MongoDB:lle |
| `src/routes/memory.ts` | 0.1, 0.3, 0.6 | +schema validation, +consent check, +zone field |
| `src/routes/ghii.ts` | 0.5 | +TOTP login flow |
| `src/models/schemas.ts` | 0.1, 0.2, 0.3, 0.5 | +SchemaSetSchema, +CsmRegistrationSchema, +ConsentCreateSchema, +TotpSchemas |
| `src/config.ts` | 0.3, 0.5 | +consent config, +TOTP config |
| `src/server.ts` | 0.1, 0.2, 0.3, 0.4, 0.5 | +schemaRouter, +csmRouter, +consentRouter, +totpRouter, +seedProfileSchemas, +consentExpiryJob |
| `test/e2e-full.ts` | 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7 | +testifaasit jokaiselle komponentille (Phase 7-13) |
| `docs/nextlevel/aimeat-data-description-convention.md` | 0.7 | +§3.6 Semantic (Ontology) |
| `docs/csm-spec.md` | 0.7 | +semantic-kenttä CSM-formaattiin |
| `docs/aimeat-interest-profile-spec.md` | 0.7 | +ontologia-suositukset |
| `src/services/csm-parser.ts` | 0.7 | +semantic-kentän tuki |
| `aimeat/package.json` | 0.9 | +vitest, +test scripts |
| `openapi.yaml` | 0.8 | +17 uutta endpointia, +request/response schemat |
| `README.md` | 0.8 | +Phase 0 maininta, +ympäristömuuttujat |
| `CLAUDE.md` | 0.8 | +uudet tiedostot, +komennot |
| `aimeat/.env.example` | 0.8 | +10 uutta ympäristömuuttujaa |

### Uudet npm-riippuvuudet

| Paketti | Komponentti | Tyyppi |
|---|---|---|
| `ajv` | 0.1 | production |
| `ajv-formats` | 0.1 | production |
| `yaml` | 0.2 | production |
| `otpauth` | 0.5 | production |
| `qrcode` | 0.5 | production |
| `@types/qrcode` | 0.5 | devDependency |
| `vitest` | 0.9 | devDependency |

### Uudet ympäristömuuttujat

| Muuttuja | Komponentti | Oletus | Kuvaus |
|---|---|---|---|
| `AIMEAT_CONSENT_ENABLED` | 0.3 | `true` | Consent layer feature flag |
| `AIMEAT_CONSENT_AUDIT_RETENTION_DAYS` | 0.3 | `365` | Audit-merkintöjen säilytysaika |
| `AIMEAT_CONSENT_MAX_PER_USER` | 0.3 | `100` | Max consent-sääntöjä per käyttäjä |
| `AIMEAT_TOTP_ENABLED` | 0.5 | `true` | TOTP feature flag |
| `AIMEAT_TOTP_ISSUER` | 0.5 | `AIMEAT` | QR-koodissa näkyvä nimi |
| `AIMEAT_TOTP_PERIOD` | 0.5 | `30` | TOTP-koodin voimassaoloaika (s) |
| `AIMEAT_TOTP_WINDOW` | 0.5 | `1` | Toleranssi-ikkuna (±N × period) |
| `AIMEAT_TOTP_BACKUP_CODE_COUNT` | 0.5 | `10` | Varakoodien määrä |
| `AIMEAT_TOTP_SECRET_ENCRYPTION_KEY` | 0.5 | (tyhjä) | AES-256 -avain hex-muodossa |
| `AIMEAT_TOTP_MAX_FAILED_ATTEMPTS` | 0.5 | `5` | Max TOTP-yrityksiä ennen lukitusta |
| `AIMEAT_TOTP_LOCKOUT_SECONDS` | 0.5 | `300` | Lukitusaika (s) |

### Muutokset olemassaoleviin endpointeihin (0.7b)

| Endpoint | Muutos |
|---|---|
| `POST /v1/actions` | +`semantic` request body & response |
| `GET /v1/actions/:gaii/:id` | +`semantic` response |
| `PUT /v1/actions/:id` | +`semantic` request body & response |
| `POST /v1/agents` | +`semantic` request body & response |
| `GET /v1/agents/:gaii` | +`semantic` response |
| `GET /v1/catalogue` | +`@context` root-level, +`semantic` actioneissa |
| `GET /v1/catalogue/actions` | +`@context`, +`semantic` |
| `GET /v1/catalogue/agents` | +`@context`, +`semantic` |
| `POST /v1/boards/:id/posts` | +`semantic` request body & response |
| `GET /v1/boards/:id/posts` | +`semantic` posteissa |
| `POST /v1/ghii` | +`semantic` request body & response |
| `GET /v1/ghii/:ghii` | +`semantic` response |
| `GET /v1/ghii/directory` | +`semantic` listauksessa |
| `POST /v1/federation/catalogue-sync` | +`semantic` actioneissa |
| `GET /v1/federation/directory` | +`semantic` personal nodeissa |

### Uudet API-endpointit (yhteensä 17)

| Metodi | Polku | Auth | Komponentti |
|---|---|---|---|
| PUT | `/v1/memory/{key}/schema` | JWT, owner+ | 0.1 |
| GET | `/v1/memory/{key}/schema` | Ei | 0.1 |
| DELETE | `/v1/memory/{key}/schema` | JWT, owner+ | 0.1 |
| GET | `/v1/schemas` | Ei | 0.1 |
| POST | `/v1/csm` | JWT, owner | 0.2 |
| GET | `/v1/csm` | Ei | 0.2 |
| GET | `/v1/csm/{name}` | Ei | 0.2 |
| DELETE | `/v1/csm/{name}` | JWT, owner | 0.2 |
| POST | `/v1/consent` | JWT | 0.3 |
| GET | `/v1/consent` | JWT | 0.3 |
| GET | `/v1/consent/{id}` | JWT | 0.3 |
| DELETE | `/v1/consent/{id}` | JWT | 0.3 |
| GET | `/v1/consent/audit` | JWT | 0.3 |
| POST | `/v1/ghii/totp/setup` | JWT | 0.5 |
| POST | `/v1/ghii/totp/verify` | JWT | 0.5 |
| DELETE | `/v1/ghii/totp` | JWT | 0.5 |
| POST | `/v1/ghii/totp/backup-codes` | JWT | 0.5 |

---

## Riskien hallinta

| Riski | Vaikutus | Ehkäisy |
|---|---|---|
| Schema validation hidastaa memory-kirjoituksia | Suorituskyky | AJV compile cache; benchmark ennen/jälkeen |
| CSM-formaatti muuttuu paljon Phase 1-2:ssa | Uudelleenkirjoitus | CSM v1.0 pidetään yksinkertaisena; versiointi mahdollistaa muutokset |
| Consent-tarkistus jokaiseen readiin = overhead | Suorituskyky | In-memory consent cache; batch-audit writes |
| TOTP-secretien salaus ilman encryption keyä (dev) | Turvallisuus | Varoitus logiin jos encryption key puuttuu; ei salli tuotantokäyttöä ilman |
| Schema route ordering Express 5:ssä | Bugi | Testaa erikseen; schema routes ENNEN memory routes |
| Glob-pattern matching consent:ssa on hidas isolle datamäärälle | Suorituskyky | Indeksointi Phase 1:ssä; Phase 0 riittää pienelle datamäärälle |
| Semantic-kentän @context URI:t eivät ratkea (offline) | Toiminnallisuus | AIMEAT ei vaadi URI-resoluutiota; prefiksit riittävät |
| Ontologiaterminologian väärin käyttö | Laatu | Schema.org + QUDT ovat vakiintuneita; esimerkit dokumentoitu |
| Yksikkötestien ylläpitokuorma | Prosessi | Vain puhtaat funktiot testataan; E2E kattaa integraation |
| openapi.yaml divergoi implementaatiosta | Dokumentaatio | Contract-first: openapi päivitetään ennen koodia |

---

## Definition of Done — Phase 0

### Koodin laatu
- [ ] `npx tsc --noEmit` compileaa ilman virheitä
- [ ] `pnpm test` (vitest yksikkötestit) passaa — ~80 testiä
- [ ] `npx tsx test/e2e-full.ts` passaa — 127 testiä (35 nykyistä + 76 uutta + 16 retrofit)

### E2E-testit per komponentti
- [ ] Kaikki 18 schema locking -testiä (0.1) passaavat
- [ ] Kaikki 8 CSM-testiä (0.2) passaavat
- [ ] Kaikki 17 consent-testiä (0.3) passaavat
- [ ] Kaikki 8 profiilit-testiä (0.4) passaavat
- [ ] Kaikki 18 TOTP-testiä (0.5) passaavat
- [ ] Kaikki 3 DMZ-testiä (0.6) passaavat
- [ ] Kaikki 4 semantic-testiä (0.7) passaavat
- [ ] Kaikki 16 semantic retrofit -testiä (0.7b) passaavat
- [ ] Olemassaoleva E2E-testisarja (35 testiä) passaa edelleen (regressio)

### Yksikkötestit
- [ ] `test/unit/schema-validator.test.ts` — 12 testiä
- [ ] `test/unit/wildcard-pattern.test.ts` — 10 testiä
- [ ] `test/unit/csm-parser.test.ts` — 15 testiä
- [ ] `test/unit/consent-matching.test.ts` — 12 testiä
- [ ] `test/unit/totp-service.test.ts` — 10 testiä
- [ ] `test/unit/profile-schemas.test.ts` — 8 testiä
- [ ] `test/unit/semantic-validation.test.ts` — 5 testiä
- [ ] `test/unit/semantic-annotation.test.ts` — 8 testiä (0.7b)

### Dokumentaatio
- [ ] Dokumentaatiot luotu: CSM spec, interest profile spec, DMZ architecture
- [ ] CSM-esimerkit luotu (7 kpl)
- [ ] Data Description Convention v1.1 — §3.6 Semantic lisätty
- [ ] `openapi.yaml` päivitetty uusilla endpointeilla (17 kpl)
- [ ] Uudet ympäristömuuttujat dokumentoitu `.env.example`-tiedostoon
- [ ] RFC-dokumentit päivitetty viittauksilla (01-core ... 09-community)
- [ ] `README.md` päivitetty
- [ ] `CLAUDE.md` päivitetty
- [ ] Masterplan-status päivitetty

---

## Seuraava vaihe: Phase 1

Phase 0 valmistuttua siirrytään Phase 1:een — ensimmäinen kokonainen end-to-end -palvelu (vertical slice).

→ **[Phase 1: "Ensimmäinen yhteisö" — Kattava implementointisuunnitelma](./phase-1-first-community.md)**

Phase 1 rakentaa: Email-järjestelmän (1.1), Web-wizardin (1.2), GHII-rekisteröinnin + tietolompakon (1.3), Hakemistot (1.4), Tiedon laatusuodatuksen (1.5), ja yhdistää kaiken Harrastehakemisto-vertikaalisliceksi (1.6).

---

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
