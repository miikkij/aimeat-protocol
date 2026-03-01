# CSM, MSM & Service Owner Manuals — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Write three developer/user manuals in `docs/manuals/` covering CSM (community service format), MSM (external API format), and Service Owner (node extension with plugins).

**Architecture:** Three independent markdown files, each following a consistent structure. English primary with Finnish examples. All YAML examples must be real and working — based on existing files in `docs/msm-examples/` and `aimeat/docs/csm-examples/`. Cross-references between manuals where concepts overlap.

**Key principle:** CSM and MSM are YAML formats that AI reads. No backend code, no SDK, no `curl` in the CSM/MSM manuals. The Service Owner manual introduces the plugin system (YAML → JS sandbox → webhook).

**Design doc:** `docs/plans/2026-03-01-manuals-design.md`

---

## Task 1: Create directory and scaffolds

**Files:**
- Create: `docs/manuals/csm-manual.md` (scaffold with section headers only)
- Create: `docs/manuals/msm-manual.md` (scaffold with section headers only)
- Create: `docs/manuals/service-owner-manual.md` (scaffold with section headers only)

**Step 1:** Create `docs/manuals/` directory and three scaffold files with title + section headers from the design doc.

**Step 2:** Commit scaffolds.

```bash
git add docs/manuals/
git commit -m "docs: scaffold CSM, MSM & Service Owner manuals"
```

---

## Task 2: Write CSM Manual

**File:** `docs/manuals/csm-manual.md`

**Primary sources to read before writing:**
- `aimeat/docs/csm-examples/hobby-directory.csm.yaml` — simplest CSM example
- `aimeat/docs/csm-examples/marketplace.csm.yaml` — marketplace with economy rules
- `aimeat/docs/csm-examples/dating-directory.csm.yaml` — dating with consent
- `aimeat/docs/csm-examples/auction.csm.yaml` — auction with time limits
- `aimeat/docs/csm-examples/news-feed.csm.yaml` — news with sources
- `aimeat/docs/csm-examples/opinion-board.csm.yaml` — opinion polling
- `aimeat/docs/csm-examples/video-directory.csm.yaml` — media
- `aimeat/src/services/csm-parser.ts` — what fields the parser understands (for accuracy)
- `docs/plans/2026-03-01-manuals-design.md` — section structure

**Sections to write (in order):**

1. **What is CSM?** — Two paragraphs max. CSM = recipe card for a community service. You describe data shape in YAML, AI builds the app. No code, no server knowledge needed. Analogy: CSM is to community apps what a recipe is to cooking — you describe what goes in, AI is the chef.

2. **60-Second Quickstart** — Show the simplest possible CSM (stripped-down hobby directory, ~10 lines). Then show what happens: "You give this to your AI assistant, and it knows to ask users for their interests and location, show results as a list, and respect privacy settings."

3. **Creating CSM with AI** — 3-4 prompt examples showing how to ask AI to generate CSM files:
   - Finnish example: "Haluan perustaa harrastekerhon Tapiolaan" → AI generates hobby-directory CSM
   - English example: "Create a marketplace for vintage electronics" → AI generates marketplace CSM
   - "Add a dating feature to my community with strict privacy" → AI generates dating CSM with consent rules
   - Show the AI's reasoning: why it chose certain fields, visibility defaults, moderation thresholds

4. **YAML Reference** — Every top-level section explained in plain language with mini-examples:
   - `csm` version field
   - `service` block (name, type, description, locale) — list all 8 types: directory, marketplace, dating, forum, news, opinion, auction, media
   - `schema_mode` — "open" vs "strict" with when to use each
   - `data_schema` — required/optional, supported types (string, number, integer, boolean, array, object), validation (minLength, maxLength, minimum, maximum, enum, minItems, maxItems, default)
   - `consent_requirements` — visibility_default (private/federation/public), requires_consent, consent_purpose, data_retention
   - `moderation` — flags_enabled, auto_hide_threshold, appeals_enabled
   - `economy` — listing_fee_morsels, escrow_enabled, escrow_release_on (marketplace-specific)
   - `ui_hints` — list_view, detail_view, search_fields, sort_options, card_image_field

5. **Service Types Gallery** — One complete, real YAML example per type. Use existing examples from `aimeat/docs/csm-examples/` as base, with Finnish context and commentary:
   - `directory` — Harrastehakemisto (from hobby-directory.csm.yaml)
   - `marketplace` — Kirpputori (from marketplace.csm.yaml)
   - `dating` — Kohtaamispaikka (from dating-directory.csm.yaml)
   - `auction` — Huutokauppa (from auction.csm.yaml)
   - Brief mentions of forum, news, opinion with 1-2 line descriptions

