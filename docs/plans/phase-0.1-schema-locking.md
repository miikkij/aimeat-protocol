# Phase 0.1: JSON Schema Locking — Implementointisuunnitelma

*Osa Phase 0 Foundation -kokonaisuutta. Ks. [Phase 0 yleiskatsaus](./2026-03-01-phase-0-foundation.md)*

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

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
