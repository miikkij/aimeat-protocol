# Phase 2: "Markkinapaikka + yhteisötyökalut" — Kattava implementointisuunnitelma

*2026-03-01 — Yksityiskohtainen toteutussuunnitelma Phase 2 -komponenteille*

---

## Yleiskatsaus

Phase 2 rakentaa toisen vertical slicen — **markkinapaikan** — sekä yhteisötyökaluinfrastruktuurin: organismit, yhteistyötilat, edistyneen moderoinnin ja AI-matchauksen. Tässä phasessa AIMEAT siirtyy yksittäisistä profiileista ja hakemistoista kohti **aktiivisia yhteisöjä** jotka tekevät kauppaa, organisoituvat ja tekevät yhteistyötä.

**Prerekvisiitit:** Phase 0 (0.1–0.9) ja Phase 1 (1.1–1.9) ovat toteutettu.

**Komponentit:**

| # | Komponentti | Riippuvuudet | Arvioitu laajuus |
|---|---|---|---|
| 2.1 | AI-matchaus-agentti | Phase 1.4 (hakemistot), 0.4 (profiilit), 1.1 (email) | Keskisuuri |
| 2.2 | Organismi/ryhmä-entiteetti | Phase 0.3 (consent), 1.4 (hakemistot) | Suuri |
| 2.3 | Collaborative workspaces | 2.2 (organismit), Phase 0.3 (consent) | Keskisuuri |
| 2.4 | Laatusuodatus — advanced | Phase 1.5 (flaggaus-pohja), 2.2 (organismit) | Keskisuuri |
| 2.5 | CSM-templatekirjasto | Phase 0.2 (CSM) | Keskisuuri |
| 2.6 | Vertical Slice: Markkinapaikka | 2.1–2.5, Phase 0.1–0.4, Phase 1.4–1.5 | Suuri |
| 2.7 | Semanttinen ontologia (Phase 2 -rakenteet) | Phase 0.7 (ontologia) | Pieni |
| 2.8 | Dokumentaation ylläpito (Phase 2) | Kaikki | Dokumentaatio |
| 2.9 | Testausstrategia (Phase 2) | Kaikki | Keskisuuri |

**Suositeltu toteutusjärjestys:**

```
2.1 AI-matchaus ────────────────────────────────────────────────────┐
                                                                    │
2.2 Organismit ─────────┐                                          │
                        ├──→ 2.3 Workspaces                       │
2.4 Advanced moderointi ┘                                          ├──→ 2.6 Markkinapaikka
                                                                    │
2.5 CSM-templatekirjasto ──────────────────────────────────────────┘

2.7 Semanttinen ontologia ──→ (läpileikkaava)
2.8 Dokumentaation ylläpito ──→ (läpileikkaava)
2.9 Testausstrategia ─────────→ (läpileikkaava)
```

Komponentit 2.1, 2.2, 2.4 ja 2.5 voidaan toteuttaa rinnakkain. Komponentti 2.3 riippuu 2.2:sta (organismit tarvitaan ennen workspaceja). Komponentti 2.6 yhdistää kaikki edellä olevat.

### Alidokumentit

| Komponentti | Tiedosto |
|---|---|
| 2.1 AI-matchaus-agentti | [phase-2.1-ai-matching.md](./phase-2.1-ai-matching.md) |
| 2.2 Organismi/ryhmä-entiteetti | [phase-2.2-organisms.md](./phase-2.2-organisms.md) |
| 2.3 Collaborative workspaces | [phase-2.3-workspaces.md](./phase-2.3-workspaces.md) |
| 2.4 Laatusuodatus — advanced | [phase-2.4-advanced-moderation.md](./phase-2.4-advanced-moderation.md) |
| 2.5 CSM-templatekirjasto | [phase-2.5-csm-templates.md](./phase-2.5-csm-templates.md) |
| 2.6 Markkinapaikka (vertical slice) | [phase-2.6-marketplace.md](./phase-2.6-marketplace.md) |
| 2.7 Semanttinen ontologia (Phase 2) | [phase-2.7-semantic-ontology.md](./phase-2.7-semantic-ontology.md) |
| 2.8 Dokumentaation ylläpito | [phase-2.8-documentation-plan.md](./phase-2.8-documentation-plan.md) |
| 2.9 Testausstrategia | [phase-2.9-testing-strategy.md](./phase-2.9-testing-strategy.md) |

---

## 2.1 AI-matchaus-agentti

> Lähde: masterplan (§2.1), `docs/nextlevel/aimeat-use-cases.md`

### 2.1.1 Tavoite

Rakentaa automaattinen matchaus-agentti joka lukee federaation profiileja, vertailee kiinnostuksia ja maantieteellistä läheisyyttä, ja lähettää opt-in -suositteluviestejä. Matchaus-agentti on **AIMEAT:n ensimmäinen sisäänrakennettu AI-toimija** — se näyttää miten agentti voi tuottaa arvoa ihmisille automatisoimalla löytämisen.

**Suunnitteluperiaatteet:**
- **Opt-in only:** Matchaus-viestejä saa vain jos käyttäjällä on aktiivinen consent `purpose: "matching"`
- **Transparenssi:** Matchaus-pisteytyksen komponentit näytetään käyttäjälle
- **Operaattori-ohjattu:** Operaattori voi disabloida, säätää ajoväliä, rajata maksimiviestimäärää

