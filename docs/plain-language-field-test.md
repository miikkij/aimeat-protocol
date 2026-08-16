# Kenttätesti: puhuuko järjestelmä ihmiselle

Kerros 1 oli mitattavaa: 706 viestiä, jotka ihminen kuulee, gate joka estää uudet, velkarekisteri
683:sta yhdeksään. Kone mittasi sanat. Se ei osaa mitata, ymmärsikö kukaan.

Tämä on kerros 2. Yksi ihminen, uusi tili, useampi chat, sama kohtausjärjestys joka kerta. Tulos ei
ole mielipide vaan täytetty taulukko, jota vasten seuraava korjauskierros valitaan.

## Ennen kuin aloitat

- **Uusi sähköposti ja uusi tili.** Vanha tili tietää liikaa: siinä on jo agentteja, appeja ja
  organismeja, ja puolet ensikohtaamisen ongelmista ei näy.
- **Uusi selainprofiili tai incognito.** Kirjautunut sessio ohittaa juuri sen näytön, joka on testin
  kohde.
- **Neljä chattia auki**, tässä järjestyksessä, koska ne edustavat kahta eri tietä sisään:
  - **Claude Desktop tai Claude Code** (MCP: agentti tekee itse)
  - **Grok** (ei MCP: prompt-driven, sinä kopioit)
  - **ChatGPT ilmaisversio** (ei MCP)
  - **Gemini-appi puhelimessa** (ei MCP, pieni ruutu, eri tunnelma)
- **Kirjoita suomeksi.** Se on se kieli, jolla oikea käyttäjä kirjoittaa, ja se paljastaa myös sen
  mitä käännös ei kanna.

Älä auta järjestelmää. Jos et tiedä mitä tehdä, se on tulos, ei este. Merkitse se ja jatka.

## Miten kohtaus pisteytetään

Jokaisen kohtauksen jälkeen, ennen seuraavaa, vastaa kahteen kysymykseen ääneen:

1. **Mitä juuri tapahtui?**
2. **Mitä minun pitää tehdä seuraavaksi?**

**Läpäisyehto: molempiin vastaus yhdellä lauseella, ilman yhtään sanaa jonka opit meiltä.** Jos
lauseessa on scope, organismi, workspace, morsel, GAII, token, gate tai vastaava, kohtaus ei mene
läpi, vaikka tekisit oikean asian. Osaaminen ei ole sama kuin ymmärtäminen.

Pisteet, yksi numero per kohtaus:

| | |
|---|---|
| **5** | Vastasin molempiin heti, en pysähtynyt kertaakaan. |
| **4** | Vastasin, mutta jouduin lukemaan jotain kahdesti. |
| **3** | Sain sen selville, mutta arvasin osan. |
| **2** | Jouduin katsomaan muualta (dokumentti, koodi, toinen näyttö). |
| **1** | En saanut selville. Tein jotain sattumanvaraista. |

Ja yksi kysymys erikseen, koska se on koko työn syy:

**Ä: olisiko äitini pärjännyt tässä kohtauksessa?** kyllä / ei / ei olisi edes yrittänyt.

Kirjaa lisäksi **suora sitaatti** jokaisesta lauseesta, joka sai sinut pysähtymään. Se sitaatti on
korjattava rivi. Ilman sitaattia löydöstä ei voi korjata.

## Kohtaukset

Aja ne tässä järjestyksessä. Järjestys on osa testiä: myöhempi kohtaus olettaa, että aiempi opetti
jotain, ja jos ei opettanut, se näkyy tässä.

### 1. Kylmä ensikohtaaminen (ei chattia, pelkkä selain)

Mene `https://aimeat.io` kirjautumattomana. Katso sitä 30 sekuntia. Älä klikkaa vielä.

Kirjaa: **mitä luulet että tämä on ja kenelle**, omin sanoin, ennen kuin klikkaat mitään. Sitten
klikkaa mitä ensimmäisenä tekisi mieli.

Mitä tässä mitataan: myykö etusivu sen mitä ihminen saa vai sen miten se on rakennettu.

