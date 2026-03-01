# Phase 0.4: Kiinnostusprofiili-standardi — Implementointisuunnitelma

*Osa Phase 0 Foundation -kokonaisuutta. Ks. [Phase 0 yleiskatsaus](./2026-03-01-phase-0-foundation.md)*

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

**Nimeämispäätös:** Käytetään `{owner}` (owner-nimi, esim. `alice`) eikä GHII:tä (esim. `alice@meat-local-001`). Syyt:
- Owner-nimi on lyhyempi ja selkeämpi avaimissa
- Memory on jo sidottu agentin GAII:hin `ownerGaii`-kentän kautta
- Esimerkki: `profile.alice.interests` (ei `profile.alice@meat-local-001.interests`)

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

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