### 2.1.2 Matchaus-algoritmi

**Pisteytyskaava:**

```
match_score = (shared_interests_weight × shared_interests_score)
            + (distance_weight × distance_score)
            + (activity_weight × activity_score)
            + (compatibility_weight × compatibility_score)
```

**Painot (oletukset, konfiguroitavissa):**

| Komponentti | Paino | Laskentakaava |
|---|---|---|
| `shared_interests_score` | 0.40 | `min(shared_count / 3, 1.0)` — 3+ yhteistä = täydet pisteet |
| `distance_score` | 0.25 | `max(1.0 - (distance_km / max_distance_km), 0)` — lähellä = parempi |
| `activity_score` | 0.20 | `max(1.0 - (days_since_last_activity / 90), 0)` — aktiiviset parempia |
| `compatibility_score` | 0.15 | `seeking_match_ratio` — kuinka hyvin seeking-kentät vastaavat toisen profiilia |

**Kynnysarvo:** `match_score >= 0.5` → ehdotetaan (konfiguroitava: `AIMEAT_MATCH_THRESHOLD`)

### 2.1.3 Konfiguraatio

```env
# ── AI Matching ──────────────────────────────────────────────
# AIMEAT_MATCHING_ENABLED=true
# AIMEAT_MATCH_INTERVAL_HOURS=24         # Kuinka usein matchaus ajetaan
# AIMEAT_MATCH_THRESHOLD=0.5             # Minimi match-score (0.0–1.0)
# AIMEAT_MATCH_MAX_SUGGESTIONS=5         # Max ehdotuksia per käyttäjä per ajo
# AIMEAT_MATCH_MAX_DISTANCE_KM=100       # Max etäisyys matchauksessa
# AIMEAT_MATCH_COOLDOWN_DAYS=7           # Sama pari ehdotetaan uudelleen aikaisintaan tämän jälkeen
```

**MeatConfig-laajennukset:**

```typescript
export interface MeatConfig {
  // ... nykyiset kentät ...

  // AI Matching (Phase 2.1)
  matchingEnabled: boolean;
  matchIntervalHours: number;
  matchThreshold: number;
  matchMaxSuggestions: number;
  matchMaxDistanceKm: number;
  matchCooldownDays: number;
}
```

### 2.1.4 Storage-muutokset

#### Uusi record-tyyppi: MatchRecord

**Tiedosto:** `src/storage/interface.ts`

```typescript
export interface MatchRecord {
  id: string;                       // UUID
  profileA: string;                 // GHII tai owner (ehdotuksen saaja)
  profileB: string;                 // GHII tai owner (ehdotettu)
  score: number;                    // 0.0–1.0
  breakdown: {
    sharedInterests: string[];
    distanceKm: number | null;
    activityDays: number;
    sharedInterestsScore: number;
    distanceScore: number;
    activityScore: number;
    compatibilityScore: number;
  };
  status: 'suggested' | 'notified' | 'accepted' | 'dismissed' | 'expired';
  notifiedAt: string | null;
  respondedAt: string | null;
  expiresAt: string;                // 30 päivää
  createdAt: string;
}
```

#### Uudet Storage-metodit

```typescript
export interface Storage {
  // ... nykyiset metodit ...

  // Matching (Phase 2.1)
  createMatch(record: MatchRecord): Promise<MatchRecord>;
  getMatch(id: string): Promise<MatchRecord | null>;
  getMatchByPair(profileA: string, profileB: string): Promise<MatchRecord | null>;
  listMatchesByProfile(profile: string, opts?: { status?: string; page?: number; perPage?: number }): Promise<MatchRecord[]>;
  updateMatch(id: string, updates: Partial<MatchRecord>): Promise<MatchRecord | null>;
  deleteExpiredMatches(): Promise<number>;
}
```

### 2.1.5 Uusi service: Matching Engine

**Tiedosto:** `src/services/matching.ts`

```typescript
export interface MatchingEngine {
  // Aja matchaus-kierros (kutsutaan schedulerista)
  runMatchingRound(): Promise<MatchingRoundResult>;

  // Yksittäinen matchaus-laskenta
  calculateMatchScore(profileA: ProfileData, profileB: ProfileData): MatchScore;

  // Hae ehdotukset tietylle profiilille
  getSuggestionsForProfile(ownerName: string): Promise<MatchRecord[]>;
}

export interface MatchingRoundResult {
  profilesScanned: number;
  matchesFound: number;
  notificationsSent: number;
  duration_ms: number;
}

export interface ProfileData {
  ownerName: string;
  ghii: string;
  interests: string[];
  location?: { city?: string; geo?: [number, number] };
  seeking?: string[];
  lastActivityAt: string;
}

export function createMatchingEngine(
  config: MeatConfig,
  storage: Storage,
  directoryService: DirectoryService,
  emailService: EmailService
): MatchingEngine;
```

**Matchaus-kierroksen logiikka:**

1. Hae kaikki profiilit joilla on consent `purpose: "matching"` ja `status: "active"`
2. Jokaiselle profiilille A:
   a. Hae potentiaaliset matchit hakemistoindeksistä (samat kiinnostukset TAI lähellä)
   b. Suodata pois jo ehdotetut (cooldown-aika)
   c. Laske `match_score` jokaiselle parille
   d. Ota top N (config.matchMaxSuggestions)
   e. Luo MatchRecord (status: "suggested")