### 2. Tilin luonti

Luo tili uudella sähköpostilla. Käy koko putki loppuun: vahvistus, ensimmäinen sisäänkirjautuminen,
se näkymä joka avautuu heti sen jälkeen.

Erityisesti: **se ensimmäinen ruutu kirjautumisen jälkeen.** Tiedätkö mitä sinun pitäisi tehdä
seuraavaksi, vai onko se lista asioita joita et ole vielä pyytänyt?

### 3. Ensimmäinen agentti kiinni (Claude, MCP-tie)

Liitä Claude tähän tiliin. Ota reitti, jonka tuote itse tarjoaa; älä käytä mitään mitä tiedät
kehittäjänä.

Kirjaa erikseen: **se hetki, jossa sinulta kysytään mitä agentti saa tehdä.** Ymmärsitkö mitä
myönnät? Olisitko osannut myöntää vähemmän jos olisit halunnut? Tämä on koko tuotteen omistajuuslupaus
yhdessä ruudussa, ja se joko pitää tai ei pidä.

### 4. Ensimmäinen oikea työ chatissa

Claudessa, tuoreessa keskustelussa, kirjoita täsmälleen tämä:

> Tallenna tänne muistiin, että minulla on koira nimeltä Rölli ja se syö kanaa, ei kalaa.

Sitten uudessa keskustelussa, jotta konteksti ei kanna:

> Mitä koirani syö?

Mitä tässä mitataan: kertooko agentti mitä sinä sait, vai mitä se teki. "Kirjoitin muistiavaimeen
pets.dog ja luin sen takaisin" on väärä vastaus, vaikka lopputulos olisi oikea.

### 5. Sama asia ilman MCP:tä (Grok)

Sama tehtävä kuin kohtauksessa 4, mutta Grokissa, joka ei ylety tänne. Hae tuotteesta se valmis
promptikulku, kopioi se Grokiin, tuo tulos takaisin.

Erityisesti kirjattava: **tiesitkö missä vaiheessa olit menossa?** Prompt-tie on pisin ja siinä on
eniten kohtia, joissa ihminen jää tyhjän päälle sen kanssa mitä juuri liimasi mihin.

### 6. Kielto, jonka ansaitset

Yritä tehdä jotain, mitä uusi tili ei saa tehdä. Helpoin: pyydä Claudea lukemaan jonkun toisen
ihmisen tiedot, tai avaa appi, joka vaatii pääsykoodin, jota sinulla ei ole.

Läpäisyehto tässä on tiukempi kuin muualla: **tunnetko itsesi tyhmäksi vai autetuksi?** Kiellon
kuuluu kertoa mitä nyt tapahtui, ettei se ollut sinun vikasi, ja mihin mennä seuraavaksi. Kirjaa
sanatarkasti mitä sait.

### 7. Raha

Katso mitä sinulla on saldona ja mitä sillä saa. Sitten mene johonkin, joka maksaa, aina siihen
hetkeen asti, jossa oikeasti veloitettaisiin. **Älä maksa.** Peruuta siinä.

Mitä mitataan: tiedätkö koko ajan mitä olet maksamassa, kenelle ja mitä saat. Ja tiedätkö, missä
kohtaa pystyt vielä perumaan.

### 8. Appi, jonka pyydät tehtäväksi

Claudessa, tuoreessa keskustelussa:

> Tekisitkö mulle tänne sivun, johon voin kirjata treenit ja nähdä ne kalenterissa.

Tämä on se kohta, jossa agentti lukee `node:aimeat-app-builder`-ohjeen ja **ehdottaa sinulle mitä se
aikoo rakentaa**. Se ehdotus on juuri se, mikä muuttui version 1.0.2 myötä.

Läpäisyehto: **pystyitkö vastaamaan "joo, tee tuo" tietämättä yhtään AIMEAT-sanaa?** Jos ehdotuksessa
lukee tier, pack tai scope, se on epäonnistuminen riippumatta siitä, kuinka hyvä appi tuli.

