# MCP-tutkimus: kattava ohjeistus MCP-serverin ja -clientin rakentamiseen

**Koonnut:** Claude (Anthropic), web-haun pohjalta
**Päivä:** 2026-05-30
**Tarkoitus:** Jounin ohjeistus, kun korjataan/parannetaan olemassa olevia MCP-komentoja (tools) fiksummiksi.

---

## Lähdeperiaate (tärkeä)

Olen merkinnyt jokaiseen väitteeseen lähteen. Lähdeluokat:

- **[VIRALLINEN]** = modelcontextprotocol.io -spesifikaatio tai Anthropicin engineering-blogi. Näitä voi pitää auktoritatiivisina.
- **[3RD]** = nimetty kolmannen osapuolen artikkeli (The New Stack, Nordic APIs, dev.to, tietoturvayhtiöt jne.). Hyvää käytäntöä mutta ei virallista.
- **[OMA TULKINTA]** = oma synteesini / suositus, joka ei tule suoraan yhdestä lähteestä.

**Mitä EN tiedä / en voinut varmentaa:**
- En nähnyt sinun nykyisiä MCP-komentojasi (AIMEAT-toolit), joten en voi sanoa konkreettisesti mitä niissä on korjattavaa. Tiedostot ovat yleistä ohjeistusta. Kun haluat konkreettista palautetta, liitä nykyiset tool-määrittelyt mukaan.
- Versiotiedot ja päivämäärät ovat parhaan haetun tiedon mukaisia. Tarkista uusin spec aina osoitteesta modelcontextprotocol.io ennen tuotantopäätöksiä.

---

## Tiedostot tässä paketissa

| Tiedosto | Sisältö |
|----------|---------|
| `00-README-yleiskatsaus.md` | Tämä tiedosto. Lähdeperiaate + sisällysluettelo. |
| `01-protokolla-ja-arkkitehtuuri.md` | Mikä MCP on, arkkitehtuuri (host/client/server), versiohistoria, 2025-11-25-spec uutuudet, transportit. |
| `02-server-best-practices.md` | Serverin rakentamisen parhaat käytännöt: tool-design, namespacing, stateless, transportit, virheenkäsittely, paginointi. |
| `03-tool-design-anthropic.md` | Anthropicin kanoninen tool-design-ohjeistus ("Writing effective tools for agents"): 5 periaatetta + prototyyppi/eval/yhteistyö-sykli. |
| `04-client-best-practices.md` | Clientin rakentamisen huomiot: capability-neuvottelu, sampling/roots/elicitation, OAuth, tool-loadaus. |
| `05-code-execution-mcp.md` | "Code execution with MCP" -malli: miten vähentää tokeneja 98 % esittämällä toolit koodi-API:na. Erittäin relevantti "fiksummat komennot" -tavoitteelle. |
| `06-security.md` | Tietoturva: OAuth 2.1, token passthrough -kielto, tool poisoning, confused deputy, prompt injection, allowlistit. |
| `07-yleiset-virheet-ja-checklist.md` | Tyypilliset sudenkuopat (oikeat kehittäjäkokemukset) + korjaus-checklist olemassa oleville tooleille. |

---

## Lyhyt yhteenveto: 7 tärkeintä asiaa

Jos luet vain yhden asian, lue tämä. (Synteesi kaikista lähteistä; merkitty per kohta.)

1. **Älä peilaa API:a 1:1 tooleiksi.** Rakenna harkittuja, työnkulkuun (workflow) sidottuja tooleja, ei ohutta käärettä jokaiselle endpointille. [VIRALLINEN: Anthropic]
2. **Namespace toolit** (esim. `aimeat_board_post`, `aimeat_task_create`). Selkeät prefiksit estävät agenttia sekoittamasta tooleja. [VIRALLINEN: Anthropic]
3. **Palauta vain korkean signaalin tieto.** Ei UUID-tunnisteita ja teknistä kohinaa; palauta nimet ja ihmisluettavat kentät. Tarjoa `response_format`-enum (concise/detailed). [VIRALLINEN: Anthropic]
4. **Optimoi tokenit:** paginointi, suodatus, truncation järkevillä oletuksilla. Claude Code rajaa tool-vastaukset 25 000 tokeniin. [VIRALLINEN: Anthropic]
5. **Tool-kuvaukset ovat prompt engineeringiä.** Kirjoita kuvaus kuin uudelle tiimiläiselle; ole eksplisiittinen parametreista ja käyttötilanteista. [VIRALLINEN: Anthropic]
6. **Tietoturva ei ole valinnaista:** OAuth 2.1 + PKCE HTTP-transportille, ei token passthroughia, validoi token audience joka pyynnössä. [VIRALLINEN: spec 2025-06-18 / 2025-11-25]
7. **Harkitse code-execution-mallia** jos tooleja on paljon: esitä serverit koodi-API:na ja anna mallin kirjoittaa koodia, joka ketjuttaa toolit. Säästää valtavasti tokeneja. [VIRALLINEN: Anthropic, marras 2025]

---

## Keskeiset lähde-URLit (tarkista uusin tila näistä)

- Spesifikaatio (uusin): https://modelcontextprotocol.io/specification/2025-11-25
- Anthropic — Writing effective tools for agents: https://www.anthropic.com/engineering/writing-tools-for-agents
- Anthropic — Code execution with MCP: https://www.anthropic.com/engineering/code-execution-with-mcp
- Tietoturvan best practices (virallinen): https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices
- The New Stack — 15 best practices: https://thenewstack.io/15-best-practices-for-building-mcp-servers-in-production/
- 2025-11-25 release (vuosikatsaus): https://blog.modelcontextprotocol.io/posts/2025-11-25-first-mcp-anniversary/
