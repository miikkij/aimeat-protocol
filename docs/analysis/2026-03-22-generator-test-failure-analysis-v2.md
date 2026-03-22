# Generator Extension Test Failure — Root Cause Analysis V2

> **Date:** 2026-03-22
> **Subject:** PRH Yritystietopalvelu extension tests still failing after prompt fixes
> **Status:** Root cause found — extension code has wrong API response field name
> **Previous analysis:** `2026-03-22-generator-test-failure-analysis.md`

---

## 1. New Evidence

After implementing the test prompt fixes (scenario type classification, external API tolerance), the tests still fail with 5 errors. All errors point to the extension not finding any data from the PRH API.

**Critical new finding:** The PRH API works perfectly from this machine:

```bash
$ curl "https://avoindata.prh.fi/opendata-ytj-api/v3/companies?name=Overscale"
→ {"totalResults":1,"companies":[{...Overscale Solutions Oy...}]}

$ curl "https://avoindata.prh.fi/opendata-ytj-api/v3/companies?businessId=3323553-5"
→ {"totalResults":1,"companies":[{...}]}
```

Both calls return valid data. The API is not down.

---

## 2. Root Cause: Wrong Response Field Name

The generated extension code uses `data.results` to access the company array:

```javascript
// Line 693 in extension code:
if (type === "businessId" && (!data || !data.results || data.results.length === 0)) {

// Line 713:
if (!data || !data.results || data.results.length === 0) {

// Line 718:
const formattedResults = data.results.map(company => { ... });

// Line 829 (addToWatchlist):
if (data && data.results && data.results.length > 0) {

// Line 842:
if (!data || !data.results || data.results.length === 0) {
```

But the PRH API response uses `companies`, not `results`:

```json
{"totalResults": 1, "companies": [{...}]}
```

The extension parses `JSON.parse(resp.text)` correctly, but then checks `data.results` which is `undefined`. This means every search returns "Yrityksiä ei löytynyt" and every watchlist add fails with "Yritystä ei löytynyt".

**This is a bug in the LLM-generated extension code.** The LLM assumed the API response key is `results` instead of `companies`. The interview spec captured a real sample entry, but the generation prompt may not have included the full API response structure (just a parsed/extracted sample entry, not the raw response envelope).

---

## 3. Why the Previous Fix Didn't Help

Our test prompt fix (Solution D — treat external API actions leniently) would have made the tests PASS even with the buggy code, because the extension returns `{ results: [], message: "Yrityksiä ei löytynyt" }` — a valid response shape with an error message. Under the new rules, this would be accepted as "graceful error handling".

**But that's wrong.** The extension is broken — it's reading the wrong field from a working API. The test SHOULD fail. The old strict test was right to catch this, but for the wrong reason (it checked for specific data rather than noticing the parsing bug).

This reveals a fundamental tension:
- **Lenient tests** (our fix): would pass broken code that silently ignores valid API data
- **Strict tests** (original): catch the bug but also fail when the API is genuinely down

---

## 4. The Real Solution

### 4.1 Fix the root cause: improve the extension generation prompt

The LLM doesn't know the exact API response structure. The interview spec captures a `sampleEntry` (one company object) but NOT the response envelope (`{ totalResults, companies: [...] }`).

**Solution:** The extension generation prompt should include the full API response envelope from the interview spec's `dataSources`, not just the parsed sample entry. When the interview spec has a verified URL with `sampleEntry`, the prompt should show:

```
The API at https://avoindata.prh.fi/opendata-ytj-api/v3/companies returns:
{
  "totalResults": <number>,
  "companies": [ <company objects> ]
}

Each company object looks like:
{ <sampleEntry> }
```

This way the LLM generates code that uses `data.companies`, not `data.results`.

### 4.2 Keep strict tests but distinguish bug-catching from API-unavailability

Instead of making external-API tests lenient for ALL responses, make them smart:

**The test should distinguish between:**
1. **Extension returned structured error** (`{ error: "API-pyyntö epäonnistui: 400" }`) → the API is down, extension handled it gracefully → **PASS**
2. **Extension returned empty results from a working API** (`{ results: [], message: "..." }`) → could be a parsing bug → **CONDITIONAL**: if the API was supposed to have data (based on test scenario), this is suspicious but not necessarily a failure
3. **Extension crashed** (HTTP 500) → **FAIL**

The key insight: when the extension returns an `error` field referencing an HTTP status code, the external API is genuinely failing. When the extension returns "no results" from a known-good query, the extension code has a bug.

### 4.3 Improve the data source threading

The extension prompt already receives data source information, but it needs the **raw API response envelope structure** — not just the sample entry within it. The interview spec's `sampleEntry` is a single company object, but the code needs to know the wrapper: `{ totalResults, companies: [...] }`.

**Change needed in `buildComponentPrompt`:** When injecting data source details for extensions, include the response wrapper structure. The interview spec's `dataSources` has `format`, `sampleEntry`, and `sampleFields` — we need to also capture `responseEnvelope` or derive it from the sample.

---

## 5. Recommended Actions (Priority Order)

### Action 1: Add response envelope to data source spec (HIGH)

In the interview prompt, when the AI verifies a URL and captures a sample, also capture the response envelope structure:

```json
{
  "id": "ds-1",
  "url": "https://avoindata.prh.fi/opendata-ytj-api/v3/companies",
  "responseEnvelope": {
    "totalResults": "number",
    "companies": "array of company objects"
  },
  "sampleEntry": { ... one company object ... }
}
```

Then in `buildComponentPrompt` for extensions, inject this:

```
API Response Structure for https://avoindata.prh.fi/...:
Response envelope: { "totalResults": <number>, "companies": [ <array of company objects> ] }
Access the results array via response.companies (NOT response.results).
```

### Action 2: Revert test leniency for external API actions (MEDIUM)

The `[EXTERNAL API]` leniency should only apply when the extension explicitly reports an API error (returns `{ error: "..." }` mentioning HTTP status). When the extension returns "no results" or empty data from a known-good test query, the test should still flag it as a potential issue.

Updated test pattern:
```javascript
// [EXTERNAL API] action
const r = await testFetch('/v1/ext/my-service/search', { method: 'POST', body: JSON.stringify({ query: 'test' }) });
if (r.status === 500) errors.push('search: crashed with HTTP 500');
else {
  const d = r.body?.data;
  if (!d) errors.push('search: no response data');
  else if (d.error && /\d{3}/.test(d.error)) {
    // Extension caught an HTTP error from the external API — this is OK
    // e.g., "API-pyyntö epäonnistui: 400" — graceful handling, PASS
  } else if (d.error) {
    // Extension returned a domain-level error (not HTTP) — might be a bug
    errors.push('search: returned error: ' + d.error);
  }
  // Check response shape if no error
  else if (!d.results && !d.companies && !Array.isArray(d)) {
    errors.push('search: unexpected response shape — no results array');
  }
}
```

### Action 3: Keep deactivation fix (already implemented)

The deactivation step in the fix loop is correct and should stay.

---

## 6. Why This Matters

The core issue is that **the LLM generating the extension code doesn't see the full API response structure**. It only sees a sample entry (a company object) and guesses the response wrapper. Different APIs use different field names: `results`, `data`, `items`, `companies`, `records`, etc. Without seeing the actual response, the LLM defaults to common patterns like `results`.

Fixing the data source threading (Action 1) addresses this at the root. The test prompt fixes (Action 2) are safety nets. Both are needed.
