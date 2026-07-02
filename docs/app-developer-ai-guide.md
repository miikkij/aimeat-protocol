# Building AI-assisted apps on AIMEAT

> **Audience:** AI chats producing AIMEAT apps, and humans who want to add
> "✨ Use AI" affordances to their app.
> **Layer:** App-level — uses the user's own OpenRouter (or compatible) API
> key. The user owns the spend; AIMEAT is just a relay with safety rails.
> **Status:** Available since AIMEAT 1.13.x via `/v1/libs/aimeat-ai.js`.

---

## TL;DR

1. Add `await loadScript('/v1/libs/aimeat-ai.js')` to your app's boot.
2. Gate "Use AI" buttons on `await AIMEAT.ai.isAvailable()` (false when the
   user hasn't configured a key).
3. **Compose the prompt yourself** from your app's structured data; ask the
   LLM only for the squishy step.
4. Call `AIMEAT.ai.complete({ prompt, app_id: 'your-app-name', ... })`.
5. **Render the result into an editable field** so the human stays in the
   loop. Don't write it directly into final storage.
6. Catch errors and show actionable messages (`NO_API_KEY`, `QUOTA_EXHAUSTED`,
   etc. — see the error code table below).

The user's API key never leaves the AIMEAT server. Your app sees only the
completion text + token/cost usage. Spend is bounded by their daily USD
budget (default $1) and an optional per-app daily quota.

---

## Why this exists

AI chats are useful, but AI chats don't have your user's OpenRouter account.
Without this capability, every AIMEAT app that wants AI assistance has to:

- Make the user paste their API key into the app (security risk + UX friction)
- Bundle the app's OWN API key (the dev pays for everyone's spend)
- Skip AI features entirely

`AIMEAT.ai` solves all three. The user configures their OpenRouter key **once**
in their AIMEAT profile (Generator / Foundry / Calibrator already use it for
their own purposes). Apps then reach the same key via a budget-gated server
endpoint — they never see the key, can't exfiltrate it, and can't run up
spend beyond what the user has allowed.

This matches the AIMEAT philosophy: **the user owns their data, their money,
and their AI.** Apps are tools.

---

## Apps run on an isolated origin — no ambient session

A published AIMEAT app runs on a **separate, isolated origin** — `*.apps.<domain>`
(e.g. `apps.aimeat.io`), **not** the apex (`aimeat.io`). That is a different
browser origin, by design (security finding H-2 — see
[`docs/internal/app-origin-deployment.md`](internal/app-origin-deployment.md)
for the origin setup). What this means for your app:

- **No ambient login session.** The app **cannot** read the user's `aimeat.io`
  cookie, session, or `localStorage`. There is no implicit "owner is logged in"
  to ride on.
