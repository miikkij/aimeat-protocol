# AIME AT Portal Redesign — Full Instructions

## Context

AIME AT (AI Memory Exchange and Action Transfer) is an open protocol that lets any agent, app, or human share memory, do work, and exchange value — over plain HTTP, without any platform. The name reads as "AIME AT" — love towards what you do. The token economy runs on "morsels" (sydänmuruset / heart morsels) — small pieces of shared value and gratitude.

The current onboarding portal is developer-focused: it shows node IDs, agent counts, platform selection grids, and copy-paste prompts. This works for technical users but is completely incomprehensible to normal people.

**The goal: redesign the portal so that a non-technical person (like someone's mom) can understand what this is, try it immediately without registering, and progressively discover more.**

The existing developer portal must remain accessible but moves behind a toggle. The human-facing view becomes the default.

---

## Core Design Principles

1. **Show, don't explain** — no jargon, no "nodes", no "protocols". Speak in terms of what the person can DO.
2. **Try before you sign up** — Anonymous mode (Tier 0) lets anyone experiment immediately. No registration, no login, no fear.
3. **Progressive disclosure** — show 3 things first. When they try one, reveal more. Never show everything at once.
4. **Honest about limitations** — clearly state which AIs work well and which don't. This is also a living benchmark.
5. **Every action teaches** — after each success, explain what just happened and what they can do next.

---

## Page Structure

### Top Navigation

Left: 💝 AIME AT (logo with heart)
Right: Toggle between **Kokeile 💝** (default, human view) and **Kehittäjille 🛠️** (current developer portal)
Far right: Sign In / Profile (as currently)

### Hero Section (Human View)

**Main headline:**
> Sinun muistisi. Sinun AI:llesi.

**Subheadline:**
> Kerro asiat kerran — kaikki AI:si muistavat. Sinä päätät mitä jaetaan ja kenelle. Kokeile heti, ei tarvitse rekisteröityä.

---

## Three Main Paths (Card Layout)

Display as three large, clickable cards. Each card has an icon, title, one-sentence description, and a "Kokeile" button.

### Card 1: 💝 Muistot — "Kerro kerran, kaikki AI:si muistavat"

**Description:** Tallenna asioita itsestäsi — mitä tykkäät, missä asut, mitä teet. Jaa ne AI-avustajillesi niin sinun ei tarvitse selittää samoja asioita joka kerta.

**Click action:** Opens a simple view:
- Text field: "Kirjoita jotain mitä haluat AI:si muistavan"
- Examples as placeholder/chips: "Olen kasvissyöjä", "Asun Espoossa", "Pidän jazz-musiikista"
- Big button: "Tallenna muistiin 💝"
- After save: "✅ Muisto tallennettu! Tämä muisto on nyt saatavilla AI:lle jotka kytket tähän."

**AI Compatibility Notice (show after first save):**

> **Mitkä AI:t osaavat lukea muistisi automaattisesti?**
>
> ✅ **Toimii suoraan:** Grok ja Claude (maksulliset versiot) — hakevat muistosi automaattisesti kun annat niille osoitteen.
>
> ⚠️ **Toimii joskus:** DeepSeek — onnistuu toisinaan.
>
> ❌ **Eivät osaa vielä:** ChatGPT (ilmainen), Gemini — eivät ymmärrä pyyntöä.
>
> 💡 **Kiertotie kaikille:** Kopioi muistosi ja liitä se suoraan AI-keskusteluun — toimii aina, kaikkialla.

### Card 2: 🎮 Sovellukset — "Vastaa kysymyksiin, saat sovelluksen"

**Description:** Et tarvitse koodaustaitoja. Valitse mitä haluaisit tehdä, vastaa muutamaan kysymykseen, ja AI rakentaa sinulle sovelluksen. Avaat sen suoraan selaimesta — ja tieto tallentuu niin että se on saatavilla mistä tahansa.

**Click action:** Opens a category selection:
- 🎮 Pelit — "Haasta kaverisi moninpeliin"
- 📝 Muistiinpanot — "Pidä päiväkirjaa tai muistilistaa"
- 📊 Seurantatyökalut — "Seuraa tapoja, budjettia tai mitä vain"
- 👨‍👩‍👧‍👦 Perhetyökalut — "Jaettu kalenteri, ostoslista, viestit"
- 🎨 Luovat — "Tee kuvia, tarinoita tai muuta hauskaa"
- 🛠️ Oma idea — "Kerro mitä haluat ja AI rakentaa sen"

**After category selection:** Shows a prompt template the user can copy-paste into ANY AI chat. The prompt asks the AI to build the app using AIME AT memory as backend. All AIs can do this — it's just HTML/JS generation.

**Important note to display:**
> Sovelluksia voi rakentaa **millä tahansa AI:lla** — Claude, ChatGPT, Grok, Gemini, Copilot, DeepSeek, kaikki toimivat! Kokeile eri AI:lla ja näet mikä tekee parhaan tuloksen. Ulkoasu ja laatu vaihtelevat — se on osa hauskuutta.

**After first app is created:**
> 💡 **Tiesitkö?** Jokainen sovellus näyttää mikä AI sen rakensi. Kokeile samaa eri AI:lla ja vertaa tuloksia — tämä on elävä testi siitä mitkä AI:t ovat parhaita.

### Card 3: 🤝 Palvelut — "Auta muita tai pyydä apua"

**Description:** Tarvitsetko kuvan tekemistä, tekstin kääntämistä, tai apua jonkin tekemisessä? Laita pyyntö ja joku — ihminen tai AI — voi toimittaa sen sinulle. Osaatko itse jotain erityistä? Tarjoa se palveluna ja näy "keltaisilla sivuilla".

**Click action:** Two sub-options:
- **🙋 Tarvitsen apua** — "Kerro mitä tarvitset" → creates a work request
- **💪 Haluan auttaa** — "Kerro mitä osaat" → registers an action/service

**Examples to show:**
- "Tarvitsen tämän tekstin englanniksi" → pyyntö lähtee → joku kääntää → saat käännöksen
- "Osaan piirtää logoja" → näyt keltaisilla sivuilla → joku pyytää logoa → teet sen → saat sydänmurusia

---

## Morsels (Sydänmuruset) — Woven Throughout, Not Separate

Do NOT create a separate "morsels" section. Instead, show morsels naturally after each action:

**After saving a memory:**
> Tämä muisto maksoi yhden sydänmurusen 💝. Sinulla on 99 jäljellä.

**After creating an app:**
> Sovelluksesi käyttää sydänmurusia tallentaakseen ja hakeakseen tietoa.

**After completing a service for someone:**
> Sait 5 sydänmurusta 💝 kiitokseksi! Sinulla on nyt 105.

**After requesting a service:**
> Tämä pyyntö varasi 5 sydänmurusta. Ne siirtyvät tekijälle kun työ on valmis.

**Bottom of page, one summary sentence:**
> **Sydänmuruset ovat AIME AT:n tapa sanoa kiitos.** Saat 100 murusta alkuun — ilmaiseksi. Mitä enemmän jaat ja autat, sitä enemmän saat.

---

## Quick-Start Demo: Tic-Tac-Toe (Integrated into Apps Card)

The first option under "🎮 Pelit" should be a pre-built demo:

> **🎮 Kokeile heti: Ristinolla**
> Luo peli, lähetä linkki kaverille, pelaa. Alle 30 sekuntia.
> [Luo uusi peli]

This runs entirely on AIME AT anonymous memory. No registration needed. This is the "wow moment" that hooks people.

---

## After Each Successful Action: The Upgrade Nudge

After any anonymous action succeeds, show:

> ✅ Tämä toimi anonymous-tilassa — muistosi häviävät ajan myötä.
> **Haluatko pitää ne pysyvästi?** → [Luo ilmainen tili]

Not aggressive. Not blocking. Just a gentle note that there's more if they want it.

---

## "Mitä muuta voit tehdä?" (Expandable Section)

Below the three main cards, a collapsible section that reveals more:

- 📰 **Tilaa AI-uutiskooste** — Saa joka aamu tuoreimmat uutiset tiivistettynä AI:lla
- 📊 **Seuraa palvelintasi** — Näe serverisi terveys dashboardilta reaaliajassa
- 🌐 **Yhdistä useita AI-agentteja** — Anna kaikkien AI:desi jakaa sama muisti
- 🏪 **Selaa keltaisia sivuja** — Löydä palveluita ja tarjoa omiasi
- 🏗️ **Rakenna omia sovelluksia** — Kaikki mitä tarvitset on HTTP — ei backendiä, ei tietokantaa

Each item links to a step-by-step guide that starts: "Tee nämä 3 askelta..."

---

## Prompt Builder (New Feature — Critical)

This is the engine that makes the "Sovellukset" card work. A wizard that builds a ready-to-paste prompt based on user's choices. No coding knowledge needed. User answers questions, gets a prompt, pastes it into their AI chat, gets a working app back.

### Flow

**Step 1: Mitä haluat tehdä?** (Select one or more)

Large clickable cards:

- 💝 **Jakaa tietoa muille** — "Haluan laittaa jotain muiden saataville"
  - Examples: reseptikokoelma, tapahtumakalenteri, ilmoitustaulu, portfolio
  
- 🔒 **Tallentaa omaan käyttöön** — "Haluan pitää tietoa tallessa niin että pääsen siihen käsiksi mistä vain"
  - Examples: muistiinpanot, kirjanpito, terveyspäiväkirja

- 📊 **Seurata jotain automaattisesti** — "Haluan nähdä reaaliaikaista tietoa"
  - Examples: serverin status, kodin IoT-lämpötilat, sähkön hinta, sääennuste

- 🎮 **Pelata tai kilpailla** — "Haluan tehdä jotain hauskaa kavereiden kanssa"
  - Examples: moninpelit, tietovisat, haasteet, pistelistat

- 🤝 **Tarjota palvelua** — "Haluan auttaa muita ja saada sydänmurusia"
  - Examples: käännöspalvelu, kuvagenerointi, tekstintarkistus

- 🔧 **Automatisoida jotain** — "Haluan että jokin tapahtuu automaattisesti"
  - Examples: uutiskooste joka aamu, muistutukset, datan keräys

### Step 2: Tarkenna (dynamic follow-ups based on Step 1)

**If "Jakaa tietoa muille":**
- Mitä haluat jakaa? [vapaa teksti]
- Kuka saa nähdä? → Kaikki / Vain linkin saaneet / Vain rekisteröityneet
- Päivittyykö tieto? → Kerran / Silloin tällöin / Jatkuvasti

**If "Tallentaa omaan käyttöön":**
- Millaista tietoa? [vapaa teksti]
- Käytätkö puhelimella vai tietokoneella? → Puhelin / Tietokone / Molemmat

**If "Seurata jotain automaattisesti":**
- Mitä haluat seurata? [vapaa teksti]
- Mistä tieto tulee? → Internetistä / Omalta laitteelta / Manuaalisesti
- Kuinka usein päivittyy? → Reaaliajassa / Tunneittain / Päivittäin

**If "Pelata tai kilpailla":**
- Minkälaista peliä? → Vuoropohjainen / Reaaliaikainen / Tietovisa / Muu
- Kuinka monta pelaajaa? → 2 / 3-6 / Rajaton
- Tarvitaanko pistelistaa? → Kyllä / Ei

**If "Tarjota palvelua":**
- Mitä osaat? [vapaa teksti]
- Hinta sydänmurusina? → Ilmainen / 1-5 / 5-20 / Yli 20

**If "Automatisoida jotain":**
- Mitä pitäisi tapahtua? [vapaa teksti]
- Milloin? → Joka aamu / Tunneittain / Kun jotain tapahtuu
- Minne tulos tulee? → AIME AT muistiin / Telegram / Selainnäkymä

### Step 3: Valitse AI (with honest contextual ratings)

Show AI platform icons with ratings specific to what the user is building:

**For apps needing direct memory access:**
- Claude ⭐⭐⭐ "Paras — lukee ja kirjoittaa muistia suoraan"
- Grok ⭐⭐⭐ "Erinomainen — toimii suoraan"
- Others ⭐⭐ "Toimii sovelluksen kautta, ei suoraan"

**For pure app building:**
- Claude ⭐⭐⭐ "Kauneimmat sovellukset"
- Grok ⭐⭐⭐ "Hyvä laatu ja nopea"
- ChatGPT ⭐⭐ "Toimiva mutta yksinkertaisempi ulkoasu"
- DeepSeek ⭐⭐ "Hyvä koodi, yksinkertainen ulkoasu"
- Gemini ⭐ "Vaihteleva laatu"

**For automation:**
- Claude ⭐⭐⭐ "Paras monimutkaisiin automaatioihin"
- OpenClaw ⭐⭐⭐ "Tehty automaatioita varten"
- Grok ⭐⭐⭐ "Erinomainen"

### Step 4: Generated Prompt

System generates a complete, ready-to-paste prompt containing:

1. **AI-specific preamble** — tuned per platform's strengths
2. **AIME AT context** — node URL, API structure, auth level
3. **Use case specification** — from user's answers
4. **Output format** — "single HTML file", "mobile-friendly", etc.
5. **AIME AT integration snippets** — pre-built fetch calls for memory read/write
6. **Quality instructions** — visual style, dark theme, animations

**AI-specific preambles (prepended based on Step 3):**

Claude:
```
Sinulla on pääsy AIME AT -muistiin. Voit lukea ja kirjoittaa suoraan. Käytä fetch() kutsuja. Tee kaikki yhdeksi HTML-tiedostoksi. Priorisoi visuaalinen laatu — käytä CSS-animaatioita, gradientteja ja huoliteltua typografiaa.
```

Grok:
```
Käytä AIME AT -muistia HTTP-kutsuilla. Kaikki koodi yhteen HTML-tiedostoon. Selitä lyhyesti mitä teit ja anna tiedosto ladattavaksi.
```

ChatGPT:
```
Käytä seuraavaa REST APIa tiedon tallentamiseen ja lukemiseen. Huom: et voi kutsua APIa suoraan — luo HTML-tiedosto joka tekee kutsut selaimesta. Kaikki yhdessä tiedostossa.
```

Copilot:
```
Luo HTML-sovellus joka käyttää seuraavaa REST APIa. Kaikki koodi yhteen tiedostoon. Älä käytä PowerShelliä — tee selaimessa toimiva ratkaisu.
```

**Example generated prompt (IoT temperature tracker, Claude):**
```
Rakennetaan AIME AT -sovellus.

AIME AT on jaetun muistin protokolla. API:

POST /v1/memory → { "key": "iot.temp.living-room", "value": "22.5°C", "visibility": "private" }
GET /v1/memory/iot.temp.living-room
GET /v1/memory?prefix=iot.temp

Tehtävä: Luo HTML-sivu joka:
1. Näyttää kodin lämpötilat eri huoneista
2. Hakee tiedot AIME AT muistista 30s välein
3. Näyttää lämpötilakäyrän viimeiseltä 24h
4. Mahdollistaa uusien mittauspisteiden lisäämisen
5. Toimii puhelimella ja tietokoneella
6. Tumma teema, visuaalisesti näyttävä

Base URL: https://aimeat.spechops.com
Tee yksi HTML-tiedosto joka toimii avaamalla selaimessa.
```

### Step 5: Copy & Go

Big screen with generated prompt:

- **[Kopioi prompti 📋]** — copies to clipboard
- **Direct links:** "Avaa Claude →", "Avaa ChatGPT →", "Avaa Grok →" etc.
- **Instructions:** "1. Kopioi. 2. Avaa AI-chatti. 3. Liitä ja lähetä. 4. Saat sovelluksen!"
- **Return flow:** "Saitko sovelluksen? → [Lataa se tänne ja jaa muille 🎉]" → uploads to app gallery

### Prompt Builder — UX Notes

- Maximum 5 clicks from start to generated prompt
- Steps feel like a conversation, not a form
- Allow "back" without losing answers
- Show "Others built these with similar choices:" → app gallery links
- Save generated prompts to memory so user can find them later
- Templates stored as `prompts.builder.*` — versioned, improvable over time

---

## App Gallery (New Feature)

Add a section (or separate page) that displays all apps created on this node:

- Thumbnail/screenshot of the app
- Title and short description
- **Which AI built it** (tagged: "Built with Claude", "Built with Grok", etc.)
- Creator (anonymous or GHII if registered)
- Morsels earned / usage count
- "Try it" and "Share" buttons

This serves three purposes:
1. **Inspiration** — "Look what others built, I want to try too"
2. **Living benchmark** — you can visually compare which AI produces better apps
3. **Growth engine** — people share their apps → friends discover AIME AT → create their own

Sort options: Newest, Most popular, By AI platform

---

## Developer Toggle (Existing Portal)

The current portal (node info, agent count, platform grid, copy-paste prompt, technical stats) becomes accessible via the "Kehittäjille 🛠️" toggle. No changes needed to this view — it's already good for its audience.

Add to developer view footer:
> Tämä on tekninen näkymä. [Vaihda ihmisnäkymään →]

---

## AI Compatibility Matrix (Reference — Show Contextually)

Do NOT show this as a big table upfront. Show relevant parts contextually when needed. But for reference, the full matrix is:

| Ominaisuus | Claude | Grok | ChatGPT | Gemini | DeepSeek | Copilot | LM Studio | OpenClaw |
|---|---|---|---|---|---|---|---|---|
| **Muistin luku/kirjoitus** | ✅ | ✅ | ❌ | ❌ | ⚠️ | ❌ | ✅ (MCP) | ✅ |
| **Sovellusten luonti** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Laatu (sovellukset)** | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐ | ⭐⭐ | ⭐⭐ | ⭐⭐ | ⭐⭐ |
| **Actions/palvelut** | ✅ appin kautta | ✅ appin kautta | ✅ appin kautta | ✅ appin kautta | ✅ appin kautta | ✅ appin kautta | ✅ appin kautta | ✅ appin kautta |

**Key insight to communicate:** Memory access is limited to the smartest AIs. But app creation works with ALL AIs. And the quality difference is visible — this is a living, honest benchmark.

---

## Language & Tone

- Finnish by default (detect browser language, offer EN)
- No jargon: no "node", "endpoint", "protocol", "API", "federation"
- Warm, encouraging, playful
- "sinä" form, not "te"
- Emojis sparingly but consistently (💝 for morsels, ✅ for success, 🎮 for games)
- Short sentences. One idea per sentence.

### Words to NEVER use in human view:
- Node → "muistipaikka" or just don't mention it
- Endpoint → don't mention
- Protocol → don't mention
- API → don't mention
- Federation → don't mention
- Memory key-value → "muisto"
- Optimistic locking → don't mention
- Tier → don't mention, just show what's possible
- Agent → "AI-avustaja" or just "AI"
- Morsel → "sydänmurunen" (always with 💝)

### Words to USE:
- Muisto (memory)
- Sovellus (app)
- Palvelu (service)
- Sydänmurunen 💝 (morsel)
- Jakaa (share)
- Tallentaa (save)
- Kokeile (try)
- Ilmainen (free)

---

## Technical Implementation Notes

- The human view and developer view share the same backend — it's just different frontend presentation
- Anonymous mode (Tier 0/0.5) handles all "try it now" functionality
- No new endpoints needed — everything uses existing AIME AT memory API
- Apps are static HTML files that call AIME AT memory API directly from the browser
- The app gallery needs a new memory namespace (e.g., `apps.gallery.*`) to store app metadata
- Tic-tac-toe demo should be pre-deployed and always available as `games.ttt.*`

---

## Visual Design Direction

- Keep the current space theme and color palette — it's beautiful
- Hearts (💝) are the primary icon, consistent with AIME AT brand
- Cards should be large, clickable, with clear hover states
- Mobile-first — many people will discover this on phone
- Loading states should show heart animations
- Success states should show heart particles or confetti

---

## Summary of Changes

1. **New default view:** Human-facing portal with three cards (Muistot, Sovellukset, Palvelut)
2. **Try without registration:** Anonymous mode is the default entry point
3. **Progressive disclosure:** Show 3 things → try one → show more
4. **Honest AI compatibility:** Show which AIs work for what, contextually
5. **App gallery:** Display all created apps, tagged by AI platform — living benchmark
6. **Morsels woven in:** Not a separate section, appears naturally after actions
7. **Upgrade nudge:** Gentle "keep your data" prompt after anonymous actions succeed
8. **Developer toggle:** Current portal preserved, accessible via toggle
9. **Language cleanup:** Zero jargon in human view

---

## Implementation Priority

1. First: Hero section + three cards + anonymous memory save (core experience)
2. Second: Tic-tac-toe quick demo (wow moment)
3. Third: **Prompt Builder wizard** (the self-service engine — this is what makes apps card actually work)
4. Fourth: App gallery with AI platform tagging (growth engine + living benchmark)
5. Fifth: Services/Actions marketplace (keltaiset sivut)
6. Last: Morsels polish and upgrade nudges

---

## One-Line Summary

**AIME AT portaali muuttuu "valitse alustasi" -sivusta "kokeile heti" -kokemukseksi jossa normaali ihminen tallentaa muiston, pelaa ristinollaa tai rakentaa sovelluksen — ilman rekisteröitymistä, ilman jargonia, alle minuutissa.**
