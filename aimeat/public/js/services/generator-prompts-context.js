/**
 * @file public/js/services/generator-prompts-context.js
 * @description Shared AIMEAT context preamble and instruction disclaimer for generator prompts. Extracted from generator-prompts-base.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from generator-prompts-base.js (max-file-lines)
 */

export const AIMEAT_CONTEXT = `
You are helping create an AIMEAT service. AIMEAT is an AI agent infrastructure protocol.

Available building blocks:
- CSM (Community Service Manifest): YAML defining data schemas, fields, consent rules, validation.
- MSM (Micro Service Manifest): YAML defining external API integrations, auth, endpoints.
- Extension: V8-sandboxed JavaScript logic with YAML manifest. Actions get ctx object with memory, wallet, consent, trust, fetch APIs.
- App: HTML/JS user interface published to the apps catalog.
- Memory: Key-value storage with namespace isolation.
- Translation: Per-locale i18n strings.
- Cortex: Client-side JS domain library (IIFE on AIMEAT namespace). Wraps extension APIs and memory reads into clean domain methods for apps.

Extensions run in an ISOLATED V8 sandbox with ONLY this API (no Node.js, no global fetch, no setTimeout, no require, no import):
  ctx.memory.get(key) → value or null (ALWAYS null-check before using: \`|| []\` or \`|| {}\`)
  ctx.memory.set(key, value) → void
  ctx.memory.search(prefix) → Array<{ key, value }> (NOT plain strings!)
  ctx.memory.delete(key) → boolean
  ctx.memory.getPublic(namespace, key) → value or null (read data from a DIFFERENT namespace)
    Use this to read: (a) another extension's public data, (b) the OWNER's shared data (memory components, translations, settings).
    Example — read another extension's data: await ctx.memory.getPublic('ext:other-ext', 'some.key')
    Example — read owner's shared data: await ctx.memory.getPublic(ctx.caller.gaii, 'lookup.data')
    ╔═══════════════════════════════════════════════════════════════════════════════╗
    ║  IMPORTANT: ctx.memory.get() ONLY reads from the extension's OWN namespace. ║
    ║  Data stored by memory components (seed data, settings, translations) lives  ║
    ║  in the OWNER's namespace — use ctx.memory.getPublic(ctx.caller.gaii, key)  ║
    ║  to access it. ctx.caller.gaii is the caller's GHII identity (e.g. "testuser@node-id"). ║
    ╚═══════════════════════════════════════════════════════════════════════════════╝
  ctx.fetch(url, { method, headers, body }) → { status, ok, text, headers }
    Use ctx.fetch for ALL HTTP requests. Global fetch() is NOT available.
    Response body is always .text (string) — parse JSON with JSON.parse(resp.text).
    Encoding is handled automatically — the runtime detects charset from: (1) Content-Type header,
    (2) XML prolog encoding attribute, (3) HTML meta charset tag. Falls back to UTF-8.
    You always get correct Unicode text — no manual decoding needed, even for ISO-8859-1 feeds.
  ctx.wallet.consume(amount, reason), ctx.wallet.getBalance()
  ctx.consent.check(gaii, scope), ctx.consent.require(gaii, scope)
  ctx.trust.getScore(gaii)
  ctx.caller = { gaii, owner, roles }
  ctx.config = extension config object (from manifest config section)
  ctx.instance = { id, config } (when called via instance endpoint)
  ctx.log.info/warn/error(msg, data)

AIMEAT Data Standards (MUST follow in ALL components):
  Dates/times: ISO 8601 ONLY — "2026-03-14T13:00:00.000Z". NEVER store RFC 2822 ("Sat, 14 Mar ..."), Unix timestamps, or locale-formatted dates. Convert all dates to ISO before storing.
  Memory keys: lowercase dot-namespaced — "items.by-date.2026-03-14". Dates in keys MUST use YYYY-MM-DD.
  Resource IDs: URL-safe strings (kebab-case or hex hashes). No spaces, no special characters.
  Action IDs: camelCase — "getItems", "addToWatchlist", "checkChanges". NEVER kebab-case for actions.
  Locale codes: BCP 47 — "fi", "en", "fi-FI", "en-US".
  Coordinates: { latitude: number, longitude: number } — WGS84 decimal degrees.
  Currency/amounts: integers (no floats) — morsels are whole numbers.
`.trim();

/* ── Instruction Disclaimer (prepended to every prompt) ── */

export const INSTRUCTION_DISCLAIMER = `IMPORTANT: These are detailed instructions that you MUST read carefully and follow exactly. Every rule, constraint, format requirement, and example below exists for a reason. Do NOT skip sections, do NOT invent your own conventions, and do NOT deviate from the specified output format. If a rule says "MUST" or "NEVER", treat it as absolute.

`;
