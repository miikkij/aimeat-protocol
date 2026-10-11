<!--
@file visibility-contract.md
@description The AI visibility record contract: what one owner's month of counts holds, how each
  count is decided, and what each number is worth. Named by `spec` inside every month record, so an
  agent or another system can read and honour the shape without our code.
@version-history
  v1.3.1 — 2026-10-11 — What the cookie banner says and removes on a page with the owner's tags.
  v1.3.0 — 2026-10-08 — On-page behaviour per app and the fixing agent's runs (layer D).
  v1.2.0 — 2026-10-08 — What AI agents met here: checkouts by stage, tool calls by outcome (layer C).
  v1.1.0 — 2026-10-08 — The settings record and the owner's own analytics tags (layer B).
  v1.0.0 — 2026-10-08 — Initial, with layer A (channels, AI fetches, discovery files, purchases).
-->

# AI visibility: how people and AIs find a place

One record per owner per month, written by the node as it serves the owner's pages, apps and
discovery files, and as their checkouts complete. It answers four questions: where did the people
come from, which AIs read what, who read the files an AI reads to learn how to use the place, and
which purchases followed.

## What a person gets

"Does ChatGPT send me customers, which of my pages does Copilot read, and did any of it turn into a
sale?" A browser analytics script cannot answer the middle question, because AI crawlers and
assistant fetches run no JavaScript. The place serves its own pages, so it sees them.

What it cannot answer: the question a person asked the AI. Only whoever runs the AI sees that. The
report says so in its `reading.not_seen` line.

## The record

`signals.visibility.month.<YYYY-MM>`, in the owner's own namespace, visibility `owner`. The
`signals.` prefix is reserved, so the memory API cannot write a forged count.

```jsonc
{
  "type": "aimeat.visibility.month",
  "spec": "/docs/specs/visibility-contract.md",
  "month": "2026-10",
  "days": {
    "2026-10-08": {
      "total": 212,                 // every counted request, the opted-out ones included
      "optedOut": 9,                // Sec-GPC: 1 or DNT: 1; counted here and nowhere else
      "classes":  { "human": 150, "ai": 41, "bot": 12 },
      "channels": { "ai": 18, "search": 60, "social": 12, "referral": 7, "direct": 50, "internal": 3 },
      "aiReferrals": { "chatgpt": 11, "perplexity": 4, "copilot": 3 },
      "assistant":   { "chatgpt": 6, "claude": 2 },     // a person asked an AI; it fetched to answer
      "crawler":     { "chatgpt": 20, "claude": 13 },   // an index or a training corpus
      "paths": {
        "shop.html": { "h": 120, "a": { "chatgpt": 6 }, "c": { "chatgpt": 12 } }
      },
      "pathsOther": 0,
      "discovery": { "llms.txt": { "claude": 3, "human": 1 }, "ucp": { "copilot": 2 } },
      "purchases": {
        "ai|chatgpt|page":  { "n": 2, "amounts": { "EUR": 49000000 } },
        "ai|copilot|agent": { "n": 1, "amounts": { "USD": 19990000 } },
        "none||page":       { "n": 1, "amounts": { "EUR": 9900000 } }
      },
      // Layer C: what AI agents met here. Present once an agent did something.
      "checkouts":      { "copilot": { "created": 14, "completed": 3, "canceled": 2, "failed": 9 } },
      "checkoutErrors": { "copilot|PSP_ERROR": 9 },
      "agentCalls":     { "claude": { "ok": 4, "refused": 2 } },
      "agentErrors":    { "claude|apptool:alice/shop.html/quote|payment_required": 2 }
    }
  },
  "updatedAt": "…"
}
```

## How each count is decided

- **The visitor class and the AI name** come from the User-Agent (`services/signals/visitor-class.ts`),
  the same table the signal streams use. A forged User-Agent buys a wrong row in the owner's report
  and nothing else.
- **The channel** is for people only. `utm_source` is read first (ChatGPT, Perplexity and Copilot put
  it on their links, often with no Referer), then the Referer's host. An AI answer host is `ai` with
  its family; a search engine is `search`; a social network or messenger is `social`; any other site
  is `referral`; no Referer is `direct`; a page of the same place is `internal`.
- **A target** is something the owner published: an app's filename, `portfolio`, `company:<slug>`,
  an app's discovery file as `<filename>/llms.txt`, or the node's own file path. Never a URL a
  visitor typed. At most 50 targets a day; the rest count in `pathsOther`.
- **A discovery file** fetch counts under its document and its fetcher (an AI family, `human` or `bot`).
  The node's own files count for the operator account.
- **A purchase** counts when a checkout completes, under the attribution the checkout session carried
  from the moment it opened: a page's Referer and `utm_source`, sent by the commerce library and
  reduced to a channel at once; or the agent that opened it at a checkout endpoint (named from its
  `UCP-Agent` profile address or its User-Agent), as `via: agent`. A buyer who opted out, or a
  checkout nothing could place, counts as `none`. Amounts are in the session's unit: 6-decimal
  micro-units for money, whole morsels for `MORSEL`.
- **An agent's checkout** (layer C) counts at each stage, for the seller: `created`, `updated`,
  `completed`, `canceled`, `expired`, `failed`. A failure keeps the error code the checkout answered
  (`PSP_ERROR`, `UNKNOWN_PAYMENT_HANDLER`) and nothing of its message or input. A person's checkout
  is not counted here. The agent is its AI family: from its `UCP-Agent` profile, its User-Agent, or
  an AIMEAT agent's own name (`claude-code#…` is `claude`; a name that says nothing is
  `aimeat-agent`). The name itself is never kept.
