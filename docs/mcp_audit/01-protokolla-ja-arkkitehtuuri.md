# 01 — MCP-protokolla ja arkkitehtuuri

> Lähdemerkinnät: [VIRALLINEN] = spec/Anthropic, [3RD] = nimetty artikkeli, [OMA TULKINTA] = synteesini.

---

## Mikä MCP on

MCP (Model Context Protocol) on avoin protokolla, joka standardoi miten LLM-sovellukset yhdistetään ulkoisiin datalähteisiin ja työkaluihin. Se käyttää **JSON-RPC 2.0** -viestejä. [VIRALLINEN: spec 2025-11-25]

Vertauskuva spesifikaatiossa: MCP ammentaa **Language Server Protocolista (LSP)**. Kuten LSP standardoi ohjelmointikielten tuen lisäämisen kehitystyökaluihin, MCP standardoi lisäkontekstin ja työkalujen tuomisen AI-sovelluksiin. [VIRALLINEN: spec]

Anthropic julkaisi MCP:n marraskuussa 2024. Joulukuussa 2025 Anthropic lahjoitti MCP:n Agentic AI Foundationille (Linux Foundationin alainen rahasto), jonka perustivat Anthropic, Block ja OpenAI. [VIRALLINEN: Wikipedia/MCP-blogi; HUOM: tämä on uutistason tieto, varmenna jos kriittinen]

---

## Arkkitehtuuri: kolme roolia

Protokolla määrittelee kommunikaation kolmen osapuolen välille: [VIRALLINEN: spec 2025-11-25]

- **Hosts** — LLM-sovellukset, jotka avaavat yhteyksiä (esim. Claude Desktop, IDE, oma agentti).
- **Clients** — konnektorit host-sovelluksen sisällä. Yksi client per server-yhteys.
- **Servers** — palvelut, jotka tarjoavat kontekstia ja kapabiliteetteja.

Yhteys on **tilallinen (stateful)** ja sisältää **capability-neuvottelun** clientin ja serverin välillä handshaken yhteydessä. [VIRALLINEN: spec]

### Mitä server tarjoaa clientille [VIRALLINEN: spec]
- **Resources** — kontekstia ja dataa käyttäjälle tai mallille (luettavaa, URI-pohjaista).
- **Prompts** — valmiita viesti-/työnkulkumalleja käyttäjälle.
- **Tools** — funktioita, joita malli voi suorittaa.

### Mitä client voi tarjota serverille [VIRALLINEN: spec]
- **Sampling** — serverin käynnistämä LLM-kutsu (agenttimainen, rekursiivinen).
- **Roots** — serverin kysely siitä, mihin URI-/tiedostorajoihin se saa operoida.
- **Elicitation** — serverin pyyntö lisätiedolle käyttäjältä.

### Lisäutiliteetit [VIRALLINEN: spec]
Konfiguraatio, edistymisseuranta (progress), peruutus (cancellation), virheraportointi, lokitus.

---

## Versiohistoria (tärkeimmät virstanpylväät)

| Versio | Pääsisältö |
|--------|-----------|
| 2024-11 (alkuperäinen) | MCP julkaistaan. STDIO + HTTP, JSON-RPC. [VIRALLINEN] |
| **2025-03-26** | Streamable HTTP -transport (korvasi vanhan HTTP+SSE:n). OAuth-pohjainen auth tulee mukaan. [VIRALLINEN/3RD: ByteBridge, TNS] |
| **2025-06-18** | Structured tool outputs (`outputSchema`, `structuredContent`), OAuth 2.1 -auktorisointi, elicitation, tietoturvan best practices -sivu. MCP-serverit luokitellaan OAuth Resource Servereiksi; clientien on toteutettava Resource Indicators (RFC 8707). [VIRALLINEN + 3RD: Auth0] |
| **2025-11-25** (uusin) | Tasks (pitkäkestoiset työnkulut), yksinkertaistettu auktorisointi (Client ID Metadata Documents), Extensions-mekanismi, URL-mode elicitation, sampling with tools, DX-parannukset. **Taaksepäin yhteensopiva.** [VIRALLINEN: 2025-11-25-release] |

---

## 2025-11-25 -spesifikaation uutuudet tarkemmin [VIRALLINEN: One Year of MCP -blogi]

**Tasks (kokeellinen capability).**
Uusi abstraktio pitkäkestoisen työn seurantaan. Mikä tahansa pyyntö voidaan liittää taskiin, jonka tilaa client voi kysellä ja jonka tulokset se voi hakea myöhemmin (serverin määräämän keston ajan). Tilat: `working`, `input_required`, `completed`, `failed`, `cancelled`.
Hyödyt: aktiivinen pollaus, tulosten haku jälkikäteen, session-pohjainen pääsynhallinta.
Käyttötapaukset: laskenta joka kestää minuutteja/tunteja, monivaiheiset automaatiot, deep research, multi-agent-järjestelmät.
> HUOM: kokeellinen — osa core-protokollaa muttei vielä lukittu. [VIRALLINEN]

