# 08 — AIMEAT MCP -ratkaisun auditointi

**Päivä:** 2026-05-30
**Auditoija:** Claude (Opus 4.8)
**Kohde:** AIMEAT-serverin `/v1/mcp` (Streamable HTTP) + `aimeat connect` CLI:n paikallinen stdio-MCP
**Vertailupohja:** `docs/mcp_audit/01–07` (virallinen spec + Anthropic + 3rd-party best practices)

> Lähdemerkinnät kuten lähdetiedostoissa: [VIRALLINEN] = spec/Anthropic, [3RD] = artikkeli, [OMA] = synteesi.
> Koodiviitteet ovat muotoa `tiedosto:rivi`, tarkistettavissa repo­sta.

---

## 0. Mitä auditoitiin (kaksi pintaa, ei duplikaatti)

| Pinta | Toteutus | Transport | Tooleja | Auth |
|-------|----------|-----------|---------|------|
| **Public node MCP** | `aimeat/src/mcp/*` | Streamable HTTP (`/v1/mcp`) | 98 | OAuth 2.1 + PKCE, Bearer-JWT |
| **Connector MCP** | `aimeat/src/cli/connect/mcp/*` | stdio (`aimeat connect serve`) | 98 | Paikallinen keychain-token, REST-takana |

Nämä ovat **kaksi transporttia samalle työkalukatalogille** — täsmälleen oikea malli [VIRALLINEN: spec 01; OMA 02]. Public MCP osuu LLM-clientteihin jotka osaavat etä-OAuthin (Claude.ai Connectors, ChatGPT). Connector MCP istuu agentin vieressä paikallisesti niille runtimeille jotka eivät osaa etä-MCP-OAuthia. Tämä on perusteltu, ei redundanssi.

`pnpm audit:mcp-tools` (2026-05-30): 97 jaettua nimeä, 1 server-only (`aimeat_admin_mint`), 1 connector-only (`aimeat_task_request_changes`). Nimitason ajautuma on käytännössä nolla.

---

## 1. Mitä on tehty OIKEIN (ei korjattavaa — pidä nämä)

Tämä on **selvästi mediaania parempi** MCP-toteutus. Älä menetä näitä korjatessasi muuta:

1. **Yksi jaettu katalogi + jaettu annotaatiokartta.** `src/mcp/catalog/definitions.ts` (98 tool-määrittelyä) ja `src/mcp/annotations.ts` (99 annotaatiota) ovat single-source-of-truth molemmille pinnoille. `annotationsFor()` **heittää** jos toolilta puuttuu annotaatio (`annotations.ts:199`) → uusi tool ei voi shipata ilman luokittelua. Tämä on parempi kuin useimmilla. [VIRALLINEN 03 §5 tool annotations; 3RD 07]
2. **Täysi annotaatiokattavuus.** Jokaisella 99 toolilla on `title` + `readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`. `openWorldHint:true` on oikein merkitty juuri niihin jotka dispatchaavat hiekkalaatikko-/3rd-party-koodiin (`aimeat_extension_invoke`, `aimeat_capabilities_invoke`, `aimeat_action_execute`). `destructiveHint:true` rahatoiminnolle (`aimeat_admin_mint`) ja poistoille. [VIRALLINEN spec 2025-06 tool annotations]
3. **OAuth 2.1 oikein.** PKCE pakotettu S256:een (`index.ts:415`), DCR (RFC 7591), refresh-token-rotaatio (vanha revokoidaan, uusi myönnetään `index.ts:702`), revocation (RFC 7009), `.well-known/oauth-protected-resource` + `oauth-authorization-server` (RFC 9728/8414). Auth-codet single-use ja TTL-rajatut. [VIRALLINEN spec 06; checklist 06 ✓]
4. **Origin-validointi DNS-rebinding-suojana** (`index.ts:140`) ja **ennustamaton session-ID** `mcp-${randomBytes(16)}` (`index.ts:313`) — molemmat speci-vaatimuksia. [VIRALLINEN 06]
5. **Session not found → 404 + re-init** (`index.ts:173`) speci­n mukaisesti.
6. **Drift-auditi olemassa** (`scripts/audit-mcp-tools.ts`) ja ajetaan. [3RD 07 §A]
7. **Resources käytössä** (ei pelkät toolit): memory/storage/wallet resource-templateina + `subscribe`/`listChanged` event-bussi (`core.ts:42`, `index.ts:59`). [VIRALLINEN 02 §9]
8. **Hello Integration -onboarding molemmilla pinnoilla** — lifecycle-pariteetti saavutettu (unification-plan Phase 1).

