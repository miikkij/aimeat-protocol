# 07 — Yleiset virheet & korjaus-checklist olemassa oleville tooleille

> Lähteet: oikeat kehittäjäkokemukset (dev.to, GitLab, Glama, Sentry) [3RD] + Anthropicin periaatteet [VIRALLINEN]. Tämä tiedosto on suunniteltu juuri sinun käyttötapaukseesi: nykyisten MCP-komentojen korjaaminen.

---

## A. Hiljaiset epäonnistumiset — vaarallisin luokka [3RD: dev.to / Divyanshu Shekhar]

MCP-serverit harvoin kaatuvat. Ne epäonnistuvat **loogisesti, eivät teknisesti.** Mikään ei heitä poikkeusta — silti:

- Tool on kutsuttavissa mutta käyttökelvoton.
- Schema on teknisesti validi mutta semanttisesti väärä.
- Vaadittu esiehto ei koskaan täyty.
- Downstream-tool ei saa dataa jonka olettaa olevan olemassa.

**Oireet joista tunnistat tämän:** tietyt toolit ovat tuskin käytössä, argumentit näyttävät "melkein oikeilta", agentti uudelleenyrittää/uudelleenmuotoilee tai kiertää puuttuvan toiminnon hiljaa. Järjestelmä tuottaa silti outputin → näyttää onnistumiselta. [3RD]

**Juurisyyt:** [3RD]
1. **Tool-contractit eivät ole pakotettuja.** Kentät jotka ovat oikeasti pakollisia on merkitty optional. Kuvaukset koodaavat käytöstä jota schema ei pakota. Rikkovia muutoksia livahtaa ilman versiointia. Oletukset ovat kommenteissa, ei tarkistuksissa.
2. **Piilotetut riippuvuusketjut.** Yksi tool valmistelee syötteen toiselle. Toinen olettaa että edellinen on ajettu. Ei eksplisiittistä riippuvuusgraafia → järjestysherkkä käytös, osittaiset suorituspolut, agentti hallusinoi "liimalogiikkaa".
3. **Prompt-pohjainen testaus ei paljasta näitä.** "Kokeillaan muutama prompti" on otantaa, ei testausta. LLM tasoittaa rakenteelliset ongelmat piiloon retry/self-correction -mekanismeilla.

**Korjausperiaatteet:** [3RD]
- Kohtele tool-schemoja oikeina contracteina, ei dokumentaationa.
- Oleta että prompt-testaus ohittaa rakenteelliset viat.
- Tee tool-riippuvuudet eksplisiittisiksi (vaikka vain käsitteellisesti).
- Pyri paljastamaan viat **ennen** kuin LLM on mukana, ei sen jälkeen.

---

## B. 1:1 API-mappaus — yleisin designvirhe [3RD: GitLab, MarkTechPost; VIRALLINEN: Anthropic]

GitLabin oma MCP-tiimi dokumentoi tämän: kaikki toolit määriteltynä 1:1 API-endpointtia kohden toimii nopeaan toimitukseen, mutta: [3RD: GitLab issue 569206]
- Jokainen tool tarvitsee API-endpointin → ei tooleja jotka yhdistävät monta kutsua.
- Ei tueta tooleja joilla on vain GraphQL-endpoint.
- Ei voi yhdistää useaa API-kutsua yhdeksi koherentiksi tooliksi (esim. `gitlab_search` joka kattaisi monta lähdettä).

→ Korjaus = Anthropicin periaate 1: konsolidoi workflow-tooleiksi (ks. tiedosto 03).

---

## C. Liikaa tooleja [VIRALLINEN: Anthropic; 3RD: Azure DevOps]

- Päällekkäiset/epämääräiset toolit hämäävät agenttia. [VIRALLINEN]
- Tekninen raja: osa clienteistä rajaa **128 tooliin.** [3RD: Azure DevOps MCP]
- Fokusoitu valikoima paransi käyttöönottoa jopa 30 %. [3RD: MarkTechPost]

---

## D. Heikko observability [3RD: Sentry, Glama]

Serverin kehittäjä näkee vain serverille tulevat pyynnöt, ei agentin koko keskustelua. [3RD: Glama] Sentryn oma MCP-server ylitti 30 M pyyntöä/kk pian julkaisun jälkeen, ja he tarvitsivat näkyvyyttä: mitkä toolit kutsutaan eniten, mitkä ovat hitaita/epäonnistuvat, mitkä syötteet rikkovat. [3RD: Sentry]

