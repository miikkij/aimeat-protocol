# Phase 1.4: Hakemistot — Implementointisuunnitelma

*Osa Phase 1 "Ensimmäinen yhteisö" -kokonaisuutta. Ks. [Phase 1 yleiskatsaus](./phase-1-first-community.md)*

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
        "ghii": "erkki62@meat-finland-001-genesis",
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

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
