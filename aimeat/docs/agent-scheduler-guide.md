# Ajastusjärjestelmä — ohje agenteille

**Tarkoitus:** kertoa miten AI-agentit (esim. crewaimeat) voivat itse luoda ja hallita
toistuvia ajastuksia AIMEATissa — myös ajastaa saman omistajan **toisia agentteja** —
ilman että omistaja säätää mitään ajon aikana.
**Liittyy:** `docs/plans/2026-06-03-agent-scheduler-and-scheduled-tasks-plan.md`

---

## Perusperiaate (mitä agentin pitää tietää)

- **Palvelin omistaa kellon.** Agentti ei pidä omaa ajastinta — se *luo ajastuksen*
  AIMEATiin, ja AIMEAT-palvelin suorittaa sen `croner`-kellolla. Ajastus laukeaa vaikka
  agentti olisi offline.
- **Omistaja säilyttää kontrollin.** Kaikki agentin luomat ajastukset näkyvät omistajalle
  (Profile → Scheduler) ja omistaja voi pysäyttää tai perua minkä tahansa niistä koska vain.
- **Sama omistaja.** Agentti voi ajastaa itsensä **tai saman omistajan toisen agentin**
  (crew-agentit ovat saman GHII:n alla → OK).
- **Kolme suoritustapaa** (`kind`):
  - `extension` — ajaa asennetun laajennuksen toiminnon hiekkalaatikossa (**0 tokenia**,
    voi hakea HTTP:llä ja kirjoittaa muistiin, ei tekoälyä).
  - `ai` — palvelinpuolen OpenRouter-täydennys **omistajan avaimella** (lukee ennalta
    määritellyt muistiavaimet, ajaa promptin, tallentaa tuloksen). **Ei tarvitse agenttia.**
  - `agent_task` — luo tehtävän agentin jonoon joka laukaisulla → agentti suorittaa sen
    omilla työkaluillaan/tekoälyllään.
- **Löydettävyys:** agentti näkee `aimeat_schedule_*`-työkalut MCP-työkalulistassa, ja
  perusohjeet ovat `GET /v1/prompts/tier1` -opasteissa.

## MCP-työkalut (näitä agentti kutsuu)

### `aimeat_schedule_create` — luo ajastus

| param | tyyppi | koskee | selitys |
|---|---|---|---|
| `kind` | `ai` \| `agent_task` \| `extension` | kaikki | suoritustapa |
| `cron` | string | kaikki | vakio 5-kenttäinen cron, esim. `"0 7 * * *"` = klo 07:00 joka päivä |
| `display_name` | string | kaikki | ihmisluettava nimi |
| `timezone` | string | kaikki | IANA, esim. `"Europe/Helsinki"` — **anna aina päivittäisille** (DST oikein) |
| `purpose` | string | kaikki | miksi ajetaan (näkyy omistajalle) |
| `target_agent` | string | `agent_task` | **kohdeagentin nimi** (oletus: itse; oltava sama omistaja) |
| `task_title` | string | `agent_task` | jokaisella ajolla luotavan tehtävän otsikko |
| `task_description` | string | `agent_task` | **ohje kohdeagentille** — kerro mitä tehdään ja mihin memory-avaimeen tallennetaan |
| `prompt` | string | `ai` | ohje jonka palvelin ajaa syöteavainten arvoille |
| `input_keys` | string[] | `ai` | **omistajan** memory-avaimet, joiden arvot annetaan kontekstina |
| `output_key` | string | `ai` | mihin tulos tallennetaan (oletus auto-generoitu; näkyvyys `private`) |
| `model` | string | `ai` | valinnainen mallin override |
| `extension_name` + `action_id` | string | `extension` | mitä laajennustoimintoa ajetaan |

Palauttaa `{ created, schedule_id, kind, cron, display_name }`.

### Muut työkalut

- `aimeat_schedule_list` — listaa omat ajastukset (id, kind, cron, enabled, last/next run, run_count).
- `aimeat_schedule_update` `{ schedule_id, enabled?, cron?, timezone?, display_name? }` —
  `enabled:false` = tauko, `true` = jatka; cronin/nimen muokkaus.
- `aimeat_schedule_delete` `{ schedule_id }` — peruu ja poistaa.
- `aimeat_schedule_report_internal` `{ entries:[…] }` — jos agentti pyörittää **omaa**
  croniaan AIMEATin ulkopuolella ja haluaa vain *näyttää* sen omistajalle (AIMEAT ei aja
  näitä, näyttää vain). Rakenne per entry: `{ name, description?, purpose?, cron?,
  timezone?, schedule?, status?, kind? }`.

> **REST-vaihtoehto** (jos agentti kutsuu HTTP:tä suoraan MCP:n sijaan): samat toiminnot
> löytyvät `POST /v1/agents/:name/schedules`, `GET /v1/schedules`,
> `GET/PATCH/DELETE /v1/schedules/:id`, `POST /v1/schedules/:id/trigger`.

## Agentti ajastaa toisen agentin

Käytä `kind:"agent_task"` ja `target_agent`. Joka laukaisulla AIMEAT luo kohdeagentin
jonoon tehtävän, jonka **otsikko + kuvaus ovat ohje sille agentille**, ja herättää sen
(webhook / MCP-tapahtuma / poll).

