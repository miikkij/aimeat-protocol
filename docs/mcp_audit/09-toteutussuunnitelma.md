# 09 — AIMEAT MCP -parannusten toteutussuunnitelma (7 vaihetta)

**Päivä:** 2026-05-30
**Pohja:** `docs/mcp_audit/08-aimeat-auditointi.md` (löydökset F1–F11)
**Edeltäjä:** `aimeat/docs/plans/2026-05-28-mcp-tool-unification-plan.md` (nimitason pariteetti jo tehty)
**Kohde:** `aimeat/src/mcp/*` (public `/v1/mcp`) + `aimeat/src/cli/connect/mcp/*` (connector stdio)

---

## Selkäranka: yksi katalogi → molemmat pinnat

Kaikki 7 vaihetta nojaavat yhteen arkkitehtuuripäätökseen: **`src/mcp/catalog/definitions.ts` tehdään kanoniseksi totuudeksi** nimelle, kuvaukselle, input-skeemalle, output-skeemalle, `response_format`-tuelle, scopelle ja rajoille. Tänään kuvaukset elävät kolmessa paikassa (server-inline, connector-inline, katalogi) ja vain CLI-fallback lukee katalogia. Ajautuma (F10) syntyy juuri tästä.

Laajennettava tyyppi:

```ts
export interface AimeatToolDefinition {
  name: string;
  description: string;            // F6: "uudelle tiimiläiselle" -taso, when-to-use/when-not
  caller: ToolCallerType;
  visibility: ToolVisibility;
  input: Record<string, ToolInputField>;
  // ── uudet kentät ──
  requiredScope?: string;        // F1: esim. 'memory:write'
  supportsResponseFormat?: boolean; // F5
  listDefaults?: { defaultLimit: number; maxLimit: number }; // F3
  outputSchema?: 'memoryEntry' | 'taskDetail' | ...;         // F4: avain jaettuun zod-rekisteriin
  consolidatedInto?: string;     // F2: migraatioalias
}
```

Lisäksi uusi jaettu moduuli **`src/mcp/catalog/shape.ts`**: `shapeResponse(name, format, data)` + `truncateResult(text, maxTokens)` + `descriptionFor(name)`. Sekä server-handlerit (storage-pohjaiset) että connector-handlerit (REST `resp.data`) importtaavat saman shaperin → tiivistys/leikkaus/output ovat identtiset molemmilla pinnoilla.

> **Sääntö-checklist joka vaiheessa:** Rule 2 (tiedostoheaderit + version-history), Rule 7 (`pnpm lint`), `pnpm typecheck`. Reittimuutokset → Rule 3 (`openapi.yaml` + `pnpm generate:types`). Käyttäjänäkyvä teksti → Rule 4 (en/fi). Vaiheen lopuksi relevantit `test/e2e-mcp-*.ts` SQLitellä; koko suunnitelman lopuksi täysi sweep SQLite + MongoDB (Rule 1).

---

## Vaihe 1 — F6 + F5: kuvaukset + `response_format` katalogiin (molemmat pinnat kerralla)

**Tavoite:** Halvin, suurin vaikutus, ei arkkitehtuurimuutosta. Kirjoita 98 toolin kuvaukset uudelleen ja tarjoa `concise`/`detailed`-tiiviys raskaisiin lukutooleihin — yhdestä paikasta.

**Muutokset:**
1. `catalog/definitions.ts`: kirjoita jokainen `description` "uudelle tiimiläiselle" -tasolle (mitä, **milloin käyttää / milloin ei**, resurssien suhteet, formaattihuomiot). Aseta `supportsResponseFormat: true` lukuraskaille (memory_list/read, task_list/get, catalogue_*, agents_list, wallet_transactions, board_read, work_inbox, knowledge_*).
2. `catalog/shape.ts` (uusi): `descriptionFor(name)` + `shapeResponse(name, format, data)`. `concise` palauttaa ihmisluettavat avainkentät (nimet, ei `*_gaii`/`uuid`/`version`-kohinaa); `detailed` palauttaa täyden objektin.
3. **Server**: refaktoroi `src/mcp/*.ts` rekisteröinnit lukemaan kuvaus `descriptionFor(name)`:sta inline-stringin sijaan; lisää `response_format`-param ja `shapeResponse`-kutsu lukutooleihin.
4. **Connector**: sama `src/cli/connect/mcp/tools/*.ts`:ssä; `shapeResponse` ajetaan `resp.data`:lle.
5. CLI-fallback (`tool-call.ts`) saa rikkaammat kuvaukset ilmaiseksi (lukee jo katalogia).

