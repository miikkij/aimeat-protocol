# Generator Automation Research — 2026-03-25

## Tutkimuskysymys

Miksi LLM-generoitu koodi toimii kun ihminen kopioi promptin AI chatiin ja liittää tuloksen takaisin, mutta automaattinen pipeline tuottaa rikkinäisiä tuloksia? Miten multi-component LLM-generointi saadaan toimimaan luotettavasti?

---

## Löydetty juurisyy (tämä sessio)

**`stripCodeblock` ajettiin vain extension-tyypille.** AI palauttaa vastaukset aina koodiblokkiwrapperissa (` ```yaml ... ``` `, ` ```html ... ``` `). Kun ihminen kopioi AI chatin vastauksesta, chat-UI renderöi wrapperin visuaalisesti ja ihminen kopioi sisällön ilman sitä. Automaatio sai raakavastauksen ja ei strippannut wrapperia cortexilta eikä appilta. Tämä on yksinkertainen bugi, ei arkkitehtuuriongelma.

**Korjattu:** `stripCodeblock` ajetaan nyt kaikille komponenttityypeille.

**Avoin:** Ratkaiseeko tämä kaiken? Testattava seuraavassa sessiossa.

---

## Tutkimus 1: LLM Fix-Loop Ping-Pong

### Ongelma
AI generoi testikoodin → testi failaa → AI saa virheilmoituksen → yrittää korjata → tekee saman virheen uudelleen → 3 kierrosta → luovuttaa.

### Löydökset