6. **How AI Uses Your CSM** — The flow diagram (text-based) showing: CSM file → AI reads schema → generates questions for user → validates responses → stores data → builds UI from ui_hints → can layer smart features on top. Example: marketplace CSM → AI adds price trend analysis, similar items, shipping cost estimation — features not in the CSM but enabled by it.

7. **Extending Beyond the Spec** — `schema_mode: "open"` explanation. How a base CSM provides interoperability (all marketplaces speak the same format) while each implementation can add custom fields. Example: vintage electronics marketplace adds `year_manufactured` and `brand` fields not in the base marketplace CSM.

8. **Sharing CSMs** — How sharing works: give the .csm.yaml file to another community/node. Because they share the format, data is interoperable. Federation: listings from Node A are searchable from Node B because both use the same marketplace CSM. Cross-reference to Service Owner manual for plugin packaging.

**Step 1:** Read all CSM example files and csm-parser.ts
**Step 2:** Write sections 1-3 (concept + quickstart + AI creation)
**Step 3:** Write section 4 (YAML reference)
**Step 4:** Write sections 5-6 (gallery + how AI uses it)
**Step 5:** Write sections 7-8 (extending + sharing)
**Step 6:** Review full document for coherence, verify YAML examples are valid
**Step 7:** Commit

```bash
git add docs/manuals/csm-manual.md
git commit -m "docs: write CSM manual — community service format guide"
```

---

## Task 3: Write MSM Manual

**File:** `docs/manuals/msm-manual.md`

**Primary sources to read before writing:**
- `docs/msm-examples/weather-pricing.msm.yaml` — weather API with output mapping
- `docs/msm-examples/stripe-marketplace.msm.yaml` — payment with bearer auth
- `docs/msm-examples/posti-shipping.msm.yaml` — shipping with tracking
- `docs/msm-examples/ai-logo-design.msm.yaml` — AI service integration
- `docs/msm-examples/mobilepay-payment.msm.yaml` — Finnish mobile payment
- `docs/msm-examples/coinbase-transfer.msm.yaml` — crypto payments
- `docs/plans/2026-03-01-manuals-design.md` — section structure

**Sections to write (in order):**

1. **What is MSM?** — Two paragraphs. MSM = instruction card for an external API. Describe what it takes, returns, costs. AI reads it ONCE, builds the automation, tests it, then it runs on its own. AI is the builder, not the runtime caller. Only comes back if something breaks.

2. **60-Second Quickstart** — Weather API MSM (stripped to ~15 lines). Show: "AI reads this → builds a scheduled job that fetches weather every 6 hours → updates your accommodation pricing automatically → you never touch it again."

3. **Creating MSM with AI** — 3-4 prompt examples:
   - "Connect Stripe payments to my marketplace" → AI generates stripe MSM
   - "Lisää Postin seuranta markkinapaikkaani" → AI generates Posti MSM in Finnish context
   - "I want dynamic pricing based on weather for my rental cabin" → AI generates weather MSM + explains the automation it'll build
   - Show AI reasoning about auth type selection, output mapping

4. **YAML Reference** — Every field:
   - `msm` version
   - `service` — name, description, homepage, category, tags
   - `auth` — type (bearer/query_param/oauth2), env_var, param_name. For oauth2: token_url, scopes
   - `actions[]` — id, display_name, description
   - `actions[].endpoint` — method, url (with `{input.*}` placeholders), content_type
   - `actions[].input` — parameters with type, required, description, enum, default
   - `actions[].output` — fields with type, description, `from` (JSON path)
   - `actions[].request_mapping` — template for POST bodies
   - `actions[].pricing` — base_morsels (cost per call)
   - `actions[].estimated_time_seconds`
   - `actions[].examples` — real input/output pairs for testing
   - `health` — endpoint, method, interval_seconds, expected_status

5. **Auth Patterns** — Three auth types with real, complete examples:
   - `query_param` — OpenWeather (key in URL parameter)
   - `bearer` — Stripe (Authorization header)
   - `oauth2` — brief explanation of token flow, when to use it

6. **AI Builds the Automation** — Core concept section. Flow:
   ```
   MSM.yaml → AI reads once → designs automation pipeline
   → tests with example data → deploys as background job/trigger
   → runs automatically → AI returns only on error/change
   ```
   Three concrete scenarios:
   - Stripe MSM → AI builds: "on marketplace purchase → charge card → release escrow on delivery"
   - Weather MSM → AI builds: "every 6h → fetch forecast → if sunny weekend → increase cabin price 20%"
   - Posti MSM → AI builds: "on shipping label created → track → notify buyer on status change"

7. **Input/Output Mapping** — Detailed explanation of `from` field (JSON path syntax). How nested API responses get flattened to clean output. The `request_mapping` template for constructing POST bodies. Example: Stripe's nested charge response → flat `{amount, status, receipt_url}`.

