# 02 — MCP-serverin parhaat käytännöt (tuotanto)

> Pohjautuu pääosin The New Stackin "15 best practices" -artikkeliin [3RD], Nordic APIs -artikkeliin [3RD] ja viralliseen speciin [VIRALLINEN]. Tool-designin syvempi käsittely tiedostossa 03.

---

## Arkkitehtuuri ja rajaus

**1. Kohtele jokaista serveriä bounded contextina.** Mallinna server yhden domainin/mikropalvelun ympärille ja paljasta vain siihen kuuluvat kapabiliteetit. Pidä toolit koheesivisina ja uniikisti nimettyinä, selkein JSON-schema-syöttein ja -tuotoksin. [3RD: TNS #1, Nordic APIs]

**2. Älä kääri API:a 1:1.** Yleinen virhe: jokainen API-endpoint = uusi tool. Tämä paisuttaa serveriä, nostaa kustannuksia ja karkottaa käyttäjiä. Yhdessä Docker MCP Catalog -arviossa fokusoitu tool-valikoima paransi käyttöönottoa jopa 30 %. [3RD: MarkTechPost] — Ks. tarkemmin tiedosto 03.

**3. Stateless, idempotentti tool-design.** Agentit voivat uudelleenyrittää ja rinnakkaistaa kutsuja. Tee tool-kutsut idempotenteiksi, hyväksy client-generoidut request-ID:t, palauta deterministiset tulokset samoille syötteille. Käytä paginointi-tokeneita ja kursoreita listauksissa. Stateless-serverit skaalautuvat horisontaalisesti ja sopivat HTTP-semantiikkaan. [3RD: TNS #2, Nordic APIs]

---

## Transport ja elinkaari

**4. Valitse oikea transport ja toteuta peruutus.** STDIO maksimaaliseen yhteensopivuuteen (kehitys/testaus); Streamable HTTP verkotettuihin, skaalautuviin tuotantoservereihin. Toteuta request cancellation ja timeoutit, jotta pitkät kutsut eivät jätä resursseja roikkumaan. [3RD: TNS #3]

**10. Käsittele striimaus ja isot tuotokset vastuullisesti.** Streamable HTTP:llä lähetä inkrementaalisia paloja pitkille operaatioille. Isoille payloadeille palauta **handle/URI resurssiin** sen sijaan että upotat megatavuja yhteen tool-vastaukseen. [3RD: TNS #10]

---

## Tool-pinta ja vastaukset

**6. "Agentille JA ihmiselle" -UX rakenteisella sisällöllä.** Vastausten tulee olla sekä LLM-parsittavia että ihmisluettavia. Käytä `structuredContent` + `outputSchema` (uusi 2025-06) mallille, perinteiset content-blokit ihmiselle. Pidä virheilmoitukset toiminnallisina: koneluettava koodi + lyhyt selitys. [3RD: TNS #6; VIRALLINEN: 2025-06 changelog]

**9. Pidä promptit, toolit ja resurssit erillään.** Säilytä uudelleenkäytettävät promptit serverin puolella ja paljasta ne prompts-rajapinnan kautta — älä kovakoodaa pitkiä templaatteja tooleihin. Kohtele resursseja read-only-/vähän muuttuvina kontekstipintoina, joilla on eksplisiittiset URI:t, pääsysäännöt ja paginointi. [3RD: TNS #9]

---

## Versiointi ja yhteensopivuus

**8. Versioi pinta ja mainosta kapabiliteetit.** Käytä semanttista versiointia serverille ja yksittäisille tooleille rikkovissa muutoksissa. Julkaise handshaken yhteydessä tool-lista, resurssityypit ja valinnaiset ominaisuudet (elicitation, structured content), jotta clientit voivat sopeutua ohjelmallisesti. [3RD: TNS #8]

**Versioi contractit huolella.** Suosi additiivista muutosta, deprekoi vanhat kentät hallitusti, tarjoa yhteensopivuuskerroksia ettei clientit hajoa serverin kehittyessä. [3RD: Nordic APIs]

**13. Kunnioita alusta- ja ekosysteemirealiteetteja.** Kapabiliteetit vaihtelevat host-toteutuksittain. OAuth 2.1 ja structured content eivät ole kaikkialla. Tee feature-checkit ja graceful degradation. [3RD: TNS #13]

---

## Operointi ja testaus

**7. Instrumentoi kuin mikä tahansa tuotantomikropalvelu.** Strukturoidut lokit korrelaatio-ID:llä, tool-nimi + invokaatio-ID, latenssi, onnistuminen/epäonnistuminen, token-kustannusvihjeet. Tee pehmeät rajat ja rate limitit eksplisiittisiksi, jotta agentti voi budjetoida kutsuja. [3RD: TNS #7]

**11. Testaa oikeilla hosteilla ja vikainjektiolla.** Validoi useita clientejä/hosteja vastaan (myös vain-STDIO). Injektoi vikoja: hitaat downstreamit, osittaiset epäonnistumiset, vialliset syötteet. Käytä virallista **MCP Inspector** -työkalua löytääksesi discovery-, schema- ja virhepolut. Testaa sekä content-blokit että uusi structured content. [3RD: TNS #11]

**12. Paketoi ja toimita kuin mikropalvelu.** Containeroi serverit, deklaroi transport ja invokaatiokomennot selkeästi, julkaise minimaaliset runtime-imaget. README:hin tool-katalogi, schemat (myös output-schemat), esimerkit ja tietoturvanotaatiot. [3RD: TNS #12]

> **Paikalliset serverit:** Anthropic suosittaa paketointia **DXT (Desktop Extension)** -muotoon Claude Desktopia varten ja `.mcpb`-bundle-formaattia kannettaviin paikallisiin servereihin. [VIRALLINEN: Anthropic eng. -blogi, mainittu otsikkotasolla]

---

## API-fundamentit MCP-kerroksen alla

**14. MCP on vain adapteri.** Pidä taustalla oleva API puhtaana: vähimmän oikeuden operaatiot, selkeät resurssien elinkaaret, idempotentit mutaatiot. Domain-malli hyötyy klassisesta API-kurinalaisuudesta. [3RD: TNS #14]

---

## Mittaaminen ja "agentic experience" [3RD: Glama-blogi]

MCP-serverin tehokkuuden ydinmetriikka on **task completion rate** — kuinka usein client+malli saa käyttäjän tehtävän valmiiksi. Sitä on vaikea mitata suoraan tuotannossa kahdesta syystä:

1. **Rajallinen näkyvyys** — serverin kehittäjä näkee vain serverille tulevat pyynnöt, ei agentin koko keskustelua käyttäjän kanssa.
2. **Mallien ja clientien kirjavuus** — sama server käyttäytyy eri tavoin eri clientien ja mallien kanssa.

Glaman artikkeli nostaa kolme toiminnallista vipua: **tool-lista**, **tool-vastaukset** ja **notifikaatiot**. [3RD: Glama]

---

## [OMA TULKINTA] AIMEAT-spesifit huomiot

AIMEATissa on listauksen perusteella runsaasti tooleja (board, task, capability, memory, knowledge, organism, app, storage…). Tämä on juuri se tilanne, jossa:

- **Namespacing on jo olemassa** (`aimeat_*`) — hyvä. Harkitse kaksitasoista resurssinamespacingia jos tooleja on paljon (esim. `aimeat_board_post` vs `aimeat_task_create` — sinulla on jo tämä). 
- **Tool-määrä alkaa olla iso.** Tässä code-execution-malli (tiedosto 05) ja/tai `search_tools`-tyyppinen progressive disclosure voi olla iso parannus token-tehokkuuteen.
- **Tasks-capability** (2025-11-25) sopii AIMEATin pitkäkestoisiin work item / task -kulkuihin, jos haluat client-puolen pollauksen ja tulosten haun standardoidusti.
