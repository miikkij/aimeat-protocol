# 3.7 Testausstrategia (Phase 3)

*Alidokumentti: [phase-3-polish-future.md](./phase-3-polish-future.md)*

---

### 3.7.1 E2E-testit

| Testifaasi | Komponentti | Testejä | Riippuvuudet |
|---|---|---|---|
| Phase 24: PWA | 3.1 | 6 | Portaali |
| Phase 25: Desktop Installer | 3.2 | 5 | Personal node |
| Phase 26: EUDIW / VC | 3.3 | 7 | GHII |
| Phase 27: Advanced Federation | 3.4 | 8 | Federation |
| Phase 28: Semantic (Phase 3) | 3.5 | 3 | — |
| **Yhteensä Phase 3** | | **29** | |

**Kokonaistestimäärä:** Phase 0: ~111 + Phase 1: 45 + Phase 2: 46 + Phase 3: 29 = **~231 E2E-testiä**

### 3.7.2 Yksikkötestit (vitest)

| Testitiedosto | Komponentti | Testejä |
|---|---|---|
| `test/unit/push-service.test.ts` | 3.1 | ~8 |
| `test/unit/service-worker.test.ts` | 3.1 | ~6 |
| `test/unit/eudiw-verifier.test.ts` | 3.3 | ~12 |
| `test/unit/vc-issuer.test.ts` | 3.3 | ~8 |
| `test/unit/mydata-receipt.test.ts` | 3.3 | ~6 |
| `test/unit/genesis-peering.test.ts` | 3.4 | ~10 |
| `test/unit/organism-reputation.test.ts` | 3.4 | ~8 |
| `test/unit/cross-node-matching.test.ts` | 3.4 | ~10 |
| **Yhteensä Phase 3** | | **~68** |

### 3.7.3 Desktop-testaus

Desktop-sovellus (3.2) testataan erillisellä testausstrategialla:
- **Unit-testit (Rust):** Tauri-backend Rust-testit (`cargo test`)
- **E2E (Tauri):** Tauri:n WebDriver-integraatio
- **Manuaalinen:** Windows/macOS/Linux testaus CI:ssä

### 3.7.4 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Muokataan** | `test/e2e-full.ts` — 29 uutta E2E-testiä (Phase 24-28) |
| **Uusi** | `test/unit/push-service.test.ts` |
| **Uusi** | `test/unit/service-worker.test.ts` |
| **Uusi** | `test/unit/eudiw-verifier.test.ts` |
| **Uusi** | `test/unit/vc-issuer.test.ts` |
| **Uusi** | `test/unit/mydata-receipt.test.ts` |
| **Uusi** | `test/unit/genesis-peering.test.ts` |
| **Uusi** | `test/unit/organism-reputation.test.ts` |
| **Uusi** | `test/unit/cross-node-matching.test.ts` |
| **Uusi** | `aimeat-desktop/src-tauri/tests/` — Rust-testit |

---

← [Phase 3: Polish + tulevaisuus](./phase-3-polish-future.md)
