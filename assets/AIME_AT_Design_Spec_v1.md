# AIME AT — Design Spec v1.0
## "Piristysruisku" Redesign + Nanobanana 2 Hero Image Spec

**Author:** Jouni Miikki / Overscale Solutions Oy  
**Date:** 2026-03-13  
**Target:** aimeat.io portal landing page + overall visual identity refresh  
**Image generation:** Nanobanana 2 (Gemini 3.1 Flash Image) / Nanobanana Pro (Gemini 3 Pro Image)

---

## 0. NAMING CONVENTION

The brand name is written differently depending on context. This is not inconsistency — it is a hierarchy.

| Context | Form | Example |
|---------|------|---------|
| **Logo, header, hero, favicon, social** | **AIME♥AT** | The visual brand mark — sydän korvaa välilyönnin |
| **Running text, docs, email, pitch** | **AIME AT** | Kaksi sanaa, välilyönti. Oletuskirjoitusasu. |
| **Code, API, technical references** | `aimeat` | Lowercase, ei välilyöntiä |
| **URL** | aimeat.io | Domain-nimi, ei muuteta |
| **Spoken** | "aim-at" tai "ei-mei at" | Ei koskaan "AI-meat" |

**Miksi AIME AT eikä AIMEAT?** "AIMEAT" luetaan "AI-MEAT" englanniksi. "AIME AT" luetaan oikein: "aime" on ranskaa = rakastaa, "at" = johonkin suuntaan. AIME♥AT logossa sydän tekee tämän erottelun visuaalisesti.

**Sääntö:** Jos konteksti on visuaalinen (näkee sydämen) → AIME♥AT. Jos konteksti on teksti (luetaan) → AIME AT. Ei koskaan AIMEAT yhdyssanana.

---

## 1. DESIGN PHILOSOPHY — MIKSI VAALEA?

### Ongelma nyt
Nykyinen aimeat.io portal on tunkkainen, tumma ja tekninen. Tekstiä on vaikea lukea, sivusto ei kutsu sisään, eikä se kommunikoi AIME AT:n ydinsanomaa: **"Rakasta sitä mitä rakennat."**

### Benchmark-totuus
Menestyvät palvelut ovat vaaleita ja luettavia:
- **LinkedIn** — valkoinen, selkeä, luotettava
- **Notion** — lähes puhtaan valkoinen, typografia kantaa
- **Figma** — valkoinen pohja + väripläjäykset tuotteessa
- **Slack** — vaalea, lämmin, kutsuva
- **Airtable** — puhdas valkoinen + elävät väri-aksentit
- **HubSpot** — vaalean harmaa + oranssi energia
- **Stripe** — valkoinen + gradientin huippukäyttö

Tummia menestyviä palveluita on **lähinnä developer-toolit** (GitHub, Vercel, Linear) — ja ne puhuvat koodarille. AIME AT puhuu **ihmiselle** ja **ensikertaiselle AI-käyttäjälle**.

### Uusi linja
**Vaalea, energinen, lämmin.** Sivusto joka tuntuu kodin ovelta auki — ei serveriroomin käytävältä.

---

## 2. VÄRIPALETTI

### Päävärit

| Rooli | Väri | Hex | Käyttö |
|-------|-------|-----|--------|
| **Tausta** | Lämmin valkoinen | `#FAFAF8` | Pääasiallinen tausta |
| **Sydän / CTA** | Lämmin koralli-punainen | `#E8564A` | Sydän-ikoni, CTA-napit, aksentti |
| **Sydän glow** | Pehmeä ruusu | `#FF8A80` | Sydämen hehku/aura hero-kuvassa |
| **Primääri teksti** | Syvä charcoal | `#1A1A2E` | Otsikoiden ja leipätekstin väri |
| **Sekundääri teksti** | Lämmin harmaa | `#6B7280` | Alatekstit, kuvaukset |
| **Aksentti 1** | Elävä sininen | `#3B82F6` | Linkit, interaktiivisuus, tech-viittaukset |
| **Aksentti 2** | Lämmin keltainen | `#FBBF24` | Highlight, badge, huomio |
| **Aksentti 3** | Pehmeä minttu | `#34D399` | Onnistuminen, connected, live |
| **Pinta** | Vaaleanharmaa | `#F3F4F6` | Korttien taustat, sectionit |

