---
name: aimeat-writing
description: How prose is written on this project: the AI tells that give a text away and how to remove them, and how Finnish and Spanish are composed rather than translated. Use before writing or editing any user-visible text: UI copy, locale strings, documentation, a handbook page, a changelog entry, a commit message, an organism document, a prompt's human-facing parts, or a longer chat answer.
---

# Writing

Two jobs. Remove the tells that make a text read as machine-written, and write each language as
that language rather than as translated English.

## The tells

They are not a style preference. Every one of them is generic, adds length without adding clarity,
and signals that nobody decided anything. A reader who spots two stops trusting the third.

**Words to strike on sight:** delve · crucial · pivotal · tapestry · foundational · robust ·
seamless · landscape · realm · leverage (as a verb) · underscore · testament to · navigate (when
nothing is being steered).

**Openers and fillers:** "Here's the thing" · "Hope this helps" · "After careful consideration" ·
"I wanted to provide a quick update" · "It's worth noting that" · "Most people…" as a lead-in to a
claim nobody measured.

**Three patterns matter more than the word list, because they survive a find-and-replace:**

1. **Negative parallelism.** "It's not X, it's Y." "Not a bug, a feature." It fakes insight by
   pushing away a claim nobody made. Say Y. If X genuinely needs rejecting, reject it in its own
   sentence with a reason.
2. **The grand pronouncement.** A short final line that reframes what was just said as something
   larger: "This isn't a budget. It's a statement of intent." Cut it. The paragraph already said the
   thing; the flourish only announces that the writer wanted an ending.
3. **Adverb abuse.** "quietly runs", "simply add", "essentially the same", "actually works",
   "seamlessly integrates". The adverb is doing the work the verb should do, or hiding that no
   measurement was made. Strike it or replace the verb.

Two more this project keeps producing: **em-dashes** (use a comma, a colon or two sentences) and
**decorative emoji** (only ✓ ✗ → ↩ carry meaning; the rest are noise, and in an app UI they read as
AI slop; the same rule applies there).

**Speak human.** A term from the system's own vocabulary carries its meaning in the same sentence, or it does not appear. "agentAutonomy is L3 and meta.decisions is alwaysGate" tells the reader nothing; "the agent may write on its own, but decisions and gaps wait for your approval" says the same thing and can be acted on. This applies hardest when reporting to the developer: an identifier, a config key or a status enum is evidence, and the sentence still has to work without it. The same goes for a number: say what it means, not only what it is.

**The self-edit pass**, once the draft exists: read it once for the three patterns above, once for
adverbs, and once asking of each sentence whether deleting it would lose information. Most
first-draft closing paragraphs lose nothing.

## Finnish

**Compose in Finnish. Do not write English and translate it.** A translated sentence reads as
translated, Jouni sees it immediately, and it costs a correction round every time. Spending the extra
minutes on the first pass is cheaper than the iteration it saves. This is a standing instruction, not
a preference.