- **An outside agent's call to the owner's tool** (layer C) counts from the usage stream every metered
  call already writes: a sold app tool, an extension, capability or exchange call that names the
  owner as the seller, and the owner's attached remote MCP server used by another account's agent.
  It counts by family and outcome (`ok`, `refused`, `error`), and a call that did not succeed also
  by tool and reason, at most 100 such keys a day. The owner's own agents and people are not counted.

## What is never kept

No IP address, no cookie, no identifier across page loads, no Referer, no query string, no
User-Agent. That is why counting is on by default with no consent banner. The E2E suite
`test/e2e-ai-visibility.ts` reads every row of every table after requests that carried an address, a
Referer path and a User-Agent, and finds none of them.

## Lifecycle

Thirteen months are kept, so a month can be read against the same month a year earlier; older months
are deleted when a new month's record is created. The owner can switch counting off (what was counted
stays); deleting the account deletes the records with everything else. Counts are merged into the
record every ten seconds; a node stopped without warning loses what it had not merged.

## The settings record

`signals.visibility.settings`: `{ enabled, clarityProjectId, ga4MeasurementId, updatedAt }`. Absent
means counting is on and no tag is added. The two ids are the owner's own analytics (layer B): the
place adds the tag to every app, the portfolio and the company page, and the data goes to the
owner's own account. With the node's cookie banner on, the tag waits for the visitor to accept the
`analytics` category and passes the choice on (Clarity `consentv2`, GA4 consent mode, advertising
always denied); without the banner it loads at once and the report's `tags.warning` says EU
visitors need consent. A browser that sends Global Privacy Control gets no tag. Each id is checked
against its shape before it is stored and again before it is written into a page.

The banner such a page gets names the services the owner uses, in English, Finnish or Spanish, and
says that Clarity records the visit and where the data goes. When the visitor takes the consent
back, the cookies the two services set on that page's host (`_clck`, `_clsk`, `_ga`, `_ga_<id>`,
`_gid`) are removed and the page reloads without the tags. Google's cookie is kept on the page's
own host (`cookie_domain: 'none'`), so it is not shared with other owners' apps.

## On-page behaviour (layer D)

One record per app, `signals.behaviour.app.<filename>`, visibility `owner`, holding the last 56
days, so an owner's key count grows with their apps and never with time:

```jsonc
{
  "type": "aimeat.behaviour.app",
  "spec": "/docs/specs/visibility-contract.md",
  "app": "shop.html",
  "days": {
    "2026-10-08": {
      "views": 40, "optedOut": 2,
      "vc": { "phone": 25, "tablet": 3, "desktop": 10 },          // screen size of each view
      "scroll": { "25": 20, "50": 8, "75": 4, "100": 6 },         // the deepest quarter reached
      "heat": { "phone": { "5,2": 31 } }, "heatOther": 0,         // clicks by grid cell column,row
      "dead": { "phone|button#buy": 14 },                         // nothing changed within a second
      "rage": { "desktop|a#more": 5 }                             // three clicks in one spot
    }
  },
  "updatedAt": "…"
}
```

- **The script** is added by the place to every app page it serves (unless the owner switched that
  app off, `signals.behaviour.settings.offApps`) and sends one beacon to `POST /v1/signals/behaviour`
  when the page is hidden. It keeps nothing in the browser.
- **The grid** is 12 columns across the screen and rows a quarter of the screen high from the top of
  the page, at most 40 rows. A pixel position is never sent.
- **A dead click** is a click on a button, a link within the page, an element with `onclick` or a
  button role, or anything with a pointer cursor, after which no element was added, removed or
  changed and no navigation happened within one second. Form fields, links that leave the page and
  links that open a new tab are never dead. **A rage click** is a third click within 800 ms and 32
  pixels of two others.
- **An element** is named `tag#id.firstclass`, the author's own names, never what the page says.
- **Bounds.** One view adds at most 200 clicks and 20 elements; a stored day keeps at most 300 grid
  cells per screen size (the rest count in `heatOther`) and 60 elements per kind (the rest under
  `other|other`). A view whose browser sends Sec-GPC or DNT counts in `views` and `optedOut` only.
- **The fixing agent** (`signals.behaviour.settings.fixer`, off by default) reads seven days of
  findings, asks the owner's own AI for a corrected app and writes it as the app's draft. It never
  publishes and never replaces a draft the owner wrote. Every run is kept, newest first, in
  `signals.behaviour.runs` (at most 50): `{ app, at, by, findings, draft, model, note }`.

`GET /v1/visibility/behaviour` and `aimeat_visibility_behaviour` return the same report: per app the
views, screens, scroll, dead and rage clicks, and `findings`, one line each; with `app`, the grid too.

## Reading it

`GET /v1/visibility/report?days=30` and the MCP tool `aimeat_visibility_report` return the same
object: totals, channels, AI referrals, assistant and crawler fetches, the top 25 targets, discovery
fetches, purchases and a row per day, with a `reading` block that says what each number is worth.
Its `agents` section (layer C) lists checkouts by family and stage, checkout errors with the step
each one stopped at, tool calls by outcome, tool errors by tool and reason, and `findings`: one
line per family, such as "A copilot agent tried to buy 14 times; 9 checkouts failed at payment
(PSP_ERROR), 2 were abandoned, 3 completed." The operator switches layer C off with
`AIMEAT_AGENT_EXPERIENCE=false`.