8. **MSM + CSM Combo** — The power of combining:
   - CSM defines: what a marketplace listing looks like
   - MSM connects: how payment works (Stripe), how shipping works (Posti)
   - AI combines: end-to-end automation from listing → payment → shipping → delivery notification
   - Cross-reference to CSM manual for the data format side

9. **Real-World Gallery** — 4-5 complete MSM files with commentary. Use existing examples:
   - Weather (dynamic pricing) — from weather-pricing.msm.yaml
   - Stripe (payments) — from stripe-marketplace.msm.yaml
   - Posti (shipping) — from posti-shipping.msm.yaml
   - AI image generation — from ai-logo-design.msm.yaml
   - MobilePay — from mobilepay-payment.msm.yaml

**Step 1:** Read all MSM example files
**Step 2:** Write sections 1-3 (concept + quickstart + AI creation)
**Step 3:** Write sections 4-5 (YAML reference + auth patterns)
**Step 4:** Write sections 6-7 (automation concept + mapping)
**Step 5:** Write sections 8-9 (CSM combo + gallery)
**Step 6:** Review, verify YAML examples are valid
**Step 7:** Commit

```bash
git add docs/manuals/msm-manual.md
git commit -m "docs: write MSM manual — external API integration guide"
```

---

## Task 4: Write Service Owner Manual

**File:** `docs/manuals/service-owner-manual.md`

**Primary sources to read before writing:**
- `aimeat/src/config.ts` — all config fields and env vars
- `aimeat/src/server.ts` — how routers mount, extension hooks
- `aimeat/.env.example` — documented env vars
- `docs/plans/2026-03-01-manuals-design.md` — section structure and plugin.yaml format
- `docs/nextlevel/aimeat-personal-node-spec.md` — personal node capabilities
- `docs/b-config.md` — node configuration schema

**Sections to write (in order):**

1. **What is a Service Owner?** — You run an AIMEAT node. You want it to serve your community — add services, connect APIs, maybe add custom logic. Three levels of extension: YAML (no code), JavaScript sandbox (custom logic), Webhook (external process). Pick your depth.

2. **Level 1: YAML Plugins (no code)** — The simplest extension:
   - `.plugin.yaml` concept: bundles CSM templates + MSM integrations + config overrides
   - Complete example: "Espoon Kirpputori" plugin
     ```yaml
     plugin: "1.0"
     name: "Espoon Kirpputori"
     description: "Local flea market for Espoo neighborhoods"
     author: "jouni@meat-finland-001-genesis"
     version: "1.0.0"
     includes:
       csm: ["marketplace.csm.yaml"]
       msm: ["mobilepay.msm.yaml"]
       config:
         locale: "fi"
         economy.listing_fee_morsels: 2
     ```
   - What happens: node loads plugin → registers CSM → configures MSM → applies settings
   - Install: drop the plugin folder into your node
   - Share: zip it, send it, other operators install it

3. **Level 2: JavaScript Sandboxed Plugins** — For custom logic:
   - What the sandbox IS: isolated V8 engine (isolated-vm). Your code runs in a safe bubble.
   - What it CAN do: read memory, write memory, call actions, return computed results, log
   - What it CANNOT do: access filesystem, network, process, global state, other plugins
   - Plugin structure with hook functions:
     ```javascript
     // price-checker.js — runs in sandbox
     exports.onListing = async (listing, ctx) => {
       // ctx.memory.read(), ctx.memory.write(), ctx.actions.call()
       const history = await ctx.memory.read(`prices.${listing.category}.history`);
       const avgPrice = history.reduce((s, p) => s + p, 0) / history.length;
       if (listing.price > avgPrice * 2) {
         return { warn: `Price ${listing.price} is 2x above average (${avgPrice})` };
       }
       return { ok: true };
     };
     ```
   - Available hooks: onListing, onPurchase, onMatch, onSchedule (cron-like), onBoardPost, onFlagCreated
   - Resource limits: 100ms CPU per call, 16MB memory
   - Plugin.yaml integration:
     ```yaml
     includes:
       hooks:
         - file: "price-checker.js"
           sandbox: true
           triggers: ["onListing"]
     ```
   - Example 2: smart matching that uses custom algorithm beyond default interest overlap

4. **Level 3: Webhook Plugins** — External process, any language:
   - Your code runs as a separate process (Docker container, Python script, whatever)
   - Node sends HTTP POST to your URL at lifecycle points
   - Request/response JSON format
   - Available trigger points (from config extensionHooks): pre_owner_registration, post_owner_registration, pre_work_request, post_work_delivery, post_settlement, pre_board_post, pre_federation_peer
   - Example: Python recommendation engine
     ```python
     from flask import Flask, request, jsonify
     app = Flask(__name__)

     @app.route('/recommend', methods=['POST'])
     def recommend():
         user_profile = request.json['profile']
         # ML magic here
         return jsonify({'suggestions': [...]})
     ```
   - Plugin.yaml:
     ```yaml
     includes:
       webhooks:
         - url: "http://localhost:8090/recommend"
           triggers: ["onMatch"]
           timeout_ms: 5000
     ```

