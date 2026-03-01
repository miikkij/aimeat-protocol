# Phase 2.5: CSM-templatekirjasto — Implementointisuunnitelma

*Osa Phase 2 "Markkinapaikka + yhteisötyökalut" -kokonaisuutta. Ks. [Phase 2 yleiskatsaus](./phase-2-marketplace-community.md)*

---

## 2.5 CSM-templatekirjasto

> Lähde: masterplan (§2.5), Phase 0.2 (CSM)

### 2.5.1 Tavoite

Luoda valmiita CSM-pohjia (Community Service Manifest) eri palvelutyypeille. Jokainen template on valmis YAML-tiedosto joka kuvaa palvelutyypin data-scheman, consent-vaatimukset, UI-vihjeet ja moderointiasetukset.

### 2.5.2 Templatekirjasto

6 uutta CSM-pohjaa:

#### marketplace.csm.yaml

```yaml
csm: "1.0"
service:
  name: "Markkinapaikka"
  type: "marketplace"
  description: "Osta ja myy palveluita, tuotteita ja dataa morselipohjaisesti"

schema_mode: "open"

data_schema:
  required:
    title: { type: string, min: 3, max: 200 }
    description: { type: string, min: 10, max: 5000 }
    category: { type: string, enum: ["palvelut", "tuotteet", "data", "osaaminen", "muu"] }
    price_morsels: { type: integer, minimum: 1 }
    seller_ghii: { type: string }
  optional:
    images: { type: array, items: { type: string, format: uri }, maxItems: 5 }
    location: { type: object, properties: { city: string, area: string } }
    condition: { type: string, enum: ["new", "used", "digital"] }
    availability: { type: string, enum: ["immediate", "on_request", "scheduled"] }
    tags: { type: array, items: { type: string }, maxItems: 10 }

consent_requirements:
  visibility_default: "federation"
  requires_consent: true
  consent_purpose: "marketplace"
  data_retention: "until_delisted"

moderation:
  flags_enabled: true
  auto_hide_threshold: 3
  appeals_enabled: true

pricing:
  listing_fee_morsels: 2            # Ilmoituksen julkaisuhinta
  transaction_fee_percent: 5        # Kaupankäyntimaksu
  escrow_enabled: true              # Morselit escrowssa kaupan ajaksi

ui_hints:
  list_view: ["title", "price_morsels", "category", "location.city"]
  detail_view: ["title", "description", "price_morsels", "images", "seller_ghii", "category", "condition"]
  search_fields: ["title", "description", "category", "location.city", "tags"]
  sort_options: ["price_morsels", "createdAt", "flags"]
```

#### dating-directory.csm.yaml

```yaml
csm: "1.0"
service:
  name: "Tutustumishakemisto"
  type: "dating"
  description: "Löydä samanhenkisiä ihmisiä turvallisesti ja anonyyminä"

schema_mode: "strict"                # Tiukka — ei ylimääräisiä kenttiä

data_schema:
  required:
    interests: { type: array, items: { type: string }, minItems: 3 }
    age_range: { type: object, properties: { min: integer, max: integer } }
    seeking: { type: array, items: { type: string } }
  optional:
    bio: { type: string, maxLength: 1000 }
    location: { type: object, properties: { city: string } }
    languages: { type: array, items: { type: string } }
    availability: { type: string }

consent_requirements:
  visibility_default: "dmz"          # Ei suoraan federaatioon — DMZ:ssä
  requires_consent: true
  consent_purpose: "dating-discovery"
  data_retention: "90d"              # Automaattinen poisto 90 päivän jälkeen
  anonymity: true                    # Profiili anonyymi kunnes molemminpuolinen match

moderation:
  flags_enabled: true
  auto_hide_threshold: 2             # Matala kynnys — arkaluonteinen konteksti
  appeals_enabled: true
```

#### news-feed.csm.yaml

```yaml
csm: "1.0"
service:
  name: "Uutissyöte"
  type: "news"
  description: "Yhteisön uutiset ja artikkelit luottamuspisteytyksellä"

schema_mode: "open"

data_schema:
  required:
    title: { type: string, max: 300 }
    body: { type: string, max: 50000 }
    source: { type: string }
    category: { type: string, enum: ["paikallinen", "teknologia", "kulttuuri", "urheilu", "muu"] }
  optional:
    url: { type: string, format: uri }
    author_ghii: { type: string }
    image_url: { type: string, format: uri }
    published_at: { type: string, format: "date-time" }
    tags: { type: array, items: { type: string } }

consent_requirements:
  visibility_default: "federation"
  requires_consent: false
  data_retention: "until_revoked"

moderation:
  flags_enabled: true
  auto_hide_threshold: 5
  appeals_enabled: true

quality:
  freshness_scoring: true            # Tuoreemmat korkeammalla
  source_credibility: true           # Lähteen trust-pisteet vaikuttavat
```

