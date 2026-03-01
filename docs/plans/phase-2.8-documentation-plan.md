# Phase 2.8: Dokumentaation ylläpito — Implementointisuunnitelma

*Osa Phase 2 "Markkinapaikka + yhteisötyökalut" -kokonaisuutta. Ks. [Phase 2 yleiskatsaus](./phase-2-marketplace-community.md)*

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

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