### Gradientit

```
Hero-tausta:    linear-gradient(135deg, #FAFAF8 0%, #FFF1F0 50%, #EFF6FF 100%)
CTA-nappi:      linear-gradient(135deg, #E8564A 0%, #FF6B6B 100%)
Sydämen aura:   radial-gradient(circle, #FF8A8040 0%, #FF8A8000 70%)
```

### Kielletyt värit
- Ei puhdasta mustaa `#000000` — käytä aina `#1A1A2E`
- Ei puhdasta valkoista `#FFFFFF` taustana — käytä `#FAFAF8`
- Ei harmaata CTA-napeissa — aina väri

---

## 3. TYPOGRAFIA

| Elementti | Font | Koko | Paino | Väri |
|-----------|------|------|-------|------|
| **H1 Hero** | Inter tai Plus Jakarta Sans | 48-56px | 800 (extrabold) | `#1A1A2E` |
| **H2 Section** | Inter | 32-36px | 700 | `#1A1A2E` |
| **H3 Card** | Inter | 20-24px | 600 | `#1A1A2E` |
| **Body** | Inter | 16-18px | 400 | `#1A1A2E` |
| **Caption** | Inter | 14px | 400 | `#6B7280` |
| **CTA Button** | Inter | 16-18px | 700 | `#FFFFFF` |
| **Monospace** | JetBrains Mono | 14px | 400 | `#3B82F6` |

**Rivisväli:** 1.6 bodytekstissä, 1.2 otsikoissa.  
**Maksimirivipituus:** 65-75 merkkiä (luettavuuden vuoksi).

---

## 4. HERO SECTION — SYDÄN-KONSEPTI

### Idea

Sivuston hero-osio visualisoi AIME AT:n ydinidean:

> **"AIME♥AT"** — Love what you want to achieve.  
> Digitaalinen toimistotila, jossa ihmiset ja agentit rinnakkain elävät.

Keskellä on **tyylitelty sydän** (ei emoji, ei liian kirjaimellinen — orgaaninen, lämmin, hieman geometrinen). Sydämen sisällä tai päällä teksti **"AIME♥AT"** jossa sydän korvaa välilyönnin. Tämä on logomerkki, ei leipätekstimuoto.

### Sydämen ympärillä: Bubble Cloud

Sydämen ympärille asettuu 6-8 "bubblaa" tai "pilveä" — pyöreitä/orgaanisia muotoja, jotka kelluvat sydämen ympärillä kuin ajatuskuplia tai satelliitteja. Jokainen bubble edustaa yhtä AIME AT:n ydinkykyä:

#### Bubblet (myötäpäivään, klo 12:sta alkaen)

| # | Bubble-teksti | Ikoni-idea | Väri-aksentti | Kuvaus (tooltip/hover) |
|---|---------------|------------|---------------|------------------------|
| 1 | **Memory** | Aivot / muistipuu | `#3B82F6` sininen | "Your AI remembers what matters" |
| 2 | **Agents** | Robotti+ihminen rinnakkain | `#8B5CF6` violetti | "Humans and AI, side by side" |
| 3 | **Actions** | Salama / play-nappi | `#FBBF24` keltainen | "Publish, discover, get things done" |
| 4 | **Knowledge** | Kirja / paketti | `#34D399` minttu | "Curated knowledge, not noise" |
| 5 | **Federation** | Verkko / linkit | `#06B6D4` teal | "Connect nodes, grow the network" |
| 6 | **Apps** | Grid / rakennuspalikat | `#F472B6` pinkki | "Your apps, your data, your rules" |
| 7 | **Identity** | Sormenjälki / shield | `#E8564A` koralli | "Own your digital identity (GHII)" |
| 8 | **Community** | Ihmiset / keskustelu | `#FB923C` oranssi | "The network starts with you" |

#### Bubble-design

