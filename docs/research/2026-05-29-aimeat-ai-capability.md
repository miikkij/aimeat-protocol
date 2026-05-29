# AIMEAT.ai capability — apps using the user's OpenRouter key

**Created:** 2026-05-29
**Status:** Design proposal, not yet implemented
**Owner decision pending:** scope (just plan / quick gate-open / full build)
**Origin:** Comicland v2 developer asked "could apps automate AI calls using the same OpenRouter key the user already configured for the generator/calibrator?"

---

## 1. Context

### 1.1 What already exists

AIMEAT ships with full per-user OpenRouter integration that the **generator** and **calibrator** features use:

- **Storage:** the user's API key lives encrypted (AES-GCM) under their GHII memory at
  `openrouter.apikey = { encrypted: '...' }`. Their preferences (default model,
  reasoning vs. execution model, temperature defaults, base URL for custom providers)
  live at `openrouter.settings`.
- **Server module:** [aimeat/src/services/openrouter.ts](../../aimeat/src/services/openrouter.ts)
  provides `complete(apiKey, model, prompt, systemPrompt?, baseUrl?, options?)` —
  provider-agnostic OpenAI-compatible client.
- **Routes:** [aimeat/src/routes/openrouter.ts](../../aimeat/src/routes/openrouter.ts)
  exposes:
  - `GET /v1/openrouter/settings` — has-key + preferences
  - `PUT /v1/openrouter/settings` — set key + preferences
  - `DELETE /v1/openrouter/settings` — clear
  - `GET /v1/openrouter/models` — list available models for the user's account
  - `POST /v1/openrouter/test` — smoke test the configured key
  - `POST /v1/openrouter/complete` — **the workhorse — auth-gated, rate-limited,
    decrypts the user's key, calls OpenRouter, returns content + model used.**

### 1.2 What's missing

