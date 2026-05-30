# 03 — Tool-design: Anthropicin kanoninen ohjeistus

> Lähde: Anthropic Engineering, "Writing effective tools for agents — with agents" (11.9.2025). [VIRALLINEN]
> Tämä on tärkein yksittäinen tiedosto "fiksummat komennot" -tavoitteelle.

---

## Lähtökohta: tool ≠ funktio

Perinteinen ohjelmisto on sopimus determinististen järjestelmien välillä: `getWeather("NYC")` palauttaa aina samalla tavalla. **Tool on sopimus deterministisen järjestelmän ja ei-deterministisen agentin välillä.** Sama kysymys voi johtaa eri toimintaan: agentti voi kutsua toolia, vastata yleistiedosta tai kysyä tarkennusta. Joskus se hallusinoi tai ei ymmärrä toolia. [VIRALLINEN]

> Ydinajatus: **älä kirjoita tooleja kuten funktioita/API:a toisille kehittäjille — suunnittele ne agentille.** [VIRALLINEN]

---

## Työtapa: prototyyppi → eval → yhteistyö

**1. Rakenna prototyyppi.**
On vaikea ennustaa mitkä toolit ovat agentille "ergonomisia" ilman käytännön kokeilua. Kääri toolit paikalliseen MCP-serveriin tai DXT-laajennukseen ja testaa Claude Codessa / Claude Desktopissa. Anna Claudelle dokumentaatio kirjastoista/API:sta/SDK:ista (usein `llms.txt`-tiedostoina). Liitä paikallinen server Claude Codeen: `claude mcp add <name> <command> [args...]`. [VIRALLINEN]

**2. Aja evaluaatio.**
Generoi paljon eval-tehtäviä oikeasta maailmasta. Vältä yksinkertaisia "sandbox"-ympäristöjä. Vahva tehtävä voi vaatia montakin tool-kutsua.

- *Vahva tehtävä:* "Ajoita palaveri Janen kanssa ensi viikolla Acme-projektista. Liitä muistiinpanot viime palaverista ja varaa neuvotteluhuone."
- *Heikko tehtävä:* "Ajoita palaveri jane@acme.corp kanssa ensi viikolla."

Pariuta jokainen prompt verifioitavaan vastaukseen. Verifier voi olla string-vertailu tai Claude tuomarina. Vältä liian tiukkoja verifiereitä, jotka hylkäävät oikeat vastaukset muotoiluerojen takia. [VIRALLINEN]

Aja eval ohjelmallisesti suorilla API-kutsuilla: yksinkertainen agentic loop (while-luuppi joka vuorottelee LLM-kutsua ja tool-kutsua) per tehtävä. Pyydä agenttia tulostamaan myös reasoning- ja feedback-blokit ennen tool-kutsuja (laukaisee chain-of-thoughtin). Claudella voi käyttää interleaved thinkingiä. [VIRALLINEN]

Kerää myös: tool-kutsujen kokonaisaika, tool-kutsujen määrä, token-kulutus, tool-virheet. Paljon redundantteja kutsuja → paginointi/token-rajat väärin. Paljon virheitä → kuvaukset/esimerkit epäselviä. [VIRALLINEN]

**3. Tee yhteistyötä agentin kanssa.**
Liitä eval-transkriptit Claude Codeen. Claude on hyvä analysoimaan transkripteja ja refaktoroimaan monta toolia kerralla pitäen toteutukset ja kuvaukset yhtenäisinä. Käytä held-out-testijoukkoa ettet ylisovita. Anthropic sai parannuksia jopa "asiantuntijan" kirjoittamien toolien yli. [VIRALLINEN]

> Konkreettinen esimerkki: web search -toolissa Claude lisäili turhaan `2025` query-parametriin, mikä vinoutti hakua. Korjaus tehtiin **parantamalla tool-kuvausta.** [VIRALLINEN]

---

## Viisi periaatetta

### 1. Valitse oikeat toolit (ja jätä väärät tekemättä)

Enemmän tooleja ≠ parempi. Yleinen virhe: toolit jotka vain käärivät olemassa olevan API-endpointin. Agentilla on rajallinen konteksti (toisin kuin halvalla muistilla). [VIRALLINEN]

Esimerkki: osoitekirjasta haku. Jos tool palauttaa KAIKKI kontaktit ja agentti lukee jokaisen token kerrallaan, se haaskaa kontekstia (brute-force, kuin lukisit osoitekirjan sivu sivulta). Parempi: `search_contacts` tai `message_contact` eikä `list_contacts`. [VIRALLINEN]

**Konsolidoi toolit kattamaan monta operaatiota:** [VIRALLINEN]
- `list_users` + `list_events` + `create_event` → **`schedule_event`** (etsii vapaan ajan JA varaa).
- `read_logs` → **`search_logs`** (palauttaa vain relevantit rivit + konteksti).
- `get_customer_by_id` + `list_transactions` + `list_notes` → **`get_customer_context`** (kokoaa kaiken relevantin kerralla).

> Jokaisella toolilla selkeä, erottuva tarkoitus. Liian monta tai päällekkäistä toolia hämää agenttia. [VIRALLINEN]

### 2. Namespace toolit

