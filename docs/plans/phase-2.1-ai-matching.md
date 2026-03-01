# Phase 2.1: AI-matchaus-agentti — Implementointisuunnitelma

*Osa Phase 2 "Markkinapaikka + yhteisötyökalut" -kokonaisuutta. Ks. [Phase 2 yleiskatsaus](./phase-2-marketplace-community.md)*

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
          "ghii": "liisa29@meat-finland-001",
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

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