`/v1/openrouter/complete` requires `projectId` and verifies it belongs to a
`generator.*`, `foundry.*`, or `calibrator.*` namespace owned by the caller.
This is correct for those features (it prevents random callers from siphoning
the user's OpenRouter spend), but it **locks app-level AI use out** — Comicland
or any other AIMEAT app cannot reach the user's key today.

### 1.3 What this proposes

A thin, owner-controlled extension of the same machinery, exposed to apps and
sandboxed extensions as a first-class AIMEAT capability:

```
AIMEAT.ai.isAvailable()        →  boolean (does the user have a key configured?)
AIMEAT.ai.complete({ ... })    →  { content, model, usage }
AIMEAT.ai.models()             →  available models for this user
```

Apps detect availability, surface "✨ Use AI" affordances only when usable, and
call the endpoint with the same key/preferences the user already manages from
their profile.

---

## 2. Why this is the right shape

### 2.1 It composes existing AIMEAT primitives

- Identity already authenticates the caller (GHII) — no separate AI session.
- Memory + encryption already store the key safely.
- Settings already capture model/temperature/budget preferences.
- Capabilities + cortex libs are the standard way to add browser-side APIs that
  any app can use without bundling its own code.
- Rate limiting middleware is already in place.

Building this is "+1 endpoint and +1 cortex lib" — not new infrastructure.

### 2.2 It matches the owner's stated philosophy

From the agent-visibility research (2026-05-29):

> Agents should automate, not fire LLM calls indiscriminately. Focus should be on
> identifying repetition that can be automated, with LLMs used for decision points
> with human-in-the-loop.

`AIMEAT.ai` is the **decision-point primitive**: app code routes the bulk of
work itself (data lookups, validation, prompt composition); LLM is called only
for the squishy step the user explicitly asked help with (suggest tags, polish
a summary, translate a line). The user remains in the loop — they see the AI's
suggestion in a field they can edit before saving.

### 2.3 It puts the user's hand on the spend

Their key, their account, their model preference, their budget. AIMEAT is a
relay, not a buyer. The "Use AI" button reads as "use *my* AI" not "AIMEAT
charges me for AI."

---

## 3. API design

### 3.1 Backend endpoint

```
POST /v1/ai/complete
Auth: owner (or agent with `ai:use` scope — see §4)
Body: {
  prompt: string,                        // required
  systemPrompt?: string,
  model?: string,                        // override; falls back to user's default
  modelRole?: 'reasoning' | 'execution', // pick from user's per-role default
  temperature?: number,                  // 0–2; falls back to user's default
  top_p?: number,
  max_tokens?: number,
  app_id?: string,                       // for usage attribution / per-app quotas
}
Response: {
  ok: true,
  data: {
    content: string,
    model: string,                       // actual model used
    usage: {
      prompt_tokens: number,
      completion_tokens: number,
      cost_usd?: number,                 // if OpenRouter reports it
    }
  }
}
Errors:
  400 NO_API_KEY        — user hasn't configured a key
  400 INVALID_BODY      — missing prompt etc.
  401 INVALID_API_KEY   — provider rejected the key
  402 QUOTA_EXHAUSTED   — daily budget hit (see §4)
  429 RATE_LIMITED      — too fast
  502 PROVIDER_ERROR    — upstream failure
```

**Implementation:** copy `/v1/openrouter/complete` minus the `projectId` check;
add `app_id` logging; share the `complete()` service function unchanged.

**Why a new endpoint instead of relaxing the existing one:** keeps the
generator/calibrator's existing project-scoped contract intact, makes the
app-level rate/quota policy independently tunable, and gives a clean place for
the `app_id`-aware usage log to live.

### 3.2 Cortex lib (`aimeat-ai.js`)

```js
AIMEAT.ai = {
  // True if the user has a key configured. Apps call this before showing
  // "Use AI" buttons. Cached for 60s to avoid hammering on every render.
  async isAvailable() { … },

  // The workhorse. Returns the assistant's text + model + usage.
  // Throws on provider/budget/quota errors so the app can show a real message.
  async complete({ prompt, systemPrompt, model, modelRole, temperature, top_p, max_tokens }) { … },

  // List of model IDs the user's account can hit. Optional, useful for "advanced" UIs.
  async models() { … },

  // Convenience: complete + JSON.parse, with one auto-retry on parse failure.
  async completeJson(opts) {
    const r = await this.complete({ ...opts, systemPrompt: (opts.systemPrompt || '') + '\nReturn ONLY valid JSON, no prose.' });
    try { return JSON.parse(r.content); }
    catch { /* one retry with stronger instruction */ }
  },
};
```

Bundle it like the other client libs (`/v1/libs/aimeat-ai.js`), publish to the
existing libs index, no per-app install needed.

### 3.3 What apps DON'T see

- The user's actual API key — ever. AIMEAT decrypts in-process, calls
  OpenRouter, returns result. App only sees the response.
- The user's plain-text preferences — except via the existing
  `GET /v1/openrouter/settings` which already returns `{ has_api_key,
  preferred_model }` without revealing the key.

---

## 4. Spend, safety, and scope

The owner-philosophy quote above ("LLM-säästö") is load-bearing. Every safety
control below is in service of "don't let an app burn the user's wallet."

### 4.1 Per-user daily budget

Configurable in `openrouter.settings.daily_budget_usd` (default $1).
Backend tracks `ai-usage.{gaii}.{YYYY-MM-DD}` aggregate. When budget hit, all
further calls return 402 QUOTA_EXHAUSTED with the budget figure and reset time.

User can see today's spend in their Settings page.

### 4.2 Per-app quota (optional, future)

`openrouter.settings.app_quotas = { 'comicland-v2': { daily_usd: 0.20 }, ... }`.
Apps without an explicit entry fall back to a default app quota (e.g.
$0.10/day) so a new untrusted app can't drain anything.

### 4.3 App scope: owner vs. agent

Phase 1: owner-only (matches existing `/v1/openrouter/complete`). This is the
safe default — only the human can spend their own money.

Phase 2: agents can request `ai:use` scope at device-auth time. Agent scopes
are already part of AIMEAT, so this is a permission-list entry, not new code.

### 4.4 Prompt visibility

Backend logs `prompt_len`, `model`, `app_id`, `cost` per call — not the prompt
text itself (privacy). The user can see "Comicland v2 made 3 AI calls today
totalling $0.04" in Settings.

### 4.5 Hard caps

- `max_tokens` server-side ceiling (e.g. 4000) regardless of what app asks
  for, prevents accidental 30k-token completions.
- Single-call timeout (already 30 min in existing code, fine).
- Per-IP rate limit (existing middleware).

---

## 5. Use cases that matter

### 5.1 Comicland v2 (the spark for this proposal)

| Where | "Use AI" affordance | Time saved |
|-------|---------------------|------------|
| Series creation | Suggest 5 tags from summary | manual brainstorm |
| Character creation | Polish appearance/personality text | quality |
| Episode wizard | Suggest title from story + first panels | "what do I call this" |
| Series detail | Generate cover prompt if missing | unblock cover art |
| Translate page | Inline translate one episode (vs. copy-paste loop) | the entire current copy-paste workflow |
| Pre-publish | Continuity check vs. last episode | quality gate |
| Character editor | "Fill character JSON from this idea" | onboarding new authors |

The pattern: **app composes the prompt with all the structured data it already
owns** (series metadata, prior panels, character refs) and asks the LLM only
for the squishy step. The user sees the suggestion in the editable field and
accepts/rejects.

### 5.2 Generator pipeline (recursive use)

The generator already uses `/v1/openrouter/complete` directly. With
`AIMEAT.ai`, generator-produced apps automatically gain the same affordances
without each app re-inventing AI integration — apps can ship "✨ Use AI" buttons
out of the box.

### 5.3 Other future apps

- **Note-taking app:** "Summarize this note", "Extract action items"
- **Recipe app:** "Suggest variations", "Convert to vegan"
- **Habit tracker:** "Why have I been skipping this?" (with context)
- **Email triage:** "Reply with X tone"
- **Translation:** any app dealing with text gains AI assist for free

All without the app developer needing OpenRouter account, key management, or
provider-specific code.

### 5.4 Adversarial check

Could this look bad?

- **"App ate my OpenRouter credits"** → mitigated by per-user daily budget +
  per-app quota + visible Settings spend dashboard + app whitelist option.
- **"App is leaking my prompts to AIMEAT"** → only metadata logged, not text.
  Documented in Settings.
- **"Lock-in to OpenRouter"** → the underlying service is already
  provider-agnostic (supports any OpenAI-compatible API + custom base URL).
  User can point at LM Studio for fully local.
- **"This encourages LLM-spam"** → counter-argument is the same as the agent
  visibility paper: this is for *decision points*, not loops. Pattern is "ask
  for one suggestion, user reviews, save" — not "run 100 prompts in
  background." Quota enforces this physically.

---

## 6. Implementation plan

### Phase 0: this design doc (done)

### Phase 1: minimal viable (~3h)
- New `POST /v1/ai/complete` endpoint (clone existing, drop projectId, keep
  rate-limit, keep encryption)
- New cortex lib `aimeat-ai.js` with `isAvailable / complete`
- Add to `libs.ts` registry so apps can `loadScript('/v1/libs/aimeat-ai.js')`
- Test with one Comicland button (Suggest tags)
- E2E test for owner + missing-key + provider-error paths

### Phase 2: spend visibility (~2h)
- Daily budget setting in `openrouter.settings`
- Usage aggregate `ai-usage.{gaii}.{date}`
- "Today's AI spend: $X / $Y" in Settings page (the existing OpenRouter
  Settings already has the UI shell)
- Toast on QUOTA_EXHAUSTED with reset time

### Phase 3: per-app quotas + whitelist (~2h)
- Per-app daily caps
- Optional whitelist (user toggles "apps allowed to use AI" — Comicland
  enabled by default if installed)
- Spend breakdown per app in Settings

### Phase 4: agent scope (~1h)
- Add `ai:use` to agent scope list
- Update `/v1/ai/complete` to accept agent JWT with that scope (currently
  owner-only)

Total: ~8h for full implementation. MVP (Phase 1) is ~3h and unblocks
Comicland AI buttons immediately.

---

## 7. Open questions

1. **Streaming?** OpenAI-compatible APIs support SSE. Worth adding to lib
   from day one, or postpone? (Postponing keeps MVP smaller; long completions
   feel sluggish without it.)
2. **completeJson sane retry policy?** Once is probably enough; more risks
   amplifying cost.
3. **Should `models()` be cached at the lib layer?** The list barely changes;
   1-hour browser cache seems safe.
4. **Per-app whitelist UX:** opt-in (user explicitly enables each app) or
   opt-out (apps can use AI unless user blocks)? Opt-in is safer but adds
   friction; opt-out matches the broader AIMEAT trust model where installed
   apps are already trusted.
5. **Cost reporting accuracy:** OpenRouter returns cost in their response when
   available, but some custom-baseUrl providers won't. Show "$0.04 (est.)" vs.
   "$0.04 (exact)"?

---

## 8. Decision needed

Pick scope and we build:

- **A — Plan only** (this doc, no code). Park for later.
- **B — Phase 1 only** (~3h). Backend endpoint + cortex lib. No quota UI, no
  Comicland buttons yet. Other apps/devs can start using `AIMEAT.ai`.
- **C — Phase 1 + 2** (~5h). Phase 1 plus daily-budget UI + usage display in
  Settings. Solid user-facing release.
- **D — Phase 1 + 2 + Comicland buttons** (~6-7h). Same as C plus 2-3 Comicland
  AI affordances (suggest tags, polish summary, suggest episode title) wired up.
- **E — Full** (~8h). All four phases.

Recommendation: **C** — covers the spend-visibility worry (the load-bearing
safety design) without committing to per-app quotas before there's a second
app to need them. Comicland integration (D) is a follow-up sprint, not part
of the platform delivery.

---

## 9. Notes on the existing endpoint we're not changing

`/v1/openrouter/complete` keeps its `projectId` gate. It's the right contract
for the generator/calibrator (which operate on user-owned projects in those
namespaces). The new `/v1/ai/complete` is the **app-level** equivalent. Both
share the same backend `complete()` service and the same key/preference
storage — only the auth/scope/quota layer differs.
