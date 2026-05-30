# 05 — Code execution with MCP (token-tehokkuus)

> Lähde: Anthropic Engineering, "Code execution with MCP: Building more efficient agents" (4.11.2025). [VIRALLINEN]
> Tämä on suoraan relevantti "fiksummat komennot" -tavoitteelle, jos AIMEATissa on paljon tooleja.

---

## Ongelma, jonka tämä ratkaisee

Kun tooleja on paljon (kymmeniä servereitä, satoja tooleja), kaksi yleistä token-syöppöä: [VIRALLINEN]

1. **Tool-määrittelyt täyttävät kontekstin.** Useimmat clientit lataavat kaikki tool-määrittelyt etukäteen. Satojen toolien tapauksessa satoja tuhansia tokeneita ennen kuin pyyntöä luetaan.
2. **Välitulokset syövät tokeneita.** Esim. "Lataa palaverin transkripti Driveltä ja liitä Salesforce-liidiin": koko transkripti kulkee mallin läpi **kahdesti** (Drivestä sisään, Salesforceen ulos). 2 tunnin palaverin transkripti ≈ 50 000 ylimääräistä tokenia. Isot dokumentit voivat jopa ylittää kontekstirajan ja rikkoa työnkulun. Mallit tekevät myös enemmän virheitä kun ne kopioivat dataa kutsujen välillä. [VIRALLINEN]

---

## Ratkaisu: esitä serverit koodi-API:na

Sen sijaan että malli kutsuu tooleja suoraan, **se kirjoittaa koodia joka kutsuu tooleja.** Yksi tapa: generoi tiedostopuu kaikista tooleista. [VIRALLINEN]

```
servers
├── google-drive
│   ├── getDocument.ts
│   ├── ... (muut toolit)
│   └── index.ts
├── salesforce
│   ├── updateRecord.ts
│   └── index.ts
└── ...
```

Jokainen tool = tiedosto:

```typescript
// ./servers/google-drive/getDocument.ts
import { callMCPTool } from "../../../client.js";

interface GetDocumentInput { documentId: string; }
interface GetDocumentResponse { content: string; }

/* Read a document from Google Drive */
export async function getDocument(input: GetDocumentInput): Promise<GetDocumentResponse> {
  return callMCPTool<GetDocumentResponse>('google_drive__get_document', input);
}
```

Aiempi Drive→Salesforce-esimerkki muuttuu koodiksi:

```typescript
import * as gdrive from './servers/google-drive';
import * as salesforce from './servers/salesforce';

const transcript = (await gdrive.getDocument({ documentId: 'abc123' })).content;
await salesforce.updateRecord({
  objectType: 'SalesMeeting',
  recordId: '00Q5f000001abcXYZ',
  data: { Notes: transcript }
});
```

Agentti löytää toolit selaamalla tiedostojärjestelmää (listaa `./servers/`, lukee tarvitsemansa tool-tiedostot). Lataa vain ne määrittelyt joita tarvitsee. **Tulos: 150 000 tokenista 2 000 tokeniin — 98,7 % säästö.** [VIRALLINEN]

> Cloudflare julkaisi vastaavat löydökset nimellä "Code Mode". Ydinoivallus sama: LLM:t ovat hyviä koodin kirjoittamisessa — käytä tätä vahvuutta. [VIRALLINEN viittaa Cloudflareen]

---

## Hyödyt

**Progressive disclosure.** Mallit navigoivat tiedostojärjestelmiä hyvin. Toolit koodina = määrittelyt luetaan on-demand, ei kaikkia etukäteen. Vaihtoehtona `search_tools`-tool jossa detail-level-parametri (pelkkä nimi / nimi+kuvaus / täysi schema). [VIRALLINEN]

**Token-tehokkaat tulokset.** Suodata ja muunna koodissa ennen palautusta. Esim. 10 000 rivin taulukko:

```typescript
// Ilman code executionia: kaikki 10 000 riviä kontekstiin
// Code executionilla: suodata ajoympäristössä
const allRows = await gdrive.getSheet({ sheetId: 'abc123' });
const pendingOrders = allRows.filter(row => row["Status"] === 'pending');
console.log(`Found ${pendingOrders.length} pending orders`);
console.log(pendingOrders.slice(0, 5)); // vain 5 ensimmäistä malliin
```

Agentti näkee 5 riviä, ei 10 000. [VIRALLINEN]

**Tehokkaampi control flow.** Luupit, ehdot, virheenkäsittely tutuilla koodirakenteilla, ei tool-kutsujen ketjutusta agenttiluupin läpi. Esim. pollaa Slack-kanavaa kunnes "deployment complete" löytyy — yhtenä koodinpätkänä. Säästää myös "time to first token" -latenssia, koska ajoympäristö hoitaa if-lauseet. [VIRALLINEN]

**Privacy-preserving.** Välitulokset jäävät ajoympäristöön oletuksena; malli näkee vain sen mitä eksplisiittisesti logataan/palautetaan. Harness voi tokenisoida PII:n automaattisesti: oikeat sähköpostit/puhelinnumerot virtaavat Drivestä Salesforceen muttei koskaan mallin läpi. Mahdollistaa deterministiset tietoturvasäännöt datavirroille. [VIRALLINEN]

**State persistence ja skills.** Tiedostojärjestelmäpääsy → agentti voi kirjoittaa välituloksia tiedostoihin ja jatkaa myöhemmin. Agentti voi myös tallentaa oman koodinsa uudelleenkäytettäviksi funktioiksi (skills). SKILL.md-tiedosto tekee näistä rakenteisen skillin. Ajan myötä agentti rakentaa työkalupakin korkeamman tason kyvyistä. [VIRALLINEN]

---

## Varoitus / kustannukset

Code execution tuo oman kompleksisuutensa: agentin generoiman koodin ajaminen vaatii **turvallisen sandbox-ympäristön**, resurssirajat ja monitoroinnin. Nämä lisäävät operatiivista kuormaa ja tietoturvaharkintaa, jonka suorat tool-kutsut välttävät. Punnitse hyödyt (vähemmän tokeneita, pienempi latenssi, parempi tool-komponointi) näitä kustannuksia vastaan. [VIRALLINEN]

> Yhteisön validointi: eräs avoimen lähdekoodin toteutus raportoi 98 % token-vähennyksen (70 000 → 800 tokenia) tuotannossa, linjassa Anthropicin lukujen kanssa. [3RD: glama.ai-attribuutio; HUOM yksittäinen raportti, ei vertaisarvioitu]

---

## [OMA TULKINTA] Sovellettavuus AIMEATiin

- **Sopii** jos AIMEATin agentit käyttävät montaa toolia ja/tai liikuttelevat isoja datapaketteja (esim. memory/knowledge/storage-toolit, suuret listaukset).
- **Vähemmän hyötyä** yksinkertaisissa 2–3 tool-kutsun agenteissa — tämän on huomauttanut myös ulkopuolinen kommentaattori (Michael Bargury): malli soveltuu parhaiten kun dataa pitää *manipuloida*, ei pelkästään *analysoida*. [3RD: mbgsec.com]
- **Vaatii sandboxin.** Sinulla on jo Node/TS-stack ja AIMEAT-arkkitehtuuri; sandboxin (esim. Deno tai eristetty kontti) lisääminen on se hinta.
- **Erottelu kannattaa tehdä eksplisiittisesti:** data jota malli *manipuloi* → koodiin (pois kontekstista); data jota malli *analysoi* → kontekstiin. [3RD: Bargury, hyvä nyrkkisääntö]
