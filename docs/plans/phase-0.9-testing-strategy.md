# Phase 0.9: Testausstrategia — Implementointisuunnitelma

*Osa Phase 0 Foundation -kokonaisuutta. Ks. [Phase 0 yleiskatsaus](./2026-03-01-phase-0-foundation.md)*

---

### 0.9.1 Tavoite

Määritellä kattava testausstrategia Phase 0:lle joka varmistaa: (1) jokainen komponentti toimii itsenäisesti, (2) komponentit toimivat yhdessä, (3) olemassaolevat ominaisuudet eivät rikkoudu.

### 0.9.2 Testaustasot

```
┌─────────────────────────────────────────────────────────┐
│                    E2E-testit (integraatio)              │
│     Koko järjestelmä, HTTP-kutsut, live server           │
│     Tiedosto: test/e2e-full.ts                           │
├─────────────────────────────────────────────────────────┤
│                    Yksikkötestit (unit)                   │
│     Yksittäiset funktiot, ei serveriä                     │
│     Tiedostot: test/unit/*.test.ts                        │
├─────────────────────────────────────────────────────────┤
│                    TypeScript-tyyppitarkistus             │
│     npx tsc --noEmit                                     │
│     Varmistaa tyyppiturvallisuuden                        │
└─────────────────────────────────────────────────────────┘
```

### 0.9.3 E2E-testit (nykyinen `test/e2e-full.ts`)

Nykyinen E2E-testisarja (35 testiä, 6 faasia + GDPR) laajennetaan Phase 0 -testifaaseilla:

| Testifaasi | Komponentti | Testejä | Riippuvuudet |
|---|---|---|---|
| Phase 7: Schema Locking | 0.1 | 18 | — |
| Phase 8: CSM | 0.2 | 8 | Phase 7 (schema locking) |
| Phase 9: Consent | 0.3 | 17 | — |
| Phase 10: Interest Profiles | 0.4 | 8 | Phase 7 + 9 |
| Phase 11: TOTP | 0.5 | 18 | — |
| Phase 12: DMZ | 0.6 | 3 | Phase 9 |
| Phase 13: Semantic | 0.7 | 4 | Phase 7 |

**Yhteensä:** 35 (nykyiset) + 76 (uudet) = **111 E2E-testiä**

**E2E-testiympäristö:**
```bash
# Käynnistä testiserveri (port 40251)
cd aimeat
AIMEAT_PORT=40251 AIMEAT_DEV_MODE=true pnpm dev

# Aja testit (toisessa terminaalissa)
npx tsx test/e2e-full.ts
```

### 0.9.4 Yksikkötestit (uusi)

Phase 0 tuo mukanaan tarpeeksi puhdasta liiketoimintalogiikkaa (schema validation, CSM parsing, consent matching, TOTP, pattern matching) jotta yksikkötestit ovat perusteltuja.

**Testiframework:** `vitest` (nopea, TypeScript-natiivi, ESM-tuki)

```bash
cd aimeat
pnpm add -D vitest
```

**`aimeat/vitest.config.ts`:**
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    globals: true,
  },
});
```

**`aimeat/package.json` scripts:**
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "tsx test/e2e-full.ts",
    "test:all": "vitest run && tsx test/e2e-full.ts"
  }
}
```

#### Yksikkötestien suunnitelma

| Testitiedosto | Testaa | Testejä (arvio) |
|---|---|---|
| `test/unit/schema-validator.test.ts` | AJV-validointi, cache, schema mode | 12 |
| `test/unit/wildcard-pattern.test.ts` | `matchWildcardPattern()` | 10 |
| `test/unit/csm-parser.test.ts` | YAML-parsinta, validointi, JSON Schema -generointi | 15 |
| `test/unit/consent-matching.test.ts` | `matchPattern()`, consent logic, expiration | 12 |
| `test/unit/totp-service.test.ts` | TOTP setup, validation, backup codes, encryption | 10 |
| `test/unit/profile-schemas.test.ts` | Profiilit-schemojen validointi | 8 |
| `test/unit/semantic-validation.test.ts` | Semantic-kenttien parsinta ja säilyvyys | 5 |

**Yhteensä:** ~72 yksikkötestiä

#### Esimerkkiyksikkötesti

