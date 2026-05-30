# 06 — Tietoturva (MCP server & client)

> Lähteet: virallinen security best practices [VIRALLINEN], OWASP-pohjaiset tietoturva-artikkelit [3RD]. Tietoturva-väitteet kannattaa varmentaa virallisesta spec-sivusta, koska hyökkäysmallit kehittyvät nopeasti.

---

## Mittakaava: ongelma on todellinen

- 2025 Invariant Labs -auditointi: **43 % varhaisista MCP-servereistä** sisälsi command injection -haavoittuvuuksia. [3RD: Atlan, viittaa Invariant Labsiin]
- 2025 empiirinen tutkimus 1 899 avoimen lähdekoodin serveristä: **5,5 % osoitti tool poisoning -haavoittuvuuksia** (muokatut tool-kuvaukset, injektoituja vastauksia, datan ohjaus luvattomiin endpointteihin). [3RD: Tyk]

> [OMA TULKINTA] Nämä ovat kolmannen osapuolen lukuja, mutta linjassa keskenään: tietoturva on MCP:n suurin ja useimmin laiminlyöty osa-alue.

---

## Kuusi keskeistä hyökkäysmallia [3RD: Practical DevSecOps, OWASP MCP Top 10]

1. **Confused deputy** — proxy-server toimii *serverin* oikeuksilla *käyttäjän* sijaan. Agentti saa enemmän pääsyä kuin oli tarkoitus.
2. **Tool poisoning & rug pulls** — haitallinen server muuttaa tool-kuvauksen asennuksen jälkeen injektoidakseen prompteja. Kuvaukset ladataan suoraan mallin kontekstiin → injektiovektori.
3. **Token passthrough abuse** — server hyväksyy tokeneita joita ei myönnetty sille. Ohittaa audience-tarkistukset.
4. **Credential theft** — tunnukset ympäristömuuttujista tai lokeista.
5. **SSRF OAuth-metadatan discoveryssä** — URL:ien hyväksikäyttö protected resource metadatassa.
6. **Supply chain -hyökkäykset** — serverin tai sen riippuvuuksien kompromissointi (ajaa täysin hostin oikeuksilla).

Lisäksi: **prompt injection** (piiloutuvat ohjeet datassa jota AI käsittelee), **session hijacking** (heikot/ennustettavat session-ID:t), **excessive tool permissions** (liian laajat scopet → lateral movement). [3RD: Practical DevSecOps]

---

## Kolme trust boundaria [3RD: Christian Schneider, defense-first]

1. Käyttäjä ↔ AI-client.
2. Client ↔ MCP-serverit — **tässä tool-kuvaukset ylittävät rajan mallin kontekstiin.** Tool poisoning ja sampling injection hyökkäävät tähän. Cross-server-exfiltraatio hyödyntää sitä, että monta serveriä jakaa mallin kontekstin.
3. MCP-serverit ↔ downstream-palvelut (tietokannat, API:t, tiedostot). Confused deputy ja token passthrough hyökkäävät tähän.

---

## Mitä virallinen spec sanoo (kovat säännöt)

- **Token passthrough on EKSPLISIITTISESTI KIELLETTY** auktorisointispesifikaatiossa. Anti-pattern: server hyväksyy clientin tokenit validoimatta että ne myönnettiin tälle serverille ja välittää ne downstreamiin. Riskit: ohittaa rate limitit, request-validoinnin ja audience-pohjaiset kontrollit. [VIRALLINEN: security_best_practices]
- **Älä aseta consent-cookieta ennen suostumuksen hyväksyntää** — tekee consent-näytöstä tehottoman (hyökkääjä voi ohittaa sen). [VIRALLINEN]
- **Session Hijack Prompt Injection** on mahdollinen kun monta tilallista HTTP-serveriä käsittelee MCP-pyyntöjä jaetuilla session-ID:illä. [VIRALLINEN]

---

## Konkreettinen checklist (2026) [3RD: Practical DevSecOps, Tyk, Checkmarx]