**Kaksikielinen sisältö kirjoitetaan kahdesti, ei käännetä kertaakaan** (opittu 23.8.2026, kun
PITCH-esityksen suomi paljastui sanasta sanaan siirretyksi englanniksi). Fi- ja en-versio syntyvät
samoista faktoista erillisinä sävellyksinä: englannin retoriikka ("two built-in flaws, and neither is
a law of nature") EI käänny suomeksi rakenteensa kanssa — suomeksi sama ajatus on "kaksi vikaa, ja
molemmat ovat valintoja". Jos suomenkielinen lause aukeaa vasta kun arvaa englanninkielisen
alkuperäisen, se kirjoitetaan uusiksi.

**Rekisteri: täysi virke, ei katkottu isku.** Jounin oma malliesimerkki (23.8.2026), joka voitti
kirjoittajan lyhyemmän version: *"Alusta on saatavilla avoimena lähdekoodina ja omistat koko
ympäristön itse: vaikka me katoaisimme huomenna, ympäristö jää sinulle."* Asia sanotaan loppuun
yhdessä selkeässä virkkeessä; iskulauseeksi typistäminen ("Koodi on avoin ja ympäristö on sinun")
hävisi, koska se pudottaa täsmällisyyden. Lyhyt isku kuuluu vain kansilauseisiin ja kickereihin.

**Lauserakenteen säännöt (Jounin korjauskorpus, 23.8.2026).** Jokainen näistä syntyi todellisesta
korjauksesta PITCH-esitykseen, ja jokainen on yleistys, ei kertatapaus:

- **Mittari sanotaan substantiivilausekkeena, ei sivulauseena.** "montako maksavaa asiakasta", ei
  "montako asiakasta maksaa". Suomessa määrite kulkee pääsanan edessä; englannin relatiivirakenne
  ("how many customers pay") tuottaa sivulausemuodon, joka on käännössuomen tuntomerkki.
- **Rahat ovat monikossa ja ehto sanotaan täydessä muodossa:** "vasta sitten, kun rahat ovat
  tilillä", ei "vasta, kun raha on tilillä".
- **Lead saa olla verbitön toteamus, kun se on ilmoitus:** "Luvut nähtävillä alustalla livenä!"
  voitti muodon "Luvun voi käydä katsomassa itse alustalta". Voida + käydä + -massa -ketju on
  kapulakieltä; nähtävillä-rakenne on suomalaisten ilmoitusten vakiokieltä.
- **Idiomi tarkistetaan kokonaisuutena, ei sanoina.** "Ei tarvitse uskoa meidän sanamme varassa"
  sekoitti kaksi rakennetta ("uskoa jotakin" + "olla jonkun sanan varassa") ja pysyi silti
  kieliopillisesti koossa. Kollokaatio, jota ei löydy hakemalla luonnollisesta suomesta, jää
  kirjoittamatta.
- **Väite, jonka lukija kaataa yhdellä kysymyksellä, ei kelpaa.** "Kuka tahansa voi käydä
  lukemassa ne" kaatui kysymykseen "mistä?". Joko paikka sanotaan tai väite jätetään pois.
- **Sisältö, joka vanhenee viikossa, ei kuulu dialle.** Rakennusjärjestyslista poistettiin, koska
  se olisi vanhentunut heti valmistuttuaan.

**Lukijasimulaatio ennen julkaisua.** Julkiseen tai asiakkaalle näkyvään suomeen ajetaan kylmäluku:
kontekstiton lukija (agentti kelpaa) lukee pelkän tekstin ja nimeää lauseet, jotka kuulostavat
käännetyiltä, oudoilta tai joita ei ymmärrä ensimmäisellä lukemalla. Löydökset korjataan ennen
julkaisua. Oma silmä ei riitä, koska kirjoittaja lukee omaa tekstiään englanninkielisen ajatuksen
läpi.

**Simulaatio ilman todisteita on kielletty** (opittu 23.8.2026, kun omasta päästään arvaava
kylmälukija sekä ohitti käännössuomea että tuotti sitä itse: sen oma korjausehdotus oli rikkinäinen
idiomi). Lukijasimulaation agentti todentaa verkkohauilla: epäilyttävä kollokaatio haetaan
lainausmerkeissä ja katsotaan, käyttääkö luonnollinen suomenkielinen teksti sitä; sanaston oikea
käyttö haetaan suomalaisyritysten ja median sivuilta lähteineen; kielioppikohta tarkistetaan
Kielitoimiston ohjepankista. Sama vaatimus koskee agentin omia korjausehdotuksia: ehdotus, jonka
idiomia ei ole todennettu, ei kelpaa löydöksen korjaukseksi. Jounin luku on aina viimeinen portti,
ja hänen lukitsemaansa tekstiin ei mikään simulaatio koske.

### Lukijasimulaation työohje

Todennettu 23.8.2026: PITCH-esityksen suomesta löytyi tällä 35 korjattavaa, joista kirjoittaja
itse ei nähnyt yhtään.

1. **Poimi pelkät tekstit tiedostoon.** Ei tuotekuvausta, ei taustaa, ei sitä miksi teksti on
   olemassa. Jos lukija tarvitsee kontekstin ymmärtääkseen lauseen, se on jo löydös.
2. **Käynnistä erillinen agentti** (Agent-työkalu, ei sama sessio: kirjoittajalla on koko
   keskustelun konteksti päässään eikä hän voi kylmälukea omaa tekstiään). Agentille annetaan
   vain tiedostopolku ja alla oleva tehtävä.
3. **Promptipohja**, neljä luokkaa:

   > Olet suomenkielinen lukija, joka ei tiedä mitään tuotteesta, jonka tekstiä luet. Lue
   > jokainen lause ensimmäisellä lukemalla ja raportoi:
   > 1. KÄÄNNÖSSUOMI: lauseet jotka kuulostavat englannista käännetyiltä. Anna parannettu muotoilu.
   > 2. EI AUKEA: lauseet tai sanat joita et ymmärrä tai joissa jouduit arvaamaan.
   > 3. OUTO SÄVY: mahtipontinen, kömpelö tai suomalaiseen liikekieleen vieras kohta.
   > 4. KIELIOPPI: pilkut (joka/että/kun/jos-sivulauseet), yhdyssanat, taivutus, idiomit.
   > 5. ÄÄNEEN-TESTI: kirjoita jokainen avainlause uudestaan niin kuin sanoisit sen ääneen
   >    asiakkaalle. Jos oma versiosi on parempi, alkuperäinen häviää ja versiosi tulee tilalle.
   >    Kieliopillisesti oikea mutta kapula lause on löydös, ei läpimeno.
   > 6. KYSYMYSTESTI: listaa jokaisesta lauseesta kysymykset, jotka se herättää (mikä? kenen?
   >    kuka?). Abstrakti substantiivi ilman tarkoitetta (muisti, tekijä, identiteetti, oikeus)
   >    on löydös, jos teksti ei vastaa kysymykseen samassa tai seuraavassa virkkeessä.
   >    Etusivulla ja kansitekstissä sallittu määrä avoimia kysymyksiä on nolla.
   > Älä arvioi sisällön totuutta, vain kieltä ja ymmärrettävyyttä. Palauta lista:
   > [kohta] "lause" → ongelma → korjausehdotus. Ole ankara.

   Opittu 23.8.2026 toisella kierroksella: neljä ensimmäistä luokkaa mittaavat virheitä, mutta
   "ymmärrettävä mutta kapula" meni niistä läpi ("Alusta on avointa lähdekoodia, ja koko
   ympäristö on omasi" on kieliopillisesti oikein ja silti paperia). Luokat 5 ja 6 mittaavat
   laatua, ja vasta ne tekevät simulaatiosta lukijan simulaation.

4. **Korjaa jokainen löydös tai kirjaa miksi ei** (esim. aito sitaatti pysyy sanatarkkana:
   Kalle Määtän "kanvas" jäi, mutta sai selventävän jatkolauseen). Sitten vasta julkaisu.
5. **Varmista koneellisesti se minkä voi**: em-dashit, kielletyt sanat (solmu, node
   asiakaspinnassa) ja kieliversioiden pariteetti tarkistetaan skriptillä ennen ja jälkeen.

Sama menetelmä toimii englannille (deckin kylmäluku löysi jargonin ja lähdeviiteriskin) ja
espanjalle. Vaatimukset lyhyesti: erillinen agentti, pelkkä teksti ilman kontekstia, ankaruus
pyydettynä, ja jokaiseen löydökseen joko korjaus tai kirjattu syy jättää korjaamatta.

What gives a translation away, in the order it shows up here:

- **Genitive chains.** "järjestelmän käyttäjän oikeuksien hallinta" is English noun-stacking in
  Finnish clothing. Restructure to a clause or a compound: "miten käyttäjien oikeuksia hallitaan".
- **Missing commas.** A subordinate clause opened by *joka, että, kun, jos, vaikka, mikä* takes a
  comma. This is grammar, not style, and one Finnish pass on this project found about forty real
  errors of exactly this kind.
- **English passive.** "It was decided that…" becomes agentless mush in Finnish. Name a subject, or
  use the Finnish passive deliberately when the actor genuinely does not matter.
- **-ing constructions.** English participles do not map onto Finnish; a finite clause usually does.
- **Anglicisms and calques.** renderöityy → näkyy or muodostuu · grid → taulukko · doktriini →
  pelisäännöt · "mobiili edellä" → "mobiili ensin" · "ulos menevä" → lähtevä. If a word looks like a
  Finnish suffix bolted onto an English stem, it probably is.
- **Invented compounds.** If you cannot find the word in real use, you made it up. Rephrase.
- **Idioms never translate.** Find the Finnish thought, not the Finnish words.
- **ä and ö always.** The node is UTF-8 throughout, and append-only namespaces make an orthography
  slip permanent.

**Deliberate exception: machine and protocol tokens stay English in both languages.** Status names,
stage labels and identifiers a person reads as a machine's vocabulary (`AUTH`, `DELIVR`, `SNIF`,
`FRESH`, `done`, `failed`) are not translated. Everything a person reads as a sentence is.

**Suomen asiakassanasto** (Jouni 23.8.2026, kun sekä "node" että "solmu" kaatuivat asiakasteksteissä
— kumpikaan ei kanna merkitystä lukijalle, joka ei tunne järjestelmää):

| Käsite | Asiakaspinnassa | Teknisessä/sisäisessä tekstissä |
|---|---|---|
| node | **oma AIMEAT** tai **oma ympäristö** (fyysinen kone: **oma palvelin**) | `node` säilyy koneistoterminä (dev-liitteet, SUUNTA, `€/node/kk`), ensimaininta selitetään |
| solmu | **ei käytetä koskaan** — kukaan ei tajua mikä on solmu | ei käytetä |
| instanssi | käy resurssikuoren osana ("2 GB instanssi") | käy |
| toimittaja (vendor) | **ei käytetä** — hankintajargonia, ja arkilukija lukee sen journalistiksi. Tilalle: **työkalun tekijä**, **valmistaja**, tunteessa **jonkun muun koneilla**, vuokralainen-vertauksessa **isäntä** | käy hankinta- ja sopimusteksteissä |
| SLA | avataan aina: **tukilupaus (SLA)** | käy |

Sama testi kuin muullekin sanastolle: jos sana ei kanna merkitystään samassa lauseessa lukijalle,
joka näkee tuotteen ensimmäistä kertaa, se ei kuulu asiakaspintaan.

## Spanish

**Compose in Spanish**, the same standing instruction the Finnish carries. Two decisions were made
once, and every string on the node follows them:

- **Latin American Spanish (es-419), written for Bogotá.** Not peninsular. `computadora` not
  `ordenador` · `celular` not `móvil` · `presiona` / `haz clic` not `pulsa` · `agregar` not `añadir`
  · `felicitaciones` not `enhorabuena` · `carro`-free, plain register.
- **`tú`, never `usted` and never `vos`.** Spoken Bogotá leans on `usted`, but software addresses
  the reader as `tú` across the region, and the whole UI has to pick one and hold it.

Vocabulary is fixed so 8000 strings agree with each other:

| English | Spanish | Note |
|---|---|---|
| memory | memoria | |
| workspace | espacio de trabajo | |
| organism | organismo | |
| node | nodo | |
| agent | agente | |
| app | aplicación | `app` only where a button has no room |
| home (the product metaphor) | hogar | a person's own space here |
| skill | habilidad | |
| consent | consentimiento | |
| provenance | procedencia | |
| trust score | puntuación de confianza | |
| owner (the role) | propietario | the human who owns the account |
| deal (CRM) | oportunidad | |
| viewer / contributor | lector / colaborador | |

**Never translated**, in any language: `AIMEAT`, `morsel` / `morsels`, `MCP`, `GHII` / `GAII` /
`GEAI`, `cortex`, `EXCHANGE`, `TURBO`, product names, and machine tokens (`done`, `failed`, `AUTH`).

What gives a translation away here:

- **Gendered address.** "Welcome" is not `Bienvenido`, which assumes a man reads it. `Te damos la
  bienvenida`. Same for `tranquilo`, `listo`, `seguro` used about the reader: rephrase.
- **English word order kept.** `Puedes copiar el prompt de arriba y pegarlo` is fine; a chain of
  `de`s (`la configuración de los permisos de los agentes del usuario`) is English noun-stacking
  wearing Spanish. Break it into a clause.
- **Missing `¿` and `¡`.** They open the sentence, not just close it.
- **`el enlace` vs `el link`, `el correo` vs `el email`.** Pick the Spanish one, both times.
- **Calques.** `soportar` for support → `admitir` · `aplicar` for apply a setting → `aplicar` is
  fine, but `aplicar para` a job is not · `remover` → `quitar` / `eliminar` · `accesar` is not a
  word.
- **Accents always.** The node is UTF-8 throughout and an append-only namespace makes a missing
  tilde permanent. `á é í ó ú ñ ü ¿ ¡`.

**Length.** Spanish runs 15–25 % longer than English. A string that fits a button in English may not
in Spanish, and that is checked in a browser at three viewports, not guessed.

## Adding a language, and filling one in

Three commands, repeated until the coverage line says 100 %. There is no fourth step and no other
file to remember.

```bash
pnpm locale:extract es --prefix profile.agents.   # → locales/.todo-es.json, the English to work from
#   … replace every value with the target-language text …
pnpm locale:merge es locales/.todo-es.json        # → back into es.json, in en.json's shape
pnpm check:locales                                # the gate; --list for coverage only
```

**A NEW language is the same loop plus two lines:** add the tag to `LOCALES` in `src/i18n.ts`, create
`locales/<tag>.json` containing `{}`, then extract → translate → merge. Nothing else in the code
needs touching, because every locale-aware surface (the two language switches, the sign-in modal,
the served header, the email and notification templates, the static privacy/terms/connect pages, the
EU AI Act disclosure declaration) reads that one list.

Four things worth knowing about the loop:

- **Slice by `--prefix`, not by `--limit` alone.** A translator needs one screen's strings together
  or the same noun comes out three ways. `--prefix profile.agents.` is a screen; the first 200 keys
  alphabetically are four half-screens.
- **A missing key is not a defect.** It falls back to English per key, which is how a language gets
  filled in over several passes without ever shipping a half-Spanish screen. Leaving a key out is
  cleaner than a `[TODO:xx]` placeholder, and far cleaner than a calque.
- **`locale:merge` refuses before it writes.** Unknown key, string where English has a list, dropped
  `{n}`, shipped `[TODO:xx]`: it checks the merged result first and writes nothing if any of it
  fails. A half-merged file is worse than an unmerged one, because the next extract no longer knows
  what is outstanding.
- **Nothing calls a model and nothing is billed.** The extract file is filled in by whoever is doing
  the language, reading the rules above. A machine translation merged unread is exactly the
  "translated English" this skill exists to prevent.

## Where each kind of text lands

- **UI text** goes through `t()` and into `locales/en.json` first; that file is the source of truth
  for what keys exist. The other languages follow through the loop above, in the same change when
  the text is ready and in a later pass when it is not.
- **A prompt string** is English, and follows `docs/coding-guidelines/prompt-writing.md`: say what
  TO do rather than what to avoid. Do not rewrite a prompt that works; additive changes only.
- **A changelog entry** says what a person gets, not what the code does, and only for platform-level
  work.
- **A commit message** explains why the change exists and what it costs, in the same voice as the
  rest of this. It is the one piece of writing that is read years later by someone with no context.