3. Lähetä ilmoitukset: email (Phase 1.1) + mailbox (personal node)
4. Päivitä status → "notified"

### 2.1.6 Uudet endpointit

#### GET /v1/matches

| Kenttä | Arvo |
|---|---|
| **Metodi** | GET |
| **Polku** | `/v1/matches` |
| **Auth** | Vaatii JWT (requireAuth) |
| **Query** | `?status=suggested&page=1&per_page=10` |

**Response 200:**
```json
{
  "ok": true,
  "data": {
    "matches": [
      {
        "id": "match-uuid",
        "matchedProfile": {
          "ghii": "liisa29@aimeat-finland-001",
          "displayName": "Liisa",
          "sharedInterests": ["lintubongaus", "luontokuvaus"],
          "distanceKm": 3.2,
          "city": "Espoo"
        },
        "score": 0.78,
        "breakdown": {
          "sharedInterestsScore": 0.67,
          "distanceScore": 0.97,
          "activityScore": 0.90,
          "compatibilityScore": 0.45
        },
        "status": "suggested",
        "createdAt": "2026-03-15T10:00:00Z"
      }
    ],
    "total": 3,
    "page": 1
  }
}
```

#### POST /v1/matches/:id/respond

| Kenttä | Arvo |
|---|---|
| **Metodi** | POST |
| **Polku** | `/v1/matches/:id/respond` |
| **Auth** | Vaatii JWT |
| **Content-Type** | application/json |

**Request body:**
```json
{
  "action": "accept"
}
```

**action-vaihtoehdot:** `accept`, `dismiss`

**Kun molemmat ovat accepted:** → Ilmoita molemmille, luo board-linkki tai yhteystiedot (consent-ohjattu).

#### GET /v1/matches/stats (operaattori)

| Kenttä | Arvo |
|---|---|
| **Metodi** | GET |
| **Polku** | `/v1/matches/stats` |
| **Auth** | Vaatii JWT + operator-rooli |

**Response 200:**
```json
{
  "ok": true,
  "data": {
    "lastRoundAt": "2026-03-15T02:00:00Z",
    "lastRoundDurationMs": 1250,
    "profilesScanned": 142,
    "totalMatchesCreated": 23,
    "totalNotificationsSent": 18,
    "matchesByStatus": { "suggested": 12, "notified": 6, "accepted": 3, "dismissed": 2 }
  }
}
```

### 2.1.7 Background-scheduler

**Tiedosto:** `src/services/scheduler.ts`

```typescript
export function startMatchingScheduler(
  config: MeatConfig,
  matchingEngine: MatchingEngine
): NodeJS.Timeout | null {
  if (!config.matchingEnabled) {
    logger.info('AI matching disabled');
    return null;
  }

  const intervalMs = config.matchIntervalHours * 3600 * 1000;
  return setInterval(async () => {
    try {
      const result = await matchingEngine.runMatchingRound();
      logger.info(`Matching round: ${result.matchesFound} matches, ${result.notificationsSent} notifications`);
    } catch (err) {
      logger.error('Matching round failed', err);
    }
  }, intervalMs);
}
```

### 2.1.8 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | Match score: 3 yhteistä kiinnostusta, 2 km | Score > 0.7 |
| 2 | Match score: 0 yhteistä kiinnostusta | Score < 0.3 |
| 3 | Match score: etäisyys > max_distance_km | distance_score = 0 |
| 4 | Matchaus-kierros: 2 profiilia, 1 match | 1 MatchRecord luotu |
| 5 | Matchaus-kierros: profiili ilman consent | Ei matcheja kyseiselle profiilille |
| 6 | Cooldown: sama pari 3 päivää sitten | Ei uutta ehdotusta |
| 7 | GET /v1/matches: omat ehdotukset | 200, match-lista |
| 8 | POST /v1/matches/:id/respond accept | Status → accepted |
| 9 | POST /v1/matches/:id/respond dismiss | Status → dismissed |
| 10 | Molemminpuolinen accept | Ilmoitus molemmille |
| 11 | Matching disabled | Scheduler ei käynnisty |
| 12 | Vanhentunut match | Automaattinen cleanup |
| 13 | GET /v1/matches/stats (operaattori) | 200, tilastot |

### 2.1.9 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `src/services/matching.ts` — MatchingEngine |
| **Uusi** | `src/services/scheduler.ts` — Background-scheduler |
| **Uusi** | `src/routes/matches.ts` — Match-endpointit |
| **Muokataan** | `src/config.ts` — Matching-konfiguraatio |
| **Muokataan** | `src/storage/interface.ts` — MatchRecord + metodit |
| **Muokataan** | `src/storage/memory.ts` — In-memory matching |
| **Muokataan** | `src/server.ts` — matchesRouter mount, scheduler start |
| **Muokataan** | `.env.example` — MATCHING-muuttujat |
| **Muokataan** | `openapi.yaml` — matches-endpointit |

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

## 2.3 Collaborative workspaces

> Lähde: masterplan (§2.3)

### 2.3.1 Tavoite

Rakentaa jaetut työtilat organismeille: yhteinen memory-namespace jossa jäsenet ja AI-agentit voivat lukea, kirjoittaa ja organisoida dataa yhdessä. Workspace on organismin "jaettu muisti" — kuin yhteinen tiedostojärjestelmä johon kaikki jäsenet pääsevät.

### 2.3.2 Arkkitehtuuri