```jsonc
aimeat_schedule_create({
  kind: "agent_task",
  target_agent: "news-fetcher",
  cron: "0 6 * * *",
  timezone: "Europe/Helsinki",
  display_name: "Aamun uutishaku",
  task_title: "Hae päivän uutiset",
  task_description: "Hae päivän tärkeimmät uutiset, jalosta tiiviiksi listaksi ja TALLENNA owner-näkyvyydellä memory-avaimeen 'news.today.raw'."
})
```

## Tärkeät asiat jotta ketju toimii

1. **Muistiavaimet ovat vaiheiden väylä — ei automaattista riippuvuusketjua.** Ajastukset
   eivät tunne "aja B kun A valmistui" -riippuvuutta; **vaiheista cron-ajoilla** (esim. haku
   06:00, editorial 07:00). Kerro jokaisessa `task_description`/`input_keys`-kohdassa
   **täsmälliset memory-avaimet** joista luetaan ja joihin kirjoitetaan, niin agentit
   kytkeytyvät toisiinsa.
2. **`ai`-tyyppi lukee omistajan memory-avaruudesta** (input_keys) ja kirjoittaa sinne
   (output_key, oletusnäkyvyys `private`). Sopii jalostukseen kun data on jo omistajan
   muistissa. Vaatii että **omistajan OpenRouter-avain on asetettu** (muuten ajo
   epäonnistuu — virhe näkyy ajolokissa Profile → Scheduler).
3. **Vahvistamaton suoritus (`agent_task`):** jotta dispatchattu tehtävä ajetaan ilman että
   omistaja painaa "Start", **kohdeagentin tulee olla `task-runner`-moodissa** (muuten
   tehtävä jää `queued`-tilaan odottamaan hyväksyntää). Tämä on omistajan kertaluontoinen
   asetus (Agent Config). `ai`- ja `extension`-ajastukset eivät tarvitse agenttia eivätkä
   moodia → täysin kädet-irti.
4. **Budjettirajat** (`max_runs`, `daily_limit`) ovat **omistajan hallinnassa** (Agent
   Config -välilehti). Agentin luomat ajastukset *perivät* kohdeagentin oletusrajat
   automaattisesti; agentti ei aseta niitä itse. Jos rajoja ei ole asetettu → ei rajoja.
5. **Appi ei liity ajastimeen.** Appi (cortex) lukee valmiit uutiset/editorialit
   memory-avaimista omistajan oikeuksin (`AIMEAT.data.get('news.today.editorial')`). Se
   rakennetaan kerran (`aimeat_app_publish`), ei ajasteta.

## Konkreettinen ohje crew:lle (uutispipeline)

> Tämän voi antaa suoraan orkestroija-agentille:

```
Pystytä päivittäinen uutisputki AIMEAT-ajastimella (kaikki saman omistajan agenteilla).
Sovi memory-avaimet etukäteen ja käytä Europe/Helsinki -aikavyöhykettä.

1) Uutishaku — aja klo 06:00:
   aimeat_schedule_create kind="agent_task", target_agent="<hakija-agentti>",
   cron="0 6 * * *", display_name="Aamun uutishaku",
   task_title="Hae uutiset",
   task_description="Hae päivän uutiset, tallenna owner-näkyvyydellä avaimeen news.today.raw"

2) Editorial murteella — aja klo 07:00 (data on jo omistajan muistissa, ei tarvita agenttia):
   aimeat_schedule_create kind="ai", cron="0 7 * * *",
   display_name="Päivän editorial savoksi",
   input_keys=["news.today.raw"],
   prompt="Kirjoita näistä uutisista päivän editorial savon murteella, lämpimään sävyyn",
   output_key="news.today.editorial"
   (Vaihtoehto: kind="agent_task", target_agent="<editori-agentti>" jos haluat agentin
    tekevän sen omilla työkaluillaan.)

3) Seuranta-appi (kerran): rakenna appi joka näyttää news.today.raw ja news.today.editorial,
   julkaise se aimeat_app_publish:lla. Ei ajasteta.

Hallinta: aimeat_schedule_list näyttää omat ajastukset; aimeat_schedule_update enabled=false
taukoa varten; aimeat_schedule_delete peruu. Omistaja näkee ja voi perua kaiken
Profile → Scheduler.
```

## Kaksi reunaehtoa "ilman että minä säädän mitään" -tavoitteelle

- **`ai`-vaihe** tarvitsee OpenRouter-avaimen asetuksiin (kertaluontoinen).
- **`agent_task`-vaihe** tarvitsee kohdeagentin `task-runner`-moodiin (kertaluontoinen,
  Agent Config). Jos haluat *nollatouhua*, tee hakukin laajennuksena (`kind:"extension"`) +
  jalostus `ai`:lla → ei yhtään agenttia online, ei moodeja, kaikki palvelinpuolella.

## Reunatapaukset (hyvä tietää)

- **Agentti offline kun `agent_task` laukeaa:** tehtävä jää jonoon ja agentti poimii sen
  seuraavalla yhteydellä — ajastus ei "hyppää yli", vain toimitus viivästyy.
- **Päällekkäiset ajot:** sama ajastus ei käynnistä uutta ajoa jos edellinen on yhä kesken;
  `agent_task` ohittaa myös jos edellinen occurrence on vielä keskeneräinen jonossa.
- **Aikakatkaisua ei korjata jälkikäteen** (ei "backfilliä") — missattu aamu jää väliin, ei
  aja keskipäivällä. Tämä on tarkoituksellista "joka aamu" -töille.
- **`max_runs` saavutettu:** ajastus disabloituu automaattisesti.
