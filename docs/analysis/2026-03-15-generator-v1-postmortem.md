# Generator V1 Post-Mortem: Hälytyskartta Service

**Date:** 2026-03-15
**Test project:** Hälytyskartta (Finnish emergency alert map)
**Components generated:** 1 CSM, 6 memory namespaces, 2 MSMs, 6 extensions, 2 translations, 1 cortex, 1 app
**Result:** Partially functional — data ingestion works, map/list render, but core parsing is broken and dashboard non-functional

---

## Executive Summary

The generator successfully scaffolded a complete 20-component service that ingested real RSS data and displayed it. However, the generated code has **5 critical bugs** that make it essentially unusable. All bugs trace to prompt deficiencies — the generator's instructions don't prevent foreseeable failure modes.

**What works:** RSS ingestion runs, stores alerts, map shows markers, list shows rows, auth/login works, navigation tabs work, severity badges display correctly.

**What doesn't:** Municipality/type fields contain hour digits instead of names, aggregation crashes on JSON.parse, dashboard charts are empty, map markers lack coordinates for most alerts, character encoding corrupted.

---

## Bug Analysis

### Bug 1: RSS Title Parsing Extracts Hour Digits as Municipality/Type (CRITICAL)

**Symptom:** Type dropdown shows `0, 1, 2, 20, 21, 22, 23`. List shows numbers in Municipality and Type columns.

**Root cause:** The generated `parseTitle()` function splits on `:` to separate municipality from type. But the real RSS format is `HH:MM:SS Municipality alerttype: severity` — so splitting on `:` first hits the time prefix.

```javascript
// Generated code (broken):
const parts = t.split(":");
const left = parts[0];  // Gets "1" from "1:59:55 Kuhmoinen vahingontorjunta: pieni"
const tokens = left.trim().split(/\s+/);
const municipality = tokens[0];  // "1" (the hour)
```

For `"1:59:55 Kuhmoinen vahingontorjunta: pieni"`:
- `split(":")` → `["1", "59", "55 Kuhmoinen vahingontorjunta", " pieni"]`
- `parts[0]` = `"1"` → municipality = `"1"`, type = `"1"`

The numbers 0, 1, 2, 20, 21, 22, 23 in the Type dropdown are **hours of the day** (midnight, 1am, 2am, 8pm, 9pm, 10pm, 11pm).

**Fix needed:** Strip the `HH:MM:SS` timestamp prefix before parsing: `title.replace(/^\d{1,2}:\d{2}:\d{2}\s*/, '')`

**Prompt root cause:** The blueprint prompt doesn't provide the **actual RSS format** to the extension generator. The AI had to guess the format and guessed wrong. The interview should capture a sample RSS entry, and the blueprint should pass it through to the extension prompt.

### Bug 2: aggregate-daily Crashes with "undefined is not valid JSON" (CRITICAL)

**Symptom:** `POST /v1/ext/alerts-ingest-and-aggregator/aggregate-daily` returns 500 with `"undefined" is not valid JSON`.