---

## 2. Mitä on tehty "VÄÄRIN" / suboptimaalisesti (priorisoitu)

### 🔴 KRIITTINEN

#### F1. MCP-pinta EI valvo agentin scopeja — least-privilege rikki
REST-puolella on täysi scope-järjestelmä (`requireScope('memory:write')`, `auth/middleware.ts:280`), mutta `createMcpServer()` rekisteröi **kaikki 98 toolia jokaiselle autentikoidulle agentille** (`index.ts:105–135`). Ainoa ajonaikainen tarkistus on `isOperator()` admin-tooleille (`core.ts:619`). Eli: omistaja voi myöntää agentille kapean scopen, mutta heti kun agentti yhdistää MCP:llä, se saa **koko 98 toolin pinnan** — memory:write, wallet, consent, extension-install, app-publish, kaikki. Tämä rikkoo sekä `CLAUDE.md`:n identiteettimallin ("GAII ... Scoped permissions ... Enforced per agent's scope list") että MCP-tietoturvan least-privilege-periaatteen. [VIRALLINEN 06 "excessive tool permissions → lateral movement"; checklist 06]

> **Korjaus:** Lue agentin scopet JWT:stä `createMcpServer`-vaiheessa ja rekisteröi vain sallitut toolit (tai gate jokainen handler scope-checkillä). Tämä on samalla token-säästö (pienempi tool-pinta kontekstissa).

#### F2. 1:1 API-mappaus / liian monta toolia (98)
Tämä on best-practice-dokumenttien **#1 designvirhe** [VIRALLINEN 03 §1; 3RD 02 #2, 07 §B GitLab]. 98 toolia lähestyy useiden clientien **128-toolin rajaa** [3RD 04, 07 §C]. Connector-pinta on kirjaimellisesti ohut REST-kääre — esim. koko `aimeat_memory_read`-handler on `client.get('/v1/memory/${key}')` (`cli/.../tools/core.ts:30`). Ei yhtään workflow-konsolidointia. Konkreettisia kandidaatteja:
- `aimeat_board_create` + `aimeat_board_subscribe` → usein peräkkäin
- `aimeat_capabilities_create/get/update/delete/vouch/invoke/list` (7 toolia) — CRUD-räjähdys, jonka Anthropic nimenomaan varoittaa konsolidoimaan
- `aimeat_catalogue_search/agents/boards/directory` (4 erillistä hakua) → yksi `aimeat_catalogue_search(kind=...)`
- task-elinkaari (list/get/propose_todos/event/todo/complete/fail) — perustellumpi pitää erillään, mutta arvioi evalilla

> Anthropicin malli: yhdistä usein-yhdessä-kutsutut workflow-tooliksi (`schedule_event`-esimerkki). [VIRALLINEN 03 §1]