→ Instrumentoi: tool-nimi, invokaatio-ID, latenssi, onnistuminen, syötteet (sanitoituna). [VIRALLINEN: TNS #7]

---

## KORJAUS-CHECKLIST: käy nykyiset toolit läpi tällä

Jokaiselle nykyiselle MCP-komennolle/toolille:

**1. Tarkoitus & rajaus**
- [ ] Onko tällä toolilla selkeä, erottuva tarkoitus? Vai onko se päällekkäinen toisen kanssa?
- [ ] Onko tämä ohut API-kääre? → harkitse yhdistämistä workflow-tooliin.
- [ ] Kuuluuko tämä tämän serverin bounded contextiin?

**2. Nimi & namespace**
- [ ] Onko nimi namespacetattu (`aimeat_<resurssi>_<toiminto>`)?
- [ ] Onko nimi yksiselitteinen agentille?
- [ ] Noudattaako se 2025-11-25 standardoitua tool-nimien formaattia (SEP-986)? [VIRALLINEN]

**3. Parametrit (schema)**
- [ ] Ovatko parametrit nimetty yksiselitteisesti (`user_id` ei `user`)? [VIRALLINEN]
- [ ] Onko pakolliset kentät merkitty pakollisiksi (ei optional-driftiä)? [3RD]
- [ ] Käytetäänkö enumeja kun mahdollista? [3RD: TNS #1]
- [ ] Onko schema semanttisesti oikein, ei vain teknisesti validi? [3RD]

**4. Palautusarvo**
- [ ] Palautetaanko vain korkean signaalin tieto (ei UUID-kohinaa)? [VIRALLINEN]
- [ ] Onko ihmisluettavat kentät (name, file_type) mukana teknisten sijaan? [VIRALLINEN]
- [ ] Tarvitseeko tämä `response_format`-enumin (concise/detailed)? [VIRALLINEN]
- [ ] Onko `structuredContent` + `outputSchema` käytössä (2025-06)? [VIRALLINEN]
- [ ] Onko token-raja / paginointi / suodatus raskaille vastauksille? (vrt. Claude Code 25k) [VIRALLINEN]

**5. Kuvaus (prompt engineering)**
- [ ] Onko kuvaus kirjoitettu "uudelle tiimiläiselle"? [VIRALLINEN]
- [ ] Onko implisiittinen konteksti tehty eksplisiittiseksi (formaatit, termit, suhteet)? [VIRALLINEN]
- [ ] Kerrotaanko milloin tätä toolia käytetään ja milloin ei? [3RD: Agentailor]

**6. Virheet**
- [ ] Ovatko virhevastaukset toiminnallisia (koodi + selitys + mitä korjata)? [VIRALLINEN]
- [ ] Ei läpinäkymättömiä tracebackeja agentille? [VIRALLINEN]

**7. Riippuvuudet & idempotenssi**
- [ ] Onko tool idempotentti (turvallinen uudelleenyrittää)? [3RD: TNS #2]
- [ ] Onko piilotettuja riippuvuuksia toisiin tooleihin? Dokumentoi ne. [3RD]
- [ ] Onko esiehdot eksplisiittisesti tarkistettu, ei oletettu? [3RD]

**8. Tuhoavat / herkät toiminnot**
- [ ] Onko tool-annotaatiot (destructive / open-world) asetettu? [VIRALLINEN]
- [ ] Vaatiiko tilaa muuttava / rahaa kuluttava toiminto vahvistuksen tai dry-run + diffin? [3RD: TNS #15]

**9. Tietoturva**
- [ ] Sanitoidaanko syötteet? Validoidaanko URL:t? (ks. tiedosto 06)
- [ ] Ei salaisuuksia tool-vastauksiin? [3RD: TNS #5]

**10. Testaus & mittaus**
- [ ] Onko olemassa eval (ei vain "kokeile muutama prompti")? [VIRALLINEN + 3RD]
- [ ] Instrumentoidaanko tool-kutsut (nimi, latenssi, virheet)? [3RD: Sentry, TNS #7]
- [ ] Testattu useaa clientiä vastaan + vikainjektio? [3RD: TNS #11]

---

## Suositeltu korjausjärjestys [OMA TULKINTA]

1. **Inventoi & mittaa ensin.** Lisää instrumentointi → näe mitkä toolit ovat käytössä, mitkä hiljaa epäonnistuvat. Älä arvaa.
2. **Korjaa kuvaukset ja parametrinimet.** Halvin, suurin vaikutus (Anthropicin SWE-bench-esimerkki). Ei vaadi arkkitehtuurimuutoksia.
3. **Karsi palautusarvot + lisää token-rajat.** Token-säästö heti.
4. **Konsolidoi ohuet toolit workflow-tooleiksi.** Vähentää tool-määrää ja sekaannusta.
5. **Rakenna eval** ja anna Claude Coden refaktoroida loput transkriptien pohjalta. [VIRALLINEN: tämä on Anthropicin oma työtapa]
6. **Jos tool-määrä on iso:** harkitse code-execution-mallia (tiedosto 05) tai `search_tools`-progressive disclosurea.
7. **Tietoturva-checklist** (tiedosto 06) erityisesti rahaan/dataan koskeville tooleille.

---

## Virallinen työkalu

**MCP Inspector** — Anthropicin/yhteisön työkalu serverin discoveryn, schema-validoinnin ja virhepolkujen testaamiseen. Käytä tätä ennen tuotantoa. [VIRALLINEN: TNS #11 viittaa; työkalu mainittu One Year of MCP -blogissa]

GitHub: https://github.com/modelcontextprotocol/inspector