**Päätös:** Connector ei pysty tiivistämään REST-passthroughia ilman tietoa muodosta → siksi `shape.ts` on **jaettu** ja muotokuvaus elää katalogissa, ei handlerissa.

**Testit:** `test/e2e-mcp-prompts.ts` (kuvausassertiot), `e2e-mcp.ts`, `e2e-mcp-memory-extended.ts`. Lisää testi: `response_format=concise` ≈ ⅓ tokeneista vs `detailed`.

**Valmis kun:** yksikään `mcp.tool(...)`-/`registerTool`-rekisteröinti ei sisällä inline-kuvausstringiä; `audit:mcp-tools` vihreä.

**Todo:**
- [x] Laajenna `AimeatToolDefinition` V1:n tarvitsemilla kentillä (`supportsResponseFormat`, `conciseFields`, `concisePath`) + tiedostoheaderin version-history (Rule 2)
- [x] Luo `src/mcp/catalog/shape.ts`: `descriptionFor()` + `shapeResponse(name, format, data)` + `jsonContent()` + `responseFormatSchema` + header
- [x] Kirjoita toolien `description` uudelleen katalogiin "uudelle tiimiläiselle" -tasolle (core-toolit käsin + 53 muuta rikastettu, handler-pohjaisesti todennettu)
- [x] Server `src/mcp/*.ts` (22 tiedostoa): korvaa inline-kuvaukset `descriptionFor(name)`:lla
- [x] Connector `src/cli/connect/mcp/tools/*.ts` (22 tiedostoa): korvaa inline-kuvaukset `descriptionFor(name)`:lla
- [x] Lisää `response_format`-param + `shapeResponse`-kutsu lukuraskaisiin tooleihin (molemmat pinnat: memory_read/list, catalogue_search, board_read, work_inbox)
- [x] Testi: `response_format=concise` projisoi oikein (9/9 yksikkötestiä `test/unit/mcp-shape.test.ts` — bare-array, wrapped, single-record, empty-guard, no-op)
- [x] `pnpm lint` (0 erroria) + `pnpm typecheck` + `pnpm audit:mcp-tools` (0 driftiä, 0 annotaatioaukkoa) vihreä
- [x] `e2e-mcp` + 11 muuta MCP-suitea SQLitellä vihreät (**230/230**) — **✅ vaihe todennettu** (commit `8b16b2d`)

> Avoin jatkokohta (siirretty vaiheeseen 6): katalogin `input`-metadata eroaa osalla tooleista live-handlerin paramien kanssa (esim. `handbook_get` `tier` vs `module`, `consent_grant`-paramit, `board_members` `add`/`remove`) — skeema-audit reconciloi nämä.

---

## Vaihe 2 — F3 + F11: limit-katot + truncation; download resource-handleen

**Tavoite:** Estä kontekstin räjähtäminen (Claude Code katkaisee 25k tokeniin). Yksikään tool ei saa palauttaa rajatonta payloadia.

**Muutokset:**
1. `definitions.ts`: `listDefaults: { defaultLimit: 50, maxLimit: 500 }` kaikille listatooleille. **Korjaa server `aimeat_memory_list`** ottamaan `limit` (puuttuu nyt, `core.ts:281`) → signature-pariteetti connectorin kanssa.
2. `shape.ts`: `truncateResult(text, maxTokens=25000)` — leikkaa + lisää `_truncated: { shown, total, hint }` -kenttä joka ohjaa agenttia kapeampaan hakuun. Sovella **jaetussa return-helperissä** molemmilla pinnoilla.
3. `aimeat_memory_list owner_scope:true`: lisää aggregaattikatto (`core.ts:304`) + `log`/kenttä pudotetuista.
4. **F11 — `aimeat_storage_download` = binääriraja, tavut EIVÄT koskaan LLM-kontekstiin.** Storage sisältää tyypillisesti kuvia, videoita ja muita isoja binäärejä — niitä ei pidä yrittää lukea malliin lainkaan (konteksti hajoaa, turha token-kustannus). **Poista base64-inline oletuspolusta.** Sen sijaan palauta aina **handle**:
   - MCP-natiivi **`resource_link`**-content-blokki osoittaen jo rekisteröityyn `aimeat://storage/{key}`-resurssiin (`core.ts:67`) → MCP-client voi hakea tavut out-of-band, agentti ei näe niitä.
   - Lisäksi presigned **`GET /v1/download/:token`** -URL etäkäyttöä varten + metadata `{ key, mime_type, size_bytes }`. Peilaa upload-malli (`core.ts:540`).
   - Valinnainen eksplisiittinen `inline: true` -override **vain** pienelle tekstisisällölle (kovaraja esim. ≤ 32 KB **ja** tekstipohjainen mime); muuten estä ja ohjaa handleen.
   - Uusi reitti `GET /v1/download/:token` → **Rule 3: openapi.yaml + generate:types**.