#### F3. Ei token-/sivutusrajoja raskaille listauksille
[VIRALLINEN 03 §4: "Claude Code rajaa tool-vastaukset 25 000 tokeniin"]. AIMEATissa **ei ole yhtään truncation-/token-kattoa** kummallakaan pinnalla (grep: 0 osumaa). Pahimmat:
- Server `aimeat_memory_list` **ei ota `limit`-parametria lainkaan** (`core.ts:281`), ja `owner_scope:true` aggregoi **kaikkien** omistajan agenttien muistin rajatta (`core.ts:304–310`).
- `aimeat_catalogue_search` palauttaa kaikki actionit (`core.ts:132`).
- `aimeat_storage_download` palauttaa koko tiedoston base64:na **tool-vastauksen sisällä** (`core.ts:601`) — iso payload suoraan kontekstiin. Pitäisi palauttaa resource-URI/handle. [VIRALLINEN 02 #10]

> Connector `aimeat_memory_list` ottaa `limit`-parametrin mutta server ei → signature-drift.

### 🟠 KORKEA

#### F4. Ei `structuredContent` / `outputSchema` (2025-06) — pelkkä tekstilohko
Jokainen tool palauttaa `content:[{type:'text', text: JSON.stringify(...)}]`. Yhtään `outputSchema`-/`structuredContent`-käyttöä ei ole (mcp/-hakemiston `outputSchema`-osumat ovat domain-payloadia: capability/extension output schema, eivät MCP-feature). Menetät koneluettavan, skeemavalidoidun ulostulon jonka 2025-06-spec tarjoaa. [VIRALLINEN 02 #6; checklist 07 §4]

#### F5. Ei `response_format` (concise/detailed) + teknistä kohinaa palautuksissa
Mikään tool ei tarjoa `response_format`-enumia (Anthropicin esimerkissä "concise" = ~⅓ tokeneista) [VIRALLINEN 03 §3]. Palautukset sisältävät teknisiä tunnisteita ilman vaihtoehtoa: `provider_gaii`, `tracking_code`, `requester_gaii`, `version` (esim. `aimeat_action_execute`, `aimeat_work_inbox`). Periaate 3: suosi ihmisluettavia kenttiä, tarjoa detailed vain kun pyydetään.

#### F6. Tool-kuvaukset ohuita (heikoin halpa-korjaus-mahdollisuus)
Periaate 5 ("kirjoita kuin uudelle tiimiläiselle") on tehokkain yksittäinen vipu [VIRALLINEN 03 §5]. Suuri osa katalogin kuvauksista on yhden lauseen tynkiä: *"List organisms."*, *"Get group detail."*, *"Vouch for a capability."* — ei kerro **milloin käyttää / milloin ei**, ei resurssien suhteita, ei formaattihuomioita. Vertaa hyvään esimerkkiin samassa katalogissa: `aimeat_task_create` (`definitions.ts:190`) selittää omistajuussäännön ja käyttötilanteen — *kaikki* toolit pitäisi kirjoittaa tälle tasolle.

#### F7. Ei progressive disclosure / code-execution — 98 tool-määrittelyä joka clientin kontekstiin
Kun tooleja on 98, kaikkien määrittelyjen lataaminen etukäteen on iso token-syöppö [VIRALLINEN 04, 05]. AIMEAT on tarkalleen se tapaus jossa **`search_tools`-progressive disclosure** tai **code-execution-malli** kannattaa (doc 05: 150k→2k tokenia). Ei toteutettu kummallakaan pinnalla. Yhdistettynä F1:een (scope-suodatus) tämä leikkaisi pintaa rajusti.

### 🟡 KESKITASO

#### F8. Virhevastaukset eivät ole koneluettavia/toiminnallisia
Osa on hyviä (`"Insufficient morsels. Need ${cost.total}, have ${balance}"`, `core.ts:355` ✓), mutta moni on läpinäkymätön merkkijono ilman koodia: `"Not your work item"`, `"Operator role required"`, `"Memory not found"`. Ei `error_code`-kenttää agentin ohjelmalliseen haaroitukseen. [VIRALLINEN 03 §4; checklist 07 §6]

#### F9. Versiointi — kovakoodatut, ajautuneet versiot
Server `McpServer` ilmoittaa `version: '1.2.0'` (`index.ts:107`), connector `'0.1.0'` (`server.ts:46`), kun paketin versio on `1.14.5`. Ei per-tool-versiointia. [3RD 02 #8]

#### F10. Kaksi käsin ylläpidettyä handler-toteutusta (behavior-drift-riski)
Katalogi jakaa *metadatan*, mutta handlerit ovat erillään: server käyttää `storage`-kerrosta suoraan, connector kutsuu REST:iä `AimeatClient`-luokalla. Audit-skripti vertaa vain **nimiä**, ei skeemoja/käytöstä. Esim. F3:n `limit`-drift (server vs connector `memory_list`) jäi auditilta huomaamatta. [3RD 07 §A "hiljaiset epäonnistumiset"]

#### F11. `aimeat_storage_download` palauttaa binäärin inline base64:na
Ks. F3 — pitäisi olla resource-handle/URI, ei megatavuja tool-vastaukseen. Huom: *upload*-puoli onkin tehty oikein (presigned PUT-URL, `core.ts:540`) — sama malli pitäisi tuoda downloadiin.

---

## 3. Mahdollisuudet (ei "väärin", mutta nostaisi tasoa)

- **O1. MCP Tasks -capability (2025-11-25).** AIMEATilla on kirjaimellinen task/work-elinkaari (`aimeat_task_*`, `aimeat_work_*`). Tämä mappautuu suoraan specin uuteen **Tasks**-abstraktioon (tilat `working`/`input_required`/`completed`/`failed`/`cancelled`, client-pollaus, tulosten haku jälkikäteen). [VIRALLINEN 01, 02 §AIMEAT-huomiot]
- **O2. Eval-pohjainen tool-kehitys.** Ei näkyvissä eval-suitea MCP-tooleille; on E2E (`test/e2e-mcp-*.ts`) joka testaa toimivuutta muttei agentti-ergonomiaa. Anthropicin työtapa: rakenna eval realistisista tehtävistä, anna Claude Coden refaktoroida kuvaukset transkriptien pohjalta. [VIRALLINEN 03]
- **O3. MCP Inspector** discovery/schema/virhepolkujen validointiin ennen Connectors Directory -submissionia. [3RD 07]

---

## 4. Suositeltu korjausjärjestys (halvin→kallein, doc 07 §"korjausjärjestys")

1. **F6 + F5: Kirjoita tool-kuvaukset uudelleen + lisää `response_format`.** Halvin, suurin vaikutus, ei arkkitehtuurimuutosta. Tee se jaettuun `definitions.ts`:ään → molemmat pinnat hyötyvät kerralla. (Anthropicin SWE-bench-tulos tuli pelkistä kuvausparannuksista.)
2. **F3 + F11: Lisää `limit`/oletuskatto kaikkiin listauksiin + truncation-budjetti; siirrä `storage_download` resource-handleen.** Token-säästö heti, estää kontekstin räjähtämisen.
3. **F1: Scope-enforcement MCP-pinnalle.** Tietoturvakriittinen + leikkaa tool-pintaa per agentti.
4. **F4: `structuredContent` + `outputSchema` raskaisiin/rakenteisiin tooleihin.**
5. **F2: Konsolidoi ohuet toolit workflow-tooleiksi** (capabilities-CRUD, catalogue-haut). Aja `audit:mcp-tools` ja eval ennen/jälkeen.
6. **F10: Laajenna audit vertaamaan skeemoja, ei vain nimiä** (estä F3-tyyppinen drift).
7. **F7: Jos tool-määrä pysyy ~50+, harkitse `search_tools`-progressive disclosurea tai code-execution-mallia.**
8. **F8, F9, O1–O3** viimeistelynä.

---

## 5. Tiivistelmä yhdellä lauseella

AIMEATin MCP on **auth- ja annotaatiotasolla vahva ja hyvin organisoitu** (jaettu katalogi, täydet annotaatiot, OAuth 2.1, dual-transport), mutta sen heikkoudet ovat **tool-pinnan koossa ja muodossa**: 98 enimmäkseen 1:1-REST-kääreistä toolia ilman scope-suodatusta, token-rajoja, `structuredContent`-rakennetta, `response_format`-tiiviyttä tai "uudelle tiimiläiselle"-tason kuvauksia — eli juuri ne asiat jotka Anthropicin viisi periaatetta nostavat tärkeimmiksi agentti-ergonomian kannalta.
