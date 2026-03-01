# Phase 0.7: Semanttinen ontologia — Implementointisuunnitelma

*Osa Phase 0 Foundation -kokonaisuutta. Ks. [Phase 0 yleiskatsaus](./2026-03-01-phase-0-foundation.md)*

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

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