```typescript
// test/unit/wildcard-pattern.test.ts
import { describe, it, expect } from 'vitest';
import { matchWildcardPattern } from '../../src/storage/memory.js';

describe('matchWildcardPattern', () => {
  it('exact match', () => {
    expect(matchWildcardPattern('profile.alice.interests', 'profile.alice.interests')).toBe(true);
  });

  it('single wildcard *', () => {
    expect(matchWildcardPattern('profile.*.interests', 'profile.alice.interests')).toBe(true);
    expect(matchWildcardPattern('profile.*.interests', 'profile.bob.interests')).toBe(true);
  });

  it('* does not match multiple segments', () => {
    expect(matchWildcardPattern('profile.*.interests', 'profile.alice.deep.interests')).toBe(false);
  });

  it('double wildcard **', () => {
    expect(matchWildcardPattern('iot.**', 'iot.temperature.living-room')).toBe(true);
    expect(matchWildcardPattern('iot.**', 'iot.humidity')).toBe(true);
  });

  it('no match', () => {
    expect(matchWildcardPattern('profile.*.interests', 'iot.temperature')).toBe(false);
  });
});
```

### 0.9.5 TypeScript-tyyppitarkistus

```bash
# Ajetaan aina ennen commitia
cd aimeat
npx tsc --noEmit
```

Tämä on jo käytäntö — Phase 0 ei muuta sitä. Varmistettava:
- Uudet record-tyypit (`SchemaRecord`, `ConsentRecord`, etc.) compileaavat
- Storage-interfacen uudet metodit on implementoitu kaikissa toteutuksissa
- Uudet route-handlerit noudattavat Express 5 -tyyppejä

### 0.9.6 Regressiotestaus

**Periaate:** Olemassaoleva E2E-sarja (35 testiä) ajetaan AINA Phase 0 -testien lisäksi. Jos jokin nykyinen testi rikkoutuu Phase 0 -muutosten takia, se korjataan välittömästi.

**Regressioriski-analyysi:**

| Muutos | Regressioriski | Mitigaatio |
|---|---|---|
| Schema validation memory-kirjoituksissa | Korkea — voi rikkoa nykyisiä testejä jos schema on asetettu | Schemat asetetaan vasta Phase 0 -testifaaseissa, ei kosketa nykyisiä testejä |
| Consent check memory-lukuihin | Keskitaso — voi estää lukuja jos consent vaaditaan | Consent-tarkistus aktivoidaan vain `owner`-visibility-avaimille, ei `public/private` |
| TOTP-kentät GHIIRecordissa | Matala — uudet optional-kentät, oletusarvo false | Ei vaikuta nykyiseen login-flowiin |
| `zone`-kenttä memory-vastauksissa | Matala — uusi kenttä, ei muuta nykyisiä | Nykyiset testit eivät tarkista `zone`-kentän puuttumista |

### 0.9.7 CI/CD-integraatio (suositus)

Phase 0:n jälkeen suositellaan seuraavaa CI-putkea:

```yaml
# .github/workflows/test.yml (esimerkki)
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
      - run: cd aimeat && pnpm install
      - run: cd aimeat && npx tsc --noEmit        # Tyyppicheck
      - run: cd aimeat && pnpm test                # Yksikkötestit
      - run: |                                      # E2E-testit
          cd aimeat
          AIMEAT_PORT=40251 AIMEAT_DEV_MODE=true node dist/server.js &
          sleep 3
          npx tsx test/e2e-full.ts
```

### 0.9.8 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `aimeat/vitest.config.ts` |
| **Uusi** | `test/unit/schema-validator.test.ts` |
| **Uusi** | `test/unit/wildcard-pattern.test.ts` |
| **Uusi** | `test/unit/csm-parser.test.ts` |
| **Uusi** | `test/unit/consent-matching.test.ts` |
| **Uusi** | `test/unit/totp-service.test.ts` |
| **Uusi** | `test/unit/profile-schemas.test.ts` |
| **Uusi** | `test/unit/semantic-validation.test.ts` |
| **Muokataan** | `aimeat/package.json` — lisää vitest, test scripts |
| **Muokataan** | `test/e2e-full.ts` — lisää Phase 7-13 testifaasit |

---

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