**Autentikointi & auktorisointi**
- [ ] OAuth 2.1 + PKCE.
- [ ] Validoi token **audience** joka inbound-pyynnössä. Hylkää tokenit joita ei myönnetty serverille. **Ei token passthroughia.**
- [ ] Sido sessiot käyttäjäidentiteettiin.
- [ ] Downstream-pääsyyn: vaihda käyttäjän token uuteen, joka on skooppattu kyseiseen downstream-palveluun ja käyttäjäkontekstiin (ei "God tokenia", ei passthroughia). [3RD: Schneider]
- [ ] 2025-11-25: voit delegoida authin ulkoiselle IdP:lle (vähentää custom-koodia).

**Transport**
- [ ] TLS 1.3 kaikelle etä-MCP-liikenteelle.
- [ ] mTLS server-to-server-kutsuihin.
- [ ] DNS rebinding -suojaus paikalliselle HTTP-transportille.
- [ ] Muista: paikallinen STDIO ajaa hostin täysin oikeuksin — eri riskiprofiili.

**Tool-integriteetti & prompt injection**
- [ ] Kohtele tool-kuvauksia ja serverin metadataa **epäluotettavina** ellei serveri ole luotettu. [VIRALLINEN]
- [ ] Pinnaa server-versiot, tarkista allekirjoitukset, pidä rekisteri hyväksytyistä servereistä, estä muut host-tasolla. Ei poikkeuksia community-servereille. [3RD: Practical DevSecOps]
- [ ] Validoi ja sanitoi kaikki URL:t jotka LLM antaa tooleille.
- [ ] Pidä tiukka egress-domainien **allowlist** — pudota pyynnöt domaineihin joita ei ole hyväksytty. [3RD: Tyk]

**Input & oikeudet**
- [ ] Sanitoi kaikki syötteet (command injection -suoja).
- [ ] Vähimmän oikeuden periaate tool-funktioille (ei ylioikeuksia).
- [ ] Rate limiting.

**Monitorointi & governance**
- [ ] Logita jokainen tool-kutsu: käyttäjä, client, server, argumentit, downstream, tulos. Mahdollistaa jäljityksen tuliko toiminto käyttäjältä, mallilta vai injektiosta. [3RD: Checkmarx]
- [ ] Action-level-hyväksyntä herkille operaatioille (tiedostomuokkaus, ulkoiset API-kutsut).
- [ ] Älä koskaan kaiuta salaisuuksia tool-tuloksiin tai elicitation-viesteihin. [3RD: TNS #5]

**Code execution -spesifit (jos käytät tiedoston 05 mallia)**
- [ ] Sandbox agentin generoimalle koodille, resurssirajat, monitorointi. [VIRALLINEN]
- [ ] Harkitse PII-tokenisointia harnessissa. [VIRALLINEN]

---

## Remote MCP -kehittäjien kolme yleistä mokaa [3RD: Portia AI / dev.to]

1. **OAuth-redirectit toimivat vain localhostilla.** Hardkoodatut localhost-redirect-URI:t estävät testauksen staging/tuotannossa. → Salli useita redirect-URI:ita, tee konfiguroitavaksi per client.
2. **Puuttuva `.well-known` OAuth-metadata tai väärin konfiguroitu tool-discovery.** Spec nojaa `.well-known/oauth-authorization-server`-endpointin automaattiseen löytämiseen.
3. (Artikkelin kolmas kohta liittyi tool-discoveryyn/konfiguraatioon yleisemmin.)

---

## [OMA TULKINTA] AIMEAT-huomiot

- AIMEAT on julkinen ja MIT-lisensoitu → **supply chain** ja **tool poisoning** korostuvat: kuka tahansa voi forkata/muokata. Jos AIMEAT toimii host-/registry-roolissa muille agenteille, allowlist + version pinning + tool-kuvausten epäluotettavana kohtelu ovat kriittisiä.
- Jos AIMEATissa on GHII/morsel-/wallet-tooleja (rahaan rinnastuva), nämä ovat juuri niitä **action-level-hyväksyntää** vaativia operaatioita (vrt. TNS #15: "dry-run + diff ennen suoritusta").
- eIDAS/TOTP-maininnat memoryssä viittaavat että sinulla on jo vahva auth-pohja — varmista että **token audience -validointi** ja **ei-passthrough** ovat kohdallaan MCP-rajapinnassa.
