# Phase 0.2: CSM — Community Service Manifest — Implementointisuunnitelma

*Osa Phase 0 Foundation -kokonaisuutta. Ks. [Phase 0 yleiskatsaus](./2026-03-01-phase-0-foundation.md)*

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
  author: "app#alice@meat-local-001"  # GAII palvelun tekijästä

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

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
