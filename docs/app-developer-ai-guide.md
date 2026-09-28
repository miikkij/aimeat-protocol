# Building AI-assisted apps on AIMEAT

> **Audience:** AI chats producing AIMEAT apps, and humans who want to add
> "✨ Use AI" affordances to their app.
> **Layer:** App-level. The owner's own AI providers answer the calls: their
> OpenRouter, OpenAI, Anthropic, Mistral or xAI account, a model server on their
> own machine, or any OpenAI-compatible address, beside the providers the node
> offers. The owner pays and sets the rules; the node holds the keys and applies
> the rules.
> **Status:** Available since AIMEAT 1.13.x via `/v1/libs/aimeat-ai.js`. Providers,
> capabilities, files, streaming, embeddings and AI roles: updated 2026-09-28.

---

## TL;DR

1. Add `await loadScript('/v1/libs/aimeat-ai.js')` to your app's boot.
2. Ask what is on before you show a control. `await AIMEAT.ai.capabilities()`
   says, for each capability, whether a call would work now and, when it would
   not, why and what fixes it. `await AIMEAT.ai.isAvailable()` still answers,
   but it reads only the older OpenRouter key setup. See
   [Capabilities: check first](#capabilities-check-first).
3. **Compose the prompt yourself** from your app's structured data; ask the
   LLM only for the squishy step.
4. Call `AIMEAT.ai.complete({ prompt, app_id: 'your-app-name', ... })`. Leave
   out `model`: the owner's providers and model policy choose one.
5. **Render the result into an editable field** so the human stays in the
   loop. Don't write it directly into final storage.
6. Catch errors and show actionable messages (`AI_CAPABILITY_UNAVAILABLE`,
   `AI_MODEL_NOT_ALLOWED`, `QUOTA_EXHAUSTED` and the others in the error code
   table below).

No provider key ever leaves the AIMEAT server. Your app sees the answer, the
token and cost usage, and `route`: which provider answered and whether the call
moved on to another one. Spend is bounded by the owner's daily USD budget
(default $1) and an optional per-app daily quota.

---

## Why this exists

AI chats are useful, but AI chats don't have your user's AI accounts.
Without this capability, every AIMEAT app that wants AI assistance has to:

- Make the user paste their API key into the app (security risk + UX friction)
- Bundle the app's OWN API key (the dev pays for everyone's spend)
- Skip AI features entirely

`AIMEAT.ai` solves all three. The owner sets up their AI providers **once**, on
the AI settings page of their AIMEAT profile: their own OpenRouter, OpenAI,
Anthropic, Mistral or xAI account, a model server on their own machine, or any
OpenAI-compatible address. The node can offer providers of its own beside them,
and the Calibrator and the other node features use the same providers. Apps
reach them through a budget-gated server endpoint: they never see a key, cannot
copy one out, and cannot spend beyond what the owner allowed.

What the owner decides, and your app works within:

- **Which provider serves which capability.** There are seven capabilities:
  `text`, `vision` (images as input), `files` (the model reads a PDF or another
  file itself), `image` (making pictures), `speech` (text to speech),
  `transcription` (speech to text) and `embed` (embeddings). Each provider serves
  some of them, and the owner puts the providers in order per capability.
- **Fallback.** When the first provider fails, the owner's rules say whether the
  call moves on to the next one. Every answer carries `route`: `chosenBy` (what
  picked the first provider, for example `call-model`, `app-prefer`,
  `owner-default` or `node-default`), `answeredBy` (provider and model),
  `attempts` (each try, its failure class and its cost) and `fellBack` (true
  when a later provider answered).
- **Which models are allowed.** The owner's model policy may limit the models. A
  call that names a model outside it gets 403 `AI_MODEL_NOT_ALLOWED`, and the
  error's `details.allowed` lists the models it may use. When the policy picks
  the model itself (the call named none, or the default model is not allowed),
  the answer carries `policy_chose_model: true`.
- **What it costs.** A daily budget, and a per-app quota when the owner sets one.