**Root cause:** The extension action code calls `JSON.parse()` on `ctx.memory.get()` results. `ctx.memory.get()` returns already-parsed JS values (or `undefined` if key doesn't exist). `JSON.parse(undefined)` throws `"undefined" is not valid JSON`.

**Prompt root cause:** Despite our explicit warnings (boxed ASCII art, WRONG/CORRECT examples), the AI still generated `JSON.parse(await ctx.memory.get(...))`. The warning exists in the prompt but the AI ignores it during code generation because:
1. The warning is in a "constraints" section far from where code patterns are shown
2. The code example in the "Output format" section shows `JSON.parse(resp.text)` for `ctx.fetch()` — the AI pattern-matches and applies JSON.parse everywhere
3. LLMs have strong priors to parse JSON strings — the prohibition isn't reinforced at the point of code generation

### Bug 3: Map Markers Missing for Most Alerts (MAJOR)

**Symptom:** Map shows some markers near Helsinki but the screenshots show all markers clustered, and many alerts have no map representation.

**Root cause:** The RSS feed from tilannehuone.fi does NOT include coordinates. The generated code does `if (!a.coordinates) return;` — silently skipping alerts without coords. Since the RSS parser doesn't geocode municipality names to lat/lng, most alerts simply don't appear on the map.

**Evidence from data:** Alert objects have no `coordinates` field at all in the stored data. The map shows markers because some alerts randomly have coordinates (likely hardcoded test data or a geocoding attempt that partially works).

**Prompt root cause:** The blueprint prompt doesn't warn about geocoding needs. When a service uses a map view, the generator should check if the data source provides coordinates and, if not, plan for a geocoding step (either as an extension action during ingestion, or as client-side lookup from a municipality→coords mapping).

### Bug 4: Dashboard Charts Empty (MAJOR)

**Symptom:** "Päivittäiset" tab shows empty chart canvases with just headings.

**Root cause:** Cascading failure:
1. `getDailyStats()` tries to read `aggregates.daily.2026-03-15` from memory → 404 (no aggregation has run)
2. Falls back to calling `aggregate-daily` extension action → 500 (Bug 2: JSON.parse crash)
3. Falls back to second memory read → still 404
4. Returns null → charts render with empty data objects

Even if aggregation worked, charts would show hour digits as labels (Bug 1).

### Bug 5: Character Encoding Corruption (MINOR)

**Symptom:** `"paloh�lytys"` instead of `"palohälytys"` in stored data.

**Root cause:** The RSS feed uses ISO-8859-1 or Windows-1252 encoding. The extension fetches it with `ctx.fetch()` and reads the body as UTF-8 by default, corrupting Finnish characters (ä, ö, å).

**Prompt root cause:** The extension prompt doesn't mention encoding handling for RSS/XML feeds. Finnish content almost always needs explicit encoding detection.

### Bug 6: Both Translation Files Use English Root Key (MINOR)

**Symptom:** Finnish translation component generated `{"en": {...}}` with English text instead of `{"fi": {...}}` with Finnish text.

**Root cause:** The translation prompt didn't enforce locale-key matching. When splitting into two translation components (translation-1 for Finnish, translation-2 for English), the AI used `"en"` as root key for both.

**Status:** Fixed in v3.1.0 of generator-prompts.js.

### Bug 7: HTML Entities in Extension Code (MINOR — intermittent)

**Symptom:** `Unexpected token '&' [<isolated-vm>:4:20]` when running the nightly aggregator.

**Root cause:** When Copilot retries a response (e.g., after hitting a safety filter), the retry sometimes renders HTML entities: `=&gt;` instead of `=>`, `&amp;&amp;` instead of `&&`. The V8 sandbox cannot execute HTML-encoded JavaScript.

**Status:** Warning added to fix/retry prompt in v3.1.0.

---

## What the Generator Got Right

Despite the bugs, several things worked well:

1. **Component decomposition** — CSM, memory namespaces, extensions, cortex, app are logically separated
2. **RSS data ingestion** — The extension successfully fetched the RSS feed, parsed XML, and stored structured alerts
3. **Memory namespace design** — Date-bucketed keys, __index, __meta patterns are correct
4. **App auth flow** — Login button, session management, AIMEAT.auth integration all work
5. **Severity badges** — Correctly parsed from Finnish text (pieni/keskisuuri/suuri) with color coding
6. **Responsive UI** — Map, list, dashboard tabs with clean layout
7. **Empty-state handling** — Map and list views show "no data" messages (app prompt improvement worked)
8. **Filter UI** — Type, severity, time range dropdowns render and filter correctly (though data is wrong)

---

## Root Cause Categories

| Category | Bugs | Description |
|----------|------|-------------|
| **Missing domain context** | 1, 3, 5 | Generator didn't know RSS format, coordinate requirements, or encoding |
| **Prompt not enforced** | 2, 7 | Warning exists but AI ignores it during code generation |
| **Blueprint over-generation** | (prev session) | Created 6 extensions where 2-3 suffice |
| **Prompt ambiguity** | 6 | Translation prompt didn't enforce locale key matching |
| **No data validation** | 1, 4 | Generated code doesn't validate parsed data against expected patterns |

---

## Metrics

| Metric | Value |
|--------|-------|
| Total components generated | 20 |
| Components that work correctly | ~12 (CSM, memory defs, MSMs, auth, nav, severity badges) |
| Components with critical bugs | 4 (ingest parser, aggregator, cortex, app partially) |
| Extensions that should not exist | 2 (export, settings — per our ext/cortex/app framework) |
| Prompt improvements already made | 6 (v3.1.0: ext/cortex/app rules, JSON.parse, translations, empty-state, HTML entities, context bloat) |
| Remaining prompt improvements needed | 5+ (see improvement plan) |

---

## Key Insight: The Interview Must Capture Sample Data

The biggest failure is that the generator had to **guess** the RSS format. The interview asks about data sources but doesn't instruct the AI to **fetch a sample entry and include it in the spec**. If the spec contained:

```
Sample RSS title: "1:59:55 Kuhmoinen vahingontorjunta: pieni"
Format: HH:MM:SS Municipality AlertType: Severity
```

The extension generator would have written a correct parser. This is the single highest-impact improvement.

---

## Appendix: Data Flow Diagram

```
RSS Feed (tilannehuone.fi)
    ↓ ctx.fetch() [encoding bug: ä→�]
Extension: ingest-alerts
    ↓ parseTitle() [BROKEN: hour→municipality, hour→type]
Memory: alerts.by-date.YYYY-MM-DD
    ↓ [no coordinates — RSS lacks lat/lng]
Extension: aggregate-daily
    ↓ JSON.parse(ctx.memory.get()) [CRASH]
Memory: aggregates.daily.YYYY-MM-DD
    ↓ (never written)
Cortex: getDailyStats()
    ↓ tries memory read → 404, tries aggregate-daily → 500
App: Dashboard
    ↓ catch(() => null)
Empty charts
```