Kirjaa ehdotus sanatarkasti. Se on lyhyt, ja se on tämän kierroksen tärkein yksittäinen sitaatti.

### 9. Kun jokin menee rikki

Tähän ei tarvitse lavastaa mitään, jos jokin on jo mennyt vikaan aiemmissa kohtauksissa: käytä sitä.
Jos ei ole, pyydä Claudea tekemään jotain, mitä täällä ei ole, esimerkiksi:

> Vie mun kalenteri tänne ja pidä se ajan tasalla.

Kaksi asiaa kirjattavaksi:

1. **Pysähtyykö agentti vai etsiikö se ratkaisun?** Ohjeen mukaan sen pitäisi kertoa mitä se tekee
   asialle, ei mitä ei voinut tehdä.
2. **Kertooko se sinulle, että se ilmoitti tästä eteenpäin?** Jos vika on meidän, siitä lähtee
   raportti operaattoreille automaattisesti, ja sinulle kuuluu sanoa että tämä ei ollut sinun
   vikasi, sitä korjataan, ja kiitos että löysit sen. Jos et saanut tuota, se on löydös.

### 10. Puhelin

Ota Gemini-appi tai selain puhelimessa, ja tee kohtaus 4 uudestaan siellä. Pieni ruutu ei ole eri
tuote, mutta se on eri tunnelma, ja pitkä kehittäjälause näyttää siellä eri tavalla pahalta.

### 11. Lähtö

Kysy Claudelta:

> Mitä täällä on musta tallessa ja miten saan sen pois?

Omistajuus on koko tuotteen lupaus. Jos siihen ei saa yhtä selvää vastausta, lupaus ei pidä. Tähän
riittää vastauksen lukeminen, tilin poistoa ei tarvitse tehdä.

## Tuloslomake

Yksi rivi per kohtaus. Kopioi tämä ja täytä ajaessasi.

| # | Kohtaus | Chat | Mitä tapahtui (1 lause) | Mitä seuraavaksi (1 lause) | Pisteet | Ä | Sitaatti joka pysäytti |
|---|---------|------|--------------------------|-----------------------------|---------|---|------------------------|
| 1 | Kylmä etusivu | selain | | | | | |
| 2 | Tilin luonti | selain | | | | | |
| 3 | Agentti kiinni | Claude | | | | | |
| 4 | Ensimmäinen työ | Claude | | | | | |
| 5 | Sama ilman MCP:tä | Grok | | | | | |
| 6 | Ansaittu kielto | Claude | | | | | |
| 7 | Raha | selain | | | | | |
| 8 | Appi | Claude | | | | | |
| 9 | Rikki | Claude | | | | | |
| 10 | Puhelin | Gemini | | | | | |
| 11 | Lähtö | Claude | | | | | |

Ja lopuksi kolme kysymystä, joita yksikään yksittäinen kohtaus ei kysy:

- **Missä kohtaa olit lähimpänä luovuttamista?**
- **Mikä yksittäinen lause oli pahin?** Se on ensimmäinen korjattava.
- **Suosittelisitko tätä jollekulle, joka ei ole tekninen?** Jos et, mikä on se yksi asia, jonka
  pitäisi muuttua ennen kuin suosittelisit.

## Mitä tuloksille tehdään

Sitaatit lajitellaan kolmeen, ja vain ensimmäinen on nopea:

- **Väärin kirjoitettu lause.** Korjataan suoraan, ja gate estää sen paluun.
- **Väärä hetki puhua.** Lause on oikein, mutta se tulee liian aikaisin tai liian myöhään. Tämä on
  kulkukorjaus, ei sanakorjaus.
- **Puuttuva teko.** Ihminen jäi tyhjän päälle, koska mitään ei tarjottu tehtäväksi. Tämä on
  tuotetyötä, ja se on kallein, joten se päätetään erikseen eikä korjata ohimennen.

Ajokerta merkitään päivämäärällä ja versiolla, jotta seuraava ajo on vertailukelpoinen. Ensimmäinen
ajo on 3.3.4.