5. **Node Configuration Reference** — Key env vars grouped by category:
   - **Identity:** AIMEAT_NODE_ID, AIMEAT_NODE_TYPE (full/personal/relay/mirror)
   - **Network:** AIMEAT_PORT, AIMEAT_BASE_URL
   - **Storage:** AIMEAT_DB_URL (MongoDB optional, default in-memory)
   - **Features:** AIMEAT_EXTENDED_FEATURES, AIMEAT_CONSENT_ENABLED, AIMEAT_PUSH_ENABLED
   - **Economy:** AIMEAT_DAILY_ALLOWANCE, AIMEAT_WELCOME_BONUS
   - **Federation:** AIMEAT_CROSS_FEDERATION_ENABLED, AIMEAT_MAX_GENESIS_PEERS
   - **Email:** AIMEAT_SMTP_HOST, AIMEAT_EMAIL_FROM
   - Table format with: variable, default, description

6. **Plugin Manifest Reference** — Complete `.plugin.yaml` spec:
   - All fields: plugin version, name, description, author, version, license
   - includes.csm — list of CSM files
   - includes.msm — list of MSM files
   - includes.hooks — sandboxed JS files with trigger list
   - includes.webhooks — external URLs with trigger list and timeout
   - includes.config — config overrides (flat key-value)
   - Dependencies and compatibility

7. **Sharing Plugins** — How to package and distribute:
   - Plugin as folder: `my-plugin/plugin.yaml` + `.csm.yaml` + `.msm.yaml` + `.js`
   - Discovery via federation catalogue
   - Versioning and updates

8. **Creating with AI** — Prompt examples for all three levels:
   - Level 1: "Create a plugin that adds a book club directory with Finnish locale to my node"
   - Level 2: "Write a price checker that warns sellers if their listing is overpriced compared to recent sales"
   - Level 3: "I have a Python service that analyzes product images — help me connect it as a webhook plugin"

**Step 1:** Read config.ts, server.ts, .env.example, personal-node-spec
**Step 2:** Write sections 1-2 (intro + YAML plugins)
**Step 3:** Write sections 3-4 (JS sandbox + webhook plugins)
**Step 4:** Write sections 5-6 (config reference + plugin manifest)
**Step 5:** Write sections 7-8 (sharing + AI creation)
**Step 6:** Review, verify all YAML/JS examples, add cross-references to CSM and MSM manuals
**Step 7:** Commit

```bash
git add docs/manuals/service-owner-manual.md
git commit -m "docs: write Service Owner manual — node extension & plugin guide"
```

---

## Task 5: Cross-references and final review

**Step 1:** Read all three manuals end-to-end.
**Step 2:** Add cross-references:
   - CSM manual → MSM manual (where economy/payment is mentioned)
   - CSM manual → Service Owner manual (where sharing/plugins is mentioned)
   - MSM manual → CSM manual (where data format is mentioned)
   - MSM manual → Service Owner manual (where automation deployment is mentioned)
   - Service Owner manual → CSM manual (for YAML plugin CSM includes)
   - Service Owner manual → MSM manual (for YAML plugin MSM includes)
**Step 3:** Verify all YAML examples parse correctly (no syntax errors).
**Step 4:** Verify no CSM/MSM manual mentions `curl`, `POST /v1/csm`, SDKs, or backend code.
**Step 5:** Verify MSM manual frames AI as builder (once) not caller (every time).
**Step 6:** Final commit if changes made.

```bash
git add docs/manuals/
git commit -m "docs: add cross-references between CSM, MSM & Service Owner manuals"
```

---

## Verification Checklist

- [ ] Three files exist in `docs/manuals/`: csm-manual.md, msm-manual.md, service-owner-manual.md
- [ ] English primary, Finnish in examples/context
- [ ] CSM manual: zero mentions of curl, POST, API endpoints, or backend code
- [ ] MSM manual: AI builds automation once, doesn't call per-request
- [ ] Service Owner manual: three plugin tiers (YAML, JS sandbox, webhook)
- [ ] Every manual has "Creating with AI" section with prompt examples
- [ ] All YAML examples are complete and valid (not truncated)
- [ ] Cross-references work between all three manuals
- [ ] References to existing AIMEAT docs are accurate

## Execution Approach

Tasks 2 and 3 (CSM and MSM manuals) are independent and can be written in parallel by separate agents. Task 4 (Service Owner) depends on knowing the CSM/MSM format well, so it can run in parallel or after. Task 5 (cross-references) must run last.
