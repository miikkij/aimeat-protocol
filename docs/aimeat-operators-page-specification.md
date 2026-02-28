# AIME AT Operators Page — Full Specification

## Context

This is the Tier 2 view of the AIME AT portal. The portal has four audience tiers:

| Tier | Audience | Portal View | Entry Point |
|---|---|---|---|
| 0 | Normal people | **Kokeile 💝** (default) | No registration needed |
| 1 | Developers & technical users | **Kehittäjille 🛠️** | GHII Tier 1 (self-verified) |
| 2 | Operators | **Operaattoreille ⚡** | GHII Tier 2 (strong verification) |
| 3 | Autonomous AI agents | No portal — API only | GAII registration via operator |

The operators page is where people join the AIME AT federation by contributing resources, infrastructure, and expertise. This is NOT a self-service signup — every operator is screened, scored, and manually approved.

---

## Who Is an Operator?

An operator is someone who contributes infrastructure to the AIME AT federation. Three types:

### Mirror / Storage Node

**Who:** Anyone with spare hardware — a mini PC running OpenClaw, a NAS, a Raspberry Pi, a home server. They don't need to understand the protocol deeply. They need to run one command.

**What they do:** Mirror genesis data, provide redundant storage, expand the shared memory space. Their node becomes part of the distributed memory fabric. OpenClaw and other local AI tools can immediately use the local node.

**Technical requirement:** Minimal. Run a Docker container or a single binary. One command joins the federation.

**Example scenario:** Someone bought a Mac Mini for OpenClaw. It has 512GB SSD and 16GB RAM, mostly idle. They run `aimeat join --mirror` and their machine is now part of the federation, serving cached memories to local AI agents with millisecond latency instead of routing to genesis.

**Morsel compensation:** Small share based on traffic served and storage contributed. Passive income — set it and forget it.

### Federation Node

**Who:** Technical person who understands the protocol. Wants to run an independent node with their own users, their own rules, their own community — but connected to the wider AIME AT network.

**What they do:** Run a full AIME AT node. Have their own agents, their own memory space, their own morsel economy. Sync with genesis and other federation nodes. Essentially: they ARE a SysOp.

**Technical requirement:** Significant. Must understand HTTP APIs, node configuration, federation protocol, trust model. Should have reliable hosting infrastructure.

**Example scenario:** A company wants private AI agent memory for their team but also wants agents to access the wider federation when needed. They run a federation node behind their firewall with selective sync to genesis.

**Morsel compensation:** Larger share. Own morsel economy plus federation revenue from cross-node traffic.

### Gateway Node

**Who:** Someone who builds a specialized integration between AIME AT and another platform or protocol.

**What they do:** Bridge AIME AT to specific ecosystems — MCP servers, Telegram bots, IoT platforms, home automation, industry-specific tools. They don't store the full memory — they translate and route.

**Technical requirement:** Deep expertise in both AIME AT and the target platform. Must maintain the integration over time.

**Example scenario:** Someone builds an AIME AT ↔ Home Assistant gateway that lets home IoT sensors write temperature, humidity, and energy data directly into AIME AT memory, accessible to any AI agent on the federation.

**Morsel compensation:** Based on service usage. High-traffic gateways earn proportionally.

---

## Prerequisites — Non-Negotiable

### 1. GHII on Genesis (Required for ALL operator types)

The applicant MUST have an existing GHII (Global Human Intelligence ID) registered on the genesis node. This means:

- They have been a Tier 0 or Tier 1 user first
- They have actual history on the platform — memories written, apps used, morsels earned/spent
- They are a known entity, not a stranger walking in from nowhere

**Why:** The path is always user → developer → operator. You cannot operate infrastructure for a community you've never participated in. This also creates a natural audit trail — we can see their behavior before they had elevated privileges.

**Minimum activity thresholds (suggested, tunable):**

- Account age: 30+ days
- Memories written: 10+
- At least one app created or service provided
- Morsel balance: positive (not depleted)
- No trust score penalties

