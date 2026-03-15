# Generator v1 — Copilot Thinker Session Analysis (2026-03-15)

## Session Overview

First end-to-end test of the full generator workflow using M365 Copilot Thinker mode as the AI backend. The service was "Hälytyskartta" — a Finnish emergency alert monitoring system with RSS ingestion, daily stats, risk profiles, geo data, i18n, and a Leaflet map app.

**Components generated:** 8 (CSM, 3 extensions, 2 translations, 1 cortex, 1 app)

## Issues Found

### 1. Translation Duplication (Critical)

**Symptom:** Both `translation-1` (Finnish) and `translation-2` (English) generated BOTH languages — 4 locale files instead of 2.

**Root cause:** The translation prompt started with `MUST include BOTH "en" and "fi" locales` (line 978). The blueprint creates two separate translation components (`Finnish (fi) Strings` and `English (en) Strings`), but the prompt's first rule overrode the label-specific instructions that followed.

**Lesson:** When a prompt has conflicting rules, AIs consistently follow the FIRST explicit instruction. Ordering matters. A "MUST include BOTH" at the top completely eclipses a "if the label says X, do Y" later.

**Fix:** Removed "MUST include BOTH" entirely. Added prominent boxed warning: "NEVER generate both locales in one component." Changed examples to show single-locale output only.

### 2. 409 VERSION_CONFLICT Spam (Medium)

**Symptom:** 15+ consecutive 409 errors on PUT requests to memory keys during component state updates.

**Root cause:** `saveComponent()` retried only once on conflict. When `loadAllComponents()` returned stale `_version` values and multiple saves fired in rapid succession (e.g., during blueprint initialization or UI re-renders), the single retry was insufficient — the retry itself could get a stale version if another save completed between the fetch and the retry.

**Fix:** Changed retry from 1 attempt to up to 3 attempts with fresh version fetch before each retry.

### 3. HTML Entities in Extension Code (Medium)

**Symptom:** Extension code contained `&gt;`, `&amp;`, `&lt;` in JavaScript operators (arrow functions, comparisons, logical AND), causing V8 sandbox crashes.

**Root cause:** The AI (Copilot) rendered HTML entities in JavaScript code despite a "NEVER output HTML entities" warning. The warning was a single line at the end of a long prompt — easily missed.

**Secondary issue:** The validator's HTML entity check produced false positives on legitimate entity-decoding code like `.replace(/&amp;/g, "&")`, where `&amp;` appears inside a string literal.

**Fix (prompt):** Added prominent boxed warning with explicit before/after examples directly in the extension template.

**Fix (validator):** Strip string literals and regex patterns from code before checking for HTML entities, eliminating false positives.

### 4. Extension Code Outside Code Blocks (Minor)

**Symptom:** Some extension outputs had code partially outside the expected code block format.

**Root cause:** The prompt says "Return EVERYTHING in ONE code block" but when the AI generates long output, it sometimes breaks out of the code fence.

**Status:** Existing validator handles this by extracting code from multiple blocks and joining them. No code change needed, but worth noting.

## Positive Observations

1. **Interview prompt worked well.** The structured interview flow with Copilot produced a comprehensive, well-organized specification JSON. The 20-question budget, section summaries, and "YOU DECIDE" list kept the conversation focused.

2. **RSS parsing was correct.** The generated extension code correctly handled ISO-8859-1 encoding, parsed Finnish date formats, extracted municipality/type/severity fields, handled timezone offsets, and implemented deduplication — all from the sample data provided during the interview.

3. **Blueprint structure was correct.** The component decomposition, phase ordering, and produces/consumes dependencies were all appropriate for the service.

4. **Data standards compliance.** ISO 8601 dates, dot-namespaced memory keys, kebab-case IDs — all followed correctly.

## Systemic Learnings

### Prompt Design Principles

1. **Never have competing rules.** If a prompt says "MUST do X" and later says "unless Y", the AI follows the first rule. Make the primary rule unambiguous.

2. **Box critical warnings.** The ╔═══╗ box format gets reliably followed. Single-line warnings get ignored under pressure (long prompts, complex output).

3. **Show what you want, not what you don't want.** The "If generating BOTH locales" example was the FIRST example shown — so the AI copied that pattern. Show the desired output first.

4. **One example per component.** When a prompt shows both "multi-locale" and "single-locale" examples, the AI picks whichever feels more complete. Show only the relevant example.

### Validator Design Principles

1. **String literals are not code.** Any syntax-checking validator must strip string content before pattern-matching, or it will false-positive on legitimate string data.

2. **Retry logic needs headroom.** Optimistic locking with retry-once is insufficient when the UI can trigger rapid concurrent saves. Retry up to 3 times.

## Files Changed

| File | Change |
|------|--------|
| `public/js/services/generator-prompts.js` | Fix translation prompt, strengthen HTML entity warning |
| `public/js/services/generator.js` | Improve saveComponent retry (1→3 attempts) |
| `public/js/services/generator-validate.js` | Fix HTML entity false positives in string literals |