**Memory-namespace:** `organism.{id}.shared.*`

Organismin workspace koostuu:
1. **Shared memory** — `organism.{id}.shared.*` avaimet, jokaisen jäsenen luettavissa/kirjoitettavissa
2. **Organismin metadata** — `organism.{id}.meta.*` (vain adminit kirjoittavat)
3. **Jäsenten workspace-profiilit** — `organism.{id}.member.{owner}.*` (jäsen kirjoittaa, kaikki lukevat)

**Pääsynhallinta:**

| Namespace | Luku | Kirjoitus |
|---|---|---|
| `organism.{id}.shared.*` | Kaikki jäsenet + organismin agentit | Kaikki jäsenet + organismin agentit |
| `organism.{id}.meta.*` | Kaikki jäsenet | Vain adminit |
| `organism.{id}.member.{owner}.*` | Kaikki jäsenet | Vain kyseinen jäsen |

### 2.3.3 Workspace-middleware

**Tiedosto:** `src/middleware/workspace-access.ts`

```typescript
export function requireWorkspaceMembership(storage: Storage): RequestHandler {
  return async (req, res, next) => {
    const key = req.params.key as string;
    const match = key.match(/^organism\.([^.]+)\./);
    if (!match) return next(); // Ei workspace-avain

    const organismId = match[1];
    const ownerName = req.auth?.owner;
    if (!ownerName) return res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Authentication required'));

    const membership = await storage.getMembership(organismId, ownerFromGhii(ownerName));
    if (!membership || membership.status !== 'active') {
      return res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not a member of this organism'));
    }

    // Meta-namespace: vain adminit kirjoittavat
    if (key.startsWith(`organism.${organismId}.meta.`) && req.method !== 'GET') {
      if (membership.role !== 'admin' && membership.role !== 'creator') {
        return res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Admin access required'));
      }
    }

    // Member-namespace: vain oma jäsen kirjoittaa
    const memberMatch = key.match(/^organism\.[^.]+\.member\.([^.]+)\./);
    if (memberMatch && req.method !== 'GET') {
      if (memberMatch[1] !== ownerName) {
        return res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Cannot write to another member workspace'));
      }
    }

    next();
  };
}
```

### 2.3.4 AI-agentit workspacessa

Organismi voi lisätä AI-agentteja (`agentGaiis`-lista). Nämä agentit:
- Voivat lukea workspace-dataa (organism.{id}.shared.*)
- Voivat kirjoittaa workspace-dataa (consent-ohjattu)
- Suorittavat työtä organismin puolesta (work queue)
- Esim. "Lintukerho-botti" joka kerää havaintodataa ja päivittää yhteenvetoja

**Consent-integraatio:**
- Organismin admin myöntää consent: `dataPattern: "organism.{id}.shared.**"`, `recipient: "{agent-gaii}"`, `purpose: "workspace-agent"`
- Agentin pääsy perutaan poistamalla consent

### 2.3.5 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | Jäsen kirjoittaa organism.X.shared.notes | 200, tallennettu |
| 2 | Ei-jäsen kirjoittaa organism.X.shared.notes | 403 |
| 3 | Jäsen lukee organism.X.shared.notes | 200, data palautettu |
| 4 | Jäsen kirjoittaa organism.X.meta.config | 403 (ei admin) |
| 5 | Admin kirjoittaa organism.X.meta.config | 200 |
| 6 | Jäsen kirjoittaa toisen member-namespaceen | 403 |
| 7 | Jäsen kirjoittaa omaan member-namespaceen | 200 |
| 8 | AI-agentti lukee workspacea (consent) | 200 |
| 9 | AI-agentti lukee workspacea (ei consentia) | 403 |
| 10 | Poistettu jäsen ei pääse workspaceen | 403 |

### 2.3.6 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `src/middleware/workspace-access.ts` — Workspace-pääsynhallinta |
| **Muokataan** | `src/routes/memory.ts` — Workspace-middleware integraatio |
| **Muokataan** | `src/routes/organisms.ts` — Agent-lisäys/poisto endpointit |
| **Muokataan** | `openapi.yaml` — Workspace-avainten dokumentointi |

---

## 2.4 Laatusuodatus — advanced

> Lähde: masterplan (§2.4), Phase 1.5 (flaggaus-pohja)

### 2.4.1 Tavoite

Laajentaa Phase 1.5:n perus-flaggausmekanismi täydeksi moderointijärjestelmäksi: appeals-mekanismi, organismikohtaiset moderointiasetukset, auto-hide ja moderaattorityökalut.

### 2.4.2 Appeals-mekanismi

#### Uusi record-tyyppi: AppealRecord

**Tiedosto:** `src/storage/interface.ts`

```typescript
export interface AppealRecord {
  id: string;                       // UUID
  flagId: string;                   // Viittaus FlagRecordiin
  appealedBy: string;               // Sisällön omistajan GAII/GHII
  reason: string;                   // Valituksen perustelu (max 1000 merkkiä)
  status: 'pending' | 'upheld' | 'overturned';  // upheld = flag pysyy, overturned = flag poistettu
  reviewedBy?: string;              // Moderaattori
  reviewNote?: string;              // Moderaattorin perustelu
  createdAt: string;
  reviewedAt?: string;
}
```

#### Uudet endpointit

##### POST /v1/flags/:flagId/appeal