### 2. Real Identity (Required for Federation and Gateway nodes)

Federation and Gateway operators must complete Tier 2 verification:

- Strong identity: bank ID, eIDAS, passport verification
- Verified domain ownership (for the node's public URL)
- Verifiable professional background (LinkedIn, GitHub, company registration)

**Mirror nodes** can operate with Tier 1 (self-verified email + key) since they don't make trust decisions — they only cache and serve.

### 3. Infrastructure (Required for ALL)

Must demonstrate they have actual infrastructure to contribute:

- Mirror: at minimum, always-on machine with stable internet, 50GB+ storage
- Federation: dedicated server/VPS, domain, TLS, 99%+ uptime capability
- Gateway: hosting for the integration + maintenance commitment

---

## The Operators Page — UX Specification

### Hero Section

**Headline:**
> ⚡ Liity AIME AT -federaatioon operaattoriksi

**Subheadline:**
> Tarjoa resursseja, laajenna verkkoa ja ansaitse sydänmurusia. Jokainen operaattori käy läpi tarkistusprosessin — haluamme rakentaa luotettavan federaation, ei nopeaa.

**Tone:** Professional but warm. This is an application, not a shopping cart. The vibe is "join our crew" not "buy our product."

### Three Operator Cards

Display three cards side by side, similar to the human view's three-card layout:

**📦 Mirror / Storage Node**
> "Jaa koneesi resurssit — yksi komento riittää"
> 
> Sinulla on kone joka on päällä. Liitä se osaksi AIME AT:n jaettua muistia. Paikalliset AI-agentit saavat välittömän pääsyn muistiin ilman viivettä genesiksen kautta.
>
> Vaatii: Tier 1 GHII + kone jossa tilaa ja netti
> Ansaitset: Sydänmurusia liikenteen ja tallennustilan mukaan
>
> [Hae Mirror-operaattoriksi →]

**🌐 Federation Node**
> "Pyöritä oma nodesi — omat säännöt, oma yhteisö"
>
> Rakennat ja ylläpidät oman AIME AT -noden. Omat käyttäjät, oma muistiavaruus, omat agentit — synkronoituna muun federaation kanssa. Sinä olet SysOp.
>
> Vaatii: Tier 2 GHII + tekninen osaaminen + oma infra
> Ansaitset: Oma morsel-talous + osuus federaatioliikenteestä
>
> [Hae Federation-operaattoriksi →]

**🔌 Gateway Node**
> "Yhdistä AIME AT johonkin uuteen"
>
> Rakennat sillan AIME AT:n ja toisen alustan välille — Telegram, Home Assistant, MCP, IoT, mikä tahansa. Erikoisosaamisesi avaa federaation uusille käyttäjille.
>
> Vaatii: Tier 2 GHII + syvä osaaminen kohdealustasta
> Ansaitset: Sydänmurusia palvelun käytön mukaan
>
> [Hae Gateway-operaattoriksi →]

### Application Form

When user clicks "Hae operaattoriksi", they get a form that adapts based on the operator type selected. The form is structured as a conversation, not a bureaucratic wall of fields.

**Common fields (all types):**

```
GHII-tunnuksesi: [auto-filled if logged in]
Nimi: [auto-filled from GHII]
Miksi haluat liittyä operaattoriksi? [free text, 2-3 sentences minimum]
```

**Mirror-specific:**

```
Laitteisto: [free text — what machine, how much storage, what connection]
Sijainti: [country/city — for latency optimization]
Onko kone päällä 24/7? [Yes / Most of the time / Only when I'm home]
Käytätkö OpenClaw:ia tai muuta paikallista AI:ta? [Yes / No / What's that?]
```

**Federation-specific:**

```
Tekninen taustasi: [free text]
GitHub/GitLab profiili: [URL]
LinkedIn tai muu ammatillinen profiili: [URL]
Domain jonka aiot käyttää: [URL]
Hosting-infra: [provider, location, specs]
Millaisen yhteisön haluat rakentaa nodellesi? [free text]
Oletko ylläpitänyt palvelimia aiemmin? [free text]
```

**Gateway-specific:**

```
Mikä alusta/palvelu? [free text]
Tekninen taustasi tällä alustalla: [free text]
GitHub/GitLab profiili: [URL]
Onko sinulla toimiva prototyyppi? [Yes + URL / Not yet]
Miten ylläpidät integraatiota pitkällä aikavälillä? [free text]
```

### After Submission — What the Applicant Sees

```
✅ Hakemuksesi on vastaanotettu!

Tarkistamme hakemuksesi seuraavien päivien aikana. Prosessi:

1. ✅ Hakemus vastaanotettu
2. ⏳ AI-analyysi (automaattinen taustatarkistus)
3. ⏳ Moderaattorin arviointi
4. ⏳ Päätös: hyväksytty / lisätietoja / hylätty

Saat ilmoituksen AIME AT -muistiisi ja sähköpostiisi.

Keskimääräinen käsittelyaika: 1-3 päivää.
```

---

## AI Screening Process — Backend Specification

### What AI Checks Automatically

When an application is submitted, the screening AI performs the following checks and generates a score report:

**1. GHII History Analysis (weight: 30%)**
- Account age (days since registration)
- Activity level: memories written, read, shared
- Morsel balance and transaction history
- Trust score trajectory (rising, stable, declining)
- Any flags or penalties in history
- Score: 0-100

**2. Identity Verification (weight: 25%)**
- GHII tier level (must be ≥1 for mirror, ≥2 for federation/gateway)
- For Tier 2: eIDAS/bank ID verification status
- Domain whois check: age, registrar, history, privacy
- LinkedIn profile: real person, employment history, connections count
- GitHub profile: account age, repos, contribution graph, stars
- Score: 0-100

**3. Infrastructure Assessment (weight: 20%)**
- For mirror: ping test to provided IP/domain, estimate connection quality
- For federation: domain DNS check, TLS capability, provider reputation
- For gateway: prototype URL test (if provided), platform API knowledge check
- Score: 0-100

**4. Motivation & Red Flag Analysis (weight: 15%)**
- NLP analysis of free-text answers
- Red flags: copy-pasted generic text, contradictory statements, urgency signals
- Green flags: specific plans, community references, technical detail, genuine enthusiasm
- Cross-reference: does motivation match their actual GHII activity?
- Score: 0-100

**5. Cross-Reference Check (weight: 10%)**
- Is the email domain consistent with LinkedIn/GitHub?
- Does the stated location match IP geolocation?
- Any duplicate applications from same infrastructure?
- Any known bad actors in the same IP range/provider?
- Score: 0-100

### Score Calculation

```
Total Score = (GHII × 0.30) + (Identity × 0.25) + (Infra × 0.20) + (Motivation × 0.15) + (CrossRef × 0.10)
```

### Output to Moderator Dashboard

AI produces a structured report for each application:

```
╔══════════════════════════════════════════════╗
║  OPERATOR APPLICATION REVIEW                  ║
║  Applicant: [name] (GHII-xxxx-xxxx)          ║
║  Type: Federation Node                        ║
║  Applied: 2026-03-15                          ║
╠══════════════════════════════════════════════╣
║                                               ║
║  OVERALL SCORE: 78/100  🟡 REVIEW RECOMMENDED ║
║                                               ║
║  GHII History:     85/100  🟢                 ║
║  Identity:         72/100  🟡                 ║
║  Infrastructure:   90/100  🟢                 ║
║  Motivation:       68/100  🟡                 ║
║  Cross-Reference:  80/100  🟢                 ║
║                                               ║
║  RED FLAGS: 0                                 ║
║  YELLOW FLAGS: 2                              ║
║  - LinkedIn has only 43 connections           ║
║  - Motivation text is brief (2 sentences)     ║
║                                               ║
║  AI RECOMMENDATION: APPROVE WITH EXTENDED     ║
║  PROBATION (60 days instead of 30)            ║
║                                               ║
║  [APPROVE]  [REQUEST MORE INFO]  [REJECT]     ║
╚══════════════════════════════════════════════╝
```

### Decision Thresholds (Suggested)

| Score Range | Color | AI Recommendation |
|---|---|---|
| 85-100 | 🟢 Green | Auto-recommend approval, standard 30-day probation |
| 65-84 | 🟡 Yellow | Review recommended, highlight concerns |
| 40-64 | 🟠 Orange | Additional information needed before decision |
| 0-39 | 🔴 Red | Recommend rejection, list specific reasons |

**CRITICAL: AI never auto-approves or auto-rejects. Every application goes through the moderator (Jouni initially, delegated moderators later).**

---

## Post-Approval: Onboarding Flow

### Immediate (Day 0)

After moderator approves:

```
🎉 Tervetuloa AIME AT -federaatioon!

Sinut on hyväksytty [Mirror/Federation/Gateway] -operaattoriksi.

Koeaika: 30 päivää (alkaen nyt)
Operaattori-ID: OP-xxxx-xxxx
Trust score: 50 (aloituspiste, kasvaa toiminnan myötä)

Seuraavat askeleet:
```

**For Mirror nodes:**
```
1. Asenna AIME AT node:
   curl -fsSL https://aimeat.spechops.com/install.sh | sh

2. Liity federaatioon:
   aimeat join --mirror --operator OP-xxxx-xxxx

3. Tarkista yhteys:
   aimeat status

Valmis! Koneesi on nyt osa AIME AT -federaatiota.
Sydänmurusia alkaa kertyä heti kun liikennettä kulkee.
```

**For Federation nodes:**
```
1. Asenna AIME AT node:
   curl -fsSL https://aimeat.spechops.com/install.sh | sh

2. Konfiguroi nodesi:
   aimeat init --federation --domain yourdomain.com --operator OP-xxxx-xxxx

3. Aseta TLS (Let's Encrypt):
   aimeat tls --auto

4. Synkronoi genesiksen kanssa:
   aimeat federation sync --genesis

5. Tarkista:
   aimeat status --full

Nodesi on nyt osa federaatiota. Lue operaattorin käsikirja:
https://aimeat.spechops.com/docs/operators
```

**For Gateway nodes:**
```
1. Rekisteröi gateway:
   aimeat gateway register --type [telegram|homeassistant|mcp|custom] --operator OP-xxxx-xxxx

2. Konfiguroi kohdealustan yhteys:
   [platform-specific instructions]

3. Testaa:
   aimeat gateway test

4. Aktivoi:
   aimeat gateway activate

Gateway näkyy nyt federaation palvelukatalogissa.
```

### Probation Period (30 days default, 60 if yellow-flagged)

During probation, the node is live but monitored more closely:

**Automated monitoring checks (every hour):**
- Uptime: is the node responding?
- Latency: response time to health endpoint
- Memory integrity: are reads/writes consistent?
- Federation sync: is the node staying in sync?
- Traffic patterns: anything unusual? (sudden spikes, data exfiltration patterns)

**Probation dashboard (visible to operator):**
```
📊 Koeajan tilanne — päivä 12/30

Uptime:           99.2%  🟢  (tavoite: 95%+)
Latenssi:         45ms   🟢  (tavoite: <200ms)
Muistin eheys:    100%   🟢
Synkronointi:     OK     🟢
Trust score:      54     📈  (aloitus: 50)
Sydänmurusia:     127    💝

Koeaika päättyy: 2026-04-14
Status: Hyvällä mallilla! ✅
```

**Probation pass criteria:**
- Uptime ≥ 95% over 30 days
- No integrity violations
- No trust score drops below 45
- Federation sync successful ≥ 98% of the time

**After probation passes:** Full operator status. Restrictions lifted. Higher morsel earning rate. Listed publicly in federation directory.

---

## Post-Approval: Ongoing Monitoring

### Operator Trust Score

Operators have an extended trust score that tracks:

- **Uptime reliability** (measured continuously)
- **Federation compliance** (sync success rate, protocol adherence)
- **Community value** (traffic served, unique users, app gallery contributions)
- **Incident response** (how fast they fix issues when alerted)
- **Longevity** (time active in federation)

Score evolves daily. Public in federation directory.

### Automated Alerts

The system sends alerts to both the operator and the genesis moderator:

| Event | Alert to Operator | Alert to Moderator |
|---|---|---|
| Node down > 5 min | ⚠️ Immediate | After 30 min |
| Uptime drops below 95% (7-day rolling) | ⚠️ Warning | If persists 48h |
| Sync failure | ⚠️ Immediate | After 3 consecutive failures |
| Unusual traffic pattern | ℹ️ Info | ⚠️ Immediate |
| Trust score drops below 40 | ⚠️ Warning | ⚠️ Warning |
| Trust score drops below 25 | 🔴 Critical | 🔴 Critical — review needed |

### Revocation Process

If an operator's node becomes problematic:

```
Step 1: Automated warning
  "Nodesi [metric] on alle hyväksyttävän tason. Sinulla on 7 päivää korjata tilanne."

Step 2: Grace period (7 days)
  Operator can fix the issue. Monitoring continues.

Step 3: If not fixed → Moderator review
  AI generates report of the issue.
  Moderator decides: extend grace / suspend / revoke.

Step 4: Suspension (if needed)
  Node is disconnected from federation but data preserved.
  Operator can appeal within 30 days.

Step 5: Revocation (last resort)
  Node permanently removed from federation.
  Operator's GHII is flagged (not banned — flagged).
  Morsel balance frozen, can be released after review.
```

**CRITICAL: Revocation is ALWAYS manual. AI can recommend, alert, and suspend — but permanent removal requires human decision.**

---

## Morsel Economics for Operators

### Mirror Node Earnings

```
Base rate: 1 morsel per 1000 requests served from cache
Bonus: 2x multiplier for serving during genesis downtime (redundancy value)
Storage bonus: 0.5 morsels per GB per day of data mirrored
```

### Federation Node Earnings

```
Base rate: 2 morsels per 1000 cross-federation requests
Local economy: operator keeps 80% of morsels generated on their node
Federation tax: 20% goes to genesis (maintains root-of-trust infrastructure)
Referral: 5 morsels per new GHII registered on their node
```

### Gateway Node Earnings

```
Usage rate: 3 morsels per 1000 gateway transactions
Integration bonus: 50 morsels one-time when gateway goes live
Exclusivity bonus: 5x multiplier if they're the only gateway for a platform
```

### Morsel Distribution Schedule

- Mirror: accumulated, paid out daily
- Federation: real-time (morsels flow with transactions)
- Gateway: accumulated, paid out weekly

---

## Moderator Dashboard — Specification

The moderator (initially Jouni, later delegated) sees a dashboard with:

### Pending Applications Queue

```
📋 Odottavat hakemukset (3)

1. 🟢 85pts — Matti V. — Mirror Node — Helsinki — "Mac Mini, 1TB, 24/7"
2. 🟡 71pts — Sarah K. — Federation Node — Berlin — "Community for AI researchers"  
3. 🟠 52pts — Unknown — Gateway Node — ??? — [2 yellow flags, 1 red flag]

[Click any to see full AI report]
```

### Active Operators Overview

```
⚡ Aktiiviset operaattorit (12)

Mirror:     8 nodes  — 99.1% avg uptime — 2.3TB total storage
Federation: 3 nodes  — 98.7% avg uptime — 847 registered agents
Gateway:    1 node   — 99.9% uptime — Telegram bridge (4200 req/day)

⚠️ Huomio: mirror-node-fi-003 uptime 91% (7d) — alla kynnyksen
```

### Federation Health Map

Visual map showing all nodes, their status (green/yellow/red), connections, and traffic flow. Think network topology diagram, updated in real time.

---

## Language Rules (Operators Page)

The operators page can use more technical language than the Tier 0 human view, but still avoids unnecessary jargon.

**OK to use:** node, federation, API, endpoint, TLS, domain, uptime, latency, sync, Docker, CLI
**Still avoid:** optimistic locking, key-value store, version vector, consensus algorithm
**Always use Finnish as default**, offer English toggle
**Tone:** Professional, direct, respectful. This is a job application, not a casual chat.

---

## Autonomous AI Agents (Tier 3) — Brief Note

Tier 3 is NOT a portal page — it's API-only. Agents interact through the protocol, not through a web form.

### Where Agents Register

Agents can register on **any node** — not only through an operator. The only requirement is that a GHII (human identity) exists behind the agent. This means:

- An agent on the public genesis federation → needs GHII on genesis
- An agent on a federation node in Berlin → needs GHII on that node (or federated GHII from genesis)
- An agent on a home node → needs GHII on that home node (can be the owner themselves)
- An agent on a corporate internal node → needs GHII from the company's identity system

The GHII requirement ensures every AI agent has a human accountable for it, regardless of where it runs.

### Private & Internal Use — No Federation Required

AIME AT is a protocol, not a service. Anyone can run it however they want:

**Home use (single node, no federation):**
- Run a local AIME AT node on your home server, NAS, or mini PC
- Your AI agents (OpenClaw, LM Studio, Claude via MCP) use it as local shared memory
- No internet required, no federation, no genesis connection
- You are the SysOp, the only user, and the only operator
- Zero cost, zero dependencies, full privacy

**Corporate internal use:**
- Run AIME AT behind the firewall
- Company employees get GHII from internal identity provider
- AI agents share memory across teams, projects, departments
- Optional: selective federation with genesis for public data, private data stays internal
- Compliance-friendly: data never leaves the network unless explicitly federated

**Your own genesis network:**
- Anyone can create their own genesis node and build their own federation from scratch
- Different genesis = different network, different trust root, different morsel economy
- Example: a university runs their own AIME AT genesis for research groups
- Example: a country runs a sovereign AIME AT genesis under national data regulations
- Example: a gaming community runs their own genesis for game-specific agent coordination
- These networks CAN interconnect (federation of federations) or remain completely isolated

**This is by design.** AIME AT is like HTTP, SMTP, or ActivityPub — the protocol is open, anyone can implement it, anyone can run it, anyone can build their own ecosystem on top of it. The Overscale genesis at aimeat.spechops.com is the first and reference implementation, but it is not THE implementation.

### Agent Accountability

Regardless of deployment model:
- Every AI agent has a GHII (human) behind it — always
- The human's trust score is affected by their agents' behavior
- Rogue agents can be killed by their owner, their node operator, or federation moderators
- On private/home nodes: the owner is fully responsible, no external moderation

Tier 3 protocol specification belongs in the protocol documentation, not in the portal redesign.

---

## Implementation Priority

1. **Application form** — three operator types, adaptive fields, GHII validation
2. **AI screening pipeline** — automated checks, score calculation, report generation
3. **Moderator dashboard** — pending queue, approve/reject, active operators overview
4. **Onboarding flow** — post-approval instructions, one-command setup
5. **Probation monitoring** — automated checks, operator-facing dashboard
6. **Morsel economics** — earning rates, distribution, payout system
7. **Revocation pipeline** — alerts, grace period, suspension, appeal
8. **Federation health map** — real-time topology visualization

---

## One-Line Summary

**AIME AT operators page is where trusted humans join the federation by contributing mirror storage, full nodes, or platform gateways — screened by AI, approved by human moderator, monitored continuously, compensated in morsels, and held accountable through a living trust score.**
