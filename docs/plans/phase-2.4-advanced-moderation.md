# Phase 2.4: Laatusuodatus — advanced — Implementointisuunnitelma

*Osa Phase 2 "Markkinapaikka + yhteisötyökalut" -kokonaisuutta. Ks. [Phase 2 yleiskatsaus](./phase-2-marketplace-community.md)*

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

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
