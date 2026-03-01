# Research Documents Design

*2026-03-01 — Design for two research documents in `docs/research/`*

---

## Overview

Two Finnish-language research documents exploring how AIMEAT enables human self-organization through AI federation and restores the ownership/community spirit lost since the BBS/early internet era.

## Document 1: `docs/research/soluuntuminen-ja-discovery.md`

**Title:** Soluuntuminen — Kuinka ihmiset organisoituvat AI-federaation kautta

**Purpose:** Explore how humans can "cellularize" through AIMEAT — each person is a cell, organisms form through collaboration and discovery.

**Sections:**
1. Johdanto: Soluuntumisen filosofia
2. Kolme persoonaa (Antti/kotikäyttäjä, Liisa/devaaja, Erkki/ei-tekninen)
3. User journey: Antti — yksityinen harjoittelija (LM Studio, private-first)
4. User journey: Liisa — oma node federaatioon (marketplace, services)
5. User journey: Erkki — helppous ensin (web portal, AI-suosittelut)
6. Gap-analyysi: mitä AIMEAT:lla on vs. mitä puuttuu discoveryyn
7. Arkkitehtuuriehdotukset: discovery-mekanismit (hakemistot, matchaus, AI-suosittelu)
8. Skenaariot: soluista organismiksi (3 concrete examples)
9. Yhteenveto ja seuraavat askeleet

**Key deliverables:**
- Concrete persona profiles with user journeys
- Gap analysis table (existing AIMEAT features vs. missing discovery features)
- Architecture proposals for directories, matching, AI recommendations
- Scenarios showing cell → organism formation

## Document 2: `docs/research/bbs-aikakaudesta-ai-aikaan.md`

**Title:** BBS-aikakaudesta AI-aikaan — Mitä menetettiin, mitä palautetaan, ja kuinka rakennetaan tietolompakko

**Purpose:** Draw parallels between 90s internet/BBS culture and today's AI boom, propose a consent-based data wallet for AIMEAT.

**Sections:**
1. Johdanto: Internet ennen korporaatioita
2. Mitä ihmiset tekivät 90-luvun lopussa (BBS, kotisivut, IRC, webringit)
3. Mitä menetettiin — ja miksi se merkitsee (ownership, discovery, community, identity, trust)
4. AI-boomi 2024-2026: uusi mahdollisuus (OpenClaw, LM Studio, agentit)
5. AIMEAT vastaa AI-ajan haasteisiin (personal node, federation, morsels, boards)
6. Turvallinen AI-tutustuminen — mystisen turvattomuuden poistaminen
7. Tietolompakko: consent-hallinta AIMEAT:ssa
   - 7.1 Historiallinen konteksti
   - 7.2 Olemassaolevat standardit (W3C VC, Solid, MyData, EU Digital Identity Wallet)
   - 7.3 AIMEAT:n nykyinen malli + puutteet
   - 7.4 Ehdotus: AIMEAT Consent Layer
8. Visio: miltä näyttää kun kaikki toimii
9. Yhteenveto ja suositukset

**Key deliverables:**
- BBS/90s → Corporate → AIMEAT mapping table (extends existing BBS heritage doc)
- Barriers comparison: 90s barriers vs. AI-era barriers
- Standards survey (W3C VC, Solid, MyData, EU DIW)
- AIMEAT Consent Layer proposal with memory-based consent profiles
- End-to-end vision narrative

## Language & Style

- **Finnish** — natural voice matching the founder's vision
- **Style:** Research document with concrete examples, not academic paper
- **Tone:** Passionate but grounded — this is a movement, backed by architecture
- **References:** Link to existing AIMEAT docs where relevant

## Dependencies

- `docs/bbs-to-aimeat-heritage-document-en.md` — BBS mapping (primary source for doc 2)
- `docs/nextlevel/aimeat-personal-node-spec.md` — Personal node architecture
- `docs/ghii-identity-and-network-plan.md` — GHII identity system
- `docs/05-federation.md` — Federation mechanics
- `docs/nextlevel/aimeat-use-cases.md` — Existing use cases
