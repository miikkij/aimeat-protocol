# Design: CSM, MSM & Service Owner Manuals

**Date:** 2026-03-01
**Location:** `docs/manuals/`
**Language:** English primary, Finnish examples where natural

---

## Philosophy

Three tiers of AIMEAT usage, three manuals:

| Tier | Who | What they do | Manual |
|------|-----|-------------|--------|
| **CSM** | Anyone (your mother) | Describe community services in YAML. AI builds the app. | `csm-manual.md` |
| **MSM** | Developer / integrator | Describe external APIs in YAML. AI builds automation. | `msm-manual.md` |
| **Service Owner** | Node operator / power user | Extend nodes with plugins (YAML, JS sandbox, webhooks). | `service-owner-manual.md` |

### Core Principles

1. **CSM and MSM are just formats.** No SDK, no backend code, no `curl POST`. You write YAML, AI does the rest.
2. **The backend auto-configures from the spec.** Hand it a CSM → it knows how to validate incoming data. Hand it an MSM → it knows how to call the API.
3. **AI is the builder, not the caller.** MSM: AI reads the spec, builds the automation pipeline, tests it, then it runs on its own. AI only returns when something breaks.
4. **AI generates the specs too.** Each manual includes prompt examples: "Haluan kirpputorin Tapiolaan" → AI produces the CSM.yaml.
5. **Service Owner plugins attach to nodes, never rebuild them.** Three levels: YAML-only, JS sandbox, webhook sidecar.

---

## Manual 1: CSM Manual

**File:** `docs/manuals/csm-manual.md`
**Audience:** Non-technical to semi-technical. Community builders, hobbyists, local business owners.

### Sections

1. **What is CSM?** — Recipe card for a community service. Describe the data shape, AI builds the experience. No code.

2. **60-Second Quickstart** — 10-line hobby directory CSM → what happens when AI reads it → user gets a working app.

3. **Creating CSM with AI** — Prompt examples:
   - "I want a flea market for my neighborhood in Tapiola"
   - "Create a dating service for Kallio with consent rules"
   - AI generates the .csm.yaml, explains each section, user tweaks if needed.

4. **YAML Reference** — Every field in plain language:
   - `service` — name, type (8 types), description, locale
   - `schema_mode` — "open" (extensible) vs "strict" (locked)
   - `data_schema` — required/optional fields with types and validation
   - `consent_requirements` — visibility default, purpose, retention
   - `moderation` — flags, auto-hide threshold, appeals
   - `economy` — listing fees, escrow (marketplace type)
   - `ui_hints` — list/detail views, search fields, sort options

5. **Service Types Gallery** — Complete example per type (Finnish context):
   - `directory` — Harrastehakemisto
   - `marketplace` — Kirpputori
   - `dating` — Kohtaamispaikka
   - `auction` — Huutokauppa
   - `forum` / `news` / `opinion` — lighter examples

6. **How AI Uses Your CSM** — The flow:
   ```
   CSM.yaml → AI reads it → asks user the right questions
   → validates against schema → stores in AIMEAT memory
   → builds UX (list view, detail view, search)
   → can add smart features on top (recommendations, analysis)
   ```

7. **Extending Beyond the Spec** — `schema_mode: "open"` lets AI add custom fields per user. AI can layer features (price trends, compatibility scoring) on top of the base CSM format. The shared format stays interoperable.

8. **Sharing CSMs** — How to share templates so other communities use the same format. Federation interoperability — marketplace listings from Node A are readable by Node B because they share the same CSM.

---

## Manual 2: MSM Manual

**File:** `docs/manuals/msm-manual.md`
**Audience:** Developers and integrators who want to connect external APIs to AIMEAT.

### Sections

1. **What is MSM?** — Instruction card for an external API. Describe what it takes, what it returns, what it costs. AI reads it, builds the automation, and it runs on its own.

2. **60-Second Quickstart** — Weather API MSM → AI builds the integration → runs automatically → dynamic pricing adjusts without human intervention.

3. **Creating MSM with AI** — Prompt examples:
   - "Connect Stripe for marketplace payments"
   - "Add Posti shipping tracking to my marketplace"
   - "Integrate OpenWeather for my accommodation pricing"
   - AI generates the .msm.yaml, user provides API key, done.

4. **YAML Reference** — Every field:
   - `service` — name, description, homepage, category, tags
   - `auth` — type (bearer/query_param/oauth2), env_var, param_name
   - `actions[]` — id, display_name, endpoint (method, url, content_type)
   - `actions[].input` — parameters with type, required, description, enum
   - `actions[].output` — response fields with `from` (JSON path mapping)
   - `actions[].request_mapping` — template for POST request bodies
   - `actions[].pricing` — morsel cost
   - `actions[].examples` — real input/output pairs
   - `health` — liveness endpoint for monitoring

5. **Auth Patterns** — Three types with real examples:
   - `query_param` — OpenWeather (`?appid=KEY`)
   - `bearer` — Stripe (`Authorization: Bearer sk_...`)
   - `oauth2` — Wolt/MobilePay (token exchange flow)