- **Never call `/v1/auth/refresh`, and never `fetch(..., { credentials: 'include' })`
  expecting the user's session.** There is no session on the app origin — those
  calls fail with 401/403. (This is the exact pattern that was removed; apps
  that read the owner's private memory directly now get rejected.)
- **`AIMEAT.ai` / `AIMEAT.ai.complete()` (this guide) is unaffected** — the
  OpenRouter relay is a separate path. Use it exactly as documented here.

### Public data — just fetch it

Data that needs no auth is a same-origin `fetch('/v1/...')` to the app origin
(CORS is `*`): public memory (`getPublic`), the catalogue, public boards. No
token needed.

### Private data — use the app-grant flow (OAuth-style + PKCE)

To touch the user's **own/private** data, request a **scoped, revocable** token
via `/v1/app-grants`. Grantable scopes (the agent scopes): `memory:read`,
`memory:write`, `memory:delete`, `catalogue:read`, `social:read`,
`social:write`, `wallet:read`, `knowledge:read`. Minimal end-to-end:

```js
// --- 1. Send the user to the trusted apex to approve (PKCE S256) ---
function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function startGrant() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  sessionStorage.setItem('aimeat_pkce', verifier);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = b64url(new Uint8Array(digest));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  sessionStorage.setItem('aimeat_state', state);
  const redirectUri = location.origin + location.pathname; // your URL on the app origin
  location.href = 'https://aimeat.io/v1/app-grants/authorize'
    + '?app=' + encodeURIComponent('alice/comicland.html')      // your published <owner>/<file>
    + '&response_type=code'
    + '&scope=' + encodeURIComponent('memory:read memory:write') // fewest you need
    + '&redirect_uri=' + encodeURIComponent(redirectUri)
    + '&state=' + state
    + '&code_challenge=' + challenge
    + '&code_challenge_method=S256';
}

// --- 2. On return (?code=...&state=...), exchange the code for a scoped token ---
async function completeGrant() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (!code) return;
  if (params.get('state') !== sessionStorage.getItem('aimeat_state')) throw new Error('state mismatch');
  const verifier = sessionStorage.getItem('aimeat_pkce');
  const redirectUri = location.origin + location.pathname;
  const res = await fetch('https://aimeat.io/v1/app-grants/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri }),
  }).then(r => r.json());
  // Store the scoped token in YOUR OWN origin's storage — never the user's session.
  localStorage.setItem('aimeat_token', res.data.access_token);
  localStorage.setItem('aimeat_refresh', res.data.refresh_token);
  history.replaceState({}, '', location.pathname); // strip ?code from the URL
}

// --- 3. Call AIMEAT APIs with the scoped Bearer token (refresh on 401) ---
async function readMyData(key) {
  const res = await fetch('https://aimeat.io/v1/memory/' + encodeURIComponent(key), {
    headers: { Authorization: 'Bearer ' + localStorage.getItem('aimeat_token') },
  }).then(r => r.json());
  return res.data;
}

// Access token expired? Rotate it with the refresh token:
async function refreshToken() {
  const res = await fetch('https://aimeat.io/v1/app-grants/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: localStorage.getItem('aimeat_refresh') }),
  }).then(r => r.json());
  localStorage.setItem('aimeat_token', res.data.access_token);
  localStorage.setItem('aimeat_refresh', res.data.refresh_token); // refresh tokens rotate (one-time use)
}
```

The token is scoped to exactly the scopes the user approved and is **revocable**:
the user reviews and revokes connected apps in **Profile → Access → "Connected
Apps"**. Request the fewest scopes you need, and treat a 401 after a previously
working token as "the user revoked us or the token expired" — refresh once, and
if that fails, re-run the grant flow.

> Source of truth for this flow: [`aimeat/src/routes/app-grants.ts`](../aimeat/src/routes/app-grants.ts).

---

## When to use AI (and when not to)

AI assist is at its best when:

- The step is squishy (creative wording, suggesting a fitting category, summarising)
- The user reviews the output before it's committed
- A deterministic alternative would feel rigid or take more code than is justified

AI assist is the wrong tool when:

- The answer is a lookup ("how many episodes in this series?" — that's a count, not a prompt)
- The output is invisible and final (don't have AI silently mutate stored data)
- The cost-per-call exceeds the value-per-call (don't burn $0.02 to suggest a 3-character tag)

The owner-philosophy that drove this capability:

> Agents should automate, not fire LLM calls indiscriminately. Identify
> repetition that can be automated, use LLMs at decision points with
> human-in-the-loop.

Treat `AIMEAT.ai` as the human-in-the-loop primitive. The pattern is
**suggest, then let the user accept** — not "run a hidden loop and write the
result to memory."

---

## Boot setup

The `aimeat-ai` lib depends on `aimeat-auth.js` being loaded first. A typical
app boot looks like:

```js
async function boot() {
  await loadScript('/v1/libs/aimeat-auth.js');
  await loadScript('/v1/libs/aimeat-data.js');
  await loadScript('/v1/libs/aimeat-ai.js');      // ← AI capability
  AIMEAT.auth.mountLoginButton('#header-auth');
  await onAuthChanged();
  renderRoute();
}
```

If the user hasn't logged in, `AIMEAT.ai.isAvailable()` returns false and
your "Use AI" buttons should hide. After login it returns the real value.

---

## The "Use AI" pattern (canonical)

```js
async function setupAiButton() {
  const aiBtn = document.getElementById('ai-suggest-tags');
  const ok = await AIMEAT.ai.isAvailable();
  if (!ok) {
    aiBtn.style.display = 'none';                 // hide silently — many users won't configure a key
    return;
  }

  aiBtn.onclick = async () => {
    const summary = document.getElementById('series-summary').value.trim();
    if (!summary) {
      alert('Write a summary first, then ask AI for tag suggestions.');
      return;
    }

    aiBtn.disabled = true; aiBtn.textContent = '…';
    try {
      const r = await AIMEAT.ai.complete({
        prompt: 'Suggest 5 short comma-separated genre tags for this comic series summary. Output ONLY the tags, nothing else.\n\n' + summary,
        modelRole: 'execution',                   // cheaper/faster model for routine tasks
        max_tokens: 60,
        app_id: 'comicland-v2',                   // for per-app spend tracking and quota
      });
      document.getElementById('series-tags').value = r.content.trim();  // ← editable, user reviews
    } catch (e) {
      handleAiError(e, aiBtn);
    } finally {
      aiBtn.disabled = false; aiBtn.textContent = '✨ Suggest tags';
    }
  };
}

function handleAiError(e, btn) {
  switch (e.code) {
    case 'NO_API_KEY':
      alert('You haven\'t configured an OpenRouter key yet. Open Settings → Generator → OpenRouter to set one.');
      break;
    case 'QUOTA_EXHAUSTED':
      alert('Your daily AI budget is used up. Raise it in Settings or wait until midnight UTC.');
      break;
    case 'APP_QUOTA_EXHAUSTED':
      alert('This app has hit its daily AI quota. Raise it in Settings if you trust it with more spend.');
      break;
    case 'APP_NOT_ALLOWED':
      alert('You haven\'t allowlisted this app for AI use. Enable it in Settings.');
      break;
    case 'APP_ID_REQUIRED':
      alert('Your AI allowlist requires apps to identify themselves. The app didn\'t pass an app_id.');
      break;
    case 'INVALID_API_KEY':
      alert('Your OpenRouter key was rejected. Re-enter it in Settings.');
      break;
    case 'RATE_LIMITED':
      alert('OpenRouter rate-limited the request. Try again in a few seconds.');
      break;
    default:
      console.error('AI call failed:', e);
      alert('AI call failed: ' + e.message);
  }
}
```

Five things this example gets right and you should copy:

1. **`isAvailable()` gate** — silently hides the button when there's no key.
   No nag dialog on every page load.
2. **App composes the prompt** — series summary is structured data we already
   have; we just ask the LLM for the suggestion.
3. **`app_id` always passed** — lets the user see "Comicland used $0.04
   today" in their settings, and lets per-app quotas work.
4. **Render to an editable field** — `series-tags` is a textarea/input the
   user can correct before saving.
5. **Specific error handling** — each `err.code` gets a different actionable
   message. No "something went wrong" UX.

---

## API reference

### `await AIMEAT.ai.isAvailable() → boolean`

True if the user has an OpenRouter (or compatible) key configured. Cached
60s; cheap to call on every render. Returns `false` (not throws) when not
logged in.

### `await AIMEAT.ai.complete(opts) → { content, model, usage, budget }`

Run one completion.

| Option | Type | Notes |
|---|---|---|
| `prompt` | string | Required. ≤ 200,000 characters. |
| `systemPrompt` | string | Optional system message. |
| `model` | string | Override the user's default. E.g. `'anthropic/claude-3.5-haiku'`. |
| `modelRole` | `'reasoning'` \| `'execution'` | Pick from user's per-role default. Use `'execution'` for cheap routine tasks; `'reasoning'` for hard ones. |
| `temperature` | number | 0–2. Falls back to user's default. |
| `top_p` | number | Falls back to user's default. |
| `max_tokens` | number | Falls back to user's default. No hard server cap on the per-call value — the provider enforces its own per-model output limit, and spend stays bounded by the daily USD budget. (The user's *saved default* is clamped to ≤128,000 when set via `/v1/openrouter/settings`.) |
| `app_id` | string | **Always set this.** Identifies your app for per-app quotas and the user's spend dashboard. |

Returns:

```js
{
  content: "string the model wrote",
  model: "anthropic/claude-sonnet-4",            // actual model used
  usage: {
    prompt_tokens: 142,
    completion_tokens: 38,
    total_tokens: 180,
    cost_usd: 0.0018,                            // OpenRouter-reported or estimated
    cost_exact: true,                            // true if provider reported; false = AIMEAT estimate
  },
  budget: {
    daily_budget_usd: 1.0,
    spent_today_usd: 0.0142,                     // includes this call
    remaining_usd: 0.9858,
  },
}
```

Throws on failure with `err.code` set. Codes:

| Code | When |
|---|---|
| `NO_API_KEY` | User hasn't configured a key. |
| `INVALID_API_KEY` | Provider rejected the key (key revoked or expired). |
| `QUOTA_EXHAUSTED` | Daily user budget hit. |
| `APP_QUOTA_EXHAUSTED` | Per-app daily quota hit. |
| `APP_NOT_ALLOWED` | User has an allowlist and your `app_id` isn't on it. |
| `APP_ID_REQUIRED` | User has an allowlist but the call had no `app_id`. |
| `INVALID_BODY` | Missing/malformed prompt. |
| `PROMPT_TOO_LONG` | Prompt exceeds 200k characters. |
| `RATE_LIMITED` | Provider rate-limited. Retry with backoff. |
| `PROVIDER_ERROR` | Upstream provider failed (502). |
| `JSON_PARSE_FAILED` | Only from `completeJson()` — model returned invalid JSON twice. |

### `await AIMEAT.ai.completeJson(opts) → { content, model, usage, budget, parsed }`

Same as `complete()` but adds "Return ONLY valid JSON" to the system prompt
and `JSON.parse()`s the result. **One retry** on parse failure with a
stronger instruction and lower temperature. If both attempts fail, throws
`JSON_PARSE_FAILED`.

Use when you want structured output: `{ tags: [...], rating_suggestion: "K-7" }`.
Don't use for free-form prose.

### `await AIMEAT.ai.models() → Array<{id, name, ...}>`

List the models the user's account can hit. Cached 1 hour. Useful for
"advanced" UIs where the user can pick a model per-call.

### `await AIMEAT.ai.usage() → { date, daily_budget_usd, spent_today_usd, ... }`

Today's spend snapshot. Use to show "AI used: $0.04 / $1.00" in your app's
sidebar, or for an admin dashboard.

### `AIMEAT.ai.invalidateCache()`

Clears the 60s availability + 1h models cache. Call after the user toggles
their key/budget in another tab.

### `await session.notify(title, { body?, link?, type? }) → envelope`

Notify the signed-in owner: a record in their header bell plus — when they have
browser push enabled (profile → Notifications) — a real push notification, even
with your app closed. Self-targeted only: it always goes to the owner behind the
current session, never to anyone else.

Requires the `notifications:send` scope in your grant
(`<meta name="aimeat-scopes" content="... notifications:send">`). Clicking the
notification opens `link`; when you omit it, it defaults to **your app's own
open URL**, so "Report ready" brings the user straight back to your app. `link`
must be a same-node path (starts with `/`). The node prefixes your app's name to
the title so notifications are always attributable.

```js
await session.notify('Report ready', { body: 'Q2 numbers are in.' });
```

---

## Cortex and extensions

### Cortex

A cortex IIFE that uses `session.fetch` (the standard cortex pattern) can
call `/v1/ai/complete` directly the same way `Comicland.episodes.publish`
calls extension actions. There's no special cortex-side wrapper needed —
either:

- Load `aimeat-ai.js` in the host app and access `AIMEAT.ai` from cortex (cleanest)
- Or call `session.fetch('/v1/ai/complete', { method:'POST', body: '...' })` directly

The browser-side library is the recommended path because it handles caches,
error code propagation, and the `completeJson()` retry.

### Extensions (WASM sandbox)

Extensions currently **cannot** call `/v1/ai/complete`:

- `ctx.fetch()` is for outbound HTTP. SSRF protection blocks localhost callbacks.
- The sandbox has no JWT representing the user — only `ctx.caller.gaii`.

A proper extension AI capability would be `ctx.ai.complete({...})`,
implemented by the runtime forwarding to the same endpoint with a
runtime-minted token scoped to the calling user. This is straightforward to
add (the design parallels `ctx.wallet`) but is **not currently
implemented** as of this writing. Track it via the `ctx.ai` design doc when
it lands.

For now, the pattern is: **extensions do the data work; the cortex/app
fetches the result and runs AI on it.** This also tends to produce better
UX because the user sees what's happening — sandbox-side LLM loops would be
invisible.

---

## Prompt-composition principles

Your app already has structured data. Use it.

**Good prompt** (you compose from app state):

```
Series title: "Kulakula"
Genre: sci-fi
Existing summary (≤200 chars): "A bodyless entity hops between hosts to map hidden power structures of Earth."
Recent episode titles: ["The Door Under the Ice", "Quarantine Active"]

Task: Suggest a third episode title that fits the established tone. Output ONLY the title, no quotes, no extra text.
```

**Bad prompt** (vague, asks the model to invent context):

```
Give me a good episode title for a sci-fi comic
```

The good prompt uses ~50 input tokens to produce a focused 6-token title. The
bad one wastes the model's capacity inventing a series, then probably
mismatches the user's intent.

### Specific patterns

- **Suggestion → editable field.** Never `setMemory` the AI's output
  directly. Show it in a text input. The user accepts by clicking Save (or
  edits first).
- **Pass tone hints.** Series style, genre, prior content — the model uses
  these. Cheaper than retrying because the first attempt was generic.
- **Constrain output shape.** "Output ONLY tags, comma-separated." "Output
  ONLY valid JSON matching {...}." Models do better with clear shape
  contracts.
- **Budget your max_tokens.** A "suggest a title" call needs 30 tokens, not
  500. Cap it.

---

## Spend safety in practice

The user sets a daily USD budget (default $1). Each `complete()` call
counts toward it. When hit, all subsequent calls return `QUOTA_EXHAUSTED`
until midnight UTC.

Cost is reported by OpenRouter when available. For LM Studio / custom
providers, AIMEAT estimates at Claude-Sonnet-like pricing (intentionally
high — better to over-estimate and under-spend). The user's OpenRouter
dashboard is the source of truth for actual billing.

**Per-app quotas** let the user say "Comicland v2 can use $0.20/day, anything
else $0.10". Not configured? Apps get the $0.10 default. Configure via
`POST /v1/ai/settings` with `app_quotas: { 'comicland-v2': { daily_usd: 0.20 } }`.

**App allowlist** is opt-in. If the user sets `app_allowlist: ['comicland-v2']`,
no other app can call. Apps without an `app_id` are rejected with
`APP_ID_REQUIRED`. Use this when you don't want untrusted apps spending your
budget at all.

---

## Failure modes to design for

| Symptom | Cause | App should… |
|---|---|---|
| Button hidden | `isAvailable()` returned false | Don't nag. App still works without AI. |
| `NO_API_KEY` | User had a key, deleted it | One-time toast + link to Settings. |
| `QUOTA_EXHAUSTED` | Daily budget hit | Disable the button + show "AI budget used up for today". |
| `INVALID_API_KEY` | Key revoked at OpenRouter | Toast + link to Settings — they need to refresh the key. |
| `RATE_LIMITED` | Provider throttling | Backoff (1s, then 3s) and retry once. |
| `PROVIDER_ERROR` | Upstream down | Toast "AI provider is having trouble. Try again in a minute." |
| `JSON_PARSE_FAILED` | Model couldn't produce JSON twice | Toast + offer the raw text so user isn't blocked. |

---

## Cookbook

### Translate inline (replace today's copy-paste workflow)

```js
const r = await AIMEAT.ai.complete({
  prompt: `Translate the following from Finnish to English. Keep tone and length.\n\n${textFi}`,
  modelRole: 'execution',
  max_tokens: Math.max(120, textFi.length * 2),
  app_id: 'comicland-v2',
});
englishField.value = r.content;
```

### Suggest tags (JSON output)

```js
const r = await AIMEAT.ai.completeJson({
  prompt: `Suggest tags for this series. Output JSON of the form {"tags": ["tag1", "tag2", ...]} with 3-5 short single-word tags in lowercase.\n\nSummary: ${summary}`,
  app_id: 'comicland-v2',
});
tagsInput.value = r.parsed.tags.join(', ');
```

### Continuity check across episodes

```js
const r = await AIMEAT.ai.complete({
  prompt: `Compare these two episode summaries for tone/style continuity. List any inconsistencies in 1-3 short bullet points. If none, output "Consistent."\n\nEpisode 1:\n${ep1summary}\n\nEpisode 2:\n${ep2summary}`,
  modelRole: 'reasoning',                        // hard task → smarter model
  max_tokens: 300,
  app_id: 'comicland-v2',
});
continuityReport.textContent = r.content;
```

### Pre-publish quality gate

```js
const r = await AIMEAT.ai.completeJson({
  prompt: `Review this comic script for: (a) typos, (b) unclear panel directions, (c) anachronisms vs the series setting "${seriesGenre}". Output JSON: {"issues": [{"type": "typo|unclear|anachronism", "panel": N, "text": "..."}]}. If no issues, return {"issues": []}.\n\nScript:\n${scriptJson}`,
  modelRole: 'reasoning',
  max_tokens: 600,
  app_id: 'comicland-v2',
});
if (r.parsed.issues.length === 0) toast('No issues found.');
else renderIssueList(r.parsed.issues);
```

---

## What this is NOT

- **Not free.** Every call spends the user's OpenRouter credits.
- **Not a chat session.** No history. Each `complete()` is one round-trip.
  If you need history, you compose it into the prompt yourself.
- **Not for streaming yet.** Long completions feel slow. Streaming SSE may
  land later; for now, set realistic `max_tokens` and a "Working…" indicator.
- **Not for hidden loops.** This is a human-in-the-loop primitive. Don't
  use it to power agents that run autonomously — AIMEAT has the
  capabilities + work-queue system for that.
- **Not authoritative for billing.** Cost numbers shown are best-effort.
  The user's OpenRouter dashboard is the actual bill.

---

## Where to look next

- API endpoint source: [`aimeat/src/routes/ai.ts`](../aimeat/src/routes/ai.ts)
- Browser library source: [`aimeat/src/routes/lib-ai.ts`](../aimeat/src/routes/lib-ai.ts)
- Design doc with rationale: [`docs/research/2026-05-29-aimeat-ai-capability.md`](research/2026-05-29-aimeat-ai-capability.md)
- E2E tests as examples of expected behaviour:
  [`aimeat/test/ai.ts`](../aimeat/test/ai.ts)
- The OpenRouter settings panel UI lives in
  [`aimeat/public/views/profile/generator-settings.js`](../aimeat/public/views/profile/generator-settings.js)
  (`AiAppsBudgetPanel`).
