# 04 — MCP-clientin parhaat käytännöt

> Lähteet: virallinen spec [VIRALLINEN], tietoturva-artikkelit [3RD]. HUOM: virallinen materiaali on enemmän server- kuin client-painotteista; osa tästä on synteesiä [OMA TULKINTA].

---

## Clientin perusvastuut [VIRALLINEN: spec]

Client on host-sovelluksen sisäinen konnektori, joka:
- Avaa **tilallisen JSON-RPC-yhteyden** yhteen serveriin.
- Hoitaa **capability-neuvottelun** handshaken yhteydessä (kertoo mitä client tukee, lukee mitä server tarjoaa).
- Orkestroi viestiluupin: lataa tool-määrittelyt malliin, välittää tool-kutsut ja -tulokset.

Client voi tarjota serverille kolme ominaisuutta: **sampling**, **roots**, **elicitation** (ks. tiedosto 01). Näiden toteutus on valinnaista mutta laajentaa serverien mahdollisuuksia. [VIRALLINEN]

---

## Capability-neuvottelu ja graceful degradation

- **Mainosta vain ne kapabiliteetit, jotka oikeasti tuet.** Server mukauttaa käytöstään sen mukaan. [VIRALLINEN]
- Elicitation ja structured content eivät ole kaikissa clienteissä → serverin pitää gatettaa ne capability-checkillä. Symmetrisesti: client jonka pitäisi tukea näitä, ilmoittaa sen rehellisesti. [3RD: TNS #4, #13]
- **Tool-määrän raja:** osa clienteistä (esim. tietyt IDE-integraatiot) rajaa toolit esim. **128 tooliin**. Jos serverillä on enemmän, client voi joutua suodattamaan. [3RD: Azure DevOps MCP -troubleshooting]

---

## Token-/kontekstihallinta clientissä

Tämä on clientin suurin vaikutusmahdollisuus tehokkuuteen:

- **Useimmat clientit lataavat KAIKKI tool-määrittelyt etukäteen kontekstiin.** Tämä syö tokeneita ennen kuin yhtäkään pyyntöä luetaan. Satojen toolien tapauksessa satoja tuhansia tokeneita. [VIRALLINEN: Code execution -blogi]
- **Ratkaisut:**
  - **Progressive disclosure** — lataa tool-määrittelyt on-demand (esim. `search_tools`-tool, jolla on detail-level-parametri: pelkkä nimi / nimi+kuvaus / täysi schema). [VIRALLINEN]
  - **Code execution -malli** — esitä serverit koodi-API:na, anna mallin kirjoittaa koodia (ks. tiedosto 05). [VIRALLINEN]
- **Välitulokset kontekstissa:** kun client antaa mallin kutsua tooleja suoraan, jokainen välitulos kulkee mallin läpi. Ketjutetut kutsut moninkertaistavat token-kulutuksen ja virhemahdollisuudet. [VIRALLINEN]

---

## Auktorisointi (client-puoli) [VIRALLINEN + 3RD]

- **Resource Indicators (RFC 8707):** 2025-06-18-spec vaatii clientien toteuttavan nämä, jotta haitalliset serverit eivät saa access-tokeneita jotka oli tarkoitettu muille. [3RD: Auth0; VIRALLINEN: spec]
- **PKCE** on kriittinen erityisesti paikallisille desktop-clienteille (IDE-pluginit). Estää authorization coden sieppauksen OAuth-redirectissä. [3RD: Tyk, Practical DevSecOps]
- **Client ID Metadata Documents (2025-11-25):** client voi antaa client ID:n URL:nä, joka osoittaa JSON-dokumenttiin. Vähentää DCR:n / OAuth-proxyn tarvetta. [VIRALLINEN]
- **Älä käytä session ID:itä autentikointiin.** Generoi ennustamattomat session-tunnisteet. [3RD: TNS #5; VIRALLINEN: security best practices]

---

## Suostumus ja human-in-the-loop [VIRALLINEN: spec security]

Client/host **vastaa** consent-flowsta — protokolla ei pakota:
- Käyttäjän on hyväksyttävä tool-kutsut, etenkin tilaa muuttavat tai rahaa kuluttavat.
- Sampling-pyynnöt: käyttäjä hyväksyy ja kontrolloi mitä server näkee promptista.
- Tarjoa selkeä UI toimintojen arvioimiseen ja valtuuttamiseen.

---

## Tietoturva clientin näkökulmasta

- **Kohtele tool-kuvauksia epäluotettavina** ellei serveri ole luotettu — ne ladataan suoraan mallin kontekstiin ja ovat prompt injection -vektori (tool poisoning). [VIRALLINEN: spec; 3RD: useat]
- **Pidä rekisteri hyväksytyistä servereistä** ja estä muut host-tasolla. Pinnaa versiot, tarkista allekirjoitukset. [3RD: Practical DevSecOps]
- **DNS rebinding -suojaus** paikalliselle HTTP-transportille. [3RD: Practical DevSecOps]

---

## [OMA TULKINTA] Jos rakennat omaa clientiä / agenttia AIMEATille

Tärkeysjärjestys token-tehokkuuden kannalta:
1. **Älä lataa kaikkia AIMEATin tooleja etukäteen** jos niitä on kymmeniä. Toteuta hakupohjainen tool-discovery tai code-execution-malli.
2. **Validoi token audience** joka pyynnössä jos käytät OAuthia AIMEATia vastaan.
3. **Gateta uudet ominaisuudet** (tasks, elicitation) capability-checkeillä, koska eri mallit/versiot tukevat niitä eri tavoin.
4. Käytä virallista **TypeScript-SDK:ta** (sopii Node 24 -stackiisi) clientin pohjaksi sen sijaan että toteuttaisit JSON-RPC:n käsin.
