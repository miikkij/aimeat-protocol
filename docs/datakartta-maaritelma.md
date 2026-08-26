# Datakartta: mitä siinä on

Tämä on se määritelmä jota vasten datakartta rakennetaan. Kirjoitettu ylös 25.8.2026, koska sama
asia unohtui toteutuksesta kolme kertaa peräkkäin: kartta kavennettiin joka kerta siihen missä data
on, ja se mihin sitä käytetään jäi pois.

**Kenelle kartta on.** Claude Code tai muu tekoäly avaa appin jota se ei tunne. Se lataa kartan ja
tietää sekunneissa mihin appi on, mihin käyttöön, missä sen data on ja miksi siellä — lukematta
lähdekoodia. Ilman sitä se panee uuden ominaisuuden datan sinne mihin ylsi helpoiten, ja se on
CADENCEn vika toistettuna.

Auditoija on toissijainen yleisö. Säilytysajat ja henkilötietomerkinnät ovat hänen sarakkeitaan, ja
ne eivät saa syrjäyttää sitä mitä rakentaja tarvitsee.

---

## Kartassa on kaksi tasoa

### Appin taso

Kuusi asiaa koko appista. **Kaksi ensimmäistä ovat ne jotka unohtuvat, ja ne ovat tärkeimmät.**

1. **Mihin tämä appi on** — mikä se on, ihmisen sanoin, yksi kappale
2. **Mihin käyttöön** — mitä varten sitä käytetään, mitä sillä saavutetaan
3. **Mitä appi on tarkoitettu olemaan** — muoto
4. **Missä data on** — tämän appin todellinen järjestely
5. **Mitä koneistoa appi käyttää**
6. **Mitä lähtee talosta**

### Rivin taso

Yksi rivi per avainperhe, ei per avain. Rivillä yksitoista asiaa:

1. **mitä** — avainperhe tai tietuelaji
2. **mitä data on** — laji
3. **mihin käyttöön** — mitä varten tämä rivi on olemassa
4. **missä se asuu**
5. **kuka omistaa**
6. **kuka lukee**
7. **kuka kirjoittaa**
8. **minkä muotoinen tietue**
9. **kuinka kauan**
10. **voiko sen menettää**
11. **miksi täällä eikä jossain muualla**

---

## Akselit, kaikki arvot auki

Kartta kuvaa sen mikä tämän appin järjestely sattuu olemaan. Ei yhtä oletettua muotoa.

### Missä data voi olla

ei missään (staattinen appi) · selaimessa vain (localStorage, ei lähde laitteelta) · omistajan
muistissa yksityisenä · omistajan muistissa julkisena · jonkun toisen muistissa (luetaan
`getPublic`) · organismin työtilassa (skeema lukittu) · organismin työtilan rivivarastossa (lisätään
perään, ei versiohistoriaa, kiintiö organismin eikä kirjoittajan) · organismin jaetussa alueessa ·
organismin metassa · laajennuksen omassa nimiavaruudessa (`ext:`) · cortexin hallinnassa ·
tiedostovarastossa · appin omassa julkaistussa tietueessa (app-tools, ODPS) · toisella nodella
(federaatio) · vieraassa palvelussa

Työtila ja sen rivivarasto ovat eri vastauksia, ja ero on se mitä lukija olettaa väärin jos ne
niputetaan: rivi lisätään perään eikä muokata, versiohistoriaa ei kerry, ja tila lasketaan
organismin kiintiöstä eikä sen jäsenen, joka rivin kirjoitti. Rivivarasto on oikea koti
tapahtumavirralle jota tulee paljon eikä lopu — vastaanotettu posti, ilmoitukset, bouncet,
aikasarjat. Testi on yksi kertolasku: **jos `avaimia_päivässä × 365` ylittää 1000, muoto on väärä**
ja rivit kuuluvat rivivarastoon.

### Mitä data on

asetukset · käyttäjän itse kirjoittama sisältö · tekoälyn tuottama sisältö · rekisteri tai luettelo
olioista · tapahtumaloki tai historia · indeksi joka osoittaa muihin tietueisiin · laskettu tulos
tai välimuisti · ulkopuolelta haettu kopio · tunnisteet ja avaimet vieraisiin järjestelmiin ·
tilannekuva tai versio · mittarit ja luvut · käyttäjän mieltymykset · luonnos, keskeneräinen työ ·
lähtevä viesti · tiedosto · kytkentä kahden asian välillä · oikeudet ja roolit · salaisuus tai
tunnus