- **Muoto:** Ei täysin pyöreitä — hieman orgaanisia, "soft blob" -muoto, kuin pehmeät pilvet tai saippuakuplat
- **Koko:** Vaihteleva (40-80px), suurimmat lähimpänä sydäntä
- **Efekti:** Pehmeä varjo + hienovarainen glassmorphism (backdrop-blur, valkoinen 20% opacity border)
- **Animaatio (web):** Hidas kellunta/hengitys — bubblet nousevat ja laskevat hitaasti, kuin elävät
- **Yhteys sydämeen:** Ohuet, katkoviivaiset tai gradient-linjat sydämestä jokaiseen bubbleen — kuin energiavirta sydämestä

### Tekstielementit herossa

```
[Pieni label yläpuolella]
genesis-001 · The first node in the world

[H1 — iso, bold, keskitetty]
AIME♥AT
Love what you build.

[Subtitle — pienempi, lämmin harmaa]
A home for knowledge worth keeping.
Where humans and AI coexist, create, and connect.

[CTA-nappi — koralli gradient, pyöristetty]
→ Enter the Portal

[Pieni teksti napin alla]
Free to join · No credit card · Your data, your rules
```

---

## 5. NANOBANANA 2 IMAGE GENERATION PROMPTS

### 5A. Hero Image — Sydän + Bubblet (pääkuva)

**Aspect ratio:** 16:9 (hero banner)  
**Resolution:** 2K tai 4K  
**Tyyli:** Clean digital illustration, flat-ish design with subtle 3D depth

```
PROMPT (Nanobanana 2 / Nanobanana Pro):

Create a clean, modern digital illustration for a technology landing page 
hero section. Light warm white background (#FAFAF8) with a very subtle 
warm gradient transitioning to pale rose and pale blue at the edges.

In the center, a stylized heart shape — not a photorealistic heart, but 
a warm geometric-organic hybrid: smooth curves, slightly angular modern 
design, rendered in a warm coral-red gradient (#E8564A to #FF6B6B) with 
a soft glowing aura around it (pale rose #FF8A80 at 30% opacity). The 
heart should feel welcoming and tech-forward, not clinical or romantic.
Inside or overlaid on the heart, the text "AIME♥AT" in clean white 
bold sans-serif typography.

Surrounding the heart in an orbital arrangement, 8 floating soft-blob 
bubbles of varying sizes. Each bubble has a subtle glass morphism effect 
(slightly frosted, translucent white edges, soft shadow). The bubbles 
contain simple flat icons and short labels:

1. Blue bubble (#3B82F6): brain icon, label "Memory"
2. Purple bubble (#8B5CF6): robot-and-human icon, label "Agents"  
3. Yellow bubble (#FBBF24): lightning bolt icon, label "Actions"
4. Mint bubble (#34D399): book/package icon, label "Knowledge"
5. Teal bubble (#06B6D4): network nodes icon, label "Federation"
6. Pink bubble (#F472B6): grid/blocks icon, label "Apps"
7. Coral bubble (#E8564A): fingerprint/shield icon, label "Identity"
8. Orange bubble (#FB923C): people/chat icon, label "Community"

Thin, elegant dashed lines or subtle gradient energy lines connect each 
bubble to the central heart, suggesting flow and connection.

The overall style is modern SaaS illustration: clean, light, airy, 
professional but warm. Think Notion meets Figma meets Stripe aesthetic. 
No dark backgrounds. No cluttered elements. Generous whitespace. 
The mood is: "Welcome home. Build something amazing."

Do not include any UI chrome, browser frames, or mockup devices.
Ensure all text is legible and correctly spelled.
```

### 5B. Heart Close-up (itsenäinen ikoni / favicon-lähde)

**Aspect ratio:** 1:1  
**Resolution:** 2K  

```
PROMPT:

Create a minimal, modern heart icon for a technology brand called 
"AIME AT" (logo form: AIME♥AT). The heart is a stylized geometric-organic shape with smooth 
curves and slightly angular edges — a modern design heart, not a 
Valentine's heart. 

Color: warm coral-red gradient from #E8564A (top-left) to #FF6B6B 
(bottom-right). Soft glowing aura around it in pale rose (#FF8A80, 
20% opacity).

Inside the heart, the text "♥" or alternatively the letters "AI" in 
clean white, integrated naturally into the heart shape.

Background: pure white. No other elements. The heart should work as a 
standalone brand mark / app icon at any size from 16x16 to 512x512.

Clean vector-like rendering. No texture, no grain, no noise. Sharp 
edges with smooth anti-aliasing.
```