| Kenttä | Arvo |
|---|---|
| **Metodi** | POST |
| **Polku** | `/v1/flags/:flagId/appeal` |
| **Auth** | Vaatii JWT (sisällön omistaja) |

**Request body:**
```json
{
  "reason": "Tämä on asiallinen profiili, flaggaus on perusteeton"
}
```

##### GET /v1/appeals (moderaattori/operaattori)

| Kenttä | Arvo |
|---|---|
| **Metodi** | GET |
| **Polku** | `/v1/appeals` |
| **Auth** | Vaatii JWT + admin/operator |
| **Query** | `?status=pending&organismId=X` |

##### POST /v1/appeals/:id/review

| Kenttä | Arvo |
|---|---|
| **Metodi** | POST |
| **Polku** | `/v1/appeals/:id/review` |
| **Auth** | Vaatii JWT + admin/operator |

**Request body:**
```json
{
  "decision": "overturned",
  "note": "Flag was unwarranted, content is appropriate"
}
```

### 2.4.3 Auto-hide -mekanismi

**Logiikka:**
1. Kun uusi flag lisätään → tarkista kohteen flag-count
2. Jos flag-count ≥ `autoHideThreshold` → piilota sisältö automaattisesti
3. Piilotus = memory-visibility → `private` TAI board post -merkintä `hidden: true`
4. Omistajalle ilmoitus: "Sisältösi on piilotettu. Voit valittaa."
5. Organismikohtainen kynnys: `moderationConfig.autoHideThreshold`

**Konfiguraatio:**

```typescript
// OrganismRecord.moderationConfig
moderationConfig: {
  flagsEnabled: boolean;           // Oletuksena true
  autoHideThreshold: number;       // Oletuksena 5
  appealsEnabled: boolean;         // Phase 2: true
  moderators: string[];            // Organismin moderaattorit (GHII-lista)
}
```

### 2.4.4 Organismikohtainen moderointi

Organismin adminit voivat:
- Käsitellä flageja oman organismin sisällössä
- Säätää auto-hide -kynnystä
- Bännätä jäseniä (`membership.status → "banned"`)
- Palauttaa auto-hidden sisältöä

**Valtuusketju:** Sisällön omistaja < Organismin moderaattori < Organismin admin < Operaattori

### 2.4.5 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | Appeal: sisällön omistaja valittaa | 201, appeal luotu |
| 2 | Appeal: joku muu valittaa | 403 |
| 3 | Appeal review: upheld | Flag pysyy, sisältö piilossa |
| 4 | Appeal review: overturned | Flag poistettu, sisältö palautettu |
| 5 | Auto-hide: 5 flagia → piilotus | Sisältö piilotettu |
| 6 | Auto-hide: 4 flagia → ei piilotusta | Sisältö näkyy |
| 7 | Organismi-admin käsittelee flagin | 200 |
| 8 | Tavallinen jäsen yrittää käsitellä flagin | 403 |
| 9 | Bännätty jäsen ei pääse organismiin | 403 |
| 10 | Organismin auto-hide kynnys 3 (vs oletus 5) | Piilotus 3 flagilla |

### 2.4.6 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `src/routes/appeals.ts` — Appeals-endpointit |
| **Muokataan** | `src/storage/interface.ts` — AppealRecord + metodit |
| **Muokataan** | `src/storage/memory.ts` — In-memory appeals |
| **Muokataan** | `src/routes/flags.ts` — Auto-hide integraatio, appeal linkki |
| **Muokataan** | `src/routes/organisms.ts` — Moderointiasetukset, bännäys |
| **Muokataan** | `openapi.yaml` — Appeals-endpointit |

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

## 2.6 Vertical Slice: Markkinapaikka

> Lähde: masterplan (§2.6)

### 2.6.1 Tavoite

Rakentaa toinen kokonainen end-to-end CSM-palvelu: **markkinapaikka**. Markkinapaikka yhdistää kaikki Phase 2 -komponentit yhdeksi kokonaisuudeksi. Myyjät listaavat tuotteita ja palveluita, ostajat hakevat ja ostavat morselipohjaisesti, organismit toimivat kauppayhteisöinä.

### 2.6.2 Markkinapaikan arkkitehtuuri

```
Myyjä (personal node tai agentti):
  ├── Luo ilmoitus (memory-avain: marketplace.{seller}.listing.{id})
  ├── Schema-validointi (marketplace.csm.yaml)
  ├── Consent: marketplace-purpose, federation-scope
  └── Listing-fee: 2 morseliä

Ostaja (portaali tai agentti):
  ├── Hae ilmoituksia (catalogue/directory)
  ├── Katso tiedot (read listing memory key)
  ├── Osta → morsel-transaktio (escrow → settlement)
  └── Arvioi kauppa (rating)

Federaatio:
  ├── Ilmoitukset synkataan catalogue-sync:llä
  ├── Cross-node kauppa: +1 morsel routing fee
  └── Trust-pisteet vaikuttavat näkyvyyteen
```

### 2.6.3 Uudet endpointit

#### POST /v1/marketplace/listings

| Kenttä | Arvo |
|---|---|
| **Metodi** | POST |
| **Polku** | `/v1/marketplace/listings` |
| **Auth** | Vaatii JWT |
| **Content-Type** | application/json |