#### opinion-board.csm.yaml

```yaml
csm: "1.0"
service:
  name: "Mielipidepalsta"
  type: "opinion"
  description: "Avoin keskustelualue moderoidulla sisällöllä"

schema_mode: "open"

data_schema:
  required:
    title: { type: string, max: 200 }
    body: { type: string, max: 10000 }
  optional:
    category: { type: string }
    tags: { type: array, items: { type: string } }
    anonymous: { type: boolean, default: false }

consent_requirements:
  visibility_default: "federation"
  requires_consent: false
  data_retention: "until_revoked"

moderation:
  flags_enabled: true
  auto_hide_threshold: 5
  appeals_enabled: true
  anonymous_option: true             # Salli anonyymi postaus
```

#### auction.csm.yaml

```yaml
csm: "1.0"
service:
  name: "Huutokauppa"
  type: "auction"
  description: "Aikarajoitettu huutokauppa morselipohjaisesti"

schema_mode: "strict"

data_schema:
  required:
    title: { type: string, max: 200 }
    description: { type: string, max: 5000 }
    starting_price_morsels: { type: integer, minimum: 1 }
    ends_at: { type: string, format: "date-time" }
    seller_ghii: { type: string }
  optional:
    reserve_price_morsels: { type: integer }
    buy_now_price_morsels: { type: integer }
    images: { type: array, items: { type: string, format: uri }, maxItems: 5 }
    category: { type: string }

consent_requirements:
  visibility_default: "federation"
  requires_consent: true
  consent_purpose: "auction"
  data_retention: "30d"

pricing:
  escrow_enabled: true
  bid_increment_morsels: 1

moderation:
  flags_enabled: true
  auto_hide_threshold: 3
  appeals_enabled: true
```

#### video-directory.csm.yaml

```yaml
csm: "1.0"
service:
  name: "Videohakemisto"
  type: "media"
  description: "Yhteisön videokirjasto kategorioittain ja arviointeineen"

schema_mode: "open"

data_schema:
  required:
    title: { type: string, max: 200 }
    url: { type: string, format: uri }
    category: { type: string }
  optional:
    description: { type: string, max: 2000 }
    thumbnail_url: { type: string, format: uri }
    duration_seconds: { type: integer }
    tags: { type: array, items: { type: string } }
    language: { type: string }

consent_requirements:
  visibility_default: "federation"
  requires_consent: false
  data_retention: "until_revoked"

moderation:
  flags_enabled: true
  auto_hide_threshold: 5
  appeals_enabled: true

quality:
  size_limit_mb: 500
```

### 2.5.3 Template-palvelun endpoint

#### GET /v1/csm/templates

| Kenttä | Arvo |
|---|---|
| **Metodi** | GET |
| **Polku** | `/v1/csm/templates` |
| **Auth** | Tier 0 (julkinen) |

**Response 200:**
```json
{
  "ok": true,
  "data": {
    "templates": [
      { "type": "marketplace", "name": "Markkinapaikka", "description": "...", "schemaMode": "open" },
      { "type": "dating", "name": "Tutustumishakemisto", "description": "...", "schemaMode": "strict" },
      { "type": "news", "name": "Uutissyöte", "description": "...", "schemaMode": "open" },
      { "type": "opinion", "name": "Mielipidepalsta", "description": "...", "schemaMode": "open" },
      { "type": "auction", "name": "Huutokauppa", "description": "...", "schemaMode": "strict" },
      { "type": "media", "name": "Videohakemisto", "description": "...", "schemaMode": "open" }
    ]
  }
}
```

#### GET /v1/csm/templates/:type

Palauttaa yksittäisen templaten YAML-muodossa (Content-Type: application/x-yaml).

### 2.5.4 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | GET /v1/csm/templates | 200, 6 templateä |
| 2 | GET /v1/csm/templates/marketplace | 200, YAML-sisältö |
| 3 | GET /v1/csm/templates/nonexistent | 404 |
| 4 | Jokainen template validoituu CSM-parserin läpi | Ei virheitä |
| 5 | marketplace-schema validoi kelvollisen ilmoituksen | OK |
| 6 | dating-schema hylkää ylimääräiset kentät (strict) | Validointivirhe |

### 2.5.5 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `docs/csm-examples/marketplace.csm.yaml` |
| **Uusi** | `docs/csm-examples/dating-directory.csm.yaml` |
| **Uusi** | `docs/csm-examples/news-feed.csm.yaml` |
| **Uusi** | `docs/csm-examples/opinion-board.csm.yaml` |
| **Uusi** | `docs/csm-examples/auction.csm.yaml` |
| **Uusi** | `docs/csm-examples/video-directory.csm.yaml` |
| **Muokataan** | `src/routes/csm.ts` — Template-endpointit (tai uusi route) |
| **Muokataan** | `openapi.yaml` — CSM template-endpointit |

---

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