### Mihin käyttöön

appi ei toimi ilman sitä · käyttäjä palaa siihen ja lukee sen · näytetään listana · haku ja
suodatus · laskenta ja raportointi · appi jatkaa siitä mihin jäi · jaettavaksi muille ·
lähetettäväksi ulos · todiste siitä mitä tapahtui · nopeuttaa (saa hävitä) · konteksti agentille
tai tekoälylle · yhteensopivuus vanhan version kanssa

### Kuka omistaa

henkilö · organismi · laajennus · ekosysteemiappi · joku muu kokonaan (kopio) · ulkopuolinen
rekisterinpitäjä · ei kukaan (efemeerinen)

### Kuka lukee

vain omistaja · omistaja ja hänen agenttinsa · nimetyt henkilöt · organismin jäsenyys · kuka tahansa
· vain appi itse (laajennuksen nimiavaruus) · vastaanottaja jonnekin muualle

### Kuka kirjoittaa

ihminen käyttöliittymästä · appi ihmisen puolesta · agentti · ajastus ilman ketään paikalla ·
laajennus palvelimella · asennus (paketin siemendata) · vieras järjestelmä webhookilla

### Minkä muotoinen tietue

yksi tietue · yksi per olio · kokoelma yhden avaimen alla · per jakso koottu · indeksi + rungot
erikseen · tiedostoja · ei tietuetta lainkaan

### Kuinka kauan

kunnes poistetaan · TTL · liukuva ikkuna · versiokatto · muuttumaton, vain lisätään · vain istunnon
ajan

### Voiko sen menettää

ainoa kappale, menetys on lopullinen · palautettavissa ulkoisesta lähteestä · laskettavissa
uudelleen muusta datasta · käyttäjä voi kirjoittaa uudelleen · saa hävitä, appi toipuu itse

### Mitä koneistoa appi käyttää

IAM ja roolit · työnkulut · laajennuksia · cortexia · tekoälytuotantoa (ja onko merkitty) ·
ajastusta · yhteyksiä ja julkaisua · maksuja · federaatiota · ei mitään näistä

### Mitä lähtee talosta

ei mitään · kopio ulkoiseen palveluun · lähetetty viesti tai sähköposti · julkaistu julkinen tietue
· federoitu toiselle nodelle

### Mitä appi on tarkoitettu olemaan

yhden ihmisen työkalu · yksityinen, arkaluontoinen · jaettu nimetyille · ryhmän yhteinen ·
organismin työtilassa elävä · julkinen palvelu · staattinen sivu · sekoitus

---

## Se mikä tekee kartasta hyödyllisen

Kartta panee vierekkäin sen mitä appi on **tarkoitettu** olemaan ja sen missä sen data **oikeasti**
on. Ristiriita on luettavissa ilman että kukaan avaa lähdettä.

CADENCEn alkuperäinen vika: tarkoitus oli ryhmän yhteinen CRM, järjestely oli yhden ihmisen oma
muisti. Kaksi riviä vierekkäin, ristiriita näkyvissä sekunnissa.

Kartan tehtävä ei ole luetella avaimia. Se on tehdä ero tarkoituksen ja järjestelyn välillä
näkyväksi.

---

## Mistä sisältö tulee

**Luettavissa siitä mikä on jo nodella:** appin skilli (mihin appi on, mihin käyttöön), työtilan
manifesti (tietuelajit, skeemat), oikeussanat, asennetut laajennukset, EXCHANGE-listaukset, ODPS.

**Kirjoitetaan kerran, eikä ole johdettavissa:** appin kappale silloin kun skilliä ei ole, ja
rivikohtainen **miksi täällä**. Ne kirjoittaa appin rakentanut tekoäly samalla kun se rakentaa
appin. Keksitty perustelu on tyhjää huonompi.

**Ei koskaan arvata.** Appi joka ei kerro mitään saa kartan jossa lukee ettei karttaa ole. Arvattu
kartta istuu siinä kohdassa mihin oikea vastaus kuuluisi ja lukee kuin vastaus.

---

## Missä kartta näkyy

**Profiili > Apps > My Apps, listaitemi.** Yksi rivi joka kertoo missä tämän appin data on, niin
että poikkeava erottuu 35 appin listasta silmäillen. Rivi aukeaa paikallaan koko kartaksi. Ei
hyppyä app-catalogiin.

**App-catalogin application details.** Koko kartta.

Kartta asuu appin vieressä omana tietueenaan, ei upotettuna appin HTML:ään.