**Request body:**
```json
{
  "title": "TypeScript-koodausapua 2h",
  "description": "Kokenut full-stack kehittäjä tarjoaa TypeScript-koodausapua. Express, React, Node.js.",
  "category": "palvelut",
  "price_morsels": 50,
  "condition": "digital",
  "availability": "on_request",
  "location": { "city": "Espoo" },
  "tags": ["typescript", "nodejs", "koodaus"]
}
```

**Logiikka:**
1. Validoi marketplace.csm.yaml -scheman mukaan
2. Veloita listing_fee (2 morseliä)
3. Tallenna memory-avaimeen: `marketplace.{owner}.listing.{uuid}`
4. Luo consent: `scope: federation`, `purpose: marketplace`
5. Ilmoitus näkyy hakemistossa ja cataloguessa

**Response 201:**
```json
{
  "ok": true,
  "data": {
    "listingId": "listing-uuid",
    "memoryKey": "marketplace.jouni.listing.listing-uuid",
    "listingFee": 2,
    "status": "active"
  }
}
```

#### GET /v1/marketplace/listings

| Kenttä | Arvo |
|---|---|
| **Metodi** | GET |
| **Polku** | `/v1/marketplace/listings` |
| **Auth** | Tier 0 (julkinen) |
| **Query** | `?category=palvelut&city=Espoo&min_price=10&max_price=100&sort=price_morsels&page=1` |

#### GET /v1/marketplace/listings/:id

Yksittäinen ilmoitus.

#### POST /v1/marketplace/listings/:id/purchase

| Kenttä | Arvo |
|---|---|
| **Metodi** | POST |
| **Polku** | `/v1/marketplace/listings/:id/purchase` |
| **Auth** | Vaatii JWT |

**Logiikka:**
1. Tarkista ostajan morsel-saldo (hinta + transaction_fee)
2. Luo escrow: siirrä morselit escrowiin
3. Luo WorkRecord (tracking code) ostajan ja myyjän välille
4. Ilmoita myyjälle (email + mailbox)
5. Myyjä toimittaa → escrow release → morselit myyjälle
6. Transaktio-fee palaa operaattorille (burn tai treasury)

**Response 200:**
```json
{
  "ok": true,
  "data": {
    "purchaseId": "work-tracking-code",
    "totalCost": 53,
    "breakdown": { "price": 50, "transactionFee": 3 },
    "status": "pending_delivery",
    "sellerGhii": "liisa29@aimeat-finland-001"
  }
}
```

#### POST /v1/marketplace/purchases/:id/rate

| Kenttä | Arvo |
|---|---|
| **Metodi** | POST |
| **Polku** | `/v1/marketplace/purchases/:id/rate` |
| **Auth** | Vaatii JWT (ostaja) |

**Request body:**
```json
{
  "score": 5,
  "comment": "Erinomaista työtä, suosittelen!"
}
```

**Arvio vaikuttaa myyjän trust-pisteisiin** (Phase 0 trust score system).

### 2.6.4 Portaali-UI

| Sivu | Polku | Kuvaus |
|---|---|---|
| Markkinapaikka | `/v1/portal/human/marketplace` | Selaa ilmoituksia |
| Haku | `/v1/portal/human/marketplace/search` | Hae + suodata |
| Ilmoitus | `/v1/portal/human/marketplace/listing/:id` | Yksittäinen ilmoitus |
| Osta | `/v1/portal/human/marketplace/listing/:id/buy` | Osto-flow |
| Luo ilmoitus | `/v1/portal/human/marketplace/sell` | Uusi ilmoitus -lomake |
| Omat ilmoitukset | `/v1/portal/human/marketplace/my-listings` | Hallinnoi omia |
| Omat ostot | `/v1/portal/human/marketplace/my-purchases` | Ostohistoria + arvioi |

### 2.6.5 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | Luo ilmoitus | 201, listing + consent + listing_fee veloitettu |
| 2 | Luo ilmoitus ilman saldoa | 402, INSUFFICIENT_MORSELS |
| 3 | Hae ilmoituksia (category=palvelut) | 200, suodatettu lista |
| 4 | Osta palvelu | 200, escrow luotu, myyjälle ilmoitus |
| 5 | Osta ilman saldoa | 402, INSUFFICIENT_MORSELS |
| 6 | Myyjä toimittaa → escrow release | Morselit myyjälle |
| 7 | Arvioi kauppa | 200, trust-pisteet päivitetty |
| 8 | Cross-node kauppa | +1 morsel routing fee |
| 9 | Ilmoitus validointivirhe (schema) | 400 |
| 10 | Flagattu ilmoitus piilotetaan (auto-hide) | Ei näy haussa |
| 11 | Hakemistohaku ilmoituksille | Ilmoitukset löytyvät |
| 12 | Portaali: end-to-end osto | Koko polku toimii |

### 2.6.6 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `src/routes/marketplace.ts` — Marketplace-endpointit |
| **Uusi** | `src/services/marketplace.ts` — Marketplace business logic |
| **Uusi** | `src/routes/portal-marketplace.ts` — Marketplace portaali |
| **Muokataan** | `src/services/directory.ts` — Marketplace-ilmoitusten indeksointi |
| **Muokataan** | `src/routes/wallet.ts` — Escrow-tuki marketplace-transaktioille |
| **Muokataan** | `src/services/trust.ts` — Marketplace-arviot trust-pisteisiin |
| **Muokataan** | `src/server.ts` — marketplaceRouter, portal-marketplace mount |
| **Muokataan** | `openapi.yaml` — Marketplace-endpointit |
| **Muokataan** | `src/config.ts` — Marketplace-konfiguraatio |

