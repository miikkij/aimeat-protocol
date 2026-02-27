# MSM Esimerkit — Marketplace & Palveluekosysteemi

Tämä hakemisto sisältää valmiita MEAT Service Manifest (MSM) -esimerkkitiedostoja,
jotka kuvaavat palvelut diagrammeista `08-marketplace-disruption.md` ja
`09-service-ecosystem.md`.

## Marketplace-palvelut (08)
| Tiedosto | Palvelu | Käyttötarkoitus |
|----------|---------|-----------------|
| `product-image-analysis.msm.yaml` | OpenAI Vision / Google Vision | Tuotteen tunnistus kuvasta, kunnon arviointi |
| `price-estimation.msm.yaml` | Hintadata-analyysi | Markkinahinnan arviointi tuotteelle |
| `stripe-marketplace.msm.yaml` | Stripe Connect | Fiat-maksut myyjä→ostaja |
| `coinbase-transfer.msm.yaml` | Coinbase CDP AgentKit | Kryptomaksu USDC/ETH/BTC |
| `posti-shipping.msm.yaml` | Posti SmartShip | Pakettien lähetys & seuranta |
| `mobilepay-payment.msm.yaml` | MobilePay | Pohjoismaiset mobiilimaksut |

## Palveluekosysteemi (09)
| Tiedosto | Palvelu | Käyttötarkoitus |
|----------|---------|-----------------|
| `ai-logo-design.msm.yaml` | AI-kuvangenerointi | Logo/grafiikka keikkatyönä |
| `wolt-restaurant.msm.yaml` | Ravintolan tilausjärjestelmä | Ruokatilaus & toimitus |
| `nuki-smartlock.msm.yaml` | Nuki Smart Lock | Majoituksen avainten hallinta |
| `weather-pricing.msm.yaml` | OpenWeather API | Sää dynaamista hinnoittelua varten |