Your app asks for the work. The owner's rules decide which provider and which
model do it, and an app cannot widen those rules. It can narrow them for itself,
and state its preferences: see [Choosing models from an app](#choosing-models-from-an-app).

This matches the AIMEAT philosophy: **the user owns their data, their money,
and their AI.** Apps are tools.

---

## Apps run on an isolated origin — no ambient session

A published AIMEAT app runs on a **separate, isolated origin** — `*.apps.<domain>`
(e.g. `apps.aimeat.io`), **not** the apex (`aimeat.io`). That is a different
browser origin, by design (security finding H-2 — see
[deployment checklist](security/deployment-checklist.md)
for the origin setup). What this means for your app:

- **No ambient login session.** The app **cannot** read the user's `aimeat.io`
  cookie, session, or `localStorage`. There is no implicit "owner is logged in"
  to ride on.
- **Never call `/v1/auth/refresh`, and never `fetch(..., { credentials: 'include' })`
  expecting the user's session.** There is no session on the app origin — those
  calls fail with 401/403. (This is the exact pattern that was removed; apps
  that read the owner's private memory directly now get rejected.)
- **`AIMEAT.ai` (this guide) is unaffected.** Its calls go to the node's AI
  endpoints under the app's own `ai:use` grant, not a session. Use it exactly as
  documented here.

### On a node several people share with no app origin: the isolated frame

A node without app addresses that more than one person uses (a company node on
an internal name, for example) never runs an app on its own address, where the
session of the person who opens it lives. The app keeps its usual link
(`/v1/apps/<owner>/<file>?mode=inline`), and the node answers it with a small page
that holds the app in an iframe whose origin is **opaque**. That page gets the
app **its own** grant (the owner's own app silently, another person's app after
the consent window) and keeps the app's `localStorage` for it. A node one person
uses runs apps on its own address as before.

What an app author has to know:

- **Use `aimeat-auth` and it works unchanged.** `AIMEAT.auth.login()`,
  `AIMEAT.auth.signIn()` (from a click), `session.fetch()` and every SDK library
  take the grant from the page around the frame. `AIMEAT.auth.isAppOrigin()` is
  `true` there.
- **`localStorage`, `sessionStorage` and `document.cookie` work.** The node keeps
  `localStorage` for each app separately; cookies last until the page closes.
- **Not there:** the node's own cookies and stored session, `/v1/auth/refresh`,
  `IndexedDB`, service workers, push notifications, installing the app, and Web
  Locks. Keep what must last in memory or files through the node
  (`AIMEAT.data`, `AIMEAT.storage`).
- **The hand-rolled grant flow below does not fit the frame:** the frame cannot
  navigate the whole tab to the consent page and back. Let `aimeat-auth` do it.
- Links the app opens in a new window (`target="_blank"`) open as ordinary pages.

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

### Styling the sign-in pill

The pill `mountLoginButton` renders carries no colours of its own. It reads the page's tokens
(`--text` for its frame and words, `--bg` behind them, `--accent` for the name, `--success` for
the live dot, `--sun` for the sign-in slab's shadow, `--font-showroom-body` or `--font` for the
face) with a fallback for each, so on a page that defines none it is ink on paper, and on a page
with a palette it follows the palette. To give it a look of its own, set these on any ancestor
(the mount point is enough):

```css
#header-auth {
  --aimeat-pill-fg: #1A1A2E;      /* frame and words */
  --aimeat-pill-bg: transparent;  /* behind them */
  --aimeat-pill-name: #E8564A;    /* the signed-in name */
  --aimeat-pill-live: #10B981;    /* the dot */
  --aimeat-pill-radius: 0;        /* square by default; 999px for a capsule */
  --aimeat-pill-font: 'Archivo', system-ui, sans-serif;
  --aimeat-pill-cta-bg: #1A1A2E;  /* the signed-out slab */
  --aimeat-pill-cta-fg: #FAFAF8;
  --aimeat-pill-cta-shadow: #FFB52E;
}
```

The language switch, the light/dark switch and the palette picker inside the pill take the same
frame colour and radius. Nothing in the markup is styled inline, so a stylesheet rule on
`.aimeat-auth-pill`, `.aimeat-auth-logout` or `.aimeat-sign-btn` also works when a variable is
not enough.

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
    case 'AI_CAPABILITY_UNAVAILABLE':             // no working provider for this capability
    case 'AI_MODEL_NOT_ALLOWED':                  // the message lists the models the owner allows
      alert(e.message);
      break;
    case 'NO_API_KEY':
      alert('Your AI provider has no key yet. Set it on the AI settings page of your AIMEAT profile.');
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
      alert('Your AI provider rejected its key. Enter it again on the AI settings page.');
      break;
    case 'RATE_LIMITED':
      alert('The AI provider rate-limited the request. Try again in a few seconds.');
      break;
    default:
      console.error('AI call failed:', e);
      alert('AI call failed: ' + e.message);
  }
}
```

Five things this example gets right and you should copy:

1. **Availability gate**: hides the button when AI is not set up. No nag
   dialog on every page load. `isAvailable()` reads only the older OpenRouter
   key setup; in new code gate on `capabilities()` (next section), which is
   exact for every capability.
2. **App composes the prompt** — series summary is structured data we already
   have; we just ask the LLM for the suggestion.
3. **`app_id` always passed** — lets the user see "Comicland used $0.04
   today" in their settings, and lets per-app quotas work.
4. **Render to an editable field** — `series-tags` is a textarea/input the
   user can correct before saving.
5. **Specific error handling** — each `err.code` gets a different actionable
   message. No "something went wrong" UX.

---

## Capabilities: check first

A capability that works on your node can be off on the owner's. Their providers
may not serve it, a key may be missing, their model policy may allow nothing for
it, or today's budget may be spent. Ask before you show the control:

```js
const { capabilities } = await AIMEAT.ai.capabilities();   // GET /v1/ai/capabilities
const image = capabilities.image;
if (image.on) {
  showImageButton();
} else {
  showNote(image.fix);   // what the owner does to turn it on, in words a person can act on
}
```

The node plans each capability with the same gate a real call runs, and spends
nothing. The route takes `?app_id=`, so the answer counts that app's allowlist
and quota, and an app's own grant and `aimeat-ai` meta count too.

For each of `text`, `vision`, `files`, `image`, `speech`, `transcription` and
`embed` the answer has:

- **When on:** `model` (as `<type>:<model id>`), `provider`, `providerType`,
  `leaves` (true when the data goes off this machine), `chosenBy`, `keySource`
  (whose key pays: `agent`, `own` or `node`), `fallbacks` (how many providers a
  call could move on to), `price` (from the model catalogue, when known) and
  `howTo` (the call to make).
- **When off:** `reason`, `code` and `message` (the refusal a call would get),
  `fix`, and `howTo`.

Beside the capabilities it returns `policy` (whether the owner's model policy
applies to this caller), `budget` (`dailyBudgetUsd`, `spentTodayUsd`) and
`catalog` (when the model catalogue was last refreshed).

| `reason` | What it means |
|---|---|
| `NO_MODEL` | A provider serves it, but no model is set for it. |
| `NO_PROVIDER_SUPPORTS` | None of the owner's providers serves it. `providersThatCan` names the provider types that would. |
| `NO_KEY` | The provider that would answer has no key. |
| `POLICY_EMPTY` | The owner's model policy allows no model for it here. |
| `BUDGET_EXHAUSTED` | Today's budget, or this app's quota, is spent. |
| `RETIRED_MODEL` | The model set for it is retired. |
| `UNTESTED` | The owner's rules use only tested providers, and this one has not been tested. |
| `APP_NOT_ALLOWED` | The owner allows AI only for listed apps, and this app is not on the list. |
| `UNAVAILABLE` | Anything else; `code` and `message` say what. |

Show `fix` to the person. It names what the owner changes and where. Never ask
for a key inside your app or in a chat: keys go in on the AI settings page and
nowhere else. When a capability is off, the rest of the app keeps working
without it.

The publish check reminds you when an app calls `image()`, `speak()`,
`transcribe()`, `embed()` or `complete()` with `files` and never calls
`capabilities()` or `isAvailable()`. The hint never stops a publish.

---

## Choosing models from an app

Ask for the work, not a model: a call without `model` uses what the owner's
providers and policy give. When the app really needs certain models, or has a
preference, say so in the `aimeat-ai` meta in the head. The value is
`key=value` pairs separated by `;`, and a list inside a value is separated by
`,`. It is not JSON.

```html
<meta name="aimeat-ai" content="generates=text,image; discloses=yes; models=openrouter:anthropic/claude-opus-5.5,openrouter:black-forest-labs/flux.2-pro; prefer.image=openrouter:black-forest-labs/flux.2-pro; prefer.text=anthropic,openrouter; local.transcription=yes">
```

| Key | What it does |
|---|---|
| `models=` | The models this app allows **itself**, each as `<type>:<model id>`. The type is `openrouter`, `openai`, `anthropic`, `mistral`, `xai`, `local` or `openai-compatible`. The node applies the list to every AI call the app makes, beside the owner's policy, so it can only narrow what the app may use. A malformed entry is left out and named in the publish hints; the app is published either way. |
| `prefer.<capability>=` | The app's order of preference for one capability: provider types (`anthropic`) or model references (`openrouter:black-forest-labs/flux.2-pro`), first choice first. It reorders the owner's own candidates. It never adds a provider the owner does not have, and never loosens one of their rules. When the app also has `models=`, a preferred model must be on that list too. |
| `local.<capability>=yes` | Answer this capability only on this machine: a provider whose data does not leave it. When the owner has none, the capability is off for this app, and `capabilities()` says so. |

`<capability>` is one of `text`, `vision`, `files`, `image`, `speech`,
`transcription` and `embed`. `generates=`, `discloses=` and `public-interest=`
are the transparency statement the publish check reads; keep them.

Model ids come from the model catalogue: `AIMEAT.ai.models()` (GET
`/v1/ai/models`) lists each model with its `ref`, which is the string to put in
`models=` or `prefer.`. The publish check names a declared model the catalogue
does not know.

A call can also name a `provider` (a provider type) and `fallback: false` (do
not move on to another provider). An app cannot know the owner's provider ids,
so prefer the meta over naming providers in calls.

## AI roles: say what a model is for

A capability says what a model does. A **role** says what it is used for: a
summarizer, a writer, an illustrator. When an app has more than one kind of AI
work, or one piece of work that needs its own fine-tuning, declare a role for
each in the `aimeat-ai` meta, and call with `role`:

```html
<meta name="aimeat-ai" content="generates=text,image; discloses=yes;
  role.summarizer=text; role.summarizer.purpose=Short summaries of a recipe; role.summarizer.temperature=0.2;
  role.illustrator=text+image; role.illustrator.purpose=A picture for each recipe">
