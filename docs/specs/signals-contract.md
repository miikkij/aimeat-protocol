<!--
@file signals-contract.md
@description The signals record contract: what a stream is, what a hit is, how the monthly roll-up
  is shaped, and what each number is worth. Named by `spec` inside every month record, so an agent
  or another system can read and honour the shape without our code.
@version-history
  v1.0.0 — 2026-08-24 — Initial, with the collector.
-->

# Signals: counting what was reached

One counter behind every channel. An email opened, a link clicked, a published page fetched, a QR
scanned, an app's own event: all of it lands in the same record shape, so a report can hold them
side by side instead of each surface keeping its own tally in its own format.

## What a person gets

"Who opened the message, who clicked, and is anyone's AI reading our pages." The first two are the
ordinary questions a mailing raises. The third is the one this node can answer better than a
tracking tool can, because the pages are served here: a named AI fetcher shows up in the log with
its own name, and the report says whether it came because a PERSON asked it something or because a
crawler was building an index.

## The two records

**The stream** — `signals.stream.<streamId>` — is what an owner deliberately measures: a campaign, a
page, a channel. It is server-trusted (an unauthenticated door reads it before agreeing to write),
so it lives under the reserved `signals.` prefix and is written only by `/v1/signals/streams`, never
through the memory API.

It holds no destination URL. A redirect target stored here would make the node an open redirect for
anyone's phishing link, so the click-through page belongs to the app that owns the campaign and
reads its own saved link map. The node counts; it does not forward.

**The month** — `signals.hits.<streamId>.<YYYY-MM>` — holds every hit that stream took that month:

```jsonc
{
  "type": "aimeat.signals.month",
  "spec": "/docs/specs/signals-contract.md",
  "streamId": "campaign-spring",
  "month": "2026-08",
  "days": {
    "2026-08-24": {
      "total": 143,
      "events":   { "open": 120, "click": 23 },
      "channels": { "email": 143 },
      "classes":  { "human": 118, "ai": 4, "bot": 21 },
      "aiAgents": { "chatgpt:asked": 3, "claude": 1 }
    }
  },
  "subjects": {
    "r-8fc21": { "firstAt": "…", "lastAt": "…", "events": { "open": 2, "click": 1 },
                 "lastRef": "hero-link", "machine": false }
  },
  "subjectsTruncated": false,
  "dropped": 0,
  "updatedAt": "…"
}
```

## Why one key per month

The key budget is 1000 keys per principal. A record per hit, or even per day per stream, is not a
design but an outage on a schedule: a 200-recipient campaign would eat an owner's whole namespace in
weeks. One key per stream per month costs 12 keys a year however many hits land, and the 1024 kB
value ceiling is nowhere near reached — a busy month measures in single-digit kB. Months past the
retention window are pruned when a new month record is created, so an abandoned campaign does not
hold budget forever.

## Who opened it, without the node learning who

A hit may carry a `subject`: an opaque token the SENDER minted and only the sender can map back to a
person. The node counts per token and stores no address, no name and no IP. So "who opened this" is
answerable by the person who sent it, and by nobody else, and the answer never becomes data this
node holds about a stranger. A stream can turn the per-subject roll-up off (`perSubject: false`) and
keep the totals.

## What each number is worth

Carried in the report payload itself (`reading`), not left to whoever renders it, because a number
that travels without its meaning gets repeated to a customer as something it is not.

- **A click is an act.** Somebody chose the link. Known mail scanners are counted as machines.
- **An open is an estimate.** Mail apps fetch images on the reader's behalf: Gmail proxies them,
  corporate gateways pre-fetch them, and Apple Mail Privacy Protection fetches through a relay with
  an ordinary Safari signature, which cannot be told from a person here by design. Treat opens as a
  floor with machine noise in it. This is not a gap in this implementation; every open-tracking
  product on the market has it, and most do not say so.
- **An AI name ending in `:asked`** means a person asked an AI something and it fetched this page to
  answer. A name without the suffix is a crawler building a model or an index. The first is a lead,
  the second is shelf presence.

## The doors

| Door | Auth | For |
|---|---|---|
| `POST /v1/signals/streams` | `signals:write` | define what is measured |
| `GET /v1/signals/streams` | `signals:read` | list streams and their public addresses |
| `DELETE /v1/signals/streams/{id}` | `signals:write` | delete a stream and its months |
| `GET /v1/signals/streams/{id}/report` | `signals:read` | totals, days, AI names, per-subject roll-up |
| `GET /v1/signals/{owner}/{id}/px.svg` | none | the tracking image |
| `POST /v1/signals/{owner}/{id}/hit` | none | everything a script can send |

`signals:read` is separated from `signals:write` on purpose: reading is the half that names people.

## What a stranger holding a public address can do

Add counts to that one stream, up to its daily ceiling. They cannot create a stream, read a report,
learn who else was counted, reach any other key, or make the record grow without bound. An unknown
stream, a disabled one and one over its cap all answer identically, so the address cannot be used to
find out which campaigns exist.