> Periaate (doc 02 #10 + doc 05 privacy-preserving): isot/binääripayloadit kulkevat handlena, eivät mallin läpi. Sama koskee `aimeat_memory_read`/`storage`-resursseja joissa arvo voi olla iso.

**Testit:** `e2e-mcp-memory-extended.ts`, storage-osa `e2e-mcp.ts`:ssä, uusi download-token-testi (happy + expired/oversize), testi joka varmistaa ettei iso binääri palaudu base64:nä tool-vastauksessa.

**Valmis kun:** grep "truncat|maxToken" löytää jaetun katon; `storage_download` palauttaa aina `resource_link`+URL+metadata — binääritavut eivät virtaa tool-vastaukseen; `inline:true` toimii vain pienelle tekstille.

**Todo:**
- [x] `shape.ts`: `truncateResult(text, ~25k tokens)` + `_truncated`-ohjekenttä; `jsonContent()` soveltaa sen **universaalina** backstoppina molemmilla pinnoilla
- [x] Korjaa server `aimeat_memory_list` ottamaan `limit` (default 200 / hard cap 1000) → signature-pariteetti connectorin kanssa
- [x] `aimeat_memory_list owner_scope:true`: aggregaattikatto (lopettaa kun cap ylittyy) + `truncated`/`shown`/`hint`-raportointi
- [x] `aimeat_storage_download`: poista base64-inline oletuspolusta; palauta aina `resource_link` (`aimeat://storage/{key}`) + presigned `download_url` + metadata
- [x] `inline: true` -override vain pienelle tekstille (≤ 32 KB & tekstipohjainen mime), muuten handle
- [x] Uusi `download-token.ts`-palvelu (TTL, ei single-use → Range toimii) + `GET /v1/download/:token` (presigned, no-auth) + storage `GET ?mode=handle|inline`
- [x] **Rule 3:** `openapi.yaml` (/v1/download/{token} + storage mode-param) + `pnpm generate:types` (matkalla korjattu 2 ennestään rikkinäistä spec-kohtaa: `AimeatResponse`-dangling-ref, `getAgentInbox`-duplikaatti operationId)
- [x] Testit: download-token-yksikkötesti (roundtrip/expired/wrong-typ/garbage), e2e: `storage_download` palauttaa handlen + presigned URL palauttaa tavut + **iso binääri ei palaudu base64:nä** + inline-teksti
- [x] `pnpm lint` (0 erroria) + `pnpm typecheck` vihreä
- [x] e2e: **232** MCP + 52 micro-memory + 58 upload/storage-visibility + **17** yksikkötestiä SQLitellä vihreät — **✅ vaihe todennettu**

> Avoimet jatkokohdat: `listDefaults`-metadata + universaali truncation kaikkiin handlereihin → luontevasti Phase 4:n `registerTool`-migraation yhteyteen (siellä kosketaan kaikkia handlereita). `aimeat_storage_upload`-presigned-paritus connectorissa on jo olemassa.
> **Sivulöydös (jo korjattu):** `generate:types` oli rikki `main`issa kahden ennestään olemassa olevan spec-virheen takia; korjattiin campsite-periaatteella tämän vaiheen yhteydessä.

---

## Vaihe 3 — F1: scope-enforcement MCP-pinnalle (tietoturva + leikkaa pintaa)

**Tavoite:** Agentti näkee/saa vain scopeihinsa kuuluvat toolit. Korjaa least-privilege-rikko ja pienennä per-agentti-tool-pintaa. **Tämä ei ole regressio vaan haluttu kohdennetun scopen malli** (ks. "Suunnitteluperiaate" alla).

**Suunnitteluperiaate — kaksi käyttötapaa:**
- **Owner-attached (esim. Claude Desktop):** omistaja liittää AIMEAT-MCP:n ja antaa mallin itse päättää mitä käyttää → **leveä pääsy on tarkoituksenmukainen.** Tämä ratkeaa owner-session-bypassilla (`middleware.ts:293`) tai consent-vaiheessa myönnetyllä leveällä scope-setillä. Ei kapeneta tässä.
- **CLI/etäagentit (`aimeat connect`):** scope **halutaan** kohdentaa tehtävän mukaan, ei "kaikki kerralla". Eri roolit tarvitsevat eri pinnat — task-runner paljon kapeamman, appdev omat, organism/knowledge omat, eivätkä ne tarvitse kaikkia samaan aikaan vaan tehtäväriippuvaisesti.

**Scope-profiilit (uusi):** määrittele roolipohjaiset scope-bundlet jotka kytketään olemassa olevaan `AgentRecord.mode`-kenttään (`autonomous`/`interactive`/`task-runner`/`coordinator`) ja domain-tarpeeseen:
| Profiili | Tyypilliset scopet (esimerkki) |
|----------|-------------------------------|
| `task-runner` | `memory:read/write`, `task:*`, `work:*` — minimi tehtävän suorittamiseen |
| `appdev` | `app:*`, `extension:*`, `cortex:*`, `storage:*`, `memory:*` |
| `organism-knowledge` | `organism:*`, `knowledge:*`, `board:read`, `memory:read` |
| `coordinator` | `task:*`, `message:*`, `agents:read`, `catalogue:read` |
| `interactive` (desktop) | leveä / owner-bypass |
Profiilit ovat **oletuksia**, joita omistaja voi hienosäätää consentissa (device-auth-scope-valinta on jo olemassa). Säilytä yhteismitallisuus REST-scopejen kanssa (`auth/middleware.ts`).

**Muutokset:**
1. `definitions.ts`: `requiredScope` jokaiselle toolille (peilaa `auth/middleware.ts` scope-kartta: `memory:read/write`, `catalogue:read`, `social:read/write`, `wallet:*`, `task:*`, `app:*`, jne.). Lukutoolit read-scopeen, mutaatiot write-scopeen, openWorld-toolit (`*_invoke`, `action_execute`) erilliseen.
2. `catalog/scope-profiles.ts` (uusi): roolipohjaiset bundlet yllä olevan taulukon mukaan + `scopesForProfile(mode, domains)`-helper.
3. **Server** `createMcpServer(agentGaii)` (`index.ts:105`): lue agentin scopet JWT:stä (ne ovat jo `req.auth.scopes`, mutta `createMcpServer` saa nyt vain gaii:n — **thread scopes läpi**). Rekisteröi vain toolit joiden `requiredScope` ∈ agentScopes. **Owner/operator-bypass** kuten middleware → desktop-leveä käyttö säilyy.
4. **Connector**: REST valvoo jo scopet (saa 403 luonnostaan), mutta rekisteröi-aikainen suodatus parantaa UX:ää — connector tietää agentin; tuo scopet keychainiin/configiin (`cli/connect/config.ts`) ja suodata samalla `allowedTools(scopes)`-helperillä (jaettu `catalog/`-puolelle).
5. Päätös: **rekisteröi-aikainen suodatus** (ei vain handler-gate) → pienempi tool-pinta = token-säästö + vähemmän agentin sekaannusta.

**Rollout-turva:** ennen pakotusta aja **warn-only-tila** (feature-flag `AIMEAT_MCP_ENFORCE_SCOPES=false`): logita mitä _suodattuisi_, mittaa montako olemassa olevaa agenttia menettäisi tooleja, laajenna/uudelleen-consenttaa ne tarvittaessa, vasta sitten enforce. Owner-attached-käyttö ei muutu missään vaiheessa.

**Testit:** uusi `e2e-mcp-scopes.ts`: (a) `task-runner`-profiilin agentti näkee vain task/work/memory-toolit, (b) `appdev` näkee app/extension/cortex-toolit muttei esim. organism-tooleja, (c) owner-JWT näkee kaikki, (d) warn-only-tila ei suodata vaan logittaa. Aja myös `e2e-mcp.ts` regressiona.

**Valmis kun:** `task-runner`-agentti ei saa esim. `aimeat_app_publish`-toolia listalle; `appdev` saa; owner näkee kaikki; warn-only-flag toimii.

**Todo:**
- [x] Tool→scope-kartta `catalog/scopes.ts`:ssä (`TOOL_SCOPES`) — peilaa `auth/middleware.ts`-gateja **täsmälleen**: gataan vain ne toolit joiden REST-reitti käyttää `requireScope` (memory/social/wallet/work/consent). Muut jätetään gataamatta → MCP pysyy REST-yhdenmukaisena.
- [x] `catalog/scopes.ts`: `scopeAllowsTool()` (wildcard: `*` / `domain:*` / exact, kuten middleware) + roolipohjaiset profiilit `MCP_SCOPE_PROFILES` + `scopesForProfile()` (task-runner / coordinator / appdev / organism-knowledge / interactive / autonomous)
- [x] Thread agentin scopet (`agent.defaultScopes`) `createMcpServer(gaii, scopes)`:iin; `mcp.tool` patchataan rekisteröinnin ajaksi → vain sallitut toolit rekisteröidään
- [x] '*' scope → koko pinta (owner-attached / Claude Desktop säilyy leveänä); admin-toolit pysyvät runtime-operator-gatattuina
- [x] Warn-only-tila `AIMEAT_MCP_ENFORCE_SCOPES=false` (oletus true): rekisteröi kaikki mutta logittaa suodatettavat; lisätty `.env.example`:en
- [x] Uusi `e2e-mcp-scopes.ts`: kapea agentti (`memory:read`) ei näe/ei voi kutsua memory_write/wallet/board_post/work/consent; laaja (`*`) näkee kaikki; suodatettu write ei persistoi (4/4)
- [x] `e2e-mcp` + 11 muuta MCP-suitea regressio vihreä (**219/219**); 9 uutta `scopes`-yksikkötestiä
- [x] `pnpm lint` (0 erroria) + `pnpm typecheck` vihreä — **✅ vaihe todennettu** (commit seuraa)

> Päätökset/poikkeamat suunnitelmaan: (1) Todellinen scope-sanasto on suppeampi kuin alkup. profiilit olettivat (task:*/app:* eivät ole olemassa) → gataan vain oikeasti REST-gatatut domainit; profiilit mappaavat olemassa oleviin scopeihin ja laajenevat kun uusia lisätään. (2) MCP-token on aina agent-rooli (ei owner-session), joten "owner-bypass" = '*'-scope. (3) **Connector-suodatus jätettiin pois**: connector kutsuu REST:iä joka **jo** enforaa scopet (403), joten tietoturva on katettu; rekisteröi-aikainen suodatus on vain UX-parannus → siirretty myöhempään (connector ei vielä tallenna scopeja keychainiin).

---

## Vaihe 4 — F4: `structuredContent` + `outputSchema` raskaisiin tooleihin

**Tavoite:** Koneluettava, skeemavalidoitu ulostulo (2025-06-spec). **Prerequisite:** migraatio `mcp.tool()` → `mcp.registerTool()` (vanha API deprekoitu SDK 1.27).

**Muutokset:**
1. Uusi `catalog/output-schemas.ts`: jaetut zod-skeemat (`memoryEntry`, `memoryList`, `taskDetail`, `taskList`, `walletBalance`, `catalogueResult`, `agentList`, ...). `definitions.ts.outputSchema` viittaa näihin avaimella.
2. Migroi rekisteröinnit molemmilla pinnoilla: `mcp.registerTool(name, { description: descriptionFor(name), inputSchema, outputSchema, annotations: annotationsFor(name) }, handler)`. Handler palauttaa `{ structuredContent, content }` (SDK validoi structuredContentin outputSchemaa vasten).
3. Aloita korkean arvon tooleista (lukutoolit listasta yllä), laajenna kattavuutta.
4. `shape.ts shapeResponse` tuottaa structuredContentin sekä storage- (server) että `resp.data`- (connector) datasta.

**Riski:** `registerTool`-migraatio koskee ~98 kutsua → tee mekaanisesti, vaihe kerrallaan, lint+typecheck joka tiedoston jälkeen. Annotaatiot ja kuvaus säilyvät (vaiheet 1, jo olemassa).

**Testit:** assert `structuredContent` läsnä + validi; **MCP Inspector** discovery/schema-validointi. `e2e-mcp-*` regressio.

**Valmis kun:** lukutoolit palauttavat structuredContentin; Inspector ei raportoi schema-virheitä.

**Todo:**
- [x] `catalog/output-schemas.ts`: jaetut zod-skeemat (`walletBalanceOutput`, `memoryEntryOutput`, `memoryListOutput`, `genericListOutput`, `agentsListOutput`, `agentProfileOutput`) — kentät optional → sama skeema validoi sekä detailed että concise
- [x] `shape.ts:structuredResult()` palauttaa `{ content (teksti, back-compat), structuredContent }`; bare array → `{ items, count }`, objektit läpi; concise-projektio ensin
- [x] **Scope-filtteri (Phase 3) laajennettu kattamaan myös `registerTool`** — muuten migroidut toolit ohittaisivat enforce-suodatuksen (kriittinen yhteisvaikutus)
- [x] Migroitu core.ts:n korkean arvon lukutoolit `registerTool()`:iin: `memory_read`, `memory_list`, `wallet_balance`, `work_inbox`, `agents_list`, `agent_profile`
- [x] Testit: e2e assertoi `structuredContent` läsnä (wallet_balance.balance, memory_list.items); 3 uutta `structuredResult`-yksikkötestiä (29 yksikkötestiä yht.)
- [x] `pnpm lint` (0 erroria) + `pnpm typecheck` + `e2e-mcp` (39) + scopes (4) + 219 MCP-sweep vihreä — **✅ vaihe todennettu** (commit seuraa)

> Rajaus/päätökset: (1) **Inkrementaalinen migraatio** — `registerTool`+outputSchema vain korkean arvon, **rajatuille** lukutooleille (ei kaikkia 98:aa; `mcp.tool()` on vain deprekoitu, toimii yhä). Rajatut listat (memory_list cap 200, work_inbox, agents_list) välttävät truncation+structuredContent-konfliktin. (2) **Connector-puoli ja isot/unbounded listat (catalogue_search) siirretty** — connector tuottaa REST-`resp.data`:sta (F10-muotoero) ja vaatii oman normalisoinnin; tehdään Phase 5/6:n signature-yhtenäistyksen jälkeen. (3) outputSchema-kentät optional → coexist response_format=concise:n kanssa. (4) MCP Inspector -ajo jää release-vaiheen manuaalivalidointiin.

---

## Vaihe 5 — F2: konsolidoi workflow-tooleiksi (eval ennen/jälkeen)

**Tavoite:** Pudota 98 → tavoite <50 yhdistämällä ohuet/CRUD-toolit. Mittaa, älä arvaa (Anthropicin työtapa).

**Muutokset:**
1. **Eval-harness ensin** (`test/eval-mcp/`): ~10 realistista AIMEAT-tehtävää, yksinkertainen agentic loop, kerää tool-kutsut/tokenit/virheet → **baseline**. [VIRALLINEN 03 §2]
2. Konsolidoi (pidä aliakset migraation ajan, `consolidatedInto`-kentällä + deprekaatiovaroitus):
   - `aimeat_catalogue_search/agents/boards/directory` → yksi `aimeat_catalogue_search(kind=)`
   - `aimeat_capabilities_create/update/delete/vouch` → harkitse `aimeat_capability_manage(op=)`; pidä `get/list/invoke` erillään
   - `aimeat_board_create`+`subscribe` -työnkulun arviointi
   - `aimeat_group_*`-nimeämispäätös (unification Phase 3 jätti auki: `group_` vs `sharing_group_`)
3. Aja eval uudelleen → vertaa baseline. Hyväksy vain jos tool-kutsut/tokenit laskevat virheiden nousematta.
4. `audit:mcp-tools` ennen/jälkeen.

**Testit:** eval-vertailu + täydet `e2e-mcp-*` (konsolidoidut toolit + aliakset).

**Valmis kun:** tool-määrä laskenut merkittävästi, eval ei regressoi, aliakset deprekoitu hallitusti.

**Todo:**
- [x] Eval-harness `test/eval-mcp/`: 10 realistista tehtävää (`tasks.ts`, dataa) + `README.md` (live-LLM-metodologia, kehittäjän ajettava)
- [x] **Mittausinstrumentti** `surface-weight.ts` (`pnpm eval:mcp-surface`): tool-pinnan **kontekstitokenikustannus** per tool/domain — deterministinen before/after-mittari ilman live-LLM:ää
- [x] **Baseline mitattu: 99 toolia, ~11 720 tokenia.** Raskaimmat domainit: task (9, ~1212), board (9, ~1058), agent (6, ~948), extension (7, ~776), capabilities (7, ~743)
- [ ] **(kehittäjä-gated)** Aja live-eval (`ANTHROPIC_API_KEY`) → baseline tool-kutsut/tokenit/virheet
- [ ] **(kehittäjä-gated)** Konsolidoi `catalogue_search/agents/boards/directory` → `catalogue_search(kind=)` — vain jos eval vahvistaa ettei discovery heikkene (eri endpointit/paramit)
- [ ] **(kehittäjä-gated)** Konsolidoi capabilities-CRUD; **tuotepäätös** `group_` vs `sharing_group_`
- [ ] **(kehittäjä-gated)** Aliakset + deprekaatio (`consolidatedInto`); aja molemmat mittarit uudelleen; e2e vihreä — **vaihe todennettu kun merget tehty**

> **Tila:** Vaiheen 5 **mittausinstrumentti + tehtäväsetti + kandidaattianalyysi** valmiina ja committattu. Itse **merget on tietoisesti jätetty kehittäjän ajettavaksi**, koska suunnitelman oma hyväksyntäportti on **live-LLM-eval** (vaatii API-kulua + on epädeterministinen, ei ajettavissa tässä ympäristössä) ja `group_*`-nimeäminen on **tuotepäätös**. Sokkona mergeäminen rikkoisi auditin oman periaatteen ("mittaa, älä arvaa", doc 07) ja olisi kuluttajia rikkova. Instrumentti antaa nyt kovan luvun jolla merget perustellaan/hylätään.

---

## Vaihe 6 — F10: laajenna audit skeematasolle

**Tavoite:** Lukitse vaiheiden 1–5 yhtenäisyys. Estä behavior-drift jota nimitason audit ei näe (kuten vaiheen 2 `limit`-drift).

**Muutokset:**
1. Laajenna `scripts/audit-mcp-tools.ts`: vertaa server- vs connector- vs katalogi-**skeemat** (param-nimet, required, tyypit, enum), kuvaus, annotaatiot, `requiredScope`, `outputSchema` — ei vain nimet.
2. Lisää CI-portti: `audit:mcp-tools --strict` fail jos skeemadrift tai puuttuva katalogimetadata.
3. Dokumentoi sallitut poikkeamat (esim. `aimeat_admin_mint` server-only) eksplisiittisesti.

**Testit:** audit-skripti itse (drift-injektio → fail).

**Valmis kun:** keinotekoinen skeemadrift kaataa auditin.

**Todo:**
- [ ] Laajenna `scripts/audit-mcp-tools.ts` vertaamaan **skeemat** (param-nimet, required, tyypit, enum) server vs connector vs katalogi
- [ ] Vertaa myös kuvaus, annotaatiot, `requiredScope`, `outputSchema`
- [ ] `audit:mcp-tools --strict` CI-portti: fail skeemadriftistä tai puuttuvasta katalogimetadatasta
- [ ] Dokumentoi sallitut poikkeamat eksplisiittisesti (esim. `aimeat_admin_mint` server-only)
- [ ] Drift-injektiotesti: keinotekoinen ero kaataa auditin
- [ ] `pnpm lint` + `pnpm typecheck` vihreä — **✅ vaihe todennettu**

---

## Vaihe 7 — F7: `search_tools` / code-execution **jos pinta pysyy 50+** (ehdollinen)

**Päätösportti:** Aja vaiheen 5 jälkeen `audit:mcp-tools`. Jos tool-määrä < ~40 → **ohita tämä vaihe** (progressive disclosure ei tuo riittävää hyötyä, doc 05: hyöty kun dataa *manipuloidaan*, ei pelkästään pieni määrä tooleja).

**Jos 50+:**
1. **Progressive disclosure** (kevyempi): `aimeat_search_tools(query, detail_level)` meta-tool — palauttaa nimi / nimi+kuvaus / täysi skeema on-demand. Client lataa vain tarvitsemansa määrittelyt. [VIRALLINEN 04, 05]
2. **Code-execution** (raskaampi, vain jos agentit liikuttelevat isoja datapaketteja): esitä toolit tiedostopuu-API:na, anna mallin kirjoittaa koodia joka ketjuttaa kutsut + suodattaa ajoympäristössä. Vaatii **sandboxin** (Deno/eristetty kontti), resurssirajat, monitoroinnin — punnitse kustannus. [VIRALLINEN 05]

**Testit:** discovery-testi search_toolsille; code-execution sandbox-rajatestit jos toteutetaan.

**Valmis kun:** kaikkien 98 määrittelyn etukäteislataus ei ole pakollista clientin kontekstiin.

**Todo:**
- [ ] **Päätösportti:** aja `pnpm audit:mcp-tools` vaiheen 5 jälkeen
- [ ] Jos tool-määrä < ~40 → merkitse vaihe **ohitettu (ei tarpeen)** + perustelu, lopeta tähän
- [ ] (jos 50+) Toteuta `aimeat_search_tools(query, detail_level)` progressive disclosure
- [ ] (jos isoja datavirtoja) Toteuta code-execution: tiedostopuu-API + sandbox + resurssirajat + monitorointi
- [ ] Discovery-testi `search_tools`:ille / sandbox-rajatestit jos code-execution
- [ ] `pnpm lint` + `pnpm typecheck` + `e2e` vihreä — **✅ vaihe todennettu (tai dokumentoidusti ohitettu)**

---

## Riippuvuudet ja järjestys

```
Vaihe 1 (katalogi-spine: kuvaukset, shape.ts, response_format)
  └─> Vaihe 2 (limit/truncate käyttää shape.ts:ää) 
  └─> Vaihe 3 (requiredScope katalogissa)
        └─> Vaihe 4 (registerTool + outputSchema; käyttää shape.ts:ää)
              └─> Vaihe 5 (konsolidointi; eval-portti)
                    └─> Vaihe 6 (skeema-audit lukitsee 1–5)
                          └─> Vaihe 7 (ehdollinen, vaiheen 5 tuloksen mukaan)
```

Vaihe 1 on pakollinen pohja (luo `shape.ts` + laajentaa katalogityypin); 2–4 voivat edetä rinnakkain sen päällä; 5 vaatii 1–4 vakaina; 6 lukitsee; 7 on ehdollinen.

## Riskit

- **`registerTool`-migraatio (V4)** koskee ~98 kutsua kahdella pinnalla → mekaaninen mutta laaja; tee tiedosto kerrallaan typecheck+lint-portilla.
- **Connector REST-passthrough vs server storage** → kaikki muotologiikka **pakko** keskittää `shape.ts`:ään, muuten pinnat ajautuvat (juuri F10:n ydin).
- **response_format/concise (V1)** voi piilottaa kentän jota jokin client odottaa → `detailed` oletukseksi epävarmoissa, dokumentoi.
- **Konsolidointi (V5)** voi rikkoa olemassa olevia agentteja → aliakset + deprekaatiojakso, ei kovaa poistoa.

### Taaksepäin-yhteensopivuus (nykyinen MCP-käyttö)

MCP-käyttäjiä on toistaiseksi vähän → murtumariski on hallittavissa. Vaikutus jakautuu kuluttajatyypin mukaan: **LLM-välitteinen käyttö** (valtaosa) sietää muutokset, **ohjelmallinen** (nimellä/kentällä kutsuva) on hauras.

- **V1, V4, V6, V7** — käytännössä additiivisia, ei murra (`detailed`-oletus V1:ssä, `structuredContent` lisätään `content`:n rinnalle V4:ssä).
- **V2 / `storage_download`** — tietoinen, hyväksytty kontaktimuutos: binäärit eivät enää palaudu base64:nä vaan handlena. Harva käyttää tätä nyt, ja muutos on **toivottu** (estää kontekstin hajoamisen kuvilla/videoilla). Ei lievennetä inline-takaisinkytkennällä — pelkkä `inline:true` pienelle tekstille.
- **V3 / scope** — ei regressio vaan **kohdennetun scopen malli** (ks. vaiheen suunnitteluperiaate). Owner-attached (Claude Desktop) säilyy leveänä; CLI/etäagentit kapenevat tehtäväkohtaisesti tarkoituksella. Warn-only-rollout mittaa todellisen vaikutuksen ennen pakotusta.
- **V5 / uudelleennimet** — murtaa vain nimellä-kutsujat ja vain jos aliakset poistetaan; deprekaatiojakso suojaa migraation ajan. Sisäiset kuluttajat (esim. `python/aimeat-crewai`) päivitetään samassa.

## Loppuksi (koko suunnitelma valmis)

Vaiheiden edistymistä seurataan kunkin vaiheen **Todo**-listan checkboxeilla. Vaihe rastitetaan "✅ vaihe todennettu" vasta kun sen testit + lint + typecheck ovat vihreät — ei pelkästä koodin kirjoittamisesta.

Koko suunnitelman päätösportti:

- [ ] Vaiheet 1–6 kaikki "✅ vaihe todennettu" (vaihe 7 todennettu tai dokumentoidusti ohitettu)
- [ ] `pnpm lint` + `pnpm typecheck` vihreä
- [ ] `pnpm test:e2e:sqlite` täysi sweep vihreä (Rule 1)
- [ ] `pnpm test:e2e:mongodb` täysi sweep vihreä (Rule 1)
- [ ] `pnpm audit:mcp-tools` vihreä, dokumentoidut poikkeamat
- [ ] MCP Inspector -manuaalivalidointi tehty ennen Connectors Directory -submissionia
