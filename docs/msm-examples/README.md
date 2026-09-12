# MSM-esimerkit

Machine service manifest on kirjoitettu kuvaus ulkopuolisesta palvelusta: mitä se tekee, missä se
on, mitä se ottaa ja mitä se antaa takaisin. Tekoäly lukee kuvauksen ja kutsuu palvelua itse. Tämä
sivusto säilyttää kuvauksen eikä koskaan tee sitä kutsua.

Nämä kymmenen ovat valmiita malleja. Solmu lukee ne käynnistyessään ja tarjoilee ne osoitteessa
`GET /v1/msm/templates`, ja ylläpidon MSM-sivu näyttää ne osiossa "Ready-made ones that ship with
this site". Jokainen on täydellinen: todennus, toiminnot, mitä kukin toiminto ottaa ja antaa, ja
terveystarkistus. Ne ovat nopein tapa nähdä miltä hyvä manifesti näyttää: avaa yksi, vaihda osoite
ja kentät, ja olet kirjoittanut omasi.

Mallia kopioidaan, joten sen virheet monistuvat. Kommentit ovat siksi englanniksi, kuten koodissa
muuallakin. Esimerkkidata saa olla suomea silloin kun palvelu on suomalainen: Postin osoite,
`description_fi`-kentän sisältö ja sääsanat ovat sitä tarkoituksella.

## Kauppapaikka: tuote, hinta, maksu ja toimitus

| Tiedosto | Palvelu | Mitä se näyttää |
|----------|---------|-----------------|
| `product-image-analysis.msm.yaml` | OpenAI Vision / Google Vision | Kuvasta tuote, kunto ja kuvausehdotus |
| `price-estimation.msm.yaml` | Hintadata-analyysi | Mitä markkina maksaa käytetystä tuotteesta |
| `stripe-marketplace.msm.yaml` | Stripe Connect | Maksu suoraan myyjälle ilman välikättä |
| `coinbase-transfer.msm.yaml` | Coinbase CDP AgentKit | Kryptomaksu lompakosta jota agentti hallitsee |
| `mobilepay-payment.msm.yaml` | MobilePay | Pohjoismainen mobiilimaksu ostajalta myyjälle |
| `posti-shipping.msm.yaml` | Posti SmartShip | Lähetys ja seurantakoodi samalla kutsulla |

## Palvelut: majoitus, ravintola ja keikkatyö

| Tiedosto | Palvelu | Mitä se näyttää |
|----------|---------|-----------------|
| `nuki-smartlock.msm.yaml` | Nuki Smart Lock | Vieraan pääsy ovesta sisään, ja sen peruminen |
| `weather-pricing.msm.yaml` | OpenWeather | Yöhinta liikkuu sääennusteen mukana |
| `wolt-restaurant.msm.yaml` | Ravintolan tilausjärjestelmä | Tilaus vastaan ja kuljetus matkaan |
| `ai-logo-design.msm.yaml` | AI-kuvangenerointi | Suunnittelu toimintona jota toinen tekoäly kutsuu |

## Mitä malli ei lupaa

Manifesti on väite jonkun toisen palvelusta. Mikään ei tarkista että osoite vastaa, että avain on
asetettu tai että toiminnot ovat yhä olemassa, ja terveystarkistusta ei aja mikään. Nämä kymmenen
on kirjoitettu esimerkeiksi rakenteesta, eivät valmiiksi toimiviksi integraatioiksi: osoitteet ja
kentät ovat oikeat sen mukaan mitä palvelut tarjosivat kirjoitushetkellä, ja se on tarkistettava
ennen käyttöä.
