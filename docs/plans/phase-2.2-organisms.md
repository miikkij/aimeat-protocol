# Phase 2.2: Organismi/ryhmä-entiteetti — Implementointisuunnitelma

*Osa Phase 2 "Markkinapaikka + yhteisötyökalut" -kokonaisuutta. Ks. [Phase 2 yleiskatsaus](./phase-2-marketplace-community.md)*

---

## 2.2 Organismi/ryhmä-entiteetti

> Lähde: masterplan (§2.2)

### 2.2.1 Tavoite

Rakentaa **organismi** — ryhmäentiteetti joka yhdistää ihmisiä ja agentteja yhteen. Organismi on AIMEAT:n vastine BBS-ajan foorumeille, IRC-kanaville ja yhteisöryhmille. Organismi on solu-metaforan ydin: yksittäiset solut muodostavat organismeja jotka tekevät yhdessä jotain mitä yksittäinen solu ei voi.

### 2.2.2 Storage-muutokset

#### Uusi record-tyyppi: OrganismRecord

**Tiedosto:** `src/storage/interface.ts`

```typescript
export interface OrganismRecord {
  id: string;                       // UUID
  name: string;                     // Esim. "Tapiolan lintukerho"
  description: string;
  type: 'community' | 'team' | 'club' | 'cooperative' | 'project';
  location?: {
    city?: string;
    area?: string;
    country?: string;
    geo?: [number, number];         // [lat, lon]
  };
  interests: string[];              // Organismin kiinnostukset (hakemistoindeksointi)
  creatorGhii: string;              // Perustajan GHII
  admins: string[];                 // Admin-GHIIt
  members: string[];                // Jäsen-GHIIt (sisältää adminit)
  agentGaiis: string[];             // Organismin AI-agentit
  boardId: string;                  // Linkitetty board (luodaan automaattisesti)
  joinPolicy: 'open' | 'approval_required' | 'invite_only';
  maxMembers: number;               // Oletuksena 500
  visibility: 'public' | 'listed' | 'private';  // public = näkyy kaikille, listed = hakemistossa mutta ei avoin, private = vain jäsenille
  moderationConfig: {
    flagsEnabled: boolean;
    autoHideThreshold: number;      // Oletuksena 5
    appealsEnabled: boolean;        // Phase 2.4
  };
  memoryNamespace: string;          // `organism.{id}` — automaattisesti generoitu
  createdAt: string;
  updatedAt: string;
}
```

#### Uusi record-tyyppi: OrganismMembershipRecord

```typescript
export interface OrganismMembershipRecord {
  id: string;                       // UUID
  organismId: string;
  ghii: string;                     // Jäsenen GHII
  role: 'creator' | 'admin' | 'member';
  status: 'active' | 'pending' | 'banned';
  joinedAt: string;
  invitedBy?: string;               // Kuka kutsui (invite_only)
}
```

#### Uusi record-tyyppi: JoinRequestRecord

```typescript
export interface JoinRequestRecord {
  id: string;                       // UUID
  organismId: string;
  ghii: string;                     // Hakija
  message?: string;                 // Hakuviesti (max 500 merkkiä)
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string;              // Admin-GHII joka käsitteli
  createdAt: string;
  reviewedAt?: string;
}
```

#### Uudet Storage-metodit

```typescript
export interface Storage {
  // ... nykyiset metodit ...

  // Organisms (Phase 2.2)
  createOrganism(record: OrganismRecord): Promise<OrganismRecord>;
  getOrganism(id: string): Promise<OrganismRecord | null>;
  listOrganisms(opts?: { type?: string; city?: string; interest?: string; visibility?: string; page?: number; perPage?: number }): Promise<OrganismRecord[]>;
  updateOrganism(id: string, updates: Partial<OrganismRecord>): Promise<OrganismRecord | null>;
  deleteOrganism(id: string): Promise<boolean>;

  // Organism Memberships
  createMembership(record: OrganismMembershipRecord): Promise<OrganismMembershipRecord>;
  getMembership(organismId: string, ghii: string): Promise<OrganismMembershipRecord | null>;
  listMembers(organismId: string, opts?: { role?: string; status?: string }): Promise<OrganismMembershipRecord[]>;
  listMembershipsByGhii(ghii: string): Promise<OrganismMembershipRecord[]>;
  updateMembership(id: string, updates: Partial<OrganismMembershipRecord>): Promise<OrganismMembershipRecord | null>;
  deleteMembership(id: string): Promise<boolean>;

  // Join Requests
  createJoinRequest(record: JoinRequestRecord): Promise<JoinRequestRecord>;
  getJoinRequest(id: string): Promise<JoinRequestRecord | null>;
  listJoinRequests(organismId: string, opts?: { status?: string }): Promise<JoinRequestRecord[]>;
  updateJoinRequest(id: string, updates: Partial<JoinRequestRecord>): Promise<JoinRequestRecord | null>;
}
```

### 2.2.3 Uudet endpointit

#### POST /v1/organisms

| Kenttä | Arvo |
|---|---|
| **Metodi** | POST |
| **Polku** | `/v1/organisms` |
| **Auth** | Vaatii JWT (GHII Level 1+) |
| **Content-Type** | application/json |