---

## 2.7 Semanttinen ontologia (Phase 2 -rakenteet)

> Lähde: Phase 0.7

### 2.7.1 Phase 2 -rakenteiden semanttiset annotaatiot

#### OrganismRecord

```json
{
  "semantic": {
    "@context": { "schema": "https://schema.org/" },
    "@type": "schema:Organization",
    "schema:memberOf": "aimeat:Federation",
    "schema:areaServed": {
      "@type": "schema:Place",
      "schema:address": { "@type": "schema:PostalAddress", "schema:addressLocality": "Espoo" }
    }
  }
}
```

#### MatchRecord

```json
{
  "semantic": {
    "@context": { "schema": "https://schema.org/" },
    "@type": "schema:RecommendAction",
    "schema:instrument": "aimeat:MatchingEngine",
    "schema:object": { "@type": "schema:Person" }
  }
}
```

#### Marketplace Listing

```json
{
  "semantic": {
    "@context": { "schema": "https://schema.org/" },
    "@type": "schema:Offer",
    "schema:priceCurrency": "MORSEL",
    "schema:availability": "schema:InStock",
    "schema:seller": { "@type": "schema:Person" }
  }
}
```

### 2.7.2 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | Organism-response sisältää semantic-kentän | schema:Organization |
| 2 | Marketplace listing sisältää semantic | schema:Offer |
| 3 | Match-response sisältää semantic | schema:RecommendAction |

### 2.7.3 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Muokataan** | `src/routes/organisms.ts` — Semantic-annotaatiot |
| **Muokataan** | `src/routes/marketplace.ts` — Semantic-annotaatiot |
| **Muokataan** | `src/routes/matches.ts` — Semantic-annotaatiot |
| **Muokataan** | `openapi.yaml` — Semantic-schemat |

---

## 2.8 Dokumentaation ylläpito (Phase 2)

### 2.8.1 Dokumenttikartta

| Dokumentti | Vaikuttavat komponentit | Muutokset |
|---|---|---|
| `docs/01-core.md` | 2.2 (organismit), 2.3 (workspaces) | Organism-entiteetti, workspace-namespace |
| `docs/03-boards.md` | 2.2 (organismit) | Organism-boardit |
| `docs/04-economy-boards.md` | 2.6 (markkinapaikka) | Marketplace-transaktiot, escrow |
| `docs/05-federation.md` | 2.1 (matchaus), 2.6 (cross-node kauppa) | Cross-node matchaus, marketplace federation |
| `docs/08-human-layer.md` | 2.1 (matchaus), 2.2 (organismit) | AI-matchaus, ryhmät |
| `docs/09-community.md` | 2.4 (moderointi), 2.5 (CSM), 2.6 (markkinapaikka) | Advanced moderation, CSM templates, marketplace |

**Uudet dokumentit:**

| Dokumentti | Komponentti |
|---|---|
| `docs/aimeat-organisms-spec.md` | 2.2 Organismit |
| `docs/csm-examples/marketplace.csm.yaml` | 2.5 + 2.6 |
| `docs/csm-examples/dating-directory.csm.yaml` | 2.5 |
| `docs/csm-examples/news-feed.csm.yaml` | 2.5 |
| `docs/csm-examples/opinion-board.csm.yaml` | 2.5 |
| `docs/csm-examples/auction.csm.yaml` | 2.5 |
| `docs/csm-examples/video-directory.csm.yaml` | 2.5 |

**openapi.yaml:** ~20 uutta endpointia.

### 2.8.2 Definition of Done

- [ ] `openapi.yaml` päivitetty ~20 uudella endpointilla
- [ ] Organism-speksi dokumentoitu
- [ ] CSM-templatekirjasto luotu (6 templateä)
- [ ] RFC-dokumentit päivitetty
- [ ] `.env.example` päivitetty
- [ ] `CLAUDE.md` päivitetty Phase 2 -konventioilla

---

## 2.9 Testausstrategia (Phase 2)

### 2.9.1 E2E-testit

| Testifaasi | Komponentti | Testejä | Riippuvuudet |
|---|---|---|---|
| Phase 17: AI Matching | 2.1 | 8 | Phase 0.4 profiilit, Phase 1.4 hakemistot |
| Phase 18: Organisms | 2.2 | 10 | — |
| Phase 19: Workspaces | 2.3 | 6 | Phase 18 organismit |
| Phase 20: Advanced Moderation | 2.4 | 7 | Phase 14 flaggaus |
| Phase 21: CSM Templates | 2.5 | 4 | Phase 0.2 CSM |
| Phase 22: Marketplace | 2.6 | 8 | Phase 17-21 |
| Phase 23: Semantic (Phase 2) | 2.7 | 3 | — |
| **Yhteensä Phase 2** | | **46** | |

**Kokonaistestimäärä:** Phase 0: ~111 + Phase 1: 45 + Phase 2: 46 = **~202 E2E-testiä**

### 2.9.2 Yksikkötestit (vitest)