### 5C. Genesis Node Badge (genesis-001 visuaali)

**Aspect ratio:** 1:1  
**Resolution:** 1K  

```
PROMPT:

Create a digital badge or emblem for "genesis-001" — the first node 
in a global AI protocol network. The badge should feel like a 
prestigious origin marker: think mission patch meets tech startup 
launch badge.

Design: circular badge with a thin elegant border. Inside, a stylized 
network node symbol (a central dot with 3-4 radiating connection lines 
ending in smaller dots). Above the symbol, curved text "GENESIS-001". 
Below, "THE FIRST NODE" in smaller text.

Colors: warm coral (#E8564A) as primary accent, deep charcoal (#1A1A2E) 
for text, light warm white (#FAFAF8) background. A subtle golden accent 
(#FBBF24) for a thin ring or star element to convey "first/origin" 
status.

Style: clean, flat with subtle depth. No heavy 3D. Feels like a modern 
tech achievement badge. Should work at small sizes (64px) and large 
(512px).

White background, no other elements.
```

### 5D. Bubble Detail Images (yksittäiset bubblet)

**Aspect ratio:** 1:1  
**Resolution:** 1K  
**Generoi jokainen erikseen seuraavilla prompteilla:**

```
SHARED STYLE PREFIX (lisää jokaisen alkuun):

Create a single floating soft-blob bubble icon for a modern technology 
platform. The bubble has a subtle glassmorphism effect: slightly frosted 
translucent appearance, thin white border at 50% opacity, soft drop 
shadow. Inside the bubble is a simple, clean flat icon and a short 
label below it. White or very light warm background. No other elements.

BUBBLE 1 — MEMORY:
[Shared prefix] The bubble is tinted blue (#3B82F6 at 15% opacity). 
Icon: a minimalist brain or memory tree (simple branching structure). 
Label: "Memory" in clean dark sans-serif. The icon conveys "your AI 
remembers."

BUBBLE 2 — AGENTS:
[Shared prefix] The bubble is tinted purple (#8B5CF6 at 15% opacity). 
Icon: a minimalist robot face next to a human face silhouette, side by 
side. Label: "Agents". The icon conveys "humans and AI together."

BUBBLE 3 — ACTIONS:
[Shared prefix] The bubble is tinted warm yellow (#FBBF24 at 15% opacity). 
Icon: a lightning bolt or play button. Label: "Actions". The icon 
conveys "get things done."

BUBBLE 4 — KNOWLEDGE:
[Shared prefix] The bubble is tinted mint green (#34D399 at 15% opacity). 
Icon: an open book or a small cube/package. Label: "Knowledge". The 
icon conveys "curated, refined information."

BUBBLE 5 — FEDERATION:
[Shared prefix] The bubble is tinted teal (#06B6D4 at 15% opacity). 
Icon: three interconnected nodes (dots with lines). Label: "Federation". 
The icon conveys "connected network."

BUBBLE 6 — APPS:
[Shared prefix] The bubble is tinted pink (#F472B6 at 15% opacity). 
Icon: a 2x2 grid of squares (building blocks). Label: "Apps". The 
icon conveys "your tools, your rules."

BUBBLE 7 — IDENTITY:
[Shared prefix] The bubble is tinted coral (#E8564A at 15% opacity). 
Icon: a fingerprint or shield outline. Label: "Identity". The icon 
conveys "own your digital self."

BUBBLE 8 — COMMUNITY:
[Shared prefix] The bubble is tinted orange (#FB923C at 15% opacity). 
Icon: two-three human silhouettes with a chat bubble. Label: "Community". 
The icon conveys "the network starts with you."
```

---

## 6. SIVUSTON RAKENNE

### Navigation (sticky top bar)