#### Reflection-vaihe ennen korjausta
**Lähde:** Chen et al., "LEDEX: Training LLMs to Better Self-Debug and Explain Code", NeurIPS 2024. [arXiv:2405.18649](https://arxiv.org/abs/2405.18649)

**Löydös:** Kun LLM:ää pyydettiin ensin selittämään MIKSI koodi on väärin (ilman koodia), ja sitten vasta korjaamaan, pass@1 parani 15.9%. Syy: pakottaa kausaalista päättelyä sen sijaan että AI pattern-matchaa virheviestiä ja tekee pintakorjauksen.

**Miten soveltuu meihin:** Toteutettu `buildReflectionPrompt()` — erillinen AI-kutsu joka diagnosoi ongelman ennen fix-kutsua.

#### Fix-historian kertyminen kierrosten välillä
**Lähde:** Shinn et al., "Reflexion: Language Agents with Verbal Reinforcement Learning", NeurIPS 2023. [arXiv:2303.11366](https://arxiv.org/abs/2303.11366)

**Löydös:** "Episodic memory buffer" — agentti muistaa mitä yritettiin aiemmin ja miksi se epäonnistui. Estää "degeneration-of-thought" -ongelman jossa sama virheellinen päättelyketju toistuu.

**Miten soveltuu meihin:** Toteutettu `previousAttempts[]` -parametri `buildFixPrompt`:ssa. Kierros N näkee kierrosten 1..N-1 yritykset ja diagnoosit.

#### Oscillation-tunnistus ja tuore generointi
**Lähde:** Kim et al., "Instruct-of-Reflection", NAACL 2025. [ACL Anthology](https://aclanthology.org/2025.naacl-long.502.pdf)

**Löydös:** Kun tulokset ennen ja jälkeen reflektiota ovat samoja (sama virhetyyppi toistuu), pitää LOPETTAA inkrementaalinen korjaus ja vaihtaa strategiaa. Muuten agentit kuluttavat tokeneita tuloksetta.

**Lisälähde:** Cursor blog, "Best practices for coding with agents", 2025. [cursor.com/blog/agent-best-practices](https://cursor.com/blog/agent-best-practices) — "Instead of trying to fix it through follow-up prompts, go back to the plan, revert the changes, refine the plan to be more specific, and run it again."

**Lisälähde:** Aider GitHub issue #1090 — dokumentoitu bugi jossa agentti looppaa ikuisesti samojen lint-virheiden kanssa.

**Miten soveltuu meihin:** Toteutettu `buildFreshGenerationPrompt()` — kierros 3 tai oscillation-tunnistus → generoi alusta alkuperäisellä promptilla + pitfalls-lista. EI näytä rikkinäistä koodia (estää ankkuroinnin).

#### Oikea runtime-output fix-prompttiin
**Lähde:** Amazon LEDEX + Warp SWE-bench verified team (2025).

**Löydös:** Pelkkä virheilmoitus ei riitä — AI:lle pitää näyttää **oikea runtime-output** (API-vastaukset, console.log, stack trace). Tämä on yksi vaikuttavimmista yksittäisistä interventioista.

**Miten soveltuu meihin:** Toteutettu trace-data fix-promptissa. AI näkee esim. `callExt(searchCompanies) → {"businessId":{"value":"3323553-5",...}}` ja ymmärtää että `businessId` on objekti, ei stringi.

---

## Tutkimus 2: Multi-Component LLM Code Generation

### Ongelma
Kun generoidaan useita komponentteja (backend, kirjasto, frontend) erikseen, ne eivät integroidu koska jokainen AI-kutsu on erillinen konteksti.

### Löydökset

#### Contract-First Generation
**Lähde:** Anthropic, "Building effective agents", 2025. [anthropic.com/research/building-effective-agents](https://www.anthropic.com/research/building-effective-agents) — suosittelee "shared context documents" jotka välitetään kaikille agenteille pipelinessa.

**Lähde:** Vercel v0.dev arkkitehtuuri — generoi jaetun tyyppitiedoston ensin, referoi sitä kaikissa seuraavissa generoinneissa.

**Idea:** Ennen yhtäkään komponenttia, generoi "integration contract" — TypeScript-tyyppitiedosto tai JSON Schema jossa on kaikki rajapinnat, nimet, datamuodot. Jokainen seuraava promptti saa tämän documenttin sellaisenaan.

**Miksi tämä voisi auttaa:** Estää nimen ja shape-driftin koska kaikki viittaavat samaan dokumenttiin.

**Miksi tämä ei ehkä riitä meidän tapauksessa:** Meidän promptit JO sisältävät rajapintatiedot (`completedComponents` sisältää registeredAs, API summary jne.). Ongelma oli mekaaninen (stripCodeblock), ei arkkitehtuurinen.

#### Golden Sample / Probe-vaihe
**Lähde:** Cognition/Devin tekninen arkkitehtuuri (2025, yhteisön reverse-engineeröimä) — ajaa koodin sandboxissa jokaisen generoinnin jälkeen, syöttää oikean outputin seuraavaan vaiheeseen.

**Lähde:** StackBlitz/Bolt.new — ajaa generoidun appin WebContainerissa, näkee oikeat virheet, self-korjaa.

**Lähde:** Lovable (ent. GPT-Engineer) — build + preview jokaisen generoinnin jälkeen; preview-virheet syötetään seuraavaan iteraatioon.

**Idea:** Extension rekisteröinnin jälkeen: kutsu jokainen action oikeilla parametreilla, tallenna oikeat JSON-vastaukset. Syötä ne cortex-prompttiin. Cortex rekisteröinnin jälkeen: aja metodit, tallenna tulokset. Syötä ne app-prompttiin.

**Miksi tämä voisi auttaa:** AI ei enää arvaa datamuotoja — se näkee oikean JSON:in ja generoi sen mukaisesti. Vastaa sitä mitä ihminen tekee: näkee oikean datan ja generoi sen pohjalta.

**Miksi tämä kannattaa tehdä vaikka stripCodeblock korjaisi nykyisen bugin:** Parantaa generoinnin LAATUA — AI joka näkee `{"businessId":{"value":"3323553-5"}}` ei generoi `company.businessId === '3323553-5'` vaan `company.businessId.value === '3323553-5'`.

#### Test Scaffolding — "luut ja liha"
**Lähde:** Qodo/CodiumAI (2025) — generoi testirungot ensin, käyttää niitä validoimaan generoitua koodia.

**Lähde:** Princeton SWE-Agent (2024-2025) — käyttää olemassaolevia testejä ground truthina; agentin tehtävä on saada ne läpi.

**Lähde:** Google/Meta (2025, julkaisemattomia sisäisiä tuloksia viitattuna konferenssipuheissa) — "test-first LLM generation" jossa testisarjat rajoittavat generoitua koodia.

**Idea:** Testien RAKENNE generoidaan koodista (parsitaan cortex-exportit), AI täyttää vain assertiot:
```
// GENEROITU AUTOMAATTISESTI cortex-exporteista (ei AI):
const lib = window.AIMEAT.prhYritystietopalvelu;
const searchResult = await lib.searchCompanies({query: 'Nokia'});
// AI TÄYTTÄÄ (tietää oikean datan probe-vaiheesta):
assert(searchResult !== null, 'should return data');
assert(searchResult.companies.length > 0, 'should find Nokia');
assert(searchResult.companies[0].mainName, 'should have mainName');
```

**Miksi tämä voisi auttaa:** Testit eivät voi olla rakenteellisesti väärin (kutsut, metodinimet) koska ne parsitaan oikeasta koodista. AI voi olla väärässä vain assertioiden suhteen, ja siihenkin probe-data auttaa.

#### Bidirectional Validation ("Handshake")
**Lähde:** Ei spesifistä yksittäistä lähdettä, mutta yleinen pattern contract-testing-kirjallisuudessa (Pact, Spring Cloud Contract).

**Idea:** Appin generoinnin jälkeen, parsii (vaikkapa regexillä) mitä API-kutsuja app tekee (`fetch('/v1/ext/...')`). Vertaa niitä extensionin oikeisiin endpointteihin. Raportoi ristiriidat ENNEN testien ajoa.

**Miksi tämä voisi auttaa:** Olisi löytänyt `prh-yritystietopalvelu` vs `prh-tiedonhaku` -ristiriidan heti generoinnin jälkeen, ilman testien ajoa.

---

## Yhteenveto: Mitä tehdään seuraavaksi

### Jos stripCodeblock korjaa kaiken:
Nykyinen pipeline toimii. Parannuksia silti kannattaa tehdä:
- Probe-vaihe parantaa generoinnin laatua
- Testien luut-ja-liha -malli parantaa testien laatua
- Bidirectional validation löytää ristiriidat nopeammin

### Jos stripCodeblock ei korjaa kaikkea:
Syvempi ongelma — kontekstin pirstaloituminen, malliero, tai jokin muu mekaaninen bugi. Silloin:
1. Vertaa "Kopioi prompt" vs debug `prompt.txt` merkki merkiltä
2. Vertaa AI chat -vastaus vs `ai-raw-response.txt`
3. Vertaa `generated.txt` vs se mitä rekisteröidään

---

## Lähteet

| Lähde | Vuosi | Aihe | URL |
|-------|-------|------|-----|
| LEDEX (Chen et al.) | NeurIPS 2024 | Self-debug + reflection | [arXiv:2405.18649](https://arxiv.org/abs/2405.18649) |
| Reflexion (Shinn et al.) | NeurIPS 2023 | Verbal reinforcement learning | [arXiv:2303.11366](https://arxiv.org/abs/2303.11366) |
| MAR (Multi-Agent Reflexion) | Dec 2025 | Degeneration-of-thought | [arXiv:2512.20845](https://arxiv.org/html/2512.20845) |
| IoRT (Kim et al.) | NAACL 2025 | Oscillation stop instruction | [ACL](https://aclanthology.org/2025.naacl-long.502.pdf) |
| RGD (Multi-LLM Debugger) | 2024 | Multi-agent debugging | [arXiv:2410.01242](https://arxiv.org/pdf/2410.01242) |
| Cursor | 2025 | Agent best practices | [cursor.com/blog](https://cursor.com/blog/agent-best-practices) |
| Aider | 2024-2025 | Lint/test docs + infinite loop | [aider.chat/docs](https://aider.chat/docs/usage/lint-test.html) |
| Aider (tree-sitter) | 2024 | Linting code for LLMs | [aider.chat](https://aider.chat/2024/05/22/linting.html) |
| Warp SWE-bench | 2025 | Context hints in system prompt | [warp.dev/blog](https://www.warp.dev/blog/swe-bench-verified) |
| Self-Debugging with Self-Generated Tests | ACL 2025 | Test generation for repair | [ACL](https://aclanthology.org/2025.acl-long.881.pdf) |
| LangChain Reflection Agents | 2024 | Reflection pattern | [blog.langchain.com](https://blog.langchain.com/reflection-agents/) |
| RepairAgent | ICSE 2025 | Autonomous program repair | [ACM](https://dl.acm.org/doi/10.1109/ICSE55347.2025.00157) |
| Anthropic "Building effective agents" | 2025 | Shared context documents | [anthropic.com](https://www.anthropic.com/research/building-effective-agents) |
| Addy Osmani | 2026 | LLM coding workflow | [medium.com](https://medium.com/@addyosmani/my-llm-coding-workflow-going-into-2026-52fe1681325e) |