6. **AI Builds the Automation** — Key concept: AI is the builder, not the runtime caller.
   ```
   MSM.yaml → AI reads it → builds integration pipeline
   → tests with example data → deploys as automated action
   → runs on schedule or on trigger → AI only returns on error
   ```
   Examples of what "builds the automation" means:
   - Stripe MSM → AI creates payment flow that triggers on marketplace purchase
   - Weather MSM → AI creates scheduled job that updates pricing every 6 hours
   - Posti MSM → AI creates tracking webhook that notifies buyer on status change

7. **Input/Output Mapping** — How `from: "city.name"` maps nested API responses. The `request_mapping` template for constructing POST bodies from input parameters.

8. **MSM + CSM Combo** — The power of combining both:
   - CSM: marketplace data spec → what listings look like
   - MSM: Stripe payment → how money moves
   - MSM: Posti shipping → how goods move
   - AI combines all three into end-to-end marketplace automation

9. **Real-World Gallery** — 4-5 complete MSM files:
   - Weather (dynamic pricing)
   - Stripe (payments)
   - Posti (shipping)
   - AI image generation (DALL-E / product photos)
   - MobilePay (Finnish mobile payments)

---

## Manual 3: Service Owner Manual

**File:** `docs/manuals/service-owner-manual.md`
**Audience:** Node operators and power users who want to extend their node's capabilities.

### Sections

1. **What is a Service Owner?** — You run an AIMEAT node. You want to customize it — add services, connect APIs, add custom logic. Three levels of extension, pick your depth.

2. **Level 1: YAML Plugins (no code)** — Simplest extension:
   - `.plugin.yaml` bundles: CSM templates + MSM integrations + config defaults
   - Example: "Espoon Kirpputori" plugin = marketplace CSM + MobilePay MSM + Finnish locale
   - Install: drop file, node auto-configures
   - Share: give the .yaml to another operator
   - AI-assisted: "Create a plugin for a neighborhood marketplace in Espoo" → AI generates plugin.yaml

3. **Level 2: JavaScript Sandboxed Plugins** — Custom logic:
   - Runs in isolated-vm (V8 sandbox) — no fs, no network, no process
   - Node exposes limited API: read/write memory, call actions, return results
   - Plugin hooks: `onListing`, `onMatch`, `onSchedule`, `onPurchase`, etc.
   - Example: price analysis — compares listing price to historical data
   - Example: smart matching — custom compatibility scoring algorithm
   - Resource limits: CPU time cap, memory cap
   - AI-assisted: "Write a plugin that checks if listing prices are reasonable" → AI generates .js

4. **Level 3: Webhook Plugins** — External process:
   - Runs as separate process/container, any language
   - Node calls your webhook URL at lifecycle points
   - Extension hooks: pre/post registration, work request, settlement, board post, federation peer
   - Example: Python ML recommendation engine
   - Example: External database sync
   - Fully isolated — can't crash the node

5. **Plugin Manifest Reference** — The `.plugin.yaml` format:
   ```yaml
   plugin: "1.0"
   name: "Espoon Kirpputori"
   description: "Local flea market for Espoo neighborhoods"
   author: "jouni@meat-finland-001-genesis"
   version: "1.0.0"
   includes:
     csm: ["marketplace.csm.yaml"]
     msm: ["mobilepay.msm.yaml"]
     hooks:
       - file: "price-checker.js"
         sandbox: true
         triggers: ["onListing", "onPurchase"]
     webhooks:
       - url: "http://localhost:8090/recommend"
         triggers: ["onMatch"]
     config:
       locale: "fi"
       economy.listing_fee_morsels: 2
   ```

6. **Node Configuration Reference** — Key settings:
   - Node types (full/personal/relay/mirror) and what each extends
   - Feature toggles (federation, push, matching, consent, marketplace)
   - Economy tuning (morsel rates, escrow, daily allowance)
   - Federation (peering, cross-node, catalogue sharing)

7. **Sharing Plugins** — Package and distribute to other nodes:
   - Plugin as a folder: `my-plugin/plugin.yaml` + CSM + MSM + hooks
   - Federation catalogue: plugins discoverable across nodes
   - Version compatibility

8. **Creating with AI** — Prompt examples for each level:
   - Level 1: "Create a plugin that adds a book club directory to my node"
   - Level 2: "Write a price checker that warns if marketplace items are overpriced"
   - Level 3: "I have a Python recommendation engine, help me connect it as a webhook plugin"

---

## Verification Criteria

- [ ] All three files exist in `docs/manuals/`
- [ ] English primary, Finnish in examples/context
- [ ] CSM manual: no mention of `curl`, `POST /v1/csm`, or backend code
- [ ] MSM manual: AI builds automation once, not calling per-request
- [ ] Service Owner manual: three-tier plugin system (YAML, JS sandbox, webhook)
- [ ] Each manual has "Creating with AI" section with prompt examples
- [ ] Real YAML examples throughout (not placeholders)
- [ ] Cross-references between manuals where concepts overlap