```

```javascript
const r = await AIMEAT.ai.complete({ app_id, prompt, role: 'summarizer' });
```

| Key | What it says |
|---|---|
| `role.<name>=` | The capabilities the role needs, joined with `+` (`text`, `text+image`). The name is lower-case letters, digits and `-`. |
| `role.<name>.purpose=` | What the role is for, in a few words the owner reads. No `;` inside. |
| `role.<name>.local=yes` | Only providers on this machine. |
| `role.<name>.context=` | The least context the role needs, in tokens. A model the model catalogue says reads less is passed over, and the owner's AI page says so. |
| `role.<name>.temperature=`, `.top_p=`, `.max_tokens=`, `.reasoning=` | The fine-tuning this role wants. It overrides the provider's default, and the call's own value overrides it. `reasoning` is `off`, `low`, `medium` or `high`. |

**A role says what the work needs, never which model.** The owner connects your
role to one of their own roles, and theirs names the providers and models to try
in order. So the app works on whatever providers the owner has, from any vendor.

The owner can connect your role only to a role of theirs that has a provider for
every capability yours needs.

**Nothing runs until the owner connects the role.** A call with a role the owner
has not connected is refused with `AI_ROLE_NOT_BOUND` (409), and the owner sees
the request on the AI page with what the role needs. Check first:
`AIMEAT.ai.capabilities()` answers `roles`, each with `bound` and, when it is
not, a `fix` sentence to show. Keep the button visible and show the fix beside
it. The owner's AI can propose the connection with `aimeat_ai_role_set`, and the
owner confirms it.

Other refusals: `AI_ROLE_NOT_DECLARED` (the meta does not declare that role) and
`AI_ROLE_LACKS_CAPABILITY` (the owner's role has no provider for the capability
the call needs). The owner's model policy still applies to every role.

---

## API reference

### `await AIMEAT.ai.isAvailable() → boolean`

A yes or no from GET `/v1/ai/available`. Cached 60s; cheap to call on every
render. Returns `false` (not throws) when not logged in. It reads only the
older OpenRouter key setup (an OpenRouter key, or a keyless self-hosted
provider), so an owner whose text runs on another provider, or on one the node
offers, can get `false`. `capabilities().capabilities.text.on` is the exact
answer, and `capabilities()` covers every other capability too.

### `await AIMEAT.ai.capabilities() → { capabilities, policy, budget, catalog }`

GET `/v1/ai/capabilities`. What each capability can do for this caller now,
and for one that is off, the reason and the fix. See
[Capabilities: check first](#capabilities-check-first).

### `await AIMEAT.ai.complete(opts) → { content, model, usage, budget, route, ... }`

Run one completion. POST `/v1/ai/complete`.

| Option | Type | Notes |
|---|---|---|
| `prompt` | string | Required. ≤ 200,000 characters. |
| `systemPrompt` | string | Optional system message. |
| `model` | string | Usually leave it out. A model reference `<type>:<model id>` (or a bare id on the provider that answers). A model outside the owner's policy gets 403 `AI_MODEL_NOT_ALLOWED`. |
| `modelRole` | `'reasoning'` \| `'execution'` | Pick from the owner's per-role default. Use `'execution'` for cheap routine tasks; `'reasoning'` for hard ones. |
| `images` | string[] | Makes it a `vision` call: data: or https: URLs, at most 8. Downscale first. |
| `files` | object[] | Makes it a `files` call: `[{ storage_key }]` or `[{ data_url }]`, at most 5 files and 20 MB in all. See [Files and PDFs](#files-and-pdfs). |
| `provider` | string | A provider type to try first. Prefer `prefer.text=` in the meta. |
| `fallback` | boolean | `false` stops the call from moving on to another provider when the first one fails. |
| `temperature` | number | 0–2. Falls back to the owner's default. |
| `top_p` | number | Falls back to the owner's default. |
| `max_tokens` | number | Omit in new app code. Specify output shape in the prompt and use the owner's daily budget for spend control. |
| `app_id` | string | **Always set this.** Identifies your app for per-app quotas and the owner's spend dashboard. |

Returns:

```js
{
  content: "string the model wrote",
  model: "anthropic/claude-sonnet-4",            // actual model used
  finish_reason: "stop",
  truncated: false,                              // true: cut at a length limit, show it as unfinished
  policy_chose_model: true,                      // only present when the owner's policy picked the model
  route: {
    capability: "text",
    chosenBy: "owner-default",                   // what picked the first provider
    answeredBy: { provider: "openrouter", model: "anthropic/claude-sonnet-4" },
    attempts: [{ provider: "openrouter", model: "anthropic/claude-sonnet-4", ok: true, costUsd: 0.0018 }],
    fellBack: false,                             // true when a later provider answered
  },
  usage: {
    prompt_tokens: 142,
    completion_tokens: 38,
    total_tokens: 180,
    cost_usd: 0.0018,                            // provider-reported, or from the catalogue price
    cost_exact: true,                            // true if the provider reported it
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
| `AI_CAPABILITY_UNAVAILABLE` | No working provider serves this capability for the owner. The message names what to set up. |
| `AI_MODEL_NOT_ALLOWED` | 403. The model named in the call is outside the owner's policy, or no allowed model is reachable. `details.allowed` lists the allowed models. |
| `AI_MODEL_POLICY_EMPTY` | 403. The owner's policy and the app's `models=` have no model in common. |
| `AI_PROVIDER_NOT_CONFIGURED` | The model named in the call belongs to a provider type the owner has not set up. |
| `NO_API_KEY` | The provider that would answer has no key. |
| `INVALID_API_KEY` | Provider rejected the key (key revoked or expired). |
| `QUOTA_EXHAUSTED` | Daily owner budget hit. |
| `APP_QUOTA_EXHAUSTED` | Per-app daily quota hit. |
| `APP_NOT_ALLOWED` | Owner has an allowlist and your `app_id` isn't on it. |
| `APP_ID_REQUIRED` | Owner has an allowlist but the call had no `app_id`. |
| `INVALID_BODY` | Missing/malformed prompt, `images` or `files`. |
| `PROMPT_TOO_LONG` | Prompt exceeds 200k characters. |
| `FILES_TOO_LARGE` | The files come to more than 20 MB. |
| `NOT_FOUND` | A `storage_key` in `files` is not in the caller's own storage. |
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

### `await AIMEAT.ai.stream(opts)`

POST `/v1/ai/stream`. The answer arrives piece by piece, for a long text the
person watches being written. The body takes `app_id` (required), `messages`
(`[{ role: 'system' | 'user' | 'assistant', content }]`, at most 200,000
characters in all) and optionally `model`, `temperature`, `top_p`, `max_tokens`.
The response is NDJSON (one JSON object per line, `application/x-ndjson`), not
SSE:

```
{"type":"start","model":"..."}
{"type":"text","text":"Once "}
{"type":"text","text":"upon a time"}
{"type":"done","model":"...","finish_reason":"stop","truncated":false,...}
```

A failure after the first line arrives as `{"type":"error","code":"...","message":"..."}`.
`?json=1` returns the whole answer as one ordinary JSON response instead.

### `await AIMEAT.ai.image(opts)`

POST `/v1/ai/image` with `{ app_id, prompt, model?, size?, public? }`. The
picture is stored in the owner's storage and the answer names its
`storage_key`. Show it with `r.src`: for a private picture it is a signed
`download_url` that loads without a sign-in for an hour, because the plain `url`
needs `storage:read`, which an app with only `ai:use` does not hold. To show the
picture again later, make it `public: true`, or ask for `storage:read`. A picture
costs more than a text call: show the person the price
(`capabilities().capabilities.image.price`) before the first one.

### `await AIMEAT.ai.speak(opts)`

POST `/v1/ai/speak` with `{ app_id, input }` (at most 4,000 characters) and
optionally `voice`, `model`, `response_format` (`pcm` or `mp3`), `speed` and
`instructions`. Leave out `model` and `voice` when the owner or the node has set
them. The response is NDJSON: a `start` line, `audio` lines with base64 chunks,
and a `done` line. `?json=1` stores the audio as a private file in the caller's
storage instead and answers with its `storage_key`.

### `await AIMEAT.ai.transcribe(opts)`

POST `/v1/ai/transcribe` with `{ app_id, storage_key }` for a recording in the
caller's own storage (preferred), or `audio_base64` and `mime` for a short
recording the browser has not stored. Optional `language` and `model`.

### `await AIMEAT.ai.embed(opts)`

POST `/v1/ai/embed` with `{ app_id, input, model?, provider?, fallback? }`.
`input` is one text or a list of texts: at most 256 texts and 500,000
characters in one call. Returns `{ embeddings, model, dimensions, route, usage,
budget }`, one vector per text in the same order. A fallback goes only to the
**same model** on another provider, because vectors from different models
cannot be compared. Read [Embeddings](#embeddings) before you use it.

### `await AIMEAT.ai.models(opts?) → { models, total, truncated, snapshot, refreshed_at }`

GET `/v1/ai/models`, the node's model catalogue. An app with `ai:use` can call
it. Query: `capability` (one of the seven), `type` (a provider type), `status`
(default `active,retiring`; `all` for everything), and `allowed=true` for only
the models this caller may use on a provider it can reach. Each model has `ref`
(`<type>:<model id>`, the string for a call or for `models=`), `name`, `caps`,
`limits`, `price`, `status` and, when it is being retired, `retires_at`. Useful
for "advanced" UIs where the person picks a model.

### `await AIMEAT.ai.usage() → { date, daily_budget_usd, spent_today_usd, ... }`

Today's spend snapshot. Use to show "AI used: $0.04 / $1.00" in your app's
sidebar, or for an admin dashboard.

### `AIMEAT.ai.invalidateCache()`

Clears the 60s availability + 1h models cache. Call after the owner changes
their providers or budget in another tab.

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

## Files and PDFs

With the `files` capability the **model reads the file itself**: a PDF with its
layout, tables and pictures, or another file type the model accepts. The node
converts nothing. It passes the file to a provider whose model reads files, and
it never turns a PDF into text on the way.

```js
const { capabilities } = await AIMEAT.ai.capabilities();
if (!capabilities.files.on) return showNote(capabilities.files.fix);
const r = await AIMEAT.ai.complete({
  app_id: 'invoice-reader',
  prompt: 'List the invoice number, the due date and the total of this invoice.',
  files: [{ storage_key: 'uploads/invoice-2026-09.pdf' }],
});
```

- `files` takes `[{ storage_key }]` for a file already in the caller's own
  storage (preferred), or `[{ data_url: 'data:application/pdf;base64,...' }]`.
  Optional `filename` and `mime` on each entry.
- At most 5 files and 20 MB in all per call.
- A `storage_key` is looked up in the caller's own storage only; a key that is
  not there answers 404. An https URL is not accepted: store the file first and
  pass its `storage_key`.
- Pictures are a separate capability, `vision`: pass them in `images`.

**When `files` is off**, show the `fix` and offer the person the two honest
ways on:

1. Add a provider whose model reads files. `providersThatCan` in the
   capabilities answer names the provider types that would serve it.
2. Use an outside service built for the job, such as a document conversion or
   OCR service the person chooses, and bring its text back as text.

Do not convert the file inside the app (for example with a JavaScript PDF
library) and then send the text as if the model had read the file. Tables,
layout, pictures and scanned pages drop out, and the answer then claims a
reading that did not happen. When the person agrees to a text-only reading, say
so in the app and send it as `prompt` text, not as `files`.

---

## Embeddings

An embedding turns a text into a vector: a list of numbers that captures what
the text means. Texts with a similar meaning get vectors that lie close
together, even when they share no words, so "invoice late" finds "payment not
received by the due date". An app seldom needs them.

**The rule: embeddings are rare, and the person decides.** Build with word
search (`AIMEAT.data.search`), filters, or the whole collection in one prompt.
An app, or an AI that builds one, never adds embeddings on its own initiative.
Talk about them only when the person asks, or when both tests below fail; then
say what they cost and let the person decide.

**Test 1: does the collection fit in one prompt?** A current text model reads
200,000 tokens or more in one call, about 150,000 words: thousands of short
items. 120 recipes are about 40,000 tokens. When the collection fits and
changes little, give all of it to `complete()`. That is simpler, and usually
more accurate than finding pieces first.

**Test 2: does word search find it?** Try it with the words people really use.
A reason exists only when a real use keeps missing texts written in other words
or in another language.

**Truly needed only when all three hold:**

- The collection is far larger than one prompt (hundreds of thousands of tokens
  and more), or it grows every day.
- People search it by meaning, often.
- Sending all of it with every question would cost too much.

Examples: years of a company's documents; a support archive of tens of
thousands of messages; search across languages in such a collection.

**Never for:**

- A few hundred or a few thousand short texts.
- Exact values: ids, names, dates, amounts. A vector for "INV-2026-0413" does
  not find that invoice reliably; word search does.
- Only the newest data. Sort by date instead.
- Data that must not leave the machine, when the owner has no local embedding
  model. Every text goes to the provider.
- "Just in case". Vectors cost money to make, take room to keep, and must be
  made again when the model changes.

**Cost.** Embedding is cheap per text but grows with the collection. As of
2026-09-27, `text-embedding-3-large` costs $0.13 and `qwen3-embedding-8b` costs
$0.01 per million input tokens: 10,000 notes of 500 tokens each (5 million
tokens) cost $0.65 or $0.05. Changing the model means embedding everything again,
because vectors from different models cannot be compared. Store the `model` the
answer names beside the vectors, so you know when that is due. The capabilities
answer shows the price of the model that would answer.

**Size.** A vector has 1,536 or 3,072 numbers, depending on the model: 6 kB or
12 kB as 32-bit floats, and about two to three times that written as JSON
numbers. One memory value holds 1,024 kB, so it holds about 85 to 170 vectors as
raw floats and fewer than half of that as JSON. A memory record is not the place
for a large vector collection. The publish check reminds you when an app both
embeds and writes memory.

**What to embed:**

- Condensed content works better than raw text: a summary, the key facts, a
  title with its abstract. Noise in the text is noise in the vector.
- Split long text into passages (a few paragraphs each) and embed each passage;
  one vector for a whole long document blurs its meaning.
- Embed what people search for, in the form they search it.
- Never embed secrets: passwords, keys, personal identity numbers. The text goes
  to the provider, and a vector can give away what it was made from.

**The node itself has no vector search yet.** `POST /v1/ai/embed` makes vectors
and nothing on the node stores, indexes or compares them. An app that embeds
keeps the vectors and does the comparison itself (cosine similarity is a few
lines of JavaScript for a small set).

```js
const r = await AIMEAT.ai.embed({ app_id: 'notes', input: passages });
// r.embeddings[i] belongs to passages[i]; keep r.model and r.dimensions beside them
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

An extension starts a **background** model call with `ctx.ai.start()`. It does
not wait for the answer: a model call can take many minutes, and the sandbox
stops a run after 60 seconds. `start()` queues a job and answers in
milliseconds; the node runs the job and puts the answer in memory.

```js
const r = await ctx.ai.start({
  prompt: 'Summarise these notes in five bullet points.',
  input_keys: ['notes.2026-09'],                  // records added to the prompt, labelled by key
  result_key: 'summaries.2026-09',                // where the answer lands
  on_done: { extension: 'my-notes', action: 'summaryReady' },
});
if (!r.ok) return { queued: false, code: r.code, retry_after_s: r.retry_after_s };
return { queued: true, job_id: r.job_id };
```

| Option | Notes |
|---|---|
| `prompt` or `prompt_key` | The prompt text, or a memory key that holds it. |
| `input_keys` | Memory records read and added to the prompt, each labelled by its key. |
| `result_key` | Required. The memory key the answer is written to, in the installer's namespace. |
| `result_visibility` | `'private'`, `'owner'` or `'public'`. |
| `model`, `system_prompt` | As for a completion. |
| `json` | Parse the answer as JSON before storing it, so a malformed answer fails the job instead of landing as a string. |
| `op` | `'text'` (default), `'image'` (a picture from the prompt, stored in the owner's storage; the record at `result_key` is `{ storage_key, url, mime_type, model }`) or `'transcribe'` (the audio file at `audio_key` becomes text). |
| `audio_key`, `language` | For `op: 'transcribe'`: the audio file's storage key, and an optional language hint. |
| `size`, `provider` | The picture size for `op: 'image'`; a provider id or type to use, with no fallback. |
| `on_done` | `{ extension, action }`: an action of an extension the same owner installed, called when the job ends. |

- **It returns a decision and never throws:** `{ ok: true, job_id, queue_position }`
  or `{ ok: false, code, message, retry_after_s? }`. The codes are
  `AI_JOB_QUEUE_FULL` (the node's queue is full; try again later),
  `AI_JOB_LIMIT_REACHED` (this owner has too many jobs queued, which usually
  means something loops), `AI_JOB_CHAIN_TOO_DEEP` (a chain of `on_done` jobs went
  too deep), `AI_JOB_PROMPT_TOO_LARGE` and `AI_JOB_START_FAILED`.
- **The extension's installer pays, never the caller.** The call counts under
  `app_id: ext:<extension name>`, so it shows per app in the owner's usage, and
  a per-app quota applies to it.
- **`on_done`** calls the named action with `{ job_id, state, result_key }`. That
  action reads the answer and may start the next job, so the chain logic stays in
  the extension's own code. When the chain cannot continue, the parent job ends
  `failed`, never green.
- **`ctx.ai` can be absent:** on a code path where the node does not know the
  extension's record (so it cannot say who pays), and on a node without the AI
  job service. Check `if (!ctx.ai)` and degrade.
- The same jobs start outside an extension with POST `/v1/ai/jobs` or the MCP
  tool `aimeat_ai_job_start`.

For short work a person watches, the browser path still fits better: the
extension does the data work, and the cortex or app runs `AIMEAT.ai` on the
result, where the person sees it happen.

---

## Protecting your app (and its honest limits)

**The only durable protection is keeping value on the server.** A published app is
single-file HTML the browser runs — anyone who can open it can read and copy its
client code. That is inherent to the web, not a gap in AIMEAT. So:

- **What CANNOT be protected:** your app's HTML, its inline scripts, and the public
  `/v1/libs/*` + `/v1/cortex/*/libs/*` runtime. A determined person can always copy
  the shell.
- **What CANNOT be copied — the moat:** your **extension** action logic (runs in a
  server-side WASM sandbox; its source is never shipped to the browser and can't be
  re-installed without it), your **extension secrets** (API keys, encrypted at rest),
  **gated memory**, and the owner's **AI provider keys** (never leave the server). An app whose
  value lives in an extension is copy-proof by construction — a copied shell is a dead
  client. **If a piece of logic or data matters, put it in an extension**, not the app.

**Opt-in shell hardening (Manage → 🛡 Copy protection, or PATCH `/v1/apps/:filename`
with `{ protection }`).** All default OFF. These raise the cost of casual theft and
make leaks traceable — they do **not** make client code secret:

| Flag | What it does | Honest limit |
|------|--------------|--------------|
| `obfuscate` | Mangles the app's inline scripts at serve time | Deobfuscation is possible; raises cost only |
| `domainLock` | App only runs on this node's app origin; a rehosted copy is sent home | Client-side guard — strippable |
| `watermark` | Embeds an invisible, operator-decodable per-serve fingerprint | Traces a leak; doesn't prevent one. Decode via `POST /v1/admin/apps/watermark/decode` |
| `noRawDownload` | Blocks the raw source download — runnable delivery only | Inline HTML is still in the browser |

Rule of thumb: **hardening deters and detects; the extension moat prevents.** Reach for
the flags for casual deterrence; reach for an extension when it actually matters.

**Deep dive:** [Protecting your work: move business logic into an extension](guides/protecting-your-work-with-extensions.md)
— how to decide what to move server-side, with a before/after worked example.

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
- **Specify output length in the prompt.** Omit `max_tokens`; the owner's daily
  budget controls spend. Check for truncation before accepting the result.

---

## Spend safety in practice

The owner sets a daily USD budget (default $1). Every AI call counts toward
it: text, streaming, pictures, speech, transcription and embeddings. When it is
spent, calls return `QUOTA_EXHAUSTED` until midnight UTC. A call that fell back
counts the failed attempts too, as `route.attempts` shows.

Where the cost comes from, strongest first: a local provider costs nothing; the
charge the provider reported (OpenRouter reports one; `cost_exact: true`); the
model catalogue's price times the use; a fallback rate, set high on purpose. The
direct OpenAI, Anthropic, Mistral and xAI providers report no cost in their
answers, so the catalogue price is their figure. The provider's own dashboard is
the source of truth for the actual bill.

**Per-app quotas** let the owner say "Comicland v2 can use $0.20/day". Without a
quota an app may spend up to the whole daily budget. The owner sets both on the
AI settings page. (`POST /v1/ai/settings` with `app_quotas` still works but is
deprecated: an operator can switch it off, and it is removed in 4.0.0.)

**App allowlist** is opt-in. If the owner lists apps, no other app can call.
Apps without an `app_id` are then rejected with `APP_ID_REQUIRED`, and
`capabilities()` shows `APP_NOT_ALLOWED` for an app that is not listed.

---

## Failure modes to design for

| Symptom | Cause | App should… |
|---|---|---|
| Button hidden | The capability is off in `capabilities()` | Don't nag. Show `fix` once where the button would be. App still works without AI. |
| `AI_CAPABILITY_UNAVAILABLE` | No working provider for that capability | Show the error's message; it names what to set up. |
| `AI_MODEL_NOT_ALLOWED` | The app named a model the owner does not allow | Show the allowed list, or call again without `model`. Never show an empty result. |
| `NO_API_KEY` | The provider that would answer has no key | One-time toast + link to the AI settings page. |
| `QUOTA_EXHAUSTED` | Daily budget hit | Disable the button + show "AI budget used up for today". |
| `INVALID_API_KEY` | Key revoked at the provider | Toast + link to the AI settings page: the owner enters the key again. |
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
  app_id: 'comicland-v2',
});
continuityReport.textContent = r.content;
```

### Pre-publish quality gate

```js
const r = await AIMEAT.ai.completeJson({
  prompt: `Review this comic script for: (a) typos, (b) unclear panel directions, (c) anachronisms vs the series setting "${seriesGenre}". Output JSON: {"issues": [{"type": "typo|unclear|anachronism", "panel": N, "text": "..."}]}. If no issues, return {"issues": []}.\n\nScript:\n${scriptJson}`,
  modelRole: 'reasoning',
  app_id: 'comicland-v2',
});
if (r.parsed.issues.length === 0) toast('No issues found.');
else renderIssueList(r.parsed.issues);
```

---

## What this is NOT

- **Not free.** Every call spends on the owner's providers, except a local
  model on their own machine.
- **Not a chat session.** No history. Each `complete()` is one round-trip.
  If you need history, you compose it into the prompt yourself.
- **Streaming is a separate call.** `complete()` answers once, at the end. For a
  long text the person watches, use `stream()` (POST `/v1/ai/stream`, NDJSON,
  not SSE). For work that takes minutes, start a background job (POST
  `/v1/ai/jobs`).
- **Not for hidden loops.** This is a human-in-the-loop primitive. Don't
  use it to power agents that run autonomously — AIMEAT has the
  capabilities + work-queue system for that.
- **Not authoritative for billing.** Cost numbers shown are best-effort.
  The provider's own dashboard is the actual bill.

---

## Where to look next

- API endpoint source: [`aimeat/src/routes/ai.ts`](../aimeat/src/routes/ai.ts),
  [`ai-capabilities.ts`](../aimeat/src/routes/ai-capabilities.ts) (capabilities, embed),
  [`ai-voice.ts`](../aimeat/src/routes/ai-voice.ts) (stream, speak),
  [`ai-models.ts`](../aimeat/src/routes/ai-models.ts) (the catalogue),
  [`ai-jobs.ts`](../aimeat/src/routes/ai-jobs.ts) (background jobs)
- The routing, providers and model policy: [`aimeat/src/services/ai/`](../aimeat/src/services/ai/)
- The `aimeat-ai` meta and the publish hints:
  [`app-ai-posture.ts`](../aimeat/src/services/app-ai-posture.ts),
  [`app-ai-capability-hints.ts`](../aimeat/src/services/app-ai-capability-hints.ts)
- `ctx.ai.start`: [`aimeat/src/services/ai-jobs/ext-capability.ts`](../aimeat/src/services/ai-jobs/ext-capability.ts)
- Browser library source: [`aimeat/src/static/sdk-libs/ai/index.js`](../aimeat/src/static/sdk-libs/ai/index.js)
- The node skill `aimeat-ai-capabilities` (`aimeat_skill_get`), the guide an AI
  reads with the capabilities answer
- Current contract: [Platform specification](AIMEAT-RFC-v4.0-Platform-full.md)
- E2E tests as examples of expected behaviour:
  [`aimeat/test/ai.ts`](../aimeat/test/ai.ts),
  [`e2e-ai-providers.ts`](../aimeat/test/e2e-ai-providers.ts),
  [`e2e-ai-model-policy.ts`](../aimeat/test/e2e-ai-model-policy.ts)
- The budget and per-app quota panel lives in
  [`aimeat/public/views/profile/openrouter/budget-panel.js`](../aimeat/public/views/profile/openrouter/budget-panel.js).