```
[AIME♥AT]     Memory  Agents  Actions  Apps  Docs     [Enter Portal →]
```
- Vaalea tausta, pieni varjo scrollatessa
- Logo vasemmalla: `AIME♥AT` yhtenä tekstimerkkinä, sydän korallivärinen sanojen välissä (ei erillistä ikoniboxia)
- CTA oikealla
- Linkit keskellä, minimaalinen

### Sections (scroll-järjestys)

#### Section 1: Hero
- Sydän + bubblet (generoidut kuvat tai CSS/SVG-animaatio)
- Headline + subtitle + CTA
- Tausta: lämmin vaalea gradientti

#### Section 2: "What is AIME AT?"
- Yksi lause: *"A digital office space where humans and agents coexist and network with other offices."*
- 3 korttia rinnakkain:
  - 🏠 **Your Space** — "Memory, storage, identity — all yours"
  - 🤖 **Your Agents** — "AI that works with you, not for a corporation"
  - 🌐 **Your Network** — "Federate with other nodes, share what you choose"
- Tausta: `#F3F4F6` (vaaleanharmaa pinta)

#### Section 3: "The 8 Pillars"
- Bubbles uudelleen isompana — 2x4 tai carousel
- Jokainen klikkautuva, avaa lyhyen kuvauksen
- Tausta: valkoinen

#### Section 4: "Genesis Node"
- Genesis-001 badge (generoitu kuva)
- *"The first AIME AT node in the world. Running in Finland."*
- Live-tilastot: agents, memories, actions (haettu /v1/stats:sta)
- Tausta: lämmin vaalea gradientti

#### Section 5: "Get Started"
- 3 askelta: Register → Connect Your AI → Build
- Isot numerot (1, 2, 3) + lyhyet kuvaukset
- CTA: "Enter the Portal →"
- Tausta: `#F3F4F6`

#### Section 6: "Built for You"
- Kohderyhmäkortit:
  - 👤 **First-time AI Users** — "No code needed. Your AI, your way."
  - 🛠️ **Vibe Coders** — "One HTML file. Full AIME AT integration."
  - 🏢 **Organizations** — "Run your own node. Full sovereignty."
- Tausta: valkoinen

#### Section 7: Footer
- Logo + tagline: *"Jalostetun tiedon koti / A home for knowledge worth keeping"*
- Linkit: Docs · API · GitHub · Contact
- Genesis-001 badge pieni
- © Overscale Solutions Oy

---

## 7. KOMPONENTTI-DESIGN

### Kortit (cards)

```css
.card {
  background: #FFFFFF;
  border: 1px solid #E5E7EB;
  border-radius: 16px;
  padding: 32px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  transition: all 0.2s ease;
}
.card:hover {
  box-shadow: 0 8px 24px rgba(0,0,0,0.08);
  transform: translateY(-2px);
}
```

### CTA-napit

```css
.btn-primary {
  background: linear-gradient(135deg, #E8564A 0%, #FF6B6B 100%);
  color: #FFFFFF;
  font-weight: 700;
  padding: 14px 32px;
  border-radius: 12px;
  border: none;
  font-size: 16px;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(232, 86, 74, 0.3);
  transition: all 0.2s ease;
}
.btn-primary:hover {
  box-shadow: 0 6px 20px rgba(232, 86, 74, 0.4);
  transform: translateY(-1px);
}
```

### Bubblet (CSS-versio webissä)

```css
.bubble {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px;
  border-radius: 50%;
  backdrop-filter: blur(12px);
  background: rgba(255,255,255,0.6);
  border: 1px solid rgba(255,255,255,0.4);
  box-shadow: 0 4px 16px rgba(0,0,0,0.06);
  animation: float 6s ease-in-out infinite;
}
@keyframes float {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-8px); }
}
```

---

## 8. NANOBANANA WORKFLOW

### Generointijärjestys

1. **Heart close-up (5B)** — ensin, koska tätä käytetään ikonina ja referenssinä
2. **Genesis badge (5C)** — itsenäinen, ei riipu muista
3. **Individual bubbles (5D)** — kaikki 8 erikseen
4. **Hero composition (5A)** — viimeisenä, voit käyttää generoituja bubbleja referenssikuvina

### Vinkki Nanobanana Pro:lle