| Testitiedosto | Komponentti | Testejä |
|---|---|---|
| `test/unit/matching-engine.test.ts` | 2.1 | ~16 |
| `test/unit/match-score.test.ts` | 2.1 | ~12 |
| `test/unit/organisms.test.ts` | 2.2 | ~14 |
| `test/unit/workspace-access.test.ts` | 2.3 | ~10 |
| `test/unit/appeals.test.ts` | 2.4 | ~8 |
| `test/unit/auto-hide.test.ts` | 2.4 | ~6 |
| `test/unit/marketplace.test.ts` | 2.6 | ~12 |
| `test/unit/marketplace-escrow.test.ts` | 2.6 | ~8 |
| **Yhteensä Phase 2** | | **~86** |

### 2.9.3 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Muokataan** | `test/e2e-full.ts` — 46 uutta E2E-testiä (Phase 17-23) |
| **Uusi** | `test/unit/matching-engine.test.ts` |
| **Uusi** | `test/unit/match-score.test.ts` |
| **Uusi** | `test/unit/organisms.test.ts` |
| **Uusi** | `test/unit/workspace-access.test.ts` |
| **Uusi** | `test/unit/appeals.test.ts` |
| **Uusi** | `test/unit/auto-hide.test.ts` |
| **Uusi** | `test/unit/marketplace.test.ts` |
| **Uusi** | `test/unit/marketplace-escrow.test.ts` |

---

## Riippuvuuskaavio (kokonaiskuva)

```
Phase 0 (valmis):
  0.1 Schema Locking ──→ 0.2 CSM ──→ 0.7 Semantic ──→ 0.7b Retrofit
  0.3 Consent Layer ──→ 0.4 Profiilit
  0.5 OTP/TOTP
  0.6 DMZ

Phase 1 (valmis):
  1.1 Email ──→ 1.3 GHII-rekisteröinti ──→ 1.6 Harrastehakemisto
  1.2 Web-wizard
  1.4 Hakemistot ──→ 1.6
  1.5 Flaggaus ──→ 1.6

Phase 2 (tämä dokumentti):
  2.1 AI-matchaus ──────────────────────────────────────────┐
  2.2 Organismit ──→ 2.3 Workspaces                        ├──→ 2.6 Markkinapaikka
  2.4 Advanced moderointi                                   │
  2.5 CSM-templatekirjasto ────────────────────────────────┘
  2.7 Semantic (Ph2) ──→ (läpileikkaava)
  2.8 Dokumentaatio ──→ (läpileikkaava)
  2.9 Testausstrategia ──→ (läpileikkaava)
```

---

## Yhteenveto

| # | Komponentti | Uudet tiedostot | Muokatut tiedostot | Uudet endpointit | E2E-testit | Yksikkötestit |
|---|---|---|---|---|---|---|
| 2.1 | AI-matchaus-agentti | 3 | 6 | 3 | 8 | ~28 |
| 2.2 | Organismit | 1 | 5 | 7 | 10 | ~14 |
| 2.3 | Workspaces | 1 | 3 | 0 (middleware) | 6 | ~10 |
| 2.4 | Advanced moderointi | 1 | 5 | 3 | 7 | ~14 |
| 2.5 | CSM-templatekirjasto | 6 | 2 | 2 | 4 | 0 |
| 2.6 | Markkinapaikka | 3 | 6 | 5 | 8 | ~20 |
| 2.7 | Semanttinen ontologia | 0 | 4 | 0 | 3 | 0 |
| 2.8 | Dokumentaatio | 7 | ~8 | 0 | 0 | 0 |
| 2.9 | Testausstrategia | 8 | 1 | 0 | 46 | ~86 |
| **Yhteensä** | | **~30** | **~40** | **~20** | **46** | **~86** |

## Definition of Done — Phase 2

### Per komponentti:
- [ ] Kaikki endpointit implementoitu ja vastaavat openapi.yaml-spesifikaatiota
- [ ] Storage-muutokset tehty interface.ts + memory.ts:iin
- [ ] E2E-testit kirjoitettu ja menevät läpi
- [ ] Yksikkötestit kirjoitettu ja menevät läpi
- [ ] `npx tsc --noEmit` menee läpi

### Phase 2 kokonaisuutena:
- [ ] AI-matchaus: matchaus-kierros löytää relevantit parit, ilmoittaa, cooldown toimii
- [ ] Organismit: luonti, liittyminen (open/approval/invite), boardit, hakemisto-integraatio
- [ ] Workspaces: jaettu memory-namespace, rooli-pohjainen pääsynhallinta
- [ ] Moderointi: appeals, auto-hide, organismi-admin moderointityökalut
- [ ] CSM-templates: 6 templateä, jokainen validoituu parserin läpi
- [ ] Markkinapaikka: ilmoitukset, haku, osto (escrow→settlement), arviot, trust
- [ ] 202+ E2E-testiä (Phase 0 + Phase 1 + Phase 2)
- [ ] ~86 yksikkötestiä Phase 2:lle
- [ ] Semantic-annotaatiot organism, match, marketplace -entiteeteissä

---

## Seuraava vaihe: Phase 3

Phase 2 valmistuttua siirrytään [Phase 3: "Polish + tulevaisuus"](./phase-3-polish-future.md) — viimeistely, standardit ja skaalaus.

Phase 3 rakentaa: PWA-mobiilisovelluksen (3.1), Graafisen personal node -asennusohjelman (3.2), EUDIW/MyData/W3C VC -integraatiot (3.3) ja Advanced federation (3.4). Yksityiskohtaiset suunnitelmat löytyvät alidokumenteista [phase-3.1](./phase-3.1-pwa.md)–[phase-3.7](./phase-3.7-testing-strategy.md).

---

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
