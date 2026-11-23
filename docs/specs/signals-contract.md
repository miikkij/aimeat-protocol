<!--
@file signals-contract.md
@description The signals record contract: what a stream is, what a hit is, how the monthly roll-up
  is shaped, and what each number is worth. Named by `spec` inside every month record, so an agent
  or another system can read and honour the shape without our code.
@version-history
  v1.1.0 - 2026-11-15 - The place a person came from (the stream's `geo` precision, the daily
    `countries` and `places` counts, the month's `places` map) and the report's day window, as the
    node keeps them since 2026-09-18.
  v1.0.0 — 2026-08-24 — Initial, with the collector.
-->

# Signals: counting what was reached

One counter behind every channel. An email opened, a link clicked, a published page fetched, a QR
scanned, an app's own event: all of it is stored in the same record shape, so a report can hold them
side by side instead of each surface keeping its own tally in its own format.

## What a person gets

"Who opened the message, who clicked, and is anyone's AI reading our pages." The first two are the
ordinary questions a mailing raises. The third is the one this node can answer better than a
tracking tool can, because the pages are served here: a named AI fetcher shows up in the log with
its own name, and the report says whether it came because a PERSON asked it something or because a
crawler was building an index.

## The two records

**The stream** — `signals.stream.<streamId>` — is what an owner deliberately measures: a campaign, a
page, a channel. It is server-trusted (an unauthenticated endpoint reads it before agreeing to write),
so it is stored under the reserved `signals.` prefix and is written only by `/v1/signals/streams`, never
through the memory API.

It holds no destination URL. A redirect target stored here would make the node an open redirect for
anyone's phishing link, so the click-through page belongs to the app that owns the campaign and
reads its own saved link map. The node counts; it does not forward.

**The month** — `signals.hits.<streamId>.<YYYY-MM>` — holds every hit that stream took that month:

```jsonc
{
  "type": "aimeat.signals.month",
  "spec": "/v1/specs/signals-contract.md",   // this document, as the node serves it
  "streamId": "campaign-spring",
  "month": "2026-08",
  "days": {
    "2026-08-24": {
      "total": 143,
      "events":   { "open": 120, "click": 23 },
      "channels": { "email": 143 },
      "classes":  { "human": 118, "ai": 4, "bot": 21 },
      "aiAgents": { "chatgpt:asked": 3, "claude": 1 },
      "countries": { "FI": 90, "SE": 20, "ZZ": 8 },          // people only; only when the stream's geo is not "off"
      "places":    { "FI|Uusimaa|Espoo": 41 }                // keys into "places" below
    }
  },
  "places": {
    "FI|Uusimaa|Espoo": { "country": "FI", "region": "Uusimaa", "city": "Espoo", "lat": 60.2, "lon": 24.7 }
  },
  "placesTruncated": false,
  "subjects": {
    "r-8fc21": { "firstAt": "…", "lastAt": "…", "events": { "open": 2, "click": 1 },
                 "lastRef": "hero-link", "machine": false }
  },
  "subjectsTruncated": false,
  "dropped": 0,
  "updatedAt": "…"
}
```

## Where people came from

A stream sets `geo`, the precision it keeps a place at: `off` (the default), `country`, `region` or
`city`. Only hits from people count; an AI fetcher's place is a data centre. The place comes from
headers the reverse proxy sets, and the node keeps no address. Each day gets `countries` (an ISO
3166 two-letter code, or `ZZ` when the place could not be told) and, at `region` or `city`,
`places`, whose keys (`country|region|city`) point into the month's `places` map. A city place
has `lat` and `lon` rounded to one decimal. A month keeps at most 300 places; a new place after
that is not counted as a place, and `placesTruncated` turns true.

The report (`GET /v1/signals/streams/{streamId}/report`) takes a month window (`from`, `to`) or a
day window (`from_day`, `to_day`), and answers `totals.countries`, `totals.places`, the `places` they
refer to, `placesTruncated`, and `geo`, the precision the stream keeps NOW: earlier days may hold
less.

## Why one key per month

The key budget is 1000 keys per principal. A record per hit, or even per day per stream, is not a
design but an outage on a schedule: a 200-recipient campaign would eat an owner's whole namespace in
weeks. One key per stream per month costs 12 keys a year however many hits land, and the 1024 kB
value ceiling is nowhere near reached — a busy month measures in single-digit kB. Months past the
retention window are pruned when a new month record is created, so an abandoned campaign does not
hold budget forever.

## Who opened it, without the node learning who

A hit may include a `subject`: an opaque token the SENDER minted and only the sender can map back to a
person. The node counts per token and stores no address, no name and no IP. So "who opened this" is
answerable by the person who sent it, and by nobody else, and the answer never becomes data this
node holds about a stranger. A stream can turn the per-subject roll-up off (`perSubject: false`) and
keep the totals.

## What each number is worth

Given in the report payload itself (`reading`), not left to whoever renders it, because a number
that is passed on without its meaning gets repeated to a customer as something it is not.

- **A click is an act.** Somebody chose the link. Known mail scanners are counted as machines.
- **An open is an estimate.** Mail apps fetch images on the reader's behalf: Gmail proxies them,
  corporate gateways pre-fetch them, and Apple Mail Privacy Protection fetches through a relay with
  an ordinary Safari signature, which cannot be told from a person here by design. Treat opens as a
  floor with machine noise in it. This is not a gap in this implementation; every open-tracking
  product on the market has it, and most do not say so.
- **An AI name ending in `:asked`** means a person asked an AI something and it fetched this page to
  answer. A name without the suffix is a crawler building a model or an index. The first is a lead,
  the second means the page is in a crawler's index.

## Counting a page nobody clicked on

A published page is counted when a stream named after it already exists: `cadence.html` counts into
`page-cadence-html`. That is the whole opt-in — no setting, no per-page switch, and nothing is
measured until the owner creates the stream. Serving a page nobody measures costs no database read,
and creating the stream takes effect on the next request rather than when a cache expires.

This is the only route that sees an AI crawler at all, because those clients run no JavaScript and
load no images.

## The endpoints

| Endpoint | Auth | For |
|---|---|---|
| `POST /v1/signals/streams` | `signals:write` | define what is measured |
| `GET /v1/signals/streams` | `signals:read` | list streams and their public addresses |
| `DELETE /v1/signals/streams/{id}` | `signals:write` | delete a stream and its months |
| `GET /v1/signals/streams/{id}/report` | `signals:read` | totals, days, AI names, countries and places, per-subject roll-up |
| `GET /v1/signals/{owner}/{id}/px.svg` | none | the tracking image |
| `POST /v1/signals/{owner}/{id}/hit` | none | everything a script can send |

`signals:read` is separated from `signals:write` on purpose: reading is the half that names people.

## What a stranger holding a public address can do

Add counts to that one stream, up to its daily ceiling. They cannot create a stream, read a report,
learn who else was counted, reach any other key, or make the record grow without bound. An unknown
stream, a disabled one and one over its cap all answer identically, so the address cannot be used to
find out which campaigns exist.
