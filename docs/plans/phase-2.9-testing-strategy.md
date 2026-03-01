# Phase 2.9: Testausstrategia — Implementointisuunnitelma

*Osa Phase 2 "Markkinapaikka + yhteisötyökalut" -kokonaisuutta. Ks. [Phase 2 yleiskatsaus](./phase-2-marketplace-community.md)*

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

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
