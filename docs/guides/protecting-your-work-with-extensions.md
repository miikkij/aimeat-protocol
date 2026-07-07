# Protecting your work: move business logic into an extension

If part of your app is genuinely valuable — a pricing formula, a scoring or matching
algorithm, refined data, a rule that must be *enforced* and not just displayed — do not
leave it in the browser. **The only durable protection on AIMEAT is a server-side
extension.** This guide helps you decide *what* to move and shows *how*, then points you
at the full mechanics.

> **The one rule.** Anything shipped to the browser can be copied by anyone who can open
> your app. That's inherent to the web, not a gap in AIMEAT. What a copier **cannot** get
> is your extension's code (it never leaves the server), its secrets, and the data only it
> can compute. So the question is never "how do I hide my HTML" — it's "what belongs on the
> server instead of in the HTML."

---

## The three layers, through a protection lens

| Layer | Runs where | User can read it? | Copyable? | Put here |
|-------|-----------|-------------------|-----------|----------|
| **App** (HTML / JS / CSS) | the browser | Yes — view-source | **Yes** | Layout, interaction, presentation, the copy-paste prompt flow, anything cheap to reproduce |
| **Cortex lib** (browser IIFE) | the browser | Yes — served from `/v1/cortex/*/libs/*` | **Yes** | Shared *browser* helpers (charts, forms, viewers) — convenience, never secrets |
| **Extension** (WASM sandbox) | the **server** | **No** — `scriptContent` is never sent to the browser | **No** | Business logic, secret API keys, proprietary algorithms, enforced rules, and the compute behind valuable data |

The app and cortex layers are the shop window — visible and copyable by design. The
extension layer is the safe in the back room.

---

## Decision checklist — move it into an extension if…

- It's your **secret sauce** — pricing/margin, scoring, ranking, matching, a proprietary
  model or heuristic. The *code* is the value.
- It needs a **secret** — a third-party API key. Declare it `type: secret`; it's AES-256-GCM
  encrypted at rest and decrypted only inside the sandbox VM, never sent to any client.
- It's a **rule that must hold**, not merely be shown — validation, quotas, entitlements,
  ownership checks. UI checks are advisory; a copied UI can skip them. An extension enforces.
- The **value is the output, not the code** — compute server-side and expose the result
  read-only in `ext:` memory (anyone can *read* it; only your extension can *produce* it).
- **Several clients share it** — your app, your agents, and other people's apps should all
  hit one server-side source of truth instead of each re-implementing it.

Keep in the app/cortex layer: everything else. Don't move presentation or glue server-side
just for secrecy — it adds latency for no protection gain.

---

## Before / after (a worked example)

**Before — the margin logic ships to every visitor:**

```html
<!-- in your app's HTML -->
<script>
  function quote(items) {
    // your secret margin + discount logic, right there in view-source
    return items.reduce((t, i) => t + i.cost * 1.37, 0);
  }
</script>
```

**After — the logic runs server-side; the app just calls it:**

```yaml
# extension.yaml
metadata: { name: pricing, version: "1.0.0", description: "Server-side quoting" }
required_apis: [memory]
actions:
  - id: quote
    method: POST
    path: "/v1/ext/pricing/quote"
    script: "actions/quote.js"
    input: { type: object }
    output: { type: object }
```

```js
// actions/quote.js  — runs in the server WASM sandbox; source never leaves the node
export default async function (ctx, input) {
  const items = input.items || [];
  const total = items.reduce((t, i) => t + i.cost * 1.37, 0); // secret logic stays here
  return { total };
}
```

```js
// in your app — call the action; you never see (or ship) the formula
const resp = await session.fetch('/v1/ext/pricing/quote', { method: 'POST', body: { items } });
const { total } = resp.data;
```

Now a copied HTML shell is a dead client for this feature: the copier never received
`quote.js`, cannot install your `pricing` extension, and calling `/v1/ext/pricing/quote`
on your node runs *your* server code under *their* identity — they get a number, never the
method.

---

## Why the moat actually holds

- **Action code is never shipped.** An extension action's source lives only on the server,
  runs in a QuickJS WASM sandbox with a controlled `ctx` (no Node globals), and is reachable
  only via authenticated `POST /v1/ext/{name}/{action}` — and only if the extension is
  installed and active on that node. There is no endpoint that returns the source to a caller.
- **Secrets stay server-side.** `type: secret` config is encrypted at rest and decrypted
  only just before the VM runs; API responses show a mask, never the value.
- **Data can be read-only-public.** Your extension writes computed results to `ext:{name}`
  memory; apps read them with `AIMEAT.data.getPublic('ext:name', key)`. Reading is open;
  *producing* the data requires your extension.
- **The user's AI key never leaves the server** — a rehosted copy can only ever spend the
  *visiting* user's budget on your node, never yours.

See [`docs/coding-guidelines/extension-memory-architecture.md`](../coding-guidelines/extension-memory-architecture.md)
for the exact namespace + trust boundaries.

---

## Build it

This guide is about *what to move and why*. For the full mechanics — manifest format,
actions, the `activate` action, scheduled (cron) jobs, `ctx.memory` / `ctx.fetch` /
`ctx.wallet`, installing + activating, and wiring the app + cortex + agents together —
follow:

- **[Building a complete Extension + Cortex + App stack](building-extension-cortex-app-stack.md)** — the end-to-end tutorial.
- **Reference extension:** [`docs/extensions/rest-connector/`](../extensions/rest-connector/) — a minimal, generic connector with a per-instance secret key (the bring-your-own-key pattern).
- Building an AIMEAT app that uses AI: [`docs/app-developer-ai-guide.md`](../app-developer-ai-guide.md).

---

## And the HTML you still ship?

You'll always have *some* client shell. For that, AIMEAT offers opt-in, per-app
copy-protection (**Manage → 🛡 Copy protection**, or `PATCH /v1/apps/:filename { protection }`):
**obfuscate** the inline scripts, **domain-lock** the app to your node's origin,
**watermark** each serve so a leaked copy traces back to who was served it, and
**no-raw-download** to remove the one-click source grab.

These **deter and detect** — they raise the cost of casual copying and make leaks
traceable. They do **not** prevent copying of viewable HTML, and they are no substitute for
the moat. Rule of thumb: **harden the shell, but move the value into an extension.**
