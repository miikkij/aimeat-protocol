# AIME AT Portal Redesign — Design Document

**Date:** 2026-02-28
**Status:** Approved
**Author:** User (full spec provided)

## One-Line Summary

AIME AT portaali muuttuu "valitse alustasi" -sivusta "kokeile heti" -kokemukseksi jossa normaali ihminen tallentaa muiston, pelaa ristinollaa tai rakentaa sovelluksen — ilman rekisterointia, ilman jargonia, alle minuutissa.

## Context

The current onboarding portal is developer-focused: node IDs, agent counts, platform selection grids, copy-paste prompts. This works for technical users but is incomprehensible to normal people.

The goal: redesign so that a non-technical person can understand what this is, try it immediately without registering, and progressively discover more.

The existing developer portal remains accessible behind a toggle. The human-facing view becomes the default.

## Core Design Principles

1. **Show, don't explain** — no jargon, no "nodes", no "protocols". Speak in terms of what the person can DO.
2. **Try before you sign up** — Anonymous mode (Tier 0) lets anyone experiment immediately.
3. **Progressive disclosure** — show 3 things first. When they try one, reveal more.
4. **Honest about limitations** — clearly state which AIs work well and which don't. Living benchmark.
5. **Every action teaches** — after each success, explain what happened and what to do next.

## Page Structure

### Top Navigation

- Left: AIME AT (logo with heart)
- Center: Toggle between "Kokeile" (default, human view) and "Kehittajille" (developer portal)
- Right: Sign In / Profile

### Hero Section (Human View)

**Main headline:** Sinun muistisi. Sinun AI:llesi.
**Subheadline:** Kerro asiat kerran — kaikki AI:si muistavat. Sina paatat mita jaetaan ja kenelle. Kokeile heti, ei tarvitse rekisteroitya.

### Three Main Cards

#### Card 1: Muistot — "Kerro kerran, kaikki AI:si muistavat"

- Text field to save a memory
- Example chips: "Olen kasvissyoja", "Asun Espoossa", "Pidan jazz-musiikista"
- After save: shows AI compatibility notice (which AIs can read memories)

#### Card 2: Sovellukset — "Vastaa kysymyksiin, saat sovelluksen"

- Category selection: Pelit, Muistiinpanot, Seurantatyokalut, Perhetyokalut, Luovat, Oma idea
- Prompt template for any AI to build the app
- Pre-built tic-tac-toe demo as immediate wow moment

#### Card 3: Palvelut — "Auta muita tai pyyda apua"

- "Tarvitsen apua" (request work)
- "Haluan auttaa" (offer service)
- Examples of services

### Morsels — Woven Throughout

Not a separate section. Shown naturally after each action:
- After memory save: "Tama muisto maksoi yhden sydanmurusen. Sinulla on 99 jaljella."
- After app creation: "Sovelluksesi kayttaa sydanmurusia tallentaakseen tietoa."
- After completing service: "Sait 5 sydanmurusta kiitokseksi!"

### Upgrade Nudge (After Anonymous Actions)

Gentle: "Tama toimi anonymous-tilassa — muistosi haviavat ajan myota. Haluatko pitaa ne pysyvasti?" -> [Luo ilmainen tili]

### Developer Toggle

Current portal preserved as-is. Accessible via toggle.

## Language & Tone

- Finnish by default (detect browser language, offer EN)
- No jargon ever in human view
- Warm, encouraging, playful, "sina" form
- Short sentences, one idea per sentence

### Banned words (human view)

Node, Endpoint, Protocol, API, Federation, Agent, Tier, Key-value, Optimistic locking

### Use instead

Muisto, Sovellus, Palvelu, Sydanmurunen, Jakaa, Tallentaa, Kokeile, Ilmainen, AI-avustaja

## Implementation Priority

1. Hero section + three cards + anonymous memory save (core experience)
2. Tic-tac-toe quick demo (wow moment)
3. App category selection + prompt templates (self-service apps)
4. App gallery (growth engine)
5. Services/Actions marketplace
6. Morsels polish and upgrade nudges

## Technical Notes

- Human view and developer view share the same backend
- Anonymous mode (Tier 0/0.5) handles all "try it now" functionality
- No new endpoints needed — uses existing AIME AT memory API
- Apps are static HTML files calling memory API from browser
- Keep current space theme and color palette
- Mobile-first
