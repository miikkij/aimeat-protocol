# Phase 1.9: Testausstrategia — Implementointisuunnitelma

*Osa Phase 1 "Ensimmäinen yhteisö" -kokonaisuutta. Ks. [Phase 1 yleiskatsaus](./phase-1-first-community.md)*

---

> Lähde: Phase 0.9 (testausstrategia)

### 1.9.1 Tavoite

Laajentaa Phase 0.9:ssä määriteltyä testausjärjestelmää Phase 1 -komponenteille.

### 1.9.2 E2E-testit

Laajennetaan `test/e2e-full.ts` -tiedostoa Phase 1:n testeillä.

| Testifaasi | Komponentti | Testejä | Riippuvuudet |
|---|---|---|---|
| Phase 10: Email System | 1.1 Email | 6 | SMTP mock |
| Phase 11: Web Wizard | 1.2 Wizard | 5 | — |
| Phase 12: GHII Registration + Wallet | 1.3 Rekisteröinti | 10 | Phase 10 |
| Phase 13: Directories | 1.4 Hakemistot | 8 | Phase 0.4 profiilit |
| Phase 14: Data Quality Flags | 1.5 Flaggaus | 7 | — |
| Phase 15: Hobby Directory | 1.6 Harrastehakemisto | 6 | Phase 10-14 |
| Phase 16: Semantic (Phase 1) | 1.7 Ontologia | 3 | — |
| **Yhteensä Phase 1** | | **45** | |

**Kokonaistestimäärä:** Phase 0: ~111 E2E + Phase 1: 45 E2E = **~156 E2E-testiä**

### 1.9.3 Yksikkötestit (vitest)

| Testitiedosto | Komponentti | Testejä |
|---|---|---|
| `test/unit/email-service.test.ts` | 1.1 | ~12 |
| `test/unit/email-templates.test.ts` | 1.1 | ~8 |
| `test/unit/registration.test.ts` | 1.3 | ~10 |
| `test/unit/directory.test.ts` | 1.4 | ~14 |
| `test/unit/haversine.test.ts` | 1.4 | ~6 |
| `test/unit/flags.test.ts` | 1.5 | ~8 |
| `test/unit/match-notification.test.ts` | 1.6 | ~6 |
| **Yhteensä Phase 1** | | **~64** |

### 1.9.4 SMTP-mock E2E-testeissä

```typescript
// test/helpers/smtp-mock.ts

import { createServer } from 'net';

export class SmtpMock {
  private server: ReturnType<typeof createServer>;
  public receivedEmails: { to: string; subject: string; body: string }[] = [];

  async start(port: number): Promise<void>;
  async stop(): Promise<void>;
  getLastEmail(): { to: string; subject: string; body: string } | null;
  clear(): void;
}
```

**Vaihtoehto:** Käytä `nodemailer.createTestAccount()` + Ethereal-emailia E2E-testeissä. Yksinkertaisempi, ei tarvitse omaa SMTP-mockia.

### 1.9.5 Regressiotestaus

| Riski | Kuvaus | Mitigaatio |
|---|---|---|
| Korkea | GHII-rekisteröinti rikkoo olemassaolevan | E2E Phase 2 (identity) ajettava |
| Korkea | Memory-haku max_flags rikkoo olemassaolevan | E2E Phase 3 (memory) ajettava |
| Keskitaso | Catalogue-laajennukset rikkovat olemassaolevan | E2E Phase 1 (bootstrap) ajettava |
| Matala | Wizard-reitti ei häiritse normaalia moodia | server.ts:ssä guard-ehto |

### 1.9.6 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Muokataan** | `test/e2e-full.ts` — 45 uutta E2E-testiä (Phase 10-16) |
| **Uusi** | `test/unit/email-service.test.ts` |
| **Uusi** | `test/unit/email-templates.test.ts` |
| **Uusi** | `test/unit/registration.test.ts` |
| **Uusi** | `test/unit/directory.test.ts` |
| **Uusi** | `test/unit/haversine.test.ts` |
| **Uusi** | `test/unit/flags.test.ts` |
| **Uusi** | `test/unit/match-notification.test.ts` |
| **Uusi** | `test/helpers/smtp-mock.ts` (tai Ethereal-integraatio) |

---

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