Agentilla voi olla pääsy kymmeniin servereihin ja satoihin tooleihin. Päällekkäiset/epämääräiset toolit sekoittavat. **Namespacing** (ryhmittely yhteisillä prefikseillä) auttaa: [VIRALLINEN]
- palvelukohtainen: `asana_search`, `jira_search`
- resurssikohtainen: `asana_projects_search`, `asana_users_search`

Prefiksi- vs. suffiksi-namespacingilla on ei-triviaali vaikutus eval-tuloksiin, ja vaikutus vaihtelee LLM:ittäin → valitse omien evaluaatioiden perusteella. [VIRALLINEN]

> Hyöty: vähemmän tooleja/kuvauksia kontekstissa JA agenttilaskenta siirtyy agentin kontekstista itse tool-kutsuihin → vähemmän virheitä. [VIRALLINEN]

### 3. Palauta merkityksellistä kontekstia

Palauta vain korkean signaalin tieto. Vältä matalan tason teknisiä tunnisteita (`uuid`, `256px_image_url`, `mime_type`). Kentät kuten `name`, `image_url`, `file_type` ohjaavat agentin toimintaa paremmin. [VIRALLINEN]

Agentit pärjäävät luonnollisen kielen nimillä paljon paremmin kuin kryptisillä tunnisteilla. Pelkkä mielivaltaisten UUID:iden korvaaminen merkityksellisellä kielellä (tai 0-indeksoidulla ID-skeemalla) paransi Clauden tarkkuutta hakutehtävissä merkittävästi (vähemmän hallusinaatioita). [VIRALLINEN]

Joskus agentti tarvitsee sekä luonnollisen kielen että tekniset tunnisteet (esim. `search_user(name='jane')` → `send_message(id=12345)`). Tarjoa **`response_format`-enum** (concise/detailed): [VIRALLINEN]

```
enum ResponseFormat {
   DETAILED = "detailed",
   CONCISE = "concise"
}
```

Anthropicin esimerkissä Slack-tooleilla "concise" käytti ~⅓ tokeneista verrattuna "detailed"-vastaukseen. [VIRALLINEN]

**Vastauksen rakenne (XML/JSON/Markdown) vaikuttaa eval-tuloksiin.** Ei yhtä oikeaa — LLM:t pärjäävät paremmin formaateilla, jotka muistuttavat niiden koulutusdataa. Valitse omien evaluaatioiden perusteella. [VIRALLINEN]

### 4. Optimoi token-tehokkuus

Optimoi sekä **laatu** että **määrä** palautetusta kontekstista. Toteuta paginointi, range-valinta, suodatus ja/tai truncation järkevin oletusarvoin kaikille tooleille jotka voivat tuottaa paljon kontekstia. **Claude Code rajaa tool-vastaukset oletuksena 25 000 tokeniin.** [VIRALLINEN]

Jos truncaat, ohjaa agenttia: kannusta token-tehokkaisiin strategioihin (monta pientä kohdennettua hakua yhden leveän sijaan). [VIRALLINEN]

**Virhevastaukset:** Tee niistä toiminnallisia. Esim. input-validointivirheessä kerro selkeästi ja konkreettisesti mitä korjata — ei läpinäkymättömiä virhekoodeja tai tracebackeja. [VIRALLINEN]

### 5. Prompt-engineeraa tool-kuvaukset

Yksi tehokkaimmista keinoista. Kuvaukset ladataan agentin kontekstiin ja ohjaavat sen käytöstä. [VIRALLINEN]

> **Kirjoita kuvaus kuin uudelle tiimiläiselle.** Tee eksplisiittiseksi se konteksti jonka itse tuot implisiittisesti: erikoisformaatit, niche-termien määritelmät, resurssien väliset suhteet. [VIRALLINEN]

- Vältä monitulkintaisuutta. Pakota tiukoilla datamalleilla.
- Nimeä parametrit yksiselitteisesti: `user` → `user_id`. [VIRALLINEN]
- Pienetkin tarkennukset voivat tuottaa isoja parannuksia. (Claude Sonnet 3.5 saavutti SOTA-tuloksen SWE-bench Verifiedissä tool-kuvausten täsmäparannusten jälkeen.) [VIRALLINEN]

**Tool annotations:** Jos kirjoitat tooleja MCP-serverille, käytä tool-annotaatioita kertomaan mitkä toolit vaativat open-world-pääsyä tai tekevät tuhoavia muutoksia. [VIRALLINEN: spec 2025-06 server/tools]

---

## [OMA TULKINTA] Käytännön korjaussykli AIMEATin tooleille

1. **Inventoi** nykyiset toolit ja luokittele: onko tämä ohut API-kääre vai workflow-tool? Ohuet kandidaatteja konsolidointiin.
2. **Etsi konsolidointimahdollisuudet:** mitkä toolit kutsutaan usein peräkkäin? (Anthropicin malli: yhdistä `schedule_event`-tyyliin.)
3. **Tarkista palautusarvot:** karsi UUID:t ja tekninen kohina; lisää `response_format` raskaisiin tooleihin.
4. **Lisää token-rajat + paginointi** listaaville tooleille.
5. **Kirjoita kuvaukset uudelleen** "uudelle tiimiläiselle" -periaatteella; nimeä parametrit `*_id`-tyyliin.
6. **Rakenna eval** muutaman realistisen AIMEAT-tehtävän ympärille ja anna Claude Coden analysoida transkriptit.