- Käytä "thinking mode" -tyyppistä promptaamista: kuvaile mitä haluat nähdä, älä listaa tageja
- Jos ensimmäinen tulos on 80% oikein, **editoi äläkä generoi uudelleen** — "Move the blue bubble slightly higher and make the heart glow brighter"
- Yhdistä valmiit bubblet hero-kuvaan referenssikuvina: lataa kaikki 8 bubblekuvaa + sydän → "Arrange these elements in an orbital layout around the heart on a warm white background"
- **Pyydä aina 16:9 hero-kuvalle** — se sopii suoraan full-width hero banneriksi

### Magenta Chroma Key -vaihtoehto (Aetheris-pipeline)

Jos haluat käsitellä kuvia ImageMagickilla jälkikäteen:
- Lisää promptiin: "Use a solid magenta background (#FF00FF) instead of white"
- Käytä sitten ImageMagick 6.9: `convert input.png -fuzz 10% -transparent "#FF00FF" output.png`
- Näin saat läpinäkyvän taustan bubbleille web-käyttöön

---

## 9. MOODBOARD-REFERENSSIT

### Visuaalinen tunnelma

| Referenssi | Mitä otetaan |
|------------|--------------|
| **Notion** | Puhtaus, whitespace, typografia kantaa |
| **Figma landing** | Väripläjäykset vaaleaa taustaa vasten, leikkisyys |
| **Stripe** | Gradient-käyttö, premium-tuntuma, selkeys |
| **Linear** | Modernit ikonit, hienovarainen glow |
| **Vercel** | Minimalismi, mutta AIME AT:ssa lämmin eikä kylmä |
| **Framer** | Landing page -rakenne, animaation vähäeleisyys |

### Mitä EI oteta

| Anti-referenssi | Miksi vältetään |
|-----------------|-----------------|
| **Enterprise-portaalit** | Liikaa informaatiota, ei tunnetta |
| **Crypto/Web3-sivut** | Liian tumma, liikaa efektejä, "bro"-vibes |
| **Generic AI-startupit** | Tummansiniset gradientit, ChatGPT-klooni-look |
| **90-luvun portaalit** | Information overload, ei hierarkiaa |

---

## 10. YHTEENVETO: GENEROINTILISTA

### Nanobanana 2/Pro -generointitehtävät

| # | Kuva | Koko | Formaatti | Prioriteetti |
|---|------|------|-----------|--------------|
| 1 | AIME♥AT Heart icon | 1:1 2K | PNG (transparent) | 🔴 Kriittinen |
| 2 | Genesis-001 Badge | 1:1 1K | PNG (transparent) | 🟡 Korkea |
| 3 | Bubble: Memory | 1:1 1K | PNG (transparent) | 🟡 Korkea |
| 4 | Bubble: Agents | 1:1 1K | PNG (transparent) | 🟡 Korkea |
| 5 | Bubble: Actions | 1:1 1K | PNG (transparent) | 🟡 Korkea |
| 6 | Bubble: Knowledge | 1:1 1K | PNG (transparent) | 🟡 Korkea |
| 7 | Bubble: Federation | 1:1 1K | PNG (transparent) | 🟡 Korkea |
| 8 | Bubble: Apps | 1:1 1K | PNG (transparent) | 🟡 Korkea |
| 9 | Bubble: Identity | 1:1 1K | PNG (transparent) | 🟡 Korkea |
| 10 | Bubble: Community | 1:1 1K | PNG (transparent) | 🟡 Korkea |
| 11 | Hero Composition (16:9) | 16:9 4K | PNG/JPG | 🔴 Kriittinen |
| 12 | OG Image (social share) | 1200x630 | PNG | 🟢 Normaali |

### Vaihtoehto: CSS/SVG bubblet

Bubblet voi olla myös **puhtaasti CSS/SVG** webissä — silloin ne animoituvat, ovat responsiivisia ja eivät vaadi kuvatiedostoja. Nanobanana-generoidut kuvat toimivat tällöin **moodboard-referensseinä** ja some-materiaaleina.

---

*"Jalostetun tiedon koti — A home for knowledge worth keeping."*
