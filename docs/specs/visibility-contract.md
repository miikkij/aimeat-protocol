<!--
@file visibility-contract.md
@description The AI visibility record contract: what one owner's month of counts holds, how each
  count is decided, and what each number is worth. Named by `spec` inside every month record, so an
  agent or another system can read and honour the shape without our code.
@version-history
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
      }
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

## Reading it

`GET /v1/visibility/report?days=30` and the MCP tool `aimeat_visibility_report` return the same
object: totals, channels, AI referrals, assistant and crawler fetches, the top 25 targets, discovery
fetches, purchases and a row per day, with a `reading` block that says what each number is worth.