**Yksinkertaistettu auktorisointi (Client ID Metadata Documents, SEP-991).**
Aiempi kipukohta oli Dynamic Client Registration (DCR). Nyt client voi antaa oman client ID:n URL:nä, joka osoittaa JSON-dokumenttiin clientin ominaisuuksista. Vähentää OAuth-proxyn rakentamisen tarvetta. [VIRALLINEN]

**Extensions (uusi mekanismi).**
Komponentteja ja konventioita core-spesifikaation ulkopuolella. Ominaisuudet: valinnaisia, additiivisia (eivät riko coren toimintaa), komponoituvia, itsenäisesti versioituja. Mahdollistaa kokeilun ennen kuin ominaisuus tulee osaksi specia. Esim. **MCP Apps Extension** ja **Authorization Extensions** (mm. OAuth client credentials M2M:lle, enterprise IdP -kontrollit / Cross App Access). [VIRALLINEN]

**URL Mode Elicitation (SEP-1036).**
Server voi lähettää käyttäjän selaimeen OAuth-/credential-flowiin, jolloin client ei koskaan näe käyttäjän tunnuksia. Mahdollistaa turvallisen credential-keräyksen, kolmannen osapuolen OAuthin ilman token passthroughia, ja PCI-yhteensopivat maksut. [VIRALLINEN]

**Sampling with Tools (SEP-1577).**
Serverit voivat ajaa omia agenttiluuppejaan clientin tokeneilla. Sampling tukee nyt tool callingia (aiemmin ei). `includeContext` pehmeästi deprekoitu eksplisiittisten capability-deklaraatioiden hyväksi. [VIRALLINEN]

**DX-parannukset.**
Standardoitu tool-nimien formaatti (SEP-986), request payload erotettu RPC-metodien määrittelystä (SEP-1319), SSE polling server-side disconnectin kautta (SEP-1699), parempi spec-versionhallinta SDK:ille (SEP-1309). [VIRALLINEN]

---

## Transportit

Kaksi päätransporttia: [VIRALLINEN: spec + 3RD: Nordic APIs, TNS]

- **STDIO** — perustaso; suositeltu kehitykseen ja testaukseen sekä paikallisiin servereihin. Maksimaalinen client-yhteensopivuus. Ajaa hostin oikeuksilla (tietoturvahuomio). [3RD: TNS, Practical DevSecOps]
- **Streamable HTTP** — ensiluokkainen transport etä- ja verkkokäyttöön, horisontaalisesti skaalautuviin tuotantoservereihin. Tukee inkrementaalisia tuloksia (server-sent event -tyylinen striimaus). Korvasi vanhan erillisen SSE-transportin 2025-06-18-versiossa. [VIRALLINEN + 3RD: TNS]

**[OMA TULKINTA]** AIMEAT on jo HTTP-pohjainen (aimeat.io/v1/mcp), joten Streamable HTTP on oikea valinta. STDIO kannattaa silti pitää mielessä paikalliseen kehitykseen/testaukseen Claude Desktopin tai Claude Coden kanssa (`claude mcp add`).

---

## SDK:t

Virallisia SDK:ita on mm. Python, TypeScript, C# ja Java. Anthropic ylläpitää avointa repoa referenssi-servereistä ja SDK:ista. [VIRALLINEN: Wikipedia/MCP]
TypeScript-SDK on luonteva AIMEATin Node 24/TS 5.9 -stackille. [OMA TULKINTA]

---

## Tietoturvaperiaatteet (spec itse korostaa)

Spesifikaatio listaa neljä avainperiaatetta, joita toteuttajien **tulee (SHOULD)** noudattaa — protokolla ei voi pakottaa näitä itse: [VIRALLINEN: spec]

1. **User Consent and Control** — käyttäjän on ymmärrettävä ja hyväksyttävä datankäyttö ja toiminnot.
2. **Data Privacy** — host hankkii eksplisiittisen suostumuksen ennen datan jakamista serverille.
3. **Tool Safety** — toolit ovat mielivaltaista koodinajoa; tool-kuvauksia/annotaatioita on pidettävä epäluotettavina ellei niitä saada luotetulta serveriltä. Host hankkii suostumuksen ennen toolin kutsua.
4. **LLM Sampling Controls** — käyttäjä hyväksyy sampling-pyynnöt ja kontrolloi mitä server näkee.

> Tärkeä yksityiskohta specistä suoraan: *"descriptions of tool behavior such as annotations should be considered untrusted, unless obtained from a trusted server."* Tämä on tool poisoning -hyökkäyksen ydin (ks. tiedosto 06). [VIRALLINEN: spec]