**Request body:**
```json
{
  "name": "Tapiolan lintukerho",
  "description": "Tapiolalaisten lintuharrastajien yhteisö. Retket, havainnot, valokuvat.",
  "type": "club",
  "location": { "city": "Espoo", "area": "Tapiola", "country": "FI", "geo": [60.175, 24.805] },
  "interests": ["lintubongaus", "luontokuvaus", "luontoretket"],
  "joinPolicy": "open",
  "visibility": "public"
}
```

**Response 201:**
```json
{
  "ok": true,
  "data": {
    "id": "org-uuid",
    "name": "Tapiolan lintukerho",
    "boardId": "board-uuid",
    "memoryNamespace": "organism.org-uuid",
    "memberCount": 1,
    "joinPolicy": "open"
  },
  "hints": [
    { "description": "Kutsu jäseniä", "method": "POST", "url": "/v1/organisms/org-uuid/invite" },
    { "description": "Näe organismi", "method": "GET", "url": "/v1/organisms/org-uuid" }
  ]
}
```

**Logiikka:**
1. Validoi input (Zod)
2. Tarkista GHII Level ≥ 1
3. Luo OrganismRecord
4. Luo Board automaattisesti (visibility: shared, allowedGaiis: tyhjä aluksi)
5. Luo OrganismMembershipRecord (creator, admin, active)
6. Luo memory-namespace: `organism.{id}.meta` = organismin metatiedot
7. Rekisteröi hakemistoindeksiin (Phase 1.4 DirectoryService)

#### GET /v1/organisms

| Kenttä | Arvo |
|---|---|
| **Metodi** | GET |
| **Polku** | `/v1/organisms` |
| **Auth** | Tier 0 (julkinen) |
| **Query** | `?type=club&city=Espoo&interest=lintubongaus&page=1&per_page=20` |

#### GET /v1/organisms/:id

| Kenttä | Arvo |
|---|---|
| **Metodi** | GET |
| **Polku** | `/v1/organisms/:id` |
| **Auth** | Tier 0 (julkinen profiilit), JWT (täydet tiedot jäsenille) |

#### POST /v1/organisms/:id/join

| Kenttä | Arvo |
|---|---|
| **Metodi** | POST |
| **Polku** | `/v1/organisms/:id/join` |
| **Auth** | Vaatii JWT |

**Logiikka per joinPolicy:**
- `open`: Suora liittyminen → luo membership (active)
- `approval_required`: Luo JoinRequest (pending) → admin hyväksyy/hylkää
- `invite_only`: 403 "Invite required"

#### POST /v1/organisms/:id/leave

| Kenttä | Arvo |
|---|---|
| **Metodi** | POST |
| **Polku** | `/v1/organisms/:id/leave` |
| **Auth** | Vaatii JWT |

**Varoitus:** Jos viimeinen admin poistuu → organismi siirtyy "orphan" -tilaan. Operaattori voi adoptoida tai poistaa.

#### DELETE /v1/organisms/:id

| Kenttä | Arvo |
|---|---|
| **Metodi** | DELETE |
| **Polku** | `/v1/organisms/:id` |
| **Auth** | Vaatii JWT + creator TAI operator |

**Cascade:** Poistaa organismin + kaikki membershpit + workspace memory + board (konfiguroitava).

#### POST /v1/organisms/:id/join-requests/:requestId/review

| Kenttä | Arvo |
|---|---|
| **Metodi** | POST |
| **Polku** | `/v1/organisms/:id/join-requests/:requestId/review` |
| **Auth** | Vaatii JWT + admin-rooli organismissa |

**Request body:**
```json
{
  "decision": "approve"
}
```

### 2.2.4 Integraatio hakemistoon

Phase 1.4 DirectoryService laajennetaan:
- `type: "organisms"` query → hakee OrganismRecordeja
- Organismin kiinnostukset indeksoidaan kuten profiilit
- Organismin sijainti indeksoidaan geo-hakuun
- Facet: `organisms` lisätään hakemiston stats-vastaukseen

### 2.2.5 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | Luo organismi (open) | 201, board luotu automaattisesti |
| 2 | Luo organismi ilman GHII Level 1 | 403 |
| 3 | Liity open-organismiin | 200, membership luotu |
| 4 | Liity approval_required -organismiin | 200, join request luotu (pending) |
| 5 | Liity invite_only -organismiin | 403 |
| 6 | Admin hyväksyy join request | 200, membership luotu |
| 7 | Admin hylkää join request | 200, request rejected |
| 8 | Poistu organismista | 200, membership poistettu |
| 9 | Viimeinen admin poistuu | Organismi orphan-tilaan |
| 10 | Poista organismi (creator) | 200, cascade delete |
| 11 | Poista organismi (ei-creator) | 403 |
| 12 | Hakemistohaku type=organisms | Organismi löytyy |
| 13 | Organismin board luotu oikein | Board visibility: shared |
| 14 | Jäsenlista | 200, jäsenet rooleineen |
| 15 | Duplikaattijäsenyys | 409 |

### 2.2.6 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `src/routes/organisms.ts` — Organism-endpointit |
| **Muokataan** | `src/storage/interface.ts` — OrganismRecord, OrganismMembershipRecord, JoinRequestRecord |
| **Muokataan** | `src/storage/memory.ts` — In-memory organism-toteutus |
| **Muokataan** | `src/services/directory.ts` — Organism-indeksointi |
| **Muokataan** | `src/server.ts` — organismsRouter mount |
| **Muokataan** | `openapi.yaml` — organisms-endpointit |

---

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
